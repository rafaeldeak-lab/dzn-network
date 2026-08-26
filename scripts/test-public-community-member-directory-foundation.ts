import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  getPublicCommunityMemberDirectoryPayload,
  projectCommunityMemberForPublicTest,
  publicCommunityMemberDirectorySafeguards,
  type PublicCommunityMemberDirectoryPayload,
} from "../functions/_lib/public-community-members";
import {
  buildPublicProfileAppearancePreview,
  type PublicProfileAttribution,
} from "../functions/_lib/public-profile-attribution";
import { isProtectedAppPagePath } from "../functions/_middleware";
import type { Env } from "../functions/_lib/types";

type FakeOperation = {
  kind: "prepare" | "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

const PUBLIC_PROFILE: PublicProfileAttribution = {
  display_name: "Visible Member",
  public_handle: "visible-member-123",
  public_href: "/players/visible-member-123",
  public_api_href: "/api/public/player-profiles/visible-member-123",
};

async function main() {
  assertStaticContracts();
  assertAppearancePreviewIncludesCommunityDirectory();
  assertMiddlewareRouteScope();
  assertPublicProjection();
  await assertCommunityDirectoryPayload();
  await assertMissingCommunityTableIsEmpty();
  await assertUnknownServerReturns404();
  assertProtectedSurfacesRemainIsolated();
  console.log("Public community member directory foundation tests passed.");
}

function assertStaticContracts() {
  const safeguards = publicCommunityMemberDirectorySafeguards();
  assert.equal(safeguards.placement, "public_community_member_directory");
  assert.equal(safeguards.link_mode, "presentation_only");
  assert.equal(safeguards.affects_competitive_eligibility, false);
  assertFairnessFlags(safeguards.fairness);

  for (const path of [
    "migrations/0067_community_member_directory_foundation.sql",
    "functions/_lib/public-community-members.ts",
    "functions/api/public/servers/[serverId]/community-members.ts",
    "functions/servers/[slug]/community.ts",
    "functions/_middleware.ts",
    "app/servers/[slug]/community/page.tsx",
    "components/community/public-community-members-page.tsx",
    "components/network/public-network.tsx",
    "functions/_lib/public-profile-attribution.ts",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const migration = read("migrations/0067_community_member_directory_foundation.sql");
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS community_members",
    "community_guild_id TEXT NOT NULL",
    "user_id TEXT NOT NULL",
    "public_member_enabled INTEGER NOT NULL DEFAULT 1",
    "source TEXT NOT NULL DEFAULT 'trusted_dzn_bridge'",
    "UNIQUE(community_guild_id, user_id)",
    "FOREIGN KEY(community_guild_id) REFERENCES discord_guilds(id)",
    "FOREIGN KEY(user_id) REFERENCES users(id)",
    "idx_community_members_public",
  ]) {
    assert.equal(migration.includes(snippet), true, `Migration must include ${snippet}.`);
  }
  assert.doesNotMatch(migration, /\bplayer_stats\b/i, "This slice must not create or depend on player_stats.");
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/i, "Migration must be additive only.");

  const helper = read("functions/_lib/public-community-members.ts");
  for (const snippet of [
    "readPublicProfileAttributionsByUserIds",
    "community_members.community_guild_id + community_members.user_id -> users.id -> player_profile_privacy_preferences.public_handle",
    "community_members.public_member_enabled = 1",
    "community_members.source = 'trusted_dzn_bridge'",
    "projectCommunityMemberForPublicTest",
    "placement: \"public_community_member_directory\"",
    "link_mode: \"presentation_only\"",
    "uses_gamertag_matching: false",
    "uses_discord_name_matching: false",
    "exposes_private_identifiers: false",
    "affects_ctf_scoring_rows: false",
    "affects_owner_workflow_rows: false",
    "affects_approval_decisions: false",
    "affects_bracket_outcomes: false",
    "affects_billing: false",
    "affects_rankings: false",
    "affects_discovery_score: false",
    "affects_reviews: false",
    "affects_badges: false",
    "affects_seasons: false",
    "affects_server_wars_scoring: false",
    "affects_xp_awards: false",
    "affects_calling_card_awards: false",
    "affects_competitive_eligibility: false",
  ]) {
    assert.equal(helper.includes(snippet), true, `Public community member helper must include ${snippet}.`);
  }
  assertNoSqlMutations(helper, "Public community member helper must remain read-only.");
  assert.doesNotMatch(helper, forbiddenProtectedInfluencePattern(), "Directory helper must not consult protected influence systems.");
  assert.doesNotMatch(helper, forbiddenProductionMutationPattern(), "Directory helper must not touch production/external services.");

  const route = read("functions/api/public/servers/[serverId]/community-members.ts");
  for (const snippet of [
    "request.method !== \"GET\"",
    "methodNotAllowed()",
    "getPublicCommunityMemberDirectoryPayload",
    "publicAccessCacheHeaders(viewerLoggedIn)",
    "publicApiErrorHeaders()",
  ]) {
    assert.equal(route.includes(snippet), true, `Community member route must include ${snippet}.`);
  }
  assert.doesNotMatch(route, /method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|requireOwnerRequestAccess|requireActiveOwnerEntitlement|createCheckoutSession/i);

  const publicShell = read("functions/servers/[slug]/community.ts");
  for (const snippet of [
    "onRequestGet",
    "/servers/preview/community.html",
    "env.ASSETS.fetch(shellRequest)",
    "cache-control",
    "no-store",
  ]) {
    assert.equal(publicShell.includes(snippet), true, `Public community shell must include ${snippet}.`);
  }
  assert.doesNotMatch(publicShell, /getSessionUser|requireOwnerRequestAccess|prepare\(|\.run\(|createCheckoutSession|fetchDiscordApi|fetchNitrado/i);

  const middleware = read("functions/_middleware.ts");
  assert.equal(middleware.includes("isPublicSafeServerCommunityPath(pathname)"), true, "Middleware must keep a narrow public route exception for server community pages.");
  assert.equal(middleware.includes("/^\\/servers\\/"), true, "Middleware route exception must target only /servers/{slug}/community.");
  assert.equal(middleware.includes("\\/community$"), true, "Middleware route exception must only cover the community page.");

  const page = read("components/community/public-community-members-page.tsx");
  for (const snippet of [
    "/api/public/servers/${encodeURIComponent(routeSlug)}/community-members",
    "normalizePublicProfile(value.public_profile)",
    "record.public_href === expectedHref && record.public_api_href === expectedApiHref",
    "currentPublicServerCommunitySlug",
    "View ${member.display_name}'s public DZN profile",
    "No Public Members Yet",
  ]) {
    assert.equal(page.includes(snippet), true, `Community member page must include ${snippet}.`);
  }
  assert.doesNotMatch(page, /dangerouslySetInnerHTML|method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  const appRoute = read("app/servers/[slug]/community/page.tsx");
  assert.equal(appRoute.includes("PublicCommunityMembersPage"), true, "Next route must render the community directory page.");
  assert.equal(appRoute.includes("dynamicParams = false"), true, "Export route must be static-export compatible.");

  const publicNetwork = read("components/network/public-network.tsx");
  assert.equal(publicNetwork.includes("publicServerCommunityHref(server.public_slug)"), true, "Public server cards/profiles must link to the community directory.");
  assert.equal(publicNetwork.includes("function publicServerCommunityHref"), true, "Public network must keep community route generation local and explicit.");

  const attributionHelper = read("functions/_lib/public-profile-attribution.ts");
  for (const snippet of [
    "public_community_member_directory",
    "Public community member directory",
    "community_members trusted user bridge",
    "community_member_owner_workflows",
  ]) {
    assert.equal(attributionHelper.includes(snippet), true, `Attribution preview helper must include ${snippet}.`);
  }

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:public-community-member-directory-foundation"), true, "Focused community member directory test must be wired into package scripts.");
}

function assertAppearancePreviewIncludesCommunityDirectory() {
  const ready = buildPublicProfileAppearancePreview({
    public_profile_enabled: true,
    public_handle: PUBLIC_PROFILE.public_handle,
    public_href: PUBLIC_PROFILE.public_href,
    public_api_href: PUBLIC_PROFILE.public_api_href,
    settings_href: "/api/player/profile-privacy",
  });

  const placement = ready.placements.find((item) => item.key === "public_community_member_directory");
  assert.equal(placement?.public_surface, true);
  assert.equal(placement?.can_show_public_profile_link, true);
  assert.equal(placement?.requires_unique_user_bridge, true);
  assert.equal(placement?.controlled_by, "public_profile_visibility");
  assert.equal(placement?.exposes_private_identifiers, false);
  assert.equal(placement?.affects_competition, false);
  assert.equal(
    ready.excluded_surfaces.some((surface) => surface.key === "community_member_owner_workflows" && surface.public_profile_links_enabled === false),
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
  assert.equal(hidden.placements.find((item) => item.key === "public_community_member_directory")?.can_show_public_profile_link, false);
}

function assertMiddlewareRouteScope() {
  assert.equal(isProtectedAppPagePath("/servers/nuketown-deathmatch/community"), false, "Public community member directory shell should be public-safe.");
  assert.equal(isProtectedAppPagePath("/servers"), true, "Server browser must remain a logged-in app page.");
  assert.equal(isProtectedAppPagePath("/servers/nuketown-deathmatch"), true, "General server app pages must remain protected.");
  assert.equal(isProtectedAppPagePath("/servers/nuketown-deathmatch/community/edit"), true, "Only the read-only community directory shell should be public.");
  assert.equal(isProtectedAppPagePath("/dashboard"), true, "Owner dashboard must remain protected.");
  assert.equal(isProtectedAppPagePath("/setup"), true, "Owner setup must remain protected.");
}

function assertPublicProjection() {
  const projected = projectCommunityMemberForPublicTest({
    role_label: "Raid Lead",
    created_at: "2026-08-25T10:00:00.000Z",
  }, PUBLIC_PROFILE);
  assert.equal(projected?.display_name, PUBLIC_PROFILE.display_name);
  assert.equal(projected?.role_label, "Raid Lead");
  assert.equal(projected?.member_since_label, "Aug 2026");
  assert.equal(projected?.public_profile.public_href, PUBLIC_PROFILE.public_href);

  const hidden = projectCommunityMemberForPublicTest({
    role_label: "Hidden",
    created_at: "2026-08-25T10:00:00.000Z",
  }, null);
  assert.equal(hidden, null);
}

async function assertCommunityDirectoryPayload() {
  const state = createCommunityDirectoryDb();
  const env = { DB: state.db } as Env;

  const result = await getPublicCommunityMemberDirectoryPayload(env, "nuketown-deathmatch", { limit: 10 });
  assert.equal(result.status, 200, JSON.stringify(result));
  const payload = result.payload as PublicCommunityMemberDirectoryPayload;
  assert.equal(payload.ok, true);
  assert.equal(payload.available, true);
  assert.equal(payload.source, "live");
  assert.equal(payload.server.public_slug, "nuketown-deathmatch");
  assert.equal(payload.server.server_name, "Nuketown Deathmatch");
  assert.equal(payload.server.href, "/servers/profile?slug=nuketown-deathmatch");
  assert.equal(payload.community.name, "Nuketown Community");
  assert.equal(payload.community.icon_url, "https://cdn.discordapp.com/icons/guild-visible/icon.png");
  assert.equal(payload.community.member_count, 1);
  assert.equal(payload.members.length, 1);
  assert.equal(payload.members[0]?.display_name, PUBLIC_PROFILE.display_name);
  assert.equal(payload.members[0]?.public_profile.public_href, PUBLIC_PROFILE.public_href);
  assert.equal(payload.profile_attribution.placement, "public_community_member_directory");
  assert.equal(payload.profile_attribution.link_mode, "presentation_only");
  assert.equal(payload.profile_attribution.uses_gamertag_matching, false);
  assert.equal(payload.profile_attribution.uses_discord_name_matching, false);
  assert.equal(payload.profile_attribution.exposes_private_identifiers, false);
  assert.equal(payload.profile_attribution.affects_ctf_scoring_rows, false);
  assert.equal(payload.profile_attribution.affects_owner_workflow_rows, false);
  assert.equal(payload.profile_attribution.affects_approval_decisions, false);
  assert.equal(payload.profile_attribution.affects_bracket_outcomes, false);
  assertFairnessFlags(payload.profile_attribution.fairness);

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /community-guild-internal|user-visible|user-hidden|discord-visible|discord-hidden|created_by|discord_id/i);
  assert.equal(state.operations.some((operation) => operation.kind === "run"), false, "Community member directory must be read-only.");
  assert.equal(
    state.operations.some((operation) => /FROM\s+community_members/i.test(operation.sql) && /community_members\.user_id/i.test(operation.sql)),
    true,
    "Community directory must read from the trusted community member bridge.",
  );
  assert.equal(
    state.operations.some((operation) => /FROM\s+player_profile_privacy_preferences/i.test(operation.sql) && /INNER\s+JOIN\s+users/i.test(operation.sql)),
    true,
    "Community directory must load public profile links through the generated-handle attribution helper.",
  );
  for (const operation of state.operations) {
    assertNoSqlWrite(operation.sql, "Community member directory must not write through SQL.");
    assert.doesNotMatch(operation.sql, forbiddenProtectedInfluencePattern());
    assert.doesNotMatch(operation.sql, forbiddenProductionMutationPattern());
  }
}

async function assertMissingCommunityTableIsEmpty() {
  const state = createCommunityDirectoryDb({ missingCommunityMembersTable: true });
  const env = { DB: state.db } as Env;

  const result = await getPublicCommunityMemberDirectoryPayload(env, "nuketown-deathmatch");
  assert.equal(result.status, 200);
  const payload = result.payload as PublicCommunityMemberDirectoryPayload;
  assert.equal(payload.available, false);
  assert.equal(payload.source, "not_configured");
  assert.equal(payload.members.length, 0);
  assert.equal(payload.community.member_count, 0);
  assert.doesNotMatch(JSON.stringify(payload), /user-visible|user-hidden|discord-visible|discord-hidden/i);
}

async function assertUnknownServerReturns404() {
  const state = createCommunityDirectoryDb();
  const env = { DB: state.db } as Env;

  const result = await getPublicCommunityMemberDirectoryPayload(env, "missing-server");
  assert.equal(result.status, 404);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "server_not_found");
}

function assertProtectedSurfacesRemainIsolated() {
  for (const file of [
    "functions/api/servers/[serverId]/ctf/roster.ts",
    "functions/api/servers/[serverId]/ctf/dashboard.ts",
    "functions/_lib/ctf-tournaments.ts",
    "functions/api/events/[slug]/join.ts",
    "functions/api/events/matchmaking.ts",
    "functions/api/owner/events.ts",
    "functions/api/owner/events/[slug].ts",
    "functions/_lib/event-hub.ts",
    "functions/_lib/events.ts",
    "functions/api/player/saved-servers.ts",
    "functions/api/player/reviews.ts",
    "functions/_lib/server-reviews.ts",
    "functions/api/reviews/moderation.ts",
    "functions/api/reviews/moderation/bulk.ts",
    "functions/_lib/review-moderation.ts",
    "functions/_lib/review-moderation-dashboard.ts",
    "functions/api/billing/create-checkout-session.ts",
    "functions/_lib/server-ranking.ts",
    "functions/_lib/public-leaderboards.ts",
    "functions/_lib/server-visibility.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/api/cron/player-progression/awards.ts",
    "functions/_lib/player-progression.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /community_members|public_community_member_directory|PublicCommunityMembersPage|\/community-members/i,
      `${file} must not depend on the public community member directory.`,
    );
  }

  const docs = [
    read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md"),
    read("docs/PUBLIC_ACCESS_POLICY.md"),
    read("docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md"),
  ].join("\n");
  for (const snippet of [
    "Public-Safe Community Member Directory Foundation Slice",
    "public_community_member_directory",
    "community_members",
    "unique trusted DZN user bridge",
    "CTF scoring rows",
    "owner workflow rows",
    "presentation-only",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }
}

function createCommunityDirectoryDb(options: { missingCommunityMembersTable?: boolean } = {}) {
  const operations: FakeOperation[] = [];
  const db = {
    prepare(sql: string) {
      operations.push({ kind: "prepare", sql, bindings: [] });
      return new FakeCommunityDirectoryStatement(sql, operations, options);
    },
  };
  return { db: db as unknown as Env["DB"], operations };
}

class FakeCommunityDirectoryStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly operations: FakeOperation[],
    private readonly options: { missingCommunityMembersTable?: boolean },
  ) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async all<T>() {
    this.operations.push({ kind: "all", sql: this.sql, bindings: this.bindings });
    if (/FROM\s+community_members/i.test(this.sql)) {
      if (this.options.missingCommunityMembersTable) throw new Error("no such table: community_members");
      return {
        results: [
          {
            user_id: "user-visible",
            role_label: "Raid Lead",
            display_order: 1,
            created_at: "2026-08-25T10:00:00.000Z",
          },
          {
            user_id: "user-hidden",
            role_label: "Hidden Member",
            display_order: 2,
            created_at: "2026-08-25T11:00:00.000Z",
          },
        ] as T[],
      };
    }
    if (/FROM\s+player_profile_privacy_preferences/i.test(this.sql) && /INNER\s+JOIN\s+users/i.test(this.sql)) {
      const wanted = new Set(this.bindings.map(String));
      return {
        results: wanted.has("user-visible")
          ? [{
              user_id: "user-visible",
              username: PUBLIC_PROFILE.display_name,
              public_handle: PUBLIC_PROFILE.public_handle,
            }] as T[]
          : [] as T[],
      };
    }
    return { results: [] as T[] };
  }

  async first<T>() {
    this.operations.push({ kind: "first", sql: this.sql, bindings: this.bindings });
    if (/FROM\s+linked_servers/i.test(this.sql) && /LEFT\s+JOIN\s+discord_guilds/i.test(this.sql)) {
      const serverRef = String(this.bindings[0] ?? "");
      if (serverRef !== "nuketown-deathmatch" && serverRef !== "server-visible") return null as T | null;
      return {
        public_slug: "nuketown-deathmatch",
        server_name: "Nuketown Deathmatch",
        community_guild_id: "community-guild-internal",
        community_name: "Nuketown Community",
        community_icon_url: "https://cdn.discordapp.com/icons/guild-visible/icon.png",
      } as T;
    }
    return null as T | null;
  }

  async run() {
    this.operations.push({ kind: "run", sql: this.sql, bindings: this.bindings });
    return { success: true };
  }
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
  for (const template of sqlTemplates) assertNoSqlWrite(template, message);
}

function assertNoSqlWrite(sql: string, message: string) {
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i, message);
}

function forbiddenProtectedInfluencePattern() {
  return /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bserver_rankings\b|\bdiscovery_score\b|\bserver_reviews\b|\breview_score\b|\bserver_badge_awards\b|\bbadge_unlock_progress\b|\bdzn_seasons\b|\bcompetitive_events\b|\bcompetitive_event_matches\b|\bctf_tournament\b|\bevent_matchups\b|\bevent_participants\b|\bserver_war_score_snapshots\b|\bserver_war_events\b|\bplayer_progression_award_sources\b|\bstripe\b|\bnitrado\b|\bdiscord_oauth_tokens\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i;
}

function forbiddenProductionMutationPattern() {
  return /\bcreateCheckoutSession\b|\bstripeFormRequest\b|\bSTRIPE_SECRET_KEY\b|\bDZN_LIVE_CHECKOUT_ENABLED\s*=\s*true\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bwrangler\s+d1\b|\bwrangler\s+secret\b|\bfetchDiscordApi\b|\bfetchNitrado\b/i;
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

void main();
