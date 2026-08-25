import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { onRequest as playerHubHandler } from "../functions/api/player/hub";
import { MOCK_USER_ID } from "../functions/_lib/db";
import type { Env, PagesContext } from "../functions/_lib/types";

type FakeOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

type PlayerHubResponse = {
  ok?: boolean;
  public_profile?: {
    public_profile_enabled?: boolean;
    public_handle?: string | null;
    public_href?: string | null;
    public_api_href?: string | null;
    settings_href?: string;
  };
  profile_entry_points?: Array<{
    key?: string;
    label?: string;
    href?: string;
    owner_entitlement_required?: boolean;
  }>;
};

const PUBLIC_HANDLE = "rafaeldeak-a1b2c";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertStaticContracts();
  await assertPlayerHubPublicProfilePayload();
  assertPublicProfileLinkingDoesNotInfluenceProtectedSystems();
  console.log("Public profile discovery/linking polish tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    "components/player/public-profile-share-panel.tsx",
    "components/player/player-hub-page.tsx",
    "components/player/player-profile-progression-page.tsx",
    "components/player/public-player-profile-page.tsx",
    "functions/api/player/hub.ts",
    "components/events/events-platform.tsx",
    "components/dzn-pulse/dzn-pulse-page.tsx",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const sharePanel = read("components/player/public-profile-share-panel.tsx");
  for (const snippet of [
    "navigator.clipboard.writeText",
    "navigator.share",
    "new URL(href, window.location.origin).toString()",
    "Public Profile Link",
    "Public Profile Not Published",
    "Open Profile Settings",
  ]) {
    assert.equal(sharePanel.includes(snippet), true, `Share panel must include ${snippet}.`);
  }
  assert.doesNotMatch(sharePanel, /fetchJsonWithRetry|fetch\(|method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  const playerHubApi = read("functions/api/player/hub.ts");
  for (const snippet of [
    "getPlayerProfilePrivacyPreferences",
    "public_profile: toPublicProfileSummary(profilePrivacy)",
    "profileEntryPoints(profilePrivacy)",
    "key: \"public_profile\"",
    "privacy.public_href",
  ]) {
    assert.equal(playerHubApi.includes(snippet), true, `Player Hub API must include ${snippet}.`);
  }
  assert.doesNotMatch(playerHubApi, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(playerHubApi, /\bstripeFormRequest\b|\bcreateCheckoutSession\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/);
  assert.doesNotMatch(playerHubApi, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);

  const playerHubUi = read("components/player/player-hub-page.tsx");
  for (const snippet of [
    "PublicProfileSharePanel",
    "public_profile?: PlayerHubPublicProfile",
    "normalizePublicProfile(hub.public_profile)",
    "context=\"hub\"",
    "publicHref={publicProfile.public_href}",
  ]) {
    assert.equal(playerHubUi.includes(snippet), true, `Player Hub UI must include ${snippet}.`);
  }

  const privateProfileUi = read("components/player/player-profile-progression-page.tsx");
  for (const snippet of [
    "PublicProfileSharePanel",
    "publicHref={profile.privacy.public_href}",
    "publicProfileEnabled={publicProfileEnabled}",
    "Save preferences to create your public profile link.",
  ]) {
    assert.equal(privateProfileUi.includes(snippet), true, `Private profile UI must include ${snippet}.`);
  }

  const publicProfileUi = read("components/player/public-player-profile-page.tsx");
  for (const snippet of [
    "PublicSectionState",
    "XP Hidden",
    "XP Not Earned Yet",
    "Calling Cards Hidden",
    "Challenge Progress Hidden",
    "Timeline Pending",
    "No Public Calling Cards Yet",
    "No Public Challenge Progress Yet",
    "Public DZN profile",
  ]) {
    assert.equal(publicProfileUi.includes(snippet), true, `Public profile viewer must include ${snippet}.`);
  }
  assert.doesNotMatch(publicProfileUi, /dangerouslySetInnerHTML|method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  const eventsUi = read("components/events/events-platform.tsx");
  assert.equal(eventsUi.includes('EventActionLink href="/player/profile"'), true, "Challenges page should link to the player profile.");
  assert.equal(eventsUi.includes('href="/player/profile"'), true, "Challenge participation panel should link to the player profile.");

  const pulseUi = read("components/dzn-pulse/dzn-pulse-page.tsx");
  assert.equal(pulseUi.includes('{ href: "/player", label: "Player Hub"'), true, "DZN Pulse should link to Player Hub.");
  assert.equal(pulseUi.includes('{ href: "/player/profile", label: "Player Profile"'), true, "DZN Pulse should link to the player profile.");

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:public-profile-discovery-linking-polish"), true, "Focused public profile linking test must be wired into package scripts.");

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  for (const snippet of [
    "Public Profile Discovery and Linking Polish Slice",
    "Copy/share controls for the profile owner",
    "Public profile entry links from `/player`, `/player/profile`, `/events/challenges`, and DZN Pulse",
    "Public profiles remain read-only",
  ]) {
    assert.equal(platformSpec.includes(snippet), true, `Master spec must include ${snippet}.`);
  }

  const publicAccessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  assert.equal(publicAccessPolicy.includes("public profile discovery/linking polish"), true, "Public access policy must mention this slice.");
}

async function assertPlayerHubPublicProfilePayload() {
  const dbState = createPlayerHubDb();
  const response = await playerHubHandler({
    request: new Request("https://dzn.example/api/player/hub", { method: "GET" }),
    env: { MOCK_AUTH: "true", DB: dbState.db } as Env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Response;

  assert.equal(response.status, 200);
  const json = await response.json() as PlayerHubResponse;
  assert.equal(json.ok, true);
  assert.equal(json.public_profile?.public_profile_enabled, true);
  assert.equal(json.public_profile?.public_handle, PUBLIC_HANDLE);
  assert.equal(json.public_profile?.public_href, `/players/${PUBLIC_HANDLE}`);
  assert.equal(json.public_profile?.public_api_href, `/api/public/player-profiles/${PUBLIC_HANDLE}`);
  assert.equal(json.public_profile?.settings_href, "/api/player/profile-privacy");
  assert.equal(
    json.profile_entry_points?.some((entry) => entry.key === "public_profile" && entry.href === `/players/${PUBLIC_HANDLE}` && entry.owner_entitlement_required !== true),
    true,
    "Published public profile entry point must be a free player link.",
  );
  assert.equal(
    json.profile_entry_points?.some((entry) => entry.key === "owner_setup" && entry.owner_entitlement_required === true),
    true,
    "Owner setup must remain separate and entitlement-marked.",
  );
  assert.equal(dbState.operations.some((operation) => operation.kind === "run"), false, "Player Hub public profile polish must not write.");
  assert.equal(
    dbState.operations.some((operation) => /FROM\s+player_profile_privacy_preferences/i.test(operation.sql) && operation.bindings.includes(MOCK_USER_ID)),
    true,
    "Player Hub should read only the current player's profile visibility preferences.",
  );
  for (const operation of dbState.operations) {
    assert.doesNotMatch(operation.sql, /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bserver_rankings\b|\bleaderboards\b|\bdiscovery_score\b|\bserver_reviews\b|\bserver_review_reports\b|\bserver_badge_awards\b|\bbadges\b|\bserver_war_score_snapshots\b|\bstripe\b/i);
  }
}

function assertPublicProfileLinkingDoesNotInfluenceProtectedSystems() {
  for (const file of [
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/status.ts",
    "functions/_lib/server-ranking.ts",
    "functions/api/public/leaderboards.ts",
    "functions/_lib/advanced-leaderboards.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/api/cron/player-progression/awards.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /public_profile|public_handle|public_href|PublicProfileSharePanel|\/players\/\[handle\]|\/api\/public\/player-profiles/i,
      `${file} must not depend on public profile discovery/linking state.`,
    );
  }

  const events = read("functions/_lib/events.ts");
  assert.equal(events.includes("public_event_creator_member_rows"), true, "Public events may carry the dedicated event host/member attribution placement.");
  assert.equal(events.includes("creator_profile: creatorProfile"), true, "Public event profile links must remain projected display metadata.");
  assert.doesNotMatch(events, /PublicProfileSharePanel|\/players\/\[handle\]/i, "Public events must not depend on profile owner share controls or viewer route internals.");
}

function createPlayerHubDb() {
  const operations: FakeOperation[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return statement(sql, bindings, operations);
        },
        ...statement(sql, [], operations),
      };
    },
  };
  return { db: db as unknown as Env["DB"], operations };
}

function statement(sql: string, bindings: unknown[], operations: FakeOperation[]) {
  return {
    async all<T>() {
      operations.push({ kind: "all", sql, bindings });
      if (/FROM\s+linked_servers/i.test(sql) && !/player_saved_servers/i.test(sql)) {
        return { results: [linkedServerRow()] as T[] };
      }
      if (/FROM\s+player_challenges/i.test(sql)) {
        return { results: [] as T[] };
      }
      throw new Error("Query intentionally unavailable in focused linking test.");
    },
    async first<T>() {
      operations.push({ kind: "first", sql, bindings });
      if (/FROM\s+player_profile_privacy_preferences/i.test(sql)) {
        return {
          public_handle: PUBLIC_HANDLE,
          public_profile_enabled: 1,
          show_xp: 1,
          show_challenge_progress: 1,
          show_calling_cards: 1,
          show_award_dates: 0,
          show_discord_identity: 0,
          show_source_details: 0,
          updated_at: "2026-08-25T15:30:00.000Z",
        } as T;
      }
      if (/SUM\(xp_amount\)/i.test(sql)) return { total_xp: 0 } as T;
      return null as T | null;
    },
    async run() {
      operations.push({ kind: "run", sql, bindings });
      return { success: true };
    },
  };
}

function linkedServerRow() {
  return {
    linked_server_id: "linked-dzn-public",
    public_slug: "dzn-public",
    server_name: "DZN Public",
    server_type: "PVP",
    server_category: "pvp",
    platform: "PlayStation",
    map_name: "Chernarus",
    current_players: 22,
    max_players: 60,
    public_short_description: "Focused test server.",
    public_discord_invite: null,
    status: "live",
    listing_visibility: "public",
    guild_name: "DZN Guild",
    guild_icon_url: null,
    saved_at: null,
  };
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}
