import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequest as playerReviewsHandler } from "../functions/api/player/reviews";
import { onRequest as ownerReplyHandler } from "../functions/api/servers/[serverId]/reviews/[reviewId]/reply";
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
  const playerReviewsSource = read("functions/api/player/reviews.ts");
  for (const snippet of [
    "getRequestSessionUser",
    "POST",
    "server_reviews",
    "recordReviewModerationAction",
    "viewerReviewState",
    "listing_visibility",
  ]) {
    assert.equal(playerReviewsSource.includes(snippet), true, `Player reviews API must include ${snippet}`);
  }
  assert.doesNotMatch(playerReviewsSource, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(playerReviewsSource, /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bstripe\b|\bcreateCheckoutSession\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i);
  assert.doesNotMatch(playerReviewsSource, /\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bstoreGuilds\b|\bcanManageDiscordGuild\b/);
  assertSourceMutationScope(playerReviewsSource, allowedReviewMutationPattern());

  const ownerReplySource = read("functions/api/servers/[serverId]/reviews/[reviewId]/reply.ts");
  for (const snippet of [
    "requireServerOwnerOrDznAdmin",
    "validateOwnerReplyInput",
    "owner_reply_body",
    "owner_reply_author_user_id",
    "owner_reply_upserted",
    "owner_reply_removed",
    "recordReviewModerationAction",
  ]) {
    assert.equal(ownerReplySource.includes(snippet), true, `Owner reply API must include ${snippet}`);
  }
  assert.doesNotMatch(ownerReplySource, /\bcreateCheckoutSession\b|\bstripe\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i);
  assertSourceMutationScope(ownerReplySource, allowedReviewMutationPattern());

  const serverManagementMiddleware = read("functions/api/servers/[serverId]/_middleware.ts");
  assert.equal(serverManagementMiddleware.includes("requireOwnerRequestAccess"), true, "Server-management review replies must stay behind canonical owner entitlement middleware.");

  const publicNetworkSource = read("components/network/public-network.tsx");
  assert.equal(publicNetworkSource.includes('fetch("/api/player/reviews"'), true, "Public profile review form must use the free player review endpoint.");
  assert.equal(publicNetworkSource.includes("linked_server_id: server.linked_server_id"), true, "Review submit must target the current public server.");
  assert.equal(publicNetworkSource.includes("Owner reply"), true, "Public profile should render owner replies.");
  assert.equal(publicNetworkSource.includes("owner_reply_author_user_id"), false, "Public UI must not expose owner reply author user ids.");
  assert.equal(publicNetworkSource.includes("/api/servers/${encodeURIComponent(server.linked_server_id)}/reviews"), false, "Player review form must not post through owner-gated server-management API.");

  const publicReviewsSource = read("functions/api/public/server-reviews.ts");
  assert.equal(publicReviewsSource.includes("applyServerReviewsAccess"), true);
  assert.equal(publicReviewsSource.includes("reviewer_discord_id"), false, "Public review API source should avoid returning reviewer Discord IDs directly.");

  const reportSource = read("functions/api/public/server-reviews/[reviewId]/report.ts");
  assert.equal(reportSource.includes("review_reported"), true, "Review report route should record moderation action.");
  assert.equal(reportSource.includes("review_auto_pending"), true, "Report threshold should create an auto-pending moderation hook.");
  assertSourceMutationScope(reportSource, allowedReviewMutationPattern());

  const reviewsHelperSource = read("functions/_lib/server-reviews.ts");
  for (const snippet of [
    "server_review_moderation_actions",
    "owner_reply_body",
    "PublicOwnerReviewReply",
    "recordReviewModerationAction",
    "owner_reply_author_user_id",
    "PRAGMA table_info(server_reviews)",
  ]) {
    assert.equal(reviewsHelperSource.includes(snippet), true, `Review helper must include ${snippet}`);
  }
  assert.equal(reviewsHelperSource.includes("owner_reply_author_user_id: row"), false, "Public review serializer must not expose owner reply author user IDs.");

  const migration = stripSqlComments(read("migrations/0061_reviews_foundation.sql"));
  assert.equal(migration.includes("ALTER TABLE server_reviews ADD COLUMN owner_reply_body"), true);
  assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS server_review_moderation_actions"), true);
  assert.doesNotMatch(migration, protectedSurfacePattern(), "Reviews migration must not touch protected competitive/billing surfaces.");

  const publicServersApiSource = read("functions/api/public/servers.ts");
  assertFunctionDoesNotMention(publicServersApiSource, "sortPublicServersForDiscovery", /server_reviews|review_count|average_rating|rating/i);
  assertFunctionDoesNotMention(publicServersApiSource, "applyPublicServerAccess", /server_reviews/i);

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  assert.equal(platformSpec.includes("Reviews Foundation Slice"), true, "Master spec must document the reviews foundation slice.");
  assert.equal(platformSpec.includes("`/api/player/reviews`"), true, "Master spec must list free player review submission.");
  assert.equal(platformSpec.includes("reviews remain separate from paid plans"), true, "Master spec must record review fairness boundary.");

  const publicAccessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  assert.equal(publicAccessPolicy.includes("`/api/player/reviews`"), true, "Public access policy must include free player review endpoint.");
  assert.equal(publicAccessPolicy.includes("Review submission must not affect rankings"), true, "Public access policy must record review fairness boundary.");

  const handoff = read("docs/REVIEWS_FOUNDATION_HANDOFF.md");
  assert.equal(handoff.includes("free logged-in player feature"), true);
  assert.equal(handoff.includes("Production merge/deploy/migration application: not included."), true);

  const unauthenticated = await callPlayerReviews("POST", {} as Env, reviewBody());
  assert.equal(unauthenticated.status, 401);

  const playerDb = createFakeReviewDb();
  const playerResponse = await callPlayerReviews("POST", { MOCK_AUTH: "true", DB: playerDb.db } as Env, reviewBody());
  assert.equal(playerResponse.status, 200);
  const playerJson = await playerResponse.json() as { ok?: boolean; review_count?: number; reviews?: unknown[] };
  assert.equal(playerJson.ok, true);
  assert.equal(playerJson.review_count, 1);
  assert.equal(playerDb.operations.some((op) => normalizeSql(op.sql).includes("INSERT INTO server_reviews")), true);
  assert.equal(playerDb.operations.some((op) => normalizeSql(op.sql).includes("INSERT INTO server_review_moderation_actions")), true);
  assertReviewOperationsStayIsolated(playerDb.operations);

  const replyDb = createFakeReviewDb();
  const replyResponse = await callOwnerReply("PUT", { MOCK_AUTH: "true", DB: replyDb.db } as Env, { body: "Thanks for the detailed feedback. We adjusted the rules page." });
  assert.equal(replyResponse.status, 200);
  const replyJson = await replyResponse.json() as { ok?: boolean; review_id?: string };
  assert.equal(replyJson.ok, true);
  assert.equal(replyJson.review_id, "review-123");
  assert.equal(replyDb.operations.some((op) => normalizeSql(op.sql).includes("UPDATE server_reviews SET owner_reply_body")), true);
  assert.equal(replyDb.operations.some((op) => normalizeSql(op.sql).includes("INSERT INTO server_review_moderation_actions")), true);
  assertReviewOperationsStayIsolated(replyDb.operations);

  const deleteReplyDb = createFakeReviewDb();
  const deleteReplyResponse = await callOwnerReply("DELETE", { MOCK_AUTH: "true", DB: deleteReplyDb.db } as Env);
  assert.equal(deleteReplyResponse.status, 200);
  assert.equal(deleteReplyDb.operations.some((op) => normalizeSql(op.sql).includes("owner_reply_body = NULL")), true);
  assertReviewOperationsStayIsolated(deleteReplyDb.operations);

  console.log("Reviews foundation tests passed.");
}

async function callPlayerReviews(method: string, env: Env, body?: unknown) {
  return playerReviewsHandler({
    request: new Request("https://dzn.example/api/player/reviews", {
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

async function callOwnerReply(method: string, env: Env, body?: unknown) {
  return ownerReplyHandler({
    request: new Request("https://dzn.example/api/servers/linked-1/reviews/review-123/reply", {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    params: { serverId: "linked-1", reviewId: "review-123" },
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Promise<Response>;
}

function createFakeReviewDb() {
  const operations: FakeOperation[] = [];
  const state = {
    reviewInserted: false,
    ownerReply: null as string | null,
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

function statement(sql: string, bindings: unknown[], operations: FakeOperation[], state: { reviewInserted: boolean; ownerReply: string | null }) {
  return {
    async all<T>() {
      operations.push({ kind: "all", sql, bindings });
      if (/FROM\s+server_reviews/i.test(sql)) {
        return {
          results: state.reviewInserted ? [reviewRow({ ownerReply: state.ownerReply })] : [],
        } as { results: T[] };
      }
      return { results: [] as T[] };
    },
    async first<T>() {
      operations.push({ kind: "first", sql, bindings });
      if (/FROM\s+linked_servers/i.test(sql)) {
        return { id: "linked-1", user_id: "owner-user", guild_id: null } as T;
      }
      if (/FROM\s+server_reviews/i.test(sql) && /WHERE id = \?/i.test(sql)) {
        return { id: "review-123", linked_server_id: "linked-1", report_count: 2 } as T;
      }
      if (/FROM\s+server_reviews/i.test(sql) && state.reviewInserted) {
        return reviewRow({ ownerReply: state.ownerReply }) as T;
      }
      return null;
    },
    async run() {
      operations.push({ kind: "run", sql, bindings });
      if (/INSERT\s+INTO\s+server_reviews/i.test(sql)) state.reviewInserted = true;
      if (/UPDATE\s+server_reviews\s+SET\s+owner_reply_body/i.test(sql)) {
        state.ownerReply = String(bindings[0] ?? "");
        state.reviewInserted = true;
      }
      if (/owner_reply_body\s+=\s+NULL/i.test(sql)) state.ownerReply = null;
      return { success: true };
    },
  };
}

function reviewBody() {
  return {
    linked_server_id: "linked-1",
    rating: 5,
    title: "Great community",
    body: "Clean events, active staff, and a strong competitive DayZ community.",
  };
}

function reviewRow(options: { ownerReply?: string | null }) {
  return {
    id: "review-123",
    linked_server_id: "linked-1",
    reviewer_discord_id: "mock-discord-user",
    reviewer_name: "Reviewer",
    reviewer_avatar_url: null,
    rating: 5,
    title: "Great community",
    body: "Clean events, active staff, and a strong competitive DayZ community.",
    status: "approved",
    moderation_reason: null,
    report_count: 0,
    owner_reply_body: options.ownerReply ?? null,
    owner_reply_author_user_id: options.ownerReply ? "owner-user" : null,
    owner_reply_author_name: options.ownerReply ? "Server Owner" : null,
    owner_reply_created_at: options.ownerReply ? "2026-08-25T10:00:00.000Z" : null,
    owner_reply_updated_at: options.ownerReply ? "2026-08-25T10:05:00.000Z" : null,
    created_at: "2026-08-25T09:00:00.000Z",
    updated_at: "2026-08-25T09:00:00.000Z",
    last_edited_at: null,
  };
}

function assertSourceMutationScope(source: string, allowedPattern: RegExp) {
  const sqlTemplates = source.match(/`[\s\S]*?`|"[^"\n]*(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)[^"\n]*"/g) ?? [];
  for (const template of sqlTemplates) {
    if (!/\b(?:INSERT\s+INTO|UPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+SET|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE)\b/i.test(template)) continue;
    assert.match(template, allowedPattern, `Unexpected review mutation SQL: ${template}`);
    assert.doesNotMatch(template, protectedSurfacePattern());
  }
}

function assertReviewOperationsStayIsolated(operations: FakeOperation[]) {
  for (const operation of operations.filter((op) => op.kind === "run")) {
    assert.doesNotMatch(operation.sql, protectedSurfacePattern());
    if (/\b(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\b/i.test(operation.sql)) {
      assert.match(operation.sql, allowedReviewMutationPattern(), `Unexpected mutation target: ${operation.sql}`);
    }
  }
}

function allowedReviewMutationPattern() {
  return /\bserver_reviews\b|\bserver_review_reports\b|\bserver_review_moderation_actions\b/i;
}

function protectedSurfacePattern() {
  return /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bplayer_saved_servers\b|\bserver_owners\b|\bserver_rankings\b|\bleaderboards\b|\bdiscovery_score\b|\bplayer_profiles\b|\bkill_events\b|\bplayer_events\b|\bevents\b|\bcompetitive_events\b|\bserver_war_events\b|\bserver_war_score_snapshots\b|\bdzn_seasons\b|\bserver_badge_awards\b|\bbadges\b|\bchallenge\b|\bXP\b/i;
}

function assertFunctionDoesNotMention(source: string, functionName: string, pattern: RegExp) {
  const block = functionBlock(source, functionName);
  assert.notEqual(block, "", `${functionName} should exist.`);
  assert.doesNotMatch(block, pattern, `${functionName} must not consume review state.`);
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

function stripSqlComments(source: string) {
  return source.replace(/--.*$/gm, "");
}

function normalizeSql(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}
