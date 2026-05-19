import { execSync } from "node:child_process";
import { getAdmDiscoveryIntervalMinutes, getAdmPullInterval, getServerStatusInterval, normalizePlanKey } from "../functions/_lib/plans";

type ServerDueRow = {
  id: string;
  guild_id: string | null;
  public_slug: string | null;
  nitrado_service_id: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  plan_key: string | null;
  subscription_status: string | null;
  next_status_check_due_at: string | null;
  next_adm_discovery_due_at: string | null;
  next_adm_pull_due_at: string | null;
  currently_checking_status: number | null;
  currently_syncing_adm: number | null;
  updated_at: string | null;
};

const target = process.argv[2] ?? process.env.DZN_SERVER_SLUG ?? "pandora-dayz";

function runWranglerQuery<T>(sql: string): T[] {
  const compactSql = sql.replace(/\s+/g, " ").trim();
  const output = execSync(`npx wrangler d1 execute dzn_network_db --remote --json --command "${compactSql.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output) as Array<{ results?: T[] }>;
  return parsed.flatMap((item) => item.results ?? []);
}

function sqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function ageMinutes(value: string | null | undefined) {
  if (!value) return null;
  const age = Date.now() - Date.parse(value);
  return Number.isFinite(age) ? Math.max(0, Math.round(age / 60000)) : null;
}

function isDue(value: string | null | undefined) {
  if (!value) return true;
  const ms = Date.parse(value);
  return !Number.isFinite(ms) || ms <= Date.now();
}

function skippedReason(row: ServerDueRow) {
  if (!row.guild_id) return "missing_guild_id";
  if (!row.nitrado_service_id) return "missing_nitrado_token";
  if (!["active", "trialing"].includes((row.subscription_status ?? "").toLowerCase())) return "no_active_subscription";
  if (Number(row.currently_checking_status ?? 0) === 1) return "currently_checking_status";
  if (Number(row.currently_syncing_adm ?? 0) === 1) return "currently_syncing_adm";
  if (isDue(row.next_status_check_due_at) || isDue(row.next_adm_discovery_due_at) || isDue(row.next_adm_pull_due_at)) return "due";
  return "not_due";
}

const rows = runWranglerQuery<ServerDueRow>(
  `SELECT linked_servers.id, linked_servers.guild_id, linked_servers.public_slug,
          linked_servers.nitrado_service_id, linked_servers.display_name,
          linked_servers.hostname, linked_servers.server_name,
          server_subscriptions.plan_key, server_subscriptions.status AS subscription_status,
          server_sync_state.next_status_check_due_at,
          server_sync_state.next_adm_discovery_due_at,
          server_sync_state.next_adm_pull_due_at,
          server_sync_state.currently_checking_status,
          server_sync_state.currently_syncing_adm,
          server_sync_state.updated_at
   FROM linked_servers
   LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
   LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
   WHERE linked_servers.public_slug = ${sqlLiteral(target)}
      OR linked_servers.nitrado_service_id = ${sqlLiteral(target)}
      OR linked_servers.id = ${sqlLiteral(target)}
   LIMIT 5`,
);

console.log("\nDZN Server Due State Check");
console.log("==========================");
console.log(`Target: ${target}`);

if (!rows.length) {
  console.log("FAIL No linked server matched the target.");
  process.exitCode = 1;
} else {
  for (const row of rows) {
    const plan = normalizePlanKey(row.plan_key);
    const serverName = row.display_name || row.hostname || row.server_name || row.public_slug || row.id;
    console.log(`\nServer: ${serverName}`);
    console.log(`server id: ${row.id}`);
    console.log(`guild id: ${row.guild_id ?? "missing"}`);
    console.log(`public slug: ${row.public_slug ?? "missing"}`);
    console.log(`nitrado service id: ${row.nitrado_service_id ?? "missing"}`);
    console.log(`subscription: ${plan} / ${row.subscription_status ?? "unknown"}`);
    console.log(`intervals: status ${getServerStatusInterval(plan)}m, ADM discovery ${getAdmDiscoveryIntervalMinutes(plan)}m, ADM processing ${getAdmPullInterval(plan)}m`);
    console.log(`next status due: ${row.next_status_check_due_at ?? "now"} (${isDue(row.next_status_check_due_at) ? "due" : "not due"})`);
    console.log(`next ADM discovery due: ${row.next_adm_discovery_due_at ?? "now"} (${isDue(row.next_adm_discovery_due_at) ? "due" : "not due"})`);
    console.log(`next ADM processing due: ${row.next_adm_pull_due_at ?? "now"} (${isDue(row.next_adm_pull_due_at) ? "due" : "not due"})`);
    console.log(`currently checking status: ${Number(row.currently_checking_status ?? 0) === 1}`);
    console.log(`currently syncing ADM: ${Number(row.currently_syncing_adm ?? 0) === 1}`);
    console.log(`lock/update age: ${ageMinutes(row.updated_at) ?? "unknown"} minutes`);
    console.log(`planner reason: ${skippedReason(row)}`);
  }
}
