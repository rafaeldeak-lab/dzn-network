// Walkable links around the four buildings. Stops are outside their footprints.
// The camp is the squad's home until a dedicated Barracks plot exists.
export const PATROL_NODES = Object.freeze({
  camp: [-4, -12], westSouth: [-9, -8], westLane: [-15, 0], westNorth: [-15, 10],
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
  assault: ['camp', 'tower', 'hall', 'camp'],
  recon: ['comms', 'tower', 'comms'],
  engineer: ['workshop', 'hall', 'camp', 'workshop'],
  sentinel: ['tower', 'northWest', 'hall', 'tower'],
  medic: ['camp', 'hall', 'workshop', 'camp'],
});
export const DEFENDER_POST_NODES = Object.freeze({ gate: 'southLane', hall: 'hall', tower: 'tower', comms: 'comms', workshop: 'workshop' });

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

export function stepPatrolMotion(motion, deltaSeconds) {
  let remaining = Math.max(0, Math.min(deltaSeconds, 0.1));
  motion.moving = false;
  if (motion.wait > 0) {
    motion.wait = Math.max(0, motion.wait - remaining);
    return motion;
  }
  if (!motion.route.length) {
    motion.stopIndex = (motion.stopIndex + 1) % motion.stops.length;
    motion.route = shortestPatrolPath(motion.node, motion.stops[motion.stopIndex]);
    motion.routeIndex = 1;
  }
  while (remaining > 0 && motion.routeIndex < motion.route.length) {
    const nextNode = motion.route[motion.routeIndex];
    const [tx, tz] = PATROL_NODES[nextNode];
    const dx = tx - motion.x, dz = tz - motion.z;
    const distance = Math.hypot(dx, dz);
    const distanceStep = motion.speed * remaining;
    if (distance < 0.001 || distance <= distanceStep) {
      motion.x = tx; motion.z = tz; motion.node = nextNode;
      remaining -= distance / motion.speed;
      motion.routeIndex++;
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
    motion.wait = motion.node === 'camp' ? 5 : motion.node === 'hall' ? 3.5 : 2.5;
    motion.moving = false;
  }
  if (motion.moving) motion.stride += deltaSeconds * motion.speed * 4.8;
  return motion;
}
