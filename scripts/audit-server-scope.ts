/**
 * LOCAL SERVER SCOPE AUDIT SCRIPT
 *
 * Reports suspicious ADM/server-scope data only. It never writes data.
 */

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DATABASE_NAME = "dzn_network_db";

type LinkedServerRow = {
  id: string;
  public_slug: string | null;
  nitrado_service_id: string | null;
  server_name: string | null;
  display_name: string | null;
  hostname: string | null;
  nitrado_service_name: string | null;
  status: string | null;
};

type Finding = {
  check: string;
  severity: "info" | "warning" | "error";
  count: number;
  detail: string;
};

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args.get("dry-run"));
const slugFilter = stringArg(args, "slug");
const serviceIdFilter = stringArg(args, "service-id");
if (!dryRun) fail("This audit is report-only. Run with --dry-run.");

main().catch((error) => {
  console.error("Server scope audit failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const [killColumns, playerEventColumns, rawColumns, profileColumns, statsColumns, syncRunColumns] = await Promise.all([
    getColumns("kill_events"),
    getColumns("player_events"),
    getColumns("adm_raw_events"),
    getColumns("player_profiles"),
    getColumns("server_stats"),
    getColumns("sync_runs"),
  ]);

  const scope = await resolveScope();
  const serverClause = scope ? `AND linked_servers.id = ${sqlString(scope.id)}` : "";
  const directServerClause = scope ? `AND linked_server_id = ${sqlString(scope.id)}` : "";

  const findings: Finding[] = [];

  findings.push(...missingColumnFindings({
    kill_events: killColumns,
    player_events: playerEventColumns,
    adm_raw_events: rawColumns,
    player_profiles: profileColumns,
    server_stats: statsColumns,
    sync_runs: syncRunColumns,
  }));

  findings.push(await countFinding("missing kill_events linked_server_id", "error",
    `SELECT COUNT(*) AS count FROM kill_events WHERE linked_server_id IS NULL OR linked_server_id = '' ${directServerClause}`));
  findings.push(await countFinding("missing player_events linked_server_id", "error",
    `SELECT COUNT(*) AS count FROM player_events WHERE linked_server_id IS NULL OR linked_server_id = '' ${directServerClause}`));
  findings.push(await countFinding("missing adm_raw_events linked_server_id", "error",
    `SELECT COUNT(*) AS count FROM adm_raw_events WHERE linked_server_id IS NULL OR linked_server_id = '' ${directServerClause}`));

  if (killColumns.has("source_service_id")) {
    findings.push(await countFinding("kill_events service mismatch", "error",
      `SELECT COUNT(*) AS count
       FROM kill_events
       INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
       WHERE kill_events.source_service_id IS NOT NULL
         AND linked_servers.nitrado_service_id IS NOT NULL
         AND kill_events.source_service_id != linked_servers.nitrado_service_id
         ${serverClause}`));
  }
  if (playerEventColumns.has("source_service_id")) {
    findings.push(await countFinding("player_events service mismatch", "error",
      `SELECT COUNT(*) AS count
       FROM player_events
       INNER JOIN linked_servers ON linked_servers.id = player_events.linked_server_id
       WHERE player_events.source_service_id IS NOT NULL
         AND linked_servers.nitrado_service_id IS NOT NULL
         AND player_events.source_service_id != linked_servers.nitrado_service_id
         ${serverClause}`));
  }
  if (rawColumns.has("source_service_id")) {
    findings.push(await countFinding("adm_raw_events service mismatch", "error",
      `SELECT COUNT(*) AS count
       FROM adm_raw_events
       INNER JOIN linked_servers ON linked_servers.id = adm_raw_events.linked_server_id
       WHERE adm_raw_events.source_service_id IS NOT NULL
         AND linked_servers.nitrado_service_id IS NOT NULL
         AND adm_raw_events.source_service_id != linked_servers.nitrado_service_id
         ${serverClause}`));
  }

  findings.push(await countFinding("duplicate active linked server service ids", "error",
    `SELECT COUNT(*) AS count
     FROM (
       SELECT nitrado_service_id
       FROM linked_servers
       WHERE nitrado_service_id IS NOT NULL
         AND nitrado_service_id != ''
         AND lower(COALESCE(status, 'pending')) NOT IN ('merged', 'deleted')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       GROUP BY nitrado_service_id
       HAVING COUNT(*) > 1
     )`));

  findings.push(await countFinding("same raw PvP kill attached to multiple servers", "error",
    `SELECT COUNT(*) AS count
     FROM (
       SELECT lower(trim(raw_line)) AS raw_key
       FROM kill_events
       WHERE raw_line IS NOT NULL
         AND raw_line LIKE '%killed by Player%'
       GROUP BY raw_key
       HAVING COUNT(DISTINCT linked_server_id) > 1
     )`));

  const fileColumn = killColumns.has("source_adm_file") ? "source_adm_file" : "adm_file";
  const lineColumn = killColumns.has("source_line_number") ? "source_line_number" : "line_number";
  const serviceColumn = killColumns.has("source_service_id")
    ? "source_service_id"
    : "(SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = kill_events.linked_server_id)";
  findings.push(await countFinding("duplicate ADM file line within same service", "error",
    `SELECT COUNT(*) AS count
     FROM (
       SELECT ${serviceColumn} AS service_id, ${fileColumn} AS adm_file, ${lineColumn} AS line_number
       FROM kill_events
       WHERE ${fileColumn} IS NOT NULL AND ${lineColumn} IS NOT NULL
       GROUP BY service_id, adm_file, line_number
       HAVING COUNT(*) > 1
     )`));

  findings.push(await countFinding("server_stats total_kills mismatch", "error",
    `SELECT COUNT(*) AS count
     FROM server_stats
     INNER JOIN linked_servers ON linked_servers.id = server_stats.linked_server_id
     WHERE COALESCE(server_stats.total_kills, 0) != (
       SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = server_stats.linked_server_id
     )
     ${serverClause}`));

  const filteredFindings = findings.filter((finding) => finding.count > 0 || finding.severity === "info");
  console.log("DZN server scope audit.");
  if (scope) {
    console.log(`Scope: ${serverDisplayName(scope)} (${scope.public_slug ?? scope.id}, service ${scope.nitrado_service_id ?? "unknown"})`);
  } else {
    console.log("Scope: all linked servers");
  }
  console.log("");
  if (!filteredFindings.length) {
    console.log("No server scope issues found.");
  } else {
    console.table(filteredFindings);
  }
  console.log("DZN SERVER SCOPE AUDIT COMPLETE");
}

async function resolveScope() {
  if (!slugFilter && !serviceIdFilter) return null;
  const rows = await d1Query<LinkedServerRow>(
    `SELECT *
     FROM linked_servers
     WHERE lower(COALESCE(status, 'pending')) NOT IN ('merged', 'deleted')
       AND (merged_into_server_id IS NULL OR merged_into_server_id = '')`,
  );
  if (serviceIdFilter) {
    return rows.find((row) => row.nitrado_service_id === serviceIdFilter) ?? fail(`No active linked server found for service id ${serviceIdFilter}`);
  }
  const slug = sanitizeSlug(slugFilter);
  return rows.find((row) => sanitizeSlug(row.public_slug) === slug || slugCandidates(row).has(slug)) ?? fail(`No active linked server found for slug ${slugFilter}`);
}

function missingColumnFindings(tables: Record<string, Set<string>>) {
  const expected: Record<string, string[]> = {
    kill_events: ["linked_server_id", "source_service_id", "source_adm_file", "source_line_number"],
    player_events: ["linked_server_id", "source_service_id", "source_adm_file", "source_line_number"],
    adm_raw_events: ["linked_server_id", "source_service_id", "source_adm_file", "source_line_number"],
    player_profiles: ["linked_server_id", "source_service_id"],
    server_stats: ["linked_server_id", "source_service_id"],
    sync_runs: ["linked_server_id", "source_service_id"],
  };
  const findings: Finding[] = [];
  for (const [table, columns] of Object.entries(expected)) {
    const missing = columns.filter((column) => !tables[table]?.has(column));
    if (missing.length) {
      findings.push({
        check: `${table} missing scope columns`,
        severity: "error",
        count: missing.length,
        detail: missing.join(", "),
      });
    }
  }
  return findings;
}

async function countFinding(check: string, severity: Finding["severity"], sqlCommand: string): Promise<Finding> {
  const row = (await d1Query<{ count: number }>(sqlCommand))[0];
  return {
    check,
    severity,
    count: Number(row?.count ?? 0),
    detail: Number(row?.count ?? 0) ? "Review required" : "OK",
  };
}

async function getColumns(table: string) {
  const rows = await d1Query<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

async function d1Query<T>(sqlCommand: string): Promise<T[]> {
  const output = runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--json", "--command", sqlCommand]);
  const payload = JSON.parse(output) as Array<{ success: boolean; results?: unknown[] }>;
  const first = payload[0];
  if (!first?.success) fail(`D1 query failed: ${sqlCommand}`);
  return (first.results ?? []) as T[];
}

function runWrangler(args: string[]) {
  return runWranglerNode(args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
}

function runWranglerNode(args: string[], options: ExecFileSyncOptionsWithStringEncoding) {
  const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerBin)) fail("Wrangler is not installed locally. Run npm install, then try again.");
  return execFileSync(process.execPath, [wranglerBin, ...args], {
    ...options,
    encoding: "utf8",
  });
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

function slugCandidates(server: LinkedServerRow) {
  const candidates = new Set<string>();
  for (const value of [server.public_slug, server.display_name, server.hostname, server.server_name, server.nitrado_service_name]) {
    if (!value) continue;
    const normalized = value.trim().toLowerCase();
    candidates.add(normalized.replace(/[^a-z0-9]/g, "").slice(0, 90));
    candidates.add(normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90));
    candidates.add(normalized.replace(/[^a-z0-9-]/g, "").slice(0, 90));
  }
  candidates.delete("");
  return candidates;
}

function sanitizeSlug(value: string | null | undefined) {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 90);
}

function serverDisplayName(server: LinkedServerRow) {
  return [server.display_name, server.hostname, server.server_name, server.nitrado_service_name].find((value) => value?.trim()) ?? server.id;
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function fail(message: string): never {
  throw new Error(message);
}
