import { execSync } from "node:child_process";

import { decryptToken } from "../functions/_lib/crypto";
import { debugNitradoAdmFileDiscovery } from "../functions/_lib/nitrado";

type LinkedServerRow = {
  id: string;
  user_id: string;
  guild_id: string | null;
  public_slug: string | null;
  nitrado_service_id: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  adm_path: string | null;
};

type TokenRow = {
  encrypted_token: string;
  token_iv: string;
  token_auth_tag: string;
};

type SavedStateRow = {
  newest_available_adm_filename: string | null;
  newest_readable_adm_filename: string | null;
  last_adm_discovery_check_at: string | null;
  next_adm_discovery_due_at: string | null;
  last_processed_file: string | null;
};

const target = process.argv[2] ?? process.env.DZN_SERVER_SLUG ?? "pandora-dayz";
const knownLatest = process.env.DZN_EXPECTED_ADM_FILE ?? "DayZServer_PS4_x64_2026-05-20_08-02-52.ADM";

main().catch((error) => {
  console.error("ADM discovery debug failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  console.log("\nDZN ADM Discovery Debug");
  console.log("=======================");
  console.log(`Target: ${target}`);
  console.log(`Expected latest file: ${knownLatest}`);

  const server = await findLinkedServer(target);
  const state = await getSavedState(server);
  printSavedState(server, state);

  const token = await loadNitradoToken(server);
  if (!token) {
    console.log("");
    console.log("WARN Live Nitrado discovery was not run because no local token source is available.");
    console.log("     Set NITRADO_TOKEN directly or TOKEN_ENCRYPTION_KEY so this script can decrypt the stored token.");
    console.log("     Production dashboard endpoint: /api/servers/[serverId]/adm-file-discovery/debug");
    return;
  }

  const debug = await debugNitradoAdmFileDiscovery(token, String(server.nitrado_service_id), {
    preferredAdmFileName: state?.newest_available_adm_filename ?? state?.last_processed_file ?? undefined,
    preferredAdmPath: server.adm_path,
    previousLatestAdmFileName: state?.newest_available_adm_filename ?? state?.last_processed_file ?? undefined,
    knownLatestFileName: knownLatest,
    sampleLimit: 12,
  });

  console.log("");
  console.log("Nitrado discovery result");
  console.log(`service id: ${debug.service_id}`);
  console.log(`username: ${debug.username ?? "not found"}`);
  console.log(`server name: ${debug.server_name ?? "unknown"}`);
  console.log(`raw game_specific.log_files count: ${debug.log_files_raw_count}`);
  console.log(`game_specific ADM candidates: ${debug.game_specific_adm_count}`);
  console.log(`file browser ADM candidates: ${debug.file_browser_adm_count}`);
  console.log(`merged ADM candidates: ${debug.merged_adm_count}`);
  console.log(`readable ADM candidates: ${debug.readable_adm_count}`);
  console.log(`unreadable ADM candidates: ${debug.unreadable_adm_count}`);
  console.log(`newest by filename: ${debug.newest_by_filename?.name ?? "none"}`);
  console.log(`newest by modified time: ${debug.newest_by_modified?.name ?? "none"}`);
  console.log(`selected newest available: ${debug.selected_newest_available?.name ?? "none"}`);
  console.log(`selected newest readable: ${debug.selected_newest_readable?.name ?? "none"}`);
  console.log(`known latest present: ${debug.known_latest_file_present === null ? "not checked" : debug.known_latest_file_present ? "yes" : "no"}`);
  if (debug.problem_flags.length) {
    console.log(`problem flags: ${debug.problem_flags.join(", ")}`);
  }

  console.log("");
  console.log("Top ADM candidates");
  for (const candidate of debug.adm_candidates.slice(0, 20)) {
    console.log([
      candidate.selected_as_newest_available ? "*" : "-",
      candidate.name,
      `parsed=${candidate.parsed_timestamp ?? "unknown"}`,
      `modified=${candidate.modified_at ?? "unknown"}`,
      `read=${candidate.sample_read_attempted ? candidate.sample_read_success ? `ok:${candidate.selected_read_method}` : `fail:${candidate.sample_read_error ?? candidate.readable_sample_status}` : "not_sampled"}`,
      `seek=${candidate.seek_sample_attempted ? candidate.seek_sample_error ?? candidate.seek_sample_status : "not_attempted"}`,
      `download=${candidate.download_fallback_attempted ? candidate.download_fallback_error ?? candidate.download_fallback_status : "not_attempted"}`,
      `selectedPath=${candidate.selected_successful_path ?? "none"}`,
      `sources=${candidate.sources.join("+") || "unknown"}`,
      `path=${candidate.path}`,
    ].join(" "));
    for (const attempt of candidate.attempted_paths ?? []) {
      console.log(`  download-path ${attempt.fileFetchOk ? "ok" : "fail"} token=${attempt.tokenRequestOk ? "ok" : "fail"} ${attempt.path}${attempt.error ? ` (${attempt.error})` : ""}`);
    }
  }

  if (debug.known_latest_file_present === false) {
    console.log("");
    console.log("WARN nitrado_api_log_files_stale_or_missing: the expected ADM file was not present in DZN's Nitrado candidate list.");
    process.exitCode = 1;
  } else if (debug.selected_newest_available?.name !== debug.newest_by_filename?.name) {
    console.log("");
    console.log("WARN Newest available does not match newest filename sort.");
    process.exitCode = 1;
  }
}

async function findLinkedServer(value: string) {
  const rows = runWranglerQuery<LinkedServerRow>(
    `SELECT id, user_id, guild_id, public_slug, nitrado_service_id, display_name,
            hostname, server_name, nitrado_service_name,
            (SELECT adm_path FROM server_log_config WHERE linked_server_id = linked_servers.id LIMIT 1) AS adm_path
     FROM linked_servers
     WHERE public_slug = ${sql(value)}
        OR id = ${sql(value)}
        OR CAST(nitrado_service_id AS TEXT) = ${sql(value)}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row?.id) throw new Error(`No linked server matched ${value}.`);
  if (!row.nitrado_service_id) throw new Error(`Linked server ${row.id} has no Nitrado service id.`);
  return row;
}

async function getSavedState(server: LinkedServerRow) {
  const rows = runWranglerQuery<SavedStateRow>(
    `SELECT server_sync_state.newest_available_adm_filename,
            server_sync_state.newest_readable_adm_filename,
            server_sync_state.last_adm_discovery_check_at,
            server_sync_state.next_adm_discovery_due_at,
            adm_sync_state.last_processed_file
     FROM linked_servers
     LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
     LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
     WHERE linked_servers.id = ${sql(server.id)}
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

async function loadNitradoToken(server: LinkedServerRow) {
  const direct = process.env.NITRADO_TOKEN?.trim();
  if (direct) return direct;

  const tokenEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!tokenEncryptionKey) return null;

  const rows = runWranglerQuery<TokenRow>(
    `SELECT encrypted_token, token_iv, token_auth_tag
     FROM nitrado_connections
     WHERE user_id = ${sql(server.user_id)}
       AND linked_server_id = ${sql(server.id)}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row?.encrypted_token || !row.token_iv || !row.token_auth_tag) return null;
  return decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag, tokenEncryptionKey);
}

function printSavedState(server: LinkedServerRow, state: SavedStateRow | null) {
  console.log(`server id: ${server.id}`);
  console.log(`public slug: ${server.public_slug ?? "missing"}`);
  console.log(`service id: ${server.nitrado_service_id ?? "missing"}`);
  console.log(`server name: ${server.display_name ?? server.hostname ?? server.server_name ?? server.nitrado_service_name ?? "unknown"}`);
  console.log(`saved newest available: ${state?.newest_available_adm_filename ?? "none"}`);
  console.log(`saved newest readable: ${state?.newest_readable_adm_filename ?? "none"}`);
  console.log(`last discovery check: ${state?.last_adm_discovery_check_at ?? "none"}`);
  console.log(`next discovery due: ${state?.next_adm_discovery_due_at ?? "now"}`);
  console.log(`last processed ADM: ${state?.last_processed_file ?? "none"}`);
}

function runWranglerQuery<T>(query: string): T[] {
  const compact = query.replace(/\s+/g, " ").trim();
  const output = execSync(`npx wrangler d1 execute dzn_network_db --remote --json --command "${compact.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output) as Array<{ results?: T[] }>;
  return parsed.flatMap((item) => item.results ?? []);
}

function sql(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
