import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DATABASE_NAME = "dzn_network_db";

type LinkedServerHealthRow = {
  id: string;
  display_name: string | null;
  server_name: string | null;
  hostname: string | null;
  nitrado_service_name: string | null;
  nitrado_service_id: string | null;
  current_players: number | null;
  max_players: number | null;
  player_count_last_checked_at: string | null;
  player_count_status: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  latest_adm_file: string | null;
  last_processed_file: string | null;
  last_processed_line: number | null;
  last_sync_at: string | null;
  total_kills: number | null;
};

type FileStateRow = {
  adm_file: string;
  status: string;
  line_count: number | null;
  raw_kill_lines_found: number | null;
  parsed_kill_lines_found: number | null;
  inserted_kills: number | null;
  parser_skipped_lines: number | null;
  retry_count: number | null;
  last_error: string | null;
  updated_at: string | null;
};

const args = parseArgs(process.argv.slice(2));
const serviceId = stringArg(args, "service-id");

main().catch((error) => {
  console.error("ADM health audit failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const rows = await d1Query<LinkedServerHealthRow>(
    `SELECT linked_servers.id, linked_servers.display_name, linked_servers.server_name, linked_servers.hostname,
            linked_servers.nitrado_service_name, linked_servers.nitrado_service_id,
            linked_servers.current_players, linked_servers.max_players,
            linked_servers.player_count_last_checked_at, linked_servers.player_count_status,
            adm_sync_state.last_sync_status, adm_sync_state.last_sync_message,
            adm_sync_state.latest_adm_file, adm_sync_state.last_processed_file,
            adm_sync_state.last_processed_line, adm_sync_state.last_sync_at,
            server_stats.total_kills
     FROM linked_servers
     LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
     LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
     WHERE linked_servers.nitrado_service_id IS NOT NULL
       ${serviceId ? `AND CAST(linked_servers.nitrado_service_id AS TEXT) = ${sql(serviceId)}` : ""}
     ORDER BY linked_servers.updated_at DESC`,
  );

  console.log("DZN ADM health audit dry run.");
  console.log("No tokens or secrets are printed.");
  console.log("");

  for (const server of rows) {
    const name = firstString(server.display_name, server.hostname, server.server_name, server.nitrado_service_name) ?? server.id;
    const fileStates = await getFileStates(server.id);
    const queued = fileStates.filter((file) => ["unreadable", "parser_error", "write_error", "partial", "discovered"].includes(file.status));
    console.log(`Server: ${name}`);
    console.log(`Service ID: ${server.nitrado_service_id ?? "unknown"}`);
    console.log(`Live players: ${formatPlayerFraction(server.current_players, server.max_players)}`);
    console.log(`Player count last checked: ${server.player_count_last_checked_at ?? "never"}`);
    console.log(`Player count status: ${server.player_count_status ?? "unknown"}${isPlayerCountStale(server.player_count_last_checked_at) ? " (stale)" : ""}`);
    console.log(`Status: ${server.last_sync_status ?? "not_started"}`);
    console.log(`Latest ADM discovered: ${server.latest_adm_file ?? "none"}`);
    console.log(`Latest ADM processed: ${server.last_processed_file ?? "none"} line ${server.last_processed_line ?? 0}`);
    console.log(`Last sync attempt: ${server.last_sync_at ?? "never"}`);
    console.log(`Total kills: ${server.total_kills ?? 0}`);
    console.log(`Queued/unprocessed ADM files: ${queued.length}`);
    for (const file of queued.slice(0, 8)) {
      console.log(`- ${file.adm_file} [${file.status}] raw kills ${file.raw_kill_lines_found ?? 0}, parsed ${file.parsed_kill_lines_found ?? 0}, inserted ${file.inserted_kills ?? 0}, retries ${file.retry_count ?? 0}`);
      if (file.last_error) console.log(`  reason: ${file.last_error}`);
    }
    console.log("");
  }

  if (!rows.length) console.log(serviceId ? `No linked server found for service id ${serviceId}.` : "No linked servers with Nitrado service IDs found.");
}

async function getFileStates(linkedServerId: string) {
  return d1Query<FileStateRow>(
    `SELECT adm_file, status, line_count, raw_kill_lines_found, parsed_kill_lines_found,
            inserted_kills, parser_skipped_lines, retry_count, last_error, updated_at
     FROM adm_sync_file_state
     WHERE linked_server_id = ${sql(linkedServerId)}
       AND ignored_at IS NULL
     ORDER BY adm_file DESC
     LIMIT 20`,
  ).catch(() => []);
}

function parseArgs(values: string[]) {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function stringArg(values: Map<string, string | true>, key: string) {
  const value = values.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function d1Query<T>(sqlCommand: string): Promise<T[]> {
  const output = runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--json", "--yes", "--command", sqlCommand]);
  const payload = parseWranglerJson(output);
  const first = payload[0];
  if (!first?.success) throw new Error(`D1 query failed: ${sqlCommand}`);
  return (first.results ?? []) as T[];
}

function runWrangler(args: string[]) {
  const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerBin)) throw new Error("Wrangler is not installed locally. Run npm install, then try again.");
  return execFileSync(process.execPath, [wranglerBin, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  } satisfies ExecFileSyncOptionsWithStringEncoding);
}

function parseWranglerJson(output: string): Array<{ success: boolean; results?: unknown[] }> {
  const jsonStart = output.indexOf("[");
  if (jsonStart < 0) throw new Error("Wrangler did not return JSON output.");
  return JSON.parse(output.slice(jsonStart));
}

function firstString(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

function formatPlayerFraction(current: number | null, max: number | null) {
  const currentValue = typeof current === "number" && Number.isFinite(current) ? current : null;
  const maxValue = typeof max === "number" && Number.isFinite(max) ? max : null;
  if (currentValue !== null && maxValue !== null) return `${currentValue} / ${maxValue}`;
  if (currentValue !== null) return `${currentValue} online`;
  if (maxValue !== null) return `${maxValue} slots`;
  return "unknown";
}

function isPlayerCountStale(value: string | null) {
  if (!value) return true;
  const checkedAt = Date.parse(value);
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt > 15 * 60 * 1000;
}

function sql(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}
