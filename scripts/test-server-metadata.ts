import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detectServerModeFromText, parseNitradoPlayerCountPair, resolveLivePlayerCounts } from "../functions/_lib/server-metadata";

assert.equal(detectServerModeFromText(["NukeTown DEATHMATCH"]), "DEATHMATCH");
assert.equal(detectServerModeFromText(["Weekend raids KOS faction wars"]), "PVP");
assert.equal(detectServerModeFromText(["No KOS roleplay survival"]), "PVE");
assert.equal(detectServerModeFromText(["PvP weekdays and PvE safe zones"]), "PVP / PVE");
assert.equal(detectServerModeFromText(["quiet community server"]), "SURVIVAL");

assert.deepEqual(parseNitradoPlayerCountPair("2/10"), { current: 2, max: 10 });
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
const serverMetadataSource = readFileSync("functions/_lib/server-metadata.ts", "utf8");
assert.equal(serverMetadataSource.includes("DZN LIVE PLAYER COUNT AUTO REFRESH READY"), true);
assert.equal(serverMetadataSource.includes("DZN PLAYER COUNT METADATA MISSING"), true);
assert.equal(serverMetadataSource.includes("player_count_status: PlayerCountStatus"), true);
const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardSource.includes("Player Count Freshness"), true);
assert.equal(dashboardSource.includes("formatPlayerSlots(server.current_players, server.max_players ?? server.player_slots)"), true);
const homepageSource = readFileSync("components/dzn/dzn-landing-page.tsx", "utf8");
const networkOverviewBlock = homepageSource.slice(
  homepageSource.indexOf("function NetworkOverview"),
  homepageSource.indexOf("function NetworkPulse"),
);
assert.equal(homepageSource.includes("value: formatNumber(playersOnline)"), true);
assert.equal(homepageSource.includes("DZN HOMEPAGE PLAYERS ONLINE ONLY"), true);
assert.equal(homepageSource.includes("Live across connected servers"), true);
assert.equal(homepageSource.includes("total slots"), false);
assert.equal(homepageSource.includes("`${formatNumber(currentPlayersOnline)} /"), false);
assert.equal(networkOverviewBlock.includes("maxPlayersCapacity"), false);
assert.equal(networkOverviewBlock.toLowerCase().includes("capacity"), false);
assert.equal(networkOverviewBlock.toLowerCase().includes("slots"), false);
const homeStatsSource = readFileSync("functions/api/public/home-stats.ts", "utf8");
assert.equal(homeStatsSource.includes("SUM(COALESCE(linked_servers.current_players, 0)) AS players_online"), true);
assert.equal(homeStatsSource.includes("SUM(COALESCE(linked_servers.current_players, 0)) AS currentPlayersOnline"), true);
assert.equal(homeStatsSource.includes("SUM(COALESCE(server_stats.unique_players, 0)) AS playersSeenFromStats"), true);
const auditSource = readFileSync("scripts/adm-audit-health.ts", "utf8");
assert.equal(auditSource.includes("Player count last checked"), true);
assert.equal(auditSource.includes("player_count_status"), true);

console.log("Server metadata mode and live player count tests passed.");
