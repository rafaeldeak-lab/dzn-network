import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getAdmDiscoveryIntervalMinutes,
  getAdmPullInterval,
  getManualRefreshCooldown,
  getPlanByKey,
  getPlanByStripePriceId,
  getPlanPriority,
  getServerStatusInterval,
  hasAutoPost,
  hasPlanFeature,
} from "../lib/billing/plans";
import { getPostingDeliveryMode } from "../functions/_lib/discord-posting";
import { isDiscordPostCronAuthorized } from "../functions/api/sync/discord-posts/run";
import type { Env } from "../functions/_lib/types";

assert.equal(getPlanByKey("starter").server_status_interval_minutes, 7);
assert.equal(getPlanByKey("starter").adm_discovery_interval_minutes, 15);
assert.equal(getPlanByKey("starter").adm_pull_interval_minutes, 60);
assert.equal(getPlanByKey("pro").server_status_interval_minutes, 5);
assert.equal(getPlanByKey("pro").adm_discovery_interval_minutes, 10);
assert.equal(getPlanByKey("pro").adm_pull_interval_minutes, 30);
assert.equal(getPlanByKey("network").server_status_interval_minutes, 3);
assert.equal(getPlanByKey("network").adm_discovery_interval_minutes, 5);
assert.equal(getPlanByKey("network").adm_pull_interval_minutes, 15);
assert.equal(getPlanByKey("partner").server_status_interval_minutes, 1);
assert.equal(getAdmDiscoveryIntervalMinutes("partner"), 3);
assert.equal(getAdmDiscoveryIntervalMinutes("free") >= 3, true);
assert.equal(getAdmPullInterval("partner"), 10);
assert.equal(getAdmPullInterval("free") >= 10, true);
assert.equal(getServerStatusInterval("partner"), 1);
assert.equal(getServerStatusInterval("free") >= 1, true);
assert.equal(getManualRefreshCooldown("pro"), 30);
assert.equal(getPlanPriority("network"), 3);

assert.equal(hasPlanFeature("starter", "leaderboards"), false);
assert.equal(hasPlanFeature("pro", "leaderboards"), true);
assert.equal(hasPlanFeature("partner", "server_vs_server"), true);
assert.equal(hasAutoPost("starter", "basic_status_embed"), true);
assert.equal(hasAutoPost("starter", "leaderboard_embed"), false);
assert.equal(hasAutoPost("pro", "daily_summary_embed"), true);
assert.equal(hasAutoPost("network", "server_vs_server_embed"), true);
assert.equal(hasAutoPost("network", "partner_featured_embed"), false);
assert.equal(hasAutoPost("network", "killfeed_embed"), false);
assert.equal(hasAutoPost("partner", "killfeed_embed"), true);
assert.equal(hasAutoPost("partner", "admin_logs_embed"), true);
assert.equal(hasAutoPost("partner", "priority_status_embed"), true);
assert.equal(getPlanByStripePriceId("price_network", { network: "price_network" }), "network");

const cronEnv = { DZN_CRON_SECRET: "unit-test-secret" } as Env;
assert.equal(isDiscordPostCronAuthorized(new Request("https://dzn.test", {
  method: "POST",
  headers: { "x-dzn-cron-secret": "unit-test-secret" },
}), cronEnv), true);
assert.equal(isDiscordPostCronAuthorized(new Request("https://dzn.test", {
  method: "POST",
}), cronEnv), false);
assert.equal(getPostingDeliveryMode({ DISCORD_BOT_TOKEN: "bot-token" } as Env, { discord_channel_id: "1234567890" }), "bot");
assert.equal(getPostingDeliveryMode({} as Env, { discord_channel_id: "1234567890", discord_webhook_url: "https://discord.com/api/webhooks/test/token" }), "webhook");
assert.equal(getPostingDeliveryMode({} as Env, { discord_channel_id: "1234567890" }), "not_configured");

const automationSource = readFileSync("functions/_lib/automation.ts", "utf8");
assert.equal(automationSource.includes("server_subscriptions"), true);
assert.equal(automationSource.includes("server_sync_state"), true);
assert.equal(automationSource.includes("server_public_cache"), true);
assert.equal(automationSource.includes("automation_cron_runs"), true);
assert.equal(automationSource.includes("recordAutomationCronRun"), true);
assert.equal(automationSource.includes("last_cron_trigger_source"), true);
assert.equal(automationSource.includes("queueDiscordPostUpdatesForGuild"), true);
assert.equal(automationSource.includes("getDueStatusAutomationServers"), true);
assert.equal(automationSource.includes("getDueAdmDiscoveryAutomationServers"), true);
assert.equal(automationSource.includes("getDueAdmAutomationServers"), true);
assert.equal(automationSource.includes("recordAdmDiscoveryResult"), true);
assert.equal(automationSource.includes("recoverStuckAutomationLocks"), true);
assert.equal(automationSource.includes("Recovered stale status sync lock after 10 minutes."), true);
assert.equal(automationSource.includes("Recovered stale ADM sync lock after 30 minutes."), true);
assert.equal(automationSource.includes("last_seen_adm_timestamp"), true);
assert.equal(automationSource.includes("newest_available_adm_filename"), true);
assert.equal(automationSource.includes("newest_readable_adm_filename"), true);
assert.equal(automationSource.includes("last_restart_detected_source"), true);
assert.equal(automationSource.includes("metadata_status"), true);
assert.equal(automationSource.includes("adm_filename"), true);
assert.equal(automationSource.includes("latest_adm_unreadable"), true);
assert.equal(automationSource.includes("delayed_after_restart"), true);
assert.equal(automationSource.includes("last_adm_discovery_check_at"), true);
assert.equal(automationSource.includes("next_adm_discovery_due_at"), true);
assert.equal(automationSource.includes("nitrado_reduce_log_output_confirmed"), true);
assert.equal(automationSource.includes("nitrado_log_playerlist_confirmed"), true);

const postingSource = readFileSync("functions/_lib/discord-posting.ts", "utf8");
assert.equal(postingSource.includes("last_payload_hash"), true);
assert.equal(postingSource.includes("discord_webhook_url"), true);
assert.equal(postingSource.includes("sendOrEditWithBot"), true);
assert.equal(postingSource.includes("checkDiscordPostingPermissions"), true);
assert.equal(postingSource.includes("Manage Messages"), true);
assert.equal(postingSource.includes("DZN cannot auto-post here yet"), true);
assert.equal(postingSource.includes("DISCORD_BOT_TOKEN"), true);
assert.equal(postingSource.includes("DZN DISCORD AUTO POST DISPATCH READY"), true);
assert.equal(postingSource.includes("recordDiscordPostingDeliveryState"), true);
assert.equal(postingSource.includes("classifyDiscordPostingError"), true);
assert.equal(postingSource.includes("processDuePostingDestinations"), true);
assert.equal(postingSource.includes("dispatchDiscordPostsForGuild"), true);
assert.equal(postingSource.includes("last_dispatch_status"), true);
assert.equal(postingSource.includes("DZN Server Status -"), true);
assert.equal(postingSource.includes("Refresh interval: Every"), true);
assert.equal(postingSource.includes("Updated at:"), true);
assert.equal(postingSource.includes("DZN Admin Logs"), true);
assert.equal(postingSource.includes("No new admin log events yet."), true);
assert.equal(postingSource.includes("Auto-updated by DZN"), true);
assert.equal(postingSource.includes("skipped_unchanged"), true);
assert.equal(postingSource.includes("old_payload_hash"), true);
assert.equal(postingSource.includes("new_payload_hash"), true);
assert.equal(postingSource.includes("no_message_state_found_for_destination"), true);
assert.equal(postingSource.includes("delivery.operation === \"edited\" ? \"edited\" : \"sent\""), true);
assert.equal(postingSource.includes("operation: \"edited\""), true);
assert.equal(postingSource.includes("operation: \"sent\""), true);

const metadataSource = readFileSync("functions/_lib/server-metadata.ts", "utf8");
assert.equal(metadataSource.includes("status-check"), true);
assert.equal(metadataSource.includes("queueDiscordPostUpdatesForGuild(env, row.guild_id, row.plan_key, [\"basic_status_embed\", \"priority_status_embed\"]"), true);

const postingEndpointSource = readFileSync("functions/api/servers/[serverId]/posting-destinations.ts", "utf8");
assert.equal(postingEndpointSource.includes("existingDestination?.discord_webhook_url"), true);
assert.equal(postingEndpointSource.includes("post_types"), true);
assert.equal(postingEndpointSource.includes("setups"), true);
assert.equal(postingEndpointSource.includes("handleGroupedPostingAction"), true);
assert.equal(postingEndpointSource.includes("verifyDiscordPostingChannel"), true);
assert.equal(postingEndpointSource.includes("runPostingTest"), true);
assert.equal(postingEndpointSource.includes("has_webhook_url"), true);
assert.equal(postingEndpointSource.includes("setup_status"), true);
assert.equal(postingEndpointSource.includes("MISSING PERMISSIONS"), true);
assert.equal(postingEndpointSource.includes("SETUP NEEDED"), true);
assert.equal(postingEndpointSource.includes("discord_message_id"), true);
assert.equal(postingEndpointSource.includes("queued_job_count"), true);
const runNowEndpointSource = readFileSync("functions/api/servers/[serverId]/auto-posts/run-now.ts", "utf8");
assert.equal(runNowEndpointSource.includes("dispatchDiscordPostsForGuild"), true);
assert.equal(runNowEndpointSource.includes("isActiveSubscriptionStatus"), true);
assert.equal(runNowEndpointSource.includes("force: true"), true);
const discordChannelsEndpointSource = readFileSync("functions/api/servers/[serverId]/discord-channels.ts", "utf8");
assert.equal(discordChannelsEndpointSource.includes("fetchDiscordPostingChannels"), true);
assert.equal(discordChannelsEndpointSource.includes("can_post"), true);
assert.equal(discordChannelsEndpointSource.includes("missing_permissions"), true);
assert.equal(discordChannelsEndpointSource.includes("linked_servers.guild_id"), true);
assert.equal(discordChannelsEndpointSource.includes("selected_guild_id"), true);
assert.equal(discordChannelsEndpointSource.includes("missing_guild_id"), true);
assert.equal(discordChannelsEndpointSource.includes("missing_bot_token"), true);
assert.equal(discordChannelsEndpointSource.includes("bot_not_in_guild"), true);
assert.equal(discordChannelsEndpointSource.includes("discord_api_403"), true);
assert.equal(discordChannelsEndpointSource.includes("DISCORD_BOT_TOKEN"), true);
assert.equal(discordChannelsEndpointSource.includes("bot_token_configured"), true);
assert.equal(discordChannelsEndpointSource.includes("ChannelFetchDiagnostics"), true);
assert.equal(discordChannelsEndpointSource.includes("DZN bot is not connected to this Discord server yet"), true);
assert.equal(discordChannelsEndpointSource.includes("guilds/${encodeURIComponent(guildId)}/channels"), false);
assert.equal(postingSource.includes("/guilds/${encodeURIComponent(guildId)}/channels"), true);
assert.equal(postingSource.includes("discord_api_invalid_response"), true);

const migrationSource = readFileSync("migrations/0015_automation_pipeline.sql", "utf8");
assert.equal(migrationSource.includes("CREATE TABLE IF NOT EXISTS server_subscriptions"), true);
assert.equal(migrationSource.includes("CREATE TABLE IF NOT EXISTS server_posting_destinations"), true);
assert.equal(migrationSource.includes("CREATE TABLE IF NOT EXISTS automation_jobs"), true);
const cronMigrationSource = readFileSync("migrations/0016_automation_cron_runs.sql", "utf8");
assert.equal(cronMigrationSource.includes("CREATE TABLE IF NOT EXISTS automation_cron_runs"), true);
assert.equal(cronMigrationSource.includes("job_type TEXT NOT NULL"), true);
assert.equal(cronMigrationSource.includes("started_at TEXT"), true);
assert.equal(cronMigrationSource.includes("finished_at TEXT"), true);

const workflowSource = readFileSync(".github/workflows/dzn-adm-sync.yml", "utf8");
assert.equal(workflowSource.includes("Cloudflare Worker Cron is the primary 1-minute automation trigger. GitHub Actions is backup only."), true);
assert.equal(workflowSource.includes("- cron: \"*/5 * * * *\""), true);
assert.equal(workflowSource.includes("x-dzn-cron-secret"), true);
assert.equal(workflowSource.includes("LEGACY_SYNC_CRON_SECRET"), false);
assert.equal(workflowSource.includes("\"source\":\"github-backup\""), true);
assert.equal(workflowSource.indexOf("/api/sync/metadata/run") < workflowSource.indexOf("/api/sync/adm/run"), true);
assert.equal(workflowSource.indexOf("/api/sync/adm/run") < workflowSource.indexOf("/api/sync/discord-posts/run"), true);

const workerConfigSource = readFileSync("wrangler.adm-sync.toml", "utf8");
assert.equal(workerConfigSource.includes("crons = [\"* * * * *\"]"), true);
assert.equal(workerConfigSource.includes("DZN_APP_URL = \"https://dzn-network.pages.dev\""), true);
const workerSource = readFileSync("workers/adm-sync-worker.ts", "utf8");
assert.equal(workerSource.includes("DZN_CRON_SECRET"), true);
assert.equal(workerSource.includes("env.DZN_APP_URL"), true);
assert.equal(workerSource.includes("x-dzn-cron-secret"), true);
assert.equal(workerSource.includes("env.SYNC_CRON_SECRET"), false);
assert.equal(workerSource.includes("source: \"cloudflare\""), true);
assert.equal(workerSource.indexOf("/api/sync/metadata/run") < workerSource.indexOf("/api/sync/adm/run"), true);
assert.equal(workerSource.indexOf("/api/sync/adm/run") < workerSource.indexOf("/api/sync/discord-posts/run"), true);

const cronAuthSource = readFileSync("functions/_lib/cron-auth.ts", "utf8");
assert.equal(cronAuthSource.includes("env.DZN_CRON_SECRET || null"), true);
assert.equal(cronAuthSource.includes("env.SYNC_CRON_SECRET"), false);

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
assert.equal(packageJson.scripts["audit:system"], "tsx scripts/audit-dzn-system.ts");
assert.equal(packageJson.scripts["audit:adm-sync"], "tsx scripts/audit-adm-sync.ts");
assert.equal(packageJson.scripts["check:automation-live"], "tsx scripts/check-automation-live.ts");
assert.equal(packageJson.scripts["test:full-system"], "npm run lint && npm run test && npm run build && npm run audit:system && npm run audit:adm-sync && npm run check:automation-live");

const systemAuditSource = readFileSync("scripts/audit-dzn-system.ts", "utf8");
assert.equal(systemAuditSource.includes("DISCORD_BOT_TOKEN"), true);
assert.equal(systemAuditSource.includes("DZN_CRON_SECRET"), true);
assert.equal(systemAuditSource.includes("STRIPE_PRICE_PARTNER"), true);
assert.equal(systemAuditSource.includes("workers/adm-sync-worker.ts"), true);
assert.equal(systemAuditSource.includes("functions/api/sync/metadata/run.ts"), true);
assert.equal(systemAuditSource.includes("functions/api/sync/discord-posts/run.ts"), true);
assert.equal(systemAuditSource.includes("functions/api/servers/[serverId]/auto-posts/run-now.ts"), true);
assert.equal(systemAuditSource.includes("auditAdmSyncWiring"), true);
assert.equal(systemAuditSource.includes("0018_adm_reset_state_tracking.sql"), true);
assert.equal(systemAuditSource.includes("0019_adm_discovery_and_nitrado_settings.sql"), true);
assert.equal(systemAuditSource.includes("0020_adm_observed_cadence.sql"), true);
assert.equal(systemAuditSource.includes("Total checks"), true);

const admAuditSource = readFileSync("scripts/audit-adm-sync.ts", "utf8");
assert.equal(admAuditSource.includes("pickNewestAdmFile"), true);
assert.equal(admAuditSource.includes("adm_discovery_interval_minutes"), true);
assert.equal(admAuditSource.includes("runAdmDiscoveryForLinkedServer"), true);
assert.equal(admAuditSource.includes("waiting_after_restart"), true);
assert.equal(admAuditSource.includes("latest_adm_unreadable"), true);
assert.equal(admAuditSource.includes("delayed_after_restart"), true);
assert.equal(admAuditSource.includes("queueDiscordPostUpdatesForGuild"), true);
assert.equal(readFileSync("migrations/0018_adm_reset_state_tracking.sql", "utf8").includes("last_restart_detected_source"), true);
assert.equal(readFileSync("migrations/0019_adm_discovery_and_nitrado_settings.sql", "utf8").includes("nitrado_log_playerlist_confirmed"), true);
assert.equal(readFileSync("migrations/0020_adm_observed_cadence.sql", "utf8").includes("observed_adm_cadence_minutes"), true);

const liveCheckSource = readFileSync("scripts/check-automation-live.ts", "utf8");
assert.equal(liveCheckSource.includes("https://dzn-network.pages.dev"), true);
assert.equal(liveCheckSource.includes("/api/public/home-stats"), true);
assert.equal(liveCheckSource.includes("x-dzn-cron-secret"), true);
assert.equal(liveCheckSource.includes("/api/sync/metadata/run"), true);
assert.equal(liveCheckSource.includes("/api/sync/adm/run"), true);
assert.equal(liveCheckSource.includes("/api/sync/discord-posts/run"), true);
assert.equal(liveCheckSource.includes("/api/automation/health"), true);
assert.equal(liveCheckSource.includes("Skipped because DZN_CRON_SECRET is not set"), true);

const buttonMapDoc = readFileSync("docs/DASHBOARD_BUTTON_MAP.md", "utf8");
assert.equal(buttonMapDoc.includes("View Public Page"), true);
assert.equal(buttonMapDoc.includes("Refresh Server Info"), true);
assert.equal(buttonMapDoc.includes("Run Auto Post Dispatcher Now"), true);
assert.equal(buttonMapDoc.includes("Remove Server From DZN"), true);
assert.equal(buttonMapDoc.includes("Handler / link"), true);
assert.equal(buttonMapDoc.includes("Current status"), true);

const syncMapDoc = readFileSync("docs/SYNC_SYSTEM_MAP.md", "utf8");
assert.equal(syncMapDoc.includes("Fast Server Status Sync"), true);
assert.equal(syncMapDoc.includes("ADM / Backend Log Sync"), true);
assert.equal(syncMapDoc.includes("ADM Discovery vs ADM Processing"), true);
assert.equal(syncMapDoc.includes("Observed ADM cadence"), true);
assert.equal(syncMapDoc.includes("Reduce Log Output"), true);
assert.equal(syncMapDoc.includes("Admin Log: Enabled"), true);
assert.equal(syncMapDoc.includes("DZN attempts to verify these automatically"), true);
assert.equal(syncMapDoc.includes("Discord Auto-Post Dispatcher"), true);
assert.equal(syncMapDoc.includes("Cloudflare Worker Cron"), true);
assert.equal(syncMapDoc.includes("GitHub Actions Backup"), true);
assert.equal(syncMapDoc.includes("Partner | Every 1 minute"), true);
assert.equal(syncMapDoc.includes("ADM remains limited to 10 minutes minimum"), true);

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardSource.includes("Discord Auto Posts"), true);
assert.equal(dashboardSource.includes("Automation Health"), true);
assert.equal(dashboardSource.includes("Step 1: Choose Channel"), true);
assert.equal(dashboardSource.includes("Step 2: Choose Auto Posts"), true);
assert.equal(dashboardSource.includes("Save Auto Post Setup"), true);
assert.equal(dashboardSource.includes("Saved Auto Post Setups"), true);
assert.equal(dashboardSource.includes("DZN already knows your connected Discord server"), true);
assert.equal(dashboardSource.includes("Loading Discord channels"), true);
assert.equal(dashboardSource.includes("Channel Fetch Diagnostics"), true);
assert.equal(dashboardSource.includes("Advanced manual channel ID"), false);
assert.equal(dashboardSource.includes("Only use this if DZN cannot fetch your Discord channels automatically."), true);
assert.equal(dashboardSource.includes("Invite DZN Bot"), true);
assert.equal(dashboardSource.includes("selectedPostTypes.includes(option.key)"), true);
assert.equal(dashboardSource.includes("BOT MODE"), true);
assert.equal(dashboardSource.includes("WEBHOOK FALLBACK"), true);
assert.equal(dashboardSource.includes("Active"), true);
assert.equal(dashboardSource.includes("Server Status Sync:"), true);
assert.equal(dashboardSource.includes("ADM Discovery:"), true);
assert.equal(dashboardSource.includes("Nitrado Log Settings"), true);
assert.equal(dashboardSource.includes("Check Nitrado Log Settings"), true);
assert.equal(dashboardSource.includes("Nitrado log settings verified automatically"), true);
assert.equal(dashboardSource.includes("Manual fallback"), true);
assert.equal(dashboardSource.includes("Checks for new ADM files every"), true);
assert.equal(dashboardSource.includes("Processes readable ADM data every"), true);
assert.equal(dashboardSource.includes("Observed ADM Cadence"), true);
assert.equal(dashboardSource.includes("Next Expected ADM Update"), true);
assert.equal(dashboardSource.includes("Last Cron Source"), true);
assert.equal(dashboardSource.includes("Missing permissions"), true);
assert.equal(dashboardSource.includes("ADM logs can appear 5-45 minutes after a restart"), true);
assert.equal(postingEndpointSource.includes("DZN will auto-post and edit this embed using the bot in the selected channel."), true);
assert.equal(postingEndpointSource.includes("DZN will auto-post using the saved webhook fallback."), true);

const nitradoLogSettingsEndpointSource = readFileSync("functions/api/servers/[serverId]/nitrado-log-settings.ts", "utf8");
assert.equal(nitradoLogSettingsEndpointSource.includes("fetchNitradoLogSettingsVerification"), true);
assert.equal(nitradoLogSettingsEndpointSource.includes("recordNitradoLogSettingsVerification"), true);
assert.equal(nitradoLogSettingsEndpointSource.includes("manual_required"), true);

const nitradoSource = readFileSync("functions/_lib/nitrado.ts", "utf8");
assert.equal(nitradoSource.includes("fetchNitradoLogSettingsVerification"), true);
assert.equal(nitradoSource.includes("reduce_log_output_disabled"), true);
assert.equal(nitradoSource.includes("log_playerlist_enabled"), true);

const healthEndpointSource = readFileSync("functions/api/automation/health.ts", "utf8");
assert.equal(healthEndpointSource.includes("requireDznAdmin"), true);
assert.equal(healthEndpointSource.includes("getAutomationHealth"), true);

console.log("Automation plan and pipeline tests passed.");
