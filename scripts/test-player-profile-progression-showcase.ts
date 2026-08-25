import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { onRequest as playerProfileHandler } from "../functions/api/player/profile";
import { calculatePlayerProfileLevel } from "../functions/_lib/player-profile-progression";
import type { Env, PagesContext } from "../functions/_lib/types";

type FakeOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

type ProfileResponse = {
  ok?: boolean;
  source?: string;
  user?: {
    username?: string;
    avatar?: string | null;
  };
  profile?: {
    display_name?: string;
    avatar_url?: string | null;
    profile_level?: number;
    level_label?: string;
    total_xp?: number;
    xp_to_next_level?: number;
    completed_challenges?: number;
    joined_challenges?: number;
    available_challenges?: number;
    calling_card_count?: number;
    showcase_href?: string;
  };
  privacy?: {
    mode?: string;
    public_profile_enabled?: boolean;
    persistence?: string;
    settings_href?: string;
    updated_at?: string | null;
    controls?: Record<string, boolean>;
    public_safe_preview?: Record<string, boolean>;
  };
  progression?: {
    total_xp?: number;
    available_challenges?: number;
    joined_challenges?: number;
    completed_challenges?: number;
    calling_cards?: Array<{ code?: string; name?: string; awarded_at?: string }>;
    challenge_progress?: Array<{
      id?: string;
      slug?: string;
      status?: string;
      progress_percent?: number;
      xp_awarded?: number;
      calling_card_awarded?: string | null;
    }>;
    timeline?: Array<{ kind?: string; label?: string; occurred_at?: string | null }>;
    challenges_href?: string;
  };
  fairness?: Record<string, boolean>;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertStaticContracts();
  await assertEndpointContracts();
  await assertLivePayloadShape();
  console.log("Player profile progression showcase tests passed.");
}

function assertStaticContracts() {
  assert.equal(existsSync("app/player/profile/page.tsx"), true, "Player profile page route should exist.");
  assert.equal(existsSync("components/player/player-profile-progression-page.tsx"), true, "Player profile showcase component should exist.");
  assert.equal(existsSync("functions/api/player/profile.ts"), true, "Player profile API should exist.");
  assert.equal(existsSync("functions/api/player/profile-privacy.ts"), true, "Player profile privacy settings API should exist.");
  assert.equal(existsSync("functions/_lib/player-profile-progression.ts"), true, "Player profile progression helper should exist.");
  assert.equal(existsSync("functions/_lib/player-profile-privacy.ts"), true, "Player profile privacy helper should exist.");
  assert.equal(existsSync("docs/PLAYER_PROFILE_PROGRESSION_SHOWCASE_HANDOFF.md"), true, "Player profile progression handoff should exist.");

  const appPage = read("app/player/profile/page.tsx");
  assert.equal(appPage.includes("PlayerProfileProgressionPage"), true);

  const profileUi = read("components/player/player-profile-progression-page.tsx");
  for (const snippet of [
    "/api/player/profile",
    "/api/player/profile-privacy",
    "/login?returnTo=",
    "Free player profile",
    "Progression Showcase",
    "Privacy Display Controls",
    "Public profile visibility",
    "Save Preferences",
    "Public Preview",
    "Hidden Preview",
    "Calling Card Showcase",
    "Challenge Progress",
    "Progression Timeline",
    "Saved display preferences belong to your player profile",
    "earned player-side only",
    "do not affect paid plans, rankings, discovery score, reviews, badges, seasons, events, Server Wars scoring, or competitive eligibility",
    "/pricing?intent=owner_setup&returnTo=%2Fsetup",
  ]) {
    assert.equal(profileUi.includes(snippet), true, `Player profile UI must include ${snippet}.`);
  }
  assert.match(profileUi, /method:\s*"PATCH"/, "Profile UI should save settings through PATCH only.");
  assert.doesNotMatch(profileUi, /method\s*:\s*["'](?:POST|PUT|DELETE)["']/i, "Profile UI must not perform unsafe browser mutations.");
  assert.doesNotMatch(profileUi, /dangerouslySetInnerHTML|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i, "Profile UI must not touch unsafe rendering, checkout, or raw secrets.");

  const profileApi = read("functions/api/player/profile.ts");
  for (const snippet of [
    "getRequestSessionUser",
    "getPlayerProfileProgressionPayload",
    "privateNoStoreHeaders",
    "methodNotAllowed",
  ]) {
    assert.equal(profileApi.includes(snippet), true, `Player profile API must include ${snippet}.`);
  }
  assert.doesNotMatch(profileApi, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(profileApi, /\breadBoundedJson\b|\bfetch\s*\(|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|stripe|NITRADO_TOKEN|DISCORD_BOT_TOKEN|canManageDiscordGuild|storeGuilds/i);

  const profileHelper = read("functions/_lib/player-profile-progression.ts");
  for (const snippet of [
    "getPlayerChallengesPayload",
    "getPlayerProfilePrivacyPreferences",
    "PlayerProfileProgressionPayload",
    "public_profile_enabled: privacy.public_profile_enabled",
    "settings_href: privacy.settings_href",
    "paid_plan_influence: false",
    "ranking_influence: false",
    "discovery_score_influence: false",
    "review_score_influence: false",
    "badge_influence: false",
    "season_influence: false",
    "event_influence: false",
    "server_wars_influence: false",
    "xp_award_influence: false",
    "calling_card_award_influence: false",
    "competitive_eligibility_influence: false",
  ]) {
    assert.equal(profileHelper.includes(snippet), true, `Profile helper must include ${snippet}.`);
  }
  assert.doesNotMatch(profileHelper, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(profileHelper, /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bserver_owners\b/i);
  assert.doesNotMatch(profileHelper, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i, "Profile helper must stay read-only.");
  assert.doesNotMatch(profileHelper, /createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|stripe|NITRADO_TOKEN|DISCORD_BOT_TOKEN|fetchDiscordGuilds|canManageDiscordGuild|storeGuilds/i);

  const privacyHelper = read("functions/_lib/player-profile-privacy.ts");
  for (const snippet of [
    "exposes_discord_id: false",
    "exposes_user_id: false",
    "exposes_source_ids: false",
    "exposes_raw_evidence: false",
  ]) {
    assert.equal(privacyHelper.includes(snippet), true, `Profile privacy helper must include ${snippet}.`);
  }

  const hubUi = read("components/player/player-hub-page.tsx");
  for (const snippet of [
    "Player Profile Progression Showcase",
    "/player/profile",
    "privacy display controls",
    "Profile progression is earned player-side only and paid plans do not improve it",
  ]) {
    assert.equal(hubUi.includes(snippet), true, `Player Hub UI must include ${snippet}.`);
  }

  const hubApi = read("functions/api/player/hub.ts");
  assert.match(hubApi, /key:\s*"profile"[\s\S]*href:\s*"\/player\/profile"/, "Player Hub API profile entry must point at /player/profile.");
  assert.doesNotMatch(profileEntryBlock(hubApi), /href:\s*"\/dzn-pulse"/, "Player profile entry must not point to DZN Pulse.");

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  for (const snippet of [
    "Player Profile Progression Showcase Slice",
    "`/player/profile`",
    "`/api/player/profile`",
    "privacy-aware display controls",
    "Public profile publishing is off",
    "must not affect paid plans, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, server ownership, or competitive eligibility",
  ]) {
    assert.equal(platformSpec.includes(snippet), true, `Master spec must include ${snippet}.`);
  }

  const accessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  for (const snippet of [
    "`/player/profile` and `/api/player/profile`",
    "free logged-in player progression showcase surfaces",
    "Public profile publishing stays off",
    "hydrate saved display choices",
    "must not affect paid plans, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring",
  ]) {
    assert.equal(accessPolicy.includes(snippet), true, `Public access policy must include ${snippet}.`);
  }

  const handoff = read("docs/PLAYER_PROFILE_PROGRESSION_SHOWCASE_HANDOFF.md");
  for (const snippet of [
    "Player Profile Progression Showcase Handoff",
    "This is not a public profile publishing slice",
    "No Stripe products/prices were created or changed.",
    "Issue #49 remains reserved for final live checkout activation.",
  ]) {
    assert.equal(handoff.includes(snippet), true, `Handoff must include ${snippet}.`);
  }

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:player-profile-progression-showcase"), true, "Focused profile showcase test must be wired into package scripts.");

  assertProfileProgressionIsNotACompetitiveDependency();
}

async function assertEndpointContracts() {
  const unauthenticated = await callPlayerProfile("GET", {} as Env);
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: "Unauthorized" });

  const disallowed = await callPlayerProfile("POST", { MOCK_AUTH: "true" } as Env);
  assert.equal(disallowed.status, 405);
  assert.deepEqual(await disallowed.json(), { error: "Method not allowed" });

  const noDbResponse = await callPlayerProfile("GET", { MOCK_AUTH: "true" } as Env);
  assert.equal(noDbResponse.status, 200);
  assert.match(noDbResponse.headers.get("cache-control") ?? "", /no-store/i);
  const noDbJson = await noDbResponse.json() as ProfileResponse;
  assert.equal(noDbJson.ok, true);
  assert.equal(noDbJson.source, "display_fallback");
  assert.equal(noDbJson.profile?.showcase_href, "/player/profile");
  assert.equal(noDbJson.profile?.total_xp, 0);
  assert.equal(noDbJson.privacy?.mode, "private_viewer");
  assert.equal(noDbJson.privacy?.public_profile_enabled, false);
  assert.equal(noDbJson.privacy?.persistence, "unavailable");
  assert.equal(noDbJson.privacy?.settings_href, "/api/player/profile-privacy");
  assert.equal(noDbJson.privacy?.controls?.show_xp, true);
  assert.equal(noDbJson.privacy?.controls?.show_challenge_progress, true);
  assert.equal(noDbJson.privacy?.controls?.show_calling_cards, true);
  assert.equal(noDbJson.privacy?.controls?.show_award_dates, false);
  assert.equal(noDbJson.privacy?.controls?.show_discord_identity, false);
  assert.equal(noDbJson.privacy?.controls?.show_source_details, false);
  assert.equal(noDbJson.privacy?.public_safe_preview?.exposes_discord_id, false);
  assert.equal(noDbJson.privacy?.public_safe_preview?.exposes_user_id, false);
  assert.equal(noDbJson.privacy?.public_safe_preview?.exposes_source_ids, false);
  assert.equal(noDbJson.privacy?.public_safe_preview?.exposes_raw_evidence, false);
  assertFairnessFlags(noDbJson.fairness);
  assertNoPrivateProfileFields(noDbJson);
}

async function assertLivePayloadShape() {
  assert.deepEqual(calculatePlayerProfileLevel(0), { level: 1, label: "Foundation Track", xpToNextLevel: 100 });
  assert.deepEqual(calculatePlayerProfileLevel(375), { level: 3, label: "Foundation Track", xpToNextLevel: 125 });
  assert.deepEqual(calculatePlayerProfileLevel(9_999), { level: 12, label: "Legend Track", xpToNextLevel: 0 });

  const fake = createFakeChallengeDb();
  const response = await callPlayerProfile("GET", { MOCK_AUTH: "true", DB: fake.db } as Env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  const json = await response.json() as ProfileResponse;

  assert.equal(json.ok, true);
  assert.equal(json.source, "live");
  assert.equal(json.user?.username, "RafaelDeak");
  assert.equal(json.profile?.display_name, "RafaelDeak");
  assert.equal(json.profile?.profile_level, 3);
  assert.equal(json.profile?.total_xp, 375);
  assert.equal(json.profile?.completed_challenges, 1);
  assert.equal(json.profile?.joined_challenges, 1);
  assert.equal(json.profile?.available_challenges, 1);
  assert.equal(json.profile?.calling_card_count, 1);
  assert.equal(json.privacy?.public_profile_enabled, true);
  assert.equal(json.privacy?.persistence, "saved");
  assert.equal(json.privacy?.settings_href, "/api/player/profile-privacy");
  assert.equal(json.privacy?.controls?.show_calling_cards, false);
  assert.equal(json.privacy?.controls?.show_award_dates, true);
  assert.equal(json.privacy?.controls?.show_discord_identity, false);
  assert.equal(json.privacy?.controls?.show_source_details, false);
  assert.equal(json.privacy?.public_safe_preview?.exposes_discord_id, false);
  assert.equal(json.privacy?.public_safe_preview?.exposes_source_ids, false);
  assert.equal(json.privacy?.public_safe_preview?.hides_exact_award_times, true);
  assert.equal(json.progression?.total_xp, 375);
  assert.equal(json.progression?.challenge_progress?.[0]?.status, "completed");
  assert.equal(json.progression?.challenge_progress?.[0]?.progress_percent, 100);
  assert.equal(json.progression?.challenge_progress?.[0]?.xp_awarded, 100);
  assert.equal(json.progression?.calling_cards?.[0]?.code, "survivor_spark");
  assert.ok((json.progression?.timeline ?? []).some((item) => item.kind === "calling_card"));
  assert.ok((json.progression?.timeline ?? []).some((item) => item.kind === "challenge"));
  assert.equal(fake.operations.some((operation) => operation.kind === "run"), false, "Profile GET must not mutate player progression.");
  assertProfileReadOperationsStayIsolated(fake.operations);
  assertFairnessFlags(json.fairness);
  assertNoPrivateProfileFields(json);
}

async function callPlayerProfile(method: string, env: Env) {
  return playerProfileHandler({
    request: new Request("https://dzn.example/api/player/profile", { method }),
    env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Promise<Response>;
}

function createFakeChallengeDb() {
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
      if (/FROM\s+player_challenges/i.test(sql)) return { results: [challengeRow()] as T[] };
      if (/FROM\s+player_challenge_participations/i.test(sql)) return { results: [completedParticipationRow()] as T[] };
      if (/FROM\s+player_calling_card_awards/i.test(sql)) return { results: [callingCardAwardRow()] as T[] };
      return { results: [] as T[] };
    },
    async first<T>() {
      operations.push({ kind: "first", sql, bindings });
      if (/FROM\s+player_profile_privacy_preferences/i.test(sql)) return profilePrivacyPreferenceRow() as T;
      if (/SUM\(xp_amount\)/i.test(sql)) return { total_xp: 375 } as T;
      return null;
    },
    async run() {
      operations.push({ kind: "run", sql, bindings });
      return { success: true };
    },
  };
}

function challengeRow() {
  return {
    id: "foundation-survivor-spark",
    slug: "survivor-spark",
    title: "Survivor Spark",
    description: "Complete the foundation survival track.",
    category: "survival",
    status: "active",
    reward_xp: 100,
    calling_card_code: "survivor_spark",
    calling_card_name: "Survivor Spark",
    calling_card_description: "Completed the first DZN player challenge track.",
    calling_card_rarity: "foundation",
    target_value: 1,
    sort_order: 10,
    starts_at: null,
    ends_at: null,
  };
}

function completedParticipationRow() {
  return {
    challenge_id: "foundation-survivor-spark",
    status: "completed",
    progress_value: 1,
    target_value: 1,
    xp_awarded: 100,
    calling_card_awarded: "survivor_spark",
    joined_at: "2026-08-25T10:00:00.000Z",
    completed_at: "2026-08-25T10:20:00.000Z",
    updated_at: "2026-08-25T10:20:00.000Z",
  };
}

function callingCardAwardRow() {
  return {
    calling_card_code: "survivor_spark",
    calling_card_name: "Survivor Spark",
    calling_card_description: "Completed the first DZN player challenge track.",
    calling_card_rarity: "foundation",
    awarded_at: "2026-08-25T10:30:00.000Z",
  };
}

function profilePrivacyPreferenceRow() {
  return {
    public_profile_enabled: 1,
    show_xp: 1,
    show_challenge_progress: 1,
    show_calling_cards: 0,
    show_award_dates: 1,
    show_discord_identity: 1,
    show_source_details: 1,
    updated_at: "2026-08-25T10:35:00.000Z",
  };
}

function assertProfileReadOperationsStayIsolated(operations: FakeOperation[]) {
  assert.equal(operations.length, 6, "Profile endpoint should only perform the existing progression reads plus preference and attribution reads.");
  for (const operation of operations) {
    assert.notEqual(operation.kind, "run");
    assert.doesNotMatch(operation.sql, forbiddenProtectedSurfacePattern());
    assert.match(
      operation.sql,
      /\bplayer_profile_privacy_preferences\b|\busers\b|\bplayer_challenges\b|\bplayer_challenge_participations\b|\bplayer_xp_ledger\b|\bplayer_calling_card_awards\b|\bplayer_calling_cards\b/i,
      `Unexpected profile progression read: ${operation.sql}`,
    );
  }
}

function assertFairnessFlags(fairness: Record<string, boolean> | undefined) {
  const flags = [
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
  ];
  for (const flag of flags) {
    assert.equal(fairness?.[flag], false, `${flag} must remain false.`);
  }
}

function assertNoPrivateProfileFields(json: unknown) {
  const serialized = JSON.stringify(json);
  assert.doesNotMatch(serialized, /"discord_id"\s*:/, "Profile payload must not expose a Discord ID field.");
  assert.doesNotMatch(serialized, /"user_id"\s*:/, "Profile payload must not expose an internal user ID field.");
  assert.doesNotMatch(serialized, /"source_id"\s*:/, "Profile payload must not expose source ID fields.");
  assert.doesNotMatch(serialized, /"evidence_json"\s*:|"raw_evidence"\s*:/i, "Profile payload must not expose raw evidence.");
  assert.doesNotMatch(serialized, /owner_billing_accounts|server_subscriptions|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);
}

function assertProfileProgressionIsNotACompetitiveDependency() {
  for (const file of [
    "functions/api/public/servers.ts",
    "functions/_lib/server-ranking.ts",
    "functions/api/public/leaderboards.ts",
    "functions/_lib/advanced-leaderboards.ts",
    "functions/_lib/server-reviews.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/_lib/events.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/status.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /\/api\/player\/profile|player-profile-progression|PlayerProfileProgression|player_profile_progression/i,
      `${file} must not depend on the player profile progression showcase.`,
    );
  }
}

function profileEntryBlock(source: string) {
  const match = source.match(/key:\s*"profile"[\s\S]*?description:\s*"[^"]*",/);
  return match?.[0] ?? "";
}

function forbiddenProtectedSurfacePattern() {
  return /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bplayer_saved_servers\b|\bserver_owners\b|\bserver_rankings\b|\bleaderboards\b|\bdiscovery_score\b|\bserver_reviews\b|\bserver_review_reports\b|\bserver_review_moderation_actions\b|\bcompetitive_events\b|\bevent_matchups\b|\bevent_participants\b|\bevent_score_snapshots\b|\bserver_war_challenges\b|\bserver_war_events\b|\bserver_war_score_snapshots\b|\bdzn_seasons\b|\bserver_badge_awards\b|\bbadge_unlock_progress\b|\bbadges\b|\bplayer_profiles\b|\bkill_events\b|\bplayer_events\b|\bnitrado\b|\bdiscord_oauth_tokens\b|\bdiscord_guilds\b|\bstripe\b/i;
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}
