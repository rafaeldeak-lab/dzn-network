import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { evaluateListingBumpEligibility, publicAdvertisingFromState } from "../functions/_lib/advertising";
import { sortPublicServersForDiscovery } from "../functions/api/public/servers";
import {
  FREE_BUMP_COOLDOWN_DAYS,
  FREE_DESCRIPTION_LIMIT,
  FREE_GALLERY_LIMIT,
  PRO_BUMP_COOLDOWN_DAYS,
  PRO_DESCRIPTION_LIMIT,
  PRO_GALLERY_ALLOWED_MIME_TYPES,
  PRO_GALLERY_LIMIT,
  PRO_GALLERY_MAX_FILE_SIZE_BYTES,
  canUseProFeature,
  getListingLimits,
  hasListingAutoPost,
  normalizeListingPlanKey,
} from "../lib/billing/plans";

assert.equal(FREE_DESCRIPTION_LIMIT, 500);
assert.equal(PRO_DESCRIPTION_LIMIT, 2500);
assert.equal(FREE_BUMP_COOLDOWN_DAYS, 30);
assert.equal(PRO_BUMP_COOLDOWN_DAYS, 7);
assert.equal(FREE_GALLERY_LIMIT, 0);
assert.equal(PRO_GALLERY_LIMIT, 4);
assert.deepEqual(PRO_GALLERY_ALLOWED_MIME_TYPES, ["image/jpeg"]);
assert.equal(PRO_GALLERY_MAX_FILE_SIZE_BYTES, 2 * 1024 * 1024);

assert.equal(normalizeListingPlanKey("free", "active"), "free");
assert.equal(normalizeListingPlanKey("starter", "active"), "free");
assert.equal(normalizeListingPlanKey("pro", "active"), "pro");
assert.equal(normalizeListingPlanKey("premium", "active"), "pro");
assert.equal(normalizeListingPlanKey("partner", "trialing"), "pro");
assert.equal(normalizeListingPlanKey("network", "active"), "pro");
assert.equal(normalizeListingPlanKey("premium", "past_due"), "free");
assert.equal(getListingLimits({ plan_key: "starter", subscription_status: "active" }).descriptionLimit, 500);
assert.equal(getListingLimits({ plan_key: "network", subscription_status: "active" }).descriptionLimit, 2500);
assert.equal(canUseProFeature({ plan_key: "free" }, "gallery_images"), false);
assert.equal(canUseProFeature({ plan_key: "pro", subscription_status: "active" }, "gallery_images"), true);
assert.equal(hasListingAutoPost({ plan_key: "free" }, "server_advert"), true);
assert.equal(hasListingAutoPost({ plan_key: "free" }, "weekly_recap"), false);
assert.equal(hasListingAutoPost({ plan_key: "premium", subscription_status: "active" }, "weekly_recap"), true);

const now = new Date("2026-06-01T12:00:00.000Z");
assert.equal(evaluateListingBumpEligibility({ limits: getListingLimits({ plan_key: "free" }), state: null, now }).ok, true);
assert.equal(evaluateListingBumpEligibility({
  limits: getListingLimits({ plan_key: "free" }),
  state: { last_bumped_at: "2026-05-20T12:00:00.000Z" },
  now,
}).code, "cooldown");
assert.equal(evaluateListingBumpEligibility({
  limits: getListingLimits({ plan_key: "pro", subscription_status: "active" }),
  state: { last_bumped_at: "2026-05-20T12:00:00.000Z" },
  now,
}).ok, true);

const sorted = sortPublicServersForDiscovery([
  { id: "rank-one", advertising: publicAdvertisingFromState(null), discoveryScore: 10, visibility_weight: 1, rank: 1, score: 900, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "bumped", advertising: publicAdvertisingFromState({ last_bumped_at: "2026-06-01T10:00:00.000Z" }, now), discoveryScore: 10, visibility_weight: 1, rank: 99, score: 10, created_at: "2026-01-01T00:00:00.000Z" },
]);
assert.equal(sorted[0].id, "bumped");
assert.equal(sorted.find((server) => server.id === "rank-one")?.rank, 1);
assert.equal(sorted.find((server) => server.id === "rank-one")?.score, 900);

const migration = readFileSync("migrations/0053_server_advertising_packages.sql", "utf8");
for (const snippet of [
  "ALTER TABLE server_advertising_state ADD COLUMN next_bump_at",
  "ALTER TABLE linked_servers ADD COLUMN advert_banner_url",
  "CREATE TABLE IF NOT EXISTS server_gallery_images",
  "CREATE TABLE IF NOT EXISTS server_listing_events",
  "idx_server_advertising_state_next_bump_at",
  "idx_server_gallery_images_server_sort",
]) {
  assert.equal(migration.includes(snippet), true, `Migration should include ${snippet}.`);
}
assert.equal(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats|ALTER\s+TABLE\s+player_profiles|kill_events|player_events/i.test(migration), false, "Advertising migration must be additive and avoid protected stat/event tables.");

const bumpRoute = readFileSync("functions/api/servers/[serverId]/advertising/bump.ts", "utf8");
for (const snippet of [
  "evaluateListingBumpEligibility",
  "next_bump_at",
  "bump_attempt",
  "bump_success",
  "server_listing_events",
  "rate_limited",
  "server.user_id !== user.id",
]) {
  assert.equal(bumpRoute.includes(snippet), true, `Bump route should include ${snippet}.`);
}
assert.equal(/featured_until\s*=|visibility_weight\s*=|rank\s*=|score\s*=|kill_events|player_events/i.test(bumpRoute), false, "Bump route must not modify rankings, scores, or gameplay event data.");

const galleryRoute = readFileSync("functions/api/servers/[serverId]/gallery.ts", "utf8");
for (const snippet of [
  "canUseProFeature(server, \"gallery_images\")",
  "Pro Listing supports up to",
  "galleryAllowedMimeTypes",
  "2MB or smaller",
  "server_gallery_images",
  "linked_servers.user_id = ?",
]) {
  assert.equal(galleryRoute.includes(snippet), true, `Gallery route should include ${snippet}.`);
}
assert.equal(/image\/png|image\/webp|base64|BLOB|Buffer/i.test(galleryRoute), false, "Gallery route should reject non-JPEGs and avoid storing image binaries in D1.");

const railRoute = readFileSync("functions/api/public/server-rail.ts", "utf8");
assert.equal(railRoute.includes("s-maxage=60"), true, "Server rail endpoint should be cached around 60 seconds.");
assert.equal(railRoute.includes("stale-while-revalidate=300"), true, "Server rail endpoint should allow short stale revalidation.");
assert.equal(/kill_events|player_events|player_profiles/i.test(railRoute), false, "Server rail endpoint must stay lightweight and avoid heavy gameplay tables.");

const publicServers = readFileSync("functions/api/public/servers.ts", "utf8");
for (const snippet of ["average_rating", "review_count", "advert_banner_url", "gallery_images", "plan_key: planKey"]) {
  assert.equal(publicServers.includes(snippet), true, `Public server payload should include ${snippet}.`);
}

const publicNetwork = readFileSync("components/network/public-network.tsx", "utf8");
for (const snippet of [
  "ServerRatingChip",
  "ProProfileAdvertPanel",
  "Owner Announcement",
  "Fresh Wipe / Event Promo",
  "No reviews yet",
  "Free and Pro listings remain visible here",
]) {
  assert.equal(publicNetwork.includes(snippet), true, `Public network UI should include ${snippet}.`);
}

const settingsUi = readFileSync("components/onboarding/server-settings-page.tsx", "utf8");
for (const snippet of [
  "Advertising Package",
  "PRO FEATURE",
  "Gallery images",
  "Custom banner",
  "Weekly bump",
  "Discord Pro embeds",
  "Analytics",
  "Upgrade to Pro",
]) {
  assert.equal(settingsUi.includes(snippet), true, `Owner settings UI should include ${snippet}.`);
}

const postingRoute = readFileSync("functions/api/servers/[serverId]/posting-destinations.ts", "utf8");
assert.equal(postingRoute.includes("wouldExceedDiscordChannelLimit"), true, "Discord posting route should enforce Free channel limits.");
assert.equal(postingRoute.includes("hasListingAutoPost"), true, "Discord posting route should use listing package post gates.");

console.log("Server advertising package tests passed.");
