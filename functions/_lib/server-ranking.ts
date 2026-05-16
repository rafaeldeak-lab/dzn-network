export type ServerScoreInput = {
  kills: number | null;
  deaths: number | null;
  uniquePlayers: number | null;
  joins?: number | null;
  totalJoins?: number | null;
  longestKill: number | null;
  statsSyncActive?: boolean | null;
};

export type ServerScoreBreakdown = {
  kills_points: number;
  unique_players_points: number;
  joins_points: number;
  longest_kill_points: number;
  sync_bonus: number;
  death_penalty: number;
  final_score: number;
};

export type ServerRankInput = ServerScoreInput & {
  id: string;
  lastActivityAt?: string | null;
};

export type RankedServer<T extends ServerRankInput> = T & {
  rank: number;
  score: number;
  score_breakdown: ServerScoreBreakdown;
  score_label: string;
  stats_sync_active: boolean;
};

export const SERVER_SCORE_TOOLTIP = "Score is based on confirmed kills, unique players, joins, longest kill, deaths, and sync health.";

export function calculateServerScoreBreakdown(input: ServerScoreInput): ServerScoreBreakdown {
  const kills = numberOrZero(input.kills);
  const deaths = numberOrZero(input.deaths);
  const uniquePlayers = numberOrZero(input.uniquePlayers);
  const joins = numberOrZero(input.joins ?? input.totalJoins);
  const longestKill = Math.round(numberOrZero(input.longestKill));
  const syncBonus = input.statsSyncActive ? 25 : 0;
  const deathPenalty = deaths * 2;
  const finalScore = Math.max(0, (kills * 10) + (uniquePlayers * 5) + (joins * 2) + longestKill + syncBonus - deathPenalty);

  return {
    kills_points: kills * 10,
    unique_players_points: uniquePlayers * 5,
    joins_points: joins * 2,
    longest_kill_points: longestKill,
    sync_bonus: syncBonus,
    death_penalty: deathPenalty,
    final_score: finalScore,
  };
}

export function calculateServerScore(input: ServerScoreInput) {
  return calculateServerScoreBreakdown(input).final_score;
}

export function hasServerScoreData(input: ServerScoreInput) {
  return numberOrZero(input.kills) > 0 ||
    numberOrZero(input.deaths) > 0 ||
    numberOrZero(input.uniquePlayers) > 0 ||
    numberOrZero(input.joins ?? input.totalJoins) > 0 ||
    numberOrZero(input.longestKill) > 0 ||
    Boolean(input.statsSyncActive);
}

export function rankServers<T extends ServerRankInput>(servers: T[], limit = servers.length): Array<RankedServer<T>> {
  return servers
    .map((server) => {
      const score_breakdown = calculateServerScoreBreakdown(server);
      const stats_sync_active = Boolean(server.statsSyncActive);
      return {
        ...server,
        rank: 0,
        score: score_breakdown.final_score,
        score_breakdown,
        score_label: hasServerScoreData(server) ? String(score_breakdown.final_score) : "Pending",
        stats_sync_active,
      };
    })
    .sort(compareRankedServers)
    .slice(0, limit)
    .map((server, index) => ({ ...server, rank: index + 1 }));
}

export function formatScoreBreakdownTitle(breakdown: ServerScoreBreakdown) {
  return [
    SERVER_SCORE_TOOLTIP,
    `Kills: ${breakdown.kills_points}`,
    `Unique players: ${breakdown.unique_players_points}`,
    `Joins: ${breakdown.joins_points}`,
    `Longest kill: ${breakdown.longest_kill_points}`,
    `Sync bonus: ${breakdown.sync_bonus}`,
    `Death penalty: -${breakdown.death_penalty}`,
    `Final score: ${breakdown.final_score}`,
  ].join("\n");
}

function compareRankedServers<T extends RankedServer<ServerRankInput>>(a: T, b: T) {
  const dataDiff = Number(hasServerScoreData(b)) - Number(hasServerScoreData(a));
  if (dataDiff) return dataDiff;

  const scoreDiff = b.score - a.score;
  if (scoreDiff) return scoreDiff;

  const killsDiff = numberOrZero(b.kills) - numberOrZero(a.kills);
  if (killsDiff) return killsDiff;

  const kdDiff = kdRankValue(b) - kdRankValue(a);
  if (kdDiff) return kdDiff;

  const longestDiff = numberOrZero(b.longestKill) - numberOrZero(a.longestKill);
  if (longestDiff) return longestDiff;

  const playerDiff = numberOrZero(b.uniquePlayers) - numberOrZero(a.uniquePlayers);
  if (playerDiff) return playerDiff;

  return dateValue(b.lastActivityAt ?? null) - dateValue(a.lastActivityAt ?? null);
}

function kdRankValue(input: ServerScoreInput) {
  const kills = numberOrZero(input.kills);
  const deaths = numberOrZero(input.deaths);
  if (kills === 0 && deaths === 0) return -1;
  if (kills > 0 && deaths === 0) return kills;
  return deaths > 0 ? kills / deaths : 0;
}

function dateValue(value: string | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}
