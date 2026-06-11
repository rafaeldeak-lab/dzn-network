import { resolveDznMapConfig, type DznMapConfig } from "./map-configs";
import type { TravelPositionSample } from "./travel-stats";

export type ExplorationCell = {
  cellX: number;
  cellY: number;
  visits: number;
};

export type ExplorationSummary = {
  supported: boolean;
  mapKey: string | null;
  mapName: string | null;
  mapDisplayName: string | null;
  boundsConfidence: "verified" | "estimated" | null;
  gridSize: number | null;
  exploredCellsCount: number;
  totalExplorableCells: number;
  explorationPercent: number;
  activeExplorersCount: number;
  topExplorerName: string | null;
  topExplorerCells: number;
  overlayCells: ExplorationCell[];
  lastExplorationUpdateAt: string | null;
  estimated: boolean;
};

export function summarizeMapExploration(mapName: unknown, samples: TravelPositionSample[], options: { overlayLimit?: number } = {}): ExplorationSummary {
  const config = resolveDznMapConfig(mapName);
  if (!config) return emptyExplorationSummary(mapName);

  const cells = new Map<string, ExplorationCell>();
  const playerCells = new Map<string, Set<string>>();
  let lastExplorationUpdateAt: string | null = null;

  for (const sample of samples) {
    const cell = positionToExplorationCell(config, sample.x, sample.y);
    if (!cell) continue;
    const key = `${cell.cellX}:${cell.cellY}`;
    const existing = cells.get(key);
    if (existing) existing.visits += 1;
    else cells.set(key, { ...cell, visits: 1 });

    const playerKey = sample.playerKey || sample.playerName || "unknown";
    const playerSet = playerCells.get(playerKey) ?? new Set<string>();
    playerSet.add(key);
    playerCells.set(playerKey, playerSet);
    lastExplorationUpdateAt = latestIso(lastExplorationUpdateAt, sample.occurredAt);
  }

  const totalExplorableCells = config.gridSize * config.gridSize;
  const exploredCellsCount = cells.size;
  let topExplorerName: string | null = null;
  let topExplorerCells = 0;
  for (const sample of samples) {
    const key = sample.playerKey || sample.playerName || "unknown";
    const count = playerCells.get(key)?.size ?? 0;
    if (count > topExplorerCells) {
      topExplorerCells = count;
      topExplorerName = sample.playerName;
    }
  }

  const overlayLimit = options.overlayLimit === undefined
    ? 220
    : Math.max(0, Math.min(Math.trunc(options.overlayLimit), 500));

  return {
    supported: true,
    mapKey: config.key,
    mapName: typeof mapName === "string" ? mapName : null,
    mapDisplayName: config.displayName,
    boundsConfidence: config.boundsConfidence,
    gridSize: config.gridSize,
    exploredCellsCount,
    totalExplorableCells,
    explorationPercent: totalExplorableCells > 0 ? roundPercent((exploredCellsCount / totalExplorableCells) * 100) : 0,
    activeExplorersCount: [...playerCells.values()].filter((set) => set.size > 0).length,
    topExplorerName,
    topExplorerCells,
    overlayCells: [...cells.values()]
      .sort((a, b) => b.visits - a.visits)
      .slice(0, overlayLimit),
    lastExplorationUpdateAt,
    estimated: config.boundsConfidence !== "verified",
  };
}

export function positionToExplorationCell(config: DznMapConfig, x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < config.minX || x > config.maxX || y < config.minY || y > config.maxY) return null;
  const xRatio = (x - config.minX) / Math.max(1, config.maxX - config.minX);
  const yRatio = (y - config.minY) / Math.max(1, config.maxY - config.minY);
  return {
    cellX: clampCell(Math.floor(xRatio * config.gridSize), config.gridSize),
    cellY: clampCell(Math.floor(yRatio * config.gridSize), config.gridSize),
  };
}

function emptyExplorationSummary(mapName: unknown): ExplorationSummary {
  return {
    supported: false,
    mapKey: null,
    mapName: typeof mapName === "string" ? mapName : null,
    mapDisplayName: null,
    boundsConfidence: null,
    gridSize: null,
    exploredCellsCount: 0,
    totalExplorableCells: 0,
    explorationPercent: 0,
    activeExplorersCount: 0,
    topExplorerName: null,
    topExplorerCells: 0,
    overlayCells: [],
    lastExplorationUpdateAt: null,
    estimated: true,
  };
}

function clampCell(value: number, gridSize: number) {
  return Math.max(0, Math.min(gridSize - 1, value));
}

function roundPercent(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function latestIso(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}
