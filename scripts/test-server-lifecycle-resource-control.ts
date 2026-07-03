import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SERVER_LIFECYCLE_ACTIVE_ADM_STATUSES,
  SERVER_LIFECYCLE_ACTIVE_METADATA_STATUSES,
  SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES,
  SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES,
  canRunServerLifecycleTask,
  classifyServerLifecycleError,
  normalizeServerLifecycleStatus,
} from "../lib/server-lifecycle";

assert.deepEqual(SERVER_LIFECYCLE_ACTIVE_ADM_STATUSES, [
  "active_live",
  "active_degraded",
  "nitrado_upstream_down",
  "stale_monitoring",
  "final_sync_pending",
]);
assert.deepEqual(SERVER_LIFECYCLE_ACTIVE_METADATA_STATUSES, [
  "active_live",
  "active_degraded",
  "nitrado_upstream_down",
  "stale_monitoring",
]);
assert.deepEqual(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES, [
  "active_live",
  "active_degraded",
  "nitrado_upstream_down",
  "stale_monitoring",
]);
assert.deepEqual(SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES, [
  "active_live",
  "active_degraded",
  "token_needs_resave",
  "nitrado_upstream_down",
  "stale_monitoring",
  "expired_detected",
  "deletion_imminent",
  "final_sync_pending",
  "final_sync_complete",
  "legacy_offline",
]);
assert.equal(SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES.includes("archived_hidden"), false);

assert.equal(normalizeServerLifecycleStatus({ status: "archived", lifecycle_status: "active_live" }), "archived_hidden");
assert.equal(normalizeServerLifecycleStatus({ listing_visibility: "hidden", lifecycle_status: "active_live" }), "archived_hidden");
assert.equal(normalizeServerLifecycleStatus({ status: "inactive", lifecycle_status: "active_live" }), "legacy_offline");
assert.equal(normalizeServerLifecycleStatus({ lifecycle_status: "token_needs_resave" }), "token_needs_resave");
assert.equal(normalizeServerLifecycleStatus({ lifecycle_status: "unknown" }), "active_live");

assert.equal(canRunServerLifecycleTask({ lifecycle_status: "active_live" }, "adm_processing").allowed, true);
assert.equal(canRunServerLifecycleTask({ lifecycle_status: "archived_hidden" }, "adm_processing").skipReason, "skipped_archived");
assert.equal(canRunServerLifecycleTask({ lifecycle_status: "legacy_offline" }, "adm_processing").skipReason, "skipped_legacy");
assert.equal(canRunServerLifecycleTask({ lifecycle_status: "final_sync_complete" }, "adm_processing").skipReason, "skipped_final_sync_complete");
assert.equal(canRunServerLifecycleTask({ lifecycle_status: "token_needs_resave" }, "adm_processing").skipReason, "skipped_token_needs_resave");
assert.equal(canRunServerLifecycleTask({ lifecycle_status: "active_degraded", next_retry_after: "2099-01-01T00:00:00.000Z" }, "metadata", { now: "2026-07-01T00:00:00.000Z" }).skipReason, "skipped_backoff");
assert.equal(canRunServerLifecycleTask({ lifecycle_status: "active_degraded", next_retry_after: "2099-01-01T00:00:00.000Z" }, "metadata", { now: "2026-07-01T00:00:00.000Z", manual: true }).allowed, true);
assert.equal(canRunServerLifecycleTask({ lifecycle_status: "nitrado_upstream_down", next_retry_after: "2099-01-01T00:00:00.000Z" }, "adm_discovery", { now: "2026-07-01T00:00:00.000Z" }).skipReason, "skipped_backoff");
assert.equal(canRunServerLifecycleTask({ lifecycle_status: "nitrado_upstream_down", next_retry_after: "2026-06-30T00:00:00.000Z" }, "adm_discovery", { now: "2026-07-01T00:00:00.000Z" }).allowed, true);
assert.equal(canRunServerLifecycleTask({ lifecycle_status: "final_sync_pending", final_sync_attempted_at: null }, "adm_processing").allowed, true);
assert.equal(canRunServerLifecycleTask({ lifecycle_status: "final_sync_pending", final_sync_attempted_at: "2026-07-01T00:00:00.000Z" }, "adm_processing").skipReason, "skipped_final_sync_complete");

assert.equal(classifyServerLifecycleError("Saved Nitrado token cannot be decrypted").status, "token_needs_resave");
assert.equal(classifyServerLifecycleError("NITRADO_UPSTREAM_DOWN HTTP 503").status, "nitrado_upstream_down");
assert.equal(classifyServerLifecycleError("service expired or deleted").status, "expired_detected");

const migration = readFileSync("migrations/0054_server_lifecycle_resource_control.sql", "utf8");
for (const snippet of [
  "ALTER TABLE linked_servers ADD COLUMN lifecycle_status",
  "ALTER TABLE linked_servers ADD COLUMN owner_action_required",
  "ALTER TABLE linked_servers ADD COLUMN final_sync_attempted_at",
  "ALTER TABLE linked_servers ADD COLUMN final_sync_completed_at",
  "ALTER TABLE server_sync_state ADD COLUMN next_metadata_check_at",
  "ALTER TABLE server_sync_state ADD COLUMN next_adm_discovery_at",
  "ALTER TABLE server_sync_state ADD COLUMN next_retry_after",
  "CREATE INDEX IF NOT EXISTS idx_linked_servers_lifecycle_status",
]) {
  assert.equal(migration.includes(snippet), true, `Lifecycle migration should include ${snippet}.`);
}
assert.equal(/DROP\s+|DELETE\s+FROM|TRUNCATE|CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats|ALTER\s+TABLE\s+player_profiles|ALTER\s+TABLE\s+kill_events|ALTER\s+TABLE\s+player_events|ALTER\s+TABLE\s+leaderboards/i.test(migration), false, "Lifecycle migration must be additive and avoid protected historical/stat tables.");

const automationSource = readFileSync("functions/_lib/automation.ts", "utf8");
for (const snippet of [
  "SERVER_LIFECYCLE_ACTIVE_ADM_STATUSES",
  "SERVER_LIFECYCLE_ACTIVE_METADATA_STATUSES",
  "classifyServerLifecycleError",
  "recordServerLifecycleOutcome",
  "next_retry_after",
  "last_skip_reason",
  "skipped_token_needs_resave",
  "skipped_backoff",
  "skipped_archived",
  "skipped_legacy",
  "skipped_final_sync_complete",
]) {
  assert.equal(automationSource.includes(snippet), true, `Automation scheduler should include ${snippet}.`);
}
assert.equal(/DELETE\s+FROM\s+(player_profiles|kill_events|player_events|server_stats|leaderboards)/i.test(automationSource), false, "Lifecycle automation must not delete historical stat/event rows.");

const admWorkerSource = readFileSync("functions/_lib/adm-sync.ts", "utf8");
for (const snippet of [
  "SERVER_LIFECYCLE_ACTIVE_ADM_STATUSES",
  "serverLifecycleInSql",
  "final_sync_attempted_at",
  "next_retry_after",
  "lifecycle_status",
]) {
  assert.equal(admWorkerSource.includes(snippet), true, `ADM worker selector/status should include ${snippet}.`);
}

const metadataSource = readFileSync("functions/_lib/server-metadata.ts", "utf8");
assert.equal(metadataSource.includes("SERVER_LIFECYCLE_ACTIVE_METADATA_STATUSES"), true);
assert.equal(metadataSource.includes("serverLifecycleSqlExpression(\"linked_servers\")"), true);
assert.equal(metadataSource.includes("next_retry_after"), true);

for (const [file, snippets] of [
  ["functions/api/public/servers.ts", ["SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES", "SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES", "serverLifecycleSqlExpression(\"linked_servers\")"]],
  ["functions/api/public/server-rail.ts", ["SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES", "serverLifecycleSqlExpression(\"linked_servers\")"]],
  ["functions/api/public/home-stats.ts", ["PUBLIC_LINKED_SERVER_LIFECYCLE_SQL", "PUBLIC_HISTORICAL_LINKED_SERVER_LIFECYCLE_SQL", "PUBLIC_LIVE_KILL_SERVER_LIFECYCLE_SQL"]],
  ["functions/_lib/public-leaderboards.ts", ["PUBLIC_LIFECYCLE_SQL"]],
  ["functions/_lib/advanced-leaderboards.ts", ["publicServerWhereSql", "SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES"]],
  ["functions/_lib/player-counts.ts", ["PUBLIC_PLAYER_COUNT_LIFECYCLE_SQL"]],
  ["functions/_lib/server-stats.ts", ["SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES", "PUBLIC_HISTORICAL_SERVER_SCOPE"]],
  ["functions/_lib/build-events.ts", ["SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES"]],
] as const) {
  const source = readFileSync(file, "utf8");
  for (const snippet of snippets) {
    assert.equal(source.includes(snippet), true, `${file} should include ${snippet}.`);
  }
}

const discordPosting = readFileSync("functions/_lib/discord-posting.ts", "utf8");
assert.equal(discordPosting.includes("Server lifecycle is not eligible for Discord auto-posting."), true);
assert.equal(discordPosting.includes("active_live', 'active_degraded"), true);

const serverWarsCategories = readFileSync("functions/_lib/server-war-categories.ts", "utf8");
assert.equal(serverWarsCategories.includes("normalizeServerLifecycleStatus"), true);
assert.equal(serverWarsCategories.includes("SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES"), true);
const serverWars = readFileSync("functions/_lib/server-wars.ts", "utf8");
assert.equal(serverWars.includes("linked_servers.lifecycle_status"), true);

const healthRoute = readFileSync("functions/api/autodev/adm-health.ts", "utf8");
assert.equal(healthRoute.includes("token_needs_resave"), true);
assert.equal(healthRoute.includes("lifecycleWarningOnly"), true);
assert.equal(healthRoute.includes("manualActionRequired = !lifecycleWarningOnly"), true);

const dashboardHealthRoute = readFileSync("functions/api/servers/[serverId]/dashboard/health.ts", "utf8");
assert.equal(dashboardHealthRoute.includes("getServerLifecycleDisplay"), true);
assert.equal(dashboardHealthRoute.includes("lifecycleMessage"), true);

const dashboard = readFileSync("components/onboarding/dashboard.tsx", "utf8");
for (const snippet of [
  "Lifecycle & Resource Control",
  "Token needs re-save",
  "Nitrado temporarily unavailable",
  "Final sync completed",
  "Archived / hidden",
  "formatLifecycleSkipReason",
]) {
  assert.equal(dashboard.includes(snippet), true, `Dashboard should include owner-facing lifecycle copy ${snippet}.`);
}
assert.equal(
  dashboard.includes('data.reason ?? "advanced_stats_snapshot_pending"'),
  false,
  "Dashboard must not render raw advanced_stats_snapshot_pending fallback text.",
);

const publicNetwork = readFileSync("components/network/public-network.tsx", "utf8");
for (const snippet of [
  "Legacy / Offline",
  "Historical stats are preserved",
  "server.lifecycle?.historical",
]) {
  assert.equal(publicNetwork.includes(snippet), true, `Public profile should include historical lifecycle copy ${snippet}.`);
}

const landingPage = readFileSync("components/dzn/dzn-landing-page.tsx", "utf8");
for (const snippet of [
  "row.historical",
  "lifecycle_label",
  "Legacy / Offline",
]) {
  assert.equal(landingPage.includes(snippet), true, `Build tracking should preserve visible legacy labels with ${snippet}.`);
}

console.log("Server lifecycle resource-control tests passed.");
