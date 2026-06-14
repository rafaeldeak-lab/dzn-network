import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detectServerModeFromText, parseNitradoPlayerCountPair, resolveLivePlayerCounts } from "../functions/_lib/server-metadata";

assert.equal(detectServerModeFromText(["NukeTown DEATHMATCH"]), "DEATHMATCH");
assert.equal(detectServerModeFromText(["Weekend raids KOS faction wars"]), "PVP");
assert.equal(detectServerModeFromText(["No KOS roleplay survival"]), "PVE");
assert.equal(detectServerModeFromText(["PvP weekdays and PvE safe zones"]), "PVP / PVE");
assert.equal(detectServerModeFromText(["quiet community server"]), "SURVIVAL");

assert.deepEqual(parseNitradoPlayerCountPair("2/10"), { current: 2, max: 10 });
assert.deepEqual(parseNitradoPlayerCountPair("0 / 22"), { current: 0, max: 22 });
assert.deepEqual(resolveLivePlayerCounts({
  currentPlayers: 2,
  maxPlayers: 10,
  existingCurrentPlayers: 0,
  existingMaxPlayers: 22,
}), {
  current_players: 2,
  max_players: 10,
  currentMissing: false,
  maxMissing: false,
  player_count_status: "fresh",
});
assert.deepEqual(resolveLivePlayerCounts({
  currentPlayers: undefined,
  maxPlayers: undefined,
  existingCurrentPlayers: 2,
  existingMaxPlayers: 10,
}), {
  current_players: 2,
  max_players: 10,
  currentMissing: true,
  maxMissing: true,
  player_count_status: "stale",
});
assert.deepEqual(resolveLivePlayerCounts({
  currentPlayers: 0,
  maxPlayers: 10,
  existingCurrentPlayers: 2,
  existingMaxPlayers: 22,
}), {
  current_players: 0,
  max_players: 10,
  currentMissing: false,
  maxMissing: false,
  player_count_status: "fresh",
});

const admSyncSource = readFileSync("functions/_lib/adm-sync.ts", "utf8");
assert.equal(admSyncSource.includes("force: triggerType === \"manual\" || triggerType === \"scheduled\""), true);
assert.equal(admSyncSource.includes("softFail: true"), true);
assert.equal(admSyncSource.includes("refreshLivePlayerCountsForActiveServers"), true);
assert.equal(admSyncSource.includes("metadata,"), true);
const serverMetadataSource = readFileSync("functions/_lib/server-metadata.ts", "utf8");
assert.equal(serverMetadataSource.includes("DZN LIVE PLAYER COUNT AUTO REFRESH READY"), true);
assert.equal(serverMetadataSource.includes("DZN LIVE PLAYER COUNT AUTO SYNC READY"), true);
assert.equal(serverMetadataSource.includes("DZN METADATA SYNC INDEPENDENT OF ADM READY"), true);
assert.equal(serverMetadataSource.includes("DZN LIVE NITRADO PLAYER COUNT SYNC FIXED"), true);
assert.equal(serverMetadataSource.includes("DZN EXPLICIT ZERO PLAYER COUNT HANDLED"), true);
assert.equal(serverMetadataSource.includes("DZN PLAYER COUNT REFRESH INDEPENDENT OF ADM"), true);
assert.equal(serverMetadataSource.includes("DZN PLAYER COUNT METADATA MISSING"), true);
assert.equal(serverMetadataSource.includes("player_count_status: PlayerCountStatus"), true);
assert.equal(serverMetadataSource.includes("currentMissing = rawCurrent === null"), true);
assert.equal(serverMetadataSource.includes("skipFreshWithinMs"), true);
const metadataRunSource = readFileSync("functions/api/sync/metadata/run.ts", "utf8");
assert.equal(metadataRunSource.includes("onRequestPost"), true);
assert.equal(metadataRunSource.includes("isMetadataCronAuthorized"), true);
assert.equal(metadataRunSource.includes("Authorization"), false);
assert.equal(metadataRunSource.includes("DZN LIVE PLAYER COUNT AUTO SYNC READY"), true);
assert.equal(metadataRunSource.includes("DZN METADATA SYNC INDEPENDENT OF ADM READY"), true);
assert.equal(metadataRunSource.includes("player_count_stale_ms"), true);
assert.equal(metadataRunSource.includes("livePlayerCountStaleMs"), true);
const workflowSource = readFileSync(".github/workflows/dzn-adm-sync.yml", "utf8");
const admCallIndex = workflowSource.indexOf("/api/sync/adm/run");
assert.equal(workflowSource.includes("/api/sync/metadata/run"), false);
assert.equal(admCallIndex >= 0, true);
assert.equal(workflowSource.includes("curl --fail-with-body"), false);
assert.equal(workflowSource.includes("Metadata sync: skipped; status=handled by dedicated metadata cadence outside ADM backup workflow"), true);
const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardSource.includes("Player Count Freshness"), true);
assert.equal(dashboardSource.includes("formatDashboardPlayerSlots"), true);
assert.equal(dashboardSource.includes("Last known:"), true);
assert.equal(dashboardSource.includes("Live player count stale."), true);
assert.equal(dashboardSource.includes("void onRefreshRef.current()"), true);
const homepageSource = readFileSync("components/dzn/dzn-landing-page.tsx", "utf8");
const networkOverviewBlock = homepageSource.slice(
  homepageSource.indexOf("function NetworkOverview"),
  homepageSource.indexOf("function NetworkPulse"),
);
assert.equal(homepageSource.includes("value: dataPending ? \"Syncing\" : formatNumber(playersOnline)"), true);
assert.equal(homepageSource.includes("Awaiting ADM data"), false);
assert.equal(homepageSource.includes("DZN HOMEPAGE PLAYERS ONLINE ONLY"), true);
assert.equal(homepageSource.includes("Live across connected servers"), true);
assert.equal(homepageSource.includes("total slots"), false);
assert.equal(homepageSource.includes("`${formatNumber(currentPlayersOnline)} /"), false);
assert.equal(networkOverviewBlock.includes("maxPlayersCapacity"), false);
assert.equal(networkOverviewBlock.toLowerCase().includes("capacity"), false);
assert.equal(networkOverviewBlock.toLowerCase().includes("slots"), false);
const homeStatsSource = readFileSync("functions/api/public/home-stats.ts", "utf8");
assert.equal(homeStatsSource.includes("PUBLIC_CURRENT_PLAYERS_SQL"), true);
assert.equal(homeStatsSource.includes("PUBLIC_PLAYER_COUNT_FRESH_SQL"), true);
assert.equal(homeStatsSource.includes("SUM(COALESCE(server_stats.unique_players, 0)) AS playersSeenFromStats"), true);
assert.equal(homeStatsSource.includes("playerCountFreshServers"), true);
assert.equal(homeStatsSource.includes("playerCountStaleServers"), true);
const publicServersSource = readFileSync("functions/api/public/servers.ts", "utf8");
assert.equal(publicServersSource.includes("player_count_last_checked_at"), true);
assert.equal(publicServersSource.includes("player_count_status"), true);
assert.equal(publicServersSource.includes("server_public_cache"), true);
const publicNetworkSource = readFileSync("components/network/public-network.tsx", "utf8");
assert.equal(publicNetworkSource.includes("PUBLIC_NETWORK_LIVE_REFRESH_MS"), true);
assert.equal(publicNetworkSource.includes("setReloadNonce((value) => value + 1)"), true);
const auditSource = readFileSync("scripts/adm-audit-health.ts", "utf8");
assert.equal(auditSource.includes("Player count last checked"), true);
assert.equal(auditSource.includes("player_count_status"), true);
assert.equal(auditSource.includes("Nitrado returned current players this check"), true);
assert.equal(auditSource.includes("Recommended player count action"), true);
const playerCountAuditSource = readFileSync("scripts/audit-player-counts.ts", "utf8");
assert.equal(playerCountAuditSource.includes("DZN player count audit dry run."), true);
assert.equal(playerCountAuditSource.includes("Nitrado returned current player count"), true);
assert.equal(playerCountAuditSource.includes("Recommended action"), true);
const packageSource = readFileSync("package.json", "utf8");
assert.equal(packageSource.includes("\"player-counts:audit\": \"tsx scripts/audit-player-counts.ts\""), true);

console.log("Server metadata mode and live player count tests passed.");
