import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequest as publicProfileRoute } from "../functions/api/public/players/[handle]";
import {
  ensureCurrentPublicProfileHandle,
  normalizePublicProfileHandle,
  readPublicPlayerProfileByHandle,
} from "../functions/_lib/player-public-profiles";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

const migration = readFileSync("migrations/0063_player_public_profiles.sql", "utf8");
const helper = readFileSync("functions/_lib/player-public-profiles.ts", "utf8");
const publicApi = readFileSync("functions/api/public/players/[handle].ts", "utf8");
const shellRoute = readFileSync("functions/players/[handle].ts", "utf8");
const page = readFileSync("app/players/[handle]/page.tsx", "utf8");
const component = readFileSync("components/player/public-player-profile.tsx", "utf8");
const privatePrivacyRoute = readFileSync("functions/api/player/profile/privacy.ts", "utf8");
const privatePrivacyUi = readFileSync("components/player/profile-privacy-settings.tsx", "utf8");
const routesPatch = readFileSync("scripts/patch-pages-routes.mjs", "utf8");
const publicRoutes = readFileSync("public/_routes.json", "utf8");
const middleware = readFileSync("functions/_middleware.ts", "utf8");
const platformSpec = readFileSync("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md", "utf8");
const packageJson = readFileSync("package.json", "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS player_public_profiles/, "Migration must create the public profile handle table.");
assert.match(migration, /user_id TEXT NOT NULL UNIQUE/, "Public profiles must be one handle row per user.");
assert.match(migration, /handle TEXT NOT NULL UNIQUE/, "Public profile handles must be globally unique.");
assert.match(migration, /FOREIGN KEY\(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/, "Public handles must stay attached to the owning account.");
assert.match(migration, /CHECK \(status IN \('active', 'disabled'\)\)/, "Public handles must have constrained status values.");
assert.match(migration, /CHECK \(handle NOT GLOB '\*\[\^a-z0-9-\]\*'\)/, "Public handles must be lower-case URL-safe slugs.");
assert.doesNotMatch(
  migration,
  /\b(?:DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE\s+(?:player_profiles|player_stats|kill_events|player_events|server_stats|leaderboards|server_reviews|badge_awards|dzn_seasons|server_war_events|competitive_events|account_entitlements|supporter_cards|earned_spins|spin_ledger|linked_servers|nitrado_connections))\b/i,
  "Public profile migration must be additive and avoid protected gameplay, owner, competitive, review, and payment tables.",
);

assert.match(helper, /player_public_profiles\.status = 'active'/, "Public profile reads must require an active handle.");
assert.match(helper, /player_profile_privacy_preferences\.public_profile_enabled = 1/, "Public profile reads must require saved public-profile opt-in.");
assert.match(helper, /visiblePublicProfileSections/, "Public profile payload must derive visible sections from saved preferences.");
assert.match(helper, /private_identifiers_exposed: false/, "Public profile payload must mark private identifiers as hidden.");
assert.match(helper, /raw_award_evidence_exposed: false/, "Public profile payload must mark raw award evidence as hidden.");
assert.match(helper, /Profile visibility cannot alter billing, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, or competitive eligibility/, "Public profile helper must keep the fairness boundary explicit.");
assert.doesNotMatch(
  helper,
  /\b(?:account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|nitrado_connections|server_reviews|review_score|badge_awards|user_badges|dzn_season|server_war_events|ctf_tournaments|xp_award|calling_card_awards|dynamic_visibility_score|network_rank|rankServers|competitive_event_servers)\b/i,
  "Public profile helper must stay out of payment, owner, review, award, event, ranking, discovery, and competitive systems.",
);

assert.match(publicApi, /request\.method !== "GET"/, "Public profile API must be read-only.");
assert.match(publicApi, /readPublicPlayerProfileByHandle\(env, params\.handle\)/, "Public profile API must use the canonical reader.");
assert.match(publicApi, /PROFILE_NOT_FOUND/, "Hidden and missing profiles must share a safe not-found response.");
assert.match(publicApi, /noStoreForErrorHeaders\(\{ vary: "Cookie" \}\)/, "Published public profile responses must be no-store so privacy changes are not served stale.");
assert.doesNotMatch(publicApi, /publicCacheHeaders/, "Public profile payloads must not use stale public cache headers.");
assert.doesNotMatch(publicApi, /\b(?:getSessionUser|ensureMockUser|INSERT INTO|UPDATE\s+[a-z_]+|DELETE FROM)\b/i, "Public profile API must not require sessions or write data.");
assert.match(shellRoute, /env\.ASSETS\.fetch/, "Dynamic public profile pages must serve the static players shell through Pages assets.");
assert.match(shellRoute, /\/players"/, "Dynamic public profile shell must serve the exported players page.");
assert.doesNotMatch(shellRoute, /\/players\.html/, "Dynamic public profile shell must avoid the redirected .html asset path on Pages.");
assert.match(page, /generateStaticParams/, "The exported dynamic player route must include a static shell path.");
assert.match(component, /fetch\(`\/api\/public\/players\/\$\{encodeURIComponent\(handle\)\}`/, "Public profile UI must read the public-safe profile API.");
assert.match(component, /credentials: "omit"/, "Public profile UI must not send player cookies to the public profile API.");
assert.doesNotMatch(component, /SiteHeaderAuthState authenticated=\{false\}/, "Public profile pages must let the shared header resolve the real logged-in state.");
assert.match(component, /Manage My Profile/, "Public profile UI must send owners to the private profile settings surface.");
assert.doesNotMatch(component, /\b(?:sendBeacon|analytics|localStorage|sessionStorage)\b/i, "Public profile UI must not store share history or track analytics.");
assert.doesNotMatch(component, /fetch\([^)]*(?:checkout|STRIPE|nitrado_connections|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|server_reviews|competitive_events|leaderboards)/i, "Public profile UI must not call Store/payment/owner/review/event/competitive routes.");
assert.match(privatePrivacyRoute, /ensureCurrentPublicProfileHandle/, "Private profile settings must create a handle only from the authenticated current-user route.");
assert.match(privatePrivacyRoute, /public_profile_href: activePublicProfile\?\.href/, "Private settings payload must expose the public href only when the active current-user handle exists.");
assert.match(privatePrivacyUi, /View Public Profile/, "Private settings UI must link to the public profile only after the private API returns it.");
assert.match(routesPatch, /"\/players\/\*"/, "Build route patcher must include dynamic public player profile routes.");
assert.match(publicRoutes, /"\/players\/\*"/, "Static route manifest must include dynamic public player profile routes.");
assert.doesNotMatch(middleware, /\/players\b/, "Public player profile pages must not be added to the private player route gate.");
assert.match(platformSpec, /Public profile publishing\/viewer foundation/i, "Master spec must track the public profile publishing/viewer foundation slice.");
assert.match(packageJson, /"test:public-player-profile-viewer": "tsx scripts\/test-public-player-profile-viewer\.ts"/, "Dedicated public profile viewer test script must be registered.");

async function testPublicProfileRuntimeContract() {
  const db = new FakePublicProfileD1();
  const env = { DB: db } as unknown as Env;
  const currentUser: SessionUser = {
    id: "user-1",
    discord_id: "discord-1",
    username: "Rafael DZN",
    avatar: null,
  };
  db.users.set("user-1", { discord_id: "discord-1", username: "Rafael DZN" });
  db.users.set("other-user", { discord_id: "discord-2", username: "Hidden Player" });

  assert.equal(normalizePublicProfileHandle("  Rafael DZN!!  "), "rafael-dzn", "Display names must normalize into safe handle bases.");
  assert.equal(normalizePublicProfileHandle("!!"), "dzn-player", "Empty display names must fall back to a generic safe handle base.");
  assert.equal(normalizePublicProfileHandle("A".repeat(90)).length, 48, "Public handle normalization must respect the migration length limit.");

  const generated = await ensureCurrentPublicProfileHandle(env, currentUser);
  assert.match(generated.handle, /^rafael-dzn-[a-z0-9]{6,8}$/, "Generated handles must include a collision-safe suffix.");
  assert.equal(generated.href, `/players/${generated.handle}`, "Generated handles must carry their public profile href.");

  const hiddenWithoutPreferences = await readPublicPlayerProfileByHandle(env, generated.handle);
  assert.equal(hiddenWithoutPreferences, null, "A generated handle alone must not publish a public profile.");

  db.preferences.set("user-1", preferenceRow({
    public_profile_enabled: 1,
    show_display_name: 0,
    show_gameplay_summary: 0,
    show_featured_server: 0,
    show_xp_progress: 1,
    show_challenge_progress: 0,
    show_calling_cards: 1,
    show_award_dates: 0,
  }));

  const minimalPublicProfile = await readPublicPlayerProfileByHandle(env, generated.handle);
  assert.ok(minimalPublicProfile, "An active handle plus saved opt-in should publish the public-safe profile.");
  assert.equal(minimalPublicProfile.display_name, "DZN Player", "Hidden display names must fall back to a generic label.");
  assert.equal(minimalPublicProfile.sections.display_name.value, null, "Hidden display name sections must omit the chosen name.");
  assert.equal(minimalPublicProfile.sections.gameplay_summary.totals, null, "Hidden gameplay summaries must omit gameplay totals.");
  assert.equal(minimalPublicProfile.sections.featured_server.server, null, "Hidden featured servers must omit server details.");
  assert.equal(minimalPublicProfile.sections.xp_progress.visible, true, "Visible future XP sections may show public-safe status copy.");
  assert.equal(minimalPublicProfile.sections.challenge_progress.visible, false, "Hidden future challenge sections must stay hidden.");
  assertNoPrivatePublicProfileLeak(minimalPublicProfile);

  db.preferences.set("user-1", preferenceRow({
    public_profile_enabled: 1,
    show_display_name: 1,
    show_gameplay_summary: 1,
    show_featured_server: 1,
    show_xp_progress: 1,
    show_challenge_progress: 1,
    show_calling_cards: 1,
    show_award_dates: 1,
  }));
  db.aggregates.set("discord-1", {
    linked_public_servers: 2,
    kills: 44,
    deaths: 12,
    suicides: 1,
    longest_kill_distance: 760,
    last_seen_at: "2026-08-31T21:00:00.000Z",
  });
  db.featuredServers.set("discord-1", {
    public_slug: "pandora-network",
    server_name: "Pandora Network",
    server_type: "PVP",
    platform: "Xbox",
    map_name: "Chernarus",
    kills: 32,
    deaths: 8,
    longest_kill_distance: 760,
    last_seen_at: "2026-08-31T21:00:00.000Z",
  });

  const published = await readPublicPlayerProfileByHandle(env, generated.handle);
  assert.ok(published, "Published public profiles should resolve by handle.");
  assert.equal(published.display_name, "Rafael DZN", "Display names may appear only when saved preferences allow them.");
  assert.equal(published.sections.gameplay_summary.totals?.kills, 44, "Gameplay summaries may show public-safe aggregate totals.");
  assert.equal(published.sections.featured_server.server?.href, "/servers/profile?slug=pandora-network", "Featured servers must link through public-safe server profile paths.");
  assert.deepEqual(published.privacy.visible_sections, [
    "display_name",
    "gameplay_summary",
    "featured_server",
    "xp_progress",
    "challenge_progress",
    "calling_cards",
    "award_dates",
  ], "Visible sections must exactly follow saved preferences.");
  assertNoPrivatePublicProfileLeak(published);

  db.publicProfilesByHandle.set("disabled-profile", {
    user_id: "user-1",
    handle: "disabled-profile",
    status: "disabled",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(await readPublicPlayerProfileByHandle(env, "disabled-profile"), null, "Disabled handles must not publish.");
  assert.equal(await readPublicPlayerProfileByHandle(env, "bad--handle"), null, "Invalid handles must not publish.");

  db.publicProfilesByHandle.set("private-profile", {
    user_id: "other-user",
    handle: "private-profile",
    status: "active",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });
  db.publicProfilesByUser.set("other-user", db.publicProfilesByHandle.get("private-profile")!);
  db.preferences.set("other-user", preferenceRow({ public_profile_enabled: 0 }));
  const hiddenRouteResponse = await callPublicProfileRoute(db, "private-profile");
  assert.equal(hiddenRouteResponse.status, 404, "Hidden profiles must return the same public-safe 404 as missing profiles.");
  const hiddenRoutePayload = await hiddenRouteResponse.json() as { error: string; message: string };
  assert.equal(hiddenRoutePayload.error, "PROFILE_NOT_FOUND", "Hidden profile route errors must not reveal that a handle exists.");

  const publishedRouteResponse = await callPublicProfileRoute(db, generated.handle);
  assert.equal(publishedRouteResponse.status, 200, "Published public profiles should return 200.");
  assert.equal(publishedRouteResponse.headers.get("cache-control")?.includes("no-store"), true, "Published public profile reads must be no-store so privacy changes are respected immediately.");
  const publishedRoutePayload = await publishedRouteResponse.json();
  assertNoPrivatePublicProfileLeak(publishedRoutePayload);

  const blockedPost = await callPublicProfileRoute(db, generated.handle, "POST");
  assert.equal(blockedPost.status, 405, "Public profile routes must reject mutations.");

  assert.deepEqual([...db.writeTargets], ["player_public_profiles"], "Runtime writes must be limited to generated public profile handles.");
  assert.deepEqual(db.protectedWrites, [], "Public profile runtime must not write billing, owner, review, event, scoring, award, or competitive tables.");
  assertProtectedTablesWereNotQueried(db);
}

async function callPublicProfileRoute(
  db: FakePublicProfileD1,
  handle: string,
  method: "GET" | "POST" = "GET",
) {
  return publicProfileRoute({
    request: new Request(`https://dzn.test/api/public/players/${handle}`, { method }),
    env: { DB: db } as unknown as Env,
    params: { handle },
    data: {},
    waitUntil: () => undefined,
    next: async () => new Response(null, { status: 404 }),
  } satisfies PagesContext) as Promise<Response>;
}

type FakeUserRow = {
  discord_id: string;
  username: string | null;
};

type FakePublicProfileRow = {
  user_id: string;
  handle: string;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
};

type FakePreferenceRow = {
  public_profile_enabled: number;
  show_display_name: number;
  show_gameplay_summary: number;
  show_featured_server: number;
  show_xp_progress: number;
  show_challenge_progress: number;
  show_calling_cards: number;
  show_award_dates: number;
  preferences_updated_at: string;
};

type FakeAggregateRow = {
  linked_public_servers: number;
  kills: number;
  deaths: number;
  suicides: number;
  longest_kill_distance: number;
  last_seen_at: string | null;
};

type FakeFeaturedServerRow = {
  public_slug: string;
  server_name: string;
  server_type: string;
  platform: string | null;
  map_name: string | null;
  kills: number;
  deaths: number;
  longest_kill_distance: number;
  last_seen_at: string | null;
};

class FakePublicProfileD1 {
  readonly users = new Map<string, FakeUserRow>();
  readonly publicProfilesByUser = new Map<string, FakePublicProfileRow>();
  readonly publicProfilesByHandle = new Map<string, FakePublicProfileRow>();
  readonly preferences = new Map<string, FakePreferenceRow>();
  readonly aggregates = new Map<string, FakeAggregateRow>();
  readonly featuredServers = new Map<string, FakeFeaturedServerRow>();
  readonly writeTargets: string[] = [];
  readonly protectedWrites: string[] = [];
  readonly queries: string[] = [];

  prepare(query: string) {
    this.queries.push(normalizedSql(query));
    return new FakeD1PreparedStatement(this, query);
  }

  batch() {
    throw new Error("Fake D1 batch is not implemented for public profile tests.");
  }

  exec() {
    throw new Error("Fake D1 exec is not implemented for public profile tests.");
  }
}

class FakeD1PreparedStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: FakePublicProfileD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async first<T>() {
    const query = normalizedSql(this.query);

    if (query.includes("select handle, status, created_at, updated_at") && query.includes("where user_id = ?")) {
      const row = this.db.publicProfilesByUser.get(String(this.bindings[0]));
      return (row ?? null) as T | null;
    }

    if (query.includes("select user_id from player_public_profiles where handle = ?")) {
      const row = this.db.publicProfilesByHandle.get(String(this.bindings[0]));
      return (row ? { user_id: row.user_id } : null) as T | null;
    }

    if (query.includes("from player_public_profiles") && query.includes("inner join users") && query.includes("player_profile_privacy_preferences")) {
      const row = this.db.publicProfilesByHandle.get(String(this.bindings[0]));
      if (!row || row.status !== "active") return null as T | null;
      const user = this.db.users.get(row.user_id);
      const preferences = this.db.preferences.get(row.user_id);
      if (!user || !preferences || preferences.public_profile_enabled !== 1) return null as T | null;
      return {
        user_id: row.user_id,
        handle: row.handle,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        discord_id: user.discord_id,
        username: user.username,
        ...preferences,
      } as T;
    }

    if (query.includes("count(distinct player_profiles.linked_server_id)")) {
      return (this.db.aggregates.get(String(this.bindings[0])) ?? null) as T | null;
    }

    if (query.includes("linked_servers.public_slug")) {
      return (this.db.featuredServers.get(String(this.bindings[0])) ?? null) as T | null;
    }

    throw new Error(`Unexpected read in fake D1: ${this.query}`);
  }

  async run() {
    const query = normalizedSql(this.query);
    recordProtectedWrite(this.db, query);

    if (query.includes("insert into player_public_profiles")) {
      this.db.writeTargets.push("player_public_profiles");
      const userId = String(this.bindings[1]);
      const candidate = String(this.bindings[2]);
      const now = String(this.bindings[4]);
      const existing = this.db.publicProfilesByUser.get(userId);
      const row = {
        user_id: userId,
        handle: existing?.handle ?? candidate,
        status: "active" as const,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      this.db.publicProfilesByUser.set(userId, row);
      this.db.publicProfilesByHandle.set(row.handle, row);
      return d1Ok();
    }

    throw new Error(`Unexpected write in fake D1: ${this.query}`);
  }

  async all<T>() {
    return d1Ok<T>([]);
  }

  raw() {
    throw new Error("Fake D1 raw is not implemented for public profile tests.");
  }
}

function preferenceRow(overrides: Partial<Record<keyof FakePreferenceRow, number | string>> = {}): FakePreferenceRow {
  return {
    public_profile_enabled: Number(overrides.public_profile_enabled ?? 1),
    show_display_name: Number(overrides.show_display_name ?? 1),
    show_gameplay_summary: Number(overrides.show_gameplay_summary ?? 1),
    show_featured_server: Number(overrides.show_featured_server ?? 1),
    show_xp_progress: Number(overrides.show_xp_progress ?? 1),
    show_challenge_progress: Number(overrides.show_challenge_progress ?? 1),
    show_calling_cards: Number(overrides.show_calling_cards ?? 1),
    show_award_dates: Number(overrides.show_award_dates ?? 0),
    preferences_updated_at: String(overrides.preferences_updated_at ?? "2026-09-01T00:00:00.000Z"),
  };
}

function assertNoPrivatePublicProfileLeak(payload: unknown) {
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /discord-1|discord-2|user-1|other-user|"discord_id"|"user_id"|"player_id"|"player_name"|"raw_evidence"|account_entitlements|supporter_cards/i, "Public profile payloads must not expose private ids, raw evidence fields, or payment table data.");
  assert.match(serialized, /"private_identifiers_exposed":false/, "Public profile payloads must explicitly mark private identifiers as hidden.");
  assert.match(serialized, /"raw_award_evidence_exposed":false/, "Public profile payloads must explicitly mark raw award evidence as hidden.");
}

function assertProtectedTablesWereNotQueried(db: FakePublicProfileD1) {
  const joinedQueries = db.queries.join("\n");
  assert.doesNotMatch(
    joinedQueries,
    /\b(?:account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|nitrado_connections|server_reviews|review_score|badge_awards|user_badges|dzn_seasons|server_war_events|ctf_tournaments|xp_award|calling_card_awards|dynamic_visibility_score|network_rank|leaderboards|competitive_event_servers)\b/i,
    "Public profile reads must not query protected payment, owner, review, award, event, ranking, discovery, or competitive tables.",
  );
}

function recordProtectedWrite(db: FakePublicProfileD1, query: string) {
  if (!/^(insert|update|delete|replace)\b/.test(query)) return;
  const protectedTable = query.match(/\b(?:into|update|from)\s+(account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|nitrado_connections|linked_servers|server_reviews|badge_awards|user_badges|dzn_seasons|server_war_events|ctf_tournaments|competitive_events|competitive_event_servers|player_profiles|player_stats|kill_events|player_events|server_stats|leaderboards)\b/i)?.[1];
  if (protectedTable) db.protectedWrites.push(protectedTable);
}

function normalizedSql(query: string) {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

function d1Ok<T = unknown>(results: T[] = []) {
  return {
    results,
    success: true,
    meta: {},
  };
}

void testPublicProfileRuntimeContract()
  .then(() => {
    console.log("Public player profile viewer tests passed.");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
