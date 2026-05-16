import assert from "node:assert/strict";

import { calculateKd, calculateServerScore, calculateServerScoreBreakdown, rankLongestKills, rankPublicPlayers, selectLatestKill } from "../functions/_lib/public-leaderboards";
import { rankServers } from "../functions/_lib/server-ranking";

const players = rankPublicPlayers([
  {
    playerName: "xAKA-MINI_KickAs",
    serverName: "NukeTown DEATHMATCH",
    serverSlug: "nuketown-deathmatch",
    kills: 8,
    deaths: 2,
    longestKill: 17.4068,
    lastSeen: "2026-05-15T19:58:08.000Z",
  },
  {
    playerName: "Netfl1xAndK1II",
    serverName: "NukeTown DEATHMATCH",
    serverSlug: "nuketown-deathmatch",
    kills: 2,
    deaths: 8,
    longestKill: 6.96356,
    lastSeen: "2026-05-15T19:54:58.000Z",
  },
]);

assert.equal(players.length, 2);
assert.equal(players[0].rank, 1);
assert.equal(players[0].player_name, "xAKA-MINI_KickAs");
assert.equal(players[0].kills, 8);
assert.equal(players[0].deaths, 2);
assert.equal(players[0].kd, 4);
assert.equal(players[0].kd_label, "4.00");
assert.equal(players[0].longest_kill, 17.4);
assert.equal(players[1].kd, 0.25);

assert.deepEqual(calculateKd(0, 0), { value: null, label: "Awaiting data" });
assert.deepEqual(calculateKd(4, 0), { value: 4, label: "Flawless" });
assert.deepEqual(calculateKd(2, 8), { value: 0.25, label: "0.25" });

const killRows = [
  {
    player_key: "6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q=",
    player_name: "xAKA-MINI_KickAs",
    victim_name: "Netfl1xAndK1II",
    server_name: "NukeTown DEATHMATCH",
    server_slug: "nuketown-deathmatch",
    weapon: "M4-A1",
    distance: 9.97779,
    occurred_at: "2026-05-15T19:47:32.000Z",
  },
  {
    player_key: "A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk=",
    player_name: "Netfl1xAndK1II",
    victim_name: "xAKA-MINI_KickAs",
    server_name: "NukeTown DEATHMATCH",
    server_slug: "nuketown-deathmatch",
    weapon: "M4-A1",
    distance: 6.96356,
    occurred_at: "2026-05-15T19:45:34.000Z",
  },
  {
    player_key: "6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q=",
    player_name: "xAKA-MINI_KickAs",
    victim_name: "Netfl1xAndK1II",
    server_name: "NukeTown DEATHMATCH",
    server_slug: "nuketown-deathmatch",
    weapon: "M4-A1",
    distance: 17.4068,
    occurred_at: "2026-05-15T19:54:19.000Z",
  },
  {
    player_key: "runner_9_5",
    player_name: "runner_9_5",
    victim_name: "femboi_fkcerxX",
    server_name: "NukeTown DEATHMATCH",
    server_slug: "nuketown-deathmatch",
    weapon: "M4-A1",
    distance: 2.4,
    occurred_at: "2026-05-15T19:59:19.000Z",
  },
];

const longestKills = rankLongestKills(killRows);

assert.equal(longestKills[0].player_name, "xAKA-MINI_KickAs");
assert.equal(longestKills[0].distance, 17.4);
assert.equal(longestKills[0].weapon, "M4-A1");
assert.equal(longestKills.filter((kill) => kill.player_name === "xAKA-MINI_KickAs").length, 1);
assert.equal(new Set(longestKills.map((kill) => kill.player_name)).size, longestKills.length);

const latestKill = selectLatestKill(killRows);
assert.equal(latestKill?.player_name, "runner_9_5");
assert.equal(latestKill?.victim_name, "femboi_fkcerxX");

const score = calculateServerScore({
  kills: 11,
  deaths: 11,
  longestKill: 17.4068,
  uniquePlayers: 9,
  joins: 22,
  statsSyncActive: true,
});
assert.equal(score, 219);

const scoreBreakdown = calculateServerScoreBreakdown({
  kills: 11,
  deaths: 11,
  longestKill: 17.4068,
  uniquePlayers: 9,
  joins: 22,
  statsSyncActive: true,
});
assert.deepEqual(scoreBreakdown, {
  kills_points: 110,
  unique_players_points: 45,
  joins_points: 44,
  longest_kill_points: 17,
  sync_bonus: 25,
  death_penalty: 22,
  final_score: 219,
});

const rankedServers = rankServers([
  { id: "low", kills: 2, deaths: 1, uniquePlayers: 1, joins: 0, longestKill: 10, statsSyncActive: true, lastActivityAt: "2026-05-15T19:00:00.000Z" },
  { id: "high", kills: 11, deaths: 11, uniquePlayers: 9, joins: 22, longestKill: 17.4068, statsSyncActive: true, lastActivityAt: "2026-05-15T20:00:00.000Z" },
]);
assert.equal(rankedServers[0].id, "high");
assert.equal(rankedServers[0].rank, 1);
assert.equal(rankedServers[0].score, 219);

const tiedServers = rankServers([
  { id: "kd", kills: 10, deaths: 2, uniquePlayers: 0, joins: 0, longestKill: 0, statsSyncActive: false, lastActivityAt: "2026-05-15T19:00:00.000Z" },
  { id: "kills", kills: 11, deaths: 7, uniquePlayers: 0, joins: 0, longestKill: 0, statsSyncActive: false, lastActivityAt: "2026-05-15T18:00:00.000Z" },
]);
assert.equal(tiedServers[0].id, "kills");

const noDataServer = rankServers([
  { id: "pending", kills: 0, deaths: 0, uniquePlayers: 0, joins: 0, longestKill: 0, statsSyncActive: false, lastActivityAt: null },
])[0];
assert.equal(noDataServer.score_label, "Pending");

assert.equal(rankPublicPlayers([]).length, 0);

const pandoraScopedPlayers = rankPublicPlayers([
  {
    playerName: "PandoraAce",
    serverName: "Pandora DayZ",
    serverSlug: "pandora-dayz",
    kills: 3,
    deaths: 1,
    longestKill: 42,
    lastSeen: "2026-05-15T20:15:00.000Z",
  },
]);

assert.equal(pandoraScopedPlayers.length, 1);
assert.equal(pandoraScopedPlayers[0].server_slug, "pandora-dayz");
assert.equal(pandoraScopedPlayers.some((player) => player.server_slug === "nuketown-deathmatch"), false);

const nuketownScopedPlayers = rankPublicPlayers([
  {
    playerName: "xAKA-MINI_KickAs",
    serverName: "NukeTown DEATHMATCH",
    serverSlug: "nuketown-deathmatch",
    kills: 8,
    deaths: 2,
    longestKill: 17.4068,
    lastSeen: "2026-05-15T19:58:08.000Z",
  },
]);

assert.equal(nuketownScopedPlayers.length, 1);
assert.equal(nuketownScopedPlayers[0].server_slug, "nuketown-deathmatch");
assert.equal(nuketownScopedPlayers.some((player) => player.server_slug === "pandora-dayz"), false);

const sameNameDifferentServers = rankPublicPlayers([
  {
    playerName: "SharedPlayer",
    serverName: "Pandora DayZ",
    serverSlug: "pandora-dayz",
    kills: 1,
    deaths: 3,
    longestKill: 11,
    lastSeen: "2026-05-15T21:00:00.000Z",
  },
  {
    playerName: "SharedPlayer",
    serverName: "NukeTown DEATHMATCH",
    serverSlug: "nuketown-deathmatch",
    kills: 6,
    deaths: 1,
    longestKill: 18,
    lastSeen: "2026-05-15T22:00:00.000Z",
  },
]);

assert.equal(sameNameDifferentServers.length, 2);
assert.equal(new Set(sameNameDifferentServers.map((player) => player.server_slug)).size, 2);
assert.equal(sameNameDifferentServers.find((player) => player.server_slug === "pandora-dayz")?.kills, 1);
assert.equal(sameNameDifferentServers.find((player) => player.server_slug === "nuketown-deathmatch")?.kills, 6);

console.log("Public leaderboard ranking tests passed.");
