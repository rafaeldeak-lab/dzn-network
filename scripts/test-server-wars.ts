import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const migration = readFileSync("migrations/0051_server_wars_mvp.sql", "utf8");
for (const table of [
  "server_war_events",
  "server_war_participants",
  "server_war_challenges",
  "server_war_score_snapshots",
  "server_war_results",
  "server_trophies",
  "server_champion_titles",
]) {
  assert.equal(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), true, `Migration should create ${table}.`);
}
for (const index of [
  "idx_server_war_events_status_dates",
  "idx_server_war_participants_event_server",
  "idx_server_war_challenges_opponent_status",
  "idx_server_war_snapshots_event_server",
  "idx_server_war_results_event_server",
  "idx_server_trophies_unique_award",
  "idx_server_champion_titles_server_active_category",
]) {
  assert.equal(migration.includes(index), true, `Migration should include ${index}.`);
}
assert.equal(/DROP TABLE|DELETE FROM|TRUNCATE|ALTER TABLE player_profiles|CREATE TABLE IF NOT EXISTS player_stats|kill_events\s*\(/i.test(migration), false, "Server Wars migration must be additive and avoid protected ADM/profile tables.");

for (const route of [
  "functions/api/public/server-wars/index.ts",
  "functions/api/public/server-wars/[eventId].ts",
  "functions/api/public/servers/[serverId]/wars/index.ts",
  "functions/api/servers/[serverId]/wars/index.ts",
  "functions/api/servers/[serverId]/wars/challenges/index.ts",
  "functions/api/servers/[serverId]/wars/challenges/[challengeId]/accept.ts",
  "functions/api/servers/[serverId]/wars/challenges/[challengeId]/decline.ts",
  "functions/api/admin/server-wars/[eventId]/refresh-score.ts",
  "functions/api/admin/server-wars/[eventId]/finalize.ts",
  "functions/api/cron/server-wars/refresh.ts",
  "app/events/server-wars/page.tsx",
  "components/server-wars/server-wars-platform.tsx",
]) {
  assert.equal(existsSync(route), true, `Expected Server Wars route/component to exist: ${route}`);
}

const schema = readFileSync("functions/_lib/server-war-schema.ts", "utf8");
assert.match(schema, /ensureServerWarsSchema/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS server_war_events/);
assert.doesNotMatch(schema, /DROP TABLE|DELETE FROM|TRUNCATE|player_stats/i);

const publicServerWars = readFileSync("functions/api/public/server-wars/index.ts", "utf8");
const publicDetail = readFileSync("functions/api/public/server-wars/[eventId].ts", "utf8");
const publicServerRecord = readFileSync("functions/api/public/servers/[serverId]/wars/index.ts", "utf8");
for (const source of [publicServerWars, publicDetail, publicServerRecord]) {
  assert.match(source, /publicAccessCacheHeaders/);
  assert.match(source, /publicApiErrorHeaders/);
  assert.match(source, /ok: true/);
  assert.doesNotMatch(source, /position_x|position_y|pos_x|pos_y|raw_line|exact player routes/i);
}
assert.doesNotMatch(publicServerWars, /isPublicViewerLoggedIn/, "Public Server Wars list should not do auth/session work on the hot path.");

const serverWarsLib = readFileSync("functions/_lib/server-wars.ts", "utf8");
for (const snippet of [
  "getPublicServerWarsPayload",
  "getPublicServerWarDetailPayload",
  "getPublicServerWarRecordPayload",
  "getOwnerServerWarsPayload",
  "createServerWarChallenge",
  "acceptServerWarChallenge",
  "declineServerWarChallenge",
  "category_at_entry",
  "canRespond",
  "rawCoordinatesExposed: false",
  "exactRoutesExposed: false",
  "PUBLIC_SERVER_WARS_CACHE_MS",
  "emptyPublicServerWarsPayload",
  "isMissingServerWarsSchemaError",
  "skipSchemaEnsure: true",
]) {
  assert.equal(serverWarsLib.includes(snippet), true, `Expected helper to include ${snippet}.`);
}
const snapshotsLib = readFileSync("functions/_lib/server-war-snapshots.ts", "utf8");
assert.match(snapshotsLib, /server_war_score_snapshots/);
assert.doesNotMatch(serverWarsLib, /TOKEN_ENCRYPTION_KEY|NITRADO_TOKEN|STRIPE_SECRET|player_stats/i);

const automationLib = readFileSync("functions/_lib/server-war-automation.ts", "utf8");
assert.match(automationLib, /runServerWarAutomationTick/);
assert.match(automationLib, /refreshDueServerWarSnapshots/);
assert.match(automationLib, /finalizeEndedServerWars/);
assert.match(automationLib, /status = 'expired'/);
assert.match(automationLib, /status = 'finalizing'/);

const adminRefresh = readFileSync("functions/api/admin/server-wars/[eventId]/refresh-score.ts", "utf8");
const adminFinalize = readFileSync("functions/api/admin/server-wars/[eventId]/finalize.ts", "utf8");
assert.match(adminRefresh, /requireDznAdmin/);
assert.match(adminFinalize, /requireDznAdmin/);
assert.match(adminRefresh, /forbidden/);
assert.match(adminFinalize, /forbidden/);

const cronRefresh = readFileSync("functions/api/cron/server-wars/refresh.ts", "utf8");
assert.match(cronRefresh, /requireCronSecret/);
assert.match(cronRefresh, /runServerWarAutomationTick/);

const leaderboardPage = readFileSync("app/leaderboards/page.tsx", "utf8");
assert.match(leaderboardPage, /ServerWarsTeaser/);
assert.match(leaderboardPage, /leaderboard-ref-grid/);
assert.equal(leaderboardPage.lastIndexOf("leaderboard-ref-grid") < leaderboardPage.lastIndexOf("<ServerWarsTeaser"), true, "Core leaderboards should render before optional Server Wars.");

const serverWarsUi = readFileSync("components/server-wars/server-wars-platform.tsx", "utf8");
assert.match(serverWarsUi, /Servers are the competitors/);
assert.match(serverWarsUi, /Awaiting score snapshot/);
assert.match(serverWarsUi, /Plans affect hosting/);
assert.match(serverWarsUi, /useSearchParams/);
assert.match(serverWarsUi, /event=\$\{encodeURIComponent\(event\.slug\)\}/);
assert.doesNotMatch(serverWarsUi, /position_x|position_y|raw coordinates/i);

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.match(dashboardSource, /challenge\.canRespond/);
assert.match(dashboardSource, /Awaiting opponent/);

console.log("Server Wars MVP route/schema/privacy/fallback tests passed.");
