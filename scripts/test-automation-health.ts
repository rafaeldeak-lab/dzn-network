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
const syncSecretEnv = { SYNC_CRON_SECRET: "unit-test-secret" } as Env;

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
assert.equal(isCronSecretAuthorized(new Request("https://dzn.test", {
  headers: { "x-dzn-cron-secret": "unit-test-secret" },
}), syncSecretEnv), true);

assert.equal(getServerStatusInterval("starter"), 7);
assert.equal(getAdmPullInterval("starter"), 60);
assert.equal(getServerStatusInterval("pro"), 5);
assert.equal(getAdmPullInterval("pro"), 30);
assert.equal(getServerStatusInterval("network"), 1);
assert.equal(getAdmPullInterval("network"), 10);
assert.equal(getServerStatusInterval("premium"), 1);
assert.equal(getAdmPullInterval("premium"), 10);
assert.equal(getServerStatusInterval("partner"), 1);
assert.equal(getAdmPullInterval("partner"), 10);
assert.equal(getServerStatusInterval("free") >= 1, true);
assert.equal(getAdmPullInterval("free") >= 10, true);

assert.equal(hasAutoPost("starter", "basic_status_embed"), true);
assert.equal(hasAutoPost("starter", "leaderboard_embed"), false);
assert.equal(hasAutoPost("pro", "leaderboard_embed"), true);
assert.equal(hasAutoPost("pro", "daily_summary_embed"), true);
assert.equal(hasAutoPost("pro", "network_ranking_embed"), true);
assert.equal(hasAutoPost("network", "server_vs_server_embed"), true);
assert.equal(hasAutoPost("network", "partner_featured_embed"), true);
assert.equal(hasAutoPost("premium", "partner_featured_embed"), true);
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
assert.equal(cronAuthSource.includes("env.DZN_CRON_SECRET || env.SYNC_CRON_SECRET || null"), true);

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
assert.equal(workerSource.includes("runAdmWorkerSyncTick"), true);
assert.equal(workerSource.includes("runScheduledAdmSync"), false);
assert.equal(workerSource.includes("selectNextAdmLinkedServerForWorker"), false);
assert.equal(workerSource.includes("/api/sync/adm/run"), false);
assert.equal(workerSource.includes("results.push(await runDirectAdmSync(env, options, budget));"), true);
assert.equal(workerSource.includes("/api/sync/metadata/run"), false);
assert.equal(workerSource.includes("runCronEndpoint(CRON_ENDPOINTS[0], baseUrl, secret, options, budget)"), true);
assert.equal(workerSource.includes("hasScheduledRuntimeBudget"), true);

const workflowSource = readFileSync(".github/workflows/dzn-adm-sync.yml", "utf8");
assert.equal(workflowSource.includes("name: DZN ADM Worker Manual Trigger"), true);
assert.equal(workflowSource.includes("workflow_dispatch:"), true);
assert.equal(workflowSource.includes("schedule:"), false);
assert.equal(workflowSource.includes("- cron:"), false);
assert.equal(workflowSource.includes("x-dzn-cron-secret"), true);
assert.equal(workflowSource.includes("SYNC_CRON_SECRET"), true);
assert.equal(workflowSource.includes("DZN_CRON_SECRET"), true);
assert.equal(workflowSource.includes('CRON_SECRET="${DZN_CRON_SECRET:-${SYNC_CRON_SECRET:-}}"'), true);
assert.equal(workflowSource.includes("https://dzn-network.pages.dev"), true);

const automationSource = readFileSync("functions/_lib/automation.ts", "utf8").replace(/\r\n/g, "\n");
const admSyncSource = readFileSync("functions/_lib/adm-sync.ts", "utf8").replace(/\r\n/g, "\n");
const verifyAdmLiveSource = readFileSync("scripts/verify-production-adm-live.ts", "utf8").replace(/\r\n/g, "\n");
assert.equal(admSyncSource.includes("const scheduledTargetFileName = explicitTargetFileName ? null : sanitizeWorkerTargetAdmFilename(selected.target_adm_file);"), true);
assert.equal(admSyncSource.includes("ADM Worker paused before target ADM file read"), true);
assert.equal(admSyncSource.includes("const directFileName = firstString(\n      explicitTargetFileName,\n      scheduledTargetFileName"), true);
assert.equal(admSyncSource.includes("const directPath = firstString(\n      explicitTargetPath,\n      scheduledTargetPath"), true);
assert.equal(automationSource.includes("automation_cron_runs"), true);
assert.equal(automationSource.includes("job_type"), true);
assert.equal(automationSource.includes("started_at"), true);
assert.equal(automationSource.includes("finished_at"), true);
assert.equal(automationSource.includes("migrationWarning"), true);
assert.equal(automationSource.includes("D1 migration history needs attention"), true);
assert.equal(automationSource.includes("latest_cloudflare_cron_run_at"), true);
assert.equal(automationSource.includes("latest_github_backup_cron_run_at"), true);
assert.equal(automationSource.includes("latest_scheduled_nitrado_job"), true);
assert.equal(automationSource.includes("active_adm_import_jobs_count"), true);
assert.equal(automationSource.includes("stuck_adm_import_jobs_count"), true);
assert.equal(automationSource.includes("completed_adm_import_jobs_today"), true);
assert.equal(automationSource.includes("failed_retryable_adm_import_jobs"), true);
assert.equal(automationSource.includes("last_adm_import_chunk_processed_at"), true);
assert.equal(automationSource.includes("next_adm_processing_due_at"), true);
assert.equal(automationSource.includes("duration_ms"), true);
assert.equal(automationSource.includes("processed_count"), true);
assert.equal(automationSource.includes("buildAutomationCronHealth"), true);
assert.equal(automationSource.includes("cron_secret_mismatch"), true);
assert.equal(automationSource.includes("recoverStuckSyncLocksForServer"), true);
assert.equal(verifyAdmLiveSource.includes("last_status_check_at"), true, "verify:adm-live must read metadata attempt evidence separately from numeric success timestamps.");
assert.equal(verifyAdmLiveSource.includes("last_successful_status_check_at"), true, "verify:adm-live must distinguish latest successful numeric metadata from attempts.");
assert.equal(verifyAdmLiveSource.includes("last_failed_status_check_at"), true, "verify:adm-live must preserve explicit unavailable/error attempt evidence.");
assert.equal(verifyAdmLiveSource.includes("isUnavailablePlayerCountStatus"), true, "verify:adm-live must classify explicit unavailable metadata attempts.");
assert.equal(verifyAdmLiveSource.includes("Recent metadata attempt explicitly returned unavailable"), true, "verify:adm-live must warn, not pass as fresh numeric data, when Nitrado returns unavailable.");
assert.equal(verifyAdmLiveSource.includes("Metadata numeric player count is fresh enough"), true, "verify:adm-live numeric freshness pass must only be used for current numeric metadata.");
assert.equal(verifyAdmLiveSource.includes("Nitrado metadata/player count has no recent attempt"), true, "verify:adm-live must still fail when stale metadata has no recent attempt evidence.");
assert.equal(verifyAdmLiveSource.includes("currently_checking_status"), true, "verify:adm-live evidence should include metadata lock state.");
assert.equal(verifyAdmLiveSource.includes("status_sync_started_at"), true, "verify:adm-live evidence should include metadata lock lease start.");

const lockRecoverySource = automationSource.slice(
  automationSource.indexOf("export async function recoverStuckAutomationLocks"),
  automationSource.indexOf("export async function getAutomationHealth"),
);
assert.equal(lockRecoverySource.includes("currently_checking_status = 0"), true);
assert.equal(lockRecoverySource.includes("currently_syncing_adm = 0"), true);
assert.equal(lockRecoverySource.includes("status_sync_started_at = NULL"), true);
assert.equal(lockRecoverySource.includes("adm_sync_started_at = NULL"), true);
assert.equal(lockRecoverySource.includes("COALESCE(adm_sync_started_at, last_adm_pull_at, updated_at)"), true);
assert.equal(lockRecoverySource.includes("Recovered stale status sync lock after 10 minutes."), true);
assert.equal(lockRecoverySource.includes("Recovered stale ADM sync lock after 30 minutes."), true);
assert.equal(lockRecoverySource.includes("current_player_count = NULL"), false);
assert.equal(lockRecoverySource.includes("max_player_count = NULL"), false);
assert.equal(lockRecoverySource.includes("DELETE"), false);
assert.equal(lockRecoverySource.includes("server_public_cache"), false);

const serverLockRecoverySource = automationSource.slice(
  automationSource.indexOf("export async function recoverStuckSyncLocksForServer"),
  automationSource.indexOf("export async function getAutomationHealth"),
);
assert.equal(serverLockRecoverySource.includes("currently_checking_status = 0"), true);
assert.equal(serverLockRecoverySource.includes("currently_syncing_adm = 0"), true);
assert.equal(serverLockRecoverySource.includes("10 minutes"), true);
assert.equal(serverLockRecoverySource.includes("30 minutes"), true);
assert.equal(serverLockRecoverySource.includes("current_player_count = NULL"), false);
assert.equal(serverLockRecoverySource.includes("server_public_cache"), false);

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
assert.equal(automationSource.includes("Cloudflare Worker cron has not checked in recently. Automatic updates may not run."), true);
assert.equal(dashboardSource.includes("Recover Stuck Sync Locks"), true);
assert.equal(dashboardSource.includes("Cron Status"), true);
assert.equal(dashboardSource.includes("Latest Scheduled Job"), true);
assert.equal(dashboardSource.includes("Active ADM Jobs"), true);
assert.equal(dashboardSource.includes("Completed ADM Today"), true);
assert.equal(dashboardSource.includes("Automatic ADM Import Job"), true);
assert.equal(dashboardSource.includes("Tracking:"), true);
assert.equal(dashboardSource.includes("Fairness:"), true);
assert.equal(dashboardSource.includes("Bumps:"), true);
assert.equal(dashboardSource.includes("Check Nitrado Log Settings"), true);
assert.equal(dashboardSource.includes("Manual fallback"), true);
assert.equal(dashboardSource.includes("real-time logs"), false);
assert.equal(dashboardSource.includes("instant stats"), false);

const recoverLocksEndpointSource = readFileSync("functions/api/servers/[serverId]/sync/recover-locks.ts", "utf8");
assert.equal(recoverLocksEndpointSource.includes("recoverStuckSyncLocksForServer"), true);
assert.equal(recoverLocksEndpointSource.includes("requireServerOwnerOrDznAdmin"), true);

const cronProductionCheckSource = readFileSync("scripts/check-cron-production.ts", "utf8");
assert.equal(cronProductionCheckSource.includes("No cloudflare row in the last 5 minutes"), true);
assert.equal(cronProductionCheckSource.includes("/api/sync/metadata/run"), true);
const dueStateCheckSource = readFileSync("scripts/check-server-due-state.ts", "utf8");
assert.equal(dueStateCheckSource.includes("getServerStatusInterval(plan)"), true);
assert.equal(dueStateCheckSource.includes("ADM discovery"), true);

console.log("Automation health hardening tests passed.");
