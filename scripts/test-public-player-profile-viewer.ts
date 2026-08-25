import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { MOCK_USER_ID } from "../functions/_lib/db";
import { getPublicPlayerProfilePayload } from "../functions/_lib/public-player-profile";
import { savePlayerProfilePrivacyPreferences } from "../functions/_lib/player-profile-privacy";
import { onRequest as publicProfileHandler } from "../functions/api/public/player-profiles/[handle]";
import type { Env, PagesContext } from "../functions/_lib/types";

type FakeOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

type PublicProfileResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  profile?: {
    handle?: string;
    display_name?: string;
    avatar_initial?: string;
    public_href?: string;
    public_api_href?: string;
    avatar_url?: string | null;
  };
  visibility?: {
    mode?: string;
    xp?: boolean;
    challenge_progress?: boolean;
    calling_cards?: boolean;
    award_dates?: string;
    private_identifiers?: string;
    raw_award_evidence?: string;
    exact_award_times?: string;
  };
  sections?: {
    xp?: Record<string, unknown> | null;
    challenge_progress?: {
      joined_challenges?: number;
      completed_challenges?: number;
      items?: Array<Record<string, unknown>>;
    } | null;
    calling_cards?: {
      count?: number;
      items?: Array<Record<string, unknown>>;
    } | null;
    timeline?: Array<Record<string, unknown>>;
  };
  fairness?: Record<string, boolean>;
};

type FakeDbOptions = {
  published?: boolean;
  showXp?: boolean;
  showChallenges?: boolean;
  showCards?: boolean;
  showAwardDates?: boolean;
  handle?: string;
};

const PUBLIC_HANDLE = "rafaeldeak-a1b2c";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertStaticContracts();
  await assertEndpointContracts();
  await assertPayloadContracts();
  await assertPublishingHandleContracts();
  console.log("Public player profile viewer tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    "migrations/0066_player_public_profile_handles.sql",
    "functions/_lib/public-player-profile.ts",
    "functions/api/public/player-profiles/[handle].ts",
    "functions/players/[handle].ts",
    "app/players/[handle]/page.tsx",
    "components/player/public-player-profile-page.tsx",
    "functions/_lib/player-profile-privacy.ts",
    "functions/_lib/player-profile-progression.ts",
    "components/player/player-profile-progression-page.tsx",
    "scripts/test-public-player-profile-viewer.ts",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const migration = stripSqlComments(read("migrations/0066_player_public_profile_handles.sql"));
  assert.equal(migration.includes("ALTER TABLE player_profile_privacy_preferences ADD COLUMN public_handle TEXT"), true);
  assert.equal(migration.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_player_profile_privacy_public_handle"), true);
  assert.equal(migration.includes("WHERE public_handle IS NOT NULL"), true);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, forbiddenProtectedSurfacePattern());

  const privacyHelper = read("functions/_lib/player-profile-privacy.ts");
  for (const snippet of [
    "PLAYER_PUBLIC_PROFILE_HREF_PREFIX",
    "PLAYER_PUBLIC_PROFILE_API_HREF_PREFIX",
    "public_handle",
    "public_href",
    "public_api_href",
    "normalizePublicProfileHandle",
    "publicPlayerProfileHref",
    "publicPlayerProfileApiHref",
    "createUniquePublicProfileHandle",
    "publicProfileHandleBase(user.username)",
    "SELECT user_id FROM player_profile_privacy_preferences WHERE public_handle = ? LIMIT 1",
    "public_handle = COALESCE(player_profile_privacy_preferences.public_handle, excluded.public_handle)",
  ]) {
    assert.equal(privacyHelper.includes(snippet), true, `Privacy helper must include ${snippet}.`);
  }
  assert.doesNotMatch(publicHandleGenerationBlock(privacyHelper), /discord_id|owner_billing_accounts|server_subscriptions|stripe|nitrado/i);

  const publicHelper = read("functions/_lib/public-player-profile.ts");
  for (const snippet of [
    "getPublicPlayerProfilePayload",
    "normalizePublicProfileHandle",
    "getPlayerProfileProgressionPayload",
    "avatar: null",
    "private_identifiers: \"hidden\"",
    "raw_award_evidence: \"hidden\"",
    "exact_award_times: \"hidden\"",
    "monthLabel",
    "playerProfilePrivacyFairness",
  ]) {
    assert.equal(publicHelper.includes(snippet), true, `Public profile helper must include ${snippet}.`);
  }
  assert.doesNotMatch(publicHelper, /avatar_url|discord_id:\s*row|show_discord_identity|show_source_details|evidence_json|source_id/i);
  assert.match(publicHelper, /\bpublic_handle\s*=\s*\?/);
  assert.match(publicHelper, /\bpublic_profile_enabled\s*=\s*1/);
  assertNoForbiddenSqlMutationTargets(publicHelper);

  const publicApi = read("functions/api/public/player-profiles/[handle].ts");
  for (const snippet of [
    "GET",
    "getPublicPlayerProfilePayload",
    "publicCacheHeaders",
    "hasPrivateRequestSignal",
    "privateNoStoreHeaders",
    "noStoreForErrorHeaders",
    "methodNotAllowed",
  ]) {
    assert.equal(publicApi.includes(snippet), true, `Public profile API must include ${snippet}.`);
  }
  assert.doesNotMatch(publicApi, /getRequestSessionUser|getSessionUser|readBoundedJson|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|stripe|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  const publicShell = read("functions/players/[handle].ts");
  for (const snippet of [
    "/players/preview.html",
    "env.ASSETS.fetch",
    "secureHeaders",
    "cache-control",
    "no-store",
  ]) {
    assert.equal(publicShell.includes(snippet), true, `Public profile shell route must include ${snippet}.`);
  }
  assert.doesNotMatch(publicShell, /getRequestSessionUser|getSessionUser|requireActiveOwnerEntitlement|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|stripe|NITRADO_TOKEN|DISCORD_BOT_TOKEN|INSERT|UPDATE|DELETE/i);

  const appRoute = read("app/players/[handle]/page.tsx");
  assert.equal(appRoute.includes("PublicPlayerProfilePage"), true);
  assert.equal(appRoute.includes("dynamicParams = false"), true, "Public profile route must remain compatible with static export.");
  assert.equal(appRoute.includes("generateStaticParams"), true, "Public profile route must export a preview shell for static export.");

  const pagesRoutesPatch = read("scripts/patch-pages-routes.mjs");
  assert.equal(pagesRoutesPatch.includes("\"/players\""), true, "Cloudflare Pages routes must include the public player profile shell.");
  assert.equal(pagesRoutesPatch.includes("\"/players/*\""), true, "Cloudflare Pages routes must include public player profile handle paths.");

  const publicUi = read("components/player/public-player-profile-page.tsx");
  for (const snippet of [
    "/api/public/player-profiles/",
    "Public DZN profile",
    "Public Visibility",
    "Private identifiers, raw award evidence, source IDs, Discord IDs, internal user IDs, and exact award timestamps are hidden",
    "does not affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility",
    "Profile Not Public",
    "currentPublicProfileHandle",
    "window.location.pathname",
  ]) {
    assert.equal(publicUi.includes(snippet), true, `Public profile UI must include ${snippet}.`);
  }
  assert.doesNotMatch(publicUi, /dangerouslySetInnerHTML|method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  const privateUi = read("components/player/player-profile-progression-page.tsx");
  assert.equal(privateUi.includes("PublicProfileSharePanel"), true, "Private profile page should surface the generated public profile link controls.");
  assert.equal(privateUi.includes("Save preferences to create your public profile link."), true);
  const sharePanel = read("components/player/public-profile-share-panel.tsx");
  assert.equal(sharePanel.includes("Public Profile Link"), true, "Public profile share controls should show the generated public profile link.");
  assert.equal(sharePanel.includes("navigator.clipboard.writeText"), true, "Public profile share controls should support copying the generated link.");

  const profileHelper = read("functions/_lib/player-profile-progression.ts");
  for (const snippet of [
    "public_handle: privacy.public_handle",
    "public_href: privacy.public_href",
    "public_api_href: privacy.public_api_href",
  ]) {
    assert.equal(profileHelper.includes(snippet), true, `Private profile payload must include ${snippet}.`);
  }

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:public-player-profile-viewer"), true, "Focused public profile viewer test must be wired into package scripts.");

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  for (const snippet of [
    "Public Player Profile Publishing and Viewer Slice",
    "`/players/[handle]`",
    "`/api/public/player-profiles/[handle]`",
    "`public_handle`",
    "Public profile display choices must not affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility",
  ]) {
    assert.equal(platformSpec.includes(snippet), true, `Master spec must include ${snippet}.`);
  }

  const publicAccessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  for (const snippet of [
    "`/players/[handle]` and `/api/public/player-profiles/[handle]`",
    "public-safe player profile viewer",
    "Private identifiers, Discord IDs, internal user IDs, source IDs, raw award evidence, and exact award timestamps stay hidden",
  ]) {
    assert.equal(publicAccessPolicy.includes(snippet), true, `Public access policy must include ${snippet}.`);
  }

  assertPublicProfilePreferencesAreNotProtectedSystemDependencies();
}

async function assertEndpointContracts() {
  const invalidDb = createPublicProfileDb();
  const invalid = await callPublicProfile("GET", "bad handle!", { DB: invalidDb.db } as Env);
  assert.equal(invalid.status, 400);
  assert.equal(invalidDb.operations.length, 0, "Invalid handles must fail before D1 reads.");
  assert.match(invalid.headers.get("cache-control") ?? "", /no-store/i);
  assertFairnessFlags(((await invalid.json()) as PublicProfileResponse).fairness);

  const noDb = await callPublicProfile("GET", PUBLIC_HANDLE, {} as Env);
  assert.equal(noDb.status, 503);
  assert.match(noDb.headers.get("cache-control") ?? "", /no-store/i);
  const noDbJson = await noDb.json() as PublicProfileResponse;
  assert.equal(noDbJson.error, "PUBLIC_PROFILE_UNAVAILABLE");
  assertFairnessFlags(noDbJson.fairness);

  const post = await callPublicProfile("POST", PUBLIC_HANDLE, { DB: createPublicProfileDb().db } as Env);
  assert.equal(post.status, 405);

  const unpublishedDb = createPublicProfileDb({ published: false });
  const unpublished = await callPublicProfile("GET", PUBLIC_HANDLE, { DB: unpublishedDb.db } as Env);
  assert.equal(unpublished.status, 404);
  assert.match(unpublished.headers.get("cache-control") ?? "", /no-store/i);
  const unpublishedJson = await unpublished.json() as PublicProfileResponse;
  assert.equal(unpublishedJson.error, "PUBLIC_PROFILE_NOT_FOUND");
  assertFairnessFlags(unpublishedJson.fairness);
  assertNoPrivateFields(unpublishedJson);

  const publishedDb = createPublicProfileDb();
  const published = await callPublicProfile("GET", PUBLIC_HANDLE, { DB: publishedDb.db } as Env);
  assert.equal(published.status, 200);
  assert.match(published.headers.get("cache-control") ?? "", /public/i);
  assert.equal(published.headers.get("x-dzn-cache"), "MISS");
  const publishedJson = await published.json() as PublicProfileResponse;
  assertPublishedPayload(publishedJson);
  assertReadScope(publishedDb.operations);

  const privateSignalDb = createPublicProfileDb();
  const privateSignal = await publicProfileHandler(context(
    new Request(`https://dzn.example/api/public/player-profiles/${PUBLIC_HANDLE}`, {
      method: "GET",
      headers: { cookie: "dzn_session=local" },
    }),
    { DB: privateSignalDb.db } as Env,
    PUBLIC_HANDLE,
  )) as Response;
  assert.equal(privateSignal.status, 200);
  assert.match(privateSignal.headers.get("cache-control") ?? "", /private/i);
  assert.match(privateSignal.headers.get("cache-control") ?? "", /no-store/i);
  assertPublishedPayload(await privateSignal.json() as PublicProfileResponse);
}

async function assertPayloadContracts() {
  const direct = await getPublicPlayerProfilePayload({ DB: createPublicProfileDb().db } as Env, PUBLIC_HANDLE);
  assert.equal(direct.status, 200);
  assertPublishedPayload(direct.payload as PublicProfileResponse);

  const hidden = await getPublicPlayerProfilePayload({ DB: createPublicProfileDb({
    showXp: false,
    showChallenges: false,
    showCards: false,
    showAwardDates: true,
  }).db } as Env, PUBLIC_HANDLE);
  assert.equal(hidden.status, 200);
  const hiddenJson = hidden.payload as PublicProfileResponse;
  assert.equal(hiddenJson.visibility?.xp, false);
  assert.equal(hiddenJson.visibility?.challenge_progress, false);
  assert.equal(hiddenJson.visibility?.calling_cards, false);
  assert.equal(hiddenJson.visibility?.award_dates, "month");
  assert.equal(hiddenJson.sections?.xp, null);
  assert.equal(hiddenJson.sections?.challenge_progress, null);
  assert.equal(hiddenJson.sections?.calling_cards, null);
  assert.deepEqual(hiddenJson.sections?.timeline, []);
  assertNoPrivateFields(hiddenJson);
  assert.doesNotMatch(JSON.stringify(hiddenJson), /total_xp|profile_level|survivor_spark|completed_label|awarded_label/i);
}

async function assertPublishingHandleContracts() {
  const dbState = createPrivacySaveDb();
  const result = await savePlayerProfilePrivacyPreferences({ DB: dbState.db } as Env, {
    id: MOCK_USER_ID,
    discord_id: "mock-discord-private-id",
    username: "Rafael Deak",
    avatar: "private-avatar-hash",
  }, {
    public_profile_enabled: true,
    public_handle: "attacker-handle",
    user_id: "attacker-user",
    discord_id: "attacker-discord",
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.privacy.public_profile_enabled, true);
  assert.match(result.payload.privacy.public_handle ?? "", /^rafael-deak-[a-z0-9]{5,7}$/);
  assert.equal(result.payload.privacy.public_href, `/players/${result.payload.privacy.public_handle}`);
  assert.equal(result.payload.privacy.public_api_href, `/api/public/player-profiles/${result.payload.privacy.public_handle}`);
  assert.equal(result.payload.privacy.public_handle?.includes("attacker"), false);
  assert.equal(result.payload.privacy.public_handle?.includes("mock-discord"), false);
  assert.equal(result.payload.privacy.public_handle?.includes(MOCK_USER_ID), false);
  assert.equal(dbState.operations.some((operation) => operation.kind === "run"), true);
  const write = dbState.operations.find((operation) => operation.kind === "run");
  assert.ok(write);
  assert.equal(write.bindings[0], MOCK_USER_ID);
  assert.equal(write.bindings.includes("attacker-handle"), false);
  assert.equal(write.bindings.includes("attacker-user"), false);
  assert.equal(write.bindings.includes("attacker-discord"), false);
}

async function callPublicProfile(method: string, handle: string, env: Env) {
  return publicProfileHandler(context(
    new Request(`https://dzn.example/api/public/player-profiles/${encodeURIComponent(handle)}`, { method }),
    env,
    handle,
  )) as Promise<Response>;
}

function context(request: Request, env: Env, handle: string): PagesContext {
  return {
    request,
    env,
    params: { handle },
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  };
}

function createPublicProfileDb(options: FakeDbOptions = {}) {
  const operations: FakeOperation[] = [];
  const state = {
    published: options.published ?? true,
    showXp: options.showXp ?? true,
    showChallenges: options.showChallenges ?? true,
    showCards: options.showCards ?? true,
    showAwardDates: options.showAwardDates ?? true,
    handle: options.handle ?? PUBLIC_HANDLE,
  };
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return statement(sql, bindings, operations, state);
        },
        ...statement(sql, [], operations, state),
      };
    },
  };
  return { db: db as unknown as Env["DB"], operations };
}

function statement(sql: string, bindings: unknown[], operations: FakeOperation[], state: Required<FakeDbOptions>) {
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
      if (/INNER\s+JOIN\s+users/i.test(sql) && /public_handle = \?/i.test(sql)) {
        if (!state.published || bindings[0] !== state.handle) return null;
        return {
          user_id: MOCK_USER_ID,
          username: "RafaelDeak",
          public_handle: state.handle,
        } as T;
      }
      if (/FROM\s+player_profile_privacy_preferences/i.test(sql)) {
        return {
          public_handle: state.handle,
          public_profile_enabled: state.published ? 1 : 0,
          show_xp: state.showXp ? 1 : 0,
          show_challenge_progress: state.showChallenges ? 1 : 0,
          show_calling_cards: state.showCards ? 1 : 0,
          show_award_dates: state.showAwardDates ? 1 : 0,
          show_discord_identity: 1,
          show_source_details: 1,
          updated_at: "2026-08-25T10:35:00.000Z",
        } as T;
      }
      if (/SUM\(xp_amount\)/i.test(sql)) return { total_xp: 375 } as T;
      return null;
    },
    async run() {
      operations.push({ kind: "run", sql, bindings });
      return { success: true };
    },
  };
}

function createPrivacySaveDb() {
  const operations: FakeOperation[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            async first<T>() {
              operations.push({ kind: "first", sql, bindings });
              return null as T | null;
            },
            async run() {
              operations.push({ kind: "run", sql, bindings });
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as Env["DB"], operations };
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

function assertPublishedPayload(json: PublicProfileResponse) {
  assert.equal(json.ok, true);
  assert.equal(json.profile?.handle, PUBLIC_HANDLE);
  assert.equal(json.profile?.display_name, "RafaelDeak");
  assert.equal(json.profile?.avatar_initial, "R");
  assert.equal(json.profile?.public_href, `/players/${PUBLIC_HANDLE}`);
  assert.equal(json.profile?.public_api_href, `/api/public/player-profiles/${PUBLIC_HANDLE}`);
  assert.equal(json.profile?.avatar_url, undefined);
  assert.equal(json.visibility?.mode, "public_viewer");
  assert.equal(json.visibility?.xp, true);
  assert.equal(json.visibility?.challenge_progress, true);
  assert.equal(json.visibility?.calling_cards, true);
  assert.equal(json.visibility?.award_dates, "month");
  assert.equal(json.visibility?.private_identifiers, "hidden");
  assert.equal(json.visibility?.raw_award_evidence, "hidden");
  assert.equal(json.visibility?.exact_award_times, "hidden");
  assert.equal(json.sections?.xp?.total_xp, 375);
  assert.equal(json.sections?.xp?.profile_level, 3);
  assert.equal(json.sections?.challenge_progress?.completed_challenges, 1);
  assert.equal(json.sections?.challenge_progress?.items?.[0]?.slug, "survivor-spark");
  assert.equal(json.sections?.challenge_progress?.items?.[0]?.status, "completed");
  assert.equal(json.sections?.challenge_progress?.items?.[0]?.progress_percent, 100);
  assert.equal(json.sections?.challenge_progress?.items?.[0]?.completed_label, "Aug 2026");
  assert.equal(json.sections?.calling_cards?.count, 1);
  assert.equal(json.sections?.calling_cards?.items?.[0]?.code, "survivor_spark");
  assert.equal(json.sections?.calling_cards?.items?.[0]?.awarded_label, "Aug 2026");
  assert.ok((json.sections?.timeline ?? []).some((item) => item.kind === "calling_card"));
  assert.ok((json.sections?.timeline ?? []).some((item) => item.kind === "challenge"));
  assertFairnessFlags(json.fairness);
  assertNoPrivateFields(json);
}

function assertReadScope(operations: FakeOperation[]) {
  assert.equal(operations.some((operation) => operation.kind === "run"), false, "Public profile GET must be read-only.");
  assert.equal(operations.length, 7, "Public profile GET should perform one publish lookup plus profile progression and attribution reads.");
  assert.match(operations[0].sql, /\bplayer_profile_privacy_preferences\b/i);
  assert.match(operations[0].sql, /\bINNER\s+JOIN\s+users\b/i);
  assert.deepEqual(operations[0].bindings, [PUBLIC_HANDLE]);
  for (const operation of operations) {
    assert.doesNotMatch(operation.sql, forbiddenProtectedSurfacePattern());
    assert.match(
      operation.sql,
      /\bplayer_profile_privacy_preferences\b|\busers\b|\bplayer_challenges\b|\bplayer_challenge_participations\b|\bplayer_xp_ledger\b|\bplayer_calling_card_awards\b|\bplayer_calling_cards\b/i,
      `Unexpected public profile read: ${operation.sql}`,
    );
  }
}

function assertFairnessFlags(fairness: Record<string, boolean> | undefined) {
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
    assert.equal(fairness?.[flag], false, `${flag} must remain false.`);
  }
}

function assertNoPrivateFields(json: unknown) {
  const serialized = JSON.stringify(json);
  assert.doesNotMatch(serialized, /"discord_id"\s*:/i, "Public profile must not expose Discord IDs.");
  assert.doesNotMatch(serialized, /"user_id"\s*:/i, "Public profile must not expose internal user IDs.");
  assert.doesNotMatch(serialized, /"avatar_url"\s*:/i, "Public profile must not expose Discord avatar hashes or derived avatar URLs.");
  assert.doesNotMatch(serialized, /"source_id"\s*:|"source_table"\s*:/i, "Public profile must not expose source identifiers.");
  assert.doesNotMatch(serialized, /"evidence_json"\s*:|"raw_evidence"\s*:/i, "Public profile must not expose raw award evidence.");
  assert.doesNotMatch(serialized, /"awarded_at"\s*:|"completed_at"\s*:|"joined_at"\s*:|"occurred_at"\s*:/i, "Public profile must not expose exact award timestamps.");
  assert.doesNotMatch(serialized, /owner_billing_accounts|server_subscriptions|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);
}

function assertNoForbiddenSqlMutationTargets(source: string) {
  const sqlTemplates = source.match(/`[\s\S]*?`/g) ?? [];
  for (const template of sqlTemplates) {
    assert.doesNotMatch(template, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i, "Public profile helper must stay read-only.");
  }
}

function assertPublicProfilePreferencesAreNotProtectedSystemDependencies() {
  for (const file of [
    "functions/api/public/servers.ts",
    "functions/_lib/server-ranking.ts",
    "functions/api/public/leaderboards.ts",
    "functions/_lib/advanced-leaderboards.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/api/cron/player-progression/awards.ts",
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/status.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /\/api\/public\/player-profiles|\/players\/\[handle\]|public-player-profile|PublicPlayerProfile|player_public_profile_handles|public_handle/i,
      `${file} must not depend on public profile publishing preferences.`,
    );
  }

  const events = read("functions/_lib/events.ts");
  assert.equal(events.includes("public_event_creator_member_rows"), true, "Public events may expose the dedicated host/member profile attribution placement.");
  assert.equal(events.includes("creator_profile: creatorProfile"), true, "Public event host/member attribution must stay projected metadata only.");
  assert.doesNotMatch(events, /player_public_profile_handles|PublicPlayerProfile|\/players\/\[handle\]/i, "Public event attribution must not depend on the public profile viewer route internals.");
}

function publicHandleGenerationBlock(source: string) {
  const match = source.match(/async function createUniquePublicProfileHandle[\s\S]*?function publicProfileHandleBase/);
  return match?.[0] ?? "";
}

function forbiddenProtectedSurfacePattern() {
  return /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bplayer_saved_servers\b|\bserver_owners\b|\bserver_rankings\b|\bleaderboards\b|\bdiscovery_score\b|\bserver_reviews\b|\bserver_review_reports\b|\bserver_review_moderation_actions\b|\bcompetitive_events\b|\bevent_matchups\b|\bevent_participants\b|\bevent_score_snapshots\b|\bserver_war_challenges\b|\bserver_war_events\b|\bserver_war_score_snapshots\b|\bdzn_seasons\b|\bserver_badge_awards\b|\bbadge_unlock_progress\b|\bbadges\b|\bplayer_profiles\b|\bkill_events\b|\bplayer_events\b|\bplayer_progression_award_sources\b|\bnitrado\b|\bdiscord_oauth_tokens\b|\bdiscord_guilds\b|\bstripe\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i;
}

function stripSqlComments(source: string) {
  return source.replace(/--.*$/gm, "");
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}
