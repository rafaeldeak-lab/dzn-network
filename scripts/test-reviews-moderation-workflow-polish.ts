import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MOCK_USER_ID } from "../functions/_lib/db";
import { onRequest as moderationQueueHandler } from "../functions/api/reviews/moderation";
import { onRequest as moderationActionHandler } from "../functions/api/reviews/moderation/[reviewId]";
import { onRequest as bulkModerationHandler } from "../functions/api/reviews/moderation/bulk";
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

type FakeHistory = {
  review_id: string;
  actor_role: string;
  action: string;
  reason: string | null;
  created_at: string;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertSourceContracts();

  const ownerDb = createFakeModerationPolishDb({
    pulseUnread: 4,
    reviewNotificationUnread: 2,
  });
  const ownerQueue = await callQueue({
    MOCK_AUTH: "true",
    DZN_PULSE_ENABLED: "true",
    DB: ownerDb.db,
  } as Env);
  assert.equal(ownerQueue.status, 200);
  const ownerPayload = await ownerQueue.json() as QueuePayload;
  assert.equal(ownerPayload.ok, true);
  assert.equal(ownerPayload.role, "owner");
  assert.equal(ownerPayload.counts.needs_review, 2);
  assert.equal(ownerPayload.counts.reported, 2);
  assert.equal(ownerPayload.notification_counts.unread_total, 4);
  assert.equal(ownerPayload.notification_counts.review_notifications, 2);
  assert.equal(ownerPayload.notification_counts.review_queue, 2);
  assert.equal(ownerPayload.report_patterns.length, 0, "Owners must not receive admin bulk pattern controls.");
  assert.equal(ownerPayload.items[0].status_history.length > 0, true, "Queue items should include safe status history.");
  assert.equal(JSON.stringify(ownerPayload).includes("actor_user_id"), false, "Status history must not expose actor user IDs.");
  assert.equal(JSON.stringify(ownerPayload).includes("actor_discord_id"), false, "Status history must not expose actor Discord IDs.");
  assert.equal(ownerDb.operations.some((operation) => operation.kind === "run" && /user_notifications/i.test(operation.sql)), false, "Queue badge reads must not create notifications.");

  const crossOwnerDb = createFakeModerationPolishDb();
  crossOwnerDb.reviews.find((review) => review.id === "review-123")!.owner_user_id = "different-owner";
  const crossOwnerResponse = await callAction({
    MOCK_AUTH: "true",
    DB: crossOwnerDb.db,
  } as Env, { action: "remove", reason: "Owner should not be allowed across servers." });
  assert.equal(crossOwnerResponse.status, 403, "Cross-owner review moderation must be denied.");
  assert.equal(crossOwnerDb.operations.some((operation) => normalizeSql(operation.sql).includes("UPDATE server_reviews")), false, "Cross-owner denial must not update reviews.");

  const ownerBulkDb = createFakeModerationPolishDb();
  const ownerBulkResponse = await callBulk({
    MOCK_AUTH: "true",
    DB: ownerBulkDb.db,
  } as Env, {
    action: "dismiss_reports",
    pattern_key: "abusive language",
    reason: "Owner sessions cannot bulk triage repeated patterns.",
  });
  assert.equal(ownerBulkResponse.status, 403, "Bulk triage must be admin-only.");
  assert.equal(ownerBulkDb.operations.some((operation) => normalizeSql(operation.sql).includes("UPDATE server_reviews")), false, "Owner bulk denial must not update reviews.");

  const adminQueueDb = createFakeModerationPolishDb();
  const adminQueue = await callQueue({
    MOCK_AUTH: "true",
    DZN_ADMIN_DISCORD_IDS: "mock-discord-user",
    DB: adminQueueDb.db,
  } as Env);
  const adminPayload = await adminQueue.json() as QueuePayload;
  assert.equal(adminPayload.role, "admin");
  assert.equal(adminPayload.report_patterns.length, 1, "Admins should receive repeated report patterns.");
  assert.equal(adminPayload.report_patterns[0].pattern_key, "abusive language");
  assert.equal(adminPayload.report_patterns[0].review_count, 2);

  const notRepeatedDb = createFakeModerationPolishDb();
  const notRepeatedResponse = await callBulk({
    MOCK_AUTH: "true",
    DZN_ADMIN_DISCORD_IDS: "mock-discord-user",
    DB: notRepeatedDb.db,
  } as Env, {
    action: "dismiss_reports",
    pattern_key: "single bad report",
    reason: "Not repeated.",
  });
  assert.equal(notRepeatedResponse.status, 400);
  assert.equal(notRepeatedDb.operations.some((operation) => normalizeSql(operation.sql).includes("UPDATE server_reviews")), false, "Non-repeated patterns must not mutate reviews.");

  const adminBulkDb = createFakeModerationPolishDb({
    pulseUnread: 3,
    reviewNotificationUnread: 1,
  });
  const adminBulkResponse = await callBulk({
    MOCK_AUTH: "true",
    DZN_ADMIN_DISCORD_IDS: "mock-discord-user",
    DZN_PULSE_ENABLED: "true",
    DB: adminBulkDb.db,
  } as Env, {
    action: "dismiss_reports",
    pattern_key: "abusive language",
    reason: "Repeated false-positive report wave cleared.",
    limit: 25,
  });
  assert.equal(adminBulkResponse.status, 200);
  const adminBulkPayload = await adminBulkResponse.json() as { ok: boolean; updated_count: number; review_ids: string[] };
  assert.equal(adminBulkPayload.ok, true);
  assert.equal(adminBulkPayload.updated_count, 2);
  assert.deepEqual(adminBulkPayload.review_ids.sort(), ["review-123", "review-456"]);
  assert.equal(adminBulkDb.reviews.find((review) => review.id === "review-123")?.report_count, 0);
  assert.equal(adminBulkDb.reviews.find((review) => review.id === "review-456")?.status, "approved");
  assert.equal(adminBulkDb.operations.filter((operation) => normalizeSql(operation.sql).includes("UPDATE server_reviews SET status = 'approved'")).length, 2);
  assert.equal(adminBulkDb.operations.filter((operation) => normalizeSql(operation.sql).includes("INSERT INTO server_review_moderation_actions")).length >= 2, true);
  assert.equal(adminBulkDb.operations.filter((operation) => normalizeSql(operation.sql).includes("INSERT OR IGNORE INTO user_notifications")).length >= 1, true);
  assertModerationOperationsStayIsolated(adminBulkDb.operations);

  console.log("Reviews moderation workflow polish tests passed.");
}

type QueuePayload = {
  ok: boolean;
  role: "owner" | "admin";
  counts: {
    needs_review: number;
    reported: number;
  };
  notification_counts: {
    unread_total: number;
    review_notifications: number;
    review_queue: number;
  };
  report_patterns: Array<{ pattern_key: string; review_count: number }>;
  items: Array<{ id: string; status_history: unknown[] }>;
};

function assertSourceContracts() {
  const helperSource = read("functions/_lib/review-moderation-dashboard.ts");
  for (const snippet of [
    "countUnreadNotifications",
    "notification_counts",
    "status_history",
    "readRepeatedReportPatterns",
    "bulkModerateRepeatedReports",
    "ADMIN_ONLY_BULK_TRIAGE",
    "REPORT_PATTERN_NOT_REPEATED",
    "server_review_moderation_actions",
  ]) {
    assert.equal(helperSource.includes(snippet), true, `Moderation helper must include ${snippet}.`);
  }
  assert.doesNotMatch(helperSource, /\brequirePlatformOwner\b|\bDZN_LIVE_CHECKOUT_ENABLED\b|\bcreateCheckoutSession\b|\bstripe\b/i);
  assert.doesNotMatch(helperSource, /\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bdispatchPulseDiscordNotification\b/i);
  assertSourceMutationScope(helperSource, allowedModerationMutationPattern());

  const bulkRouteSource = read("functions/api/reviews/moderation/bulk.ts");
  assert.equal(bulkRouteSource.includes("authorizeReviewModerationRequest"), true);
  assert.equal(bulkRouteSource.includes("bulkModerateRepeatedReports"), true);
  assert.equal(bulkRouteSource.includes("readBoundedJson"), true);
  assert.equal(bulkRouteSource.includes("privateNoStoreHeaders"), true);
  assert.doesNotMatch(bulkRouteSource, /\bstripe\b|\bcreateCheckoutSession\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b/i);

  const queueUiSource = read("components/reviews/review-moderation-dashboard.tsx");
  for (const snippet of [
    "Status history",
    "Admin bulk triage",
    "Repeated report patterns",
    "/api/reviews/moderation/bulk",
    "payload?.role === \"admin\"",
    "Unread Pulse",
    "Review alerts",
  ]) {
    assert.equal(queueUiSource.includes(snippet), true, `Moderation UI must include ${snippet}.`);
  }
  assert.equal(queueUiSource.includes("dangerouslySetInnerHTML"), false);

  const dashboardSource = read("components/onboarding/dashboard.tsx");
  for (const snippet of [
    "\"reviews\"",
    "Review queue",
    "/api/reviews/moderation?status=needs_review&limit=1",
    "queue alerts",
    "Open review queue",
    "They do not change rank, discovery score, badges, seasons, events, or billing.",
  ]) {
    assert.equal(dashboardSource.includes(snippet), true, `Owner dashboard UI must include ${snippet}.`);
  }

  const ownerConsoleSource = read("components/owner/owner-console.tsx");
  for (const snippet of [
    "reviewSummary={reviewControlSummary}",
    "Queue alerts",
    "Unread Pulse",
    "Review notifications",
    "Admin report patterns",
    "ownerReviewBadgeCount",
  ]) {
    assert.equal(ownerConsoleSource.includes(snippet), true, `Owner console UI must include ${snippet}.`);
  }
}

async function callQueue(env: Env) {
  return moderationQueueHandler({
    request: new Request("https://dzn.example/api/reviews/moderation?status=needs_review&limit=2", { method: "GET" }),
    env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Promise<Response>;
}

async function callAction(env: Env, body: unknown) {
  return moderationActionHandler({
    request: new Request("https://dzn.example/api/reviews/moderation/review-123", {
      method: "POST",
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

async function callBulk(env: Env, body: unknown) {
  return bulkModerationHandler({
    request: new Request("https://dzn.example/api/reviews/moderation/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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

function createFakeModerationPolishDb(options: { pulseUnread?: number; reviewNotificationUnread?: number } = {}) {
  const operations: FakeOperation[] = [];
  const reviews = [
    reviewRow("review-123", MOCK_USER_ID, "Server One", "abusive language", 3, "pending"),
    reviewRow("review-456", "other-owner", "Server Two", "abusive language", 4, "pending"),
    reviewRow("review-789", MOCK_USER_ID, "Server Three", "single bad report", 1, "approved"),
  ];
  const histories: FakeHistory[] = [
    { review_id: "review-123", actor_role: "player", action: "review_reported", reason: "Abusive language", created_at: "2026-08-25T10:10:00.000Z" },
    { review_id: "review-123", actor_role: "system", action: "review_auto_pending", reason: "Report threshold reached.", created_at: "2026-08-25T10:12:00.000Z" },
    { review_id: "review-456", actor_role: "player", action: "review_reported", reason: "Abusive language", created_at: "2026-08-25T10:20:00.000Z" },
  ];

  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return statement(sql, bindings, operations, reviews, histories, options);
        },
        ...statement(sql, [], operations, reviews, histories, options),
      };
    },
  };

  return { db: db as unknown as Env["DB"], operations, reviews };
}

function statement(
  sql: string,
  bindings: unknown[],
  operations: FakeOperation[],
  reviews: FakeReview[],
  histories: FakeHistory[],
  options: { pulseUnread?: number; reviewNotificationUnread?: number },
) {
  return {
    async all<T>() {
      operations.push({ kind: "all", sql, bindings });
      if (/PRAGMA\s+table_info\(server_reviews\)/i.test(sql)) {
        return { results: reviewColumns().map((name) => ({ name })) as T[] };
      }
      if (/FROM\s+server_review_moderation_actions/i.test(sql)) {
        const ids = new Set(bindings.slice(0, -1).map(String));
        return { results: histories.filter((entry) => ids.has(entry.review_id)) as T[] };
      }
      if (/FROM\s+server_review_reports/i.test(sql) && /GROUP BY pattern_key/i.test(sql)) {
        return { results: reportPatterns(reviews) as T[] };
      }
      if (/FROM\s+server_reviews/i.test(sql) && /INNER\s+JOIN\s+linked_servers/i.test(sql)) {
        if (/EXISTS\s*\(/i.test(sql)) {
          const minReportCount = Number(bindings[0] ?? 1);
          const patternKey = String(bindings[1] ?? "");
          return {
            results: reviews
              .filter((review) => review.status !== "deleted")
              .filter((review) => review.report_count >= minReportCount)
              .filter((review) => reportPatternKey(review.latest_report_reason) === patternKey) as T[],
          };
        }
        const ownerBinding = sql.includes("linked_servers.user_id = ?") ? String(bindings[0] ?? "") : null;
        return {
          results: reviews
            .filter((review) => review.status !== "deleted")
            .filter((review) => !ownerBinding || review.owner_user_id === ownerBinding)
            .filter((review) => review.status === "pending" || review.report_count > 0) as T[],
        };
      }
      return { results: [] as T[] };
    },
    async first<T>() {
      operations.push({ kind: "first", sql, bindings });
      if (/FROM\s+user_notifications/i.test(sql) && /action_url\s+LIKE/i.test(sql)) {
        return { count: options.reviewNotificationUnread ?? 0 } as T;
      }
      if (/FROM\s+user_notifications/i.test(sql)) {
        return { count: options.pulseUnread ?? 0 } as T;
      }
      if (/COUNT\(\*\)\s+AS\s+total/i.test(sql) && /FROM\s+server_reviews/i.test(sql)) {
        const ownerBinding = sql.includes("linked_servers.user_id = ?") ? String(bindings[0] ?? "") : null;
        return countRows(reviews.filter((review) => !ownerBinding || review.owner_user_id === ownerBinding)) as T;
      }
      if (/COUNT\(DISTINCT\s+server_reviews\.id\)\s+AS\s+review_count/i.test(sql) && /COUNT\(\*\)\s+AS\s+report_rows/i.test(sql)) {
        const patternKey = String(bindings[bindings.length - 1] ?? "");
        const matched = reviews.filter((review) => review.status !== "deleted" && review.report_count > 0 && reportPatternKey(review.latest_report_reason) === patternKey);
        return {
          review_count: matched.length,
          report_rows: matched.length,
          total_reports: matched.reduce((total, review) => total + review.report_count, 0),
        } as T;
      }
      if (/FROM\s+server_reviews/i.test(sql) && /INNER\s+JOIN\s+linked_servers/i.test(sql)) {
        const reviewId = String(bindings[0] ?? "");
        return (reviews.find((review) => review.id === reviewId) ?? null) as T | null;
      }
      return null;
    },
    async run() {
      operations.push({ kind: "run", sql, bindings });
      const normalized = normalizeSql(sql);
      if (normalized.includes("UPDATE server_reviews SET status = 'approved'")) {
        const review = reviews.find((item) => item.id === String(bindings[2] ?? ""));
        if (review) {
          review.status = "approved";
          review.report_count = 0;
          review.moderation_reason = String(bindings[0] ?? "") || null;
        }
      }
      if (normalized.includes("UPDATE server_reviews SET status = 'pending'")) {
        const review = reviews.find((item) => item.id === String(bindings[2] ?? ""));
        if (review) {
          review.status = "pending";
          review.moderation_reason = String(bindings[0] ?? "") || null;
        }
      }
      if (normalized.includes("UPDATE server_reviews SET status = 'deleted'")) {
        const review = reviews.find((item) => item.id === String(bindings[2] ?? ""));
        if (review) {
          review.status = "deleted";
          review.moderation_reason = String(bindings[0] ?? "") || null;
        }
      }
      return { success: true, meta: { changes: 1 } };
    },
  };
}

function reviewRow(id: string, ownerUserId: string, serverName: string, reportReason: string, reportCount: number, status: string): FakeReview {
  return {
    id,
    linked_server_id: `${id}-server`,
    reviewer_discord_id: `${id}-reviewer`,
    reviewer_name: "DZN Player",
    reviewer_avatar_url: null,
    rating: 4,
    title: "Queue test review",
    body: "Useful player feedback that must never affect paid plans or competitive systems.",
    status,
    moderation_reason: reportCount >= 3 ? "Report threshold reached." : null,
    report_count: reportCount,
    owner_reply_body: id === "review-789" ? "Thanks for the report." : null,
    owner_reply_author_user_id: ownerUserId,
    owner_reply_author_name: "DZN Owner",
    owner_reply_created_at: id === "review-789" ? "2026-08-25T09:00:00.000Z" : null,
    owner_reply_updated_at: id === "review-789" ? "2026-08-25T09:00:00.000Z" : null,
    created_at: "2026-08-25T08:00:00.000Z",
    updated_at: "2026-08-25T10:30:00.000Z",
    last_edited_at: null,
    owner_user_id: ownerUserId,
    public_slug: id,
    server_name: serverName,
    latest_report_reason: reportReason,
    latest_report_at: "2026-08-25T10:30:00.000Z",
  };
}

function reportPatterns(reviews: FakeReview[]) {
  const grouped = new Map<string, { pattern_key: string; reason: string; review_count: number; total_reports: number; latest_report_at: string | null }>();
  for (const review of reviews.filter((item) => item.status !== "deleted" && item.report_count > 0)) {
    const key = reportPatternKey(review.latest_report_reason);
    const current = grouped.get(key) ?? {
      pattern_key: key,
      reason: review.latest_report_reason || "No reason provided",
      review_count: 0,
      total_reports: 0,
      latest_report_at: review.latest_report_at,
    };
    current.review_count += 1;
    current.total_reports += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].filter((pattern) => pattern.review_count >= 2 || pattern.total_reports >= 3);
}

function reportPatternKey(value: string | null) {
  return value?.trim().toLowerCase() || "no_reason";
}

function countRows(rows: FakeReview[]) {
  const visible = rows.filter((review) => review.status !== "deleted");
  return {
    total: visible.length,
    needs_review: visible.filter((review) => review.status === "pending" || review.report_count > 0).length,
    pending: visible.filter((review) => review.status === "pending").length,
    reported: visible.filter((review) => review.report_count > 0).length,
    approved: visible.filter((review) => review.status === "approved").length,
    replied: visible.filter((review) => Boolean(review.owner_reply_body)).length,
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
  const sqlTemplates = source.match(/`[\s\S]*?`|"[^"\n]*(?:INSERT INTO|INSERT OR IGNORE INTO|UPDATE|DELETE FROM|ALTER TABLE)[^"\n]*"/g) ?? [];
  for (const template of sqlTemplates) {
    if (!/\b(?:INSERT\s+(?:OR\s+IGNORE\s+)?INTO|UPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+SET|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE)\b/i.test(template)) continue;
    assert.match(template, allowedPattern, `Unexpected moderation mutation SQL: ${template}`);
    assert.doesNotMatch(template, protectedSurfacePattern());
  }
}

function assertModerationOperationsStayIsolated(operations: FakeOperation[]) {
  for (const operation of operations.filter((item) => item.kind === "run")) {
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
