import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const automationSource = readFileSync("functions/_lib/server-war-automation.ts", "utf8");
const cronRouteSource = readFileSync("functions/api/cron/server-wars/refresh.ts", "utf8");
const workerSource = readFileSync("workers/adm-sync-worker.ts", "utf8");
const migration = readFileSync("migrations/0051_server_wars_mvp.sql", "utf8");
const schemaSource = readFileSync("functions/_lib/server-war-schema.ts", "utf8");
const finalizeSource = readFileSync("functions/_lib/server-war-finalize.ts", "utf8");
const seedSource = readFileSync("scripts/seed-advanced-showcase-preview.ts", "utf8");

assert.equal(existsSync("functions/_lib/server-war-automation.ts"), true, "Server Wars automation helper should exist.");
assert.equal(existsSync("functions/api/cron/server-wars/refresh.ts"), true, "Protected Server Wars cron route should exist.");

for (const snippet of [
  "runServerWarAutomationTick",
  "refreshDueServerWarSnapshots",
  "finalizeEndedServerWars",
  "expireDueServerWarChallenges",
  "transitionScheduledServerWarsToLive",
  "transitionEndedServerWarsToFinalizing",
  "SERVER_WAR_AUTOMATION_DEFAULT_EVENT_LIMIT",
  "SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT",
  "SERVER_WAR_AUTOMATION_DEFAULT_DEADLINE_MS",
  "refreshServerWarEventSnapshot",
  "finalizeServerWarEvent",
]) {
  assert.equal(automationSource.includes(snippet), true, `Automation helper should include ${snippet}.`);
}

assert.match(automationSource, /status = 'live'/, "Automation should promote scheduled events to live.");
assert.match(automationSource, /status = 'finalizing'/, "Automation should move ended events to finalizing.");
assert.match(automationSource, /status = 'expired'/, "Automation should expire stale pending challenges.");
assert.match(automationSource, /status = 'cancelled'/, "Expired pending challenge events should be cancelled.");
assert.match(automationSource, /LIMIT \$\{maxEvents\}/, "Snapshot refresh should be event-batch bounded.");
assert.match(automationSource, /LIMIT \$\{maxFinalizations\}/, "Finalization should be event-batch bounded.");
assert.match(automationSource, /isBudgetLow/, "Automation should have a deadline/budget guard.");
assert.match(automationSource, /try \{[\s\S]*refreshServerWarEventSnapshot/, "Per-event snapshot failures should be caught.");
assert.match(automationSource, /try \{[\s\S]*finalizeServerWarEvent/, "Per-event finalization failures should be caught.");
assert.match(automationSource, /warnings\.push/, "Automation should report safe partial progress warnings.");
assert.doesNotMatch(automationSource, /position_x|position_y|raw_line|TOKEN_ENCRYPTION_KEY|NITRADO_TOKEN|STRIPE_SECRET|player_stats/i);

assert.match(cronRouteSource, /requireCronSecret/, "Cron route must require the shared cron secret.");
assert.match(cronRouteSource, /runServerWarAutomationTick/, "Cron route must call the automation helper.");
assert.match(cronRouteSource, /onRequestPost/, "Cron route should only run on POST.");
assert.match(cronRouteSource, /methodNotAllowed/, "Cron route should reject unsafe methods.");
assert.match(cronRouteSource, /cache-control[\s\S]*no-store/, "Cron route must not be cached.");
assert.doesNotMatch(cronRouteSource, /getSessionUser|requireServerOwnerOrDznAdmin|position_x|raw_line|TOKEN_ENCRYPTION_KEY|STRIPE_SECRET/i);

assert.match(workerSource, /\/api\/cron\/server-wars\/refresh/, "ADM Worker should keep the protected Server Wars cron route configured.");
assert.match(workerSource, /label: "server-wars"/, "Worker cron endpoint should be labelled server-wars.");
assert.match(workerSource, /SERVER_WARS_WORKER_SIDE_TASK_ENABLED = false/, "Server Wars Worker side task should stay disabled until ADM Worker CPU headroom is proven stable.");
assert.match(workerSource, /max_events: 1/, "Worker Server Wars batch should stay small if re-enabled.");
assert.match(workerSource, /deadline_ms: 2500/, "Worker Server Wars endpoint should have a tight deadline if re-enabled.");
assert.match(workerSource, /cron-route-only to preserve ADM Worker CPU budget/, "Worker should keep Server Wars automation on the protected cron route for this hotfix.");
assert.equal(
  workerSource.indexOf("runEventScoring(env)") < workerSource.indexOf("CRON_ENDPOINTS[0]"),
  true,
  "Server Wars must run after ADM sync and existing event scoring.",
);

for (const source of [migration, schemaSource]) {
  assert.match(source, /idx_server_war_challenges_status_expires/, "Challenge expiry query should be indexed.");
  assert.match(source, /idx_server_war_events_status_dates/, "Event status/date automation query should be indexed.");
  assert.match(source, /idx_server_war_snapshots_event_snapshot/, "Latest snapshot query should be indexed.");
  assert.doesNotMatch(source, /DROP TABLE|DELETE FROM|TRUNCATE|ALTER TABLE player_profiles|CREATE TABLE IF NOT EXISTS player_stats/i);
}

for (const snippet of [
  "ON CONFLICT(event_id, server_id) DO UPDATE",
  "INSERT OR IGNORE INTO server_trophies",
  "ON CONFLICT(event_id, title_key) DO UPDATE",
  "alreadyFinalized",
]) {
  assert.equal(finalizeSource.includes(snippet), true, `Finalization should remain idempotent via ${snippet}.`);
}

for (const snippet of [
  "preview-auto-start-server-war",
  "preview-auto-finalized-server-war",
  "preview-expired-challenge",
  "challenge-expired",
]) {
  assert.equal(seedSource.includes(snippet), true, `Preview seed should include ${snippet}.`);
}
assert.match(seedSource, /must never run with --remote/, "Seed source should continue guarding remote use.");

console.log("Server Wars automation scheduling/finalization tests passed.");
