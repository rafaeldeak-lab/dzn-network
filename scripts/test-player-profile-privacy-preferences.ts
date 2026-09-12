import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequest as privacyRoute } from "../functions/api/player/profile/privacy";
import type { Env, PagesContext } from "../functions/_lib/types";

const migration = readFileSync("migrations/0062_player_profile_privacy_preferences.sql", "utf8");
const route = readFileSync("functions/api/player/profile/privacy.ts", "utf8");
const component = readFileSync("components/player/profile-privacy-settings.tsx", "utf8");
const playerHome = readFileSync("components/player/player-home.tsx", "utf8");
const platformSpec = readFileSync("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md", "utf8");
const packageJson = readFileSync("package.json", "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS player_profile_privacy_preferences/, "Migration must create the player-owned privacy preference table.");
assert.match(migration, /user_id TEXT NOT NULL UNIQUE/, "Privacy preferences must be one row per current user.");
assert.match(migration, /FOREIGN KEY\(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/, "Privacy preferences must stay attached to the owning account.");
for (const column of [
  "public_profile_enabled",
  "show_display_name",
  "show_gameplay_summary",
  "show_featured_server",
  "show_xp_progress",
  "show_challenge_progress",
  "show_calling_cards",
  "show_award_dates",
]) {
  assert.match(migration, new RegExp(`${column} INTEGER NOT NULL DEFAULT`), `Migration must store ${column}.`);
  assert.match(migration, new RegExp(`CHECK \\(${column} IN \\(0, 1\\)\\)`), `${column} must be constrained to boolean integer values.`);
}
assert.doesNotMatch(
  migration,
  /\b(?:DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE\s+(?:player_profiles|player_stats|kill_events|player_events|server_stats|leaderboards|server_reviews|badge_awards|dzn_seasons|server_war_events|competitive_events|account_entitlements|supporter_cards|earned_spins|spin_ledger|linked_servers|nitrado_connections))\b/i,
  "Privacy migration must be additive and avoid protected player, competitive, owner, and payment tables.",
);

assert.match(route, /request\.method === "GET"/, "Privacy route must support private reads.");
assert.match(route, /request\.method === "PATCH"/, "Privacy route must support the approved private settings update.");
assert.match(route, /getSessionUser/, "Privacy route must require a current Discord session.");
assert.match(route, /status: 401/, "Privacy route must deny anonymous reads and writes.");
assert.match(route, /isSameOriginMutation/, "Privacy route must block cross-origin mutations.");
assert.match(route, /readBoundedJson<PreferencePatchBody>\(request, 4096\)/, "Privacy route must bound mutation bodies.");
assert.match(route, /FROM player_profile_privacy_preferences[\s\S]+WHERE user_id = \?/, "Privacy reads must be scoped to the current user.");
assert.match(route, /INSERT INTO player_profile_privacy_preferences[\s\S]+ON CONFLICT\(user_id\)/, "Privacy writes must target only the preference table.");
assert.match(route, /ON CONFLICT\(user_id\) DO UPDATE SET/, "Privacy writes must be idempotent per current user.");
assert.match(route, /current\.source === "unavailable"/, "Privacy PATCH must stop when the preference table cannot be read.");
assert.match(route, /ensureCurrentPublicProfileHandle/, "Opted-in public profiles must use the canonical generated handle helper.");
assert.match(route, /public_profile_href: activePublicProfile\?\.href/, "Privacy settings must only expose an active current-user public profile href.");
assert.match(route, /privateNoStoreHeaders\(\)/, "Privacy route must return private no-store data.");
assert.doesNotMatch(
  route,
  /\b(?:STRIPE|checkout_session|checkout\.session|nitrado_connections|server_reviews|review_score|badge_awards|user_badges|dzn_season|server_war_events|ctf_tournaments|xp_award|calling_card_awards|dynamic_visibility_score|network_rank|player_stats|rankServers|competitive_event_servers)\b/i,
  "Privacy route must stay out of payment, owner, review, award, event, ranking, discovery, and competitive systems.",
);

assert.match(component, /fetch\("\/api\/player\/profile\/privacy"/, "Profile UI must read the private privacy API.");
assert.match(component, /method: "PATCH"/, "Profile UI must save preferences through the approved PATCH API.");
assert.match(component, /credentials: "include"/, "Profile UI must send same-session credentials.");
assert.match(component, /Choose which approved sections can appear on your public DZN profile link/, "Profile UI must explain approved public profile display settings.");
assert.match(component, /View Public Profile/, "Profile UI must expose the public profile link only from the private current-user payload.");
assert.match(component, /Profile attribution across other DZN surfaces remains blocked/i, "Profile UI must preserve the future attribution boundary.");
assert.doesNotMatch(component, /\b(?:sendBeacon|analytics|localStorage|sessionStorage)\b/i, "Profile UI must not add tracking or browser storage.");
assert.doesNotMatch(
  component,
  /fetch\([^)]*(?:checkout|STRIPE|nitrado_connections|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|server_reviews|competitive_events|leaderboards)/i,
  "Profile privacy UI must not call Store/payment/owner/review/event/competitive routes.",
);

assert.match(playerHome, /PlayerProfilePrivacySettings/, "Personal player profile page must render the privacy settings panel.");
assert.match(playerHome, /mode === "profile" && authState\.status === "logged_in"/, "Privacy settings panel must be limited to logged-in profile mode.");

assert.match(platformSpec, /Player profile privacy settings model/i, "Master spec must track the privacy preferences slice.");
assert.match(platformSpec, /player_profile_privacy_preferences/i, "Master spec must name the canonical preference table.");
assert.match(platformSpec, /public profile publishing\/viewer/i, "Master spec must reserve public profile publishing for the next slice.");
assert.match(packageJson, /"test:player-profile-privacy-preferences": "tsx scripts\/test-player-profile-privacy-preferences\.ts"/, "Dedicated privacy preference test script must be registered.");

async function testPrivacyRouteRuntimeContract() {
  const db = new FakeD1Database();
  db.preferences.set("other-user", {
    public_profile_enabled: 1,
    show_display_name: 0,
    show_gameplay_summary: 0,
    show_featured_server: 0,
    show_xp_progress: 0,
    show_challenge_progress: 0,
    show_calling_cards: 0,
    show_award_dates: 1,
    updated_at: "2026-08-01T00:00:00.000Z",
  });

  const anonymous = await callPrivacyRoute(db, { DB: db } as unknown as Env, "GET");
  assert.equal(anonymous.status, 401, "Anonymous profile privacy reads must be denied.");

  const defaultRead = await callPrivacyRoute(db, { DB: db, MOCK_AUTH: "true" } as unknown as Env, "GET");
  assert.equal(defaultRead.status, 200, "Mock authenticated profile privacy reads should succeed.");
  assert.equal(defaultRead.headers.get("cache-control")?.includes("private, no-store"), true, "Privacy reads must be private no-store.");
  assert.equal(defaultRead.headers.get("vary"), "Cookie", "Privacy reads must vary by Cookie.");
  const defaultPayload = await defaultRead.json() as PrivacyPayload;
  assert.equal(defaultPayload.source, "defaults", "Missing preference rows should return default preferences without writing preference rows.");
  assert.equal(defaultPayload.settings.public_profile_enabled, false, "Public profile should default private.");
  assert.equal(defaultPayload.settings.show_award_dates, false, "Award dates should default hidden.");
  assert.equal(defaultPayload.public_profile_href, null, "Privacy preferences must not create a public profile URL.");
  assert.equal(defaultPayload.public_profile_handle, null, "Private default preferences must not expose a public profile handle.");
  assert.equal(db.preferences.has("mock-user"), false, "GET must not persist defaults implicitly.");

  const crossOrigin = await callPrivacyRoute(db, { DB: db, MOCK_AUTH: "true" } as unknown as Env, "PATCH", {
    settings: { public_profile_enabled: true },
  }, "https://evil.test");
  assert.equal(crossOrigin.status, 403, "Cross-origin profile privacy mutations must be denied.");

  const unknownKey = await callPrivacyRoute(db, { DB: db, MOCK_AUTH: "true" } as unknown as Env, "PATCH", {
    settings: { public_profile_enabled: true, billing_plan: true },
  });
  assert.equal(unknownKey.status, 400, "Unknown preference keys must be rejected.");

  const nonBoolean = await callPrivacyRoute(db, { DB: db, MOCK_AUTH: "true" } as unknown as Env, "PATCH", {
    settings: { show_display_name: "yes" },
  });
  assert.equal(nonBoolean.status, 400, "Non-boolean preference values must be rejected.");

  const unavailableDb = new FakeD1Database();
  unavailableDb.failPreferenceReads = true;
  const unavailablePatch = await callPrivacyRoute(unavailableDb, { DB: unavailableDb, MOCK_AUTH: "true" } as unknown as Env, "PATCH", {
    settings: { public_profile_enabled: true },
  });
  assert.equal(unavailablePatch.status, 503, "Preference writes must stop when current preferences cannot be read.");
  assert.equal(unavailableDb.preferences.has("mock-user"), false, "Unavailable preference reads must not be followed by preference writes.");
  assert.equal([...unavailableDb.writeTargets].includes("player_profile_privacy_preferences"), false, "Unavailable preference reads must not write the preference table.");

  const saved = await callPrivacyRoute(db, { DB: db, MOCK_AUTH: "true" } as unknown as Env, "PATCH", {
    settings: {
      public_profile_enabled: true,
      show_gameplay_summary: false,
      show_award_dates: true,
    },
  });
  assert.equal(saved.status, 200, "Current user should be able to save privacy preferences.");
  const savedPayload = await saved.json() as PrivacyPayload;
  assert.equal(savedPayload.source, "player_profile_privacy_preferences", "Successful writes should return the persisted source.");
  assert.equal(savedPayload.settings.public_profile_enabled, true, "Public profile enabled preference should persist.");
  assert.equal(savedPayload.settings.show_gameplay_summary, false, "Gameplay section preference should persist.");
  assert.equal(savedPayload.settings.show_featured_server, true, "Unspecified section preferences should keep defaults.");
  assert.equal(savedPayload.settings.show_award_dates, true, "Award date preference should persist.");
  assert.match(savedPayload.public_profile_href ?? "", /^\/players\/[a-z0-9][a-z0-9-]*-[a-z0-9]{6,8}$/, "Opting in should expose the generated current-user public profile URL.");
  assert.match(savedPayload.public_profile_handle ?? "", /^[a-z0-9][a-z0-9-]*-[a-z0-9]{6,8}$/, "Opting in should expose the generated current-user public profile handle.");

  const persisted = db.preferences.get("mock-user");
  assert.equal(persisted?.public_profile_enabled, 1, "Current-user preferences must be stored as constrained integers.");
  assert.equal(persisted?.show_gameplay_summary, 0, "Current-user preferences must store false values.");
  assert.equal(persisted?.show_award_dates, 1, "Current-user preferences must store true values.");

  const secondPatch = await callPrivacyRoute(db, { DB: db, MOCK_AUTH: "true" } as unknown as Env, "PATCH", {
    settings: { show_display_name: false },
  });
  assert.equal(secondPatch.status, 200, "Second patches should update the same current-user preference row.");
  const secondPayload = await secondPatch.json() as PrivacyPayload;
  assert.equal(secondPayload.settings.public_profile_enabled, true, "Second patches must preserve existing values.");
  assert.equal(secondPayload.settings.show_display_name, false, "Second patches must update requested values.");
  assert.equal(db.preferences.size, 2, "Idempotent current-user updates must not create duplicate rows.");
  assert.equal(db.preferences.get("other-user")?.public_profile_enabled, 1, "Other users' preference rows must not be changed.");

  const reread = await callPrivacyRoute(db, { DB: db, MOCK_AUTH: "true" } as unknown as Env, "GET");
  const rereadPayload = await reread.json() as PrivacyPayload;
  assert.equal(rereadPayload.settings.show_display_name, false, "GET must return the current user's saved settings.");
  assert.match(rereadPayload.public_profile_href ?? "", /^\/players\/[a-z0-9][a-z0-9-]*-[a-z0-9]{6,8}$/, "GET must return the existing current-user public profile link.");
  assert.equal(rereadPayload.private, true, "Preference payload must be marked private.");
  assert.equal(rereadPayload.presentation_only, true, "Preference payload must be marked presentation-only.");
  assert.ok(rereadPayload.fairness_boundary.some((line) => /do not bypass saved visibility controls/i.test(line)), "Preference payload must state the visibility control boundary.");

  assert.deepEqual([...db.writeTargets].sort(), ["discord_guilds", "player_profile_privacy_preferences", "player_public_profiles", "users"], "Privacy route writes must be limited to mock auth bootstrap, preference rows, and generated profile handles.");
  assert.deepEqual(db.protectedWrites, [], "Privacy route must not write protected billing, owner, progression, review, event, scoring, or competitive tables.");
}

async function callPrivacyRoute(
  db: FakeD1Database,
  env: Env,
  method: "GET" | "PATCH",
  body?: unknown,
  origin = "https://dzn.test",
) {
  return privacyRoute({
    request: new Request("https://dzn.test/api/player/profile/privacy", {
      method,
      headers: method === "PATCH" ? { "content-type": "application/json", origin } : undefined,
      body: method === "PATCH" ? JSON.stringify(body ?? {}) : undefined,
    }),
    env,
    params: {},
    data: {},
    waitUntil: () => undefined,
    next: async () => new Response(null, { status: 404 }),
  } satisfies PagesContext) as Promise<Response>;
}

type PrivacyPayload = {
  source: string;
  settings: Record<string, boolean>;
  public_profile_handle: string | null;
  public_profile_href: string | null;
  private: boolean;
  presentation_only: boolean;
  fairness_boundary: string[];
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
  updated_at: string;
};

type FakePublicProfileRow = {
  handle: string;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
};

class FakeD1Database {
  readonly preferences = new Map<string, FakePreferenceRow>();
  readonly publicProfilesByUser = new Map<string, FakePublicProfileRow>();
  readonly publicProfileOwnersByHandle = new Map<string, string>();
  readonly writeTargets = new Set<string>();
  readonly protectedWrites: string[] = [];
  failPreferenceReads = false;

  prepare(query: string) {
    return new FakeD1PreparedStatement(this, query);
  }

  batch() {
    throw new Error("Fake D1 batch is not implemented for privacy preference tests.");
  }

  exec() {
    throw new Error("Fake D1 exec is not implemented for privacy preference tests.");
  }
}

class FakeD1PreparedStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async first<T>() {
    const query = normalizedSql(this.query);
    if (query.includes("from player_profile_privacy_preferences")) {
      if (this.db.failPreferenceReads) throw new Error("preference reads unavailable");
      const row = this.db.preferences.get(String(this.bindings[0]));
      return (row ?? null) as T | null;
    }
    if (query.includes("from player_public_profiles") && query.includes("where user_id = ?")) {
      const row = this.db.publicProfilesByUser.get(String(this.bindings[0]));
      return (row ?? null) as T | null;
    }
    if (query.includes("from player_public_profiles") && query.includes("where handle = ?")) {
      const userId = this.db.publicProfileOwnersByHandle.get(String(this.bindings[0]));
      return (userId ? { user_id: userId } : null) as T | null;
    }
    return null as T | null;
  }

  async run() {
    const query = normalizedSql(this.query);
    recordProtectedWrite(this.db, query);

    if (query.includes("insert into users")) {
      this.db.writeTargets.add("users");
      return d1Ok();
    }

    if (query.includes("insert into discord_guilds")) {
      this.db.writeTargets.add("discord_guilds");
      return d1Ok();
    }

    if (query.includes("insert into player_profile_privacy_preferences")) {
      this.db.writeTargets.add("player_profile_privacy_preferences");
      const userId = String(this.bindings[1]);
      const next = {
        public_profile_enabled: Number(this.bindings[2]),
        show_display_name: Number(this.bindings[3]),
        show_gameplay_summary: Number(this.bindings[4]),
        show_featured_server: Number(this.bindings[5]),
        show_xp_progress: Number(this.bindings[6]),
        show_challenge_progress: Number(this.bindings[7]),
        show_calling_cards: Number(this.bindings[8]),
        show_award_dates: Number(this.bindings[9]),
        updated_at: String(this.bindings[11]),
      };
      this.db.preferences.set(userId, next);
      return d1Ok();
    }

    if (query.includes("insert into player_public_profiles")) {
      this.db.writeTargets.add("player_public_profiles");
      const userId = String(this.bindings[1]);
      const candidate = String(this.bindings[2]);
      const now = String(this.bindings[4]);
      const existing = this.db.publicProfilesByUser.get(userId);
      const handle = existing?.handle ?? candidate;
      this.db.publicProfilesByUser.set(userId, {
        handle,
        status: "active",
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });
      this.db.publicProfileOwnersByHandle.set(handle, userId);
      return d1Ok();
    }

    throw new Error(`Unexpected write in fake D1: ${this.query}`);
  }

  async all<T>() {
    return d1Ok<T>([]);
  }

  raw() {
    throw new Error("Fake D1 raw is not implemented for privacy preference tests.");
  }
}

function recordProtectedWrite(db: FakeD1Database, query: string) {
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

void testPrivacyRouteRuntimeContract()
  .then(() => {
    console.log("Player profile privacy preference tests passed.");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
