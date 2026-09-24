import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parsePlayerGameIdentityClaimInput,
  parsePlayerGameIdentityReviewInput,
  sanitizePlayerGameIdentityPlayerId,
  sanitizePlayerGameIdentityServerRef,
} from "../functions/_lib/player-game-identities";
import { rankPublicPlayers } from "../functions/_lib/public-leaderboards";
import { testPlayerGameIdentityReadModels } from "./test-player-game-identity-read-model";
import { testPlayerGameIdentityNotifications } from "./test-player-game-identity-notifications";

const migration = readFileSync("migrations/0064_player_game_identity_links.sql", "utf8");
const helper = readFileSync("functions/_lib/player-game-identities.ts", "utf8");
const playerRoute = readFileSync("functions/api/player/game-identities.ts", "utf8");
const ownerListRoute = readFileSync("functions/api/owner/player-game-identity-claims.ts", "utf8");
const ownerReviewRoute = readFileSync("functions/api/owner/player-game-identity-claims/[claimId].ts", "utf8");
const decisionNotifications = readFileSync("functions/_lib/player-game-identity-notifications.ts", "utf8");
const statBridge = readFileSync("functions/_lib/player-stat-bridge.ts", "utf8");
const leaderboards = readFileSync("functions/_lib/public-leaderboards.ts", "utf8");
const playerHome = readFileSync("components/player/player-home.tsx", "utf8");
const identityPanel = readFileSync("components/player/player-game-identity-links.tsx", "utf8");
const ownerClaimPage = readFileSync("components/owner/player-game-identity-claims-page.tsx", "utf8");
const ownerClaimRoutePage = readFileSync("app/owner/player-game-identity-claims/page.tsx", "utf8");
const revocationHelper = readFileSync("functions/_lib/player-game-identity-revocation.ts", "utf8");
const ownerConsole = readFileSync("components/owner/owner-console.tsx", "utf8");
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
assert.match(ownerReviewRoute, /waitUntil\(dispatchPlayerGameIdentityDecisionDiscord\(env, delivery\)\)/, "Discord delivery must run after the durable decision without delaying the response.");
assert.match(ownerReviewRoute, /const \{ delivery, \.\.\.publicResult \} = result/, "Internal Discord delivery details must be removed from the public response.");
assert.match(ownerReviewRoute, /return json\(publicResult,/, "Successful review responses must contain only the public decision result.");
assert.match(ownerClaimRoutePage, /PlayerGameIdentityClaimsPage/, "Owners/admins need a durable review queue route.");
assert.match(ownerConsole, /\/owner\/player-game-identity-claims/, "Owner console must expose the player stat claim review queue.");

assert.match(helper, /parsePlayerGameIdentityClaimInput/, "Helper must parse claim inputs centrally.");
assert.match(helper, /public_slug/, "Players should be able to reference a public server slug without exposing raw internals.");
assert.match(helper, /LIMIT 2/, "Exact ADM profile lookups must reject ambiguous matches.");
assert.match(helper, /AMBIGUOUS_PLAYER_REFERENCE/, "Ambiguous gamertag or identity matches must fail closed.");
assert.match(helper, /submitted_player_id:\s*row\.player_id/, "Private owner/admin review payloads must expose the resolved exact game ID for troubleshooting.");
assert.match(helper, /claim:\s*sanitizeClaimRows\(\[claim\]\)\[0\]/, "Player-facing claim responses must mask the resolved hidden game ID.");
assert.match(helper, /request_source=\$\{parsed\.requestSource\}/, "Claim audit history must retain whether the request began as a gamertag lookup or legacy exact-ID request.");
assert.match(helper, /review_context/, "Owner/admin claim rows must include review troubleshooting context.");
assert.match(helper, /missing_evidence_guidance/, "Owner/admin review context must explain what evidence is missing.");
assert.match(helper, /Only this server owner or a DZN admin can review that claim/, "Cross-owner claim reviews must stay denied server-side.");
assert.match(helper, /linked_servers\.id = \? OR linked_servers\.public_slug = \?/, "Claim creation must resolve one public server by exact id or public slug before writing.");
assert.match(helper, /WHERE player_profiles\.linked_server_id = \?[\s\S]*AND player_profiles\.player_id = \?/, "Claim creation must validate one exact ADM profile after server resolution.");
assert.match(helper, /player_profiles\.player_id = \?/, "Claim creation must match the exact ADM player ID.");
assert.match(helper, /lower\(trim\(player_profiles\.player_name\)\) = lower\(trim\(\?\)\)/, "Claim creation may resolve one server-scoped visible gamertag to a review candidate.");
assert.match(helper, /LIMIT 2/, "Gamertag resolution must detect duplicates and fail closed.");
assert.match(helper, /requireServerOwnerOrDznAdmin/, "Claim approval must be scoped to the matching owner or DZN admin.");
assert.match(helper, /INSERT OR IGNORE INTO user_notifications/, "Approval and rejection must create one durable private website notification.");
assert.match(helper, /player-link-decision:\$\{claim\.id\}:\$\{action\}/, "Decision notifications must use a stable dedupe key.");
assert.match(helper, /\/player\/profile#game-account/, "Decision notifications must link players to their game-account panel.");
assert.match(decisionNotifications, /isDiscordNotificationsEnabled\(env\)/, "Discord decision delivery must remain explicitly feature-gated through the typed flag helper.");
assert.match(decisionNotifications, /\/users\/@me\/channels/, "Discord decision delivery must open a private DM channel.");
assert.match(decisionNotifications, /allowed_mentions:\s*\{ parse: \[\] \}/, "Discord decision messages must disable mentions.");
assert.doesNotMatch(decisionNotifications, /console\.(?:log|error|warn)/, "Discord decision delivery must not log private payloads or credentials.");
assert.doesNotMatch(helper, /UPDATE player_profiles|SET discord_id/, "New approvals must not create an untracked second stats attribution.");
assert.match(helper, /p\.id = player_game_identity_claims\.player_profile_id[\s\S]*p\.player_id = player_game_identity_claims\.player_id/, "Approval must revalidate the exact imported profile row and hidden player ID, never the gamertag alone.");
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
assert.match(identityPanel, /\/api\/public\/servers\?limit=120/, "Identity panel must load public server choices for a simpler player picker.");
assert.match(identityPanel, /Link My Game Stats/, "Identity panel must use simple player-facing wording.");
assert.match(identityPanel, /Choose server/, "Identity panel must ask players to choose a server instead of understanding slugs.");
assert.match(identityPanel, /Search for your server/, "Identity panel must support searchable server selection.");
assert.match(identityPanel, /DayZ gamertag on this server/, "Identity panel must ask for the visible server gamertag.");
assert.match(identityPanel, /Send For Check/, "Identity panel must make the owner/admin check flow explicit.");
assert.match(revocationHelper, /\/player\/profile#game-account/, "Revocation notifications must open the affected Game Account section.");
assert.match(identityPanel, /server_slug/, "Identity UI must still submit a safe public server slug reference internally.");
assert.match(identityPanel, /player_reference/, "Identity UI must submit the visible gamertag as an untrusted lookup reference.");
assert.doesNotMatch(identityPanel, /Server slug or DZN server ID/, "Player-facing UI must not ask normal players to understand server slugs.");
assert.doesNotMatch(identityPanel, /Use the public server slug from the server page/, "Player-facing UI must not expose the old slug instructions.");
assert.doesNotMatch(identityPanel, /Private Proof Flow/, "Player-facing UI should use owner-checked language instead of technical proof-flow copy.");
assert.doesNotMatch(identityPanel, /\b(?:localStorage|sessionStorage|sendBeacon|analytics|checkout|STRIPE|nitrado_connections|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns)\b/i, "Identity UI must avoid browser storage, analytics, payment, owner-token, Store, and wheel systems.");

assert.match(ownerClaimPage, /\/api\/owner\/player-game-identity-claims/, "Owner/admin troubleshooting UI must read the private claim queue.");
assert.match(ownerClaimPage, /Decision History/, "Authenticated owners need a visible approval and revocation history view.");
assert.match(ownerClaimPage, /Resolved exact game ID/, "Decision history must identify the exact game account that was reviewed without claiming the player submitted it.");
assert.match(ownerClaimPage, /Recorded reason/, "Decision history must expose the stored approval, rejection or revocation reason.");
assert.match(ownerClaimPage, /Load older decisions/, "Decision history must allow owners to inspect records beyond the first page.");
assert.match(helper, /COALESCE\(claims\.discord_id, links\.discord_id\)/, "Revocation history must fall back to the linked Discord identity.");
assert.match(helper, /datetime\(audit\.created_at\) < datetime\(\?\)/, "Decision history must use a stable keyset cursor instead of clamped offsets.");
assert.match(ownerClaimPage, /method: "PATCH"/, "Owner/admin troubleshooting UI must use the existing review PATCH route.");
assert.match(ownerClaimPage, /Resolved exact game ID/, "Owner/admin troubleshooting UI must show the exact resolved game ID.");
assert.match(ownerClaimPage, /Public-safe masked ID/, "Owner/admin troubleshooting UI must distinguish masked player-safe IDs from owner-only exact IDs.");
assert.match(ownerClaimPage, /Gamertags never auto-link/, "Owner review UI must state that a gamertag lookup is only a candidate.");
assert.match(ownerClaimPage, /verify ownership independently/, "Owner review UI must require evidence independent of the public gamertag.");
assert.match(ownerClaimPage, /Approve Link/, "Owner/admin troubleshooting UI must make approval clear.");
assert.match(ownerClaimPage, /Reject Request/, "Owner/admin troubleshooting UI must make rejection clear.");
assert.match(ownerClaimPage, /gamertag can locate a candidate but is never proof/i, "Owner/admin troubleshooting UI must warn that names are not proof.");
assert.match(ownerClaimPage, /Missing evidence/, "Owner/admin troubleshooting UI must explain missing evidence.");
assert.match(ownerClaimPage, /credentials: "include"/, "Owner/admin troubleshooting UI must preserve authenticated private requests.");
assert.doesNotMatch(
  ownerClaimPage,
  /\b(?:localStorage|sessionStorage|sendBeacon|analytics|STRIPE|checkout_session|server_subscriptions|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns|nitrado_connections|server_reviews|review_score|badge_awards|user_badges|dzn_season|server_war_events|ctf_tournaments|competitive_events|xp_award|calling_card_awards|dynamic_visibility_score|network_rank|rankServers)\b/i,
  "Owner/admin troubleshooting UI must avoid browser storage, analytics, payment, owner-token, review, award, event, ranking, discovery, and competitive systems.",
);
assert.doesNotMatch(
  ownerClaimPage,
  /\/api\/(?:billing|checkout|stripe|nitrado|reviews|events|leaderboards|public|player\/profile)/i,
  "Owner/admin troubleshooting UI must only call the private identity-claim owner API.",
);

assert.match(platformSpec, /Verified Player Game-Identity Linking\/Reconciliation/i, "Master spec must document the identity-linking slice.");
assert.match(platformSpec, /Never approve or attach a game identity from `player_name`/, "Master spec must keep the no-name-approval rule explicit.");
assert.match(platformSpec, /does not grant server ownership, Nitrado access, owner setup, billing entitlements/i, "Master spec must keep owner/payment boundaries explicit.");
assert.match(platformSpec, /\/owner\/player-game-identity-claims/, "Master spec must document the private owner/admin troubleshooting queue.");
assert.match(platformSpec, /Exact submitted game IDs are allowed only in the private owner\/admin review queue/, "Master spec must document the exact-ID exposure boundary.");
assert.match(handoff, /PR `#144` currently also uses migration number `0064`/, "Handoff must flag the migration-number conflict with the queued Comms PR.");
assert.match(handoff, /private troubleshooting queue/, "Handoff must document the owner/admin troubleshooting queue.");
assert.match(packageJson, /"test:player-game-identity-linking": "tsx scripts\/test-player-game-identity-linking\.ts"/, "Dedicated game identity test script must be registered.");

assert.equal(sanitizePlayerGameIdentityServerRef(" pandora-network "), "pandora-network");
assert.equal(sanitizePlayerGameIdentityServerRef("server_123"), "server_123");
assert.equal(sanitizePlayerGameIdentityServerRef("../bad"), null);
assert.equal(sanitizePlayerGameIdentityPlayerId(" 76561198000000000 "), "76561198000000000");
assert.equal(sanitizePlayerGameIdentityPlayerId("<script>"), null);
assert.deepEqual(parsePlayerGameIdentityClaimInput({ server_slug: "pandora-network", player_id: "player-1" }), {
  ok: true,
  serverRef: "pandora-network",
  playerReference: "player-1",
  requestSource: "legacy_exact_id",
});
assert.deepEqual(parsePlayerGameIdentityClaimInput({ server_slug: "pandora-network", player_reference: " xAKA-MINI_KickAs " }), {
  ok: true,
  serverRef: "pandora-network",
  playerReference: "xAKA-MINI_KickAs",
  requestSource: "gamertag_lookup",
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

void testPlayerGameIdentityReadModels().then(testPlayerGameIdentityNotifications).then(() => {
  console.log("Player game identity linking guardrails and database privacy tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
