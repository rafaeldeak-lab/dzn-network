import assert from "node:assert/strict";

import {
  REVIEW_COOLDOWN_HOURS,
  moderateReviewText,
  reviewCooldownUntil,
  validatePublicListingInput,
  validateReviewInput,
} from "../functions/_lib/review-moderation";
import { buildPublicReviewSummary, viewerReviewState, type ServerReviewRow } from "../functions/_lib/server-reviews";
import { buildPublicServerRatingSummaries, emptyPublicServerRatingSummary, type ReviewAggregateRow } from "../functions/api/public/servers";

const listing = validatePublicListingInput({
  public_short_description: "High-action PvP server with weekend raids.",
  public_description: "Events, traders, factions, and active admins.",
  public_discord_invite: "https://discord.gg/nuketown",
  public_website_url: "https://nuketown.dayz/rules",
  public_rules: "No cheating. Respect event rules.",
  public_language: "English",
  public_region_label: "UK / EU",
});

assert.equal(listing.ok, true);
if (listing.ok) {
  assert.equal(listing.value.public_discord_invite, "https://discord.gg/nuketown");
  assert.equal(listing.value.public_website_url, "https://nuketown.dayz/rules");
}

assert.equal(validatePublicListingInput({ public_discord_invite: "discord.gg/nuketown" }).ok, false);
assert.equal(validatePublicListingInput({ public_discord_invite: "http://discord.gg/nuketown" }).ok, false);
assert.equal(validatePublicListingInput({ public_discord_invite: "https://discordapp.com/invite/nuketown" }).ok, false);
assert.equal(validatePublicListingInput({ public_discord_invite: "https://www.discord.com/invite/nuketown" }).ok, true);
assert.equal(validatePublicListingInput({ public_website_url: "javascript:alert(1)" }).ok, false);
assert.equal(validatePublicListingInput({ public_discord_invite: "https://example.com/not-discord" }).ok, false);
assert.equal(validatePublicListingInput({ public_short_description: "x".repeat(161) }).ok, false);

const cleanReview = validateReviewInput({
  rating: 5,
  title: "Great community",
  body: "Clean events, active staff, and a strong competitive DayZ community.",
});
assert.equal(cleanReview.ok, true);

assert.equal(validateReviewInput({ rating: 0, body: "Clean events, active staff, and a strong community." }).ok, false);
assert.equal(validateReviewInput({ rating: 5, body: "Too short" }).ok, false);
assert.equal(validateReviewInput({ rating: 5, body: "<script>alert(1)</script> Clean events and staff." }).ok, false);
assert.equal(validateReviewInput({ rating: 5, body: "AAAAAAA this is repeated character spam and should not be accepted." }).ok, false);
assert.equal(validateReviewInput({ rating: 5, body: "CHECK THIS CHECK THIS CHECK THIS CHECK THIS CHECK THIS CHECK THIS" }).ok, false);
assert.equal(moderateReviewText(null, "This review has unsafe sexual abuse wording and should be rejected.").ok, false);

const now = new Date("2026-05-16T12:00:00.000Z");
const recentUpdate = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
assert.equal(Boolean(reviewCooldownUntil(recentUpdate, now)), true);
const oldUpdate = new Date(now.getTime() - (REVIEW_COOLDOWN_HOURS + 1) * 60 * 60 * 1000).toISOString();
assert.equal(reviewCooldownUntil(oldUpdate, now), null);

const rows: ServerReviewRow[] = [
  reviewRow({ id: "pandora-approved", linkedServerId: "pandora", reviewerDiscordId: "111", status: "approved", rating: 5 }),
  reviewRow({ id: "pandora-pending", linkedServerId: "pandora", reviewerDiscordId: "222", status: "pending", rating: 1 }),
  reviewRow({ id: "nuketown-approved", linkedServerId: "nuketown", reviewerDiscordId: "333", status: "approved", rating: 4 }),
];

const pandoraSummary = buildPublicReviewSummary(rows.filter((row) => row.linked_server_id === "pandora"), "111");
assert.equal(pandoraSummary.review_count, 1);
assert.equal(pandoraSummary.average_rating, 5);
assert.equal(pandoraSummary.reviews[0].is_own_review, true);
assert.equal(JSON.stringify(pandoraSummary).includes("reviewer_discord_id"), false);
assert.equal(pandoraSummary.reviews.some((review) => review.id === "nuketown-approved"), false);

const listingRatingRows: ReviewAggregateRow[] = [
  { linked_server_id: "pandora", rating: 5, review_count: 2 },
  { linked_server_id: "pandora", rating: 4, review_count: 1 },
  { linked_server_id: "nuketown", rating: 2, review_count: 1 },
];
const listingRatingSummaries = buildPublicServerRatingSummaries(["pandora", "nuketown", "warlords"], listingRatingRows);
assert.equal(listingRatingSummaries.get("pandora")?.review_count, 3);
assert.equal(listingRatingSummaries.get("pandora")?.average_rating, 4.7);
assert.equal(listingRatingSummaries.get("pandora")?.rating_breakdown[5], 2);
assert.equal(listingRatingSummaries.get("nuketown")?.review_count, 1);
assert.equal(listingRatingSummaries.get("warlords")?.average_rating, null);
assert.equal(listingRatingSummaries.get("warlords")?.review_count, 0);
assert.deepEqual(listingRatingSummaries.get("warlords"), emptyPublicServerRatingSummary());
assert.equal(JSON.stringify(listingRatingSummaries.get("pandora")).includes("reviewer_discord_id"), false);

assert.deepEqual(
  viewerReviewState({
    viewer: { id: "owner-user", discord_id: "owner-discord", username: "owner", avatar: null },
    serverOwnerUserId: "owner-user",
  }).reason,
  "owner",
);

assert.equal(
  viewerReviewState({
    viewer: { id: "reviewer-user", discord_id: "111", username: "reviewer", avatar: null },
    serverOwnerUserId: "owner-user",
    existingReview: reviewRow({ id: "existing", linkedServerId: "pandora", reviewerDiscordId: "111", status: "approved", rating: 5, updatedAt: recentUpdate }),
    now,
  }).reason,
  "cooldown",
);

console.log("Public listing and review moderation tests passed.");

function reviewRow(options: {
  id: string;
  linkedServerId: string;
  reviewerDiscordId: string;
  status: string;
  rating: number;
  updatedAt?: string;
}): ServerReviewRow {
  return {
    id: options.id,
    linked_server_id: options.linkedServerId,
    reviewer_discord_id: options.reviewerDiscordId,
    reviewer_name: "Reviewer",
    reviewer_avatar_url: null,
    rating: options.rating,
    title: "Review title",
    body: "This is a clean public review body with enough useful detail.",
    status: options.status,
    moderation_reason: null,
    report_count: 0,
    created_at: "2026-05-16T10:00:00.000Z",
    updated_at: options.updatedAt ?? "2026-05-16T10:00:00.000Z",
    last_edited_at: null,
  };
}
