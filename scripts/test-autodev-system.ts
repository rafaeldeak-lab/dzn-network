import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { classifyPath, detectDestructiveMigration, classifyRecoverableProductionStatus } from "./autodev/risk-classifier";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const config = JSON.parse(read(".autodev/config.json"));
assert.equal(config.mode, "pr_only");
assert.equal(config.scope, "adm_tracking_only");
assert.equal(config.admOnly.enabled, true);
assert.equal(config.allowDirectMainPush, false);
assert.equal(config.allowAutoMergeLowRisk, false);
assert.equal(config.allowCodexHighRiskFixes, false);
assert.equal(config.maxFixAttemptsPerRun, 3);
assert.equal(config.maxChangedFilesPerRun <= 20, true);

assert.equal(classifyPath("functions/api/auth/me.ts").risk, "blocked");
assert.equal(classifyPath("functions/api/billing/checkout.ts").risk, "blocked");
assert.equal(classifyPath("functions/api/stripe/webhook.ts").risk, "blocked");
assert.equal(classifyPath("functions/_lib/discord.ts").risk, "blocked");
assert.equal(classifyPath("app/events/page.tsx").risk, "blocked");
assert.equal(classifyPath("functions/_lib/crypto.ts", "TOKEN_ENCRYPTION_KEY").risk, "blocked");
assert.equal(classifyPath("migrations/9999_test.sql", "DROP TABLE player_profiles;").risk, "blocked");
assert.equal(classifyPath("docs/CODEX_AUTODEV.md").risk, "low");
assert.equal(classifyPath("scripts/test-nitrado-file-read-diagnostics.ts").risk, "low");
assert.equal(classifyPath("functions/_lib/adm-sync.ts", "UPDATE player_profiles SET kills = kills + 1").risk, "high");
assert.equal(classifyPath("migrations/9999_adm.sql", "ALTER TABLE adm_sync_file_state ADD COLUMN next_retry_at TEXT;").risk, "medium");
assert.equal(classifyPath("migrations/9999_billing.sql", "ALTER TABLE subscriptions ADD COLUMN test TEXT;").risk, "blocked");

assert.deepEqual(detectDestructiveMigration("DROP TABLE player_profiles;", "migrations/9999.sql").length > 0, true);
assert.deepEqual(detectDestructiveMigration("DELETE FROM player_profiles;", "migrations/9999.sql").length > 0, true);
assert.deepEqual(detectDestructiveMigration("CREATE TABLE player_stats (id TEXT);", "migrations/9999.sql").length > 0, true);
assert.deepEqual(detectDestructiveMigration("CREATE TABLE IF NOT EXISTS safe_table (id TEXT);", "migrations/9999.sql"), []);

assert.equal(classifyRecoverableProductionStatus("nitrado_upstream_down"), true);
assert.equal(classifyRecoverableProductionStatus("waiting_for_nitrado"), true);
assert.equal(classifyRecoverableProductionStatus("latest_adm_unreadable"), true);
assert.equal(classifyRecoverableProductionStatus("401"), false);
assert.equal(classifyRecoverableProductionStatus("403"), false);

const workflows = readdirSync(".github/workflows").filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
const workflowText = workflows.map((name) => read(`.github/workflows/${name}`)).join("\n");
for (const secret of ["DISCORD_CLIENT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SESSION_SECRET", "TOKEN_ENCRYPTION_KEY"]) {
  assert.equal(workflowText.includes(`secrets.${secret}`), false, `${secret} must not be referenced by GitHub workflows`);
}
assert.equal(read(".github/workflows/dzn-adm-sync.yml").includes("schedule:"), false);
assert.equal(read(".github/workflows/dzn-adm-sync.yml").includes("workflow_dispatch:"), true);
for (const workflowName of ["DZN ADM AutoDev Audit", "DZN ADM Post Deploy Verify", "DZN ADM Cycle Watch", "DZN ADM Codex Safe Fix", "DZN ADM Worker Manual Trigger", "DZN Nitrado ADM Diagnostics"]) {
  assert.equal(workflowText.includes(`name: ${workflowName}`), true, `${workflowName} must exist`);
}
assert.equal(read("README.md").includes("Automatic ADM sync runs from a separate Cloudflare Worker"), true);
assert.equal(read("wrangler.adm-sync.toml").includes('name = "dzn-adm-sync-worker"'), true);
assert.equal(read("wrangler.adm-sync.toml").includes("crons ="), true);

const productionSmoke = read("scripts/autodev/production-smoke.ts");
assert.equal(productionSmoke.includes("/api/debug/nitrado-admin-logs"), true);
assert.equal(productionSmoke.includes("/api/debug/nitrado-file-read"), true);
assert.equal(productionSmoke.includes("result.status === 401"), true);
assert.equal(productionSmoke.includes("Protected endpoint must return 401"), true);
assert.equal(productionSmoke.includes("ADM Worker heartbeat is stale beyond threshold."), true);
assert.equal(productionSmoke.includes("recoverable Nitrado states do not fail production smoke"), true);
assert.equal(read(".github/workflows/dzn-post-deploy-verify.yml").includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
const cycleWatchWorkflow = read(".github/workflows/dzn-adm-cycle-watch.yml");
const postDeployWorkflow = read(".github/workflows/dzn-post-deploy-verify.yml");
assert.equal(cycleWatchWorkflow.includes("Resolve ADM cycle watch result"), true);
assert.equal(cycleWatchWorkflow.includes("steps.adm-live.outputs.result"), true);
assert.equal(cycleWatchWorkflow.includes("Protected ADM health/live evidence failed."), true);
assert.equal(cycleWatchWorkflow.includes("optional direct evidence as unavailable"), true);
assert.equal(cycleWatchWorkflow.includes("if: steps.adm-watch.outcome == 'failure' || steps.adm-live.outcome == 'failure'"), false);
assert.equal(cycleWatchWorkflow.includes("continue-on-error"), false);
assert.equal(cycleWatchWorkflow.includes("echo \"result=$code\" >> \"$GITHUB_OUTPUT\""), true);
assert.equal(postDeployWorkflow.includes("Resolve post deploy verification result"), true);
assert.equal(postDeployWorkflow.includes("steps.adm-live.outputs.result"), true);
assert.equal(postDeployWorkflow.includes("Production smoke or protected live ADM evidence failed."), true);
assert.equal(postDeployWorkflow.includes("optional direct evidence as unavailable"), true);
assert.equal(postDeployWorkflow.includes("steps.adm.outcome == 'failure' || steps.adm-live.outcome == 'failure'"), false);
assert.equal(postDeployWorkflow.includes("continue-on-error"), false);
assert.equal(postDeployWorkflow.includes("steps.smoke.outputs.result"), true);

const admWatch = read("scripts/autodev/adm-cycle-watch.ts");
assert.equal(admWatch.includes("classifyRecoverableProductionStatus"), true);
assert.equal(admWatch.includes("result.status === 401 || result.status === 403"), true);
assert.equal(admWatch.includes("ADM Worker heartbeat fresh. Current ADM state is recoverable: NITRADO_UPSTREAM_DOWN. Retry/backoff is active."), true);
assert.equal(admWatch.includes("heartbeatAgeSeconds"), true);
assert.equal(admWatch.includes("> 15 * 60"), true);
assert.equal(admWatch.includes("isStuckImportJob"), true);
assert.equal(admWatch.toLowerCase().includes("stripe"), false);
assert.equal(admWatch.toLowerCase().includes("billing"), false);

const proposeFix = read("scripts/autodev/propose-fix.ts");
assert.equal(proposeFix.includes("AUTODEV_ENABLE_PROPOSE_FIX"), true);
assert.equal(proposeFix.includes("disabled by default"), true);

const pickSafeIssue = read("scripts/autodev/pick-safe-issue.ts");
assert.equal(pickSafeIssue.includes('"adm-tracking"'), true);
assert.equal(pickSafeIssue.includes('"autodev-safe-fix"'), true);
assert.equal(pickSafeIssue.includes('"billing"'), true);
assert.equal(pickSafeIssue.includes('"discord-oauth"'), true);

const scripts = JSON.parse(read("package.json")).scripts;
for (const script of ["autodev:audit", "autodev:quality", "autodev:production-smoke", "autodev:adm-watch", "autodev:create-issue", "autodev:risk", "autodev:pick-safe-issue", "verify:adm-live", "test:autodev", "test:autodev-codex"]) {
  assert.equal(typeof scripts[script], "string", `${script} must exist`);
}

assert.equal(read("scripts/test-auto-sync-dashboard-ui.ts").includes("Check ADM Files"), true);
const admHealth = read("functions/api/autodev/adm-health.ts");
assert.equal(admHealth.includes("requireCronSecret"), true);
assert.equal(admHealth.includes("last_successful_sync_at"), false);
assert.equal(admHealth.includes("safeFirst"), true);
assert.equal(admHealth.includes("safeAll"), true);
assert.equal(admHealth.includes("scope: \"adm_tracking_only\""), true);
assert.equal(admHealth.includes("NITRADO_UPSTREAM_DOWN"), true);
assert.equal(admHealth.includes("manualActionRequired"), true);
assert.equal(admHealth.includes("adm_worker_heartbeat"), true);
assert.equal(admHealth.includes("heartbeatAgeSeconds"), true);
assert.equal(admHealth.includes("worker_heartbeat_missing"), true);
assert.equal(admHealth.includes("worker_heartbeat_stale"), true);
assert.equal(admHealth.includes("SELECT access_token"), false);
assert.equal(admHealth.includes("raw signed"), false);
const admWorker = read("workers/adm-sync-worker.ts");
assert.equal(admWorker.includes("safeWriteAdmWorkerHeartbeatStarted"), true);
assert.equal(admWorker.includes("safeWriteAdmWorkerHeartbeatFinished"), true);
assert.equal(admWorker.includes("scheduled_tick_started"), true);
assert.equal(admWorker.includes("NITRADO_UPSTREAM_DOWN"), true);
assert.equal(admWorker.includes("WORKER_SUBREQUEST_LIMIT"), true);
const heartbeatMigration = read("migrations/0036_adm_worker_heartbeat.sql");
assert.equal(heartbeatMigration.includes("CREATE TABLE IF NOT EXISTS adm_worker_heartbeat"), true);
assert.deepEqual(detectDestructiveMigration(heartbeatMigration, "migrations/0036_adm_worker_heartbeat.sql"), []);
const dashboardHealth = read("functions/api/servers/[serverId]/dashboard/health.ts");
assert.equal(dashboardHealth.includes("adm_sync_state.last_successful_sync_at"), false);
assert.equal(existsSync(".autodev/config.json"), true);
assert.equal(existsSync("docs/CODEX_AUTODEV.md"), true);
assert.equal(existsSync(".github/workflows/dzn-autodev-audit.yml"), true);
assert.equal(existsSync(".github/workflows/dzn-post-deploy-verify.yml"), true);
assert.equal(existsSync(".github/workflows/dzn-adm-cycle-watch.yml"), true);
const admLiveVerify = read("scripts/verify-production-adm-live.ts");
assert.equal(admLiveVerify.includes("gameserver_details_log_files_noftp_download"), true);
assert.equal(admLiveVerify.includes("ADM Worker has not selected this service within 30 minutes"), true);
assert.equal(admLiveVerify.includes("public home-stats ADM fallback"), true);
assert.equal(admLiveVerify.includes("Permanent ADM data exists but public home-stats"), true);
assert.equal(admLiveVerify.includes("shouldUseProtectedAdmHealthFallbackBeforeD1"), true);
assert.equal(admLiveVerify.includes("process.env.GITHUB_ACTIONS"), true);
assert.equal(admLiveVerify.includes("CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID"), true);
assert.equal(admLiveVerify.includes("Remote D1 query unavailable; using protected ADM health fallback."), true);

console.log("AutoDev system tests passed.");
