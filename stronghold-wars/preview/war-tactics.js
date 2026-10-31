// A frozen local war snapshot is the only input to a tactical order. The
// browser preview never reads the defender's subsequently edited live base.
import { SQUAD_ROLES, squadProfile } from './squad-assets.js';
import { DEFENDER_POST_NODES, patrolNodesForLayout } from './patrol-routes.js';
export const WAR_LANES = Object.freeze({
  west: Object.freeze({ name: 'West treeline', start: [-22, 0], entry: [-16, 0] }),
  south: Object.freeze({ name: 'South ridge', start: [0, 22], entry: [0, 16] }),
  east: Object.freeze({ name: 'East service road', start: [22, 0], entry: [16, 0] }),
});
export const WAR_OBJECTIVES = Object.freeze({
  hq: 'Command Hall', tower: 'Arc Battery', comms: 'Communications', depot: 'DZN Supply Depot',
});
export const SUPPLY_DISRUPTION = Object.freeze({ thresholdPercent: 50, counterfirePercent: 85 });
export const WAR_SYSTEMS = Object.freeze({ thresholdPercent: 50, batteryFirePercent: 50, reconSignalBonus: 5 });
export const WAR_DEFENDER_RANGES = Object.freeze({ guardian: 10, aegis: 12, trapper: 9, hound: 11 });
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
  supply: Object.freeze({ name: 'Secure the supply line', detail: 'Depot guards counter strikes aimed at the shared supply cache; personal stock remains safe.' }),
  reserve: Object.freeze({ name: 'Keep a home reserve', detail: 'A ready squad reduces the opening left by away scouts and attackers.' }),
});

export function evaluateWarDefenceOrder(order, tactic, plan, awaySquads = 0) {
  if (!Object.hasOwn(WAR_DEFENCE_ORDERS, order) || !['assault', 'recon'].includes(tactic))
    return { ok: false, error: 'Choose a valid war defence order.' };
  const active = order === 'perimeter' && plan?.method === 'breach'
    || order === 'battery' && plan?.objective === 'tower'
    || order === 'signals' && (tactic === 'recon' || plan?.objective === 'comms')
    || order === 'supply' && plan?.objective === 'depot'
    || order === 'reserve' && awaySquads > 0;
  return {
    ok: true, order, name: WAR_DEFENCE_ORDERS[order].name, active: Boolean(active),
    scorePenalty: active && order !== 'reserve' ? ['battery', 'supply'].includes(order) ? 5 : 4 : 0,
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

// Replay motion is presentation only: the accepted attack already contains its
// score, hit times and casualties. Keep departures and returns continuous even
// when a troop withdraws before the rest of its squad.
export function warReplayTravel(progress, lag = 0, withdrawalAt = 0.84) {
  const delay = clamp(Number(lag) || 0, 0, 0.3);
  const p = clamp(((Number(progress) || 0) - delay) / (1 - delay), 0, 1);
  const turn = clamp(((Number(withdrawalAt) || 0.84) - delay) / (1 - delay), 0.25, 0.92);
  const outward = Math.min(1, p / 0.7);
  const distanceAtTurn = Math.min(1, turn / 0.7);
  return {
    fraction: p <= turn ? outward : Math.max(0, distanceAtTurn * (1 - (p - turn) / (1 - turn))),
    retreating: p > turn,
    moving: p > 0 && (p < 0.7 || p > turn) && p < 1,
  };
}

export function warTurnToward(current, target, maxStep) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + clamp(delta, -Math.max(0, maxStep), Math.max(0, maxStep));
}

// Consume waypoints at a capped walking speed, including several short cells
// in one frame. The caller owns pathfinding and can update the goal as a Hound
// pursues or returns to its defensive post.
export function stepWarRoute(position, waypoints, speed, deltaSeconds) {
  let x = position.x, z = position.z, index = 0, moved = 0, yaw = null;
  let budget = Math.max(0, Number(speed) || 0) * clamp(Number(deltaSeconds) || 0, 0, 0.1);
  while (index < waypoints.length) {
    const target = waypoints[index];
    const dx = target[0] - x, dz = target[1] - z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001) { index++; continue; }
    if (budget <= 0) break;
    const step = Math.min(distance, budget);
    x += dx / distance * step;
    z += dz / distance * step;
    moved += step;
    budget -= step;
    yaw = Math.atan2(dx, dz);
    if (step >= distance - 0.001) index++;
    else break;
  }
  return { x, z, waypoints: waypoints.slice(index), yaw, moved };
}

export function warReplayHealth(track, progress) {
  if (!track) return 0;
  const maximum = Math.max(0, Number(track.maxHealth) || 0);
  const starting = Number.isFinite(track.startingHealth) ? clamp(track.startingHealth, 0, maximum) : maximum;
  const damage = (track.hits || []).filter(hit => hit.at <= progress).reduce((total, hit) => total + hit.damage, 0);
  return clamp(starting - damage, 0, maximum);
}

export function warStandingWalls(layout, condition, report, progress = 0) {
  const tracks = new Map((report?.walls || []).map(wall => [wall.id, wall]));
  return (layout?.walls || []).filter(wall => condition?.walls?.[wall.id] !== 0
    && (!tracks.has(wall.id) || warReplayHealth(tracks.get(wall.id), progress) > 0));
}

const objectiveMaxHealth = (defender, key) => 180 + clamp(whole(defender.base.levels[key], 5), 1, 5) * 70;
const wallMaxHealth = wall => 55 + clamp(whole(wall.level, 5), 1, 5) * 35;
const savedHealth = (value, maximum) => Number.isFinite(value) ? whole(value, maximum) : maximum;

export function warDefenderPosts(defender) {
  if (!defender?.base?.layout) return [];
  const nodes = patrolNodesForLayout(defender.base.layout);
  return Object.entries(WAR_DEFENDER_RANGES).flatMap(([role, range]) => {
    const assigned = defender.base.defenders?.[role];
    const node = DEFENDER_POST_NODES[assigned?.post];
    const position = nodes[node];
    const level = whole(assigned?.level, 5);
    return position && level ? [{ role, level, post: assigned.post, x: position[0], z: position[1], range }] : [];
  });
}

// A system's damage matters only to a later strike. The current strike uses
// its launch condition, and saved v2 attacks keep their original battle rules.
export function warSystemStatus(defender, condition) {
  const batteryMax = objectiveMaxHealth(defender, 'tower');
  const relayMax = objectiveMaxHealth(defender, 'comms');
  const batteryHealth = savedHealth(condition?.objectives?.tower, batteryMax);
  const relayHealth = savedHealth(condition?.objectives?.comms, relayMax);
  return {
    batterySuppressed: batteryHealth * 100 <= batteryMax * WAR_SYSTEMS.thresholdPercent,
    batteryOffline: batteryHealth === 0,
    relayJammed: relayHealth * 100 <= relayMax * WAR_SYSTEMS.thresholdPercent,
  };
}

// Store only damaged IDs from the accepted base. A later strike takes this
// snapshot at launch, so field orders never rewrite a strike already launched.
export function normalizeWarCondition(defender, source) {
  const objectives = {};
  for (const key of Object.keys(WAR_OBJECTIVES)) {
    if (Number.isFinite(source?.objectives?.[key])) objectives[key] = whole(source.objectives[key], objectiveMaxHealth(defender, key));
  }
  const walls = {};
  for (const wall of defender.base.layout?.walls || []) {
    if (Number.isFinite(source?.walls?.[wall.id])) walls[wall.id] = whole(source.walls[wall.id], wallMaxHealth(wall));
  }
  return { objectives, walls };
}

export function warConditionAfter(defender, attacks) {
  const condition = { objectives: {}, walls: {} };
  for (const attack of attacks) {
    if (!attack.damage?.ok) continue;
    const target = attack.damage.objective;
    if (Object.hasOwn(WAR_OBJECTIVES, target?.key)) {
      const maximum = objectiveMaxHealth(defender, target.key);
      condition.objectives[target.key] = Math.min(savedHealth(condition.objectives[target.key], maximum), whole(target.remainingHealth, maximum));
    }
    for (const segment of attack.damage.walls || []) {
      const wall = defender.base.layout?.walls?.find(item => item.id === segment.id);
      if (!wall) continue;
      const maximum = wallMaxHealth(wall);
      condition.walls[wall.id] = Math.min(savedHealth(condition.walls[wall.id], maximum), whole(segment.remainingHealth, maximum));
    }
  }
  return condition;
}

function attackRoles(attacker, attack, capacity) {
  const lead = attack.tactic === 'recon' ? 'recon' : 'assault';
  const roles = Object.keys(SQUAD_ROLES).flatMap(role => Array(whole(attack.squad?.counts?.[role], capacity)).fill(role)).slice(0, capacity);
  while (roles.length < capacity) roles.push(lead);
  if (!attack.squad?.counts) for (let slot = 0; slot < capacity; slot++) {
    if (slot === capacity - 1 && squadProfile('medic', attacker.base.levels).unlocked) roles[slot] = 'medic';
    else if (attack.tactic === 'assault' && slot % 4 === 3 && squadProfile('sentinel', attacker.base.levels).unlocked) roles[slot] = 'sentinel';
  }
  return roles;
}

// This bounded replay record turns an already committed war result into visible
// health and impact beats. It never awards points or decides a new casualty.
export function buildWarDamageReport(attacker, defender, attack) {
  if (!attacker?.base?.levels || !defender?.base?.levels || !attack || !['assault', 'recon'].includes(attack.tactic))
    return { ok: false, error: 'A locked war attack and both base snapshots are required.' };
  const capacity = whole(attacker.stats?.squadSize, 12);
  if (!capacity) return { ok: false, error: 'The locked squad has no deployment slots.' };
  const roles = attackRoles(attacker, attack, capacity);
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

// New local-preview attacks resolve from the accepted snapshots. Every hit is
// applied before the score is committed; re-running with the same orders gives
// the same result. Legacy attacks continue to use the v1 replay above.
export function simulateWarCombat(attacker, defender, attack) {
  if (!attacker?.base?.levels || !defender?.base?.levels || !attack?.tactics?.ok
    || !['assault', 'recon'].includes(attack.tactic))
    return { ok: false, error: 'A locked route and both war snapshots are required.' };
  const capacity = whole(attacker.stats?.squadSize, 12);
  if (!capacity) return { ok: false, error: 'The locked squad has no deployment slots.' };
  const route = attack.tactics.route;
  if (!Array.isArray(route) || route.length !== 4 || route.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.z)))
    return { ok: false, error: 'The locked battle route is invalid.' };
  const roles = attackRoles(attacker, attack, capacity);
  const squad = roles.map((role, slot) => {
    const profile = squadProfile(role, attacker.base.levels);
    return { slot, role, maxHealth: profile.maxHealth, remainingHealth: profile.maxHealth, withdrawn: false, hits: [] };
  });
  const objectiveKey = attack.tactics.plan.objective;
  if (!Object.hasOwn(WAR_OBJECTIVES, objectiveKey)) return { ok: false, error: 'The locked objective is invalid.' };
  const level = clamp(whole(defender.base.levels[objectiveKey], 5), 1, 5);
  const objectiveHealth = 180 + level * 70;
  const startingHealth = savedHealth(attack.conditionAtLaunch?.objectives?.[objectiveKey], objectiveHealth);
  const objective = { key: objectiveKey, name: WAR_OBJECTIVES[objectiveKey], maxHealth: objectiveHealth, startingHealth, remainingHealth: startingHealth, hits: [] };
  const wallById = new Map((defender.base.layout?.walls || []).map(wall => [wall.id, wall]));
  const walls = [...new Set(attack.tactics.breachedWallIds || [])].slice(0, 4).map(id => {
    const wall = wallById.get(id);
    if (!wall) return null;
    const tier = clamp(whole(wall.level, 5), 1, 5);
    const maxHealth = 55 + tier * 35;
    const startingHealth = savedHealth(attack.conditionAtLaunch?.walls?.[id], maxHealth);
    return { id, x: wall.x, z: wall.z, tier, maxHealth, startingHealth, remainingHealth: startingHealth, hits: [] };
  }).filter(Boolean);
  const orders = Array.isArray(attack.orders) ? attack.orders : [];
  const contact = orders.find(order => order.phase === 'contact')?.command;
  const withdrawal = orders.find(order => order.phase === 'withdrawal')?.command;
  const tower = defender.base.layout?.structures?.tower || { x: 0, z: 0 };
  const hall = defender.base.layout?.structures?.hq || { x: 0, z: 0 };
  const targetPosition = (slot, wave) => {
    const from = wave < 2 ? route[1] : wave < 4 ? route[2] : route[3];
    const towards = wave < 2 ? route[2] : route[3];
    const fraction = wave % 2 ? 0.8 : 0.35;
    const dx = towards.x - from.x, dz = towards.z - from.z;
    const span = Math.hypot(dx, dz) || 1;
    const laneOffset = (slot % 2 ? -1 : 1) * Math.ceil(slot / 2) * 0.9;
    return { x: from.x + dx * fraction - dz / span * laneOffset, z: from.z + dz * fraction + dx / span * laneOffset };
  };
  const applyHit = (track, amount, at) => {
    const applied = clamp(Math.round(amount), -Math.max(0, track.maxHealth - track.remainingHealth), track.remainingHealth);
    if (applied) { track.remainingHealth -= applied; track.hits.push({ at, damage: applied }); }
  };
  const nearest = (point, wave) => squad.filter(unit => unit.remainingHealth > 0).map(unit => {
    const position = targetPosition(unit.slot, wave);
    return { unit, distance: (point.x - position.x) ** 2 + (point.z - position.z) ** 2 };
  }).sort((a, b) => a.distance - b.distance || a.unit.slot - b.unit.slot)[0]?.unit;
  // Only newly launched battles use spatial specialist abilities. Earlier
  // accepted attacks must continue to resolve with their original rules.
  const specialistCombat = attack.defenderCombatVersion === 2;
  const specialists = Object.fromEntries((specialistCombat ? warDefenderPosts(defender) : []).map(post => [post.role, post]));
  const defenderEvents = [];
  const inRange = (role, unit, wave) => {
    const post = specialists[role];
    if (!post || !unit || unit.remainingHealth <= 0) return false;
    const position = targetPosition(unit.slot, wave);
    return (post.x - position.x) ** 2 + (post.z - position.z) ** 2 <= post.range ** 2;
  };
  const d = defender.base.levels;
  const fortification = whole(defender.stats?.fortification, 50);
  const depotMaxHealth = objectiveMaxHealth(defender, 'depot');
  const depotHealthAtLaunch = savedHealth(attack.conditionAtLaunch?.objectives?.depot, depotMaxHealth);
  const supplyDisrupted = defender.base.depotRaidable !== false
    && depotHealthAtLaunch * 100 <= depotMaxHealth * SUPPLY_DISRUPTION.thresholdPercent;
  const systems = attack.systemsVersion === 2 ? warSystemStatus(defender, attack.conditionAtLaunch) :
    { batterySuppressed: false, batteryOffline: false, relayJammed: false };
  const defencePower = (19 + d.hq * 5 + d.tower * 8 + fortification * 1.4
    + whole(attack.defenderPenalty, 40) * 1.6 + whole(attack.defenceOrderPenalty, 20) * 2.2)
    * (supplyDisrupted ? SUPPLY_DISRUPTION.counterfirePercent / 100 : 1);
  for (let wave = 0; wave < 6; wave++) {
    const at = [0.32, 0.42, 0.52, 0.62, 0.72, 0.82][wave];
    const active = squad.filter(unit => unit.remainingHealth > 0);
    if (!active.length) break;
    for (const unit of active) {
      const profile = squadProfile(unit.role, attacker.base.levels);
      const wall = walls.find(segment => segment.remainingHealth > 0);
      let amount = profile.damage * (wall ? unit.role === 'engineer' ? 0.85 : 0.48 : 0.51);
      if (!wall && attack.tactic === 'recon' && unit.role === 'recon') {
        if (objectiveKey === 'comms') amount *= 1.32;
        else if (objectiveKey === 'depot') amount *= 1.22;
      }
      if (!wall && attack.tactics.plan.method === 'flank') amount *= 0.82;
      if (contact === 'focus' && wave >= 2 && !wall) amount *= 1.24;
      if (withdrawal === 'pursue' && wave >= 4 && !wall) amount *= 1.3;
      if (withdrawal === 'cover' && wave >= 4) amount *= 0.75;
      const target = wall || objective;
      if (target.remainingHealth > 0 && attack.tactic === 'assault' && inRange('guardian', unit, wave)) {
        const blocked = Math.round(amount * (0.12 + specialists.guardian.level * 0.035));
        amount -= blocked;
        if (blocked && !defenderEvents.some(event => event.role === 'guardian' && event.wave === wave))
          defenderEvents.push({ role: 'guardian', wave, at, slot: unit.slot, post: specialists.guardian.post, amount: blocked });
      }
      if (target.remainingHealth > 0 && attack.tactic === 'recon' && inRange('aegis', unit, wave)) {
        const blocked = Math.round(amount * (0.15 + specialists.aegis.level * 0.04));
        amount -= blocked;
        if (blocked && !defenderEvents.some(event => event.role === 'aegis' && event.wave === wave))
          defenderEvents.push({ role: 'aegis', wave, at, slot: unit.slot, post: specialists.aegis.post, amount: blocked });
      }
      applyHit(target, amount, at + unit.slot * 0.0001);
    }
    const cover = contact === 'smoke' && wave >= 2 ? 0.6 : 1;
    const exitCover = withdrawal === 'cover' && wave >= 4 ? 0.62 : 1;
    const pressure = withdrawal === 'pursue' && wave >= 4 ? 1.25 : 1;
    for (const [index, point] of [tower, hall].entries()) {
      const unit = nearest(point, wave);
      if (!unit) break;
      const profile = squadProfile(unit.role, attacker.base.levels);
      const batteryPower = systems.batteryOffline ? 0 : systems.batterySuppressed ? WAR_SYSTEMS.batteryFirePercent / 100 : 1;
      const raw = defencePower * (index ? 0.39 : 0.61 * batteryPower) * cover * exitCover * pressure;
      if (index === 0 && systems.batteryOffline) continue;
      const armour = profile.armour * (index ? 0.35 : 0.5);
      applyHit(unit, Math.max(2, raw - armour), at + 0.015 + index * 0.004);
    }
    for (const [role, activeWave] of [['trapper', wave % 2 === 0], ['hound', wave >= 2 && wave % 2 === 0]]) {
      const post = specialists[role];
      if (!post || !activeWave) continue;
      const unit = nearest(post, wave);
      if (!inRange(role, unit, wave)) continue;
      const before = unit.remainingHealth;
      applyHit(unit, role === 'trapper' ? 4 + post.level * 2 : 5 + post.level * 2, at + (role === 'trapper' ? 0.021 : 0.023));
      const dealt = before - unit.remainingHealth;
      if (dealt) defenderEvents.push({ role, wave, at: at + (role === 'trapper' ? 0.021 : 0.023), slot: unit.slot, post: post.post, amount: dealt });
    }
    const medic = squad.find(unit => unit.role === 'medic' && unit.remainingHealth > 0);
    if (medic && wave >= 1) {
      const wounded = squad.filter(unit => unit.remainingHealth > 0 && unit.remainingHealth < unit.maxHealth)
        .sort((a, b) => a.remainingHealth / a.maxHealth - b.remainingHealth / b.maxHealth || a.slot - b.slot)[0];
      if (wounded) applyHit(wounded, -(8 + squadProfile('medic', attacker.base.levels).tier * 3), at + 0.026);
    }
  }
  for (const unit of squad) unit.withdrawn = unit.remainingHealth === 0;
  const casualties = squad.filter(unit => unit.withdrawn).length;
  const breached = walls.filter(wall => wall.startingHealth > 0 && wall.remainingHealth === 0).length;
  const damageFraction = (objective.startingHealth - objective.remainingHealth) / objective.maxHealth;
  const signalBonus = systems.relayJammed && attack.tactic === 'recon' ? WAR_SYSTEMS.reconSignalBonus : 0;
  const score = clamp(Math.round(whole(attack.combatBaseScore, 100) + damageFraction * 19 + breached * 2 - casualties * 2 + signalBonus), 0, 100);
  return { ok: true, version: specialistCombat ? 3 : 2, score, casualties, squad, objective, walls, supplyDisrupted,
    ...(specialistCombat ? { defenderEvents } : {}),
    batterySuppressed: systems.batterySuppressed, batteryOffline: systems.batteryOffline, relayJammed: systems.relayJammed, signalBonus };
}

const point = pair => ({ x: pair[0], z: pair[1] });
function distanceToSegment(wall, start, end) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const fraction = lengthSquared ? clamp(((wall.x - start.x) * dx + (wall.z - start.z) * dz) / lengthSquared, 0, 1) : 0;
  return { distance: Math.hypot(wall.x - start.x - dx * fraction, wall.z - start.z - dz * fraction), fraction };
}

export function evaluateWarPlan(defender, tactic, input, condition = null) {
  if (!defender?.base?.layout || !['assault', 'recon'].includes(tactic) || !input || typeof input !== 'object'
    || !WAR_LANES[input.lane] || !WAR_OBJECTIVES[input.objective] || !WAR_METHODS[input.method]) {
    return { ok: false, error: 'Choose a valid entry, objective and approach.' };
  }
  const plan = { lane: input.lane, objective: input.objective, method: input.method };
  if (plan.objective === 'depot' && defender.base.depotRaidable === false)
    return { ok: false, error: 'The locked base predates the Supply Depot objective. Choose another target.' };
  const lane = WAR_LANES[plan.lane];
  const entry = point(lane.entry);
  const targetSource = defender.base.layout.structures?.[plan.objective];
  if (!Number.isFinite(targetSource?.x) || !Number.isFinite(targetSource?.z)) return { ok: false, error: 'The locked target position is unavailable.' };
  const target = { x: targetSource.x, z: targetSource.z };
  const corridor = (defender.base.layout.walls || []).filter(wall => condition?.walls?.[wall.id] !== 0)
    .map(wall => ({ wall, ...distanceToSegment(wall, entry, target) }))
    .filter(hit => hit.distance <= 2.25 && hit.fraction < 0.88)
    .sort((a, b) => a.fraction - b.fraction || a.wall.id.localeCompare(b.wall.id));
  const wallPressure = clamp(corridor.reduce((sum, hit) => sum + hit.wall.level, 0), 0, 12);
  const breachedWallIds = plan.method === 'breach' ? corridor.slice(0, 4).map(hit => hit.wall.id) : [];
  const nearbyBattery = distanceToSegment(defender.base.layout.structures.tower, entry, target).distance <= 7;
  const objectiveScore = plan.objective === 'hq' ? 4 : plan.objective === 'tower' && tactic === 'assault' ? 3
    : plan.objective === 'comms' && tactic === 'recon' ? 3 : plan.objective === 'depot' && tactic === 'recon' ? 4 : 0;
  const methodScore = plan.method === 'breach' ? (tactic === 'assault' ? 5 : 2) - wallPressure * 2 : 1 - Math.ceil(wallPressure / 2);
  const scoreDelta = clamp(objectiveScore + methodScore, -12, 9);
  const casualtyDelta = clamp((plan.method === 'breach' ? 1 + Math.ceil(wallPressure / 3) : -1)
    + (nearbyBattery && plan.objective !== 'tower' ? 1 : 0) + (['hq', 'depot'].includes(plan.objective) ? 1 : 0), -1, 5);
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
