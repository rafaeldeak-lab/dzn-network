import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequest as playerChallengesHandler } from "../functions/api/player/challenges";
import { onRequest as playerHubHandler } from "../functions/api/player/hub";
import type { Env, PagesContext } from "../functions/_lib/types";

type FakeOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const playerChallengesApiSource = read("functions/api/player/challenges.ts");
  for (const snippet of [
    "getRequestSessionUser",
    "GET",
    "POST",
    "getPlayerChallengesPayload",
    "joinPlayerChallenge",
  ]) {
    assert.equal(playerChallengesApiSource.includes(snippet), true, `Player challenges API must include ${snippet}`);
  }
  assert.doesNotMatch(playerChallengesApiSource, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(playerChallengesApiSource, /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bstripe\b|\bcreateCheckoutSession\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i);
  assert.doesNotMatch(playerChallengesApiSource, /\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bcanManageDiscordGuild\b|\bstoreGuilds\b/);

  const progressionSource = read("functions/_lib/player-progression.ts");
  for (const snippet of [
    "player_challenges",
    "player_challenge_participations",
    "player_xp_ledger",
    "player_calling_card_awards",
    "PlayerChallengeSummary",
    "Only player challenge join is available in this foundation slice.",
  ]) {
    assert.equal(progressionSource.includes(snippet), true, `Progression helper must include ${snippet}`);
  }
  assert.doesNotMatch(progressionSource, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(progressionSource, /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bcreateCheckoutSession\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i);
  assert.doesNotMatch(progressionSource, /\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bcanManageDiscordGuild\b|\bstoreGuilds\b/);
  assertSourceMutationScope(progressionSource);

  const playerHubApiSource = read("functions/api/player/hub.ts");
  assert.equal(playerHubApiSource.includes("getPlayerChallengesPayload"), true, "Player Hub API must include challenge progress.");
  assert.equal(playerHubApiSource.includes("player_progress"), true, "Player Hub API must expose player_progress.");
  assert.doesNotMatch(playerHubApiSource, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  assert.doesNotMatch(playerHubApiSource, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);

  const playerHubPageSource = read("components/player/player-hub-page.tsx");
  for (const snippet of [
    "Challenges And Progress",
    "Earned XP",
    "Paid plans do not unlock competitive cards.",
    "/events/challenges",
  ]) {
    assert.equal(playerHubPageSource.includes(snippet), true, `Player Hub UI must include ${snippet}`);
  }

  const eventsPlatformSource = read("components/events/events-platform.tsx");
  for (const snippet of [
    "/api/player/challenges",
    "PlayerChallengeParticipationPanel",
    "Join Challenge",
    "XP and calling cards are earned player-side only",
    "body: JSON.stringify({ action: \"join\", challenge_slug: challenge.slug })",
  ]) {
    assert.equal(eventsPlatformSource.includes(snippet), true, `Challenges page must include ${snippet}`);
  }
  assert.doesNotMatch(eventsPlatformSource, /\bDZN_LIVE_CHECKOUT_ENABLED\b|\bcreateCheckoutSession\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b/i);

  const migration = stripSqlComments(read("migrations/0062_player_challenges_xp_calling_cards.sql"));
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS player_challenges",
    "CREATE TABLE IF NOT EXISTS player_challenge_participations",
    "CREATE TABLE IF NOT EXISTS player_xp_ledger",
    "CREATE TABLE IF NOT EXISTS player_calling_cards",
    "CREATE TABLE IF NOT EXISTS player_calling_card_awards",
    "UNIQUE(user_id, challenge_id)",
    "ON CONFLICT(slug) DO NOTHING",
  ]) {
    assert.equal(migration.includes(snippet), true, `Migration must include ${snippet}`);
  }
  assert.doesNotMatch(migration, forbiddenProtectedSurfacePattern(), "Progression migration must not touch protected competitive/billing surfaces.");

  const publicServersApiSource = read("functions/api/public/servers.ts");
  assertFunctionDoesNotMention(publicServersApiSource, "sortPublicServersForDiscovery", /\bplayer_challenge|\bplayer_xp|\bcalling_card/i);
  assertFunctionDoesNotMention(publicServersApiSource, "applyPublicServerAccess", /\bplayer_challenge|\bplayer_xp|\bcalling_card/i);

  const publicAccessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  assert.equal(publicAccessPolicy.includes("`/api/player/challenges`"), true, "Public access policy must document player challenges.");
  assert.equal(publicAccessPolicy.includes("Player challenge participation must not affect rankings"), true, "Public access policy must document challenge fairness.");

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  assert.equal(platformSpec.includes("Challenges / XP / Calling Cards Foundation Slice"), true, "Master spec must document this slice.");
  assert.equal(platformSpec.includes("`/api/player/challenges`"), true, "Master spec must list the player challenges endpoint.");

  const handoff = read("docs/CHALLENGES_XP_CALLING_CARDS_HANDOFF.md");
  assert.equal(handoff.includes("free logged-in player feature"), true);
  assert.equal(handoff.includes("Production merge/deploy/migration application: not included."), true);

  const unauthenticated = await callPlayerChallenges("GET", {} as Env);
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: "Unauthorized" });

  const noDbGet = await callPlayerChallenges("GET", { MOCK_AUTH: "true" } as Env);
  assert.equal(noDbGet.status, 200);
  const noDbJson = await noDbGet.json() as { source?: string; challenges?: unknown[]; player_progress?: { total_xp?: number } };
  assert.equal(noDbJson.source, "display_fallback");
  assert.ok((noDbJson.challenges ?? []).length >= 3);
  assert.equal(noDbJson.player_progress?.total_xp, 0);

  const noDbPost = await callPlayerChallenges("POST", { MOCK_AUTH: "true" } as Env, { action: "join", challenge_slug: "survivor-spark" });
  assert.equal(noDbPost.status, 503);

  const listDb = createFakeChallengeDb();
  const listResponse = await callPlayerChallenges("GET", { MOCK_AUTH: "true", DB: listDb.db } as Env);
  assert.equal(listResponse.status, 200);
  const listJson = await listResponse.json() as {
    source?: string;
    challenges?: Array<{ player_state?: { status?: string } }>;
    player_progress?: { total_xp?: number; calling_cards?: unknown[] };
  };
  assert.equal(listJson.source, "live");
  assert.equal(listJson.challenges?.[0]?.player_state?.status, "not_joined");
  assert.equal(listJson.player_progress?.total_xp, 125);
  assert.equal(listJson.player_progress?.calling_cards?.length, 1);
  assert.equal(listDb.operations.some((op) => op.kind === "run"), false, "GET must not mutate player progression.");

  const joinDb = createFakeChallengeDb();
  const joinResponse = await callPlayerChallenges("POST", { MOCK_AUTH: "true", DB: joinDb.db } as Env, { action: "join", challenge_slug: "survivor-spark" });
  assert.equal(joinResponse.status, 200);
  const joinJson = await joinResponse.json() as { ok?: boolean; joined?: boolean; challenge?: { player_state?: { status?: string } } };
  assert.equal(joinJson.ok, true);
  assert.equal(joinJson.joined, true);
  assert.equal(joinJson.challenge?.player_state?.status, "joined");
  assertProgressionOperationsStayIsolated(joinDb.operations);

  const unsupportedDb = createFakeChallengeDb();
  const unsupportedAction = await callPlayerChallenges("POST", { MOCK_AUTH: "true", DB: unsupportedDb.db } as Env, { action: "complete", challenge_slug: "survivor-spark" });
  assert.equal(unsupportedAction.status, 400);
  assert.equal(unsupportedDb.operations.some((op) => op.kind === "run"), false, "Unsupported actions must not mutate progress.");

  const unknownTarget = await callPlayerChallenges("POST", { MOCK_AUTH: "true", DB: createFakeChallengeDb().db } as Env, { action: "join", challenge_slug: "missing-track" });
  assert.equal(unknownTarget.status, 404);

  const hubDb = createFakeChallengeDb();
  const hubResponse = await callPlayerHub({ MOCK_AUTH: "true", DB: hubDb.db } as Env);
  assert.equal(hubResponse.status, 200);
  const hubJson = await hubResponse.json() as { player_progress?: { total_xp?: number; joined_challenges?: number; href?: string } };
  assert.equal(hubJson.player_progress?.total_xp, 125);
  assert.equal(hubJson.player_progress?.href, "/events/challenges");

  console.log("Challenges / XP / Calling Cards foundation tests passed.");
}

async function callPlayerChallenges(method: string, env: Env, body?: unknown) {
  return playerChallengesHandler({
    request: new Request("https://dzn.example/api/player/challenges", {
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

async function callPlayerHub(env: Env) {
  return playerHubHandler({
    request: new Request("https://dzn.example/api/player/hub"),
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
  const state = {
    joined: false,
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

function statement(sql: string, bindings: unknown[], operations: FakeOperation[], state: { joined: boolean }) {
  return {
    async all<T>() {
      operations.push({ kind: "all", sql, bindings });
      if (/FROM\s+player_challenges/i.test(sql)) {
        return { results: [challengeRow()] as T[] };
      }
      if (/FROM\s+player_challenge_participations/i.test(sql)) {
        return { results: state.joined ? [participationRow()] as T[] : [] as T[] };
      }
      if (/FROM\s+player_calling_card_awards/i.test(sql)) {
        return { results: [callingCardAwardRow()] as T[] };
      }
      return { results: [] as T[] };
    },
    async first<T>() {
      operations.push({ kind: "first", sql, bindings });
      if (/FROM\s+player_challenges/i.test(sql)) {
        return (bindings.includes("missing-track") ? null : challengeRow()) as T | null;
      }
      if (/SUM\(xp_amount\)/i.test(sql)) {
        return { total_xp: 125 } as T;
      }
      return null;
    },
    async run() {
      operations.push({ kind: "run", sql, bindings });
      if (/INSERT\s+OR\s+IGNORE\s+INTO\s+player_challenge_participations/i.test(sql)) state.joined = true;
      return { success: true };
    },
  };
}

function challengeRow() {
  return {
    id: "foundation-survivor-spark",
    slug: "survivor-spark",
    title: "Survivor Spark",
    description: "Join the foundation survival track.",
    category: "survival",
    status: "active",
    reward_xp: 50,
    calling_card_code: "survivor_spark",
    calling_card_name: "Survivor Spark",
    calling_card_description: "Joined the first DZN player challenge track.",
    calling_card_rarity: "foundation",
    target_value: 1,
    sort_order: 10,
    starts_at: null,
    ends_at: null,
  };
}

function participationRow() {
  return {
    challenge_id: "foundation-survivor-spark",
    status: "joined",
    progress_value: 0,
    target_value: 1,
    xp_awarded: 0,
    calling_card_awarded: null,
    joined_at: "2026-08-25T10:00:00.000Z",
    completed_at: null,
    updated_at: "2026-08-25T10:00:00.000Z",
  };
}

function callingCardAwardRow() {
  return {
    calling_card_code: "survivor_spark",
    calling_card_name: "Survivor Spark",
    calling_card_description: "Joined the first DZN player challenge track.",
    calling_card_rarity: "foundation",
    awarded_at: "2026-08-25T10:30:00.000Z",
  };
}

function assertSourceMutationScope(source: string) {
  const sqlTemplates = source.match(/`[\s\S]*?`/g) ?? [];
  for (const template of sqlTemplates) {
    if (!/\b(?:INSERT\s+OR\s+IGNORE\s+INTO|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP|ALTER|TRUNCATE)\b/i.test(template)) continue;
    assert.match(template, /\bINSERT\s+OR\s+IGNORE\s+INTO\s+player_challenge_participations\b/i, `Unexpected player progression mutation SQL: ${template}`);
    assert.doesNotMatch(template, forbiddenProtectedSurfacePattern());
  }
}

function assertProgressionOperationsStayIsolated(operations: FakeOperation[]) {
  const runOperations = operations.filter((op) => op.kind === "run");
  assert.equal(runOperations.length, 1);
  for (const operation of runOperations) {
    assert.match(operation.sql, /\bINSERT\s+OR\s+IGNORE\s+INTO\s+player_challenge_participations\b/i);
    assert.doesNotMatch(operation.sql, forbiddenProtectedSurfacePattern());
    assert.doesNotMatch(operation.sql, /\bplayer_xp_ledger\b|\bplayer_calling_card_awards\b/i, "Player self-join must not self-award XP or calling cards.");
  }
}

function assertFunctionDoesNotMention(source: string, functionName: string, pattern: RegExp) {
  const block = functionBlock(source, functionName);
  assert.notEqual(block, "", `${functionName} should exist.`);
  assert.doesNotMatch(block, pattern, `${functionName} must not consume player progression state.`);
}

function functionBlock(source: string, functionName: string) {
  const start = source.indexOf(`function ${functionName}`);
  if (start < 0) return "";
  const firstBrace = source.indexOf("{", start);
  if (firstBrace < 0) return "";
  let depth = 0;
  for (let index = firstBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

function forbiddenProtectedSurfacePattern() {
  return /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bplayer_saved_servers\b|\bserver_owners\b|\bserver_rankings\b|\bleaderboards\b|\bdiscovery_score\b|\bserver_reviews\b|\bserver_review_reports\b|\bserver_review_moderation_actions\b|\bcompetitive_events\b|\bevent_matchups\b|\bevent_participants\b|\bevent_score_snapshots\b|\bserver_war_challenges\b|\bserver_war_events\b|\bserver_war_score_snapshots\b|\bdzn_seasons\b|\bserver_badge_awards\b|\bbadge_unlock_progress\b|\bbadges\b|\bplayer_profiles\b|\bkill_events\b|\bplayer_events\b|\bnitrado\b|\bdiscord_oauth_tokens\b|\bdiscord_guilds\b|\bstripe\b/i;
}

function stripSqlComments(source: string) {
  return source.replace(/--.*$/gm, "");
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}
