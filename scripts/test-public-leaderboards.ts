import assert from "node:assert/strict";

import { calculateKd, calculateServerScore, rankLongestKills, rankPublicPlayers, selectLatestKill } from "../functions/_lib/public-leaderboards";

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
  longestKill: 17.4068,
  uniquePlayers: 2,
  totalJoins: 5,
  totalDisconnects: 2,
});
assert.equal(score, 144);

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

console.log("Public leaderboard ranking tests passed.");
