// A frozen local war snapshot is the only input to a tactical order. The
// browser preview never reads the defender's subsequently edited live base.
import { SQUAD_ROLES, squadProfile } from './squad-assets.js';
export const WAR_LANES = Object.freeze({
  west: Object.freeze({ name: 'West treeline', start: [-22, 0], entry: [-16, 0] }),
  south: Object.freeze({ name: 'South ridge', start: [0, 22], entry: [0, 16] }),
  east: Object.freeze({ name: 'East service road', start: [22, 0], entry: [16, 0] }),
});
export const WAR_OBJECTIVES = Object.freeze({
  hq: 'Command Hall', tower: 'Arc Battery', comms: 'Communications',
});
export const WAR_METHODS = Object.freeze({ breach: 'Cut through', flank: 'Flank under cover' });
export const WAR_FIELD_ORDERS = Object.freeze({
  contact: Object.freeze({ focus: 'Focus fire', smoke: 'Smoke advance' }),
  withdrawal: Object.freeze({ pursue: 'Press the target', cover: 'Cover withdrawal' }),
});
export const WAR_DEFENCE_ORDERS = Object.freeze({
  balanced: Object.freeze({ name: 'Standard watch', detail: 'No specialist counter. The existing base and defender posts hold their ground.' }),
  perimeter: Object.freeze({ name: 'Hold the perimeter', detail: 'Wall guards punish a cut-through assault.' }),
  battery: Object.freeze({ name: 'Guard the Arc Battery', detail: 'Concentrated fire protects the Arc Battery objective.' }),
  signals: Object.freeze({ name: 'Protect the relay', detail: 'Signal jammers disrupt reconnaissance and Communications strikes.' }),
  reserve: Object.freeze({ name: 'Keep a home reserve', detail: 'A ready squad reduces the opening left by away scouts and attackers.' }),
});

export function evaluateWarDefenceOrder(order, tactic, plan, awaySquads = 0) {
  if (!Object.hasOwn(WAR_DEFENCE_ORDERS, order) || !['assault', 'recon'].includes(tactic))
    return { ok: false, error: 'Choose a valid war defence order.' };
  const active = order === 'perimeter' && plan?.method === 'breach'
    || order === 'battery' && plan?.objective === 'tower'
    || order === 'signals' && (tactic === 'recon' || plan?.objective === 'comms')
    || order === 'reserve' && awaySquads > 0;
  return {
    ok: true, order, name: WAR_DEFENCE_ORDERS[order].name, active: Boolean(active),
    scorePenalty: active && order !== 'reserve' ? order === 'battery' ? 5 : 4 : 0,
    casualtyPressure: active && order !== 'reserve' ? 1 : 0,
    exposureShield: active && order === 'reserve' ? 6 : 0,
  };
}

export function evaluateWarFieldOrder(tactic, phase, command) {
  if (!['assault', 'recon'].includes(tactic) || !WAR_FIELD_ORDERS[phase]?.[command])
    return { ok: false, error: 'Choose a valid field order for this battle phase.' };
  const effects = {
    contact: { focus: { scoreDelta: tactic === 'assault' ? 6 : 4, casualtyDelta: 1 }, smoke: { scoreDelta: tactic === 'recon' ? 2 : 0, casualtyDelta: -1 } },
    withdrawal: { pursue: { scoreDelta: tactic === 'assault' ? 5 : 3, casualtyDelta: 1 }, cover: { scoreDelta: -3, casualtyDelta: -2 } },
  };
  return { ok: true, phase, command, name: WAR_FIELD_ORDERS[phase][command], ...effects[phase][command] };
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const whole = (value, maximum) => clamp(Math.floor(Number(value) || 0), 0, maximum);

// This bounded replay record turns an already committed war result into visible
// health and impact beats. It never awards points or decides a new casualty.
export function buildWarDamageReport(attacker, defender, attack) {
  if (!attacker?.base?.levels || !defender?.base?.levels || !attack || !['assault', 'recon'].includes(attack.tactic))
    return { ok: false, error: 'A locked war attack and both base snapshots are required.' };
  const capacity = whole(attacker.stats?.squadSize, 12);
  if (!capacity) return { ok: false, error: 'The locked squad has no deployment slots.' };
  const lead = attack.tactic === 'recon' ? 'recon' : 'assault';
  const roles = Object.keys(SQUAD_ROLES).flatMap(role => Array(whole(attack.squad?.counts?.[role], capacity)).fill(role)).slice(0, capacity);
  while (roles.length < capacity) roles.push(lead);
  if (!attack.squad?.counts) for (let slot = 0; slot < capacity; slot++) {
    if (slot === capacity - 1 && squadProfile('medic', attacker.base.levels).unlocked) roles[slot] = 'medic';
    else if (attack.tactic === 'assault' && slot % 4 === 3 && squadProfile('sentinel', attacker.base.levels).unlocked) roles[slot] = 'sentinel';
  }
  const casualties = whole(attack.casualties, capacity);
  const squad = roles.map((role, slot) => {
    const maxHealth = squadProfile(role, attacker.base.levels).maxHealth;
    const withdrawn = slot >= capacity - casualties;
    const damage = withdrawn ? maxHealth : Math.min(maxHealth - 1, Math.round(maxHealth * (0.16 + slot % 3 * 0.055)));
    const first = Math.round(damage * 0.35);
    const second = Math.round(damage * 0.35);
    return { slot, role, maxHealth, remainingHealth: maxHealth - damage, withdrawn,
      hits: [{ at: 0.43 + slot % 3 * 0.012, damage: first }, { at: 0.61 + slot % 2 * 0.014, damage: second },
        { at: withdrawn ? 0.74 : 0.68, damage: damage - first - second }].filter(hit => hit.damage > 0) };
  });
  const objectiveKey = Object.hasOwn(WAR_OBJECTIVES, attack.tactics?.plan?.objective) ? attack.tactics.plan.objective : 'hq';
  const level = clamp(whole(defender.base.levels[objectiveKey], 5), 1, 5);
  const maxHealth = 180 + level * 70;
  // A recall loses war points after the fight; it does not repair the target.
  const committedScore = whole(Number(attack.score) + Number(attack.recallPenalty || 0), 100);
  const damage = Math.min(maxHealth - 1, Math.round(maxHealth * committedScore * 0.0085));
  const volley = Math.round(damage * 0.28);
  const objective = { key: objectiveKey, name: WAR_OBJECTIVES[objectiveKey], maxHealth, remainingHealth: maxHealth - damage,
    hits: [{ at: 0.51, damage: volley }, { at: 0.65, damage: volley }, { at: 0.79, damage: damage - volley * 2 }].filter(hit => hit.damage > 0) };
  const wallsById = new Map((defender.base.layout?.walls || []).map(wall => [wall.id, wall]));
  const breachedWallIds = Array.isArray(attack.tactics?.breachedWallIds) ? attack.tactics.breachedWallIds : [];
  const walls = [...new Set(breachedWallIds)].slice(0, 4).map((id, index) => {
    const wall = wallsById.get(id);
    if (!wall) return null;
    const tier = clamp(whole(wall.level, 5), 1, 5);
    const wallHealth = 55 + tier * 35;
    const first = Math.round(wallHealth * 0.3), second = Math.round(wallHealth * 0.35);
    return { id, x: wall.x, z: wall.z, tier, maxHealth: wallHealth, remainingHealth: 0,
      hits: [{ at: 0.3 + index * 0.012, damage: first }, { at: 0.36 + index * 0.012, damage: second },
        { at: 0.42 + index * 0.012, damage: wallHealth - first - second }] };
  }).filter(Boolean);
  return { ok: true, version: 1, casualties, squad, objective, walls };
}

const point = pair => ({ x: pair[0], z: pair[1] });
function distanceToSegment(wall, start, end) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const fraction = lengthSquared ? clamp(((wall.x - start.x) * dx + (wall.z - start.z) * dz) / lengthSquared, 0, 1) : 0;
  return { distance: Math.hypot(wall.x - start.x - dx * fraction, wall.z - start.z - dz * fraction), fraction };
}

export function evaluateWarPlan(defender, tactic, input) {
  if (!defender?.base?.layout || !['assault', 'recon'].includes(tactic) || !input || typeof input !== 'object'
    || !WAR_LANES[input.lane] || !WAR_OBJECTIVES[input.objective] || !WAR_METHODS[input.method]) {
    return { ok: false, error: 'Choose a valid entry, objective and approach.' };
  }
  const plan = { lane: input.lane, objective: input.objective, method: input.method };
  const lane = WAR_LANES[plan.lane];
  const entry = point(lane.entry);
  const targetSource = defender.base.layout.structures?.[plan.objective];
  if (!Number.isFinite(targetSource?.x) || !Number.isFinite(targetSource?.z)) return { ok: false, error: 'The locked target position is unavailable.' };
  const target = { x: targetSource.x, z: targetSource.z };
  const corridor = (defender.base.layout.walls || []).map(wall => ({ wall, ...distanceToSegment(wall, entry, target) }))
    .filter(hit => hit.distance <= 2.25 && hit.fraction < 0.88)
    .sort((a, b) => a.fraction - b.fraction || a.wall.id.localeCompare(b.wall.id));
  const wallPressure = clamp(corridor.reduce((sum, hit) => sum + hit.wall.level, 0), 0, 12);
  const breachedWallIds = plan.method === 'breach' ? corridor.slice(0, 4).map(hit => hit.wall.id) : [];
  const nearbyBattery = distanceToSegment(defender.base.layout.structures.tower, entry, target).distance <= 7;
  const objectiveScore = plan.objective === 'hq' ? 4 : plan.objective === 'tower' && tactic === 'assault' ? 3 : plan.objective === 'comms' && tactic === 'recon' ? 3 : 0;
  const methodScore = plan.method === 'breach' ? (tactic === 'assault' ? 5 : 2) - wallPressure * 2 : 1 - Math.ceil(wallPressure / 2);
  const scoreDelta = clamp(objectiveScore + methodScore, -12, 9);
  const casualtyDelta = clamp((plan.method === 'breach' ? 1 + Math.ceil(wallPressure / 3) : -1)
    + (nearbyBattery && plan.objective !== 'tower' ? 1 : 0) + (plan.objective === 'hq' ? 1 : 0), -1, 5);
  const middle = corridor[0] && plan.method === 'breach'
    ? { x: corridor[0].wall.x, z: corridor[0].wall.z }
    : plan.method === 'flank'
      ? { x: (entry.x + target.x) / 2 + (plan.lane === 'south' ? -4 : 0), z: (entry.z + target.z) / 2 + (plan.lane === 'south' ? 0 : plan.lane === 'west' ? -4 : 4) }
      : { x: (entry.x + target.x) / 2, z: (entry.z + target.z) / 2 };
  return {
    ok: true, plan, laneName: lane.name, objectiveName: WAR_OBJECTIVES[plan.objective], methodName: WAR_METHODS[plan.method],
    wallPressure, wallCount: corridor.length, breachedWallIds, scoreDelta, casualtyDelta,
    route: [point(lane.start), entry, middle, target],
  };
}
