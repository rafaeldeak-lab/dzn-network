import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
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
assert.equal(getPlanByKey("starter").adm_pull_interval_minutes, 60);
assert.equal(getPlanByKey("pro").server_status_interval_minutes, 5);
assert.equal(getPlanByKey("pro").adm_pull_interval_minutes, 30);
assert.equal(getPlanByKey("network").server_status_interval_minutes, 3);
assert.equal(getPlanByKey("network").adm_pull_interval_minutes, 15);
assert.equal(getPlanByKey("partner").server_status_interval_minutes, 1);
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
assert.equal(automationSource.includes("queueDiscordPostUpdatesForGuild"), true);
assert.equal(automationSource.includes("getDueStatusAutomationServers"), true);
assert.equal(automationSource.includes("getDueAdmAutomationServers"), true);
assert.equal(automationSource.includes("recoverStuckAutomationLocks"), true);
assert.equal(automationSource.includes("Recovered stale status sync lock after 10 minutes."), true);
assert.equal(automationSource.includes("Recovered stale ADM sync lock after 30 minutes."), true);

const postingSource = readFileSync("functions/_lib/discord-posting.ts", "utf8");
assert.equal(postingSource.includes("last_payload_hash"), true);
assert.equal(postingSource.includes("discord_webhook_url"), true);
assert.equal(postingSource.includes("sendOrEditWithBot"), true);
assert.equal(postingSource.includes("DISCORD_BOT_TOKEN"), true);
assert.equal(postingSource.includes("DZN DISCORD AUTO POST DISPATCH READY"), true);

const migrationSource = readFileSync("migrations/0015_automation_pipeline.sql", "utf8");
assert.equal(migrationSource.includes("CREATE TABLE IF NOT EXISTS server_subscriptions"), true);
assert.equal(migrationSource.includes("CREATE TABLE IF NOT EXISTS server_posting_destinations"), true);
assert.equal(migrationSource.includes("CREATE TABLE IF NOT EXISTS automation_jobs"), true);

const workflowSource = readFileSync(".github/workflows/dzn-adm-sync.yml", "utf8");
assert.equal(workflowSource.includes("Cloudflare Worker Cron is the primary 1-minute automation trigger. GitHub Actions is backup only."), true);
assert.equal(workflowSource.includes("- cron: \"*/5 * * * *\""), true);
assert.equal(workflowSource.includes("x-dzn-cron-secret"), true);
assert.equal(workflowSource.indexOf("/api/sync/metadata/run") < workflowSource.indexOf("/api/sync/adm/run"), true);
assert.equal(workflowSource.indexOf("/api/sync/adm/run") < workflowSource.indexOf("/api/sync/discord-posts/run"), true);

const workerConfigSource = readFileSync("wrangler.adm-sync.toml", "utf8");
assert.equal(workerConfigSource.includes("crons = [\"* * * * *\"]"), true);
const workerSource = readFileSync("workers/adm-sync-worker.ts", "utf8");
assert.equal(workerSource.includes("DZN_CRON_SECRET"), true);
assert.equal(workerSource.includes("x-dzn-cron-secret"), true);
assert.equal(workerSource.indexOf("/api/sync/metadata/run") < workerSource.indexOf("/api/sync/adm/run"), true);
assert.equal(workerSource.indexOf("/api/sync/adm/run") < workerSource.indexOf("/api/sync/discord-posts/run"), true);

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardSource.includes("Discord Auto Posts"), true);
assert.equal(dashboardSource.includes("Automation Health"), true);
assert.equal(dashboardSource.includes("Send Test Post"), true);
assert.equal(dashboardSource.includes("Bot mode"), true);
assert.equal(dashboardSource.includes("Server status checked every"), true);
assert.equal(dashboardSource.includes("ADM logs can appear 5-45 minutes after a restart"), true);

const healthEndpointSource = readFileSync("functions/api/automation/health.ts", "utf8");
assert.equal(healthEndpointSource.includes("requireDznAdmin"), true);
assert.equal(healthEndpointSource.includes("getAutomationHealth"), true);

console.log("Automation plan and pipeline tests passed.");
