import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyPublicPlayerCountSummaryToHomeStats,
  resolveFreshPublicPlayerCount,
  sumFreshPublicPlayers,
} from "../functions/_lib/player-counts";

const now = Date.parse("2026-06-06T12:00:00.000Z");
const fresh = "2026-06-06T11:55:00.000Z";
const stale = "2026-06-04T16:28:31.910Z";

const confirmedZero = resolveFreshPublicPlayerCount({
  linkedCurrentPlayers: 0,
  linkedMaxPlayers: 22,
  linkedCheckedAt: fresh,
  linkedStatus: "fresh",
  cacheCurrentPlayers: 3,
  cacheMaxPlayers: 22,
  cacheCheckedAt: stale,
}, now);
assert.equal(confirmedZero.currentPlayers, 0, "Confirmed linked zero must not fall back to stale cache value.");
assert.equal(confirmedZero.source, "linked_servers");

const staleOnly = resolveFreshPublicPlayerCount({
  linkedCurrentPlayers: 3,
  linkedMaxPlayers: 22,
  linkedCheckedAt: stale,
  linkedStatus: "fresh",
  cacheCurrentPlayers: 3,
  cacheMaxPlayers: 22,
  cacheCheckedAt: stale,
}, now);
assert.equal(staleOnly.currentPlayers, null, "Stale player counts must not be treated as live online players.");
assert.equal(staleOnly.status, "stale");

const freshCacheFallback = resolveFreshPublicPlayerCount({
  linkedCurrentPlayers: null,
  linkedMaxPlayers: 10,
  linkedCheckedAt: stale,
  linkedStatus: "stale",
  cacheCurrentPlayers: 2,
  cacheMaxPlayers: 10,
  cacheCheckedAt: fresh,
}, now);
assert.equal(freshCacheFallback.currentPlayers, 2, "Fresh cache can be used only when linked metadata is not fresh.");
assert.equal(freshCacheFallback.source, "server_public_cache");

const total = sumFreshPublicPlayers([
  {
    linkedCurrentPlayers: 0,
    linkedCheckedAt: fresh,
    linkedStatus: "fresh",
    cacheCurrentPlayers: 3,
    cacheCheckedAt: stale,
  },
  {
    linkedCurrentPlayers: 3,
    linkedCheckedAt: stale,
    linkedStatus: "fresh",
    cacheCurrentPlayers: 3,
    cacheCheckedAt: stale,
  },
  {
    linkedCurrentPlayers: null,
    linkedCheckedAt: stale,
    linkedStatus: "unknown",
    cacheCurrentPlayers: 2,
    cacheCheckedAt: fresh,
  },
], now);
assert.equal(total, 2, "Home stats total must equal the sum of fresh active public server counts.");

const zeroToOnePayload = applyPublicPlayerCountSummaryToHomeStats({
  totals: {
    players_online: 0,
    currentPlayersOnline: 0,
    killsTracked: 785,
  } as Record<string, unknown>,
}, {
  totalPlayersOnline: 1,
  maxPlayersCapacity: 10,
  freshServers: 1,
  staleServers: 0,
  newestPlayerMetadataAt: fresh,
  oldestIncludedPlayerMetadataAt: fresh,
  contributingServers: [{
    serverId: "nuketown",
    serverName: "NukeTown DEATHMATCH",
    serviceId: "18765761",
    currentPlayers: 1,
    maxPlayers: 10,
    checkedAt: fresh,
    source: "linked_servers",
  }],
  excludedStaleServers: [],
});
assert.equal(zeroToOnePayload.totals.players_online, 1, "Fresh 0 -> 1 metadata must update cached home-stats player total.");
assert.equal(zeroToOnePayload.totals.currentPlayersOnline, 1);
assert.equal(zeroToOnePayload.totals.killsTracked, 785, "Player-count patch must not alter ADM kill totals.");

const oneToZeroPayload = applyPublicPlayerCountSummaryToHomeStats({
  totals: {
    players_online: 1,
    currentPlayersOnline: 1,
    killsTracked: 785,
  } as Record<string, unknown>,
}, {
  totalPlayersOnline: 0,
  maxPlayersCapacity: 32,
  freshServers: 2,
  staleServers: 1,
  newestPlayerMetadataAt: fresh,
  oldestIncludedPlayerMetadataAt: fresh,
  contributingServers: [
    {
      serverId: "pandora",
      serverName: "PANDORA DayZ",
      serviceId: "17428528",
      currentPlayers: 0,
      maxPlayers: 22,
      checkedAt: fresh,
      source: "linked_servers",
    },
    {
      serverId: "nuketown",
      serverName: "NukeTown DEATHMATCH",
      serviceId: "18765761",
      currentPlayers: 0,
      maxPlayers: 10,
      checkedAt: fresh,
      source: "linked_servers",
    },
  ],
  excludedStaleServers: [{
    serverId: "warlords",
    serverName: "Warlords PvP",
    serviceId: "900002",
    checkedAt: stale,
  }],
});
assert.equal(oneToZeroPayload.totals.players_online, 0, "Fresh 1 -> 0 metadata must update cached home-stats player total.");
assert.equal(oneToZeroPayload.totals.playerCountFreshServers, 2);
assert.equal(oneToZeroPayload.totals.playerCountStaleServers, 1);
assert.equal(oneToZeroPayload.totals.killsTracked, 785, "Player-count patch must preserve existing ADM totals.");

const homeStatsSource = readFileSync("functions/api/public/home-stats.ts", "utf8");
const publicServersSource = readFileSync("functions/api/public/servers.ts", "utf8");
const serverMetadataSource = readFileSync("functions/_lib/server-metadata.ts", "utf8");
const playerCountsSource = readFileSync("functions/_lib/player-counts.ts", "utf8");

assert.equal(homeStatsSource.includes("PUBLIC_CURRENT_PLAYERS_SQL"), true, "Home stats must use the shared fresh player count SQL.");
assert.equal(homeStatsSource.includes("PUBLIC_PLAYER_COUNT_FRESH_SQL"), true, "Home stats must count fresh/stale player sources explicitly.");
assert.equal(homeStatsSource.includes("refreshHomeStatsPlayerCounts"), true, "Cached home-stats snapshots must receive a fresh player-count overlay.");
assert.equal(publicServersSource.includes("PUBLIC_CURRENT_PLAYERS_SQL"), true, "Public servers must use the shared fresh player count SQL.");
assert.equal(publicServersSource.includes("PUBLIC_PLAYER_COUNT_STATUS_SQL"), true, "Public servers must expose computed freshness status.");
assert.equal(serverMetadataSource.includes("syncPublicCacheFromMetadataRefresh"), true, "Metadata refresh should keep public cache in sync.");
assert.equal(serverMetadataSource.includes("patchHomeStatsPlayerCountsFromFreshMetadata"), true, "Metadata refresh should patch home-stats player snapshots.");
assert.equal(serverMetadataSource.includes("metadata.player_count_status !== \"fresh\""), true, "Only confirmed fresh Nitrado counts should update public cache.");
assert.equal(playerCountsSource.includes("getPublicPlayerCountSummary"), true, "Player counts should have a canonical public summary helper.");
assert.equal(playerCountsSource.includes("writePublicApiCache(env, snapshot.key"), true, "Home-stats snapshot player counts should be refreshed after metadata updates.");

console.log("Player count parity tests passed.");
