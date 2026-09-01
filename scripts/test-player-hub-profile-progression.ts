import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("functions/api/player/hub.ts", "utf8");
const playerHome = readFileSync("components/player/player-home.tsx", "utf8");
const platformSpec = readFileSync("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md", "utf8");
const packageJson = readFileSync("package.json", "utf8");

assert.match(route, /readPlayerProfileProgression/, "Player Hub must build a private profile/progression read model.");
assert.match(route, /profile_summary: profileProgression\.profileSummary/, "Player Hub payload must expose a profile summary.");
assert.match(route, /progression_summary: profileProgression\.progressionSummary/, "Player Hub payload must expose a progression summary.");
assert.match(route, /FROM player_profiles/, "Profile/progression summary may read existing gameplay profile rows.");
assert.match(route, /player_profiles\.discord_id = \?/, "Profile/progression summary must be scoped to the current Discord user.");
assert.match(route, /public_profile_href: null/, "Player Hub must not invent public profile handles.");
assert.match(route, /future_earned_runtime/, "XP, challenge, and calling-card runtime must remain future earned systems.");
assert.match(route, /private: true/, "Profile/progression payload must carry private flags.");
assert.match(route, /presentation_only: true/, "Profile/progression payload must carry presentation-only flags.");
assert.match(route, /privateNoStoreHeaders\(\)/, "Profile/progression payload must be delivered as private no-store data.");
assert.doesNotMatch(route, /\b(?:INSERT INTO|UPDATE\s+[a-z_]+|DELETE FROM)\b/i, "Profile/progression route work must not add SQL writes.");
assert.doesNotMatch(
  route,
  /\b(?:STRIPE|checkout_session|checkout\.session|nitrado_connections|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|server_reviews|review_score|badge_awards|user_badges|dzn_season|server_war_events|ctf_tournaments|xp_award|calling_card_awards|dynamic_visibility_score|network_rank|profile_privacy|profile_visibility|public_handle)\b/i,
  "Profile/progression summary must stay out of payment, owner, review, award, privacy-publication, and competitive systems.",
);

assert.match(playerHome, /Profile & Progression/, "Player Hub UI must render the profile/progression panel.");
assert.match(playerHome, /Current Profile Signals/, "Player Hub UI must render safe current-user profile signal metrics.");
assert.match(playerHome, /profile\.public_profile_status\.replace/, "Player Hub UI must show public profile status without publishing a profile.");
assert.match(playerHome, /progression\.tracks\.map/, "Player Hub UI must render earned progression track readiness.");
assert.match(playerHome, /future_earned_runtime/, "Player Hub UI must keep earned progression runtime marked as future.");
assert.match(playerHome, /This profile summary is private and read-only/, "Player Hub UI must show the private/read-only boundary.");
assert.match(playerHome, /Owner Setup Stays Gated/, "Player Hub UI must keep owner setup separated.");
assert.match(playerHome, /\/pricing\?intent=owner_setup&returnTo=%2Fsetup/, "Player Hub owner action must remain routed through pricing.");
assert.doesNotMatch(playerHome, /\b(?:sendBeacon|analytics|localStorage|sessionStorage)\b/i, "Player Hub profile/progression UI must not add tracking or browser storage.");
assert.doesNotMatch(playerHome, /fetch\([^)]*(?:checkout|STRIPE|nitrado_connections|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns)/i, "Player Hub profile/progression UI must not call Store/payment/owner runtime routes.");

assert.match(platformSpec, /Player Hub profile\/progression entry-point real-data polish/i, "Master spec must track the profile/progression slice.");
assert.match(platformSpec, /read-only current-user profile\/progression summary/i, "Master spec must describe the read-only summary contract.");
assert.match(platformSpec, /does not publish public profile handles/i, "Master spec must preserve the public profile privacy boundary.");
assert.match(packageJson, /"test:player-hub-profile-progression": "tsx scripts\/test-player-hub-profile-progression\.ts"/, "Dedicated Player Hub profile/progression test script must be registered.");

console.log("Player Hub profile/progression guardrail tests passed.");
