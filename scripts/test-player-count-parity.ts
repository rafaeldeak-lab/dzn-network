import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
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

const homeStatsSource = readFileSync("functions/api/public/home-stats.ts", "utf8");
const publicServersSource = readFileSync("functions/api/public/servers.ts", "utf8");
const serverMetadataSource = readFileSync("functions/_lib/server-metadata.ts", "utf8");

assert.equal(homeStatsSource.includes("PUBLIC_CURRENT_PLAYERS_SQL"), true, "Home stats must use the shared fresh player count SQL.");
assert.equal(homeStatsSource.includes("PUBLIC_PLAYER_COUNT_FRESH_SQL"), true, "Home stats must count fresh/stale player sources explicitly.");
assert.equal(publicServersSource.includes("PUBLIC_CURRENT_PLAYERS_SQL"), true, "Public servers must use the shared fresh player count SQL.");
assert.equal(publicServersSource.includes("PUBLIC_PLAYER_COUNT_STATUS_SQL"), true, "Public servers must expose computed freshness status.");
assert.equal(serverMetadataSource.includes("syncPublicCacheFromMetadataRefresh"), true, "Metadata refresh should keep public cache in sync.");
assert.equal(serverMetadataSource.includes("metadata.player_count_status !== \"fresh\""), true, "Only confirmed fresh Nitrado counts should update public cache.");

console.log("Player count parity tests passed.");
