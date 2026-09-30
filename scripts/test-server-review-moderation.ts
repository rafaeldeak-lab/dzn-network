import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { hmacSha256 } from "../functions/_lib/crypto";
import {
  applyReviewModerationDecision,
  parseReviewModerationFilters,
  validateReviewModerationInput,
} from "../functions/_lib/server-review-moderation";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";
import { onRequest as reportReview } from "../functions/api/public/server-reviews/[reviewId]/report";
import { onRequest as saveReview } from "../functions/api/servers/[serverId]/reviews";

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

const route = readFileSync("functions/api/owner/reviews/moderate.ts", "utf8");
assert.match(route, /requirePlatformOwner/);
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

async function runExecutableModerationTransactions() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync("migrations/0001_initial_schema.sql", "utf8"));
  sqlite.exec(
    "ALTER TABLE linked_servers ADD COLUMN merged_into_server_id TEXT",
  );
  sqlite.exec(readFileSync("migrations/0010_server_reviews.sql", "utf8"));
  sqlite.exec(migration);

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
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
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
  const env = { DB: db, SESSION_SECRET: sessionSecret } as unknown as Env;
  const old = "2026-01-01T00:00:00.000Z";
  sqlite.exec(`
  INSERT INTO users (id, discord_id, username, avatar) VALUES
    ('owner-user', 'owner-discord', 'DZN Owner', NULL),
    ('reviewer-user', 'reviewer-discord', 'Reviewer', NULL),
    ('reporter-user', 'reporter-discord', 'Reporter', NULL);
  INSERT INTO linked_servers (id, user_id, guild_id, discord_guild_id, server_name, server_type, status, public_slug)
    VALUES ('server-12345678', 'owner-user', 'guild-1', 'guild-row-1', 'Test Server', 'PVP', 'active', 'test-server');
  INSERT INTO server_reviews (
    id, linked_server_id, reviewer_discord_id, reviewer_name, rating, title, body,
    status, report_count, moderation_version, created_at, updated_at, last_edited_at
  ) VALUES (
    'review-12345678', 'server-12345678', 'reviewer-discord', 'Reviewer', 4,
    'Original title', 'Original review body', 'approved', 0, 0, '${old}', '${old}', NULL
  );
`);
  for (const [id, token] of [
    ["reviewer-user", "reviewer-token"],
    ["reporter-user", "reporter-token"],
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
  ): PagesContext {
    return {
      request,
      env,
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

  const owner: SessionUser = {
    id: "owner-user",
    discord_id: "owner-discord",
    username: "DZN Owner",
    avatar: null,
  };
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
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  sqlite.close();
}

runExecutableModerationTransactions()
  .then(() => console.log("Server review moderation tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
