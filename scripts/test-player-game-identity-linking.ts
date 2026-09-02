import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parsePlayerGameIdentityClaimInput,
  parsePlayerGameIdentityReviewInput,
  sanitizePlayerGameIdentityPlayerId,
  sanitizePlayerGameIdentityServerRef,
} from "../functions/_lib/player-game-identities";
import { rankPublicPlayers } from "../functions/_lib/public-leaderboards";

const migration = readFileSync("migrations/0064_player_game_identity_links.sql", "utf8");
const helper = readFileSync("functions/_lib/player-game-identities.ts", "utf8");
const playerRoute = readFileSync("functions/api/player/game-identities.ts", "utf8");
const ownerListRoute = readFileSync("functions/api/owner/player-game-identity-claims.ts", "utf8");
const ownerReviewRoute = readFileSync("functions/api/owner/player-game-identity-claims/[claimId].ts", "utf8");
const statBridge = readFileSync("functions/_lib/player-stat-bridge.ts", "utf8");
const leaderboards = readFileSync("functions/_lib/public-leaderboards.ts", "utf8");
const playerHome = readFileSync("components/player/player-home.tsx", "utf8");
const identityPanel = readFileSync("components/player/player-game-identity-links.tsx", "utf8");
const platformSpec = readFileSync("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md", "utf8");
const handoff = readFileSync("docs/DZN_VERIFIED_PLAYER_GAME_IDENTITY_LINKING_HANDOFF.md", "utf8");
const packageJson = readFileSync("package.json", "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS player_game_identity_claims/, "Migration must create the pending identity claim table.");
assert.match(migration, /CREATE TABLE IF NOT EXISTS player_game_identity_links/, "Migration must create the active verified identity link table.");
assert.match(migration, /CREATE TABLE IF NOT EXISTS player_game_identity_audit_log/, "Migration must create the identity audit log.");
assert.match(migration, /FOREIGN KEY\(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/, "Identity rows must remain attached to DZN users.");
assert.match(migration, /FOREIGN KEY\(linked_server_id\) REFERENCES linked_servers\(id\) ON DELETE CASCADE/, "Identity rows must remain scoped to linked DZN servers.");
assert.match(migration, /FOREIGN KEY\(player_profile_id\) REFERENCES player_profiles\(id\) ON DELETE CASCADE/, "Identity rows must point at imported ADM player profiles.");
assert.match(migration, /idx_player_game_identity_claims_pending_user_profile/, "Pending duplicate claims by user/profile must be blocked.");
assert.match(migration, /idx_player_game_identity_claims_pending_profile/, "Concurrent pending claims for the same profile must be blocked.");
assert.match(migration, /idx_player_game_identity_links_active_profile/, "Only one active verified link may exist per ADM player profile.");
assert.match(migration, /idx_player_game_identity_links_active_server_player/, "Only one active verified link may exist per server/player ID.");
assert.doesNotMatch(
  migration,
  /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+(?:player_profiles|kill_events|player_events|server_stats|linked_servers|server_reviews|competitive_events|server_war_events|ctf_tournaments|account_entitlements|supporter_cards|earned_spins|spin_ledger))\b/i,
  "Identity migration must be additive and avoid destructive or protected table changes.",
);

assert.match(playerRoute, /request\.method === "GET"/, "Current players need a private read route for identity link state.");
assert.match(playerRoute, /request\.method === "POST"/, "Current players need a private claim request route.");
assert.match(playerRoute, /getSessionUser/, "Player identity routes must require the logged-in Discord account.");
assert.match(playerRoute, /isSameOriginMutation/, "Player identity claims must reject cross-origin mutations.");
assert.match(playerRoute, /readBoundedJson<ClaimBody>\(request, 4096\)/, "Player identity claim bodies must be bounded.");
assert.match(playerRoute, /privateNoStoreHeaders\(\)/, "Player identity responses must be private no-store.");

assert.match(ownerListRoute, /readOwnerPlayerGameIdentityClaims/, "Owners/admins need a private pending-claim queue route.");
assert.match(ownerReviewRoute, /request\.method !== "PATCH"/, "Owner/admin claim reviews must use PATCH only.");
assert.match(ownerReviewRoute, /isSameOriginMutation/, "Owner/admin claim reviews must reject cross-origin mutations.");
assert.match(ownerReviewRoute, /reviewPlayerGameIdentityClaim/, "Owner/admin claim route must use the canonical review helper.");
assert.match(ownerReviewRoute, /privateNoStoreHeaders\(\)/, "Owner/admin review responses must be private no-store.");

assert.match(helper, /parsePlayerGameIdentityClaimInput/, "Helper must parse claim inputs centrally.");
assert.match(helper, /public_slug/, "Players should be able to reference a public server slug without exposing raw internals.");
assert.match(helper, /LIMIT 2/, "Exact ADM profile lookups must reject ambiguous matches.");
assert.match(helper, /AMBIGUOUS_PLAYER_ID/, "Ambiguous identity matches must fail closed.");
assert.match(helper, /linked_servers\.id = \? OR linked_servers\.public_slug = \?/, "Claim creation must resolve one public server by exact id or public slug before writing.");
assert.match(helper, /WHERE player_profiles\.linked_server_id = \?[\s\S]*AND player_profiles\.player_id = \?/, "Claim creation must validate one exact ADM profile after server resolution.");
assert.match(helper, /player_profiles\.player_id = \?/, "Claim creation must match the exact ADM player ID.");
assert.match(helper, /requireServerOwnerOrDznAdmin/, "Claim approval must be scoped to the matching owner or DZN admin.");
assert.match(helper, /UPDATE player_profiles[\s\S]*WHERE id = \?[\s\S]*AND linked_server_id = \?[\s\S]*AND player_id = \?/, "Compatibility backfill must update player_profiles only by exact row/server/player ID.");
assert.doesNotMatch(helper, /WHERE[\s\S]{0,500}player_profiles\.player_name\s*=/i, "Identity linking must not attach accounts by player name.");
assert.doesNotMatch(helper, /lower\(player_profiles\.player_name|lower\(kill_events\.killer_name|lower\(kill_events\.victim_name/i, "Identity linking must not add case-folded name matching.");
assert.doesNotMatch(
  helper,
  /\b(?:STRIPE|checkout_session|checkout\.session|server_subscriptions|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|nitrado_connections|server_reviews|review_score|badge_awards|user_badges|dzn_season|server_war_events|ctf_tournaments|competitive_events|xp_award|calling_card_awards|dynamic_visibility_score|network_rank|rankServers)\b/i,
  "Identity linking helper must stay out of payment, owner-token, review, award, event, ranking, discovery, and competitive systems.",
);

assert.match(statBridge, /player_game_identity_links/, "Trusted stat bridge must read active verified identity links.");
assert.match(statBridge, /player_game_identity_links\.linked_server_id = player_profiles\.linked_server_id/, "Verified stat bridge must match the same server.");
assert.match(statBridge, /player_game_identity_links\.player_profile_id = player_profiles\.id/, "Verified stat bridge must match the same ADM profile row.");
assert.match(statBridge, /player_game_identity_links\.player_id = player_profiles\.player_id/, "Verified stat bridge must match the same ADM player ID.");
assert.match(statBridge, /player_game_identity_links\.status = 'active'/, "Trusted stat bridge must require active verified links.");
assert.match(statBridge, /player_game_identity_links\.revoked_at IS NULL/, "Trusted stat bridge must exclude revoked links.");
assert.match(statBridge, /player_profiles\.discord_id = \?/, "Trusted stat bridge must preserve direct Discord-linked compatibility.");
assert.match(statBridge, /readTrustedPlayerGameplayAggregateWithScope\(db, discordId, false\)/, "Trusted stat bridge must keep a safe compatibility fallback when link schema is unavailable.");
assert.doesNotMatch(statBridge, /player_profiles\.player_name\s*=|lower\(player_profiles\.player_name|lower\(kill_events/i, "Trusted stat bridge must not match gameplay rows by names.");
assert.doesNotMatch(
  statBridge,
  /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+|DELETE\s+FROM|STRIPE|checkout_session|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|nitrado_connections|server_reviews|review_score|badge_awards|dzn_season|server_war_events|ctf_tournaments|competitive_events|xp_award|calling_card_awards|dynamic_visibility_score|network_rank|rankServers)\b/i,
  "Trusted stat bridge must stay read-only and out of payment, owner-token, review, award, event, ranking, discovery, and competitive systems.",
);

assert.match(leaderboards, /function playerProfileDiscordColumnSql/, "Telemetry leaderboards must resolve public profile attribution through a guarded helper.");
assert.match(leaderboards, /player_game_identity_links\.player_profile_id = player_profiles\.id/, "Leaderboard attribution must use the verified profile-row bridge.");
assert.match(leaderboards, /player_profiles\.player_id = \$\{eventTable\}\.\$\{playerIdColumn\}/, "Kill-event attribution must still use exact per-server player IDs.");
const rankPublicPlayersSource = leaderboards.slice(
  leaderboards.indexOf("export function rankPublicPlayers"),
  leaderboards.indexOf("export function rankLongestKills"),
);
const rankSortBlock = rankPublicPlayersSource.slice(rankPublicPlayersSource.indexOf(".sort"), rankPublicPlayersSource.indexOf(".slice"));
assert.doesNotMatch(rankSortBlock, /player_game_identity_links|publicProfile|profile_href|profile_handle/i, "Verified identity links must not alter player ranking order.");

assert.match(playerHome, /PlayerGameIdentityLinks/, "Private profile page must render the verified game identity panel.");
assert.match(identityPanel, /\/api\/player\/game-identities/, "Identity panel must use the private current-user API.");
assert.match(identityPanel, /Request Approval/, "Identity panel must make the approval flow explicit.");
assert.match(identityPanel, /Names are never enough/, "Identity UI must tell players name-only matching is not accepted.");
assert.match(identityPanel, /server_slug/, "Identity UI must submit a safe public server slug reference.");
assert.match(identityPanel, /player_id/, "Identity UI must submit an exact ADM player ID.");
assert.doesNotMatch(identityPanel, /\b(?:localStorage|sessionStorage|sendBeacon|analytics|checkout|STRIPE|nitrado_connections|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns)\b/i, "Identity UI must avoid browser storage, analytics, payment, owner-token, Store, and wheel systems.");

assert.match(platformSpec, /Verified Player Game-Identity Linking\/Reconciliation/i, "Master spec must document the identity-linking slice.");
assert.match(platformSpec, /Never infer a game identity from `player_name`/, "Master spec must keep the no-name-matching rule explicit.");
assert.match(platformSpec, /does not grant server ownership, Nitrado access, owner setup, billing entitlements/i, "Master spec must keep owner/payment boundaries explicit.");
assert.match(handoff, /PR `#144` currently also uses migration number `0064`/, "Handoff must flag the migration-number conflict with the queued Comms PR.");
assert.match(packageJson, /"test:player-game-identity-linking": "tsx scripts\/test-player-game-identity-linking\.ts"/, "Dedicated game identity test script must be registered.");

assert.equal(sanitizePlayerGameIdentityServerRef(" pandora-network "), "pandora-network");
assert.equal(sanitizePlayerGameIdentityServerRef("server_123"), "server_123");
assert.equal(sanitizePlayerGameIdentityServerRef("../bad"), null);
assert.equal(sanitizePlayerGameIdentityPlayerId(" 76561198000000000 "), "76561198000000000");
assert.equal(sanitizePlayerGameIdentityPlayerId("<script>"), null);
assert.deepEqual(parsePlayerGameIdentityClaimInput({ server_slug: "pandora-network", player_id: "player-1" }), {
  ok: true,
  serverRef: "pandora-network",
  playerId: "player-1",
});
assert.deepEqual(parsePlayerGameIdentityReviewInput({ action: "approve", note: "Exact ADM proof checked." }), {
  ok: true,
  action: "approve",
  note: "Exact ADM proof checked.",
});

const rankedWithoutLinks = rankPublicPlayers([
  {
    playerName: "Linked Ace",
    serverName: "Pandora",
    serverSlug: "pandora",
    kills: 7,
    deaths: 2,
    longestKill: 95.5,
    lastSeen: "2026-09-02T10:00:00.000Z",
    discordId: "verified-discord",
  },
  {
    playerName: "Unlinked Runner",
    serverName: "Pandora",
    serverSlug: "pandora",
    kills: 6,
    deaths: 1,
    longestKill: 120,
    lastSeen: "2026-09-02T10:05:00.000Z",
    discordId: null,
  },
]);
const rankedWithLinks = rankPublicPlayers([
  {
    playerName: "Linked Ace",
    serverName: "Pandora",
    serverSlug: "pandora",
    kills: 7,
    deaths: 2,
    longestKill: 95.5,
    lastSeen: "2026-09-02T10:00:00.000Z",
    discordId: "verified-discord",
  },
  {
    playerName: "Unlinked Runner",
    serverName: "Pandora",
    serverSlug: "pandora",
    kills: 6,
    deaths: 1,
    longestKill: 120,
    lastSeen: "2026-09-02T10:05:00.000Z",
    discordId: null,
  },
], 10, new Map([["verified-discord", { handle: "linked-ace", href: "/players/linked-ace" }]]));
assert.deepEqual(
  rankedWithLinks.map(({ rank, player_name, kills, deaths, kd_label, longest_kill }) => ({ rank, player_name, kills, deaths, kd_label, longest_kill })),
  rankedWithoutLinks.map(({ rank, player_name, kills, deaths, kd_label, longest_kill }) => ({ rank, player_name, kills, deaths, kd_label, longest_kill })),
  "Verified profile links must not change ranking metrics.",
);
assert.equal(rankedWithLinks[0].public_profile_href, "/players/linked-ace");
assert.equal(JSON.stringify(rankedWithLinks).includes("verified-discord"), false, "Leaderboard payloads must not expose Discord IDs.");

console.log("Player game identity linking guardrail tests passed.");
