import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DATABASE_NAME = "dzn_network_db";

type PlayerCountAuditRow = {
  id: string;
  display_name: string | null;
  server_name: string | null;
  hostname: string | null;
  nitrado_service_name: string | null;
  nitrado_service_id: string | null;
  current_players: number | null;
  max_players: number | null;
  player_count_last_checked_at: string | null;
  player_count_source: string | null;
  player_count_status: string | null;
  metadata_last_checked_at: string | null;
};

const args = parseArgs(process.argv.slice(2));
const serviceId = stringArg(args, "service-id");

main().catch((error) => {
  console.error("Player count audit failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const rows = await d1Query<PlayerCountAuditRow>(
    `SELECT id, display_name, server_name, hostname, nitrado_service_name, nitrado_service_id,
            current_players, max_players, player_count_last_checked_at, player_count_source,
            player_count_status, metadata_last_checked_at
     FROM linked_servers
     WHERE nitrado_service_id IS NOT NULL
       AND nitrado_service_id != ''
       ${serviceId ? `AND CAST(nitrado_service_id AS TEXT) = ${sql(serviceId)}` : ""}
     ORDER BY COALESCE(player_count_last_checked_at, metadata_last_checked_at, '1970-01-01T00:00:00.000Z') ASC,
              updated_at DESC`,
  );

  console.log("DZN player count audit dry run.");
  console.log("No Nitrado tokens or secrets are printed.");
  console.log("");

  for (const server of rows) {
    const name = firstString(server.display_name, server.hostname, server.server_name, server.nitrado_service_name) ?? server.id;
    const stale = isPlayerCountStale(server.player_count_last_checked_at);
    console.log(`Server: ${name}`);
    console.log(`Service ID: ${server.nitrado_service_id ?? "unknown"}`);
    console.log(`Current players: ${formatPlayerFraction(server.current_players, server.max_players)}`);
    console.log(`Player count status: ${server.player_count_status ?? "unknown"}${stale ? " (stale)" : ""}`);
    console.log(`Player count source: ${server.player_count_source ?? "unknown"}`);
    console.log(`Player count last checked: ${server.player_count_last_checked_at ?? "never"}`);
    console.log(`Metadata last checked: ${server.metadata_last_checked_at ?? "never"}`);
    console.log(`Last known count age: ${server.player_count_last_checked_at ? formatAge(server.player_count_last_checked_at) : "unknown"}`);
    console.log(`Nitrado returned current player count: ${server.player_count_status === "fresh" ? "yes" : "no"}`);
    console.log(`Recommended action: ${recommendedPlayerCountAction(server)}`);
    console.log("");
  }

  if (!rows.length) console.log(serviceId ? `No linked server found for service id ${serviceId}.` : "No linked servers with Nitrado service IDs found.");
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
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt > 10 * 60 * 1000;
}

function formatAge(value: string) {
  const checkedAt = Date.parse(value);
  if (!Number.isFinite(checkedAt)) return "unknown";
  const minutes = Math.max(0, Math.round((Date.now() - checkedAt) / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function recommendedPlayerCountAction(server: PlayerCountAuditRow) {
  if (server.player_count_status === "fresh" && !isPlayerCountStale(server.player_count_last_checked_at)) {
    return "No action. Live Nitrado player count is fresh.";
  }
  if (server.player_count_status === "unavailable") {
    return "Nitrado metadata was unavailable or token/service access failed. DZN will retry automatically.";
  }
  if (!server.player_count_last_checked_at) {
    return "Wait for the scheduled metadata sync or run the metadata cron endpoint manually.";
  }
  return "Scheduled metadata sync should refresh this automatically; verify Nitrado is returning player count fields if it remains stale.";
}

function sql(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}
