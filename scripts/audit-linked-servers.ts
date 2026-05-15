import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DATABASE_NAME = "dzn_network_db";

type LinkedServerAuditRow = Record<string, unknown> & {
  id: string;
  user_id?: string | null;
  owner_user_id?: string | null;
  discord_guild_id?: string | null;
  guild_id?: string | null;
  guild_name?: string | null;
  nitrado_service_id?: string | null;
  service_id?: string | null;
  display_name?: string | null;
  hostname?: string | null;
  server_name?: string | null;
  nitrado_service_name?: string | null;
  public_slug?: string | null;
  server_mode?: string | null;
  server_type?: string | null;
  status?: string | null;
  is_deleted?: number | null;
  deleted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata_last_checked_at?: string | null;
  total_kills?: number | null;
};

const args = parseArgs(process.argv.slice(2));
const search = stringArg(args, "search")?.toLowerCase() ?? null;
const serviceId = stringArg(args, "service-id") ?? null;
const restorePublic = Boolean(args.get("restore-public"));
const restoreServerId = stringArg(args, "server-id");

main().catch((error) => {
  console.error("Linked server audit failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  if (restorePublic) {
    if (!restoreServerId) fail("Missing --server-id for --restore-public.");
    await restorePublicListing(restoreServerId);
  }

  const rows = await listLinkedServers();
  const filtered = rows.filter((row) => {
    if (serviceId && String(row.nitrado_service_id ?? row.service_id ?? "") !== serviceId) return false;
    if (!search) return true;
    return [
      row.id,
      row.guild_name,
      row.guild_id,
      row.discord_guild_id,
      row.nitrado_service_id,
      row.service_id,
      row.display_name,
      row.hostname,
      row.server_name,
      row.nitrado_service_name,
      row.public_slug,
      row.server_mode,
      row.server_type,
      row.status,
    ].some((value) => String(value ?? "").toLowerCase().includes(search));
  });

  console.log(`Linked servers found: ${filtered.length}`);
  console.table(filtered.map(toAuditOutput));
}

async function listLinkedServers() {
  return d1Query<LinkedServerAuditRow>(
    `SELECT
       linked_servers.*,
       discord_guilds.name AS guild_name,
       COALESCE(server_stats.total_kills, (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS total_kills
     FROM linked_servers
     LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
     LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
     ORDER BY linked_servers.updated_at DESC, linked_servers.created_at DESC`,
  );
}

async function restorePublicListing(serverId: string) {
  const rows = await d1Query<LinkedServerAuditRow>(`SELECT * FROM linked_servers WHERE id = ${sqlString(serverId)} LIMIT 1`);
  const server = rows[0];
  if (!server) fail(`No linked server found for id: ${serverId}`);
  const slug = typeof server.public_slug === "string" && server.public_slug.trim()
    ? server.public_slug
    : toPublicSlug(firstString(server.display_name, server.hostname, server.server_name, server.nitrado_service_name, server.guild_id) ?? "dayz-server");
  const columns = await getColumns("linked_servers");
  const optionalAssignments = [
    columns.has("is_deleted") ? "is_deleted = 0" : null,
    columns.has("deleted_at") ? "deleted_at = NULL" : null,
    columns.has("public_listing_active") ? "public_listing_active = 1" : null,
  ].filter(Boolean);

  await d1Execute(
    `UPDATE linked_servers
     SET status = 'live',
         public_slug = COALESCE(NULLIF(public_slug, ''), ${sqlString(slug)}),
         ${optionalAssignments.length ? `${optionalAssignments.join(",\n         ")},` : ""}
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ${sqlString(serverId)}`,
  );
  console.log(`Restored public listing for linked server ${serverId}.`);
}

async function getColumns(table: string) {
  const rows = await d1Query<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

function toAuditOutput(row: LinkedServerAuditRow) {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id ?? row.user_id ?? null,
    discord_guild_id: row.discord_guild_id ?? row.guild_id ?? null,
    guild_name: row.guild_name ?? null,
    nitrado_service_id: row.nitrado_service_id ?? row.service_id ?? null,
    display_name: row.display_name ?? row.server_name ?? row.nitrado_service_name ?? null,
    hostname: row.hostname ?? null,
    slug: row.public_slug ?? null,
    server_mode: row.server_mode ?? row.server_type ?? null,
    status: row.status ?? null,
    is_deleted: row.is_deleted ?? null,
    deleted_at: row.deleted_at ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    metadata_last_checked_at: row.metadata_last_checked_at ?? null,
    total_kills: Number(row.total_kills ?? 0),
  };
}

async function d1Query<T>(sqlCommand: string): Promise<T[]> {
  const output = runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--json", "--command", sqlCommand]);
  const payload = parseWranglerJson(output);
  const first = payload[0];
  if (!first?.success) fail(`D1 query failed: ${sqlCommand}`);
  return (first.results ?? []) as T[];
}

async function d1Execute(sqlCommand: string) {
  const output = runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--json", "--command", sqlCommand]);
  const payload = parseWranglerJson(output);
  const first = payload[0];
  if (!first?.success) fail(`D1 execute failed: ${sqlCommand}`);
}

function runWrangler(args: string[]) {
  const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerBin)) fail("Wrangler is not installed locally. Run npm install, then try again.");
  return execFileSync(process.execPath, [wranglerBin, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  } satisfies ExecFileSyncOptionsWithStringEncoding);
}

function parseWranglerJson(output: string) {
  try {
    return JSON.parse(output) as Array<{ success: boolean; results?: unknown[] }>;
  } catch {
    fail(`Unable to parse Wrangler JSON output:\n${output}`);
  }
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

function stringArg(args: Map<string, string | true>, key: string) {
  const value = args.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function toPublicSlug(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || `server-${Date.now()}`;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function fail(message: string): never {
  throw new Error(message);
}
