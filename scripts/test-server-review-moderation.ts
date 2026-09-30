import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { parseReviewModerationFilters, validateReviewModerationInput } from "../functions/_lib/server-review-moderation";

assert.deepEqual(parseReviewModerationFilters(new URL("https://dzn.test/api/owner/reviews/moderate")), { status: "pending", query: "" });
assert.deepEqual(parseReviewModerationFilters(new URL("https://dzn.test/api/owner/reviews/moderate?status=hidden&q=%25Tara_%25")), { status: "hidden", query: "Tara" });
assert.equal(parseReviewModerationFilters(new URL("https://dzn.test/api/owner/reviews/moderate?status=deleted")).status, "pending");

const valid = validateReviewModerationInput({ reviewId: "review-12345678", moderationVersion: 3, action: "approve", reason: "Reports checked against the review." });
assert.equal(valid.ok, true);
assert.equal(validateReviewModerationInput({ reviewId: "bad", moderationVersion: 0, action: "approve", reason: "Valid reason" }).ok, false);
assert.equal(validateReviewModerationInput({ reviewId: "review-12345678", moderationVersion: 0, action: "delete", reason: "Valid reason" }).ok, false);
assert.equal(validateReviewModerationInput({ reviewId: "review-12345678", moderationVersion: 0, action: "hide", reason: "no" }).ok, false);
assert.equal(validateReviewModerationInput({ reviewId: "review-12345678", action: "hide", reason: "Valid reason" }).ok, false);
assert.equal(validateReviewModerationInput({ reviewId: "review-12345678", moderationVersion: -1, action: "hide", reason: "Valid reason" }).ok, false);

const migration = readFileSync("migrations/0079_server_review_moderation.sql", "utf8");
assert.match(migration, /server_review_moderation_audit/);
assert.match(migration, /moderation_version INTEGER NOT NULL DEFAULT 0/);
assert.match(migration, /resolved_by_user_id/);
assert.match(migration, /DROP INDEX IF EXISTS idx_server_review_reports_one_per_user/);
assert.match(migration, /WHERE resolution_status IS NULL/);
assert.match(migration, /CHECK \(action IN \('approve', 'hide'\)\)/);

const route = readFileSync("functions/api/owner/reviews/moderate.ts", "utf8");
assert.match(route, /requirePlatformOwner/);
assert.match(route, /readBoundedJson|readReviewModerationRequest/);
assert.doesNotMatch(route, /getSessionUser/);

const implementation = readFileSync("functions/_lib/server-review-moderation.ts", "utf8");
assert.match(implementation, /await db\.batch\(\[/);
assert.match(implementation, /moderation_version = \?/);
assert.match(implementation, /input\.moderationVersion/);
assert.match(implementation, /meta\?\.changes/);
assert.match(implementation, /resolution_status IS NULL/);
assert.match(implementation, /reports\.id IS NOT NULL AND reports\.resolution_status IS NULL/);
assert.match(implementation, /report_count = 0/);

const reportRoute = readFileSync("functions/api/public/server-reviews/[reviewId]/report.ts", "utf8");
assert.match(reportRoute, /await db\.batch\(\[/);
assert.match(reportRoute, /status = 'approved' AND moderation_version = \?/);
assert.match(reportRoute, /moderation_version = moderation_version \+ 1/);
assert.match(reportRoute, /resolution_status IS NULL/);

const editRoute = readFileSync("functions/api/servers/[serverId]/reviews.ts", "utf8");
assert.match(editRoute, /superseded_by_edit/);
assert.match(editRoute, /moderation_version = \?/);
assert.match(editRoute, /meta\?\.changes/);

assert.equal(existsSync("functions/owner/reviews.ts"), true, "The review moderation page must have a platform-owner page guard.");
const pageGuard = readFileSync("functions/owner/reviews.ts", "utf8");
assert.match(pageGuard, /requirePlatformOwner/);
assert.match(pageGuard, /mode: "page"/);

console.log("Server review moderation tests passed.");
