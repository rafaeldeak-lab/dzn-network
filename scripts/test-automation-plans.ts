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

assert.equal(getPlanByKey("starter").server_status_interval_minutes, 7);
assert.equal(getPlanByKey("starter").adm_pull_interval_minutes, 60);
assert.equal(getPlanByKey("pro").server_status_interval_minutes, 5);
assert.equal(getPlanByKey("network").adm_pull_interval_minutes, 15);
assert.equal(getPlanByKey("partner").server_status_interval_minutes, 1);
assert.equal(getAdmPullInterval("partner"), 10);
assert.equal(getServerStatusInterval("partner"), 1);
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

const automationSource = readFileSync("functions/_lib/automation.ts", "utf8");
assert.equal(automationSource.includes("server_subscriptions"), true);
assert.equal(automationSource.includes("server_sync_state"), true);
assert.equal(automationSource.includes("server_public_cache"), true);
assert.equal(automationSource.includes("queueDiscordPostUpdatesForGuild"), true);
assert.equal(automationSource.includes("getDueStatusAutomationServers"), true);
assert.equal(automationSource.includes("getDueAdmAutomationServers"), true);

const postingSource = readFileSync("functions/_lib/discord-posting.ts", "utf8");
assert.equal(postingSource.includes("last_payload_hash"), true);
assert.equal(postingSource.includes("discord_webhook_url"), true);
assert.equal(postingSource.includes("DZN DISCORD AUTO POST DISPATCH READY"), true);

const migrationSource = readFileSync("migrations/0015_automation_pipeline.sql", "utf8");
assert.equal(migrationSource.includes("CREATE TABLE IF NOT EXISTS server_subscriptions"), true);
assert.equal(migrationSource.includes("CREATE TABLE IF NOT EXISTS server_posting_destinations"), true);
assert.equal(migrationSource.includes("CREATE TABLE IF NOT EXISTS automation_jobs"), true);

const workflowSource = readFileSync(".github/workflows/dzn-adm-sync.yml", "utf8");
assert.equal(workflowSource.includes("- cron: \"* * * * *\""), true);
assert.equal(workflowSource.indexOf("/api/sync/metadata/run") < workflowSource.indexOf("/api/sync/adm/run"), true);
assert.equal(workflowSource.indexOf("/api/sync/adm/run") < workflowSource.indexOf("/api/sync/discord-posts/run"), true);

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardSource.includes("Discord Auto Posts"), true);
assert.equal(dashboardSource.includes("Server status checked every"), true);
assert.equal(dashboardSource.includes("ADM logs can appear 5-45 minutes after a restart"), true);

console.log("Automation plan and pipeline tests passed.");
