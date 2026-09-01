import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("functions/api/player/hub.ts", "utf8");
const playerHome = readFileSync("components/player/player-home.tsx", "utf8");
const platformSpec = readFileSync("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md", "utf8");
const packageJson = readFileSync("package.json", "utf8");

assert.match(route, /MAX_SUGGESTED_EVENT_CANDIDATES = 24/, "Player Hub should read a bounded candidate set before private relevance ordering.");
assert.match(route, /readSuggestedEvents\(env, \{[\s\S]*savedServerIds:/, "Suggested events should receive current-player saved-server context only inside the private Hub route.");
assert.match(route, /matchedCommunityServerIds\(communities\.communities\)/, "Suggested events should receive matched-community server context derived from private Hub matches.");
assert.match(route, /SELECT event_id, server_id[\s\S]+FROM competitive_event_servers/, "Suggested event relevance may read public event server links.");
assert.match(route, /orderSuggestedEventsByPrivateRelevance/, "Suggested events should be ordered by private relevance in the read model.");
assert.match(route, /level: "followed_server"/, "Suggested events should label followed-server matches.");
assert.match(route, /level: "matched_community"/, "Suggested events should label matched-community matches.");
assert.match(route, /level: "public_network"/, "Suggested events should retain general public event fallback labels.");
assert.match(route, /presentation_only: true/, "Suggested event relevance metadata must be presentation-only.");
assert.doesNotMatch(route, /\b(?:INSERT INTO|UPDATE\s+[a-z_]+|DELETE FROM)\b/i, "Player Hub event relevance must not write SQL.");
assert.doesNotMatch(route, /\b(?:STRIPE|checkout_session|checkout\.session|nitrado_connections|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|server_reviews|review_score|badge_awards|user_badges|dzn_season|server_war_events|ctf_tournaments|xp_award|calling_card_awards|dynamic_visibility_score|network_rank)\b/i, "Player Hub event relevance must stay out of payment, owner, review, progression, and competitive systems.");

assert.match(playerHome, /Private suggestions prioritise followed servers and matched communities/, "Player Hub UI should explain private event relevance.");
assert.match(playerHome, /These suggestions are private to your Player Hub and stay presentation-only/, "Player Hub UI should show the private/presentation-only boundary.");
assert.match(playerHome, /eventRelevanceClasses/, "Player Hub UI should render clear relevance badges.");
assert.match(playerHome, /event\.relevance\.label/, "Player Hub UI should render relevance labels from the private API payload.");
assert.match(playerHome, /event\.relevance\.reasons/, "Player Hub UI should render relevance reasons from the private API payload.");
assert.doesNotMatch(playerHome, /\b(?:sendBeacon|analytics|localStorage|sessionStorage)\b/i, "Player Hub relevance UI must not add tracking or stored private fallback state.");
assert.doesNotMatch(playerHome, /fetch\([^)]*(?:checkout|STRIPE|nitrado_connections|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns)/i, "Player Hub relevance UI must not call Store/payment/owner runtime routes.");

assert.match(platformSpec, /Player Hub Suggested Event\/Tournament Relevance Polish/i, "Master spec must track the Player Hub event relevance slice.");
assert.match(platformSpec, /Prioritise public events connected to the player's privately followed servers/i, "Master spec must retain followed-server relevance boundary.");
assert.match(platformSpec, /Prioritise public events connected to the player's privately matched Discord communities/i, "Master spec must retain matched-community relevance boundary.");
assert.match(packageJson, /"test:player-hub-event-relevance": "tsx scripts\/test-player-hub-event-relevance\.ts"/, "Dedicated Player Hub event relevance test script must be registered.");

console.log("Player Hub event relevance guardrail tests passed.");
