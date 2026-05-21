import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizeLeaderboardMetric,
  normalizePublicLeaderboardOptions,
} from "../functions/_lib/public-leaderboards";

const migration = readFileSync("migrations/0031_premium_analytics_telemetry.sql", "utf8");
for (const snippet of [
  "ALTER TABLE player_profiles ADD COLUMN highest_killstreak INTEGER DEFAULT 0",
  "ALTER TABLE player_profiles ADD COLUMN current_killstreak INTEGER DEFAULT 0",
  "ALTER TABLE player_profiles ADD COLUMN total_time_alive_seconds INTEGER DEFAULT 0",
  "ALTER TABLE player_profiles ADD COLUMN headshots INTEGER DEFAULT 0",
  "ALTER TABLE player_profiles ADD COLUMN favourite_weapon TEXT DEFAULT 'Unknown'",
  "ALTER TABLE player_profiles ADD COLUMN combat_logs_count INTEGER DEFAULT 0",
  "ALTER TABLE player_profiles ADD COLUMN rage_quits_count INTEGER DEFAULT 0",
  "ALTER TABLE player_profiles ADD COLUMN spawn_kills_count INTEGER DEFAULT 0",
  "CREATE TABLE IF NOT EXISTS player_parser_state",
  "CREATE TABLE IF NOT EXISTS player_weapon_stats",
  "idx_player_profiles_highest_streak",
  "idx_player_parser_state_server_player",
]) {
  assert.equal(migration.includes(snippet), true, `Missing migration snippet: ${snippet}`);
}
for (const forbidden of ["DROP TABLE", "DELETE FROM", "TRUNCATE", "UPDATE player_profiles SET kills = 0"]) {
  assert.equal(migration.toUpperCase().includes(forbidden), false, `Migration must not include destructive operation: ${forbidden}`);
}

const admSync = readFileSync("functions/_lib/adm-sync.ts", "utf8");
for (const snippet of [
  "PREMIUM_TELEMETRY_SCHEMA_STATEMENTS",
  "player_parser_state",
  "player_weapon_stats",
  "evaluateLogTelemetrySequence",
  "last_combat_activity_at",
  "combat_logs_count",
  "rage_quits_count",
  "spawn_kills_count",
  "total_time_alive_seconds",
  "current_killstreak",
  "highest_killstreak",
  "updatePlayerWeaponFrequency",
  "isWithinSeconds(state?.last_combat_activity_at, occurredAt, 15)",
  "isWithinSeconds(state?.last_died_at, occurredAt, 60)",
  "isWithinSeconds(victimState?.last_connected_at, occurredAt, 120)",
]) {
  assert.equal(admSync.includes(snippet), true, `Missing telemetry parser snippet: ${snippet}`);
}
for (const retained of [
  "hasExistingKillEventByFallback",
  "idx_kill_events_service_file_line",
  "assertAdmWriteScope",
]) {
  assert.equal(admSync.includes(retained), true, `Existing guardrail must remain present: ${retained}`);
}

const ctfEngine = readFileSync("functions/_lib/ctf-tournaments.ts", "utf8");
for (const retained of [
  "evaluateCtfPointProgression",
  "ctf_match_participants",
  "ctf_tournament_rosters",
  "ctf_event_audit",
]) {
  assert.equal(ctfEngine.includes(retained), true, `Existing CTF model must remain present: ${retained}`);
}

const publicLeaderboards = readFileSync("functions/_lib/public-leaderboards.ts", "utf8");
for (const snippet of [
  "PublicLeaderboardMetric",
  "PUBLIC_LEADERBOARD_METRICS",
  "total_kills",
  "kd_ratio",
  "highest_killstreak",
  "longest_kill_distance",
  "total_survival_time_alive",
  "headshots",
  "favourite_weapon",
  "combat_logs",
  "rage_quits",
  "spawn_kills",
  "selected_metric_leaderboard",
  "player_leaderboards",
  "LIMIT ? OFFSET ?",
]) {
  assert.equal(publicLeaderboards.includes(snippet), true, `Missing public leaderboard snippet: ${snippet}`);
}

assert.deepEqual(normalizePublicLeaderboardOptions({}), {
  full: false,
  metric: "total_kills",
  page: 1,
  pageSize: 10,
});
assert.deepEqual(normalizePublicLeaderboardOptions({ full: true, metric: "kd", page: 3, pageSize: 250 }), {
  full: true,
  metric: "kd_ratio",
  page: 3,
  pageSize: 250,
});
assert.equal(normalizePublicLeaderboardOptions({ full: true, pageSize: 999 }).pageSize, 500);
assert.equal(normalizeLeaderboardMetric("favorite_weapon"), "favourite_weapon");
assert.equal(normalizeLeaderboardMetric("spawn-killing"), "spawn_kills");

const publicEndpoint = readFileSync("functions/api/public/leaderboards.ts", "utf8");
for (const snippet of [
  "params.get(\"full\")",
  "full:${leaderboardOptions.metric}",
  "getPublicLeaderboardsPayload(env, viewerLoggedIn, leaderboardOptions)",
]) {
  assert.equal(publicEndpoint.includes(snippet), true, `Missing endpoint option snippet: ${snippet}`);
}

const aliasEndpoint = readFileSync("functions/api/leaderboards.ts", "utf8");
assert.equal(aliasEndpoint.includes("export { onRequest } from \"./public/leaderboards\""), true);

console.log("Premium analytics telemetry tests passed.");
