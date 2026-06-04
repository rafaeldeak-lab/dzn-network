import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { getBillingPlanSummaries } from "../functions/_lib/plans";
import { calculateSeasonScoreFromStats, normalizeSeasonCategory, refreshSeasonScores } from "../functions/_lib/dzn-seasons";
import { onRequestPost as adminSeasonRefreshPost } from "../functions/api/admin/seasons/[seasonId]/refresh";
import { onRequestPost as cronSeasonRefreshPost } from "../functions/api/cron/seasons/refresh";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

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
assert.equal(helper.includes("b.score - a.score"), true, "Season leaderboard refresh should rank by calculated score.");
assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe\/webhook)[^"']*["']|player_profiles|kill_events|player_events|sessions|subscriptions/i.test(helper), false, "Season helper must not import ADM/Nitrado/Stripe webhook or touch protected row tables.");

for (const route of [
  "functions/api/seasons.ts",
  "functions/api/seasons/[slug].ts",
  "functions/api/seasons/[slug]/leaderboard.ts",
  "functions/api/cron/seasons/refresh.ts",
  "functions/api/admin/seasons/[seasonId]/refresh.ts",
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
assert.equal(leaderboardRoute.includes("refreshSeasonScores"), false, "Public leaderboard reads must not write score snapshots.");
const cronRefreshRoute = source("functions/api/cron/seasons/refresh.ts");
includesAll(cronRefreshRoute, ["requireCronSecret", "refreshActiveSeasonScores", "seasonsChecked", "entriesRefreshed", "snapshotsCreated", "warnings"]);
const adminRefreshRoute = source("functions/api/admin/seasons/[seasonId]/refresh.ts");
includesAll(adminRefreshRoute, ["requireBadgeAdminUser", "refreshSeasonScores", "allowCompleted: false", "refreshedEntries", "warnings"]);
const seasonFinaliseRoute = source("functions/api/admin/seasons/[seasonId]/finalise.ts");
includesAll(seasonFinaliseRoute, ["requireBadgeAdminUser", "finaliseSeason", "entriesFinalised", "awardsCreated", "badgesAwarded", "warnings"]);
const ownerSeasonStatusRoute = source("functions/api/servers/[serverId]/seasons/status.ts");
includesAll(ownerSeasonStatusRoute, ["resolveOwnerVisualLoadoutServer", "status: access.status", "getServerSeasonStatus", "Season status is temporarily unavailable."]);
const joinRoute = source("functions/api/servers/[serverId]/seasons/[seasonId]/join.ts");
includesAll(joinRoute, ["resolveOwnerVisualLoadoutServer", "status: access.status", "joinServerToSeason"]);
assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe\/webhook)[^"']*["']|player_profiles|kill_events|player_events|sessions|subscriptions/i.test(joinRoute), false, "Season join route must not touch protected systems.");
for (const routeSource of [cronRefreshRoute, adminRefreshRoute, leaderboardRoute]) {
  assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe\/webhook)[^"']*["']|player_profiles|kill_events|player_events|subscriptions/i.test(routeSource), false, "Season refresh/read routes must not touch protected systems.");
}

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
  "Last score refresh",
  "Waiting for first score snapshot",
  "Next refresh",
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
  "Last refreshed",
  "Waiting for first score snapshot",
  "Starter can join normal seasons.",
  "paid plans do not improve season scores or rank",
]);

const publicPlans = getBillingPlanSummaries({} as Env);
assert.deepEqual(publicPlans.map((plan) => plan.plan_key), ["starter", "pro", "premium"]);
assert.equal(publicPlans.some((plan) => /network|partner/i.test(`${plan.plan_key} ${plan.name} ${plan.price_label}`)), false);

async function runRefreshAutomationChecks() {
  const unauthorizedCron = await cronSeasonRefreshPost(makeContext(new Request("https://dzn.test/api/cron/seasons/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }), {} as Env));
  assert.equal(unauthorizedCron.status, 401, "Cron season refresh must require the shared cron secret.");

  const db = createSeasonDb("active");
  const cronResponse = await cronSeasonRefreshPost(makeContext(new Request("https://dzn.test/api/cron/seasons/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", "x-dzn-cron-secret": "unit-test-secret" },
    body: JSON.stringify({ limit: 10 }),
  }), { DB: db as unknown as D1Database, DZN_CRON_SECRET: "unit-test-secret" } as Env));
  assert.equal(cronResponse.status, 200);
  const cronJson = await cronResponse.json() as { ok: boolean; seasonsChecked: number; entriesRefreshed: number; snapshotsCreated: number; warnings: string[] };
  assert.equal(cronJson.ok, true);
  assert.equal(cronJson.seasonsChecked, 1);
  assert.equal(cronJson.entriesRefreshed, 2);
  assert.equal(cronJson.snapshotsCreated, 2);
  assert.equal(db.snapshots.length, 2, "Active refresh should write season score snapshots.");
  assert.equal(db.entries.find((entry) => entry.server_id === "server-b")?.rank, 1, "Higher refreshed score should safely receive rank 1.");
  assert.equal(db.entries.find((entry) => entry.server_id === "server-a")?.rank, 2, "Lower refreshed score should safely receive rank 2.");

  const fixedCapturedAt = "2026-06-04T12:00:00.000Z";
  const duplicateDb = createSeasonDb("active");
  const duplicateEnv = { DB: duplicateDb as unknown as D1Database } as Env;
  const firstRefresh = await refreshSeasonScores(duplicateEnv, "season-active", { limit: 2, maxLimit: 25, capturedAt: fixedCapturedAt });
  const secondRefresh = await refreshSeasonScores(duplicateEnv, "season-active", { limit: 2, maxLimit: 25, capturedAt: fixedCapturedAt });
  assert.equal(firstRefresh.snapshotsCreated, 2);
  assert.equal(secondRefresh.snapshotsCreated, 0, "Repeated refresh at the same captured time must not duplicate snapshots.");
  const uniqueSnapshotKeys = new Set(duplicateDb.snapshots.map((snapshot) => `${snapshot.season_id}:${snapshot.server_id}:${snapshot.captured_at}`));
  assert.equal(uniqueSnapshotKeys.size, duplicateDb.snapshots.length, "Snapshot keys should be unique within a refresh run.");

  const completedDb = createSeasonDb("completed");
  const completedBefore = completedDb.snapshots.length;
  const adminRequest = new Request("https://dzn.test/api/admin/seasons/season-completed/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "dzn_session=session-token" },
    body: JSON.stringify({ limit: 10 }),
  });
  const completedResponse = await adminSeasonRefreshPost(makeContext(adminRequest, {
    DB: completedDb as unknown as D1Database,
    DZN_ADMIN_DISCORD_IDS: "admin-discord",
  } as Env, { seasonId: "season-completed" }));
  assert.equal(completedResponse.status, 200);
  const completedJson = await completedResponse.json() as { entriesRefreshed: number; snapshotsCreated: number; warnings: string[] };
  assert.equal(completedJson.entriesRefreshed, 0);
  assert.equal(completedJson.snapshotsCreated, 0);
  assert.equal(completedDb.snapshots.length, completedBefore, "Completed seasons must not be overwritten by refresh endpoints.");
  assert.match(completedJson.warnings.join(" "), /completed/i);

  const unauthAdmin = await adminSeasonRefreshPost(makeContext(new Request("https://dzn.test/api/admin/seasons/season-active/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }), { DB: createSeasonDb("active") as unknown as D1Database } as Env, { seasonId: "season-active" }));
  assert.equal(unauthAdmin.status, 401, "Admin season refresh must return 401 for unauthenticated requests.");

  const nonAdminDb = createSeasonDb("active", {
    id: "user-1",
    discord_id: "not-admin",
    username: "Owner",
    avatar: null,
  });
  const nonAdmin = await adminSeasonRefreshPost(makeContext(new Request("https://dzn.test/api/admin/seasons/season-active/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "dzn_session=session-token" },
    body: "{}",
  }), { DB: nonAdminDb as unknown as D1Database, DZN_ADMIN_DISCORD_IDS: "admin-discord" } as Env, { seasonId: "season-active" }));
  assert.equal(nonAdmin.status, 403, "Admin season refresh must return 403 for non-admin users.");
}

type TestSeasonStatus = "active" | "completed";

type TestSeasonRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  status: string;
  starts_at: string;
  ends_at: string;
  scoring_rules_json: string | null;
  created_at: string;
  updated_at: string;
};

type TestEntryRow = {
  id: string;
  season_id: string;
  server_id: string;
  category: string;
  joined_at: string;
  status: string;
  snapshot_start_json: string | null;
  snapshot_current_json: string | null;
  final_score: number | null;
  rank: number | null;
  created_at: string;
  updated_at: string;
};

type TestServerRow = {
  id: string;
  server_name: string | null;
  public_slug: string | null;
  server_category: string | null;
  server_type: string | null;
  status: string | null;
  total_kills: number | null;
  total_deaths: number | null;
  total_joins: number | null;
  total_disconnects: number | null;
  unique_players: number | null;
  last_event_at: string | null;
  stats_updated_at: string | null;
};

type TestSnapshotRow = {
  id: string;
  season_id: string;
  server_id: string;
  score: number;
  rank: number | null;
  metrics_json: string;
  captured_at: string;
};

class SeasonMemoryD1 {
  seasons: TestSeasonRow[];
  entries: TestEntryRow[];
  servers: TestServerRow[];
  snapshots: TestSnapshotRow[];
  sessionUser: SessionUser | null;

  constructor(status: TestSeasonStatus, sessionUser: SessionUser | null) {
    const seasonId = status === "completed" ? "season-completed" : "season-active";
    const now = "2026-06-04T10:00:00.000Z";
    this.seasons = [{
      id: seasonId,
      slug: seasonId,
      name: status === "completed" ? "Completed Season" : "Active Season",
      category: "deathmatch",
      status: status === "completed" ? "completed" : "active",
      starts_at: "2026-06-01T00:00:00.000Z",
      ends_at: status === "completed" ? "2026-06-02T00:00:00.000Z" : "2026-07-01T00:00:00.000Z",
      scoring_rules_json: null,
      created_at: now,
      updated_at: now,
    }];
    this.entries = [
      makeEntry("entry-a", seasonId, "server-a", "2026-06-01T00:00:00.000Z", status === "completed" ? 500 : null, status === "completed" ? 1 : null),
      makeEntry("entry-b", seasonId, "server-b", "2026-06-01T00:05:00.000Z", status === "completed" ? 300 : null, status === "completed" ? 2 : null),
    ];
    this.servers = [
      makeServer("server-a", "Alpha", 10, 5, 10),
      makeServer("server-b", "Bravo", 60, 10, 30),
    ];
    this.snapshots = status === "completed"
      ? [{ id: "snapshot-completed", season_id: seasonId, server_id: "server-a", score: 500, rank: 1, metrics_json: "{}", captured_at: "2026-06-02T01:00:00.000Z" }]
      : [];
    this.sessionUser = sessionUser ?? {
      id: "admin-user",
      discord_id: "admin-discord",
      username: "Admin",
      avatar: null,
    };
  }

  prepare(sql: string) {
    return new SeasonMemoryStatement(this, sql);
  }
}

class SeasonMemoryStatement {
  private args: unknown[] = [];

  constructor(private readonly db: SeasonMemoryD1, private readonly sql: string) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async run() {
    const normalized = normalizeSql(this.sql);
    if (normalized.startsWith("create ")) return { success: true, meta: { changes: 0 } };
    if (normalized.startsWith("insert into dzn_season_score_snapshots")) {
      this.db.snapshots.push({
        id: String(this.args[0]),
        season_id: String(this.args[1]),
        server_id: String(this.args[2]),
        score: Number(this.args[3]),
        rank: this.args[4] === null || this.args[4] === undefined ? null : Number(this.args[4]),
        metrics_json: String(this.args[5]),
        captured_at: String(this.args[6]),
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (normalized.startsWith("update dzn_season_entries set snapshot_current_json")) {
      const entry = this.db.entries.find((row) => row.id === String(this.args[4]));
      if (entry) {
        entry.snapshot_current_json = String(this.args[0]);
        entry.final_score = Number(this.args[1]);
        entry.rank = this.args[2] === null || this.args[2] === undefined ? null : Number(this.args[2]);
        entry.updated_at = String(this.args[3]);
      }
      return { success: true, meta: { changes: entry ? 1 : 0 } };
    }
    if (normalized.startsWith("update dzn_season_entries set rank =")) {
      const entry = this.db.entries.find((row) => row.id === String(this.args[1]));
      if (entry) entry.rank = this.args[0] === null || this.args[0] === undefined ? null : Number(this.args[0]);
      return { success: true, meta: { changes: entry ? 1 : 0 } };
    }
    return { success: true, meta: { changes: 0 } };
  }

  async first<T>() {
    const normalized = normalizeSql(this.sql);
    if (normalized.startsWith("select users.id, users.discord_id")) return this.db.sessionUser as T | null;
    if (normalized.startsWith("select * from dzn_seasons")) {
      const value = String(this.args[0]);
      return (this.db.seasons.find((season) => season.id === value || season.slug === value) ?? null) as T | null;
    }
    if (normalized.startsWith("select linked_servers.id")) {
      const value = String(this.args[0]);
      return (this.db.servers.find((server) => server.id === value || server.public_slug === value) ?? null) as T | null;
    }
    if (normalized.startsWith("select * from dzn_season_entries where season_id = ? and server_id = ?")) {
      const seasonId = String(this.args[0]);
      const serverId = String(this.args[1]);
      return (this.db.entries.find((entry) => entry.season_id === seasonId && entry.server_id === serverId) ?? null) as T | null;
    }
    if (normalized.startsWith("select id from dzn_season_score_snapshots")) {
      const seasonId = String(this.args[0]);
      const serverId = String(this.args[1]);
      const capturedAt = String(this.args[2]);
      const snapshot = this.db.snapshots.find((row) => row.season_id === seasonId && row.server_id === serverId && row.captured_at === capturedAt);
      return (snapshot ? { id: snapshot.id } : null) as T | null;
    }
    return null;
  }

  async all<T>() {
    const normalized = normalizeSql(this.sql);
    if (normalized.startsWith("select * from dzn_seasons where lower(status) in")) {
      return { results: this.db.seasons.filter((season) => ["registration_open", "active", "live", "upcoming"].includes(season.status)) as T[] };
    }
    if (normalized.startsWith("select * from dzn_season_entries where season_id = ?")) {
      const seasonId = String(this.args[0]);
      const limit = Number(this.args[1] ?? 500);
      const rows = this.db.entries
        .filter((entry) => entry.season_id === seasonId && entry.status !== "withdrawn")
        .sort((left, right) => {
          if (normalized.includes("coalesce(updated_at")) {
            return left.updated_at.localeCompare(right.updated_at) || left.joined_at.localeCompare(right.joined_at);
          }
          return left.joined_at.localeCompare(right.joined_at);
        })
        .slice(0, limit);
      return { results: rows as T[] };
    }
    return { results: [] as T[] };
  }
}

function createSeasonDb(status: TestSeasonStatus, sessionUser?: SessionUser | null) {
  return new SeasonMemoryD1(status, sessionUser ?? null);
}

function makeEntry(id: string, seasonId: string, serverId: string, joinedAt: string, score: number | null, rank: number | null): TestEntryRow {
  return {
    id,
    season_id: seasonId,
    server_id: serverId,
    category: "deathmatch",
    joined_at: joinedAt,
    status: "joined",
    snapshot_start_json: null,
    snapshot_current_json: null,
    final_score: score,
    rank,
    created_at: joinedAt,
    updated_at: joinedAt,
  };
}

function makeServer(id: string, name: string, kills: number, deaths: number, joins: number): TestServerRow {
  return {
    id,
    server_name: name,
    public_slug: id,
    server_category: "deathmatch",
    server_type: "deathmatch",
    status: "live",
    total_kills: kills,
    total_deaths: deaths,
    total_joins: joins,
    total_disconnects: joins,
    unique_players: Math.max(1, Math.round(joins / 2)),
    last_event_at: "2026-06-04T09:00:00.000Z",
    stats_updated_at: "2026-06-04T09:00:00.000Z",
  };
}

function makeContext(request: Request, env: Env, params: Record<string, string> = {}): PagesContext {
  return {
    request,
    env,
    params,
    waitUntil: () => undefined,
    next: async () => new Response(null, { status: 404 }),
    data: {},
  };
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

runRefreshAutomationChecks()
  .then(() => {
    console.log("DZN seasons foundation tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
