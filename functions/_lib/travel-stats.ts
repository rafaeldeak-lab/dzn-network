export type TravelPositionSample = {
  linkedServerId: string;
  playerKey: string;
  playerName: string | null;
  occurredAt: string | null;
  x: number;
  y: number;
  z?: number | null;
  sourceEventType?: string | null;
};

export type TravelPlayerStats = {
  linkedServerId: string;
  playerKey: string;
  playerName: string | null;
  totalValidDistanceM: number;
  onFootDistanceM: number;
  fastTravelEstimatedDistanceM: number;
  suspiciousDistanceIgnoredM: number;
  longestValidJourneyM: number;
  longestOnFootJourneyM: number;
  averageDistancePerSessionM: number;
  travelSessionsCount: number;
  samplesCount: number;
  suspiciousSegmentsCount: number;
  lastTravelSampleAt: string | null;
};

export type TravelServerStats = {
  linkedServerId: string;
  totalValidDistanceM: number;
  totalOnFootDistanceM: number;
  totalFastTravelEstimatedDistanceM: number;
  suspiciousDistanceIgnoredM: number;
  activeExplorersCount: number;
  longestValidJourneyM: number;
  topExplorerPlayer: string | null;
  explorerScore: number;
  samplesCount: number;
  suspiciousSegmentsCount: number;
  lastTravelSampleAt: string | null;
};

export type TravelComputationOptions = {
  maxGapSeconds?: number;
  onFootMaxSpeedMps?: number;
  fastTravelMaxSpeedMps?: number;
};

const DEFAULT_TRAVEL_OPTIONS = {
  maxGapSeconds: 15 * 60,
  onFootMaxSpeedMps: 8,
  fastTravelMaxSpeedMps: 45,
};

export function computeTravelStats(samples: TravelPositionSample[], options: TravelComputationOptions = {}) {
  const config = { ...DEFAULT_TRAVEL_OPTIONS, ...options };
  const byPlayer = new Map<string, TravelPlayerStats>();
  const sorted = samples
    .filter(isValidTravelSample)
    .sort((a, b) => sampleSortKey(a).localeCompare(sampleSortKey(b)));

  let previous: TravelPositionSample | null = null;
  let currentJourneyDistance = 0;
  let currentOnFootJourneyDistance = 0;

  for (const sample of sorted) {
    const key = playerMapKey(sample);
    const stats = byPlayer.get(key) ?? createPlayerTravelStats(sample);
    stats.samplesCount += 1;
    stats.lastTravelSampleAt = latestIso(stats.lastTravelSampleAt, sample.occurredAt);
    byPlayer.set(key, stats);

    if (!previous || previous.linkedServerId !== sample.linkedServerId || previous.playerKey !== sample.playerKey) {
      previous = sample;
      currentJourneyDistance = 0;
      currentOnFootJourneyDistance = 0;
      continue;
    }

    const segment = classifyTravelSegment(previous, sample, config);
    if (!segment.valid) {
      currentJourneyDistance = 0;
      currentOnFootJourneyDistance = 0;
      if (segment.distanceM > 0) {
        stats.suspiciousDistanceIgnoredM += segment.distanceM;
        stats.suspiciousSegmentsCount += 1;
      }
      previous = sample;
      continue;
    }

    if (currentJourneyDistance === 0) stats.travelSessionsCount += 1;
    stats.totalValidDistanceM += segment.distanceM;
    currentJourneyDistance += segment.distanceM;
    stats.longestValidJourneyM = Math.max(stats.longestValidJourneyM, currentJourneyDistance);

    if (segment.kind === "on_foot") {
      stats.onFootDistanceM += segment.distanceM;
      currentOnFootJourneyDistance += segment.distanceM;
      stats.longestOnFootJourneyM = Math.max(stats.longestOnFootJourneyM, currentOnFootJourneyDistance);
    } else {
      stats.fastTravelEstimatedDistanceM += segment.distanceM;
      currentOnFootJourneyDistance = 0;
    }

    previous = sample;
  }

  const players = [...byPlayer.values()].map((stats) => ({
    ...roundTravelStats(stats),
    averageDistancePerSessionM: stats.travelSessionsCount > 0 ? roundNumber(stats.totalValidDistanceM / stats.travelSessionsCount) : 0,
  }));
  const servers = summarizeTravelServers(players);
  return { players, servers };
}

export function classifyTravelSegment(
  previous: TravelPositionSample,
  current: TravelPositionSample,
  options: Required<TravelComputationOptions> = DEFAULT_TRAVEL_OPTIONS,
) {
  const previousTime = previous.occurredAt ? Date.parse(previous.occurredAt) : Number.NaN;
  const currentTime = current.occurredAt ? Date.parse(current.occurredAt) : Number.NaN;
  const dtSeconds = Number.isFinite(previousTime) && Number.isFinite(currentTime) ? (currentTime - previousTime) / 1000 : 0;
  const distanceM = Math.hypot(current.x - previous.x, current.y - previous.y);

  if (!Number.isFinite(distanceM) || distanceM <= 0 || dtSeconds <= 0 || dtSeconds > options.maxGapSeconds) {
    return { valid: false as const, kind: "invalid_gap" as const, distanceM: roundNumber(distanceM), dtSeconds };
  }

  const speed = distanceM / dtSeconds;
  if (speed <= options.onFootMaxSpeedMps) {
    return { valid: true as const, kind: "on_foot" as const, distanceM: roundNumber(distanceM), dtSeconds, speedMps: speed };
  }
  if (speed <= options.fastTravelMaxSpeedMps) {
    return { valid: true as const, kind: "fast_travel_estimated" as const, distanceM: roundNumber(distanceM), dtSeconds, speedMps: speed };
  }
  return { valid: false as const, kind: "suspicious" as const, distanceM: roundNumber(distanceM), dtSeconds, speedMps: speed };
}

function summarizeTravelServers(players: TravelPlayerStats[]) {
  const byServer = new Map<string, TravelServerStats>();
  for (const player of players) {
    const stats = byServer.get(player.linkedServerId) ?? {
      linkedServerId: player.linkedServerId,
      totalValidDistanceM: 0,
      totalOnFootDistanceM: 0,
      totalFastTravelEstimatedDistanceM: 0,
      suspiciousDistanceIgnoredM: 0,
      activeExplorersCount: 0,
      longestValidJourneyM: 0,
      topExplorerPlayer: null,
      explorerScore: 0,
      samplesCount: 0,
      suspiciousSegmentsCount: 0,
      lastTravelSampleAt: null,
    };
    stats.totalValidDistanceM += player.totalValidDistanceM;
    stats.totalOnFootDistanceM += player.onFootDistanceM;
    stats.totalFastTravelEstimatedDistanceM += player.fastTravelEstimatedDistanceM;
    stats.suspiciousDistanceIgnoredM += player.suspiciousDistanceIgnoredM;
    stats.samplesCount += player.samplesCount;
    stats.suspiciousSegmentsCount += player.suspiciousSegmentsCount;
    stats.lastTravelSampleAt = latestIso(stats.lastTravelSampleAt, player.lastTravelSampleAt);
    if (player.totalValidDistanceM > 0) stats.activeExplorersCount += 1;
    if (player.longestValidJourneyM > stats.longestValidJourneyM) {
      stats.longestValidJourneyM = player.longestValidJourneyM;
      stats.topExplorerPlayer = player.playerName;
    }
    byServer.set(player.linkedServerId, stats);
  }

  return [...byServer.values()].map((stats) => ({
    ...stats,
    totalValidDistanceM: roundNumber(stats.totalValidDistanceM),
    totalOnFootDistanceM: roundNumber(stats.totalOnFootDistanceM),
    totalFastTravelEstimatedDistanceM: roundNumber(stats.totalFastTravelEstimatedDistanceM),
    suspiciousDistanceIgnoredM: roundNumber(stats.suspiciousDistanceIgnoredM),
    longestValidJourneyM: roundNumber(stats.longestValidJourneyM),
    explorerScore: Math.round(stats.totalValidDistanceM / 1000 + stats.activeExplorersCount * 3 + stats.longestValidJourneyM / 500),
  }));
}

function createPlayerTravelStats(sample: TravelPositionSample): TravelPlayerStats {
  return {
    linkedServerId: sample.linkedServerId,
    playerKey: sample.playerKey,
    playerName: sample.playerName,
    totalValidDistanceM: 0,
    onFootDistanceM: 0,
    fastTravelEstimatedDistanceM: 0,
    suspiciousDistanceIgnoredM: 0,
    longestValidJourneyM: 0,
    longestOnFootJourneyM: 0,
    averageDistancePerSessionM: 0,
    travelSessionsCount: 0,
    samplesCount: 0,
    suspiciousSegmentsCount: 0,
    lastTravelSampleAt: null,
  };
}

function roundTravelStats(stats: TravelPlayerStats): TravelPlayerStats {
  return {
    ...stats,
    totalValidDistanceM: roundNumber(stats.totalValidDistanceM),
    onFootDistanceM: roundNumber(stats.onFootDistanceM),
    fastTravelEstimatedDistanceM: roundNumber(stats.fastTravelEstimatedDistanceM),
    suspiciousDistanceIgnoredM: roundNumber(stats.suspiciousDistanceIgnoredM),
    longestValidJourneyM: roundNumber(stats.longestValidJourneyM),
    longestOnFootJourneyM: roundNumber(stats.longestOnFootJourneyM),
  };
}

function isValidTravelSample(sample: TravelPositionSample) {
  return Boolean(
    sample.linkedServerId &&
    sample.playerKey &&
    sample.occurredAt &&
    Number.isFinite(sample.x) &&
    Number.isFinite(sample.y) &&
    Math.abs(sample.x) <= 200000 &&
    Math.abs(sample.y) <= 200000,
  );
}

function sampleSortKey(sample: TravelPositionSample) {
  return `${sample.linkedServerId}\u0000${sample.playerKey}\u0000${sample.occurredAt ?? ""}`;
}

function playerMapKey(sample: TravelPositionSample) {
  return `${sample.linkedServerId}:${sample.playerKey}`;
}

function latestIso(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function roundNumber(value: number) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}
