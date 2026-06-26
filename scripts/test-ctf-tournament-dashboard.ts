import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboardApi = readFileSync("functions/api/servers/[serverId]/ctf/dashboard.ts", "utf8");
for (const snippet of [
  "ensureCtfTournamentSchema",
  "ctf_tournaments",
  "ctf_match_participants",
  "ctf_tournament_rosters",
  "ctf_event_audit",
  "ctf_cached_aggregate",
  "can_use_cross_server_matching",
  "PRO",
  "PREMIUM",
  "parser_dropout_protected",
  "cache-control",
  "no-store",
]) {
  assert.equal(dashboardApi.includes(snippet), true, `Missing CTF dashboard API snippet: ${snippet}`);
}

for (const forbidden of ["adm-sync", "adm-parser", "adm_import_jobs", "kill_events", "player_events"]) {
  assert.equal(dashboardApi.includes(forbidden), false, `CTF dashboard API must not depend on ${forbidden}`);
}

const rosterApi = readFileSync("functions/api/servers/[serverId]/ctf/roster.ts", "utf8");
for (const snippet of [
  "ctf_tournament_rosters",
  "Exact case-sensitive gamertag is required.",
  "Unique account GUID hash is required.",
  "ON CONFLICT(ctf_tournament_id, linked_server_id, player_id)",
]) {
  assert.equal(rosterApi.includes(snippet), true, `Missing roster API snippet: ${snippet}`);
}

const page = readFileSync("app/dashboard/register-event/page.tsx", "utf8");
assert.equal(page.includes("TournamentDashboard"), true);
assert.equal(page.includes("Suspense"), true);

const component = readFileSync("components/events/tournament-dashboard.tsx", "utf8");
for (const snippet of [
  "VersusGrid",
  "LiveAggregateProgress",
  "RosterRegistration",
  "VerifiedActionFeed",
  "CompletedMatchHistory",
  "dzn:lastGoodTournamentDashboard:",
  "/api/servers/${encodeURIComponent(serverId)}/ctf/dashboard",
  "/api/servers/${encodeURIComponent(serverId)}/ctf/roster",
  "Pro or Premium required",
  "Anti-alt policy",
  "case-sensitive",
]) {
  assert.equal(component.includes(snippet), true, `Missing tournament component snippet: ${snippet}`);
}

for (const forbidden of ["adm-sync", "adm-parser", "adm_import_jobs"]) {
  assert.equal(component.includes(forbidden), false, `Tournament page must not depend on ${forbidden}`);
}

const packageSource = readFileSync("package.json", "utf8");
assert.equal(packageSource.includes("\"test:ctf-tournament-dashboard\": \"tsx scripts/test-ctf-tournament-dashboard.ts\""), true);
assert.equal(packageSource.includes("test:ctf-tournament-dashboard && npm run test:events && npm run test:dzn-pulse && npm run test:billing-plans"), true);

console.log("CTF tournament dashboard tests passed.");
