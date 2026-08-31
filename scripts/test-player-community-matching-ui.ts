import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const playerHomeSource = readFileSync("components/player/player-home.tsx", "utf8");
const platformSpec = readFileSync("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md", "utf8");
const bridgeHandoff = readFileSync("docs/DZN_PLAYER_COMMUNITY_MATCHING_BRIDGE_HANDOFF.md", "utf8");
const uiHandoff = readFileSync("docs/DZN_PLAYER_COMMUNITY_MATCHING_UI_POLISH_HANDOFF.md", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const migrationFiles = readdirSync("migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

const matchedPanelStart = playerHomeSource.indexOf("function MatchedCommunitiesPanel");
const matchedPanelEnd = playerHomeSource.indexOf("function SuggestedEventsPanel", matchedPanelStart);
assert.ok(matchedPanelStart > -1 && matchedPanelEnd > matchedPanelStart, "Matched Communities panel must remain findable.");
const matchedPanelSource = playerHomeSource.slice(matchedPanelStart, matchedPanelEnd);

const helperStart = playerHomeSource.indexOf("function CommunityMatchEmptyState");
const helperEnd = playerHomeSource.indexOf("function hubMetric", helperStart);
assert.ok(helperStart > -1 && helperEnd > helperStart, "Community matching UI helper block must remain findable.");
const helperSource = playerHomeSource.slice(helperStart, helperEnd);

assert.match(matchedPanelSource, /Private Discord membership matches connected to public DZN server profiles\. Presentation only\./, "Panel header must clearly explain private presentation-only matches.");
assert.match(matchedPanelSource, /Private To You/, "Panel must visibly mark matches as private to the logged-in player.");
assert.match(matchedPanelSource, /Presentation Only/, "Panel must visibly mark matches as presentation-only.");
assert.match(matchedPanelSource, /Not Owner Access/, "Panel must visibly prevent owner-authority confusion.");
assert.match(matchedPanelSource, /CommunityMetricTile label="Matched"/, "Panel should summarize matched communities.");
assert.match(matchedPanelSource, /CommunityMetricTile label="Public Servers"/, "Panel should summarize connected public server profiles.");
assert.match(matchedPanelSource, /CommunityMetricTile label="Owner\/Admin"/, "Panel should separate owner/admin relationship display from access authority.");
assert.match(matchedPanelSource, /safeDiscordIconUrl\(community\.icon_url\)/, "Panel must sanitize cached icon URLs before rendering.");
assert.match(matchedPanelSource, /communityRelationshipCopy\(community\.relationship\)/, "Panel must show relationship-specific copy for members, admins, and owners.");

assert.match(helperSource, /CommunityMatchEmptyState/, "UI polish must provide source-aware empty states.");
assert.match(helperSource, /Community matching offline/, "Unavailable source empty state should be clear.");
assert.match(helperSource, /older manageable-guild cache/, "Fallback source empty state should name the old compatibility path.");
assert.match(helperSource, /raw Discord guild list is not exposed/, "Fallback source empty state must protect private Discord membership lists.");
assert.match(helperSource, /Hidden, unmatched, and other-user communities stay private/, "Bridge source empty state must name the privacy boundary.");
assert.match(helperSource, /Your Discord account owns this community, but setup still stays behind pricing and entitlement checks\./, "Owner relationship copy must not imply owner setup access.");
assert.match(helperSource, /can manage this community, but this match does not unlock owner tools\./, "Admin relationship copy must not imply owner tool access.");
assert.match(helperSource, /normal member of this Discord community, matched privately to public DZN servers\./, "Member relationship copy must be clear.");
assert.match(helperSource, /url\.protocol === "https:" && url\.hostname === "cdn\.discordapp\.com"/, "Icon URL guard must only allow HTTPS Discord CDN icons.");

assert.doesNotMatch(
  matchedPanelSource,
  /\b(?:fetch\(|onClick=|onSubmit=|method:|POST|DELETE|PUT|PATCH|\/setup|owner_setup|checkout|STRIPE|account_entitlements|server_subscriptions|nitrado_|server_reviews|review_score|dynamic_visibility_score|network_rank|leaderboard_write|badge_awards|user_badges|dzn_season|server_war|ctf|xp_award|calling_card_awards|public_handle|profile_visibility|profile_privacy|sendBeacon|analytics|localStorage|sessionStorage)\b/i,
  "Matched-community panel must remain read-only and out of owner, payment, profile-publication, analytics, and competitive systems.",
);

assert.deepEqual(migrationFiles.filter((name) => name.includes("player_community_matching_ui")), [], "UI polish must not add migrations.");
assert.match(platformSpec, /Player Hub community matching UI polish/i, "Master spec must record this UI polish slice.");
assert.match(bridgeHandoff, /Player Hub community matching UI polish/i, "Bridge handoff must still point at the UI polish follow-up.");
assert.match(uiHandoff, /UI\/read-only only/i, "UI handoff must document the read-only boundary.");
assert.match(packageJson, /"test:player-community-matching-ui": "tsx scripts\/test-player-community-matching-ui\.ts"/, "Dedicated UI polish test script must be registered.");

console.log("Player community matching UI polish tests passed.");
