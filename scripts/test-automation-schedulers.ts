import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/dzn-auto-update-schedulers.yml", "utf8");
const deployWorkflow = readFileSync(".github/workflows/dzn-auto-update-worker-deploy.yml", "utf8");
const worker = readFileSync("workers/adm-sync-worker.ts", "utf8");
const admSyncSource = readFileSync("functions/_lib/adm-sync.ts", "utf8");
const autoUpdateWorker = readFileSync("workers/dzn-auto-update-worker.ts", "utf8");
const autoUpdateConfig = readFileSync("wrangler.auto-update.toml", "utf8");
const discordRoute = readFileSync("functions/api/sync/discord-posts/run.ts", "utf8");
const discordPosting = readFileSync("functions/_lib/discord-posting.ts", "utf8");
const serverWarsCron = readFileSync("functions/api/cron/server-wars/refresh.ts", "utf8");
const metadataCron = readFileSync("functions/api/sync/metadata/run.ts", "utf8");
const serverMetadata = readFileSync("functions/_lib/server-metadata.ts", "utf8");
const automationSource = readFileSync("functions/_lib/automation.ts", "utf8");

assert.equal(workflow.includes("name: DZN Auto Update Schedulers"), true);
assert.equal(workflow.includes("workflow_dispatch:"), true);
assert.equal(workflow.includes("push:"), true);
assert.equal(workflow.includes("branches:"), true);
assert.equal(workflow.includes("- main"), true);
assert.equal(workflow.includes("schedule:"), true);
assert.equal(workflow.includes('cron: "17 * * * *"'), true);
assert.equal(workflow.includes("DZN Auto Update Schedulers Backup"), true);
assert.equal(workflow.includes("concurrency:"), true);

assert.equal(workflow.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(workflow.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(workflow.includes('CRON_SECRET="${DZN_CRON_SECRET:-${SYNC_CRON_SECRET:-}}"'), true);
assert.equal(workflow.includes("x-dzn-cron-secret: ${CRON_SECRET}"), true);
assert.equal(workflow.includes("x-sync-cron-secret: ${CRON_SECRET}"), true);
assert.equal(workflow.includes("x-cron-secret: ${CRON_SECRET}"), true);
assert.equal(workflow.includes("Authorization: Bearer ${CRON_SECRET}"), true);
assert.equal(workflow.includes("?cron_secret="), false);
assert.equal(workflow.includes("echo \"$CRON_SECRET\""), false);
assert.equal(workflow.includes("echo \"${CRON_SECRET}\""), false);

assert.equal(workflow.includes("/api/sync/metadata/run"), true);
assert.equal(workflow.includes('"max_servers":2'), true);
assert.equal(workflow.includes('"deadline_ms":2500'), true);
assert.equal(workflow.includes('"source":"github-backup"'), true);
assert.equal(workflow.includes("/api/cron/server-wars/refresh"), true);
assert.equal(workflow.includes('"max_events":1'), true);
assert.equal(workflow.includes('"max_finalizations":1'), true);
assert.equal(workflow.includes('"max_challenge_expirations":10'), true);
assert.equal(workflow.includes('"deadline_ms":2500'), true);
assert.equal(workflow.includes("/api/sync/discord-posts/run"), true);
assert.equal(workflow.includes('"max_jobs":2'), true);
assert.equal(workflow.includes("--max-time 75"), true);
assert.equal(workflow.includes("overall=0"), true, "Backup workflow must aggregate all task results before deciding overall status.");
assert.equal(workflow.includes('|| overall=1'), true, "Backup workflow must continue invoking later tasks after one task fails validation.");
assert.equal(
  workflow.indexOf('call_dzn "Server Wars refresh backup"') < workflow.indexOf('call_dzn "Discord posts dispatch backup"'),
  true,
  "Discord backup must still be invoked after the Server Wars backup call.",
);
assert.equal(workflow.includes("parsed.taskStatus ?? parsed.task_status ?? parsed.status"), true);
assert.equal(workflow.includes("parsed.noOpReason ?? parsed.no_op_reason"), true);
assert.equal(workflow.includes("parsed.warningCode ?? parsed.warning_code"), true);
assert.equal(workflow.includes("parsed.errorCode ?? parsed.error_code"), true);
assert.equal(workflow.includes("invalid or missing taskStatus"), true);
assert.equal(workflow.includes('acceptedStatuses = new Set(["success", "no_op", "warning"])'), true);
assert.equal(workflow.includes("no_op status requires a noOpReason"), true);
assert.equal(workflow.includes("zero processed/skipped/failed without explicit no-op or warning"), true);
assert.equal(workflow.includes("warning status requires a meaningful warning or error code"), true);
assert.equal(workflow.includes("noOpReason=${safe.noOpReason"), true);
assert.equal(workflow.includes("warningCode=${safe.warningCode"), true);
assert.equal(workflow.includes("errorCode=${safe.errorCode"), true);

assert.equal(workflow.includes("/api/sync/adm/run"), false, "The scheduler workflow must not become the primary ADM sync runner.");
assert.equal(workflow.includes("TOKEN_ENCRYPTION_KEY"), false);
assert.equal(workflow.includes("DISCORD_BOT_TOKEN"), false);
assert.equal(workflow.includes("STRIPE_SECRET_KEY"), false);

assert.equal(deployWorkflow.includes("name: DZN Auto Update Worker Deploy"), true);
assert.equal(deployWorkflow.includes("workflow_dispatch:"), true);
assert.equal(deployWorkflow.includes("push:"), false);
assert.equal(deployWorkflow.includes("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}"), true);
assert.equal(deployWorkflow.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}"), true);
assert.equal(deployWorkflow.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(deployWorkflow.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(deployWorkflow.includes("printf \"%s\" \"$CRON_SECRET\" | npx wrangler secret put DZN_CRON_SECRET --config wrangler.auto-update.toml"), true);
assert.equal(deployWorkflow.includes("echo \"$CRON_SECRET\""), false);
assert.equal(deployWorkflow.includes("wrangler.auto-update.toml"), true);
assert.equal(deployWorkflow.includes("/workers/scripts/dzn-auto-update-worker/schedules"), true);
assert.equal(deployWorkflow.includes("* * * * *"), true);
assert.equal(deployWorkflow.includes("schedule?.cron === \"* * * * *\""), true);
assert.equal(deployWorkflow.includes("schedule?.cron_trigger?.cron === \"* * * * *\""), true);
assert.equal(deployWorkflow.includes("schedule?.schedule === \"* * * * *\""), true);
assert.equal(deployWorkflow.includes("tee auto-update-deploy.txt"), true);
assert.equal(deployWorkflow.includes("auto-update-deploy.txt"), true);
assert.equal(deployWorkflow.includes("crons = [\"* * * * *\"]"), true);
assert.equal(deployWorkflow.includes("TOKEN_ENCRYPTION_KEY"), false);
assert.equal(deployWorkflow.includes("DISCORD_BOT_TOKEN"), false);
assert.equal(deployWorkflow.includes("STRIPE_SECRET_KEY"), false);

assert.equal(metadataCron.includes("requireCronSecret"), true);
assert.equal(metadataCron.includes("refreshLivePlayerCountsForActiveServers"), true);
assert.equal(metadataCron.includes("player_count_stale_ms"), true);
assert.equal(metadataCron.includes("livePlayerCountStaleMs"), true);
assert.equal(metadataCron.includes("queueDiscordUpdates: false"), true);
assert.equal(metadataCron.includes("skipAutomationMaintenance: true"), true);
assert.equal(metadataCron.includes("deadlineMs: sanitizePositiveInteger(body.deadline_ms, 2_500, 5_000)"), true);
assert.equal(metadataCron.includes("classifyMetadataResult"), true);
assert.equal(metadataCron.includes('timed_out: taskStatus === "timed_out"'), true);
assert.equal(metadataCron.includes("result.budget_exhausted && result.processed === 0"), true);
assert.equal(metadataCron.includes("metadata_budget_exhausted_before_work"), true);
assert.equal(metadataCron.includes("body.async === true"), false, "Metadata route must not return a waitUntil acknowledgement as success.");
assert.equal(metadataCron.includes("waitUntil(runMetadataRefresh"), false);
assert.equal(
  metadataCron.includes("hasOnlyExpectedUnavailableFailures"),
  true,
  "Expected Nitrado-unavailable failures must be classified separately.",
);
assert.equal(
  metadataCron.indexOf("hasOnlyExpectedUnavailableFailures(result)")
    < metadataCron.indexOf("result.failed > 0 && result.succeeded > 0"),
  true,
  "Expected upstream-unavailable failures must become warnings before generic partial classification.",
);
assert.equal(
  metadataCron.includes('"nitrado_live_count_unavailable"'),
  true,
  "Metadata warnings must expose a stable machine-readable warning code.",
);
assert.equal(serverMetadata.includes("staleStatusLockCutoff"), true);
assert.equal(serverMetadata.includes("livePlayerCountStaleMs"), true);
assert.equal(serverMetadata.includes("livePlayerCountCutoff"), true);
assert.equal(serverMetadata.includes("unavailableRetryCutoff"), true);
assert.equal(serverMetadata.includes("Math.max(Math.min(livePlayerCountStaleMs, 90_000), 60_000)"), true);
assert.equal(serverMetadata.includes("Math.max(2 * 60 * 1000, Math.min(livePlayerCountStaleMs * 3, 5 * 60 * 1000))"), true);
assert.equal(serverMetadata.includes("linked_servers.player_count_last_checked_at <= ?"), true);
assert.equal(serverMetadata.includes("server_sync_state.status_sync_started_at"), true);
assert.equal(serverMetadata.includes("markStatusCheckStarted(env, row.guild_id"), true, "Metadata locks should be acquired atomically after candidate selection.");
assert.equal(serverMetadata.includes("OR COALESCE(server_sync_state.status_sync_started_at, server_sync_state.updated_at, '1970-01-01T00:00:00.000Z') <= ?"), true);
assert.equal(metadataCron.includes("debug_service_id"), true);
assert.equal(metadataCron.includes("selected_service_ids"), true);
assert.equal(metadataCron.includes("skipped_service_ids"), true);
assert.equal(metadataCron.includes("oldest_public_metadata_age_seconds"), true);
assert.equal(serverMetadata.includes("/gameservers/games/players"), true);
assert.equal(automationSource.includes("UPDATE server_public_cache SET"), true, "Status result recording must refresh public cache player counts.");
assert.equal(automationSource.includes("last_status_update_at = CASE WHEN ? THEN ? ELSE last_status_update_at END"), true, "Failed status checks must not overwrite fresh public cache timestamps.");
assert.equal(automationSource.includes('input.status === "failed" || input.status === "timed_out"'), true, "Failed/timed-out automation rows must be normalized.");
assert.equal(automationSource.includes("failed && !hasPositiveMetric(input.failedCount) ? 1"), true, "Failed automation rows must not keep zero failed_count.");
assert.equal(automationSource.includes('input.status === "no_op"'), true, "No-op automation rows must carry a reason.");
assert.equal(automationSource.includes('input.status === "warning" && hasPositiveMetric(input.failedCount)'), true, "Warning automation rows with failures must carry an error message.");
assert.equal(automationSource.includes("${input.jobType}_${input.status}"), true, "Failed automation rows must get a fallback error message.");
assert.equal(automationSource.includes("sanitizeAutomationError"), true, "Automation errors must be sanitized before recording.");
assert.equal(automationSource.includes("clearStatusCheckLock"), true, "Metadata status locks must have explicit cleanup support.");
assert.equal(automationSource.includes("OR COALESCE(status_sync_started_at, updated_at, '1970-01-01T00:00:00.000Z') <= ?"), true, "Metadata status lock acquisition must be able to reclaim stale leases.");
assert.equal(serverWarsCron.includes("requireCronSecret"), true);
assert.equal(serverWarsCron.includes("runServerWarAutomationTick"), true);
assert.equal(serverWarsCron.includes("body.async === true"), true);
assert.equal(serverWarsCron.includes("waitUntil(runAndRecordServerWarAutomation"), true);
assert.equal(serverWarsCron.includes("toServerWarCronContract"), true, "Server Wars cron route must normalize every result to a machine-verifiable task contract.");
assert.equal(serverWarsCron.includes('taskStatus === "no_op" ? "no_due_server_war_work"'), true);
assert.equal(serverWarsCron.includes("task_status: taskStatus"), true);
assert.equal(serverWarsCron.includes("warningCode"), true);
assert.equal(serverWarsCron.includes("errorCode"), true);
assert.equal(serverWarsCron.includes('taskStatus: "failed"'), true);
assert.equal(discordRoute.includes("requireCronSecret"), true);
assert.equal(discordRoute.indexOf("requireCronSecret") < discordRoute.indexOf("readJson"), true, "Discord route should reject unauthenticated callers before parsing body.");
assert.equal(discordRoute.includes("body.async === true"), false, "Discord route must not return a waitUntil acknowledgement as success.");
assert.equal(discordRoute.includes("waitUntil(runDiscordPostDispatch"), false);
assert.equal(discordRoute.includes("maxJobs: sanitizePositiveInteger(body.max_posts ?? body.max_jobs, 1, 10)"), true);
assert.equal(discordRoute.includes("deadlineMs: sanitizePositiveInteger(body.deadline_ms, 2500, 5000)"), true);
assert.equal(discordRoute.includes("classifyDiscordResult"), true);

assert.equal(discordPosting.includes("deadlineMs"), true);
assert.equal(discordPosting.includes("createDiscordDispatchBudget"), true);
assert.equal(discordPosting.includes("isDiscordDispatchBudgetLow"), true);
assert.equal(discordPosting.includes("budgetExhausted"), true);
assert.equal(discordPosting.includes("Math.min(Math.trunc(Number(options.maxJobs ?? 2)) || 2, 10)"), true);

assert.equal(worker.includes("const SERVER_WARS_WORKER_SIDE_TASK_ENABLED = false;"), true);
assert.equal(worker.includes("const DISCORD_POSTS_WORKER_SIDE_TASK_ENABLED = false;"), true);
assert.equal(worker.includes("const POST_ADM_MAINTENANCE_WORKER_SIDE_TASK_ENABLED = false;"), true);
assert.equal(worker.includes("const EVENT_SCORING_WORKER_SIDE_TASK_ENABLED = false;"), true);
assert.equal(worker.includes("ADM_WORKER_DIRECT_SYNC_MAX_RUNTIME_MS = 6_000"), true);
assert.equal(admSyncSource.includes("const shouldRefreshMetadata = false;"), true, "ADM Worker must not run metadata refresh work.");
assert.equal(admSyncSource.includes("OR linked_servers.metadata_last_checked_at IS NULL"), false, "ADM Worker selection must not be driven by stale metadata.");
assert.equal(worker.includes("Server Wars automation is temporarily cron-route-only"), true);
assert.equal(worker.includes("Discord posts automation is cron-route-only"), true);

assert.equal(autoUpdateConfig.includes('name = "dzn-auto-update-worker"'), true);
assert.equal(autoUpdateConfig.includes('crons = ["* * * * *"]'), true);
assert.equal(autoUpdateConfig.includes('DZN_APP_URL = "https://dzn-network.pages.dev"'), true);
assert.equal(autoUpdateWorker.includes("WORKER_NAME = \"dzn-auto-update-worker\""), true);
assert.equal(autoUpdateWorker.includes("/api/sync/metadata/run"), true);
assert.equal(autoUpdateWorker.includes("/api/cron/server-wars/refresh"), true);
assert.equal(autoUpdateWorker.includes("/api/sync/discord-posts/run"), true);
assert.equal(autoUpdateWorker.includes('cadence: "every-minute"'), true);
assert.equal(autoUpdateWorker.includes('cadence: "every-five-minutes"'), true);
assert.equal(autoUpdateWorker.includes("isFiveMinuteTick"), true);
assert.equal(autoUpdateWorker.includes('path: "/api/sync/metadata/run"'), true);
assert.equal(autoUpdateWorker.includes("async: true"), false, "Auto-update Worker must not start Pages waitUntil tasks.");
assert.equal(autoUpdateWorker.includes("source: \"cloudflare-live-metadata\""), true);
assert.equal(autoUpdateWorker.includes("max_servers: 1"), true);
assert.equal(autoUpdateWorker.includes("deadline_ms: 2_500"), true);
assert.equal(autoUpdateWorker.includes("player_count_stale_ms: 60_000"), true);
assert.equal(autoUpdateWorker.includes("timeoutMs: 25_000"), true);
assert.equal(autoUpdateWorker.includes("for (const task of dueTasks)"), true);
assert.equal(autoUpdateWorker.includes("AbortController"), true);
assert.equal(autoUpdateWorker.includes("recordAutomationCronRun"), true);
assert.equal(autoUpdateWorker.includes("taskStatusFromBody"), true);
assert.equal(autoUpdateWorker.includes("body?.taskStatus ?? body?.task_status"), true, "Auto-update Worker should accept camelCase and snake_case taskStatus fields.");
assert.equal(autoUpdateWorker.includes("task_accepted_without_completion"), true);
assert.equal(
  autoUpdateWorker.includes("const COMPLETED_TASK_STATUSES = new Set(["),
  true,
  "Auto-update Worker must explicitly allow completed task statuses.",
);
assert.equal(
  autoUpdateWorker.includes("results.every((result) => result.ok)"),
  true,
  "Overall Worker health must require every due task to complete acceptably.",
);
assert.equal(
  autoUpdateWorker.includes("results.some((result) => result.ok)"),
  false,
  "One successful task must not hide another task failure.",
);
assert.equal(autoUpdateWorker.includes('"success"'), true);
assert.equal(autoUpdateWorker.includes('"warning"'), true);
assert.equal(autoUpdateWorker.includes('"no_op"'), true);
assert.equal(autoUpdateWorker.includes('"failed", "timed_out", "accepted", "warning", "no_op"'), true, "Auto-update Worker warning/no-op rows must pass through safe error context.");
assert.equal(autoUpdateWorker.includes("max_posts: 1"), true);
assert.equal(autoUpdateWorker.includes("/api/sync/adm/run"), false, "Auto-update Worker must never run ADM imports.");
assert.equal(autoUpdateWorker.includes("TOKEN_ENCRYPTION_KEY"), false, "Auto-update Worker must not handle Nitrado token decryption.");
assert.equal(serverMetadata.includes("UPDATE server_public_cache SET"), true, "Fresh metadata refresh should directly update the public cache row.");
assert.equal(serverMetadata.includes("WHERE guild_id = ?"), true, "Public cache sync must target the existing guild row.");
assert.equal(serverMetadata.includes("refreshNitradoServerPlayerCountOnly"), true, "Cron metadata refresh must use the lightweight live-count path.");
assert.equal(serverMetadata.includes("fetchNitradoOnlinePlayerCount"), true, "Cron metadata refresh must use the dedicated Nitrado player-count endpoint.");
assert.equal(serverMetadata.includes("DZN PLAYER COUNT ADM PLAYERLIST FALLBACK"), true, "Cron metadata refresh must fall back to fresh ADM PlayerList snapshots before marking live count unavailable.");
assert.equal(serverMetadata.includes("adm_playerlist_fallback"), true, "Scheduler diagnostics should identify ADM PlayerList fallback separately from live Nitrado success.");

type SchedulerBody = Record<string, unknown>;

function countMetric(value: unknown) {
  if (Array.isArray(value)) return value.length;
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function validateSchedulerContract(code: number, parsed: SchedulerBody) {
  const safe = {
    ok: parsed.ok,
    taskStatus: parsed.taskStatus ?? parsed.task_status ?? parsed.status ?? null,
    processed: countMetric(parsed.processed ?? parsed.processedCount ?? parsed.processed_count),
    skipped: countMetric(parsed.skipped ?? parsed.skippedCount ?? parsed.skipped_count),
    failed: countMetric(parsed.failed ?? parsed.failedCount ?? parsed.failed_count),
    snapshots: countMetric(parsed.snapshots),
    finalized: countMetric(parsed.finalized),
    expiredChallenges: countMetric(parsed.expiredChallenges ?? parsed.expired_challenges),
    noOpReason: parsed.noOpReason ?? parsed.no_op_reason ?? null,
    warningCode: parsed.warningCode ?? parsed.warning_code ?? null,
    warning: parsed.warning ?? null,
    errorCode: parsed.errorCode ?? parsed.error_code ?? null,
    error: parsed.error ?? parsed.message ?? null,
    accepted: parsed.accepted === true,
  };
  if (code === 401 || code === 403) return { ok: false, reason: "auth" };
  if (code < 200 || code >= 300) return { ok: false, reason: "http" };
  if (safe.accepted || safe.taskStatus === "accepted") return { ok: false, reason: "accepted" };
  const taskStatus = String(safe.taskStatus ?? "");
  if (!new Set(["success", "no_op", "warning"]).has(taskStatus)) return { ok: false, reason: "invalid_status" };
  if (safe.ok === false || ["failed", "timed_out"].includes(taskStatus)) return { ok: false, reason: "failed" };
  if (taskStatus === "warning" && !safe.warningCode && !safe.warning && !safe.errorCode && !safe.error) {
    return { ok: false, reason: "anonymous_warning" };
  }
  if (taskStatus === "no_op" && !safe.noOpReason) return { ok: false, reason: "missing_no_op_reason" };
  const zeroCounters = safe.processed === 0 && safe.skipped === 0 && safe.failed === 0 && safe.snapshots === 0 && safe.finalized === 0 && safe.expiredChallenges === 0;
  if (zeroCounters && taskStatus !== "no_op" && taskStatus !== "warning") return { ok: false, reason: "zero_without_reason" };
  if (zeroCounters && taskStatus === "no_op" && !safe.noOpReason) return { ok: false, reason: "zero_no_op_without_reason" };
  if (zeroCounters && taskStatus === "warning" && !safe.warningCode && !safe.warning && !safe.errorCode && !safe.error) {
    return { ok: false, reason: "zero_warning_without_reason" };
  }
  return { ok: true, reason: null };
}

assert.deepEqual(validateSchedulerContract(200, {
  ok: true,
  taskStatus: "no_op",
  noOpReason: "no_due_server_war_work",
  processed: 0,
  skipped: 0,
  failed: 0,
  snapshots: 0,
  finalized: 0,
  expiredChallenges: 0,
}), { ok: true, reason: null }, "Server Wars no-work contract should pass.");

assert.deepEqual(validateSchedulerContract(200, {
  ok: true,
  taskStatus: "success",
  processed: 1,
  skipped: 0,
  failed: 0,
  snapshots: 1,
  finalized: 0,
  expiredChallenges: 0,
}), { ok: true, reason: null }, "Server Wars completed work contract should pass.");

assert.equal(validateSchedulerContract(200, { ok: true, taskStatus: null, processed: 0, skipped: 0, failed: 0 }).ok, false, "Null taskStatus must fail.");
assert.equal(validateSchedulerContract(200, { ok: true, task_status: null, processed: 0, skipped: 0, failed: 0 }).ok, false, "HTTP 200 ok=true with taskStatus=null must fail.");
assert.equal(validateSchedulerContract(200, { ok: true, taskStatus: "success", processed: 0, skipped: 0, failed: 0 }).ok, false, "Zero counters without noOpReason must fail.");
assert.equal(validateSchedulerContract(200, { ok: true, taskStatus: "no_op", noOpReason: "discord_no_posts_due", processed: 0, skipped: 0, failed: 0 }).ok, true, "Explicit Discord no-op should pass.");
assert.equal(validateSchedulerContract(200, { ok: true, taskStatus: "success", processed: 1, skipped: 1, failed: 0 }).ok, true, "Metadata success contract should remain passing.");

const attemptedTasks: string[] = [];
let aggregateFailure = false;
for (const task of [
  { name: "Metadata", body: { ok: true, taskStatus: "success", processed: 1, skipped: 1, failed: 0 } },
  { name: "Server Wars", body: { ok: true, taskStatus: null, processed: 0, skipped: 0, failed: 0 } },
  { name: "Discord", body: { ok: true, taskStatus: "no_op", noOpReason: "discord_no_posts_due", processed: 0, skipped: 0, failed: 0 } },
]) {
  attemptedTasks.push(task.name);
  aggregateFailure = !validateSchedulerContract(200, task.body).ok || aggregateFailure;
}
assert.deepEqual(attemptedTasks, ["Metadata", "Server Wars", "Discord"], "Server Wars failure must not prevent Discord invocation/reporting.");
assert.equal(aggregateFailure, true, "Invalid Server Wars contract should still fail the aggregate workflow.");

console.log("Automation scheduler tests passed.");
