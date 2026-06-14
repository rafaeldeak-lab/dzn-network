import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/dzn-auto-update-schedulers.yml", "utf8");
const worker = readFileSync("workers/adm-sync-worker.ts", "utf8");
const autoUpdateWorker = readFileSync("workers/dzn-auto-update-worker.ts", "utf8");
const autoUpdateConfig = readFileSync("wrangler.auto-update.toml", "utf8");
const discordRoute = readFileSync("functions/api/sync/discord-posts/run.ts", "utf8");
const discordPosting = readFileSync("functions/_lib/discord-posting.ts", "utf8");
const serverWarsCron = readFileSync("functions/api/cron/server-wars/refresh.ts", "utf8");
const metadataCron = readFileSync("functions/api/sync/metadata/run.ts", "utf8");

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

assert.equal(workflow.includes("/api/sync/adm/run"), false, "The scheduler workflow must not become the primary ADM sync runner.");
assert.equal(workflow.includes("TOKEN_ENCRYPTION_KEY"), false);
assert.equal(workflow.includes("DISCORD_BOT_TOKEN"), false);
assert.equal(workflow.includes("STRIPE_SECRET_KEY"), false);

assert.equal(metadataCron.includes("requireCronSecret"), true);
assert.equal(metadataCron.includes("refreshLivePlayerCountsForActiveServers"), true);
assert.equal(metadataCron.includes("queueDiscordUpdates: false"), true);
assert.equal(metadataCron.includes("skipAutomationMaintenance: true"), true);
assert.equal(metadataCron.includes("deadlineMs: sanitizePositiveInteger(body.deadline_ms, 20_000, 60_000)"), true);
assert.equal(metadataCron.includes("raceMetadataRefreshWithTimeout"), true);
assert.equal(metadataCron.includes("timed_out: timedOut"), true);
assert.equal(metadataCron.includes("budget_exhausted: true"), true);
assert.equal(metadataCron.includes("body.async === true"), true);
assert.equal(metadataCron.includes("waitUntil(runMetadataRefresh"), true);
assert.equal(serverWarsCron.includes("requireCronSecret"), true);
assert.equal(serverWarsCron.includes("runServerWarAutomationTick"), true);
assert.equal(discordRoute.includes("requireCronSecret"), true);
assert.equal(discordRoute.indexOf("requireCronSecret") < discordRoute.indexOf("readJson"), true, "Discord route should reject unauthenticated callers before parsing body.");
assert.equal(discordRoute.includes("maxJobs: sanitizePositiveInteger(body.max_jobs, 2, 10)"), true);
assert.equal(discordRoute.includes("deadlineMs: sanitizePositiveInteger(body.deadline_ms, 2500, 5000)"), true);

assert.equal(discordPosting.includes("deadlineMs"), true);
assert.equal(discordPosting.includes("createDiscordDispatchBudget"), true);
assert.equal(discordPosting.includes("isDiscordDispatchBudgetLow"), true);
assert.equal(discordPosting.includes("budgetExhausted"), true);
assert.equal(discordPosting.includes("Math.min(Math.trunc(Number(options.maxJobs ?? 2)) || 2, 10)"), true);

assert.equal(worker.includes("const SERVER_WARS_WORKER_SIDE_TASK_ENABLED = false;"), true);
assert.equal(worker.includes("const DISCORD_POSTS_WORKER_SIDE_TASK_ENABLED = false;"), true);
assert.equal(worker.includes("const POST_ADM_MAINTENANCE_WORKER_SIDE_TASK_ENABLED = false;"), true);
assert.equal(worker.includes("const EVENT_SCORING_WORKER_SIDE_TASK_ENABLED = false;"), true);
assert.equal(worker.includes("ADM_WORKER_DIRECT_SYNC_MAX_RUNTIME_MS = 1_500"), true);
assert.equal(worker.includes("Server Wars automation is temporarily cron-route-only"), true);
assert.equal(worker.includes("Discord posts automation is cron-route-only"), true);

assert.equal(autoUpdateConfig.includes('name = "dzn-auto-update-worker"'), true);
assert.equal(autoUpdateConfig.includes('crons = ["*/5 * * * *"]'), true);
assert.equal(autoUpdateConfig.includes('DZN_APP_URL = "https://dzn-network.pages.dev"'), true);
assert.equal(autoUpdateWorker.includes("WORKER_NAME = \"dzn-auto-update-worker\""), true);
assert.equal(autoUpdateWorker.includes("/api/sync/metadata/run"), true);
assert.equal(autoUpdateWorker.includes("/api/cron/server-wars/refresh"), true);
assert.equal(autoUpdateWorker.includes("/api/sync/discord-posts/run"), true);
assert.equal(autoUpdateWorker.includes("for (const task of TASKS)"), true);
assert.equal(autoUpdateWorker.includes("AbortController"), true);
assert.equal(autoUpdateWorker.includes("recordAutomationCronRun"), true);
assert.equal(autoUpdateWorker.includes("/api/sync/adm/run"), false, "Auto-update Worker must never run ADM imports.");
assert.equal(autoUpdateWorker.includes("TOKEN_ENCRYPTION_KEY"), false, "Auto-update Worker must not handle Nitrado token decryption.");

console.log("Automation scheduler tests passed.");
