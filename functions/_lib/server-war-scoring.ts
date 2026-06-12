import { requireDb } from "./db";
import { summarizeMapExploration } from "./map-exploration";
import { getServerWarRuleset, type ServerWarRulesetKey } from "./server-war-categories";
import { computeTravelStats, type TravelPositionSample } from "./travel-stats";
import type { Env } from "./types";

export type ServerWarEventForScoring = {
  id: string;
  scoring_ruleset_key: string;
  starts_at: string;
  ends_at: string;
};

export type ServerWarMetricBreakdown = {
  rulesetKey: ServerWarRulesetKey;
  score: number;
  kills: number;
  deaths: number;
  kd: number | null;
  uniqueFighters: number;
  longestKill: number;
  combatScore: number;
  buildScore: number;
  raidScore: number;
  structuresBuilt: number;
  repairs: number;
  activeBuilders: number;
  activityEvents: number;
  uniquePlayers: number;
  travelDistanceM: number;
  exploredCells: number;
  explorationPercent: number;
  thresholds: Record<string, boolean>;
  estimated: Record<string, boolean>;
  dataFreshness: string | null;
};

export type ServerWarContributorSummary = {
  topKillers: Array<{ playerName: string; value: number }>;
  topBuilders: Array<{ playerName: string; value: number }>;
  topActivity: Array<{ playerName: string; value: number }>;
  notes: string[];
};

export type ServerWarScoreResult = {
  eventId: string;
  serverId: string;
  score: number;
  metricBreakdown: ServerWarMetricBreakdown;
  contributorSummary: ServerWarContributorSummary;
  dataWindowStart: string;
  dataWindowEnd: string;
  computedAt: string;
};

type CombatMetrics = {
  kills: number;
  deaths: number;
  uniqueFighters: number;
  longestKill: number;
  latestAt: string | null;
};

type BuildMetrics = {
  buildScore: number;
  raidScore: number;
  structuresBuilt: number;
  repairs: number;
  activeBuilders: number;
  latestAt: string | null;
};

type ActivityMetrics = {
  activityEvents: number;
  joins: number;
  disconnects: number;
  uniquePlayers: number;
  latestAt: string | null;
};

type TravelMetrics = {
  travelDistanceM: number;
  onFootDistanceM: number;
  fastTravelEstimatedDistanceM: number;
  activeExplorers: number;
  exploredCells: number;
  explorationPercent: number;
  latestAt: string | null;
  estimated: boolean;
};

export async function computeServerWarScore(env: Env, event: ServerWarEventForScoring, serverId: string): Promise<ServerWarScoreResult> {
  const ruleset = getServerWarRuleset(event.scoring_ruleset_key);
  const [combat, build, activity, travel, topKillers, topBuilders, topActivity] = await Promise.all([
    getCombatMetrics(env, serverId, event.starts_at, event.ends_at),
    getBuildMetrics(env, serverId, event.starts_at, event.ends_at),
    getActivityMetrics(env, serverId, event.starts_at, event.ends_at),
    getTravelAndExplorationMetrics(env, serverId, event.starts_at, event.ends_at),
    getTopKillers(env, serverId, event.starts_at, event.ends_at),
    getTopBuilders(env, serverId, event.starts_at, event.ends_at),
    getTopActivity(env, serverId, event.starts_at, event.ends_at),
  ]);
  const kd = combat.deaths > 0 ? round(combat.kills / combat.deaths) : combat.kills > 0 ? null : 0;
  const thresholds = {
    minimumServerKillsForKd: combat.kills >= 25,
    minimumUniqueFighters: combat.uniqueFighters >= 3,
    minimumConfirmedKills: combat.kills > 0,
    hasBuildActivity: build.buildScore > 0 || build.structuresBuilt > 0,
    hasExplorationSamples: travel.activeExplorers > 0,
  };
  const combatScore = computeCombatScore(combat, ruleset.key);
  const activityScore = activity.activityEvents * 2 + activity.uniquePlayers * 15 + activity.joins * 3;
  let score = 0;

  if (ruleset.key === "deathmatch_war") {
    score = combat.kills * 10 + combat.uniqueFighters * 25 + longestKillBonus(combat.longestKill);
    if (thresholds.minimumServerKillsForKd && kd !== null) score += Math.max(0, Math.round(kd * 50));
    if (!thresholds.minimumUniqueFighters) score = Math.round(score * 0.6);
  } else if (ruleset.key === "pvp_war") {
    score = combat.kills * 8 - combat.deaths * 2 + combat.uniqueFighters * 20 + longestKillBonus(combat.longestKill) + activity.activityEvents;
  } else if (ruleset.key === "pve_builder_cup") {
    score = build.buildScore + build.structuresBuilt * 4 + build.repairs * 2 + build.activeBuilders * 25;
  } else if (ruleset.key === "exploration_race") {
    score = Math.round(travel.travelDistanceM / 100) + travel.exploredCells * 8 + travel.activeExplorers * 30;
  } else if (ruleset.key === "longest_kill_cup") {
    score = thresholds.minimumConfirmedKills ? Math.round(combat.longestKill) : 0;
  } else if (ruleset.key === "hybrid_war") {
    score = Math.round(combatScore + build.buildScore * 0.8 + activityScore + travel.travelDistanceM / 250 + travel.exploredCells * 3);
  } else {
    score = activityScore + combat.kills * 2 + build.structuresBuilt * 2;
  }

  const metricBreakdown: ServerWarMetricBreakdown = {
    rulesetKey: ruleset.key,
    score: sanitizeScore(score),
    kills: combat.kills,
    deaths: combat.deaths,
    kd,
    uniqueFighters: combat.uniqueFighters,
    longestKill: round(combat.longestKill),
    combatScore: round(combatScore),
    buildScore: round(build.buildScore),
    raidScore: round(build.raidScore),
    structuresBuilt: build.structuresBuilt,
    repairs: build.repairs,
    activeBuilders: build.activeBuilders,
    activityEvents: activity.activityEvents,
    uniquePlayers: activity.uniquePlayers,
    travelDistanceM: round(travel.travelDistanceM),
    exploredCells: travel.exploredCells,
    explorationPercent: travel.explorationPercent,
    thresholds,
    estimated: {
      travel: travel.estimated,
      exploration: travel.estimated,
      timePlayed: true,
    },
    dataFreshness: latestIso([combat.latestAt, build.latestAt, activity.latestAt, travel.latestAt]),
  };

  return {
    eventId: event.id,
    serverId,
    score: metricBreakdown.score,
    metricBreakdown,
    contributorSummary: {
      topKillers,
      topBuilders,
      topActivity,
      notes: [
        "Servers are competitors; players are listed only as score contributors.",
        "Travel and exploration metrics are estimated from valid ADM position samples.",
      ],
    },
    dataWindowStart: event.starts_at,
    dataWindowEnd: event.ends_at,
    computedAt: new Date().toISOString(),
  };
}

async function getCombatMetrics(env: Env, serverId: string, start: string, end: string): Promise<CombatMetrics> {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS kills,
         COALESCE(MAX(distance), 0) AS longest_kill,
         MAX(COALESCE(occurred_at, created_at)) AS latest_at
       FROM kill_events
       WHERE linked_server_id = ?
         AND killer_name IS NOT NULL
         AND victim_name IS NOT NULL
         AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
         AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)`,
    )
    .bind(serverId, start, end)
    .first<{ kills: number | null; longest_kill: number | null; latest_at: string | null }>();
  const deaths = await countFirst(
    env,
    `SELECT COUNT(*) AS count
     FROM kill_events
     WHERE linked_server_id = ?
       AND victim_name IS NOT NULL
       AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
       AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)`,
    [serverId, start, end],
  );
  const environmentalDeaths = await countFirst(
    env,
    `SELECT COUNT(*) AS count
     FROM player_events
     WHERE linked_server_id = ?
       AND event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')
       AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
       AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)`,
    [serverId, start, end],
  );
  const uniqueFighters = await countFirst(
    env,
    `SELECT COUNT(DISTINCT player_key) AS count
     FROM (
       SELECT COALESCE(killer_id, lower(killer_name)) AS player_key
       FROM kill_events
       WHERE linked_server_id = ?
         AND killer_name IS NOT NULL
         AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
         AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)
       UNION ALL
       SELECT COALESCE(victim_id, lower(victim_name)) AS player_key
       FROM kill_events
       WHERE linked_server_id = ?
         AND victim_name IS NOT NULL
         AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
         AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)
     )
     WHERE player_key IS NOT NULL AND player_key != ''`,
    [serverId, start, end, serverId, start, end],
  );
  return {
    kills: numberOrZero(row?.kills),
    deaths: deaths + environmentalDeaths,
    uniqueFighters,
    longestKill: numberOrZero(row?.longest_kill),
    latestAt: row?.latest_at ?? null,
  };
}

async function getBuildMetrics(env: Env, serverId: string, start: string, end: string): Promise<BuildMetrics> {
  const row = await requireDb(env)
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN lower(event_type) IN ('built', 'placed', 'mounted') THEN 1 ELSE 0 END) AS structures_built,
         SUM(CASE WHEN lower(event_type) = 'repaired' THEN 1 ELSE 0 END) AS repairs,
         SUM(CASE
           WHEN lower(event_type) = 'built' THEN 5
           WHEN lower(event_type) = 'placed' THEN 2
           WHEN lower(event_type) = 'repaired' THEN 1
           WHEN lower(event_type) = 'mounted' THEN 2
           ELSE 0
         END) AS build_score,
         SUM(CASE
           WHEN lower(event_type) = 'dismantled' THEN 3
           WHEN lower(event_type) = 'destroyed' THEN 5
           WHEN lower(event_type) = 'unmounted' THEN 1
           ELSE 0
         END) AS raid_score,
         COUNT(DISTINCT COALESCE(player_id, lower(player_name))) AS active_builders,
         MAX(COALESCE(occurred_at, created_at)) AS latest_at
       FROM build_events
       WHERE linked_server_id = ?
         AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
         AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)`,
    )
    .bind(serverId, start, end)
    .first<{
      structures_built: number | null;
      repairs: number | null;
      build_score: number | null;
      raid_score: number | null;
      active_builders: number | null;
      latest_at: string | null;
    }>();
  return {
    buildScore: numberOrZero(row?.build_score),
    raidScore: numberOrZero(row?.raid_score),
    structuresBuilt: numberOrZero(row?.structures_built),
    repairs: numberOrZero(row?.repairs),
    activeBuilders: numberOrZero(row?.active_builders),
    latestAt: row?.latest_at ?? null,
  };
}

async function getActivityMetrics(env: Env, serverId: string, start: string, end: string): Promise<ActivityMetrics> {
  const row = await requireDb(env)
    .prepare(
      `SELECT
         COUNT(*) AS activity_events,
         SUM(CASE WHEN event_type = 'player_connected' THEN 1 ELSE 0 END) AS joins,
         SUM(CASE WHEN event_type = 'player_disconnected' THEN 1 ELSE 0 END) AS disconnects,
         COUNT(DISTINCT COALESCE(player_id, lower(player_name))) AS unique_players,
         MAX(COALESCE(occurred_at, created_at)) AS latest_at
       FROM player_events
       WHERE linked_server_id = ?
         AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
         AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)`,
    )
    .bind(serverId, start, end)
    .first<{
      activity_events: number | null;
      joins: number | null;
      disconnects: number | null;
      unique_players: number | null;
      latest_at: string | null;
    }>();
  const killCount = await countFirst(
    env,
    `SELECT COUNT(*) AS count
     FROM kill_events
     WHERE linked_server_id = ?
       AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
       AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)`,
    [serverId, start, end],
  );
  const buildCount = await countFirst(
    env,
    `SELECT COUNT(*) AS count
     FROM build_events
     WHERE linked_server_id = ?
       AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
       AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)`,
    [serverId, start, end],
  );
  return {
    activityEvents: numberOrZero(row?.activity_events) + killCount + buildCount,
    joins: numberOrZero(row?.joins),
    disconnects: numberOrZero(row?.disconnects),
    uniquePlayers: numberOrZero(row?.unique_players),
    latestAt: row?.latest_at ?? null,
  };
}

async function getTravelAndExplorationMetrics(env: Env, serverId: string, start: string, end: string): Promise<TravelMetrics> {
  const db = requireDb(env);
  const server = await db
    .prepare("SELECT COALESCE(map_name, mission, game) AS map_name FROM linked_servers WHERE id = ? LIMIT 1")
    .bind(serverId)
    .first<{ map_name: string | null }>();
  const samples = await getWindowPositionSamples(env, serverId, start, end, 1200);
  if (!samples.length) {
    return {
      travelDistanceM: 0,
      onFootDistanceM: 0,
      fastTravelEstimatedDistanceM: 0,
      activeExplorers: 0,
      exploredCells: 0,
      explorationPercent: 0,
      latestAt: null,
      estimated: true,
    };
  }
  const travel = computeTravelStats(samples);
  const serverTravel = travel.servers.find((entry) => entry.linkedServerId === serverId);
  const exploration = summarizeMapExploration(server?.map_name ?? null, samples, { overlayLimit: 0 });
  return {
    travelDistanceM: serverTravel?.totalValidDistanceM ?? 0,
    onFootDistanceM: serverTravel?.totalOnFootDistanceM ?? 0,
    fastTravelEstimatedDistanceM: serverTravel?.totalFastTravelEstimatedDistanceM ?? 0,
    activeExplorers: Math.max(serverTravel?.activeExplorersCount ?? 0, exploration.activeExplorersCount),
    exploredCells: exploration.exploredCellsCount,
    explorationPercent: exploration.explorationPercent,
    latestAt: latestIso(samples.map((sample) => sample.occurredAt ?? null)),
    estimated: true,
  };
}

export async function getWindowPositionSamples(env: Env, serverId: string, start: string, end: string, limit = 1200): Promise<TravelPositionSample[]> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 2000));
  const rows = await requireDb(env)
    .prepare(
      `SELECT linked_server_id, player_id, player_name, occurred_at, x, y, z, source_event_type
       FROM (
         SELECT linked_server_id,
                COALESCE(player_id, lower(player_name)) AS player_id,
                player_name,
                COALESCE(occurred_at, created_at) AS occurred_at,
                position_x AS x,
                position_y AS y,
                position_z AS z,
                event_type AS source_event_type
         FROM player_events
         WHERE linked_server_id = ?
           AND position_x IS NOT NULL
           AND position_y IS NOT NULL
           AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
           AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)
         UNION ALL
         SELECT linked_server_id,
                COALESCE(killer_id, lower(killer_name)) AS player_id,
                killer_name AS player_name,
                COALESCE(occurred_at, created_at) AS occurred_at,
                position_x AS x,
                position_y AS y,
                position_z AS z,
                'kill_event' AS source_event_type
         FROM kill_events
         WHERE linked_server_id = ?
           AND position_x IS NOT NULL
           AND position_y IS NOT NULL
           AND killer_name IS NOT NULL
           AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
           AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)
         UNION ALL
         SELECT linked_server_id,
                COALESCE(player_id, lower(player_name)) AS player_id,
                player_name,
                COALESCE(occurred_at, created_at) AS occurred_at,
                pos_x AS x,
                pos_y AS y,
                pos_z AS z,
                event_type AS source_event_type
         FROM build_events
         WHERE linked_server_id = ?
           AND pos_x IS NOT NULL
           AND pos_y IS NOT NULL
           AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
           AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)
       )
       WHERE player_id IS NOT NULL
       ORDER BY datetime(occurred_at) ASC
       LIMIT ${safeLimit}`,
    )
    .bind(serverId, start, end, serverId, start, end, serverId, start, end)
    .all<{
      linked_server_id: string;
      player_id: string | null;
      player_name: string | null;
      occurred_at: string | null;
      x: number | null;
      y: number | null;
      z: number | null;
      source_event_type: string | null;
    }>();
  return (rows.results ?? [])
    .map((row) => ({
      linkedServerId: row.linked_server_id,
      playerKey: row.player_id ?? row.player_name ?? "unknown",
      playerName: row.player_name,
      occurredAt: row.occurred_at,
      x: Number(row.x),
      y: Number(row.y),
      z: row.z === null || row.z === undefined ? null : Number(row.z),
      sourceEventType: row.source_event_type,
    }))
    .filter((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y));
}

async function getTopKillers(env: Env, serverId: string, start: string, end: string) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT killer_name AS player_name, COUNT(*) AS value
       FROM kill_events
       WHERE linked_server_id = ?
         AND killer_name IS NOT NULL
         AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
         AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)
       GROUP BY COALESCE(killer_id, lower(killer_name)), killer_name
       ORDER BY value DESC, player_name ASC
       LIMIT 5`,
    )
    .bind(serverId, start, end)
    .all<{ player_name: string | null; value: number | null }>();
  return toContributorRows(rows.results ?? []);
}

async function getTopBuilders(env: Env, serverId: string, start: string, end: string) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT player_name, COUNT(*) AS value
       FROM build_events
       WHERE linked_server_id = ?
         AND player_name IS NOT NULL
         AND lower(event_type) IN ('built', 'placed', 'repaired', 'mounted')
         AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
         AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)
       GROUP BY COALESCE(player_id, lower(player_name)), player_name
       ORDER BY value DESC, player_name ASC
       LIMIT 5`,
    )
    .bind(serverId, start, end)
    .all<{ player_name: string | null; value: number | null }>();
  return toContributorRows(rows.results ?? []);
}

async function getTopActivity(env: Env, serverId: string, start: string, end: string) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT player_name, COUNT(*) AS value
       FROM player_events
       WHERE linked_server_id = ?
         AND player_name IS NOT NULL
         AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
         AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)
       GROUP BY COALESCE(player_id, lower(player_name)), player_name
       ORDER BY value DESC, player_name ASC
       LIMIT 5`,
    )
    .bind(serverId, start, end)
    .all<{ player_name: string | null; value: number | null }>();
  return toContributorRows(rows.results ?? []);
}

function computeCombatScore(combat: CombatMetrics, rulesetKey: ServerWarRulesetKey) {
  const deathPenalty = rulesetKey === "deathmatch_war" ? combat.deaths * 1.5 : combat.deaths * 2;
  const kdBonus = combat.kills >= 25 && combat.deaths > 0 ? (combat.kills / combat.deaths) * 35 : 0;
  return Math.max(0, combat.kills * 8 + combat.uniqueFighters * 18 + longestKillBonus(combat.longestKill) + kdBonus - deathPenalty);
}

function longestKillBonus(distance: number) {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  return Math.min(500, Math.round(distance / 2));
}

async function countFirst(env: Env, sql: string, bindings: unknown[]) {
  const row = await requireDb(env).prepare(sql).bind(...bindings).first<{ count: number | null }>();
  return numberOrZero(row?.count);
}

function toContributorRows(rows: Array<{ player_name: string | null; value: number | null }>) {
  return rows
    .filter((row) => row.player_name)
    .map((row) => ({
      playerName: row.player_name ?? "Unknown",
      value: numberOrZero(row.value),
    }));
}

function numberOrZero(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sanitizeScore(value: number) {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

function round(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function latestIso(values: Array<string | null>) {
  let latest: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!latest || Date.parse(value) > Date.parse(latest)) latest = value;
  }
  return latest;
}
