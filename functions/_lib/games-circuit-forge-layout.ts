import { CIRCUIT_FORGE_GRID_SIZE, CIRCUIT_FORGE_TILE_COUNT } from "../../lib/games-circuit-forge";

export const CIRCUIT_FORGE_CORE_INDEX = 12;
export const CIRCUIT_EDGE_NORTH = 1;
export const CIRCUIT_EDGE_EAST = 2;
export const CIRCUIT_EDGE_SOUTH = 4;
export const CIRCUIT_EDGE_WEST = 8;

type Direction = { edge: number; opposite: number; delta: number; valid: (row: number, column: number) => boolean };

const DIRECTIONS: Direction[] = [
  { edge: CIRCUIT_EDGE_NORTH, opposite: CIRCUIT_EDGE_SOUTH, delta: -CIRCUIT_FORGE_GRID_SIZE, valid: row => row > 0 },
  { edge: CIRCUIT_EDGE_EAST, opposite: CIRCUIT_EDGE_WEST, delta: 1, valid: (_row, column) => column < CIRCUIT_FORGE_GRID_SIZE - 1 },
  { edge: CIRCUIT_EDGE_SOUTH, opposite: CIRCUIT_EDGE_NORTH, delta: CIRCUIT_FORGE_GRID_SIZE, valid: row => row < CIRCUIT_FORGE_GRID_SIZE - 1 },
  { edge: CIRCUIT_EDGE_WEST, opposite: CIRCUIT_EDGE_EAST, delta: -1, valid: (_row, column) => column > 0 },
];

// A connected 5x5 relay tree. The layout is server-only so the browser cannot read a solved board from its bundle.
export const CIRCUIT_FORGE_CANONICAL_MASKS = [
  6, 14, 14, 14, 12,
  3, 9, 5, 3, 9,
  2, 10, 15, 10, 8,
  2, 12, 5, 6, 8,
  2, 11, 11, 11, 8,
] as const;

export function rotateCircuitMask(mask: number, rotations: number) {
  let result = mask;
  for (let index = 0; index < rotations; index++) {
    result = ((result << 1) & 0b1110) | ((result & CIRCUIT_EDGE_WEST) >> 3);
  }
  return result;
}

export function circuitMasks(rotations: readonly number[]) {
  return CIRCUIT_FORGE_CANONICAL_MASKS.map((mask, index) => rotateCircuitMask(mask, rotations[index] ?? 0));
}

function position(index: number) {
  return { row: Math.floor(index / CIRCUIT_FORGE_GRID_SIZE), column: index % CIRCUIT_FORGE_GRID_SIZE };
}

export function poweredCircuitTiles(masks: readonly number[]) {
  const powered = new Set<number>([CIRCUIT_FORGE_CORE_INDEX]);
  const queue = [CIRCUIT_FORGE_CORE_INDEX];
  while (queue.length) {
    const current = queue.shift()!;
    const { row, column } = position(current);
    for (const direction of DIRECTIONS) {
      if (!(masks[current] & direction.edge) || !direction.valid(row, column)) continue;
      const next = current + direction.delta;
      if (!(masks[next] & direction.opposite) || powered.has(next)) continue;
      powered.add(next);
      queue.push(next);
    }
  }
  return powered;
}

export function isCompleteCircuit(masks: readonly number[]) {
  if (masks.length !== CIRCUIT_FORGE_TILE_COUNT) return false;
  for (let index = 0; index < masks.length; index++) {
    const { row, column } = position(index);
    for (const direction of DIRECTIONS) {
      if (!(masks[index] & direction.edge)) continue;
      if (!direction.valid(row, column) || !(masks[index + direction.delta] & direction.opposite)) return false;
    }
  }
  return poweredCircuitTiles(masks).size === CIRCUIT_FORGE_TILE_COUNT;
}
