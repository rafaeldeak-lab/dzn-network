import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { calculateKd, calculateServerScore, calculateServerScoreBreakdown, filterRankedPublicServersByMode, getPublicServerLeaderboardById, mergePublicPlayerRows, normalizePublicLeaderboardMode, rankLongestKills, rankPublicPlayers, selectLatestKill, type PublicLeaderboardServer } from "../functions/_lib/public-leaderboards";
import { rankServers } from "../functions/_lib/server-ranking";
import { formatPublicServerName } from "../lib/public-display-text";
import type { Env } from "../functions/_lib/types";

type SqliteRow = Record<string, unknown>;
type SqliteDatabase = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    all(...values: unknown[]): SqliteRow[];
    get(...values: unknown[]): SqliteRow | undefined;
    run(...values: unknown[]): { changes: number | bigint };
  };
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

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

const publicLeaderboardSource = readFileSync("functions/_lib/public-leaderboards.ts", "utf8");
assert.match(publicLeaderboardSource, /COALESCE\(death_stats\.deaths, 0\) AS deaths/, "Every kill-ranked player must carry their full death total before the result limit is applied.");
assert.match(publicLeaderboardSource, /GROUP BY death_events\.linked_server_id, COALESCE\(death_events\.victim_id, lower\(death_events\.victim_name\)\)/, "Death totals must be grouped by the same server-scoped player identity used by the ranking.");

const topPlayerWithDeathsOutsideTheDeathTopTen = mergePublicPlayerRows([
  {
    linked_server_id: "nuketown",
    player_key: "aka-mini",
    player_name: "xAKA-MINI_KickAs",
    server_name: "NUKETOWN DEATHMATCH- HTTPS:/DAYZ-NETWORK.COM",
    server_slug: "nuketown-deathmatch",
    kills: 114,
    deaths: 62,
    longest_kill: 47.6,
    last_seen: "2026-10-25T14:00:00.000Z",
  },
], []);
assert.equal(topPlayerWithDeathsOutsideTheDeathTopTen[0]?.deaths, 62, "Kill leaders must keep their exact deaths even when they are absent from a separately ranked death list.");
assert.equal(rankPublicPlayers(topPlayerWithDeathsOutsideTheDeathTopTen, 10)[0]?.kd_label, "1.84");
assert.equal(formatPublicServerName("NUKETOWN DEATHMATCH- HTTPS:/DAYZ-NETWORK.COM"), "NukeTown Deathmatch", "Malformed single-slash URLs must not leak into public server labels.");

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

const globallyRankedServers: PublicLeaderboardServer[] = Array.from({ length: 12 }, (_, index) => ({
  rank: index + 1,
  server_id: `server-${index + 1}`,
  server_name: `Server ${index + 1}`,
  slug: `server-${index + 1}`,
  mode: index === 10 ? "DEATHMATCH" : "SURVIVAL",
  category: index === 10 ? "deathmatch" : "survival",
  kills: 120 - index,
  deaths: 40,
  kd: 3,
  kd_label: "3.00",
  longest_kill: 100,
  unique_players: 20,
  joins: 50,
  stats_sync_active: true,
  score: 1000 - index,
  score_label: String(1000 - index),
  score_breakdown: null,
}));
const deathmatchOutsideTopTen = filterRankedPublicServersByMode(globallyRankedServers, "deathmatch", 10);
assert.equal(deathmatchOutsideTopTen.length, 1, "Mode filtering must use the complete bounded ranked-server set.");
assert.equal(deathmatchOutsideTopTen[0].rank, 11, "Mode filtering must preserve the server's global rank.");
assert.equal(filterRankedPublicServersByMode(globallyRankedServers, "all", 10).length, 10);
const canonicalCategoryDiffersFromDisplayMode: PublicLeaderboardServer = {
  ...globallyRankedServers[0],
  mode: "HARDCORE",
  category: "pvp",
};
assert.equal(filterRankedPublicServersByMode([canonicalCategoryDiffersFromDisplayMode], "pvp", 10).length, 1, "Mode filters must use the canonical server category.");
assert.equal(filterRankedPublicServersByMode([canonicalCategoryDiffersFromDisplayMode], "survival", 10).length, 0, "Display mode must not override the canonical category.");
assert.equal(filterRankedPublicServersByMode([{ ...canonicalCategoryDiffersFromDisplayMode, category: "pve" }], "survival", 10).length, 1, "PvE is the canonical survival-focused category.");
assert.equal(filterRankedPublicServersByMode([{ ...canonicalCategoryDiffersFromDisplayMode, category: "pvp_pve" }], "survival", 10).length, 1, "Hybrid PvP/PvE servers are eligible for survival rankings.");
assert.equal(filterRankedPublicServersByMode([{ ...canonicalCategoryDiffersFromDisplayMode, category: "pvp" }], "survival", 10).length, 0, "PvP-only servers must not enter survival rankings.");
assert.equal(normalizePublicLeaderboardMode("PvP"), "pvp");
assert.equal(normalizePublicLeaderboardMode("unsupported"), "all");

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

void testLeaderboardStatParity().then(
  () => console.log("Public leaderboard ranking tests passed."),
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);

async function testLeaderboardStatParity() {
  const leaderboardStatParityFixture = createLeaderboardStatParityFixture();
  try {
    const compactPlayers = await getPublicServerLeaderboardById(leaderboardStatParityFixture.env, "nuketown", 10);
    const fullPlayers = await getPublicServerLeaderboardById(leaderboardStatParityFixture.env, "nuketown", 250);
    const compactLeader = compactPlayers.find((player) => player.player_name === "xAKA-MINI_KickAs");
    const fullLeader = fullPlayers.find((player) => player.player_name === "xAKA-MINI_KickAs");

    assert.equal(compactLeader?.kills, 114, "The compact leaderboard fixture must retain its highest kill leader.");
    assert.equal(compactLeader?.deaths, 62, "The compact leaderboard must retain a kill leader's complete death total outside the death Top 10.");
    assert.equal(compactLeader?.kd_label, "1.84");
    assert.deepEqual(
      { kills: compactLeader?.kills, deaths: compactLeader?.deaths, kd: compactLeader?.kd_label },
      { kills: fullLeader?.kills, deaths: fullLeader?.deaths, kd: fullLeader?.kd_label },
      "Compact and full server leaderboards must expose identical stats for their shared players.",
    );
    const zeroDeathAttackers = fullPlayers
      .filter((player) => player.player_name.startsWith("Attacker "))
      .sort((left, right) => left.player_name.localeCompare(right.player_name));
    assert.equal(zeroDeathAttackers.length, 62, "Multiple killers without deaths must remain distinct leaderboard rows.");
    assert.ok(zeroDeathAttackers.every((player) => player.kills === 1 && player.deaths === 0 && player.kd_label === "Flawless"));
  } finally {
    leaderboardStatParityFixture.close();
  }
}

function createLeaderboardStatParityFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE linked_servers (
      id TEXT PRIMARY KEY,
      status TEXT,
      listing_visibility TEXT,
      merged_into_server_id TEXT,
      lifecycle_status TEXT,
      display_name TEXT,
      hostname TEXT,
      server_name TEXT,
      nitrado_service_name TEXT,
      public_slug TEXT
    );
    CREATE TABLE kill_events (
      id TEXT PRIMARY KEY,
      linked_server_id TEXT,
      killer_id TEXT,
      killer_name TEXT,
      victim_id TEXT,
      victim_name TEXT,
      distance REAL,
      occurred_at TEXT,
      created_at TEXT
    );
    CREATE TABLE player_profiles (
      id TEXT PRIMARY KEY,
      linked_server_id TEXT,
      player_id TEXT,
      player_name TEXT,
      discord_id TEXT,
      last_seen_at TEXT,
      updated_at TEXT,
      created_at TEXT
    );
    INSERT INTO linked_servers (
      id, status, listing_visibility, merged_into_server_id, lifecycle_status,
      display_name, server_name, public_slug
    ) VALUES (
      'nuketown', 'live', 'public', NULL, 'active_live',
      'NUKETOWN DEATHMATCH- HTTPS:/DAYZ-NETWORK.COM', 'NukeTown Deathmatch', 'nuketown-deathmatch'
    );
  `);

  const insertKill = sqlite.prepare(`
    INSERT INTO kill_events (
      id, linked_server_id, killer_id, killer_name, victim_id, victim_name, distance, occurred_at, created_at
    ) VALUES (?, 'nuketown', ?, ?, ?, ?, ?, ?, ?)
  `);
  let eventIndex = 0;
  const insert = (killerId: string, killerName: string, victimId: string, victimName: string, distance = 10) => {
    eventIndex += 1;
    const occurredAt = `2026-10-25T14:${String(eventIndex % 60).padStart(2, "0")}:00.000Z`;
    insertKill.run(`event-${eventIndex}`, killerId, killerName, victimId, victimName, distance, occurredAt, occurredAt);
  };

  for (let index = 0; index < 114; index += 1) {
    insert("aka-mini", "xAKA-MINI_KickAs", `target-${index}`, `Target ${index}`, 47.6);
  }
  for (let index = 0; index < 62; index += 1) {
    insert(`attacker-${index}`, `Attacker ${index}`, "aka-mini", "xAKA-MINI_KickAs");
  }
  for (let playerIndex = 0; playerIndex < 10; playerIndex += 1) {
    for (let deathIndex = 0; deathIndex < 63 + playerIndex; deathIndex += 1) {
      insert(`heavy-killer-${playerIndex}`, `Heavy Killer ${playerIndex}`, `heavy-victim-${playerIndex}`, `Heavy Victim ${playerIndex}`);
    }
  }

  const prepare = (sql: string, bindings: unknown[] = []) => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...bindings) as T[], success: true }),
    first: async <T>() => sqlite.prepare(sql).get(...bindings) as T | null,
  });
  return {
    env: { DB: { prepare } } as unknown as Env,
    close: () => sqlite.close(),
  };
}
