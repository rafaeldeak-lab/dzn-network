import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function extractInsertColumns(source: string, table: string) {
  const match = source.match(new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(([\\s\\S]*?)\\)\\s*VALUES`, "i"));
  assert.notEqual(match, null, `Expected lifecycle preview seed INSERT INTO ${table}.`);
  return match![1]
    .split(",")
    .map((column) => column.trim().replace(/^["'`]|["'`]$/g, ""))
    .filter(Boolean);
}

function assertInsertColumnsKnown(source: string, table: string, knownColumns: readonly string[]) {
  const known = new Set(knownColumns);
  const columns = extractInsertColumns(source, table);
  const missing = columns.filter((column) => !known.has(column));
  assert.deepEqual(missing, [], `${table} seed references missing columns.`);
}

const admWorkflow = read(".github/workflows/dzn-adm-sync.yml");
const diagnosticsWorkflow = read(".github/workflows/dzn-nitrado-diagnostics.yml");
const autoUpdateWorkflow = read(".github/workflows/dzn-auto-update-schedulers.yml");
const autoUpdateWorkerDeployWorkflow = read(".github/workflows/dzn-auto-update-worker-deploy.yml");
const admWorkerDeployWorkflow = read(".github/workflows/dzn-adm-worker-deploy.yml");
const dznPulsePreviewWorkflow = read(".github/workflows/dzn-pulse-preview.yml");
const dznPulseProductionRolloutWorkflow = read(".github/workflows/dzn-pulse-production-rollout.yml");
const dznServerLifecyclePreviewWorkflow = read(".github/workflows/dzn-server-lifecycle-preview.yml");
const dznServerLifecycleProductionRolloutWorkflow = read(".github/workflows/dzn-server-lifecycle-production-rollout.yml");
const dznDiscordControlPhase2aPreviewWorkflow = read(".github/workflows/dzn-discord-control-phase-2a-preview.yml");
const dznDiscordServerAnnouncementsPreviewWorkflow = read(".github/workflows/dzn-discord-server-announcements-preview.yml");
const protectedRouteAuthRepairWorkflow = read(".github/workflows/dzn-protected-route-auth-repair.yml");
const productionDiscordAuthRepairWorkflow = read(".github/workflows/dzn-production-discord-auth-repair.yml");
const autoUpdateWorkerConfig = read("wrangler.auto-update.toml");
const admWorkerConfig = read("wrangler.adm-sync.toml");
const workflows = [
  [".github/workflows/dzn-adm-sync.yml", admWorkflow],
  [".github/workflows/dzn-nitrado-diagnostics.yml", diagnosticsWorkflow],
  [".github/workflows/dzn-auto-update-schedulers.yml", autoUpdateWorkflow],
  [".github/workflows/dzn-auto-update-worker-deploy.yml", autoUpdateWorkerDeployWorkflow],
  [".github/workflows/dzn-adm-worker-deploy.yml", admWorkerDeployWorkflow],
  [".github/workflows/dzn-protected-route-auth-repair.yml", protectedRouteAuthRepairWorkflow],
] as const;

assert.equal(admWorkflow.includes("name: DZN ADM Worker Manual Trigger"), true);
assert.equal(admWorkflow.includes("workflow_dispatch:"), true);
assert.equal(admWorkflow.includes("schedule:"), false);
assert.equal(admWorkflow.includes("- cron:"), false);
assert.equal(admWorkflow.includes("/api/sync/adm/run"), true);
assert.equal(admWorkflow.includes("/api/sync/metadata/run"), false);
assert.equal(admWorkflow.includes("/api/sync/public-snapshots/run"), false);
assert.equal(admWorkflow.includes("/api/sync/discord-posts/run"), false);
assert.equal(admWorkflow.includes("/api/sync/ctf-scorecards/run"), false);

assert.equal(diagnosticsWorkflow.includes("workflow_dispatch:"), true);
assert.equal(diagnosticsWorkflow.includes("schedule:"), false);
assert.equal(diagnosticsWorkflow.includes("- cron:"), false);

assert.equal(autoUpdateWorkflow.includes("workflow_dispatch:"), true);
assert.equal(autoUpdateWorkflow.includes("schedule:"), true);
assert.equal(autoUpdateWorkflow.includes('cron: "17 * * * *"'), true);
assert.equal(autoUpdateWorkflow.includes("DZN Auto Update Schedulers Backup"), true);
assert.equal(autoUpdateWorkflow.includes("/api/sync/metadata/run"), true);
assert.equal(autoUpdateWorkflow.includes("/api/cron/server-wars/refresh"), true);
assert.equal(autoUpdateWorkflow.includes("/api/sync/discord-posts/run"), true);
assert.equal(autoUpdateWorkflow.includes("/api/sync/adm/run"), false);
assert.equal(autoUpdateWorkerConfig.includes('name = "dzn-auto-update-worker"'), true);
assert.equal(autoUpdateWorkerConfig.includes('crons = ["* * * * *"]'), true);

assert.equal(autoUpdateWorkerDeployWorkflow.includes("workflow_dispatch:"), true);
assert.equal(autoUpdateWorkerDeployWorkflow.includes("push:"), false);
assert.equal(autoUpdateWorkerDeployWorkflow.includes("CLOUDFLARE_API_TOKEN"), true);
assert.equal(autoUpdateWorkerDeployWorkflow.includes("CLOUDFLARE_ACCOUNT_ID"), true);
assert.equal(autoUpdateWorkerDeployWorkflow.includes("wrangler secret put DZN_CRON_SECRET"), true);
assert.equal(autoUpdateWorkerDeployWorkflow.includes("/workers/scripts/dzn-auto-update-worker/schedules"), true);

assert.equal(admWorkerDeployWorkflow.includes("name: DZN ADM Worker Deploy"), true);
assert.equal(admWorkerDeployWorkflow.includes("workflow_dispatch:"), true);
assert.equal(admWorkerDeployWorkflow.includes("\n  push:"), false);
assert.equal(admWorkerDeployWorkflow.includes("\n  schedule:"), false);
assert.equal(admWorkerDeployWorkflow.includes("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}"), true);
assert.equal(admWorkerDeployWorkflow.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}"), true);
assert.equal(admWorkerDeployWorkflow.includes("wrangler.adm-sync.toml"), true);
assert.equal(admWorkerDeployWorkflow.includes("dzn-adm-sync-worker"), true);
assert.equal(admWorkerDeployWorkflow.includes("npm run worker:adm-sync:dry-run"), true);
assert.equal(admWorkerDeployWorkflow.includes("adm-worker-secrets-before.json"), true);
assert.equal(admWorkerDeployWorkflow.includes('names.includes("TOKEN_ENCRYPTION_KEY")'), true);
assert.equal(admWorkerDeployWorkflow.includes("secrets.TOKEN_ENCRYPTION_KEY"), false);
assert.equal(admWorkerDeployWorkflow.includes("printf \"%s\" \"$CRON_SECRET\" |"), true);
assert.equal(admWorkerDeployWorkflow.includes("wrangler secret put DZN_CRON_SECRET"), true);
assert.equal(admWorkerDeployWorkflow.includes("echo \"$CRON_SECRET\""), false);
assert.equal(admWorkerDeployWorkflow.includes("echo \"${CRON_SECRET}\""), false);
assert.equal(admWorkerDeployWorkflow.includes("/workers/scripts/dzn-adm-sync-worker/schedules"), true);
assert.equal(admWorkerDeployWorkflow.includes("* * * * *"), true);
assert.equal(admWorkerDeployWorkflow.includes("schedule?.cron === \"* * * * *\""), true);
assert.equal(admWorkerDeployWorkflow.includes("schedule?.cron_trigger?.cron === \"* * * * *\""), true);
assert.equal(admWorkerDeployWorkflow.includes("schedule?.schedule === \"* * * * *\""), true);
assert.equal(admWorkerDeployWorkflow.includes("pages deploy"), false);
assert.equal(admWorkerDeployWorkflow.includes("wrangler pages"), false);
assert.equal(admWorkerDeployWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(admWorkerDeployWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(admWorkerDeployWorkflow.includes("wrangler d1"), false);
assert.equal(admWorkerDeployWorkflow.includes("npm run migrate"), false);
assert.equal(admWorkerConfig.includes('name = "dzn-adm-sync-worker"'), true);
assert.equal(admWorkerConfig.includes('crons = ["* * * * *"]'), true);

assert.equal(dznPulsePreviewWorkflow.includes("name: DZN Pulse Preview"), true);
assert.equal(dznPulsePreviewWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznPulsePreviewWorkflow.includes("\n  push:"), false);
assert.equal(dznPulsePreviewWorkflow.includes("\n  schedule:"), false);
assert.equal(dznPulsePreviewWorkflow.includes("CLOUDFLARE_PULSE_PREVIEW_TOKEN: ${{ secrets.CLOUDFLARE_PULSE_PREVIEW_TOKEN }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes('PULSE_CF_TOKEN="${CLOUDFLARE_PULSE_PREVIEW_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"'), true);
assert.equal(dznPulsePreviewWorkflow.includes("Missing CLOUDFLARE_PULSE_PREVIEW_TOKEN or CLOUDFLARE_API_TOKEN GitHub secret"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Cloudflare preview token is present but too short to be valid"), true);
assert.equal(dznPulsePreviewWorkflow.includes('printf "PULSE_CF_TOKEN=%s\\n" "$PULSE_CF_TOKEN"'), true);
assert.equal(dznPulsePreviewWorkflow.includes('printf "CLOUDFLARE_API_TOKEN=%s\\n" "$PULSE_CF_TOKEN"'), true);
assert.equal(dznPulsePreviewWorkflow.includes('echo "PULSE_CF_TOKEN=${PULSE_CF_TOKEN}"'), false);
assert.equal(dznPulsePreviewWorkflow.includes('echo "CLOUDFLARE_API_TOKEN=${PULSE_CF_TOKEN}"'), false);
assert.equal(dznPulsePreviewWorkflow.includes("Cloudflare token verify success=true"), true);
assert.equal(dznPulsePreviewWorkflow.includes("/user/tokens/verify"), true);
assert.equal(dznPulsePreviewWorkflow.indexOf("/user/tokens/verify") < dznPulsePreviewWorkflow.indexOf("/d1/database?per_page=100"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Cloudflare token invalid or expired."), true);
assert.equal(dznPulsePreviewWorkflow.includes("Cloudflare token lacks D1/account permission."), true);
assert.equal(dznPulsePreviewWorkflow.includes("confirm_preview_only:"), true);
assert.equal(dznPulsePreviewWorkflow.includes('confirm_preview_only must equal PREVIEW_ONLY'), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN Pulse preview may only run against feature/dzn-pulse / PR #11"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN Pulse preview input branch must never be main"), true);
assert.equal(dznPulsePreviewWorkflow.includes("pulse_preview"), true);
assert.equal(dznPulsePreviewWorkflow.includes("dzn_pulse_preview"), true);
assert.equal(dznPulsePreviewWorkflow.includes("preview_db_name must not equal the production D1 database name"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Preview D1 database id equals production D1 database id"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Refusing D1 command for non-preview database name"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Refusing migration for non-preview database name"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Refusing seed for non-preview database name"), true);
assert.equal(dznPulsePreviewWorkflow.includes("test -f migrations/0052_dzn_pulse.sql"), true);
assert.equal(dznPulsePreviewWorkflow.includes("wrangler.dzn-pulse-preview.toml"), true);
assert.equal(dznPulsePreviewWorkflow.includes('database_name = "${previewName}"'), true);
assert.equal(dznPulsePreviewWorkflow.includes('database_id = "${previewId}"'), true);
assert.equal(dznPulsePreviewWorkflow.includes("npx wrangler d1 migrations apply DB --config wrangler.dzn-pulse-preview.toml --remote"), true);
assert.equal(dznPulsePreviewWorkflow.includes("notification_campaigns"), true);
assert.equal(dznPulsePreviewWorkflow.includes("user_notifications"), true);
assert.equal(dznPulsePreviewWorkflow.includes("event_popup_dismissals"), true);
assert.equal(dznPulsePreviewWorkflow.includes("notification_preferences"), true);
assert.equal(dznPulsePreviewWorkflow.includes('DZN_DISCORD_NOTIFICATIONS_ENABLED: "false"'), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_PREVIEW_AUTH_DIAGNOSTICS"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_PREVIEW_DISCORD_CLIENT_ID: ${{ vars.DZN_PULSE_PREVIEW_DISCORD_CLIENT_ID }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_PREVIEW_DISCORD_CLIENT_SECRET: ${{ secrets.DZN_PULSE_PREVIEW_DISCORD_CLIENT_SECRET }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_PREVIEW_SESSION_SECRET: ${{ secrets.DZN_PULSE_PREVIEW_SESSION_SECRET }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes("npx wrangler pages secret put DISCORD_CLIENT_SECRET"), true);
assert.equal(dznPulsePreviewWorkflow.includes("npx wrangler pages secret put SESSION_SECRET"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Preview auth secrets are not runtime-readable"), true);
assert.equal(dznPulsePreviewWorkflow.includes("invalid_client"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_ENABLED=true DZN_DISCORD_NOTIFICATIONS_ENABLED=false npm run build"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Refusing to set DZN_PULSE_ENABLED on production Pages project"), true);
assert.equal(dznPulsePreviewWorkflow.includes('PRODUCTION_PAGES_PROJECT_NAME: dzn-network'), true);
assert.equal(dznPulsePreviewWorkflow.includes('fs.writeFileSync("wrangler.toml", wranglerToml)'), true);
assert.equal(dznPulsePreviewWorkflow.includes("previewRedirectUri = `${previewBaseUrl}/api/auth/discord/callback`"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DISCORD_REDIRECT_URI: { type: \"plain_text\", value: previewRedirectUri }"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_APP_URL: { type: \"plain_text\", value: previewBaseUrl }"), true);
assert.equal(dznPulsePreviewWorkflow.includes("deriveDiscordClientIdFromProductionAuthorize"), false);
assert.equal(dznPulsePreviewWorkflow.includes("https://dzn-network.pages.dev/api/auth/discord/start"), false);
assert.equal(dznPulsePreviewWorkflow.includes('process.env.DZN_PULSE_PREVIEW_DISCORD_CLIENT_ID || "1504270029795885178"'), true);
assert.equal(dznPulsePreviewWorkflow.includes("DISCORD_CLIENT_ID: { type: \"plain_text\", value: previewDiscordClientId }"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DISCORD_CLIENT_ID: previewDiscordClientId"), true);
assert.equal(dznPulsePreviewWorkflow.includes('[vars]'), true);
assert.equal(dznPulsePreviewWorkflow.includes("discordClientIdPresent"), true);
assert.equal(dznPulsePreviewWorkflow.includes("discordClientIdRuntimeProvided"), true);
assert.equal(dznPulsePreviewWorkflow.includes("discordClientSecretPresent"), true);
assert.equal(dznPulsePreviewWorkflow.includes("discordClientSecretRuntimeReadable"), true);
assert.equal(dznPulsePreviewWorkflow.includes("discordRedirectUriPresent"), true);
assert.equal(dznPulsePreviewWorkflow.includes("dznAppUrlPresent"), true);
assert.equal(dznPulsePreviewWorkflow.includes("sessionSecretPresent"), true);
assert.equal(dznPulsePreviewWorkflow.includes("sessionSecretRuntimeReadable"), true);
assert.equal(dznPulsePreviewWorkflow.includes("redirectUriHost"), true);
assert.equal(dznPulsePreviewWorkflow.includes("appUrlHost"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Discord auth start redirects to Discord."), true);
assert.equal(dznPulsePreviewWorkflow.includes("/api/auth/discord/start?returnTo=%2Fdzn-pulse"), true);
assert.equal(dznPulsePreviewWorkflow.includes("const timeout = setTimeout(() => controller.abort(), 45000);"), true);
assert.equal(dznPulsePreviewWorkflow.includes("retrying after"), true);
assert.equal(dznPulsePreviewWorkflow.includes("--project-name \"${PREVIEW_PROJECT_NAME}\""), true);
assert.equal(dznPulsePreviewWorkflow.includes("--project-name dzn-network"), false);
assert.equal(dznPulsePreviewWorkflow.includes("wrangler pages deploy out"), true);
assert.equal(dznPulsePreviewWorkflow.includes("const stableUrl = `https://${process.env.PREVIEW_PROJECT_NAME}.pages.dev`;"), true);
assert.equal(dznPulsePreviewWorkflow.includes("pulse-feature-on-immutable-url.txt"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Feature-on immutable preview URL"), true);
assert.equal(dznPulsePreviewWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznPulsePreviewWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznPulsePreviewWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznPulsePreviewWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznPulsePreviewWorkflow.includes("db:migrate:remote"), false);
assert.equal(dznPulsePreviewWorkflow.includes("dzn_network_db --remote"), false);
assert.equal(dznPulsePreviewWorkflow.includes("echo \"$CLOUDFLARE_API_TOKEN\""), false);
assert.equal(dznPulsePreviewWorkflow.includes("echo \"${CLOUDFLARE_API_TOKEN}\""), false);
assert.equal(dznPulsePreviewWorkflow.includes("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_SEED_LOCAL=1 npm run seed:dzn-pulse-demo"), true);
assert.equal(dznPulsePreviewWorkflow.includes("git check-ignore --quiet tmp/dzn-pulse-demo-seed.sql"), true);
assert.equal(dznPulsePreviewWorkflow.includes("npx wrangler d1 execute DB --config wrangler.dzn-pulse-preview.toml --remote --file tmp/dzn-pulse-demo-seed.sql"), true);
assert.equal(dznPulsePreviewWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(dznPulsePreviewWorkflow.includes("/api/public/servers"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Worker exceeded resource limits"), true);

assert.equal(dznServerLifecyclePreviewWorkflow.includes("name: DZN Server Lifecycle Preview"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("\n  push:"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("\n  schedule:"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("feature/server-lifecycle-resource-control"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("confirm_preview_only:"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("confirm_preview_only must equal PREVIEW_ONLY"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Preview branch must never be main."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("server_lifecycle_preview"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("lifecycle_preview"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Preview Pages project must not equal the production Pages project."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Preview Pages project name must contain lifecycle and preview."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing D1 command for non-preview lifecycle database name."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing migration for non-preview lifecycle database name."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing preview seed for non-preview lifecycle database name."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Resolve or create preview Pages project"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing to resolve lifecycle preview against production Pages project."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing non-preview lifecycle Pages project name."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Preview D1 database id equals production D1 database id"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing preview Pages project configuration because preview D1 id equals production D1 id."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing preview deploy because preview D1 id equals production D1 id."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("migrations/0054_server_lifecycle_resource_control.sql"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("npx wrangler d1 migrations apply DB --config wrangler.server-lifecycle-preview.toml --remote"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("lifecycle_status"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("next_adm_discovery_at"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("next_retry_after"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("archived_hidden"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("legacy_offline"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("active_degraded"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("nitrado_upstream_down"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("stale_monitoring"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("token_needs_resave"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("final_sync_pending"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("final_sync_complete"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_archived"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_legacy"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_token_needs_resave"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_backoff"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_no_due_work"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_final_sync_complete"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("lifecycle-nuketown-server"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("18765761"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("lifecycle-pandora-server"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("lifecycle-warlords-server"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("900002"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("discord_guild_id"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("nitrado_service_id"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("ip_address"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("player_slots"), true);
assertInsertColumnsKnown(dznServerLifecyclePreviewWorkflow, "users", [
  "id",
  "discord_id",
  "username",
  "avatar",
  "created_at",
  "updated_at",
]);
assertInsertColumnsKnown(dznServerLifecyclePreviewWorkflow, "discord_guilds", [
  "id",
  "guild_id",
  "owner_user_id",
  "name",
  "icon",
  "icon_url",
  "permissions",
  "is_owner",
  "created_at",
  "updated_at",
]);
assertInsertColumnsKnown(dznServerLifecyclePreviewWorkflow, "linked_servers", [
  "id",
  "user_id",
  "guild_id",
  "discord_guild_id",
  "nitrado_service_id",
  "nitrado_service_name",
  "server_name",
  "server_type",
  "server_category",
  "ip_address",
  "player_slots",
  "public_slug",
  "status",
  "listing_visibility",
  "lifecycle_status",
  "lifecycle_reason",
  "lifecycle_updated_at",
  "owner_action_required",
  "owner_action_reason",
  "created_at",
  "updated_at",
]);
assertInsertColumnsKnown(dznServerLifecyclePreviewWorkflow, "server_public_cache", [
  "id",
  "guild_id",
  "plan_key",
  "public_server_name",
  "current_player_count",
  "max_player_count",
  "server_online",
  "server_status",
  "last_status_update_at",
  "updated_at",
]);
assertInsertColumnsKnown(dznServerLifecyclePreviewWorkflow, "server_sync_state", [
  "id",
  "guild_id",
  "last_status_check_at",
  "last_adm_discovery_check_at",
  "last_adm_pull_at",
  "next_status_check_due_at",
  "next_adm_discovery_due_at",
  "next_adm_pull_due_at",
  "next_metadata_check_at",
  "next_player_count_check_at",
  "next_adm_discovery_at",
  "next_adm_processing_at",
  "next_retry_after",
  "last_skip_reason",
  "created_at",
  "updated_at",
]);
assert.equal(/INSERT INTO linked_servers \([\s\S]*\bserver_id\b/.test(dznServerLifecyclePreviewWorkflow), false);
assert.equal(/INSERT INTO linked_servers \([\s\S]*\bserver_ip\b/.test(dznServerLifecyclePreviewWorkflow), false);
assert.equal(/INSERT INTO linked_servers \([\s\S]*\bserver_port\b/.test(dznServerLifecyclePreviewWorkflow), false);
const lifecyclePublicCacheSeedColumns = extractInsertColumns(dznServerLifecyclePreviewWorkflow, "server_public_cache");
assert.equal(lifecyclePublicCacheSeedColumns.includes("server_name"), false);
assert.equal(lifecyclePublicCacheSeedColumns.includes("name"), false);
assert.equal(lifecyclePublicCacheSeedColumns.includes("current_players"), false);
assert.equal(lifecyclePublicCacheSeedColumns.includes("max_players"), false);
assert.equal(lifecyclePublicCacheSeedColumns.includes("last_seen_at"), false);
const lifecycleSyncStateSeedColumns = extractInsertColumns(dznServerLifecyclePreviewWorkflow, "server_sync_state");
assert.equal(lifecycleSyncStateSeedColumns.includes("linked_server_id"), false);
assert.equal(lifecycleSyncStateSeedColumns.includes("service_id"), false);
assert.equal(lifecycleSyncStateSeedColumns.includes("last_adm_discovery_at"), false);
assert.equal(lifecycleSyncStateSeedColumns.includes("last_adm_read_at"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes('DZN_DISCORD_NOTIFICATIONS_ENABLED: "false"'), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("MOCK_AUTH=true"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("MOCK_AUTH = \"true\""), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("--project-name \"${PREVIEW_PROJECT_NAME}\""), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("--project-name dzn-network"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("wrangler pages deploy out"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("api(`/pages/projects/${projectName}`)"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes('api("/pages/projects",'), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("method: \"POST\""), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("method: \"PATCH\""), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Created preview Pages project"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Reusing preview Pages project"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("production_branch: branch"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("DB: { id: d1Id }"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("db:migrate:remote"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("dzn_network_db --remote"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("echo \"$CLOUDFLARE_API_TOKEN\""), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("echo \"${CLOUDFLARE_API_TOKEN}\""), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("/api/public/servers"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("/api/public/server-rail"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes('fs.readFileSync("functions/api/autodev/adm-health.ts"'), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes('expectStatus("/api/autodev/adm-health'), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes('jsonRequest("/api/autodev/adm-health'), false);

assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("name: DZN Server Lifecycle Production Rollout"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("\n  push:"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("\n  schedule:"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("confirm_production_rollout"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("APPROVE_LIFECYCLE_ROLLOUT"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("approved_commit"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("approved_preview_run_url"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("production_db_name"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("production_pages_project_name"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("migration_name"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("feature/server-lifecycle-resource-control"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("743fbbd6aee2272d70aebd0179423fbf9f6567f3"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("ROLLOUT_COMMIT_SHA=\"$(git rev-parse HEAD)\""), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("--commit-hash \"${ROLLOUT_COMMIT_SHA}\""), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("actions: read"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("GITHUB_TOKEN: ${{ github.token }}"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Approved commit is not present on the selected branch; rerun preview for the current branch head."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Selected branch HEAD ${ROLLOUT_COMMIT_SHA} does not match preview-approved commit ${APPROVED_COMMIT}; rerun preview for the current branch head."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("DZN Server Lifecycle Preview"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("run.conclusion !== \"success\""), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("production_db_name must equal dzn_network_db"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("production_pages_project_name must equal dzn-network"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("migration_name must equal 0054_server_lifecycle_resource_control.sql"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Refusing preview D1 name for production rollout."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Refusing preview Pages project for production rollout."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("CLOUDFLARE_SERVER_LIFECYCLE_PRODUCTION_TOKEN"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("echo \"${ROLLOUT_CF_TOKEN}\""), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("echo \"$ROLLOUT_CF_TOKEN\""), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("echo \"${CRON_SECRET}\""), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("echo \"$CRON_SECRET\""), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npm run lint"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npm run build"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npm run test"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npm run test:server-lifecycle-resource-control"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("git diff --check"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Migration 0054 is additive-only."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("DROP|TRUNCATE"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("DELETE\\s+FROM"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("d1 time-travel info"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("D1_BACKUP_BOOKMARK"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("lifecycle-linked-columns-before.json"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("lifecycle-sync-columns-before.json"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Pre-migration linked_servers columns:"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Pre-migration server_sync_state columns:"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("LIFECYCLE_0054_COLUMNS_PRESENT"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("COALESCE(lifecycle_status, 'pre_0054')"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Unexpected pending production D1 migrations"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("0054_server_lifecycle_resource_control.sql"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npx wrangler d1 migrations apply \"${{ inputs.production_db_name }}\" --remote"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("PRAGMA table_info(linked_servers)"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("PRAGMA table_info(server_sync_state)"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("idx_linked_servers_lifecycle_status"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("idx_server_sync_state_lifecycle_retry"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("PRAGMA foreign_key_check"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("18765761"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("900002"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npx wrangler pages deploy out"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("--project-name \"${{ inputs.production_pages_project_name }}\""), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("dzn-network-server-lifecycle-preview"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npx wrangler deploy --config wrangler.adm-sync.toml"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npx wrangler deploy --config wrangler.auto-update.toml"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("TOKEN_ENCRYPTION_KEY: ${{ secrets.TOKEN_ENCRYPTION_KEY }}"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("secrets.TOKEN_ENCRYPTION_KEY"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/autodev/adm-health"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/sync/metadata/run"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/cron/server-wars/refresh"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/sync/discord-posts/run"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/public/server-rail"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/public/servers"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/public/home-stats"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/public/leaderboards/advanced"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/public/server-wars"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("discordNotificationsEnabled !== false"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Warlords appears in public active server surfaces."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Minified React error #"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Error 1102"), true);

assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("name: DZN Discord Control Phase 2A Preview"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("\n  push:"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("\n  schedule:"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("feature/discord-control-phase-2a"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("confirm_preview_only:"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("confirm_preview_only must equal PREVIEW_ONLY"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Preview branch must never be main."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Preview Pages project must not equal production Pages project."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Preview D1 database must not equal production D1 database."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("dzn-network-discord-phase-2a-preview"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("dzn_network_db_discord_phase_2a_preview"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: \"false\""), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Missing DZN_PLATFORM_OWNER_DISCORD_IDS for Discord Control Phase 2A preview."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("migrations/0055_discord_control_phase_2a.sql"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("DROP\\s+TABLE|DELETE\\s+FROM|TRUNCATE"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("npx wrangler d1 migrations apply DB --config wrangler.discord-phase-2a-preview.toml --remote"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("discord_channel_mappings"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("discord_owner_audit_log"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Resolve or create preview Pages project"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Refusing production Pages project."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("--project-name \"${PREVIEW_PROJECT_NAME}\""), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("--project-name dzn-network"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("previewOnly: true"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Preview-only test embed must not send."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("autoPostingEnabled === false"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED = \"true\""), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("db:migrate:remote"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("dzn_network_db --remote"), false);

assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("name: DZN Discord Server Announcements Preview"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("\n  push:"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("\n  schedule:"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("feature/discord-server-announcements"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("confirm_preview_only:"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("confirm_preview_only must equal PREVIEW_ONLY"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Preview branch must never be main."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Preview Pages project must not equal production Pages project."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Preview D1 database must not equal production D1 database."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("dzn-network-discord-announcements-preview"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("dzn_network_db_discord_announcements_preview"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: \"false\""), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: \"false\""), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED must remain false for Phase 1 preview"), true);
const legacyAdvertChannelEnv = "DZN_DISCORD_ADVERTISE" + "_CHANNEL_ID";
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes(legacyAdvertChannelEnv), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes('LEGACY_ADVERT_CHANNEL_ENV="DZN_DISCORD_ADVERTISE""_CHANNEL_ID"'), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Use DZN_DISCORD_ADVERT_CHANNEL_ID, not ${LEGACY_ADVERT_CHANNEL_ENV}"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("migrations/0056_discord_server_announcements.sql"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("DROP\\s+TABLE|DELETE\\s+FROM|TRUNCATE"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Apply preview migrations through 0055 only"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("mv migrations/0056_discord_server_announcements.sql preview-held-migrations/"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("discord_announcement_posts is absent"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Apply preview-only migration 0056"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("PRAGMA table_info(discord_announcement_posts)"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Discord Announcement System"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("serverAnnouncements?.featureEnabled === false"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("RESOLVED_PREVIEW_BASE_URL"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("discord-announcements-preview-url.txt"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Deployment URL candidates"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("curl -I --max-time 30"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Resolved preview verification URL"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Preview readiness attempt ${attempt}/60: ${base}/ HTTP"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Stable preview URL: ${PREVIEW_BASE_URL}"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Resolved preview URL: ${RESOLVED_PREVIEW_BASE_URL:-${PREVIEW_BASE_URL}}"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Private Discord test messages: not sent by this workflow"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("wrangler pages secret put DISCORD_BOT_TOKEN"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("secrets.DZN_DISCORD_SERVER_ANNOUNCEMENTS_PREVIEW_BOT_TOKEN"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED = \"true\""), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("dzn_network_db --remote"), false);

assert.equal(dznPulseProductionRolloutWorkflow.includes("name: DZN Pulse Production Rollout"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("confirm_production_rollout"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("DZN_PULSE_ENABLED = \"true\""), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED = \"false\""), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("npx wrangler pages secret put DZN_PULSE_ENABLED"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("npx wrangler pages secret put DZN_DISCORD_NOTIFICATIONS_ENABLED"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("DZN_PULSE_ENABLED=true DZN_DISCORD_NOTIFICATIONS_ENABLED=false npm run build"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("npx wrangler d1 migrations list \"${PRODUCTION_D1_DATABASE_NAME}\" --remote"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("npx wrangler d1 migrations apply \"${PRODUCTION_D1_DATABASE_NAME}\" --remote"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("PATCH"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("/pages/projects/${projectName}"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("Migration 0052_dzn_pulse.sql is pending; stopping before enabling DZN Pulse."), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("Production D1 Pulse schema already exists; no migration was run."), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("notification_campaigns"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("user_notifications"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("event_popup_dismissals"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("notification_preferences"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("idx_notification_campaigns_active_priority"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("idx_user_notifications_user_read_created"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("idx_event_popup_dismissals_user_campaign_scope"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED = \"true\""), false);

assert.equal(protectedRouteAuthRepairWorkflow.includes("name: DZN Protected Route Auth Repair"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("workflow_dispatch:"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("confirm_protected_auth_repair"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("run-dzn-protected-auth-repair"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("CRON_SECRET=\"${DZN_CRON_SECRET:-${SYNC_CRON_SECRET:-}}\""), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("DZN_CRON_SECRET present:"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("SYNC_CRON_SECRET present:"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("Selected secret source:"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("Headers sent: x-dzn-cron-secret, x-sync-cron-secret, x-cron-secret, Authorization"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_CRON_SECRET"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_PULSE_ENABLED"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_DISCORD_NOTIFICATIONS_ENABLED"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("--project-name \"${PRODUCTION_PAGES_PROJECT_NAME}\""), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("DZN_PULSE_ENABLED = \"true\""), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED = \"false\""), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED = \"true\""), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("/api/sync/metadata/run"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("/api/cron/server-wars/refresh"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("/api/sync/discord-posts/run"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("/api/autodev/adm-health"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("/api/sync/adm/run"), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("wrangler d1 migrations apply"), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("dzn-auto-update-worker"), false);

assert.equal(productionDiscordAuthRepairWorkflow.includes("name: DZN Production Discord Auth Repair"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("workflow_dispatch:"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("confirm_discord_auth_repair"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("run-dzn-production-discord-auth-repair"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("Production Discord auth repair may only run on main."), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("DZN_PRODUCTION_DISCORD_CLIENT_ID: ${{ vars.DZN_PRODUCTION_DISCORD_CLIENT_ID }}"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("PROTECTED_CALLBACK_DIAGNOSTIC_SECRET_SOURCE"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes('DZN_PRODUCTION_DISCORD_CLIENT_ID:-1504270029795885178'), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("https://dzn-network.pages.dev/api/auth/discord/callback"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("npx wrangler pages secret put DISCORD_CLIENT_ID"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("npx wrangler pages secret put DISCORD_REDIRECT_URI"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_APP_URL"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_PULSE_ENABLED"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_DISCORD_NOTIFICATIONS_ENABLED"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("Ensure Pages production branch is main"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes('JSON.stringify({ production_branch: "main" })'), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("deployment_configs"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("env_vars"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("for name in DISCORD_CLIENT_SECRET SESSION_SECRET"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("$name listed before repair: true"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/auth/discord/start?returnTo=%2Fdashboard"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("Discord auth start redirects to Discord with the production callback."), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("synthetic-production-diagnostic-code"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("diagnostic=1"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes('"x-dzn-cron-secret": process.env.PROTECTED_CALLBACK_DIAGNOSTIC_SECRET'), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("client_secret_trimmed"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("invalid_client"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("invalid_grant"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("Production Discord client secret is missing, invalid, or no longer current."), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("DZN_PULSE_ENABLED=true DZN_DISCORD_NOTIFICATIONS_ENABLED=false npm run build"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/dzn-pulse/summary"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/public/servers"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/public/leaderboards/advanced"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/sync/metadata/run"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/cron/server-wars/refresh"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/sync/discord-posts/run"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/sync/adm/run"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("wrangler d1 migrations apply"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED = \"true\""), false);

const runtimeOnlySecretPatterns = [
  /secrets\.DISCORD_BOT_TOKEN/,
  /secrets\.DISCORD_CLIENT_SECRET/,
  /secrets\.STRIPE_SECRET_KEY/,
  /secrets\.STRIPE_WEBHOOK_SECRET/,
  /secrets\.SESSION_SECRET/,
  /secrets\.TOKEN_ENCRYPTION_KEY/,
  /secrets\.MOCK_AUTH/,
  /secrets\.MOCK_NITRADO/,
  /secrets\.NEXT_PUBLIC_/,
];

for (const [path, source] of workflows) {
  assert.equal(source.includes("${{ secrets.DZN_CRON_SECRET }}"), true, `${path} should allow DZN_CRON_SECRET`);
  assert.equal(source.includes("${{ secrets.SYNC_CRON_SECRET }}"), true, `${path} should allow SYNC_CRON_SECRET fallback`);
  for (const pattern of runtimeOnlySecretPatterns) {
    assert.equal(pattern.test(source), false, `${path} must not reference runtime-only secret ${pattern}`);
  }
}

const secretsMatrix = read("docs/SECRETS_MATRIX.md");
assert.equal(secretsMatrix.includes("GitHub Actions is not the primary ADM auto-sync runner."), true);
assert.equal(secretsMatrix.includes("DZN_CRON_SECRET"), true);
assert.equal(secretsMatrix.includes("SYNC_CRON_SECRET"), true);
assert.equal(secretsMatrix.includes("Do not copy all Cloudflare runtime secrets into GitHub."), true);
assert.equal(secretsMatrix.includes("TOKEN_ENCRYPTION_KEY"), true);
assert.equal(secretsMatrix.includes("dzn-adm-sync-worker"), true);

console.log("GitHub workflow boundary tests passed.");
