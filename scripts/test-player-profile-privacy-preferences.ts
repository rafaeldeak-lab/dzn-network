import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { MOCK_USER_ID } from "../functions/_lib/db";
import {
  defaultPlayerProfilePrivacyPreferences,
  getPlayerProfilePrivacyPreferences,
  playerProfilePrivacyFairness,
  savePlayerProfilePrivacyPreferences,
} from "../functions/_lib/player-profile-privacy";
import { onRequest as profilePrivacyHandler } from "../functions/api/player/profile-privacy";
import type { Env, PagesContext } from "../functions/_lib/types";

type FakeOperation = {
  kind: "first" | "run";
  sql: string;
  bindings: unknown[];
};

type PrivacyResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  privacy?: {
    public_handle?: string | null;
    public_href?: string | null;
    public_api_href?: string | null;
    public_profile_enabled?: boolean;
    persistence?: string;
    settings_href?: string;
    updated_at?: string | null;
    controls?: Record<string, boolean>;
    public_safe_preview?: Record<string, boolean>;
  };
  fairness?: Record<string, boolean>;
};

type PrivacyRow = {
  public_handle: string | null;
  public_profile_enabled: number;
  show_xp: number;
  show_challenge_progress: number;
  show_calling_cards: number;
  show_award_dates: number;
  show_discord_identity: number;
  show_source_details: number;
  updated_at: string;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertStaticContracts();
  await assertEndpointContracts();
  await assertHelperContracts();
  console.log("Player profile privacy preference tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    "migrations/0065_player_profile_privacy_preferences.sql",
    "functions/_lib/player-profile-privacy.ts",
    "functions/api/player/profile-privacy.ts",
    "functions/_lib/player-profile-progression.ts",
    "components/player/player-profile-progression-page.tsx",
    "scripts/test-player-profile-privacy-preferences.ts",
    "docs/PLAYER_PROFILE_PRIVACY_PREFERENCES_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const migration = stripSqlComments(read("migrations/0065_player_profile_privacy_preferences.sql"));
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS player_profile_privacy_preferences",
    "user_id TEXT PRIMARY KEY",
    "public_profile_enabled INTEGER NOT NULL DEFAULT 0",
    "show_xp INTEGER NOT NULL DEFAULT 1",
    "show_challenge_progress INTEGER NOT NULL DEFAULT 1",
    "show_calling_cards INTEGER NOT NULL DEFAULT 1",
    "show_award_dates INTEGER NOT NULL DEFAULT 0",
    "show_discord_identity INTEGER NOT NULL DEFAULT 0",
    "show_source_details INTEGER NOT NULL DEFAULT 0",
    "FOREIGN KEY(user_id) REFERENCES users(id)",
  ]) {
    assert.equal(migration.includes(snippet), true, `Privacy migration must include ${snippet}.`);
  }
  assert.doesNotMatch(migration, forbiddenProtectedSystemPattern());
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bALTER\b/i, "Privacy migration must stay additive.");

  const api = read("functions/api/player/profile-privacy.ts");
  for (const snippet of [
    "GET",
    "PATCH",
    "getRequestSessionUser",
    "readBoundedJson",
    "getPlayerProfilePrivacyPreferences",
    "savePlayerProfilePrivacyPreferences",
    "privateNoStoreHeaders",
    "methodNotAllowed",
  ]) {
    assert.equal(api.includes(snippet), true, `Privacy API must include ${snippet}.`);
  }
  assert.doesNotMatch(api, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(api, /createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|stripe|NITRADO_TOKEN|DISCORD_BOT_TOKEN|fetchDiscordGuilds|canManageDiscordGuild|storeGuilds/i);

  const helper = read("functions/_lib/player-profile-privacy.ts");
  for (const snippet of [
    "PLAYER_PROFILE_PRIVACY_SETTINGS_HREF",
    "player_profile_privacy_preferences",
    "WHERE user_id = ?",
    "readPlayerProfilePrivacyPreferenceRow(env, user.id)",
    "ON CONFLICT(user_id) DO UPDATE",
    "show_discord_identity = 0",
    "show_source_details = 0",
    "exposes_discord_id: false",
    "exposes_user_id: false",
    "exposes_source_ids: false",
    "exposes_raw_evidence: false",
    "xp_award_influence: false",
    "calling_card_award_influence: false",
  ]) {
    assert.equal(helper.includes(snippet), true, `Privacy helper must include ${snippet}.`);
  }
  assert.doesNotMatch(helper, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);
  assertNoForbiddenSqlMutationTargets(helper);
  assert.doesNotMatch(helper, /createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|stripe|NITRADO_TOKEN|DISCORD_BOT_TOKEN|fetchDiscordGuilds|canManageDiscordGuild|storeGuilds/i);

  const profileHelper = read("functions/_lib/player-profile-progression.ts");
  for (const snippet of [
    "getPlayerProfilePrivacyPreferences",
    "public_profile_enabled: privacy.public_profile_enabled",
    "persistence: privacy.persistence",
    "settings_href: privacy.settings_href",
    "public_handle: privacy.public_handle",
    "public_href: privacy.public_href",
    "public_api_href: privacy.public_api_href",
    "updated_at: privacy.updated_at",
    "controls: privacy.controls",
  ]) {
    assert.equal(profileHelper.includes(snippet), true, `Profile payload helper must include ${snippet}.`);
  }

  const profileUi = read("components/player/player-profile-progression-page.tsx");
  for (const snippet of [
    "/api/player/profile-privacy",
    "Allow public profile display",
    "Show XP",
    "Show challenge progress",
    "Show calling cards",
    "Show award dates",
    "Save Preferences",
    "Profile privacy preferences saved.",
    "Saved display preferences belong to your player profile",
    "Public-safe display does not expose Discord IDs, user IDs, source IDs, raw evidence, source details, or exact award timestamps.",
  ]) {
    assert.equal(profileUi.includes(snippet), true, `Profile UI must include ${snippet}.`);
  }
  assert.match(profileUi, /method:\s*"PATCH"/, "Profile UI should save preferences with PATCH.");
  assert.equal(
    profileUi.includes("showAwardDates && !hiddenMode && !publicMode"),
    true,
    "Public preview must keep exact award dates hidden even when the saved award-date preference is enabled.",
  );
  assert.doesNotMatch(profileUi, /method\s*:\s*["'](?:POST|PUT|DELETE)["']/i, "Profile UI must not add unrelated browser mutations.");
  assert.doesNotMatch(profileUi, /dangerouslySetInnerHTML|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  const profileShowcaseTest = read("scripts/test-player-profile-progression-showcase.ts");
  assert.equal(profileShowcaseTest.includes("/api/player/profile-privacy"), true, "Profile showcase tests must cover saved settings integration.");

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:player-profile-privacy-preferences"), true, "Focused privacy preference test must be wired into package scripts.");

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  for (const snippet of [
    "Persistent Player Profile Privacy Preferences Slice",
    "`/api/player/profile-privacy`",
    "`player_profile_privacy_preferences`",
    "player-owned settings model",
    "must not affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility",
  ]) {
    assert.equal(platformSpec.includes(snippet), true, `Master spec must include ${snippet}.`);
  }

  const publicAccessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  for (const snippet of [
    "`/api/player/profile-privacy`",
    "private player-owned settings API",
    "Display preferences must not affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility",
  ]) {
    assert.equal(publicAccessPolicy.includes(snippet), true, `Public access policy must include ${snippet}.`);
  }

  const handoff = read("docs/PLAYER_PROFILE_PRIVACY_PREFERENCES_HANDOFF.md");
  for (const snippet of [
    "Player Profile Privacy Preferences Handoff",
    "No public profile reader route is introduced",
    "No Stripe products/prices were created or changed.",
    "Issue #49 remains reserved for final live checkout activation.",
  ]) {
    assert.equal(handoff.includes(snippet), true, `Handoff must include ${snippet}.`);
  }

  assertPrivacyPreferencesAreNotProtectedSystemDependencies();
}

async function assertEndpointContracts() {
  const unauthenticated = await callPrivacyApi("GET", {} as Env);
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: "Unauthorized" });

  const disallowed = await callPrivacyApi("POST", { MOCK_AUTH: "true" } as Env);
  assert.equal(disallowed.status, 405);
  assert.deepEqual(await disallowed.json(), { error: "Method not allowed" });

  const invalidJson = await profilePrivacyHandler({
    request: new Request("https://dzn.example/api/player/profile-privacy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{bad-json",
    }),
    env: { MOCK_AUTH: "true", DB: createPrivacyDb().db } as Env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Response;
  assert.equal(invalidJson.status, 400);

  const noDbRead = await callPrivacyApi("GET", { MOCK_AUTH: "true" } as Env);
  assert.equal(noDbRead.status, 200);
  assert.match(noDbRead.headers.get("cache-control") ?? "", /private/i);
  assert.match(noDbRead.headers.get("cache-control") ?? "", /no-store/i);
  const noDbReadJson = await noDbRead.json() as PrivacyResponse;
  assert.equal(noDbReadJson.privacy?.persistence, "unavailable");
  assertDefaultPrivacy(noDbReadJson);
  assertFairnessFlags(noDbReadJson.fairness);
  assertNoPrivateFields(noDbReadJson);

  const noDbPatch = await callPrivacyApi("PATCH", { MOCK_AUTH: "true" } as Env, { public_profile_enabled: true });
  assert.equal(noDbPatch.status, 503);
  const noDbPatchJson = await noDbPatch.json() as PrivacyResponse;
  assert.equal(noDbPatchJson.ok, false);
  assert.equal(noDbPatchJson.error, "PLAYER_PROFILE_PRIVACY_UNAVAILABLE");
  assertFairnessFlags(noDbPatchJson.fairness);

  const nullPatchDb = createPrivacyDb(existingPrivacyRow());
  const nullPatchResponse = await callPrivacyApi("PATCH", { MOCK_AUTH: "true", DB: nullPatchDb.db } as Env, null);
  assert.equal(nullPatchResponse.status, 200);
  const nullPatchJson = await nullPatchResponse.json() as PrivacyResponse;
  assert.equal(nullPatchJson.ok, true);
  assert.equal(nullPatchJson.privacy?.public_profile_enabled, true);
  assert.equal(nullPatchJson.privacy?.controls?.show_xp, false);
  assert.equal(nullPatchJson.privacy?.controls?.show_calling_cards, false);
  assertPrivacyWriteScope(nullPatchDb.operations);

  const readDb = createPrivacyDb(existingPrivacyRow());
  const readResponse = await callPrivacyApi("GET", { MOCK_AUTH: "true", DB: readDb.db } as Env);
  assert.equal(readResponse.status, 200);
  const readJson = await readResponse.json() as PrivacyResponse;
  assert.equal(readJson.privacy?.persistence, "saved");
  assert.equal(readJson.privacy?.public_handle, "rafaeldeak-a1b2c");
  assert.equal(readJson.privacy?.public_href, "/players/rafaeldeak-a1b2c");
  assert.equal(readJson.privacy?.public_api_href, "/api/public/player-profiles/rafaeldeak-a1b2c");
  assert.equal(readJson.privacy?.public_profile_enabled, true);
  assert.equal(readJson.privacy?.settings_href, "/api/player/profile-privacy");
  assert.equal(readJson.privacy?.controls?.show_xp, false);
  assert.equal(readJson.privacy?.controls?.show_challenge_progress, true);
  assert.equal(readJson.privacy?.controls?.show_calling_cards, false);
  assert.equal(readJson.privacy?.controls?.show_award_dates, true);
  assert.equal(readJson.privacy?.controls?.show_discord_identity, false);
  assert.equal(readJson.privacy?.controls?.show_source_details, false);
  assert.equal(readJson.privacy?.public_safe_preview?.hides_exact_award_times, true);
  assert.equal(readDb.operations.some((op) => op.kind === "run"), false, "GET must not mutate privacy preferences.");
  assert.deepEqual(readDb.operations.flatMap((op) => op.bindings), [MOCK_USER_ID]);
  assertNoPrivateFields(readJson);

  const patchDb = createPrivacyDb(null);
  const patchResponse = await callPrivacyApi("PATCH", { MOCK_AUTH: "true", DB: patchDb.db } as Env, {
    user_id: "attacker-user",
    discord_id: "attacker-discord",
    public_profile_enabled: true,
    controls: {
      show_xp: false,
      show_challenge_progress: false,
      show_calling_cards: true,
      show_award_dates: true,
      show_discord_identity: true,
      show_source_details: true,
    },
  });
  assert.equal(patchResponse.status, 200);
  const patchJson = await patchResponse.json() as PrivacyResponse;
  assert.equal(patchJson.ok, true);
  assert.equal(patchJson.privacy?.persistence, "saved");
  assert.match(patchJson.privacy?.public_handle ?? "", /^rafaeldeak-[a-z0-9]{5,7}$/);
  assert.equal(patchJson.privacy?.public_href, `/players/${patchJson.privacy?.public_handle}`);
  assert.equal(patchJson.privacy?.public_api_href, `/api/public/player-profiles/${patchJson.privacy?.public_handle}`);
  assert.equal(patchJson.privacy?.public_profile_enabled, true);
  assert.equal(patchJson.privacy?.controls?.show_xp, false);
  assert.equal(patchJson.privacy?.controls?.show_challenge_progress, false);
  assert.equal(patchJson.privacy?.controls?.show_calling_cards, true);
  assert.equal(patchJson.privacy?.controls?.show_award_dates, true);
  assert.equal(patchJson.privacy?.controls?.show_discord_identity, false);
  assert.equal(patchJson.privacy?.controls?.show_source_details, false);
  assert.equal(patchJson.privacy?.public_safe_preview?.exposes_discord_id, false);
  assert.equal(patchJson.privacy?.public_safe_preview?.exposes_source_ids, false);
  assert.equal(patchJson.privacy?.public_safe_preview?.hides_exact_award_times, true);
  assertFairnessFlags(patchJson.fairness);
  assertNoPrivateFields(patchJson);
  assertPrivacyWriteScope(patchDb.operations, { generatedHandle: true });
}

async function assertHelperContracts() {
  const defaults = defaultPlayerProfilePrivacyPreferences();
  assert.equal(defaults.public_profile_enabled, false);
  assert.equal(defaults.controls.show_xp, true);
  assert.equal(defaults.controls.show_challenge_progress, true);
  assert.equal(defaults.controls.show_calling_cards, true);
  assert.equal(defaults.controls.show_award_dates, false);
  assert.equal(defaults.controls.show_discord_identity, false);
  assert.equal(defaults.controls.show_source_details, false);

  const fairness = playerProfilePrivacyFairness();
  assertFairnessFlags(fairness);

  const unavailable = await getPlayerProfilePrivacyPreferences({ MOCK_AUTH: "true" } as Env, mockSessionUser());
  assert.equal(unavailable.persistence, "unavailable");

  const saveDb = createPrivacyDb(existingPrivacyRow());
  const saved = await savePlayerProfilePrivacyPreferences({ MOCK_AUTH: "true", DB: saveDb.db } as Env, mockSessionUser(), {
    public_profile_enabled: false,
    show_xp: true,
    show_challenge_progress: true,
    show_calling_cards: true,
    show_award_dates: false,
    show_discord_identity: true,
    show_source_details: true,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.privacy.controls.show_discord_identity, false);
  assert.equal(saved.payload.privacy.controls.show_source_details, false);
  assertPrivacyWriteScope(saveDb.operations);
}

async function callPrivacyApi(method: string, env: Env, body?: unknown) {
  return profilePrivacyHandler({
    request: new Request("https://dzn.example/api/player/profile-privacy", {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Promise<Response>;
}

function createPrivacyDb(row: PrivacyRow | null = null) {
  const operations: FakeOperation[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            async first<T>() {
              operations.push({ kind: "first", sql, bindings });
              return (sql.includes("FROM player_profile_privacy_preferences") ? row : null) as T | null;
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

function existingPrivacyRow(): PrivacyRow {
  return {
    public_handle: "rafaeldeak-a1b2c",
    public_profile_enabled: 1,
    show_xp: 0,
    show_challenge_progress: 1,
    show_calling_cards: 0,
    show_award_dates: 1,
    show_discord_identity: 1,
    show_source_details: 1,
    updated_at: "2026-08-25T15:45:00.000Z",
  };
}

function mockSessionUser() {
  return {
    id: MOCK_USER_ID,
    discord_id: "mock-discord",
    username: "RafaelDeak",
    avatar: null,
  };
}

function assertDefaultPrivacy(response: PrivacyResponse) {
  assert.equal(response.privacy?.public_handle, null);
  assert.equal(response.privacy?.public_href, null);
  assert.equal(response.privacy?.public_api_href, null);
  assert.equal(response.privacy?.public_profile_enabled, false);
  assert.equal(response.privacy?.settings_href, "/api/player/profile-privacy");
  assert.equal(response.privacy?.controls?.show_xp, true);
  assert.equal(response.privacy?.controls?.show_challenge_progress, true);
  assert.equal(response.privacy?.controls?.show_calling_cards, true);
  assert.equal(response.privacy?.controls?.show_award_dates, false);
  assert.equal(response.privacy?.controls?.show_discord_identity, false);
  assert.equal(response.privacy?.controls?.show_source_details, false);
  assert.equal(response.privacy?.public_safe_preview?.exposes_discord_id, false);
  assert.equal(response.privacy?.public_safe_preview?.exposes_user_id, false);
  assert.equal(response.privacy?.public_safe_preview?.exposes_source_ids, false);
  assert.equal(response.privacy?.public_safe_preview?.exposes_raw_evidence, false);
  assert.equal(response.privacy?.public_safe_preview?.hides_exact_award_times, true);
}

function assertPrivacyWriteScope(operations: FakeOperation[], options: { generatedHandle?: boolean } = {}) {
  const reads = operations.filter((operation) => operation.kind === "first");
  assert.equal(reads.length, options.generatedHandle ? 2 : 1, "PATCH should read the current preference row and only check handle collisions when publishing needs a handle.");
  assert.match(reads[0].sql, /\bFROM\s+player_profile_privacy_preferences\b/i);
  assert.deepEqual(reads[0].bindings, [MOCK_USER_ID]);
  if (options.generatedHandle) {
    assert.match(reads[1].sql, /\bpublic_handle\s+=\s+\?/i, "Publishing should only check the generated public handle for collisions.");
    assert.match(String(reads[1].bindings[0] ?? ""), /^rafaeldeak-[a-z0-9]{5,7}$/);
  }

  const writes = operations.filter((operation) => operation.kind === "run");
  assert.equal(writes.length, 1, "PATCH should write one preference row.");
  assert.match(writes[0].sql, /\bINSERT\s+INTO\s+player_profile_privacy_preferences\b/i);
  assert.match(writes[0].sql, /\bON\s+CONFLICT\(user_id\)\s+DO\s+UPDATE\b/i);
  assert.equal(writes[0].bindings[0], MOCK_USER_ID);
  if (options.generatedHandle) assert.match(String(writes[0].bindings[1] ?? ""), /^rafaeldeak-[a-z0-9]{5,7}$/);
  assert.equal(writes[0].bindings.includes("attacker-user"), false);
  assert.equal(writes[0].bindings.includes("attacker-discord"), false);
  assert.doesNotMatch(writes[0].sql, forbiddenProtectedSystemPattern());
  assert.doesNotMatch(writes[0].sql, /\bplayer_xp_ledger\b|\bplayer_calling_card_awards\b|\bplayer_challenge_participations\b/i);
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
  assert.doesNotMatch(serialized, /"user_id"\s*:/, "Privacy payload must not expose internal user IDs.");
  assert.doesNotMatch(serialized, /"discord_id"\s*:/, "Privacy payload must not expose Discord IDs.");
  assert.doesNotMatch(serialized, /"source_id"\s*:/, "Privacy payload must not expose source IDs.");
  assert.doesNotMatch(serialized, /"evidence_json"\s*:|"raw_evidence"\s*:/i, "Privacy payload must not expose raw evidence.");
  assert.doesNotMatch(serialized, /owner_billing_accounts|server_subscriptions|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);
}

function assertNoForbiddenSqlMutationTargets(source: string) {
  const sqlTemplates = source.match(/`[\s\S]*?`/g) ?? [];
  for (const template of sqlTemplates) {
    if (!/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i.test(template)) continue;
    assert.match(template, /\bplayer_profile_privacy_preferences\b/i, "Privacy preference writes must target only the preference table.");
    assert.doesNotMatch(template, forbiddenProtectedSystemPattern());
    assert.doesNotMatch(template, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bALTER\b/i);
  }
}

function assertPrivacyPreferencesAreNotProtectedSystemDependencies() {
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
    "functions/_lib/player-progression.ts",
    "functions/api/cron/player-progression/awards.ts",
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/status.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /\/api\/player\/profile-privacy|player-profile-privacy|player_profile_privacy_preferences|PlayerProfilePrivacy/i,
      `${file} must not depend on player profile privacy preferences.`,
    );
  }
}

function forbiddenProtectedSystemPattern() {
  return /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bplayer_saved_servers\b|\bserver_owners\b|\bserver_rankings\b|\bleaderboards\b|\bdiscovery_score\b|\bserver_reviews\b|\bserver_review_reports\b|\bserver_review_moderation_actions\b|\bcompetitive_events\b|\bevent_matchups\b|\bevent_participants\b|\bevent_score_snapshots\b|\bserver_war_challenges\b|\bserver_war_events\b|\bserver_war_score_snapshots\b|\bdzn_seasons\b|\bserver_badge_awards\b|\bbadge_unlock_progress\b|\bbadges\b|\bplayer_profiles\b|\bkill_events\b|\bplayer_events\b|\bnitrado\b|\bdiscord_oauth_tokens\b|\bdiscord_guilds\b|\bstripe\b/i;
}

function stripSqlComments(source: string) {
  return source.replace(/--.*$/gm, "");
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}
