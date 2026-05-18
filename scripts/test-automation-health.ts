import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getAdmPullInterval,
  getServerStatusInterval,
  hasAutoPost,
} from "../lib/billing/plans";
import { isActiveSubscriptionStatus } from "../functions/_lib/automation";
import { effectiveEntitlementPlan } from "../functions/_lib/plans";
import { isCronSecretAuthorized, requireCronSecret } from "../functions/_lib/cron-auth";
import type { Env } from "../functions/_lib/types";

const env = { DZN_CRON_SECRET: "unit-test-secret" } as Env;

assert.equal(requireCronSecret(new Request("https://dzn.test"), env)?.status, 401);
assert.equal(requireCronSecret(new Request("https://dzn.test", {
  headers: { "x-dzn-cron-secret": "wrong" },
}), env)?.status, 401);
assert.equal(requireCronSecret(new Request("https://dzn.test", {
  headers: { "x-dzn-cron-secret": "unit-test-secret" },
}), env), null);
assert.equal(isCronSecretAuthorized(new Request("https://dzn.test"), env), false);
assert.equal(isCronSecretAuthorized(new Request("https://dzn.test", {
  headers: { "x-dzn-cron-secret": "wrong" },
}), env), false);
assert.equal(isCronSecretAuthorized(new Request("https://dzn.test", {
  headers: { "x-dzn-cron-secret": "unit-test-secret" },
}), env), true);

assert.equal(getServerStatusInterval("starter"), 7);
assert.equal(getAdmPullInterval("starter"), 60);
assert.equal(getServerStatusInterval("pro"), 5);
assert.equal(getAdmPullInterval("pro"), 30);
assert.equal(getServerStatusInterval("network"), 3);
assert.equal(getAdmPullInterval("network"), 15);
assert.equal(getServerStatusInterval("partner"), 1);
assert.equal(getAdmPullInterval("partner"), 10);
assert.equal(getServerStatusInterval("free") >= 1, true);
assert.equal(getAdmPullInterval("free") >= 10, true);

assert.equal(hasAutoPost("starter", "basic_status_embed"), true);
assert.equal(hasAutoPost("starter", "leaderboard_embed"), false);
assert.equal(hasAutoPost("pro", "leaderboard_embed"), true);
assert.equal(hasAutoPost("pro", "daily_summary_embed"), true);
assert.equal(hasAutoPost("pro", "network_ranking_embed"), false);
assert.equal(hasAutoPost("network", "server_vs_server_embed"), true);
assert.equal(hasAutoPost("network", "partner_featured_embed"), false);
assert.equal(hasAutoPost("partner", "partner_featured_embed"), true);
assert.equal(hasAutoPost("partner", "priority_status_embed"), true);

assert.equal(isActiveSubscriptionStatus("active"), true);
assert.equal(isActiveSubscriptionStatus("trialing"), true);
assert.equal(isActiveSubscriptionStatus("past_due"), false);
assert.equal(isActiveSubscriptionStatus("canceled"), false);
assert.equal(isActiveSubscriptionStatus("unpaid"), false);
assert.equal(isActiveSubscriptionStatus("incomplete"), false);
assert.equal(effectiveEntitlementPlan("partner", "past_due"), "free");
assert.equal(effectiveEntitlementPlan("partner", "canceled"), "free");

const cronAuthSource = readFileSync("functions/_lib/cron-auth.ts", "utf8");
assert.equal(cronAuthSource.includes("requireCronSecret"), true);
assert.equal(cronAuthSource.includes("env.DZN_CRON_SECRET || null"), true);
assert.equal(cronAuthSource.includes("SYNC_CRON_SECRET"), false);

for (const file of [
  "functions/api/sync/metadata/run.ts",
  "functions/api/sync/adm/run.ts",
  "functions/api/sync/discord-posts/run.ts",
]) {
  const source = readFileSync(file, "utf8");
  assert.equal(source.includes("requireCronSecret"), true, `${file} should use shared cron auth`);
  assert.equal(source.includes("x-dzn-cron-secret"), false, `${file} should not hardcode the cron header`);
}

const workerSource = readFileSync("workers/adm-sync-worker.ts", "utf8");
assert.equal(workerSource.includes("env.DZN_APP_URL"), true);
assert.equal(workerSource.includes("https://d6f44950.dzn-network.pages.dev"), false);
assert.equal(workerSource.includes("x-dzn-cron-secret"), true);
assert.equal(workerSource.indexOf("/api/sync/metadata/run") < workerSource.indexOf("/api/sync/adm/run"), true);
assert.equal(workerSource.indexOf("/api/sync/adm/run") < workerSource.indexOf("/api/sync/discord-posts/run"), true);

const workflowSource = readFileSync(".github/workflows/dzn-adm-sync.yml", "utf8");
assert.equal(workflowSource.includes("- cron: \"*/5 * * * *\""), true);
assert.equal(workflowSource.includes("Cloudflare Worker Cron is the primary 1-minute automation trigger. GitHub Actions is backup only."), true);
assert.equal(workflowSource.includes("x-dzn-cron-secret"), true);
assert.equal(workflowSource.includes("DZN_CRON_SECRET"), true);
assert.equal(workflowSource.includes("https://dzn-network.pages.dev"), true);

const automationSource = readFileSync("functions/_lib/automation.ts", "utf8");
assert.equal(automationSource.includes("automation_cron_runs"), true);
assert.equal(automationSource.includes("job_type"), true);
assert.equal(automationSource.includes("started_at"), true);
assert.equal(automationSource.includes("finished_at"), true);
assert.equal(automationSource.includes("migrationWarning"), true);
assert.equal(automationSource.includes("D1 migration history needs attention"), true);
assert.equal(automationSource.includes("latest_cloudflare_cron_run_at"), true);
assert.equal(automationSource.includes("latest_github_backup_cron_run_at"), true);

const lockRecoverySource = automationSource.slice(
  automationSource.indexOf("export async function recoverStuckAutomationLocks"),
  automationSource.indexOf("export async function getAutomationHealth"),
);
assert.equal(lockRecoverySource.includes("currently_checking_status = 0"), true);
assert.equal(lockRecoverySource.includes("currently_syncing_adm = 0"), true);
assert.equal(lockRecoverySource.includes("Recovered stale status sync lock after 10 minutes."), true);
assert.equal(lockRecoverySource.includes("Recovered stale ADM sync lock after 30 minutes."), true);
assert.equal(lockRecoverySource.includes("current_player_count = NULL"), false);
assert.equal(lockRecoverySource.includes("max_player_count = NULL"), false);
assert.equal(lockRecoverySource.includes("DELETE"), false);
assert.equal(lockRecoverySource.includes("server_public_cache"), false);

const postingSource = readFileSync("functions/_lib/discord-posting.ts", "utf8");
assert.equal(postingSource.indexOf("sendOrEditWithBot") < postingSource.indexOf("sendOrEditWithWebhook"), true);
assert.equal(postingSource.includes("checkDiscordPostingPermissions"), true);
assert.equal(postingSource.includes("View Channel"), true);
assert.equal(postingSource.includes("Send Messages"), true);
assert.equal(postingSource.includes("Embed Links"), true);
assert.equal(postingSource.includes("Read Message History"), true);
assert.equal(postingSource.includes("Manage Messages"), true);
assert.equal(postingSource.includes("DZN cannot auto-post here yet"), true);

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardSource.includes("Automation is running."), true);
assert.equal(dashboardSource.includes("Cloudflare Worker Cron is active."), true);
assert.equal(dashboardSource.includes("No recent automation cron check-in detected."), true);
assert.equal(dashboardSource.includes("Server Status Sync:"), true);
assert.equal(dashboardSource.includes("ADM Log Sync:"), true);
assert.equal(dashboardSource.includes("real-time logs"), false);
assert.equal(dashboardSource.includes("instant stats"), false);

console.log("Automation health hardening tests passed.");
