import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { getBillingPlanSummaries } from "../functions/_lib/plans";
import { calculateSeasonScoreFromStats, normalizeSeasonCategory } from "../functions/_lib/dzn-seasons";
import type { Env } from "../functions/_lib/types";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function includesAll(file: string, snippets: string[]) {
  for (const snippet of snippets) {
    assert.equal(file.includes(snippet), true, `Expected source to include: ${snippet}`);
  }
}

assert.equal(normalizeSeasonCategory("Deathmatch"), "deathmatch");
assert.equal(normalizeSeasonCategory("DM"), "deathmatch");
assert.equal(normalizeSeasonCategory("PvP"), "pvp");
assert.equal(normalizeSeasonCategory("PvE"), "pve");
assert.equal(normalizeSeasonCategory("Survival"), "survival");
assert.equal(normalizeSeasonCategory("PvP / PvE"), null, "Hybrid servers should not enter single-category seasons by default.");

const deathmatchScore = calculateSeasonScoreFromStats({
  id: "deathmatch-server",
  server_name: "DM",
  server_category: "deathmatch",
  server_type: "deathmatch",
  status: "live",
  total_kills: 100,
  total_deaths: 20,
  total_joins: 50,
  total_disconnects: 45,
  unique_players: 25,
  last_event_at: "2026-06-01T00:00:00.000Z",
  stats_updated_at: "2026-06-01T00:00:00.000Z",
}, { category: "deathmatch" });
assert.equal(deathmatchScore.score > 0, true, "Deathmatch scoring should return safe positive values.");
assert.equal(deathmatchScore.metrics.categoryScoring, "deathmatch");

const pvpScore = calculateSeasonScoreFromStats({
  id: "pvp-server",
  server_name: "PvP",
  server_category: "pvp",
  server_type: "pvp",
  status: "live",
  total_kills: 80,
  total_deaths: 40,
  total_joins: 30,
  total_disconnects: 30,
  unique_players: 18,
  last_event_at: null,
  stats_updated_at: null,
}, { category: "pvp" });
assert.equal(pvpScore.missingMetrics.includes("longest_kill"), true, "PvP longest kill should stay a documented placeholder until aggregate metric exists.");

const survivalScore = calculateSeasonScoreFromStats({
  id: "survival-server",
  server_name: "Survival",
  server_category: "survival",
  server_type: "survival",
  status: "live",
  total_kills: 0,
  total_deaths: 3,
  total_joins: 60,
  total_disconnects: 50,
  unique_players: 20,
  last_event_at: null,
  stats_updated_at: null,
}, { category: "survival" });
assert.equal(survivalScore.score > 0, true, "Survival scoring should use activity and deaths avoided safely.");
assert.equal(survivalScore.missingMetrics.includes("longest_lived"), true);

const migration = source("migrations/0050_dzn_seasons_competition.sql");
includesAll(migration, [
  "CREATE TABLE IF NOT EXISTS dzn_seasons",
  "CREATE TABLE IF NOT EXISTS dzn_season_entries",
  "CREATE TABLE IF NOT EXISTS dzn_season_score_snapshots",
  "CREATE TABLE IF NOT EXISTS dzn_season_awards",
  "UNIQUE(season_id, server_id)",
  "UNIQUE(season_id, server_id, award_code)",
]);
assert.equal(/DROP TABLE|DELETE FROM|TRUNCATE|CREATE TABLE IF NOT EXISTS player_stats|ALTER TABLE player_profiles|kill_events|player_events|sessions|subscriptions/i.test(migration), false, "Season migration must stay additive and avoid protected tracking/auth tables.");

const helper = source("functions/_lib/dzn-seasons.ts");
includesAll(helper, [
  "getActiveSeasons",
  "getPublicSeasons",
  "getSeasonBySlug",
  "getEligibleServersForSeason",
  "joinServerToSeason",
  "getServerSeasonStatus",
  "calculateSeasonScore",
  "refreshSeasonScores",
  "finaliseSeason",
  "getSeasonLeaderboard",
  "awardSeasonBadges",
  "getSeasonAwards",
  "normalizeSeasonCategory",
  "CATEGORY_MISMATCH",
  "ALREADY_JOINED",
  "This server has already joined that season.",
  "Servers can only join DZN seasons that match their category.",
  "activeEntries",
  "upcomingEligible",
  "server_stats",
  "INSERT INTO dzn_season_score_snapshots",
  "INSERT INTO dzn_season_awards",
  "ON CONFLICT(season_id, server_id, award_code) DO NOTHING",
  "awardBadge",
  "badgesAwarded",
  "awardsCreated",
  "season_runner_up",
  "season_third_place",
  "permanentSeasonalBadge",
  "missingMetrics",
]);
assert.equal(helper.includes("b.score.score - a.score.score"), true, "Season leaderboard refresh should rank by calculated score.");
assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe\/webhook)[^"']*["']|player_profiles|kill_events|player_events|sessions|subscriptions/i.test(helper), false, "Season helper must not import ADM/Nitrado/Stripe webhook or touch protected row tables.");

for (const route of [
  "functions/api/seasons.ts",
  "functions/api/seasons/[slug].ts",
  "functions/api/seasons/[slug]/leaderboard.ts",
  "functions/api/admin/seasons/[seasonId]/finalise.ts",
  "functions/api/servers/[serverId]/seasons/status.ts",
  "functions/api/servers/[serverId]/seasons/[seasonId]/join.ts",
]) {
  assert.equal(existsSync(route), true, `Expected route to exist: ${route}`);
}

const seasonsRoute = source("functions/api/seasons.ts");
includesAll(seasonsRoute, ["getActiveSeasons", "getPublicSeasons", "activeSeasons", "upcomingSeasons", "completedSeasons", "methodNotAllowed"]);
const seasonDetailRoute = source("functions/api/seasons/[slug].ts");
includesAll(seasonDetailRoute, ["getSeasonBySlug", "getSeasonAwards", "awards", "SEASON_NOT_FOUND"]);
const leaderboardRoute = source("functions/api/seasons/[slug]/leaderboard.ts");
includesAll(leaderboardRoute, ["getSeasonLeaderboard", "leaderboard"]);
const seasonFinaliseRoute = source("functions/api/admin/seasons/[seasonId]/finalise.ts");
includesAll(seasonFinaliseRoute, ["requireBadgeAdminUser", "finaliseSeason", "entriesFinalised", "awardsCreated", "badgesAwarded", "warnings"]);
const ownerSeasonStatusRoute = source("functions/api/servers/[serverId]/seasons/status.ts");
includesAll(ownerSeasonStatusRoute, ["resolveOwnerVisualLoadoutServer", "status: access.status", "getServerSeasonStatus", "Season status is temporarily unavailable."]);
const joinRoute = source("functions/api/servers/[serverId]/seasons/[seasonId]/join.ts");
includesAll(joinRoute, ["resolveOwnerVisualLoadoutServer", "status: access.status", "joinServerToSeason"]);
assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe\/webhook)[^"']*["']|player_profiles|kill_events|player_events|sessions|subscriptions/i.test(joinRoute), false, "Season join route must not touch protected systems.");

const docs = source("docs/DZN_SEASONS_SYSTEM.md");
includesAll(docs, [
  "same-category only",
  "Deathmatch vs Deathmatch",
  "PvP vs PvP",
  "PvE vs PvE",
  "Survival vs Survival",
  "server_stats",
  "It does not modify ADM ingestion",
  "fake stats are never invented",
]);

for (const route of [
  "app/seasons/page.tsx",
  "app/seasons/[slug]/page.tsx",
  "components/seasons/public-seasons.tsx",
]) {
  assert.equal(existsSync(route), true, `Expected public seasons UI route/component to exist: ${route}`);
}

const seasonsIndexPage = source("app/seasons/page.tsx");
includesAll(seasonsIndexPage, ["SeasonsIndexPage"]);
const seasonsSlugPage = source("app/seasons/[slug]/page.tsx");
includesAll(seasonsSlugPage, ["SeasonDetailPage", "generateStaticParams", "params: Promise<{ slug: string }>"]);
const publicSeasonsUi = source("components/seasons/public-seasons.tsx");
includesAll(publicSeasonsUi, [
  "Active Seasons",
  "Upcoming Seasons",
  "Completed Seasons",
  "Servers only compete against the same category.",
  "Deathmatch servers compete against Deathmatch servers only.",
  "PvP servers compete against PvP servers only.",
  "PvE servers compete against PvE servers only.",
  "Survival servers compete against Survival servers only.",
  "/api/seasons",
  "/leaderboard",
  "No servers have joined yet.",
  "No active seasons are running right now.",
  "Stored season snapshots",
  "Winners & Awards",
  "Awarded champion badge",
  "Winner awards will appear after this season is finalized.",
]);
assert.equal(/fake server|fake score|demo server|demo score/i.test(publicSeasonsUi), false, "Public seasons UI must not show fake servers or fake scores.");

const publicNetwork = source("components/network/public-network.tsx");
includesAll(publicNetwork, ["href=\"/seasons\"", "Seasons"]);

const serverSettingsPage = source("components/onboarding/server-settings-page.tsx");
includesAll(serverSettingsPage, [
  "DZN Seasons & Competitions",
  "/seasons/status",
  "/seasons/${encodeURIComponent(seasonId)}/join",
  "Servers only compete against the same category.",
  "Deathmatch -> Deathmatch only. PvP -> PvP only. PvE -> PvE only. Survival -> Survival only.",
  "Join Season",
  "This server has not joined a DZN season yet.",
  "Season awards",
  "Badge earned:",
  "Starter can join normal seasons.",
  "paid plans do not improve season scores or rank",
]);

const publicPlans = getBillingPlanSummaries({} as Env);
assert.deepEqual(publicPlans.map((plan) => plan.plan_key), ["starter", "pro", "premium"]);
assert.equal(publicPlans.some((plan) => /network|partner/i.test(`${plan.plan_key} ${plan.name} ${plan.price_label}`)), false);

console.log("DZN seasons foundation tests passed.");
