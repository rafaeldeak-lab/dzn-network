// Walkable links around the four buildings. Stops are outside their footprints.
// The camp is the squad's home until a dedicated Barracks plot exists.
import { cellKey, footprintCells } from './layout-grid.js';
import { BUILDING_ASSETS } from './building-assets.js';
export const PATROL_NODES = Object.freeze({
  camp: [-4, -12], westSouth: [-9, -8], westLane: [-15, 0], westNorth: [-15, 10],
  yard: [-17, -4],
  workshop: [-9, 9], northWest: [-5, 12], hall: [0, 6],
  northEast: [5, 12], tower: [8, 11], eastNorth: [14, 11], eastLane: [14, 0],
  comms: [10, -10], southEast: [6, -13], southLane: [0, -13],
});

const links = [
  ['camp', 'westSouth'], ['westSouth', 'westLane'], ['westLane', 'westNorth'], ['westNorth', 'workshop'],
  ['workshop', 'northWest'], ['northWest', 'hall'], ['hall', 'northEast'],
  ['northEast', 'tower'], ['tower', 'eastNorth'], ['eastNorth', 'eastLane'], ['eastLane', 'comms'],
  ['comms', 'southEast'], ['southEast', 'southLane'], ['southLane', 'camp'],
  ['northWest', 'northEast'],
];
const neighbours = Object.fromEntries(Object.keys(PATROL_NODES).map(key => [key, []]));
for (const [a, b] of links) { neighbours[a].push(b); neighbours[b].push(a); }

export const PATROL_STOPS = Object.freeze({
  assault: ['camp', 'tower', 'camp'],
  recon: ['camp', 'comms', 'camp'],
  engineer: ['workshop', 'hall', 'camp', 'workshop'],
  sentinel: ['camp', 'tower', 'hall', 'camp'],
  medic: ['camp', 'workshop', 'camp'],
});
export const PATROL_ORDERS = Object.freeze({
  standard: 'Role route', camp: 'Hold at camp', hall: 'Command Hall',
  workshop: 'Workshop / Forge', tower: 'Arc Battery', comms: 'Communications',
});
export const DEFENDER_POST_NODES = Object.freeze({ gate: 'southLane', hall: 'hall', tower: 'tower', comms: 'comms', workshop: 'workshop' });

export function setPatrolOrder(motion, order, standardStops = null) {
  if (!Object.hasOwn(PATROL_ORDERS, order) || !PATROL_STOPS[motion.role]) throw new Error('Unknown patrol order');
  const stops = order === 'standard' ? standardStops || PATROL_STOPS[motion.role]
    : order === 'camp' ? ['camp'] : ['camp', order, 'camp'];
  if (motion.order === order && motion.stops.join('|') === stops.join('|')) return motion;
  motion.order = order;
  motion.stops = stops;
  motion.stopIndex = motion.stops.indexOf(motion.node);
  if (motion.stopIndex < 0 && order !== 'standard' && order !== 'camp') motion.stopIndex = 0;
  motion.route = [];
  motion.routeIndex = 0;
  motion.waypoints = null;
  motion.waypointNode = null;
  motion.wait = 0;
  return motion;
}

export function patrolNodesForLayout(layout) {
  const nodes = Object.fromEntries(Object.entries(PATROL_NODES).map(([key, point]) => [key, [...point]]));
  const occupied = new Set();
  for (const point of Object.values(layout?.structures || {})) for (const cell of footprintCells(point.x, point.z)) occupied.add(cell);
  for (const wall of layout?.walls || []) occupied.add(cellKey(wall.x, wall.z));
  for (const [stop, key] of [['hall', 'hq'], ['workshop', 'workshop'], ['tower', 'tower'], ['comms', 'comms']]) {
    const point = layout?.structures?.[key];
    if (!point) continue;
    const choices = [4, 6, 8, 10].flatMap(radius => [
      [point.x, point.z + radius], [point.x + radius, point.z],
      [point.x - radius, point.z], [point.x, point.z - radius],
      [point.x + radius, point.z + radius], [point.x - radius, point.z + radius],
      [point.x + radius, point.z - radius], [point.x - radius, point.z - radius],
    ]);
    nodes[stop] = choices.find(([x, z]) => !blockedByLayout(x, z, layout) && !occupied.has(cellKey(x, z))) || nodes[stop];
  }
  if (layout?.yardAccessible && layout.structures?.['timberline-depot']) {
    const point = layout.structures['timberline-depot'];
    const choices = [[point.x + 5, point.z], [point.x + 5, point.z + 2], [point.x + 5, point.z - 2], [point.x, point.z + 5]];
    nodes.yard = choices.find(([x, z]) => !blockedByLayout(x, z, layout)) || nodes.yard;
  }
  return nodes;
}

export function shortestPatrolPath(start, end) {
  if (!PATROL_NODES[start] || !PATROL_NODES[end]) throw new Error('Unknown patrol stop');
  const queue = [[start]];
  const seen = new Set([start]);
  while (queue.length) {
    const route = queue.shift();
    const last = route.at(-1);
    if (last === end) return route;
    for (const next of neighbours[last]) if (!seen.has(next)) { seen.add(next); queue.push([...route, next]); }
  }
  throw new Error(`No walkable path from ${start} to ${end}`);
}

export function createPatrolMotion(role, index = 0) {
  const stops = PATROL_STOPS[role];
  if (!stops) throw new Error(`Unknown patrol role: ${role}`);
  const stop = stops[index % stops.length];
  return { role, stops, stopIndex: index % stops.length, node: stop,
    order: 'standard',
    route: [], routeIndex: 0, x: PATROL_NODES[stop][0], z: PATROL_NODES[stop][1],
    yaw: Math.PI, stride: index * 0.9, wait: 2 + index * 0.75, moving: false,
    speed: role === 'sentinel' ? 1.35 : role === 'engineer' ? 1.55 : 1.7 };
}

export function createDefenderMotion(role, post) {
  const node = DEFENDER_POST_NODES[post];
  if (!node) throw new Error(`Unknown defender post: ${post}`);
  const motion = createPatrolMotion('assault');
  motion.role = role;
  motion.stops = ['camp', node, 'camp'];
  motion.speed = role === 'hound' ? 2.3 : role === 'guardian' ? 1.2 : 1.55;
  motion.wait = 0.7;
  return motion;
}

function blockedByLayout(x, z, layout) {
  const core = x >= -17 && x <= 17 && z >= -15 && z <= 15;
  const yard = layout?.yardAccessible && x >= -29 && x < -17 && z >= -10 && z <= 2;
  if (!core && !yard) return true;
  for (const [key, point] of Object.entries(layout?.structures || {})) {
    const clearance = (BUILDING_ASSETS[key]?.footprint ?? 6) / 2 + .3;
    if ((Math.abs(point.x) <= 16 && Math.abs(point.z) <= 14 || key === 'timberline-depot' && layout.yardAccessible) && Math.abs(x - point.x) <= clearance && Math.abs(z - point.z) <= clearance) return true;
  }
  for (const wall of layout?.walls || []) if (Math.abs(x - wall.x) <= 1 && Math.abs(z - wall.z) <= 1) return true;
  return false;
}

// Four-way A* stays off the occupied footprint. Compress collinear cells so units
// walk fluidly between the camp and building entrances instead of orbiting a base.
export function walkablePatrolPath(from, to, layout) {
  const start = [Math.round(from[0]), Math.round(from[1])];
  const end = [Math.round(to[0]), Math.round(to[1])];
  const key = ([x, z]) => `${x},${z}`;
  const endKey = key(end), startKey = key(start);
  const open = [{ point: start, cost: 0, estimate: Math.abs(start[0] - end[0]) + Math.abs(start[1] - end[1]) }];
  const best = new Map([[startKey, 0]]), previous = new Map();
  while (open.length) {
    open.sort((a, b) => a.cost + a.estimate - b.cost - b.estimate);
    const current = open.shift();
    const currentKey = key(current.point);
    if (current.cost !== best.get(currentKey)) continue;
    if (currentKey === endKey) {
      const path = [end];
      let cursor = endKey;
      while (cursor !== startKey) { cursor = previous.get(cursor); if (!cursor) return null; path.push(cursor.split(',').map(Number)); }
      path.reverse();
      const turns = [];
      for (let i = 1; i < path.length; i++) {
        const direction = [path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]];
        const next = path[i + 1];
        if (!next || next[0] - path[i][0] !== direction[0] || next[1] - path[i][1] !== direction[1]) turns.push(path[i]);
      }
      if (!turns.length || turns.at(-1)[0] !== to[0] || turns.at(-1)[1] !== to[1]) turns.push([...to]);
      return turns;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = [current.point[0] + dx, current.point[1] + dz];
      const nextKey = key(next);
      if (nextKey !== endKey && blockedByLayout(next[0], next[1], layout)) continue;
      const cost = current.cost + 1;
      if (cost >= (best.get(nextKey) ?? Infinity)) continue;
      best.set(nextKey, cost); previous.set(nextKey, currentKey);
      open.push({ point: next, cost, estimate: Math.abs(next[0] - end[0]) + Math.abs(next[1] - end[1]) });
    }
  }
  return null;
}

export function stepPatrolMotion(motion, deltaSeconds, nodePositions = PATROL_NODES, layout = null) {
  let remaining = Math.max(0, Math.min(deltaSeconds, 0.1));
  motion.moving = false;
  if (motion.wait > 0) {
    motion.wait = Math.max(0, motion.wait - remaining);
    return motion;
  }
  if (!motion.route.length) {
    motion.stopIndex = (motion.stopIndex + 1) % motion.stops.length;
    // Head for the next assigned building directly. The grid path handles
    // obstacles; the perimeter graph made a commute look like a base circuit.
    motion.route = [motion.node, motion.stops[motion.stopIndex]];
    motion.routeIndex = 1;
  }
  while (remaining > 0 && motion.routeIndex < motion.route.length) {
    const nextNode = motion.route[motion.routeIndex];
    const [tx, tz] = nodePositions[nextNode];
    if (layout && motion.waypointNode !== nextNode) {
      motion.waypoints = walkablePatrolPath([motion.x, motion.z], [tx, tz], layout);
      motion.waypointNode = nextNode;
      if (!motion.waypoints) { motion.route = []; motion.wait = 4; motion.moving = false; return motion; }
    }
    const [targetX, targetZ] = layout ? motion.waypoints[0] || [tx, tz] : [tx, tz];
    const dx = targetX - motion.x, dz = targetZ - motion.z;
    const distance = Math.hypot(dx, dz);
    const distanceStep = motion.speed * remaining;
    if (distance < 0.001 || distance <= distanceStep) {
      motion.x = targetX; motion.z = targetZ;
      remaining -= distance / motion.speed;
      if (layout && motion.waypoints.length) motion.waypoints.shift();
      if (!layout || !motion.waypoints.length) { motion.node = nextNode; motion.routeIndex++; motion.waypointNode = null; }
    } else {
      motion.x += dx / distance * distanceStep;
      motion.z += dz / distance * distanceStep;
      remaining = 0;
    }
    if (distance > 0.001) {
      const targetYaw = Math.atan2(dx, dz);
      const angle = Math.atan2(Math.sin(targetYaw - motion.yaw), Math.cos(targetYaw - motion.yaw));
      motion.yaw += Math.max(-0.18, Math.min(0.18, angle));
      motion.moving = true;
    }
  }
  if (motion.routeIndex >= motion.route.length) {
    motion.route = [];
    motion.waypoints = null;
    motion.wait = motion.node === 'camp' ? 13 : motion.node === 'hall' ? 8 : 6;
    motion.moving = false;
  }
  if (motion.moving) motion.stride += deltaSeconds * motion.speed * 4.8;
  return motion;
}
