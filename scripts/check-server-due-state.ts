import { execSync } from "node:child_process";
import { getAdmDiscoveryIntervalMinutes, getAdmPullInterval, getServerStatusInterval, normalizePlanKey } from "../functions/_lib/plans";
import { NUKETOWN_SHOWCASE_SCOPE } from "../functions/_lib/server-showcase-access";
import {
  canRunServerLifecycleTask,
  SERVER_LIFECYCLE_STATUSES,
  serverLifecycleSqlExpression,
  type ServerLifecycleTask,
} from "../lib/server-lifecycle";

type ServerDueRow = {
  id: string;
  guild_id: string | null;
  public_slug: string | null;
  nitrado_service_id: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  linked_status: string | null;
  lifecycle_status: string | null;
  merged_into_server_id: string | null;
  final_sync_attempted_at: string | null;
  plan_key: string | null;
  subscription_status: string | null;
  complimentary_automation_access: number | null;
  next_status_check_due_at: string | null;
  next_adm_discovery_due_at: string | null;
  next_adm_pull_due_at: string | null;
  next_retry_after: string | null;
  currently_checking_status: number | null;
  currently_syncing_adm: number | null;
  status_sync_started_at: string | null;
  adm_sync_started_at: string | null;
  last_adm_pull_at: string | null;
  last_adm_sync_at: string | null;
  updated_at: string | null;
};

const ADM_MIN_SYNC_INTERVAL_MS = 10 * 60 * 1000;
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

function lockAge(row: ServerDueRow, type: "status" | "adm") {
  return ageMinutes(type === "status"
    ? row.status_sync_started_at ?? row.updated_at
    : row.adm_sync_started_at ?? row.last_adm_pull_at ?? row.updated_at);
}

function isDue(value: string | null | undefined) {
  if (!value) return true;
  const ms = Date.parse(value);
  return !Number.isFinite(ms) || ms <= Date.now();
}

function hasActiveLock(flag: number | null | undefined, startedAt: string | null | undefined, fallbackAt: string | null | undefined, staleAfterMinutes: number) {
  if (Number(flag ?? 0) !== 1) return false;
  const timestamp = Date.parse(startedAt ?? fallbackAt ?? "");
  if (!Number.isFinite(timestamp)) return true;
  return Date.now() - timestamp < staleAfterMinutes * 60 * 1000;
}

function isSchedulerBillingEligible(planKey: string | null | undefined, status: string | null | undefined) {
  const normalizedPlan = String(planKey ?? "free").toLowerCase();
  const normalizedStatus = String(status ?? "inactive").toLowerCase();
  return normalizedStatus === "active" || normalizedStatus === "trialing"
    || (normalizedPlan === "free" && (normalizedStatus === "free" || normalizedStatus === "inactive"));
}

function skippedReason(row: ServerDueRow, task: Extract<ServerLifecycleTask, "metadata" | "adm_discovery" | "adm_processing">) {
  if (!row.guild_id) return "missing_guild_id";
  if (!row.nitrado_service_id) return "missing_nitrado_service_id";
  if ((row.linked_status ?? "pending").toLowerCase() !== "live") return "not_live";
  if (row.merged_into_server_id) return "merged";
  if (Number(row.complimentary_automation_access ?? 0) !== 1
    && !isSchedulerBillingEligible(row.plan_key, row.subscription_status)) return "no_automation_entitlement";
  if (task === "metadata" && hasActiveLock(row.currently_checking_status, row.status_sync_started_at, row.updated_at, 10)) {
    return "currently_checking_status";
  }
  if (task !== "metadata" && hasActiveLock(row.currently_syncing_adm, row.adm_sync_started_at, row.last_adm_pull_at ?? row.updated_at, 30)) {
    return "currently_syncing_adm";
  }
  const lifecycleStatus = String(row.lifecycle_status ?? "active_live").toLowerCase();
  if (!SERVER_LIFECYCLE_STATUSES.includes(lifecycleStatus as typeof SERVER_LIFECYCLE_STATUSES[number])) {
    return "invalid_lifecycle_status";
  }
  const lifecycle = canRunServerLifecycleTask({
    lifecycle_status: lifecycleStatus,
    status: row.linked_status,
    next_retry_after: row.next_retry_after,
    final_sync_attempted_at: row.final_sync_attempted_at,
  }, task);
  if (!lifecycle.allowed) return lifecycle.skipReason ?? "lifecycle_not_eligible";
  const dueAt = task === "metadata"
    ? row.next_status_check_due_at
    : task === "adm_discovery"
      ? row.next_adm_discovery_due_at
      : row.next_adm_pull_due_at;
  if (!isDue(dueAt)) return "not_due";
  if (task === "adm_processing" && row.last_adm_sync_at) {
    const lastSyncAt = Date.parse(row.last_adm_sync_at);
    if (!Number.isFinite(lastSyncAt)) return "invalid_last_adm_sync_at";
    if (Date.now() - lastSyncAt < ADM_MIN_SYNC_INTERVAL_MS) return "adm_minimum_interval";
  }
  return "due";
}

const showcaseSchemaAvailable = Number(runWranglerQuery<{ available: number }>(
  "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'server_showcase_grants') AS available",
)[0]?.available ?? 0) === 1;
const complimentaryAutomationSql = showcaseSchemaAvailable
  ? `EXISTS (
      SELECT 1 FROM server_showcase_grants AS grant_row
      JOIN users AS grant_owner ON grant_owner.id = linked_servers.user_id
      WHERE grant_row.linked_server_id = linked_servers.id
        AND linked_servers.id = ${sqlLiteral(NUKETOWN_SHOWCASE_SCOPE.linkedServerId)}
        AND linked_servers.user_id = ${sqlLiteral(NUKETOWN_SHOWCASE_SCOPE.ownerUserId)}
        AND grant_owner.discord_id = ${sqlLiteral(NUKETOWN_SHOWCASE_SCOPE.ownerDiscordId)}
        AND linked_servers.guild_id = ${sqlLiteral(NUKETOWN_SHOWCASE_SCOPE.guildId)}
        AND linked_servers.nitrado_service_id = ${sqlLiteral(NUKETOWN_SHOWCASE_SCOPE.nitradoServiceId)}
        AND lower(COALESCE(linked_servers.lifecycle_status, '')) = 'active_live'
        AND grant_row.owner_user_id = linked_servers.user_id
        AND grant_row.owner_discord_id = grant_owner.discord_id
        AND grant_row.guild_id = linked_servers.guild_id
        AND grant_row.nitrado_service_id = linked_servers.nitrado_service_id
        AND grant_row.plan_key = 'pro'
        AND grant_row.purpose = 'platform_owner_showcase'
        AND grant_row.revoked_at IS NULL
        AND julianday(grant_row.created_at) <= julianday('now')
        AND (grant_row.expires_at IS NULL OR julianday(grant_row.expires_at) > julianday('now'))
        AND NOT EXISTS (
          SELECT 1 FROM server_subscriptions AS paid_pro
          WHERE paid_pro.guild_id = linked_servers.guild_id
            AND lower(COALESCE(paid_pro.status, '')) IN ('active', 'trialing')
            AND lower(COALESCE(paid_pro.plan_key, '')) IN ('pro', 'premium', 'network', 'partner')
        )
    )`
  : "0";

const rows = runWranglerQuery<ServerDueRow>(
  `SELECT linked_servers.id, linked_servers.guild_id, linked_servers.public_slug,
          linked_servers.nitrado_service_id, linked_servers.display_name,
          linked_servers.hostname, linked_servers.server_name,
          linked_servers.status AS linked_status,
          ${serverLifecycleSqlExpression("linked_servers")} AS lifecycle_status,
          linked_servers.merged_into_server_id, linked_servers.final_sync_attempted_at,
          server_subscriptions.plan_key, server_subscriptions.status AS subscription_status,
          ${complimentaryAutomationSql} AS complimentary_automation_access,
          server_sync_state.next_status_check_due_at,
          server_sync_state.next_adm_discovery_due_at,
          server_sync_state.next_adm_pull_due_at,
          server_sync_state.next_retry_after,
          server_sync_state.currently_checking_status,
          server_sync_state.currently_syncing_adm,
          server_sync_state.status_sync_started_at,
          server_sync_state.adm_sync_started_at,
          server_sync_state.last_adm_pull_at,
          adm_sync_state.last_sync_at AS last_adm_sync_at,
          server_sync_state.updated_at
   FROM linked_servers
   LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
   LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
   LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
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
    const complimentaryAutomation = Number(row.complimentary_automation_access ?? 0) === 1;
    const plan = normalizePlanKey(complimentaryAutomation ? "pro" : row.plan_key);
    const serverName = row.display_name || row.hostname || row.server_name || row.public_slug || row.id;
    console.log(`\nServer: ${serverName}`);
    console.log(`server id: ${row.id}`);
    console.log(`guild id: ${row.guild_id ?? "missing"}`);
    console.log(`public slug: ${row.public_slug ?? "missing"}`);
    console.log(`nitrado service id: ${row.nitrado_service_id ?? "missing"}`);
    console.log(`subscription: ${plan} / ${row.subscription_status ?? "unknown"}`);
    console.log(`automation entitlement: ${complimentaryAutomation ? "complimentary Pro" : `${plan} billing`}`);
    console.log(`server setup status: ${row.linked_status ?? "unknown"}`);
    console.log(`lifecycle: ${row.lifecycle_status ?? "active_live"}`);
    console.log(`intervals: status ${getServerStatusInterval(plan)}m, ADM discovery ${getAdmDiscoveryIntervalMinutes(plan)}m, ADM processing ${getAdmPullInterval(plan)}m`);
    console.log(`next status due: ${row.next_status_check_due_at ?? "now"} (${isDue(row.next_status_check_due_at) ? "due" : "not due"})`);
    console.log(`next ADM discovery due: ${row.next_adm_discovery_due_at ?? "now"} (${isDue(row.next_adm_discovery_due_at) ? "due" : "not due"})`);
    console.log(`next ADM processing due: ${row.next_adm_pull_due_at ?? "now"} (${isDue(row.next_adm_pull_due_at) ? "due" : "not due"})`);
    console.log(`currently checking status: ${Number(row.currently_checking_status ?? 0) === 1}`);
    console.log(`currently syncing ADM: ${Number(row.currently_syncing_adm ?? 0) === 1}`);
    console.log(`status lock age: ${hasActiveLock(row.currently_checking_status, row.status_sync_started_at, row.updated_at, 10) ? `${lockAge(row, "status") ?? "unknown"} minutes` : "not locked"}`);
    console.log(`ADM lock age: ${hasActiveLock(row.currently_syncing_adm, row.adm_sync_started_at, row.last_adm_pull_at ?? row.updated_at, 30) ? `${lockAge(row, "adm") ?? "unknown"} minutes` : "not locked"}`);
    console.log(`row update age: ${ageMinutes(row.updated_at) ?? "unknown"} minutes`);
    console.log(`metadata planner reason: ${skippedReason(row, "metadata")}`);
    console.log(`ADM discovery planner reason: ${skippedReason(row, "adm_discovery")}`);
    console.log(`ADM processing planner reason: ${skippedReason(row, "adm_processing")}`);
  }
}
