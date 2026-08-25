import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  getEventDetailPayload,
  getEventsListPayload,
  projectEventSummaryForPublicTest,
  resetCompetitiveEventsReadSchemaReadinessForTests,
} from "../functions/_lib/events";
import {
  buildPublicProfileAppearancePreview,
  type PublicProfileAttribution,
} from "../functions/_lib/public-profile-attribution";
import type { Env } from "../functions/_lib/types";

type FakeOperation = {
  kind: "prepare" | "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

type EventAttributionSafeguardsForTest = {
  placement?: string;
  link_mode?: string;
  uses_gamertag_matching?: boolean;
  affects_scoring?: boolean;
  affects_eligibility?: boolean;
  affects_owner_decisions?: boolean;
  affects_billing?: boolean;
  fairness?: Record<string, boolean>;
};

type PublicEventForTest = {
  id: string;
  creator_profile?: PublicProfileAttribution | null;
};

type PublicEventListPayloadForTest = {
  ok: boolean;
  events: PublicEventForTest[];
  profile_attribution?: EventAttributionSafeguardsForTest;
};

type PublicEventDetailPayloadForTest = {
  ok: boolean;
  event: PublicEventForTest;
  leaderboard: Array<{ server_name: string; score: number }>;
  profile_attribution?: EventAttributionSafeguardsForTest;
};

const PUBLIC_PROFILE: PublicProfileAttribution = {
  display_name: "Visible Event Host",
  public_handle: "visible-event-host-123",
  public_href: "/players/visible-event-host-123",
  public_api_href: "/api/public/player-profiles/visible-event-host-123",
};

async function main() {
  assertStaticContracts();
  assertAppearancePreviewIncludesEventMemberRows();
  assertPublicEventProjection();
  await assertPublicEventListAttribution();
  await assertEventDetailAttributionAndLeaderboardIsolation();
  assertProtectedSurfacesRemainIsolated();
  console.log("Event roster/member public-safe expansion tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    "functions/_lib/events.ts",
    "functions/_lib/public-profile-attribution.ts",
    "components/events/event-data.ts",
    "components/events/PublicEventProfileAttribution.tsx",
    "components/events/EventHero.tsx",
    "components/events/TournamentCard.tsx",
    "components/events/TournamentTable.tsx",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const attributionHelper = read("functions/_lib/public-profile-attribution.ts");
  for (const snippet of [
    "public_event_creator_member_rows",
    "Public event host/member rows",
    "competitive_events.created_by",
    "event_roster_scoring_and_decision_rows",
    "affects_competition: false",
    "exposes_private_identifiers: false",
  ]) {
    assert.equal(attributionHelper.includes(snippet), true, `Attribution preview helper must include ${snippet}.`);
  }
  assertNoSqlMutations(attributionHelper, "Public profile attribution helper must remain read-only.");

  const events = read("functions/_lib/events.ts");
  for (const snippet of [
    "readPublicProfileAttributionsByUserIds",
    "withEventCreatorProfiles",
    "rows.map((row) => row.created_by)",
    "creator_profile: creatorProfile",
    "profile_attribution: publicEventCreatorAttributionSafeguards()",
    "public_event_creator_member_rows",
    "competitive_events.created_by -> users.id -> player_profile_privacy_preferences.public_handle",
    "uses_gamertag_matching: false",
    "affects_scoring: false",
    "affects_eligibility: false",
    "affects_owner_decisions: false",
    "affects_billing: false",
  ]) {
    assert.equal(events.includes(snippet), true, `Events read model must include ${snippet}.`);
  }
  assert.doesNotMatch(events, /created_by:\s*row\.created_by/i, "Public event summaries must not expose raw creator user ids.");
  assert.doesNotMatch(events, /readPublicProfileAttributionsByRosterPlayerKeys|publicProfileRosterPlayerKey/i, "Public event creator links must not use CTF roster bridges.");

  const eventTypes = read("components/events/event-data.ts");
  for (const snippet of [
    "PublicProfileAttribution",
    "creator_profile?: PublicProfileAttribution | null",
    "EventProfileAttributionSafeguards",
    "profile_attribution?: EventProfileAttributionSafeguards",
  ]) {
    assert.equal(eventTypes.includes(snippet), true, `Event type model must include ${snippet}.`);
  }

  const profileBadge = read("components/events/PublicEventProfileAttribution.tsx");
  for (const snippet of [
    "normalizePublicProfileAttribution",
    "record.public_href === expectedHref && record.public_api_href === expectedApiHref",
    "View ${attribution.display_name}'s public DZN profile",
    "normalizePublicProfileHandle",
  ]) {
    assert.equal(profileBadge.includes(snippet), true, `Public event profile badge must include ${snippet}.`);
  }
  assert.doesNotMatch(profileBadge, /dangerouslySetInnerHTML|method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  for (const [path, snippet] of [
    ["components/events/EventHero.tsx", "PublicEventProfileAttribution profile={event.creator_profile}"],
    ["components/events/TournamentCard.tsx", "PublicEventProfileAttribution profile={event.creator_profile}"],
    ["components/events/TournamentTable.tsx", "PublicEventProfileAttribution profile={event.creator_profile}"],
  ] as const) {
    assert.equal(read(path).includes(snippet), true, `${path} must render validated public event attribution.`);
  }

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:event-roster-member-public-safe-expansion"), true, "Focused event roster/member test must be wired into package scripts.");
}

function assertAppearancePreviewIncludesEventMemberRows() {
  const ready = buildPublicProfileAppearancePreview({
    public_profile_enabled: true,
    public_handle: PUBLIC_PROFILE.public_handle,
    public_href: PUBLIC_PROFILE.public_href,
    public_api_href: PUBLIC_PROFILE.public_api_href,
    settings_href: "/api/player/profile-privacy",
  });

  const placement = ready.placements.find((item) => item.key === "public_event_creator_member_rows");
  assert.equal(placement?.public_surface, true);
  assert.equal(placement?.can_show_public_profile_link, true);
  assert.equal(placement?.requires_unique_user_bridge, true);
  assert.equal(placement?.controlled_by, "public_profile_visibility");
  assert.equal(placement?.exposes_private_identifiers, false);
  assert.equal(placement?.affects_competition, false);

  assert.equal(
    ready.excluded_surfaces.some((surface) => surface.key === "event_roster_scoring_and_decision_rows" && surface.public_profile_links_enabled === false),
    true,
  );
  assertFairnessFlags(ready.fairness);

  const hidden = buildPublicProfileAppearancePreview({
    public_profile_enabled: false,
    public_handle: PUBLIC_PROFILE.public_handle,
    public_href: PUBLIC_PROFILE.public_href,
    public_api_href: PUBLIC_PROFILE.public_api_href,
    settings_href: "/api/player/profile-privacy",
  });
  assert.equal(hidden.placements.find((item) => item.key === "public_event_creator_member_rows")?.can_show_public_profile_link, false);
}

function assertPublicEventProjection() {
  const published = projectEventSummaryForPublicTest({
    id: "event-published",
    created_by: "user-published",
    name: "Published Host Event",
  }, PUBLIC_PROFILE);
  assert.equal(published.creator_profile?.display_name, PUBLIC_PROFILE.display_name);
  assert.equal(published.creator_profile?.public_href, PUBLIC_PROFILE.public_href);
  assert.doesNotMatch(JSON.stringify(published), /user-published|created_by|discord_id/i, "Public event projection must not expose internal creator IDs.");

  const hidden = projectEventSummaryForPublicTest({
    id: "event-hidden",
    created_by: "user-hidden",
    name: "Hidden Host Event",
  });
  assert.equal(hidden.creator_profile, null);
  assert.doesNotMatch(JSON.stringify(hidden), /user-hidden|created_by|discord_id/i, "Hidden event creator projection must not expose internal creator IDs.");
}

async function assertPublicEventListAttribution() {
  const state = createPublicEventDb();
  const env = { DB: state.db } as Env;
  resetCompetitiveEventsReadSchemaReadinessForTests(env);

  const payload = await getEventsListPayload(env, null, { limit: 5 }) as PublicEventListPayloadForTest;
  assert.equal(payload.ok, true, JSON.stringify({ payload, operations: state.operations }));
  assert.equal(payload.events.length, 2);
  assert.equal(payload.profile_attribution?.placement, "public_event_creator_member_rows");
  assert.equal(payload.profile_attribution?.link_mode, "presentation_only");
  assert.equal(payload.profile_attribution?.uses_gamertag_matching, false);
  assert.equal(payload.profile_attribution?.affects_scoring, false);
  assert.equal(payload.profile_attribution?.affects_eligibility, false);
  assert.equal(payload.profile_attribution?.affects_owner_decisions, false);
  assert.equal(payload.profile_attribution?.affects_billing, false);
  assertFairnessFlags(payload.profile_attribution?.fairness ?? {});

  const published = payload.events.find((event) => event.id === "event-published");
  const hidden = payload.events.find((event) => event.id === "event-hidden");
  assert.equal(published?.creator_profile?.public_href, PUBLIC_PROFILE.public_href);
  assert.equal(hidden?.creator_profile, null);
  assert.doesNotMatch(JSON.stringify(payload.events), /user-published|user-hidden|created_by|discord_id/i);
  assert.equal(state.operations.some((operation) => operation.kind === "run"), false, "Public event attribution must be read-only.");
  assert.equal(
    state.operations.some((operation) => /FROM\s+player_profile_privacy_preferences/i.test(operation.sql) && /INNER\s+JOIN\s+users/i.test(operation.sql)),
    true,
    "Public events must load creator profiles only through the generated-handle attribution helper.",
  );
  assert.equal(
    state.operations.some((operation) => /server_subscriptions|owner_plan_entitlements|owner_billing_accounts/i.test(operation.sql)),
    false,
    "Anonymous public event attribution must not consult billing or owner entitlement tables.",
  );
  for (const operation of state.operations) {
    assertNoSqlWrite(operation.sql, "Public event list attribution must not write through SQL.");
    assert.doesNotMatch(operation.sql, forbiddenProductionMutationPattern());
  }
}

async function assertEventDetailAttributionAndLeaderboardIsolation() {
  const state = createPublicEventDb();
  const env = { DB: state.db } as Env;
  resetCompetitiveEventsReadSchemaReadinessForTests(env);

  const payload = await getEventDetailPayload(env, null, "published-host-event") as PublicEventDetailPayloadForTest;
  assert.equal(payload.ok, true);
  assert.equal(payload.event.creator_profile?.public_handle, PUBLIC_PROFILE.public_handle);
  assert.equal(payload.profile_attribution?.placement, "public_event_creator_member_rows");
  assert.equal(payload.leaderboard[0]?.server_name, "High Score Hidden Server");
  assert.equal(payload.leaderboard[0]?.score, 500);
  assert.equal(payload.leaderboard[1]?.server_name, "Low Score Linked Host Server");
  assert.equal(payload.leaderboard[1]?.score, 20);
  assert.doesNotMatch(JSON.stringify(payload.event), /user-published|created_by|discord_id/i);
  assert.doesNotMatch(JSON.stringify(payload.leaderboard), /creator_profile|public_profile|public_handle|public_href/i, "Scoreboard rows must not inherit event creator attribution.");
  assert.equal(state.operations.some((operation) => operation.kind === "run"), false, "Public event detail attribution must be read-only.");
}

function assertProtectedSurfacesRemainIsolated() {
  for (const file of [
    "functions/api/events/[slug]/join.ts",
    "functions/api/events/matchmaking.ts",
    "functions/api/owner/events.ts",
    "functions/api/owner/events/[slug].ts",
    "functions/api/servers/[serverId]/events.ts",
    "functions/_lib/event-hub.ts",
    "functions/api/servers/[serverId]/ctf/roster.ts",
    "functions/_lib/ctf-tournaments.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/api/billing/create-checkout-session.ts",
  ]) {
    const source = read(file);
    assert.equal(
      /public_event_creator_member_rows|creator_profile|withEventCreatorProfiles|publicEventCreatorAttributionSafeguards/i.test(source),
      false,
      `${file} must not depend on public event creator attribution.`,
    );
  }

  const events = read("functions/_lib/events.ts");
  const leaderboardSort = events.slice(events.indexOf("leaderboard: servers"), events.indexOf("activity_feed: activity"));
  assert.equal(leaderboardSort.includes("creator_profile"), false, "Event leaderboard sorting must not use creator attribution.");
  assert.equal(leaderboardSort.includes("public_profile"), false, "Event leaderboard sorting must not use public profile state.");
  assert.equal(leaderboardSort.includes("b.score - a.score"), true, "Event leaderboard sorting must remain score-first.");
  assert.equal(leaderboardSort.includes("b.wins - a.wins"), true, "Event leaderboard sorting must remain wins-second.");

  const ctfDashboard = read("functions/api/servers/[serverId]/ctf/dashboard.ts");
  assert.equal(ctfDashboard.includes("link_mode: \"presentation_only\""), true, "Existing CTF roster attribution must remain presentation-only.");
  assert.equal(ctfDashboard.includes("public_event_creator_member_rows"), false, "CTF dashboard must not use public event creator/member placement.");

  const docs = [
    read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md"),
    read("docs/PUBLIC_ACCESS_POLICY.md"),
    read("docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md"),
  ].join("\n");
  for (const snippet of [
    "Event Roster/Member Public-Safe Expansion Slice",
    "public_event_creator_member_rows",
    "competitive_events.created_by",
    "CTF scoring rows",
    "owner workflow rows",
    "presentation-only",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }
}

function createPublicEventDb() {
  const operations: FakeOperation[] = [];
  const db = {
    prepare(sql: string) {
      operations.push({ kind: "prepare", sql, bindings: [] });
      return new FakePublicEventStatement(sql, operations);
    },
  };
  return { db: db as unknown as Env["DB"], operations };
}

class FakePublicEventStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly operations: FakeOperation[],
  ) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async all<T>() {
    this.operations.push({ kind: "all", sql: this.sql, bindings: this.bindings });
    const tableInfo = pragmaTableInfo(this.sql);
    if (tableInfo) return { results: tableInfo.map((name) => ({ name })) as T[] };
    if (/FROM\s+player_profile_privacy_preferences/i.test(this.sql) && /INNER\s+JOIN\s+users/i.test(this.sql)) {
      const wanted = new Set(this.bindings.map(String));
      return {
        results: wanted.has("user-published")
          ? [{ user_id: "user-published", username: PUBLIC_PROFILE.display_name, public_handle: PUBLIC_PROFILE.public_handle }] as T[]
          : [] as T[],
      };
    }
    if (/FROM\s+competitive_events/i.test(this.sql) && /ORDER\s+BY\s+CASE\s+status/i.test(this.sql)) {
      return { results: [eventRow("event-published", "published-host-event", "user-published"), eventRow("event-hidden", "hidden-host-event", "user-hidden")] as T[] };
    }
    if (/FROM\s+competitive_event_servers/i.test(this.sql)) return { results: eventServerRows() as T[] };
    if (/FROM\s+competitive_event_matches/i.test(this.sql)) return { results: [] as T[] };
    if (/FROM\s+competitive_event_activity/i.test(this.sql)) return { results: [] as T[] };
    return { results: [] as T[] };
  }

  async first<T>() {
    this.operations.push({ kind: "first", sql: this.sql, bindings: this.bindings });
    if (/FROM\s+competitive_events/i.test(this.sql) && /WHERE\s+slug\s*=\s*\?/i.test(this.sql)) {
      const slug = String(this.bindings[0] ?? "");
      if (slug === "published-host-event") return eventRow("event-published", slug, "user-published") as T;
      if (slug === "hidden-host-event") return eventRow("event-hidden", slug, "user-hidden") as T;
    }
    return null as T | null;
  }

  async run() {
    this.operations.push({ kind: "run", sql: this.sql, bindings: this.bindings });
    return { success: true };
  }
}

function eventRow(id: string, slug: string, createdBy: string) {
  return {
    id,
    name: id === "event-published" ? "Published Host Event" : "Hidden Host Event",
    slug,
    description: "Public event row for attribution testing.",
    category: "deathmatch",
    event_type: "community_cup",
    status: "registration_open",
    visibility: "public",
    premium_tier: "free",
    server_limit: 16,
    team_limit: 16,
    starts_at: "2026-08-26T20:00:00.000Z",
    ends_at: "2026-08-26T22:00:00.000Z",
    created_by: createdBy,
    banner_url: null,
    rules: "Same category only.",
    rewards: "Community spotlight.",
    created_at: id === "event-published" ? "2026-08-25T10:00:00.000Z" : "2026-08-25T11:00:00.000Z",
    updated_at: "2026-08-25T11:30:00.000Z",
    registered_servers: 2,
    total_score: id === "event-published" ? 520 : 0,
    match_count: 1,
  };
}

function eventServerRows() {
  return [
    {
      id: "registration-high-hidden",
      server_id: "server-high-hidden",
      category: "deathmatch",
      approved: 1,
      score: 500,
      wins: 8,
      losses: 1,
      draws: 0,
      seed: 1,
      registered_at: "2026-08-25T10:01:00.000Z",
      server_name: "High Score Hidden Server",
      public_slug: "high-score-hidden-server",
      server_type: "deathmatch",
      server_mode: "deathmatch",
      server_category: "deathmatch",
      current_players: 20,
      max_players: 50,
      event_mmr: 1200,
      verified_server: 1,
    },
    {
      id: "registration-low-linked",
      server_id: "server-low-linked",
      category: "deathmatch",
      approved: 1,
      score: 20,
      wins: 1,
      losses: 3,
      draws: 0,
      seed: 2,
      registered_at: "2026-08-25T10:02:00.000Z",
      server_name: "Low Score Linked Host Server",
      public_slug: "low-score-linked-host-server",
      server_type: "deathmatch",
      server_mode: "deathmatch",
      server_category: "deathmatch",
      current_players: 10,
      max_players: 50,
      event_mmr: 900,
      verified_server: 1,
    },
  ];
}

function pragmaTableInfo(sql: string) {
  const normalized = sql.trim().replace(/\s+/g, " ").toLowerCase();
  for (const [tableName, columns] of Object.entries(tableColumns())) {
    if (normalized === `pragma table_info(${tableName})`) return columns;
  }
  return null;
}

function tableColumns(): Record<string, string[]> {
  return {
    competitive_events: [
      "id",
      "name",
      "slug",
      "description",
      "category",
      "event_type",
      "status",
      "visibility",
      "starts_at",
      "ends_at",
      "created_at",
      "updated_at",
    ],
    competitive_event_servers: ["event_id", "server_id", "score", "wins", "losses", "draws"],
    competitive_event_matches: ["event_id", "match_status"],
    competitive_event_activity: ["event_id", "server_id", "activity_type", "message", "created_at"],
    linked_servers: ["id", "public_slug", "server_category", "status"],
  };
}

function assertFairnessFlags(fairness: Record<string, boolean>) {
  for (const flag of [
    "paid_plan_influence",
    "ranking_influence",
    "discovery_score_influence",
    "review_score_influence",
    "badge_influence",
    "season_influence",
    "event_influence",
    "server_wars_influence",
    "xp_award_influence",
    "calling_card_award_influence",
    "competitive_eligibility_influence",
  ]) {
    assert.equal(fairness[flag], false, `${flag} must remain false.`);
  }
}

function assertNoSqlMutations(source: string, message: string) {
  const sqlTemplates = source.match(/`[\s\S]*?`/g) ?? [];
  for (const template of sqlTemplates) {
    assertNoSqlWrite(template, message);
  }
}

function assertNoSqlWrite(sql: string, message: string) {
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i, message);
}

function forbiddenProductionMutationPattern() {
  return /\bcreateCheckoutSession\b|\bstripeFormRequest\b|\bSTRIPE_SECRET_KEY\b|\bDZN_LIVE_CHECKOUT_ENABLED\s*=\s*true\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bwrangler\s+d1\b|\bwrangler\s+secret\b|\bfetchDiscordApi\b|\bfetchNitrado\b/i;
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

void main();
