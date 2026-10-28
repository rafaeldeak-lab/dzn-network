// Local-preview build grid. Coordinates are metres in the 3D scene; each cell is 2 m.
// A live game must validate the same rules on its authoritative server.
export const GRID_STEP = 2;
export const CORE_DEFAULTS = Object.freeze({
  hq: [0, 0], workshop: [-8, 4], tower: [8, 6], comms: [6, -8], depot: [-8, -4],
});
export const DISTRICT_DEFAULTS = Object.freeze({
  'timberline-depot': [-22, -4], 'ridgewatch-range': [22, -4],
  'signal-marsh': [-14, 22], 'highland-works': [16, 22],
});
export const LAYOUT_ZONES = Object.freeze({
  'command-compound': Object.freeze({ minX: -14, maxX: 14, minZ: -12, maxZ: 12 }),
  'timberline-depot': Object.freeze({ minX: -28, maxX: -18, minZ: -10, maxZ: 2 }),
  'ridgewatch-range': Object.freeze({ minX: 18, maxX: 28, minZ: -10, maxZ: 2 }),
  'signal-marsh': Object.freeze({ minX: -20, maxX: -10, minZ: 16, maxZ: 28 }),
  'highland-works': Object.freeze({ minX: 10, maxX: 22, minZ: 16, maxZ: 28 }),
});
export const WALL_COSTS = Object.freeze([null,
  Object.freeze({ parts: 15, timber: 10 }), Object.freeze({ parts: 25, timber: 15 }),
  Object.freeze({ parts: 40, timber: 20 }), Object.freeze({ parts: 60, timber: 25 }),
  Object.freeze({ parts: 90, timber: 30 }),
]);
export const MAX_WALLS_PER_HALL = Object.freeze([0, 24, 36, 48, 60, 72]);
export const snapGrid = value => Math.round(value / GRID_STEP) * GRID_STEP;
export const cellKey = (x, z) => `${x},${z}`;
export function isGridCell(x, z) {
  return Number.isSafeInteger(x) && Number.isSafeInteger(z) && x % GRID_STEP === 0 && z % GRID_STEP === 0;
}
export function zoneAt(x, z) {
  if (!isGridCell(x, z)) return null;
  return Object.entries(LAYOUT_ZONES).find(([, b]) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ)?.[0] || null;
}
export function defaultLayout() {
  return {
    structures: Object.fromEntries([...Object.entries(CORE_DEFAULTS), ...Object.entries(DISTRICT_DEFAULTS)].map(([key, [x, z]]) => [key, { x, z }])),
    walls: [], nextWallNumber: 1,
  };
}
export function footprintCells(x, z) {
  const cells = [];
  for (let dx = -GRID_STEP; dx <= GRID_STEP; dx += GRID_STEP)
    for (let dz = -GRID_STEP; dz <= GRID_STEP; dz += GRID_STEP) cells.push(cellKey(x + dx, z + dz));
  return cells;
}
export function layoutOccupancy(layout, activeDistricts, exceptKey = null) {
  const occupied = new Set([cellKey(-6, -12), cellKey(-4, -12), cellKey(-2, -12), cellKey(-6, -10), cellKey(-4, -10), cellKey(-2, -10)]);
  for (const [key, point] of Object.entries(layout.structures)) {
    if (key === exceptKey || (key in DISTRICT_DEFAULTS && !activeDistricts.has(key))) continue;
    for (const cell of footprintCells(point.x, point.z)) occupied.add(cell);
  }
  for (const wall of layout.walls) if (wall.id !== exceptKey) occupied.add(cellKey(wall.x, wall.z));
  return occupied;
}
export function validateLayoutPosition(layout, activeDistricts, key, x, z) {
  if (!isGridCell(x, z)) return 'Choose a 2-metre grid cell.';
  const zone = key in CORE_DEFAULTS ? 'command-compound' : key in DISTRICT_DEFAULTS ? key : null;
  if (!zone || (key in DISTRICT_DEFAULTS && !activeDistricts.has(key))) return 'This structure is not available on claimed land.';
  const bounds = LAYOUT_ZONES[zone];
  if (x - GRID_STEP < bounds.minX || x + GRID_STEP > bounds.maxX || z - GRID_STEP < bounds.minZ || z + GRID_STEP > bounds.maxZ) return 'Keep the whole building inside its unlocked district.';
  const occupied = layoutOccupancy(layout, activeDistricts, key);
  if (footprintCells(x, z).some(cell => occupied.has(cell))) return 'That space overlaps a building or wall.';
  return null;
}
export function validateWallPosition(layout, activeDistricts, x, z, ignoredWallId = null) {
  const zone = zoneAt(x, z);
  if (!zone || (zone !== 'command-compound' && !activeDistricts.has(zone))) return 'Walls need unlocked, claimed grid space.';
  if (layoutOccupancy(layout, activeDistricts, ignoredWallId).has(cellKey(x, z))) return 'That cell is occupied.';
  return null;
}
export function rowCells(start, end) {
  if (!isGridCell(start?.x, start?.z) || !isGridCell(end?.x, end?.z)) return null;
  if (start.x !== end.x && start.z !== end.z) return null;
  const count = Math.abs(start.x - end.x) / GRID_STEP + Math.abs(start.z - end.z) / GRID_STEP + 1;
  if (count > 16) return null;
  return Array.from({ length: count }, (_, index) => ({
    x: start.x + Math.sign(end.x - start.x) * GRID_STEP * index,
    z: start.z + Math.sign(end.z - start.z) * GRID_STEP * index,
  }));
}
