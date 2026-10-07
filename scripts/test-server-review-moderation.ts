import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { hmacSha256 } from "../functions/_lib/crypto";
import { countUnreadReviewNotifications } from "../functions/_lib/dzn-pulse";
import {
  applyBulkReviewModerationDecision,
  applyReviewModerationDecision,
  parseReviewModerationFilters,
  validateReviewModerationBulkInput,
  validateReviewModerationInput,
} from "../functions/_lib/server-review-moderation";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";
import {
  onRequestGet as getReviewNotificationState,
  onRequestPost as markReviewNotificationStateRead,
} from "../functions/api/owner/reviews/notifications/read";
import { onRequestPost as bulkModerateReviews } from "../functions/api/owner/reviews/bulk";
import { onRequest as reportReview } from "../functions/api/public/server-reviews/[reviewId]/report";
import { onRequest as saveReview } from "../functions/api/servers/[serverId]/reviews";
import { onRequest as manageOwnerReply } from "../functions/api/servers/[serverId]/reviews/[reviewId]/reply";

type Row = Record<string, unknown>;
type Sqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    all(...values: unknown[]): Row[];
    get(...values: unknown[]): Row | undefined;
    run(...values: unknown[]): { changes: number | bigint };
  };
};

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => Sqlite;
};

assert.deepEqual(
  parseReviewModerationFilters(
    new URL("https://dzn.test/api/owner/reviews/moderate"),
  ),
  { status: "pending", query: "" },
);
assert.deepEqual(
  parseReviewModerationFilters(
    new URL(
      "https://dzn.test/api/owner/reviews/moderate?status=hidden&q=%25Tara_%25",
    ),
  ),
  { status: "hidden", query: "Tara" },
);
assert.equal(
  parseReviewModerationFilters(
    new URL("https://dzn.test/api/owner/reviews/moderate?status=deleted"),
  ).status,
  "pending",
);

const valid = validateReviewModerationInput({
  reviewId: "review-12345678",
  moderationVersion: 3,
  action: "approve",
  reason: "Reports checked against the review.",
});
assert.equal(valid.ok, true);
assert.equal(
  validateReviewModerationInput({
    reviewId: "bad",
    moderationVersion: 0,
    action: "approve",
    reason: "Valid reason",
  }).ok,
  false,
);
assert.equal(validateReviewModerationBulkInput({
  items: [
    { reviewId: "review-one-1234", moderationVersion: 0 },
    { reviewId: "review-two-1234", moderationVersion: 2 },
  ],
  action: "hide",
  reason: "Confirmed repeated policy breach.",
}).ok, true);
assert.equal(validateReviewModerationBulkInput({
  items: [
    { reviewId: "review-one-1234", moderationVersion: 0 },
    { reviewId: "review-one-1234", moderationVersion: 0 },
  ],
  action: "hide",
  reason: "Duplicate selection must fail.",
}).ok, false);
assert.equal(
  validateReviewModerationInput({
    reviewId: "review-12345678",
    moderationVersion: 0,
    action: "delete",
    reason: "Valid reason",
  }).ok,
  false,
);
assert.equal(
  validateReviewModerationInput({
    reviewId: "review-12345678",
    moderationVersion: 0,
    action: "hide",
    reason: "no",
  }).ok,
  false,
);
assert.equal(
  validateReviewModerationInput({
    reviewId: "review-12345678",
    action: "hide",
    reason: "Valid reason",
  }).ok,
  false,
);
assert.equal(
  validateReviewModerationInput({
    reviewId: "review-12345678",
    moderationVersion: -1,
    action: "hide",
    reason: "Valid reason",
  }).ok,
  false,
);
assert.equal(
  validateReviewModerationInput({
    reviewId: "review-12345678",
    moderationVersion: null,
    action: "hide",
    reason: "Valid reason",
  }).ok,
  false,
);
assert.equal(
  validateReviewModerationInput({
    reviewId: "review-12345678",
    moderationVersion: false,
    action: "hide",
    reason: "Valid reason",
  }).ok,
  false,
);
assert.equal(
  validateReviewModerationInput({
    reviewId: "review-12345678",
    moderationVersion: "0",
    action: "hide",
    reason: "Valid reason",
  }).ok,
  false,
);

const migration = readFileSync(
  "migrations/0079_server_review_moderation.sql",
  "utf8",
);
assert.match(migration, /server_review_moderation_audit/);
assert.match(migration, /moderation_version INTEGER NOT NULL DEFAULT 0/);
assert.match(migration, /resolved_by_user_id/);
assert.match(
  migration,
  /DROP INDEX IF EXISTS idx_server_review_reports_one_per_user/,
);
assert.match(migration, /WHERE resolution_status IS NULL/);
assert.match(migration, /CHECK \(action IN \('approve', 'hide'\)\)/);

const ownerReplyMigration = readFileSync("migrations/0091_server_review_owner_replies.sql", "utf8");
assert.match(ownerReplyMigration, /ALTER TABLE server_reviews ADD COLUMN owner_reply_body TEXT/);
assert.match(ownerReplyMigration, /owner_reply_version INTEGER NOT NULL DEFAULT 0/);
assert.match(ownerReplyMigration, /owner_reply_last_decision_id TEXT/);
assert.match(ownerReplyMigration, /server_review_owner_reply_audit/);
assert.match(ownerReplyMigration, /CHECK \(action IN \('upsert', 'remove'\)\)/);

const ownerReplyRoute = readFileSync(
  "functions/api/servers/[serverId]/reviews/[reviewId]/reply.ts",
  "utf8",
);
assert.match(ownerReplyRoute, /requireServerOwnerOrDznAdmin/);
assert.match(ownerReplyRoute, /readBoundedJson/);
assert.match(ownerReplyRoute, /sameOrigin/);
assert.match(ownerReplyRoute, /owner_reply_version/);

const route = readFileSync("functions/api/owner/reviews/moderate.ts", "utf8");
assert.match(route, /requirePlatformOwner/);
assert.match(route, /countUnreadReviewNotifications/);
assert.match(route, /readBoundedJson|readReviewModerationRequest/);
assert.doesNotMatch(route, /getSessionUser/);

const implementation = readFileSync(
  "functions/_lib/server-review-moderation.ts",
  "utf8",
);
assert.match(implementation, /await db\.batch\(\[/);
assert.match(implementation, /moderation_version = \?/);
assert.match(implementation, /input\.moderationVersion/);
assert.match(implementation, /meta\?\.changes/);
assert.match(implementation, /resolution_status IS NULL/);
assert.match(
  implementation,
  /reports\.id IS NOT NULL AND reports\.resolution_status IS NULL/,
);
assert.match(implementation, /report_count = 0/);

const reportRoute = readFileSync(
  "functions/api/public/server-reviews/[reviewId]/report.ts",
  "utf8",
);
assert.match(reportRoute, /await db\.batch\(\[/);
assert.match(reportRoute, /status = 'approved' AND moderation_version = \?/);
assert.match(reportRoute, /moderation_version = moderation_version \+ 1/);
assert.match(reportRoute, /resolution_status IS NULL/);
assert.match(reportRoute, /review_moderation_required/);
assert.match(reportRoute, /parsePlatformOwnerDiscordIds/);

const notificationReadRoute = readFileSync("functions/api/owner/reviews/notifications/read.ts", "utf8");
assert.match(notificationReadRoute, /requirePlatformOwner/);
assert.match(notificationReadRoute, /markReviewNotificationsRead/);

const bulkRoute = readFileSync("functions/api/owner/reviews/bulk.ts", "utf8");
assert.match(bulkRoute, /requirePlatformOwner/);
assert.match(bulkRoute, /readReviewModerationBulkRequest/);
assert.match(bulkRoute, /applyBulkReviewModerationDecision/);
assert.match(bulkRoute, /PULSE_NO_STORE_HEADERS/);
assert.match(bulkRoute, /sameOrigin/);

assert.match(implementation, /input\.items\.length/);
assert.match(implementation, /WITH expected\(id, moderation_version, decision_id\) AS \(VALUES/);
assert.match(implementation, /JOIN expected ON expected\.id = current\.id/);

const pulseProvider = readFileSync("components/dzn-pulse/dzn-pulse-provider.tsx", "utf8");
assert.match(pulseProvider, /key: "reviews", label: "Reviews"/);
assert.match(pulseProvider, /review_moderation_required/);

const editRoute = readFileSync(
  "functions/api/servers/[serverId]/reviews.ts",
  "utf8",
);
assert.match(editRoute, /superseded_by_edit/);
assert.match(editRoute, /moderation_version = \?/);
assert.match(editRoute, /meta\?\.changes/);

assert.equal(
  existsSync("functions/owner/reviews.ts"),
  true,
  "The review moderation page must have a platform-owner page guard.",
);
const pageGuard = readFileSync("functions/owner/reviews.ts", "utf8");
assert.match(pageGuard, /requirePlatformOwner/);
assert.match(pageGuard, /mode: "page"/);

const moderationPage = readFileSync(
  "components/owner/server-review-moderation-page.tsx",
  "utf8",
);
assert.match(moderationPage, /const loadSequence = useRef\(0\)/);
assert.match(
  moderationPage,
  /const requestSequence = \+\+loadSequence\.current/,
);
assert.match(moderationPage, /requestSequence !== loadSequence\.current/);
assert.match(moderationPage, /status: statusRef\.current/);
assert.match(moderationPage, /appliedSearchRef\.current/);
assert.match(moderationPage, /\/api\/owner\/reviews\/bulk/);
assert.match(moderationPage, /maximum 20/i);
assert.match(moderationPage, /selectedReviewIds\.size >= 20/);

async function runExecutableModerationTransactions() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync("migrations/0001_initial_schema.sql", "utf8"));
  sqlite.exec(
    "ALTER TABLE linked_servers ADD COLUMN merged_into_server_id TEXT",
  );
  sqlite.exec(readFileSync("migrations/0010_server_reviews.sql", "utf8"));
  sqlite.exec("CREATE TABLE competitive_events (id TEXT PRIMARY KEY)");
  sqlite.exec(readFileSync("migrations/0052_dzn_pulse.sql", "utf8"));
  sqlite.exec(migration);
  sqlite.exec(ownerReplyMigration);

  const prepare = (sql: string, bindings: unknown[] = []) => {
    const execute = () => {
      if (/^\s*(?:SELECT|PRAGMA)/i.test(sql)) {
        return {
          results: sqlite.prepare(sql).all(...bindings),
          success: true,
          meta: { changes: 0 },
        };
      }
      const result = sqlite.prepare(sql).run(...bindings);
      return {
        results: [],
        success: true,
        meta: { changes: Number(result.changes) },
      };
    };
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      first: async <T>() =>
        (sqlite.prepare(sql).get(...bindings) as T | undefined) ?? null,
      all: async () => execute(),
      run: async () => execute(),
      execute,
    };
  };
  let beforeNextBatch: (() => void) | null = null;
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      const beforeBatch = beforeNextBatch;
      beforeNextBatch = null;
      beforeBatch?.();
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const sessionSecret = "review-moderation-session-secret";
  const env = {
    DB: db,
    SESSION_SECRET: sessionSecret,
    DZN_PULSE_ENABLED: "true",
    DZN_PLATFORM_OWNER_DISCORD_IDS: "111111111111111111",
    DZN_SERVER_REVIEW_OWNER_REPLIES_ENABLED: "true",
  } as unknown as Env;
  const old = "2026-01-01T00:00:00.000Z";
  sqlite.exec(`
  INSERT INTO users (id, discord_id, username, avatar) VALUES
    ('owner-user', '111111111111111111', 'DZN Owner', NULL),
    ('admin-user', 'admin-discord', 'DZN Admin', NULL),
    ('reviewer-user', 'reviewer-discord', 'Reviewer', NULL),
    ('reporter-user', 'reporter-discord', 'Reporter', NULL),
    ('reporter-two', 'reporter-two-discord', 'Reporter Two', NULL),
    ('reporter-three', 'reporter-three-discord', 'Reporter Three', NULL);
  INSERT INTO linked_servers (id, user_id, guild_id, discord_guild_id, server_name, server_type, status, public_slug)
    VALUES ('server-12345678', 'owner-user', 'guild-1', 'guild-row-1', 'Test Server', 'PVP', 'active', 'test-server');
  INSERT INTO server_reviews (
    id, linked_server_id, reviewer_discord_id, reviewer_name, rating, title, body,
    status, report_count, moderation_version, created_at, updated_at, last_edited_at
  ) VALUES (
    'review-12345678', 'server-12345678', 'reviewer-discord', 'Reviewer', 4,
    'Original title', 'Original review body', 'approved', 0, 0, '${old}', '${old}', NULL
  ), (
    'review-threshold-1234', 'server-12345678', 'threshold-reviewer-discord', 'Threshold Reviewer', 3,
    'Threshold title', 'Review that will reach the moderation threshold.', 'approved', 0, 0, '${old}', '${old}', NULL
  );
`);
  for (const [id, token] of [
    ["owner-user", "owner-token"],
    ["admin-user", "admin-token"],
    ["reviewer-user", "reviewer-token"],
    ["reporter-user", "reporter-token"],
    ["reporter-two", "reporter-two-token"],
    ["reporter-three", "reporter-three-token"],
  ]) {
    sqlite
      .prepare(
        "INSERT INTO sessions (id, user_id, session_token_hash, expires_at) VALUES (?, ?, ?, datetime('now','+1 day'))",
      )
      .run(`session-${id}`, id, await hmacSha256(token, sessionSecret));
  }

  function context(
    request: Request,
    params: Record<string, string>,
    contextEnv: Env = env,
  ): PagesContext {
    return {
      request,
      env: contextEnv,
      params,
      waitUntil: () => undefined,
      next: async () => new Response(null),
      data: {},
    };
  }
  function authenticatedPost(path: string, token: string, body: unknown) {
    return new Request(`https://dzn.test${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `dzn_session=${token}`,
      },
      body: JSON.stringify(body),
    });
  }

  function authenticatedSameOriginRequest(path: string, token: string, method: "POST" | "DELETE", body?: unknown, origin = "https://dzn.test") {
    return new Request(`https://dzn.test${path}`, {
      method,
      headers: {
        cookie: `dzn_session=${token}`,
        origin,
        "sec-fetch-site": origin === "https://dzn.test" ? "same-origin" : "cross-site",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const ownerReplyPath = "/api/servers/server-12345678/reviews/review-12345678/reply";
  const disabledReply = await manageOwnerReply(context(
    authenticatedSameOriginRequest(ownerReplyPath, "owner-token", "POST", { body: "Thanks for the detailed review and constructive feedback." }),
    { serverId: "server-12345678", reviewId: "review-12345678" },
    { ...env, DZN_SERVER_REVIEW_OWNER_REPLIES_ENABLED: "false" },
  ));
  assert.equal(disabledReply.status, 404);
  const crossOriginReply = await manageOwnerReply(context(
    authenticatedSameOriginRequest(ownerReplyPath, "owner-token", "POST", { body: "Thanks for the detailed review and constructive feedback." }, "https://attacker.test"),
    { serverId: "server-12345678", reviewId: "review-12345678" },
  ));
  assert.equal(crossOriginReply.status, 403);
  const nonOwnerReply = await manageOwnerReply(context(
    authenticatedSameOriginRequest(ownerReplyPath, "reviewer-token", "POST", { body: "Thanks for the detailed review and constructive feedback." }),
    { serverId: "server-12345678", reviewId: "review-12345678" },
  ));
  assert.equal(nonOwnerReply.status, 403);
  const ownerReply = await manageOwnerReply(context(
    authenticatedSameOriginRequest(ownerReplyPath, "owner-token", "POST", { body: "Thanks for the detailed review and constructive feedback." }),
    { serverId: "server-12345678", reviewId: "review-12345678" },
  ));
  assert.equal(ownerReply.status, 200);
  assert.deepEqual({ ...sqlite.prepare(
    "SELECT owner_reply_body, owner_reply_author_user_id, owner_reply_version FROM server_reviews WHERE id = 'review-12345678'",
  ).get() }, {
    owner_reply_body: "Thanks for the detailed review and constructive feedback.",
    owner_reply_author_user_id: "owner-user",
    owner_reply_version: 1,
  });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM server_review_owner_reply_audit WHERE review_id = 'review-12345678'").get()?.count, 1);
  const multibyteReply = await manageOwnerReply(context(
    authenticatedSameOriginRequest(ownerReplyPath, "owner-token", "POST", {
      body: Array.from({ length: 1_000 }, (_, index) => String.fromCodePoint(0x3041 + (index % 80))).join(""),
    }),
    { serverId: "server-12345678", reviewId: "review-12345678" },
  ));
  assert.equal(multibyteReply.status, 200, "A valid 1,000-character UTF-8 reply must not be rejected by the transport size limit.");
  const adminReply = await manageOwnerReply(context(
    authenticatedSameOriginRequest(ownerReplyPath, "admin-token", "POST", { body: "The DZN team has reviewed this feedback and shared it with the server staff." }),
    { serverId: "server-12345678", reviewId: "review-12345678" },
    { ...env, DZN_ADMIN_DISCORD_IDS: "admin-discord" },
  ));
  assert.equal(adminReply.status, 200);
  beforeNextBatch = () => {
    sqlite.prepare(
      "UPDATE server_reviews SET owner_reply_version = 4, owner_reply_last_decision_id = 'competing-decision' WHERE id = 'review-12345678'",
    ).run();
  };
  const staleReply = await manageOwnerReply(context(
    authenticatedSameOriginRequest(ownerReplyPath, "owner-token", "POST", { body: "This stale response must not create an audit record." }),
    { serverId: "server-12345678", reviewId: "review-12345678" },
  ));
  assert.equal(staleReply.status, 409);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM server_review_owner_reply_audit WHERE review_id = 'review-12345678'").get()?.count,
    3,
    "A stale response must not create an audit row for another request's change.",
  );
  const removedReply = await manageOwnerReply(context(
    authenticatedSameOriginRequest(ownerReplyPath, "owner-token", "DELETE"),
    { serverId: "server-12345678", reviewId: "review-12345678" },
  ));
  assert.equal(removedReply.status, 200);
  assert.deepEqual({ ...sqlite.prepare(
    "SELECT owner_reply_body, owner_reply_author_user_id, owner_reply_version FROM server_reviews WHERE id = 'review-12345678'",
  ).get() }, {
    owner_reply_body: null,
    owner_reply_author_user_id: null,
    owner_reply_version: 5,
  });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM server_review_owner_reply_audit WHERE review_id = 'review-12345678'").get()?.count, 4);

  const firstReportResponse = await reportReview(
    context(
      authenticatedPost(
        "/api/public/server-reviews/review-12345678/report",
        "reporter-token",
        { reason: "Needs owner review" },
      ),
      { reviewId: "review-12345678" },
    ),
  );
  assert.equal(firstReportResponse.status, 200);
  assert.deepEqual(
    {
      ...sqlite
        .prepare(
          "SELECT status, report_count, moderation_version FROM server_reviews WHERE id = ?",
        )
        .get("review-12345678"),
    },
    {
      status: "approved",
      report_count: 1,
      moderation_version: 1,
    },
  );

  const thresholdReports = [
    ["reporter-token", "Threshold report one"],
    ["reporter-two-token", "Threshold report two"],
    ["reporter-three-token", "Threshold report three"],
  ] as const;
  for (const [index, [token, reason]] of thresholdReports.entries()) {
    const response = await reportReview(context(authenticatedPost(
      "/api/public/server-reviews/review-threshold-1234/report",
      token,
      { reason },
    ), { reviewId: "review-threshold-1234" }));
    assert.equal(response.status, 200);
    assert.equal(
      Number(sqlite.prepare("SELECT COUNT(*) AS count FROM user_notifications WHERE type = 'review_moderation_required'").get()?.count ?? 0),
      index === thresholdReports.length - 1 ? 1 : 0,
      "The owner alert must be created exactly when the third open report moves the review to pending.",
    );
  }
  assert.deepEqual({ ...sqlite.prepare(
    "SELECT status, report_count, moderation_version FROM server_reviews WHERE id = ?",
  ).get("review-threshold-1234") }, { status: "pending", report_count: 3, moderation_version: 3 });
  const owner: SessionUser = {
    id: "owner-user",
    discord_id: "111111111111111111",
    username: "DZN Owner",
    avatar: null,
  };
  const reviewAlertRows = sqlite.prepare("SELECT id, user_id, type, action_url FROM user_notifications ORDER BY id").all();
  assert.deepEqual(reviewAlertRows.map(({ user_id, type, action_url }) => ({ user_id, type, action_url })), [{
    user_id: "owner-user",
    type: "review_moderation_required",
    action_url: "/owner/reviews",
  }]);
  assert.equal(await countUnreadReviewNotifications(env, owner), 1, `The threshold transition must create one private owner alert. Rows: ${JSON.stringify(reviewAlertRows)}`);
  sqlite.prepare(`INSERT INTO user_notifications
    (id, user_id, type, title, body, priority, dedupe_key, created_at)
    VALUES ('general-owner-alert', 'owner-user', 'dzn_announcement', 'General', 'Keep unread', 1, 'general-owner-alert', ?)`)
    .run(new Date().toISOString());
  const anonymousReadState = await getReviewNotificationState(context(
    new Request("https://dzn.test/api/owner/reviews/notifications/read"),
    {},
  ));
  assert.equal(anonymousReadState.status, 401);
  const nonOwnerReadState = await getReviewNotificationState(context(
    new Request("https://dzn.test/api/owner/reviews/notifications/read", { headers: { cookie: "dzn_session=reporter-token" } }),
    {},
  ));
  assert.equal(nonOwnerReadState.status, 403);
  const ownerReadState = await getReviewNotificationState(context(
    new Request("https://dzn.test/api/owner/reviews/notifications/read", { headers: { cookie: "dzn_session=owner-token" } }),
    {},
  ));
  assert.equal(ownerReadState.status, 200);
  assert.equal((await ownerReadState.json() as { reviewUnreadCount: number }).reviewUnreadCount, 1);
  const markedResponse = await markReviewNotificationStateRead(context(
    new Request("https://dzn.test/api/owner/reviews/notifications/read", { method: "POST", headers: { cookie: "dzn_session=owner-token" } }),
    {},
  ));
  assert.equal(markedResponse.status, 200);
  const marked = await markedResponse.json() as { marked: number; reviewUnreadCount: number };
  assert.equal(marked.marked, 1);
  assert.equal(marked.reviewUnreadCount, 0);
  assert.equal(sqlite.prepare("SELECT read_at FROM user_notifications WHERE id = 'general-owner-alert'").get()?.read_at, null, "Review read state must not clear general notifications.");

  const moderation = await applyReviewModerationDecision(env, owner, {
    reviewId: "review-12345678",
    moderationVersion: 1,
    action: "hide",
    reason: "Confirmed policy breach.",
  });
  assert.equal(moderation.ok, true);
  assert.deepEqual(
    {
      ...sqlite
        .prepare(
          "SELECT status, report_count, moderation_version FROM server_reviews WHERE id = ?",
        )
        .get("review-12345678"),
    },
    {
      status: "hidden",
      report_count: 0,
      moderation_version: 2,
    },
  );
  assert.deepEqual(
    {
      ...sqlite
        .prepare(
          "SELECT resolution_status, resolved_by_user_id FROM server_review_reports WHERE review_id = ?",
        )
        .get("review-12345678"),
    },
    {
      resolution_status: "actioned",
      resolved_by_user_id: "owner-user",
    },
  );
  assert.equal(
    sqlite
      .prepare("SELECT COUNT(*) AS count FROM server_review_moderation_audit")
      .get()?.count,
    1,
  );

  const staleModeration = await applyReviewModerationDecision(env, owner, {
    reviewId: "review-12345678",
    moderationVersion: 1,
    action: "approve",
    reason: "Stale decision must fail.",
  });
  assert.equal(staleModeration.ok, false);
  assert.equal(staleModeration.status, 409);
  assert.equal(
    sqlite
      .prepare("SELECT COUNT(*) AS count FROM server_review_moderation_audit")
      .get()?.count,
    1,
  );

  const restore = await applyReviewModerationDecision(env, owner, {
    reviewId: "review-12345678",
    moderationVersion: 2,
    action: "approve",
    reason: "Corrected and safe to publish.",
  });
  assert.equal(restore.ok, true);
  const secondReportResponse = await reportReview(
    context(
      authenticatedPost(
        "/api/public/server-reviews/review-12345678/report",
        "reporter-token",
        { reason: "Fresh report after resolution" },
      ),
      { reviewId: "review-12345678" },
    ),
  );
  assert.equal(
    secondReportResponse.status,
    200,
    "A reporter may submit a fresh report after the prior one is resolved.",
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM server_review_reports WHERE review_id = ?",
      )
      .get("review-12345678")?.count,
    2,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM server_review_reports WHERE review_id = ? AND resolution_status IS NULL",
      )
      .get("review-12345678")?.count,
    1,
  );

  sqlite
    .prepare(
      "UPDATE server_reviews SET updated_at = ?, last_edited_at = ? WHERE id = ?",
    )
    .run(old, old, "review-12345678");
  sqlite.prepare(
    `UPDATE server_reviews
        SET owner_reply_body = 'Response to the original review.',
            owner_reply_author_user_id = 'owner-user',
            owner_reply_author_name = 'Owner',
            owner_reply_created_at = ?,
            owner_reply_updated_at = ?,
            owner_reply_version = owner_reply_version + 1
      WHERE id = ?`,
  ).run(old, old, "review-12345678");
  const editResponse = await saveReview(
    context(
      authenticatedPost(
        "/api/servers/server-12345678/reviews",
        "reviewer-token",
        {
          rating: 5,
          title: "Updated title",
          body: "Updated review body after moderation.",
        },
      ),
      { serverId: "server-12345678" },
    ),
  );
  assert.equal(editResponse.status, 200);
  assert.deepEqual(
    {
      ...sqlite
        .prepare(
          "SELECT status, report_count, moderation_version, title FROM server_reviews WHERE id = ?",
        )
        .get("review-12345678"),
    },
    {
      status: "approved",
      report_count: 0,
      moderation_version: 5,
      title: "Updated title",
    },
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM server_review_reports WHERE review_id = ? AND resolution_status IS NULL",
      )
      .get("review-12345678")?.count,
    0,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM server_review_reports WHERE review_id = ? AND resolution_status = 'superseded_by_edit'",
      )
      .get("review-12345678")?.count,
    1,
  );
  assert.deepEqual(
    {
      ...sqlite.prepare(
        "SELECT owner_reply_body, owner_reply_author_user_id, owner_reply_author_name FROM server_reviews WHERE id = ?",
      ).get("review-12345678"),
    },
    {
      owner_reply_body: null,
      owner_reply_author_user_id: null,
      owner_reply_author_name: null,
    },
    "Editing a review must invalidate an owner response written for the earlier content.",
  );

  sqlite.exec(`
    INSERT INTO server_reviews (
      id, linked_server_id, reviewer_discord_id, reviewer_name, rating, title, body,
      status, report_count, moderation_version, created_at, updated_at, last_edited_at
    ) VALUES
      ('bulk-review-a1', 'server-12345678', 'bulk-reviewer-a', 'Bulk A', 2, 'Bulk A', 'Bulk review A', 'pending', 2, 0, '${old}', '${old}', NULL),
      ('bulk-review-b2', 'server-12345678', 'bulk-reviewer-b', 'Bulk B', 1, 'Bulk B', 'Bulk review B', 'pending', 3, 0, '${old}', '${old}', NULL),
      ('bulk-review-c3', 'server-12345678', 'bulk-reviewer-c', 'Bulk C', 3, 'Bulk C', 'Bulk review C', 'pending', 1, 0, '${old}', '${old}', NULL),
      ('bulk-review-d4', 'server-12345678', 'bulk-reviewer-d', 'Bulk D', 4, 'Bulk D', 'Bulk review D', 'pending', 1, 0, '${old}', '${old}', NULL);
  `);
  const bulkBody = {
    items: [
      { reviewId: "bulk-review-a1", moderationVersion: 0 },
      { reviewId: "bulk-review-b2", moderationVersion: 0 },
    ],
    action: "hide",
    reason: "Repeated policy breach confirmed across both reviews.",
  };
  const crossOriginBulk = await bulkModerateReviews(context(new Request("https://dzn.test/api/owner/reviews/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "dzn_session=owner-token", origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
    body: JSON.stringify(bulkBody),
  }), {}));
  assert.equal(crossOriginBulk.status, 403);
  const bulkResponse = await bulkModerateReviews(context(new Request("https://dzn.test/api/owner/reviews/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "dzn_session=owner-token", origin: "https://dzn.test", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(bulkBody),
  }), {}));
  assert.equal(bulkResponse.status, 200);
  const bulkResult = await bulkResponse.json() as { ok: boolean; updated: number };
  assert.equal(bulkResult.ok, true);
  assert.equal(bulkResult.updated, 2);
  assert.deepEqual(sqlite.prepare(
    "SELECT id, status, report_count, moderation_version FROM server_reviews WHERE id IN ('bulk-review-a1', 'bulk-review-b2') ORDER BY id",
  ).all().map((row) => ({ ...row })), [
    { id: "bulk-review-a1", status: "hidden", report_count: 0, moderation_version: 1 },
    { id: "bulk-review-b2", status: "hidden", report_count: 0, moderation_version: 1 },
  ]);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM server_review_moderation_audit WHERE review_id IN ('bulk-review-a1', 'bulk-review-b2')",
  ).get()?.count, 2, "Every grouped decision must have its own audit row.");

  beforeNextBatch = () => {
    sqlite.prepare("UPDATE server_reviews SET moderation_version = moderation_version + 1 WHERE id = 'bulk-review-d4'").run();
  };
  const racedBulkResult = await applyBulkReviewModerationDecision(env, owner, {
    items: [
      { reviewId: "bulk-review-c3", moderationVersion: 0 },
      { reviewId: "bulk-review-d4", moderationVersion: 0 },
    ],
    action: "approve",
    reason: "This stale group decision must not partially apply.",
  });
  assert.equal(racedBulkResult.ok, false);
  assert.equal(racedBulkResult.status, 409);
  assert.deepEqual(sqlite.prepare(
    "SELECT id, status, report_count, moderation_version FROM server_reviews WHERE id IN ('bulk-review-c3', 'bulk-review-d4') ORDER BY id",
  ).all().map((row) => ({ ...row })), [
    { id: "bulk-review-c3", status: "pending", report_count: 1, moderation_version: 0 },
    { id: "bulk-review-d4", status: "pending", report_count: 1, moderation_version: 1 },
  ], "A concurrent change must prevent every group moderation write.");
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM server_review_moderation_audit WHERE review_id IN ('bulk-review-c3', 'bulk-review-d4')",
  ).get()?.count, 0);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  sqlite.close();
}

runExecutableModerationTransactions()
  .then(() => console.log("Server review moderation tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
