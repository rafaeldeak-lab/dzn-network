import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MOCK_USER_ID } from "../functions/_lib/db";
import { onRequest as moderationQueueHandler } from "../functions/api/reviews/moderation";
import { onRequest as moderationActionHandler } from "../functions/api/reviews/moderation/[reviewId]";
import type { Env, PagesContext } from "../functions/_lib/types";

type FakeOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

type FakeReview = {
  id: string;
  linked_server_id: string;
  reviewer_discord_id: string;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: string;
  moderation_reason: string | null;
  report_count: number;
  owner_reply_body: string | null;
  owner_reply_author_user_id: string | null;
  owner_reply_author_name: string | null;
  owner_reply_created_at: string | null;
  owner_reply_updated_at: string | null;
  created_at: string;
  updated_at: string;
  last_edited_at: string | null;
  owner_user_id: string | null;
  public_slug: string | null;
  server_name: string;
  latest_report_reason: string | null;
  latest_report_at: string | null;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const helperSource = read("functions/_lib/review-moderation-dashboard.ts");
  for (const snippet of [
    "requireActiveOwnerEntitlement",
    "isDznAdminDiscordId",
    "listReviewModerationQueue",
    "moderateReviewFromDashboard",
    "notifyReviewModerationOwner",
    "recordReviewModerationAction",
    "createNotification",
    "UPDATE server_reviews SET status = 'approved'",
    "owner_reply_body",
  ]) {
    assert.equal(helperSource.includes(snippet), true, `Moderation helper must include ${snippet}`);
  }
  assert.doesNotMatch(helperSource, /\brequirePlatformOwner\b|\bDZN_LIVE_CHECKOUT_ENABLED\b|\bcreateCheckoutSession\b|\bstripe\b/i);
  assert.doesNotMatch(helperSource, /\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bdispatchPulseDiscordNotification\b/i);
  assertSourceMutationScope(helperSource, allowedModerationMutationPattern());

  const queueRouteSource = read("functions/api/reviews/moderation.ts");
  assert.equal(queueRouteSource.includes("authorizeReviewModerationRequest"), true);
  assert.equal(queueRouteSource.includes("listReviewModerationQueue"), true);
  assert.equal(queueRouteSource.includes("privateNoStoreHeaders"), true);
  assert.doesNotMatch(queueRouteSource, /\brequirePlatformOwner\b|\bcreateCheckoutSession\b|\bstripe\b/i);

  const actionRouteSource = read("functions/api/reviews/moderation/[reviewId].ts");
  assert.equal(actionRouteSource.includes("readBoundedJson"), true);
  assert.equal(actionRouteSource.includes("moderateReviewFromDashboard"), true);
  assert.equal(actionRouteSource.includes("4096"), true);
  assert.doesNotMatch(actionRouteSource, /\breadJson\b|\brequirePlatformOwner\b|\bcreateCheckoutSession\b|\bstripe\b/i);

  const reportRouteSource = read("functions/api/public/server-reviews/[reviewId]/report.ts");
  assert.equal(reportRouteSource.includes("notifyReviewModerationOwner"), true);
  assert.equal(reportRouteSource.includes("review_auto_pending"), true);
  assert.equal(reportRouteSource.includes("INNER JOIN linked_servers"), true);
  assert.doesNotMatch(reportRouteSource, /\bdispatchPulseDiscordNotification\b|\bDISCORD_BOT_TOKEN\b/i);

  const dashboardSource = read("components/reviews/review-moderation-dashboard.tsx");
  for (const snippet of [
    "/api/reviews/moderation",
    "Approve",
    "Hold",
    "Dismiss",
    "Remove",
    "Owner reply",
    "Review ratings remain player feedback only",
  ]) {
    assert.equal(dashboardSource.includes(snippet), true, `Dashboard UI must include ${snippet}`);
  }

  const ownerConsoleSource = read("components/owner/owner-console.tsx");
  assert.equal(ownerConsoleSource.includes("Review Control"), true);
  assert.equal(ownerConsoleSource.includes("/owner/reviews"), true);

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  assert.equal(platformSpec.includes("Reviews Moderation Dashboard Slice"), true, "Master spec must document this dashboard slice.");
  assert.equal(platformSpec.includes("`/api/reviews/moderation`"), true, "Master spec must list the moderation queue API.");
  assert.equal(platformSpec.includes("reviews remain separate from paid plans"), true, "Master spec must preserve review fairness.");

  const publicAccessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  assert.equal(publicAccessPolicy.includes("`/api/reviews/moderation`"), true, "Public access policy must include moderation queue boundary.");
  assert.equal(publicAccessPolicy.includes("must not change ratings, rankings, discovery score"), true, "Public access policy must record moderation fairness.");

  const handoff = read("docs/REVIEWS_MODERATION_DASHBOARD_HANDOFF.md");
  assert.equal(handoff.includes("Production merge/deploy/migration application: not included."), true);
  assert.equal(handoff.includes("No Stripe, Cloudflare, production D1, Nitrado, Discord, or issue #49 mutation is included."), true);

  const unauthenticated = await callQueue("GET", {} as Env);
  assert.equal(unauthenticated.status, 401);

  const ownerDb = createFakeModerationDb({ ownerUserId: MOCK_USER_ID });
  const ownerQueue = await callQueue("GET", { MOCK_AUTH: "true", DB: ownerDb.db } as Env);
  assert.equal(ownerQueue.status, 200);
  const ownerQueueJson = await ownerQueue.json() as QueueResponse;
  assert.equal(ownerQueueJson.ok, true);
  assert.equal(ownerQueueJson.role, "owner");
  assert.equal(ownerQueueJson.items[0].id, "review-123");
  assert.equal(ownerDb.operations.some((operation) => operation.kind === "run" && /user_notifications/i.test(operation.sql)), false, "Queue reads must not create notifications.");

  const replyDb = createFakeModerationDb({ ownerUserId: MOCK_USER_ID });
  const replyResponse = await callAction("POST", { MOCK_AUTH: "true", DB: replyDb.db } as Env, {
    action: "reply",
    body: "Thanks for the detailed feedback. We have fixed the spawn rules page.",
  });
  assert.equal(replyResponse.status, 200);
  assert.equal(replyDb.operations.some((operation) => normalizeSql(operation.sql).includes("UPDATE server_reviews SET owner_reply_body")), true);
  assert.equal(replyDb.operations.some((operation) => normalizeSql(operation.sql).includes("INSERT INTO server_review_moderation_actions")), true);
  assert.equal(replyDb.operations.some((operation) => /user_notifications/i.test(operation.sql)), false, "Owner self-actions should not create admin notification rows.");
  assertModerationOperationsStayIsolated(replyDb.operations);

  const forbiddenDb = createFakeModerationDb({ ownerUserId: "different-owner" });
  const forbiddenResponse = await callAction("POST", { MOCK_AUTH: "true", DB: forbiddenDb.db } as Env, { action: "approve" });
  assert.equal(forbiddenResponse.status, 403);
  assert.equal(forbiddenDb.operations.some((operation) => normalizeSql(operation.sql).includes("UPDATE server_reviews")), false, "Cross-owner actions must not mutate reviews.");

  const adminDb = createFakeModerationDb({ ownerUserId: "server-owner" });
  const adminResponse = await callAction("POST", {
    MOCK_AUTH: "true",
    DZN_ADMIN_DISCORD_IDS: "mock-discord-user",
    DZN_PULSE_ENABLED: "true",
    DB: adminDb.db,
  } as Env, {
    action: "approve",
    reason: "Report reviewed by DZN moderation.",
  });
  assert.equal(adminResponse.status, 200);
  assert.equal(adminDb.operations.some((operation) => normalizeSql(operation.sql).includes("UPDATE server_reviews SET status = 'approved'")), true);
  assert.equal(adminDb.operations.some((operation) => normalizeSql(operation.sql).includes("INSERT INTO server_review_moderation_actions")), true);
  assert.equal(adminDb.operations.some((operation) => normalizeSql(operation.sql).includes("INSERT OR IGNORE INTO user_notifications")), true);
  assertModerationOperationsStayIsolated(adminDb.operations);

  console.log("Reviews moderation dashboard tests passed.");
}

type QueueResponse = {
  ok?: boolean;
  role?: string;
  items: Array<{ id: string }>;
};

async function callQueue(method: string, env: Env) {
  return moderationQueueHandler({
    request: new Request("https://dzn.example/api/reviews/moderation?status=needs_review", { method }),
    env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Promise<Response>;
}

async function callAction(method: string, env: Env, body: unknown) {
  return moderationActionHandler({
    request: new Request("https://dzn.example/api/reviews/moderation/review-123", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    params: { reviewId: "review-123" },
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Promise<Response>;
}

function createFakeModerationDb(options: { ownerUserId: string }) {
  const operations: FakeOperation[] = [];
  const review = reviewRow(options);

  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return statement(sql, bindings, operations, review);
        },
        ...statement(sql, [], operations, review),
      };
    },
  };

  return { db: db as unknown as Env["DB"], operations, review };
}

function statement(sql: string, bindings: unknown[], operations: FakeOperation[], review: FakeReview) {
  return {
    async all<T>() {
      operations.push({ kind: "all", sql, bindings });
      if (/PRAGMA\s+table_info\(server_reviews\)/i.test(sql)) {
        return { results: reviewColumns().map((name) => ({ name })) as T[] };
      }
      if (/FROM\s+server_reviews/i.test(sql) && /INNER\s+JOIN\s+linked_servers/i.test(sql)) {
        return { results: [review] as T[] };
      }
      return { results: [] as T[] };
    },
    async first<T>() {
      operations.push({ kind: "first", sql, bindings });
      if (/FROM\s+server_reviews/i.test(sql) && /INNER\s+JOIN\s+linked_servers/i.test(sql)) {
        return review as T;
      }
      return null;
    },
    async run() {
      operations.push({ kind: "run", sql, bindings });
      const normalized = normalizeSql(sql);
      if (normalized.includes("UPDATE server_reviews SET status = 'approved'")) {
        review.status = "approved";
        review.report_count = 0;
        review.moderation_reason = String(bindings[0] ?? "") || null;
      }
      if (normalized.includes("UPDATE server_reviews SET status = 'pending'")) {
        review.status = "pending";
        review.moderation_reason = String(bindings[0] ?? "") || null;
      }
      if (normalized.includes("UPDATE server_reviews SET status = 'deleted'")) {
        review.status = "deleted";
        review.moderation_reason = String(bindings[0] ?? "") || null;
      }
      if (normalized.includes("UPDATE server_reviews SET owner_reply_body")) {
        review.owner_reply_body = String(bindings[0] ?? "");
        review.owner_reply_author_user_id = String(bindings[1] ?? "");
        review.owner_reply_author_name = String(bindings[2] ?? "");
      }
      if (normalized.includes("owner_reply_body = NULL")) {
        review.owner_reply_body = null;
        review.owner_reply_author_user_id = null;
        review.owner_reply_author_name = null;
      }
      return { success: true, meta: { changes: 1 } };
    },
  };
}

function reviewRow(options: { ownerUserId: string }): FakeReview {
  return {
    id: "review-123",
    linked_server_id: "linked-1",
    reviewer_discord_id: "reviewer-discord",
    reviewer_name: "DZN Player",
    reviewer_avatar_url: null,
    rating: 4,
    title: "Good server",
    body: "Strong staff presence and clean events. The queue needs clearer rules.",
    status: "pending",
    moderation_reason: "Report threshold reached.",
    report_count: 3,
    owner_reply_body: null,
    owner_reply_author_user_id: null,
    owner_reply_author_name: null,
    owner_reply_created_at: null,
    owner_reply_updated_at: null,
    created_at: "2026-08-25T10:00:00.000Z",
    updated_at: "2026-08-25T11:00:00.000Z",
    last_edited_at: null,
    owner_user_id: options.ownerUserId,
    public_slug: "server-one",
    server_name: "Server One",
    latest_report_reason: "Abusive language",
    latest_report_at: "2026-08-25T11:00:00.000Z",
  };
}

function reviewColumns() {
  return [
    "id",
    "linked_server_id",
    "reviewer_discord_id",
    "reviewer_name",
    "reviewer_avatar_url",
    "rating",
    "title",
    "body",
    "status",
    "moderation_reason",
    "report_count",
    "owner_reply_body",
    "owner_reply_author_user_id",
    "owner_reply_author_name",
    "owner_reply_created_at",
    "owner_reply_updated_at",
    "created_at",
    "updated_at",
    "last_edited_at",
  ];
}

function assertSourceMutationScope(source: string, allowedPattern: RegExp) {
  const sqlTemplates = source.match(/`[\s\S]*?`|"[^"\n]*(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)[^"\n]*"/g) ?? [];
  for (const template of sqlTemplates) {
    if (!/\b(?:INSERT\s+INTO|UPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+SET|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE)\b/i.test(template)) continue;
    assert.match(template, allowedPattern, `Unexpected moderation mutation SQL: ${template}`);
    assert.doesNotMatch(template, protectedSurfacePattern());
  }
}

function assertModerationOperationsStayIsolated(operations: FakeOperation[]) {
  for (const operation of operations.filter((op) => op.kind === "run")) {
    assert.doesNotMatch(operation.sql, protectedSurfacePattern());
    if (/\b(?:INSERT INTO|INSERT OR IGNORE INTO|UPDATE|DELETE FROM|ALTER TABLE)\b/i.test(operation.sql)) {
      assert.match(operation.sql, allowedModerationMutationPattern(), `Unexpected mutation target: ${operation.sql}`);
    }
  }
}

function allowedModerationMutationPattern() {
  return /\bserver_reviews\b|\bserver_review_reports\b|\bserver_review_moderation_actions\b|\buser_notifications\b/i;
}

function protectedSurfacePattern() {
  return /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bplayer_saved_servers\b|\bserver_owners\b|\bserver_rankings\b|\bleaderboards\b|\bdiscovery_score\b|\bplayer_profiles\b|\bkill_events\b|\bplayer_events\b|\bevents\b|\bcompetitive_events\b|\bserver_war_events\b|\bserver_war_score_snapshots\b|\bdzn_seasons\b|\bserver_badge_awards\b|\bbadges\b|\bchallenge\b|\bXP\b|\bstripe\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i;
}

function normalizeSql(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}
