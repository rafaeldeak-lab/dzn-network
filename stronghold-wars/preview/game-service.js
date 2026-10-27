/*
 * Replaceable local-preview service boundary for DZN Stronghold Wars.
 * This module owns entitlement/role checks, shared community state, personal
 * inventories, idempotent actions, progression, and Forge persistence. It is
 * intentionally local-only; it is not an authentication or security boundary.
 */
import { SQUAD_ROLES, squadBattleStats, squadUnlocked, evaluateWarSquad } from './squad-assets.js';
import { DEFENDER_CONCEPTS, DEFENDER_COSTS, DEFENDER_POSTS, defenderBattleEffect } from './defender-assets.js';
import { routeBriefing } from './world-map.js';
import { CORE_DEFAULTS, DISTRICT_DEFAULTS, WALL_COSTS, MAX_WALLS_PER_HALL, defaultLayout, isGridCell, layoutOccupancy, rowCells, validateLayoutPosition, validateWallPosition, zoneAt, cellKey } from './layout-grid.js';
import { newOperationsState, normalizeOperationsState } from './operative-ops.js';
import { PATROL_ORDERS } from './patrol-routes.js';
import { WAR_DEFENCE_ORDERS, evaluateWarPlan, evaluateWarFieldOrder, evaluateWarDefenceOrder, buildWarDamageReport, simulateWarCombat, normalizeWarCondition, warConditionAfter } from './war-tactics.js';
export const SERVICE_STORAGE_KEY = 'dzn-stronghold-save-v3';
export const V2_STORAGE_KEY = 'dzn-stronghold-save-v2';
export const V2_BACKUP_KEY = 'dzn-stronghold-save-v2-backup';
export const LEGACY_STORAGE_KEY = 'dzn-stronghold-save-v1';
export const LEGACY_BACKUP_KEY = 'dzn-stronghold-save-v1-backup';
export const CORRUPT_BACKUP_PREFIX = `${SERVICE_STORAGE_KEY}-corrupt-backup-v1-`;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const FIELD_ORDERS = Object.freeze([
  Object.freeze({ id: 'parts', name: 'Supply Pickup', objective: 'Collect produced Parts from your Workshop / Forge.', rewardParts: 40 }),
  Object.freeze({ id: 'forge', name: 'Field Fabrication', objective: 'Claim a completed Forge job.', rewardParts: 50 }),
  Object.freeze({ id: 'drill', name: 'Outpost Drill', objective: 'Win a practice raid with your training squad.', rewardParts: 60 }),
]);
export const WAR_RULES = Object.freeze({
  challengeLifetimeMs: 24 * 60 * 60 * 1000,
  preparationReadyMs: 30 * 1000,
  preparationWindowMs: 5 * 60 * 1000,
  attackWindowMs: 10 * 60 * 1000,
  maxAttacksPerSide: 2,
  localRewardParts: 40,
  scoutArrivalMs: 30 * 1000,
  squadReturnMs: 90 * 1000,
  maxScoutsPerSide: 2,
});
export const BATTLE_WEAR_RULES = Object.freeze({ maxSeverity: 3, repairParts: 25, repairTimber: 1 });
export const WAR_STAGE_DEFS = Object.freeze([
  Object.freeze({ id: 'forge-convoy', name: 'Forge Convoy', building: 'Workshop / Forge', key: 'workshop', parts: 30, timber: 10, objective: 'Dispatch repair kits and Timber to the front.' }),
  Object.freeze({ id: 'relay-capture', name: 'Relay Capture', building: 'Communications', key: 'comms', parts: 40, timber: 0, objective: 'Secure the DZN signal link before the rival side.' }),
  Object.freeze({ id: 'tower-stand', name: 'Tower Stand', building: 'Arc Battery', key: 'tower', parts: 25, timber: 15, objective: 'Hold the perimeter through the final timed phase.' }),
]);

export const GAME_CONFIG = Object.freeze({
  maxLevel: 5,
  revealSeconds: 2.5,
  constructionSecondsPerLevel: 20,
  dailySalvage: 100,
  forgeQueueBuffer: 2,
  landPlots: Object.freeze([
    Object.freeze({ id: 'command-compound', name: 'Command Compound', hall: 1, trees: 0, timberCost: 0, position: [0, 0] }),
    Object.freeze({ id: 'timberline-depot', name: 'Timberline Depot', hall: 2, trees: 3, timberCost: 60, position: [-23, -4] }),
    Object.freeze({ id: 'ridgewatch-range', name: 'Ridgewatch Range', hall: 3, trees: 4, timberCost: 100, position: [23, -4] }),
    Object.freeze({ id: 'signal-marsh', name: 'Signal Marsh', hall: 4, trees: 5, timberCost: 150, position: [-15, 22] }),
    Object.freeze({ id: 'highland-works', name: 'Highland Works', hall: 5, trees: 6, timberCost: 210, position: [16, 22] }),
  ]),
  timberPerTree: 30,
  recycledTimber: 30,
  recycleSalvageCost: 50,
  routeSalvageBonusPerLevel: 5,
  routeCosts: Object.freeze([[0, 0], [45, 20], [100, 35], [180, 55], [290, 80], [440, 110]]),
  barricadeTimberCost: 30,
  maxBarricadesPerPlot: 3,
  facilities: Object.freeze({
    'timberline-depot': Object.freeze({ name: 'Timberline Lumber Yard', model: 'timberline', purpose: 'Stored Timber production and daily personal resupply', costs: Object.freeze([[0, 0], [100, 30], [250, 60], [500, 90], [900, 120], [1500, 150]]) }),
    'ridgewatch-range': Object.freeze({ name: 'Ridgewatch Training Range', model: 'ridgewatch', purpose: '+2 Assault score per level', costs: Object.freeze([[0, 0], [100, 30], [250, 60], [500, 90], [900, 120], [1500, 150]]) }),
    'signal-marsh': Object.freeze({ name: 'Signal Marsh Relay', model: 'signal', purpose: '+2 Recon score per level', costs: Object.freeze([[0, 0], [100, 30], [250, 60], [500, 90], [900, 120], [1500, 150]]) }),
    'highland-works': Object.freeze({ name: 'Highland Defence Works', model: 'highland', purpose: '-2 opposing attack score per level', costs: Object.freeze([[0, 0], [100, 30], [250, 60], [500, 90], [900, 120], [1500, 150]]) }),
  }),
  forgeRecipes: Object.freeze([
    Object.freeze({ id: 'field-parts', name: 'Field Parts', input: 100, output: 80, durationSeconds: 15 }),
    Object.freeze({ id: 'precision-parts', name: 'Precision Parts', input: 250, output: 220, durationSeconds: 30 }),
  ]),
  buildings: Object.freeze({
    hq: Object.freeze({
      name: 'Command Hall', kind: 'hall', costs: Object.freeze([0, 600, 1800, 4200, 8500]),
      stats: Object.freeze([
        Object.freeze({ squad: 4, wallTier: 1 }), Object.freeze({ squad: 6, wallTier: 2 }),
        Object.freeze({ squad: 8, wallTier: 3 }), Object.freeze({ squad: 10, wallTier: 4 }),
        Object.freeze({ squad: 12, wallTier: 5 }),
      ]),
      benefits: Object.freeze([
        'Command core established; perimeter walls Tier 1', 'Unlocks support Level 2 and walls Tier 2',
        'Unlocks support Level 3, two Forge slots and walls Tier 3',
        'Unlocks support Level 4 and walls Tier 4',
        'Unlocks support Level 5, three Forge slots and walls Tier 5',
      ]),
    }),
    workshop: Object.freeze({
      name: 'Workshop / Forge', kind: 'support', costs: Object.freeze([0, 250, 700, 1600, 3200]),
      stats: Object.freeze([1, 2, 3, 4, 5].map(level => Object.freeze({ partsPerSecond: level * 2 }))),
      benefits: Object.freeze(['2 Parts/sec; personal Forge access', '4 Parts/sec', '6 Parts/sec', '8 Parts/sec', '10 Parts/sec']),
    }),
    tower: Object.freeze({
      name: 'Arc Battery', kind: 'support', costs: Object.freeze([0, 250, 700, 1600, 3200]),
      stats: Object.freeze([1, 2, 3, 4, 5].map(level => Object.freeze({ firepowerPercent: level * 25 }))),
      benefits: Object.freeze([25, 50, 75, 100, 125].map(value => `Training squad firepower +${value}%`)),
    }),
    comms: Object.freeze({
      name: 'Communications', kind: 'support', costs: Object.freeze([0, 250, 700, 1600, 3200]),
      stats: Object.freeze([1, 2, 3, 4, 5].map(level => Object.freeze({ trainingRewardPercent: level * 20 }))),
      benefits: Object.freeze([20, 40, 60, 80, 100].map(value => `Training reward +${value}%`)),
    }),
  }),
  districts: Object.freeze([
    Object.freeze({ name: 'Command Compound', hall: 1, status: 'Available now' }),
    Object.freeze({ name: 'Timberline Depot', hall: 2, status: 'Lumber Yard construction' }),
    Object.freeze({ name: 'Ridgewatch Range', hall: 3, status: 'Training Range construction' }),
    Object.freeze({ name: 'Signal Marsh', hall: 4, status: 'Relay construction' }),
    Object.freeze({ name: 'Highland Works', hall: 5, status: 'Defence Works construction' }),
  ]),
});

export const PREVIEW_IDENTITIES = Object.freeze([
  Object.freeze({ id: 'iron-owner', name: 'Rafael Demo', communityId: 'iron-pines', role: 'owner', verified: true, membership: true }),
  Object.freeze({ id: 'iron-admin', name: 'Ava North', communityId: 'iron-pines', role: 'admin', verified: true, membership: true }),
  Object.freeze({ id: 'iron-member', name: 'Kai Mercer', communityId: 'iron-pines', role: 'member', verified: true, membership: true }),
  Object.freeze({ id: 'iron-unverified', name: 'Unverified Guest', communityId: 'iron-pines', role: 'member', verified: false, membership: true }),
  Object.freeze({ id: 'violet-owner', name: 'Mira Vale', communityId: 'violet-ridge', role: 'owner', verified: true, membership: true }),
  Object.freeze({ id: 'violet-admin', name: 'Jules Rowan', communityId: 'violet-ridge', role: 'admin', verified: true, membership: true }),
  Object.freeze({ id: 'violet-member', name: 'Niko Reed', communityId: 'violet-ridge', role: 'member', verified: true, membership: true }),
  Object.freeze({ id: 'free-owner', name: 'Cedar Demo', communityId: 'mossback-free', role: 'owner', verified: true, membership: true }),
  Object.freeze({ id: 'free-member', name: 'Pine Guest', communityId: 'mossback-free', role: 'member', verified: true, membership: true }),
]);

const COMMUNITIES = Object.freeze([
  Object.freeze({ id: 'iron-pines', name: 'Iron Pines Collective', eligible: true, proActive: true, map: [47, 29], members: Object.freeze(['iron-owner', 'iron-admin', 'iron-member', 'iron-unverified']) }),
  Object.freeze({ id: 'violet-ridge', name: 'Violet Ridge Syndicate', eligible: true, proActive: true, map: [23, 32], members: Object.freeze(['violet-owner', 'violet-admin', 'violet-member']) }),
  Object.freeze({ id: 'mossback-free', name: 'Mossback Free Community', eligible: false, proActive: false, map: [82, 38], members: Object.freeze(['free-owner', 'free-member']) }),
]);

const SUPPORT_KEYS = Object.freeze(['workshop', 'tower', 'comms']);
const nowDefault = () => Date.now();
const safeInt = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
};
const clone = value => JSON.parse(JSON.stringify(value));
const TRAINING_ROLES = Object.freeze(Object.keys(SQUAD_ROLES));
const trainingCapacity = levels => 2 + (levels.hq || 1) * 2;
const REINFORCEMENT_REQUEST_MS = 12 * 60 * 60 * 1000;
const MAX_REINFORCEMENTS_PER_REQUEST = 4;
export const TRAINING_COSTS = Object.freeze({ assault: 30, recon: 40, engineer: 40, sentinel: 60, medic: 50 });
export const TRAINING_SECONDS = Object.freeze({ assault: 12, recon: 16, engineer: 16, sentinel: 24, medic: 20 });
const starterReserve = () => Object.fromEntries(TRAINING_ROLES.map(role => [role, role === 'assault' ? 4 : 0]));
const normalizedReserve = reserve => Object.fromEntries(TRAINING_ROLES.map(role => [role, Math.min(100, safeInt(reserve?.[role]))]));
function defaultTrainingLoadout(levels) {
  const counts = Object.fromEntries(TRAINING_ROLES.map(role => [role, 0]));
  counts.assault = trainingCapacity(levels);
  return counts;
}
function validTrainingLoadout(counts, levels) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return false;
  let total = 0;
  for (const role of TRAINING_ROLES) {
    const count = Number(counts[role] ?? 0);
    if (!Number.isSafeInteger(count) || count < 0 || count > trainingCapacity(levels) || (count && !squadUnlocked(role, levels))) return false;
    total += count;
  }
  return total > 0 && total <= trainingCapacity(levels) && Object.keys(counts).every(role => TRAINING_ROLES.includes(role));
}
function normalizedTrainingLoadout(counts, levels) {
  return validTrainingLoadout(counts, levels)
    ? Object.fromEntries(TRAINING_ROLES.map(role => [role, Number(counts[role] ?? 0)]))
    : defaultTrainingLoadout(levels);
}

function emptyBase(treasury = 200) {
  return {
    levels: { hq: 1, workshop: 1, tower: 1, comms: 1 },
    treasury: safeInt(treasury), projects: [], nextProjectNumber: 1,
    completedProjectIds: [], actionRecords: [], chronicle: [], raidCount: 0, lastRaidClaimed: 0,
    reinforcementRequests: [],
    legacyJobs: [], completedLegacyJobIds: [],
    layout: defaultLayout(), blueprints: [],
    patrolOrders: Object.fromEntries(Object.keys(SQUAD_ROLES).map(role => [role, 'standard'])),
    repairPriority: null,
    defenders: Object.fromEntries(Object.keys(DEFENDER_CONCEPTS).map(role => [role, { level: 0, post: null, project: null }])),
    landPlots: GAME_CONFIG.landPlots.map(plot => ({
      id: plot.id, treesRemaining: plot.trees, status: plot.hall === 1 ? 'claimed' : 'wild',
      timberFunded: 0, barricades: 0, facilityLevel: 0, facilityProject: null, routeLevel: 0, routeProject: null, wear: 0,
    })),
  };
}

function emptyMember() {
  return { parts: 600, stored: 0, productionAt: 0, salvage: 150, timber: 0, timberStored: 0, timberProductionAt: 0, nextClaimAt: 0, nextTimberClaimAt: 0, lifetimeContributed: 0, forgeJobs: [], actionRecords: [], trainingLoadout: null, trainingReserve: starterReserve(), trainingJobs: [], warDeployments: [], fieldOrders: { day: '', completed: [], claimed: [] }, muted: false };
}

function createFreshState() {
  const communities = {};
  const members = {};
  for (const community of COMMUNITIES) {
    communities[community.id] = {
      proActive: community.proActive,
      base: emptyBase(200),
    };
  }
  for (const profile of PREVIEW_IDENTITIES) members[profile.id] = emptyMember();
  return {
    schemaVersion: 3,
    currentIdentityId: 'iron-owner',
    communities,
    members,
    wars: [],
    scouts: [],
    nextScoutNumber: 1,
    warActionRecords: [],
    warRewardLedger: [],
    nextWarNumber: 1,
    operations: newOperationsState(),
    migratedLegacy: false,
    createdAt: Date.now(),
  };
}

function createRecoveryState() {
  const state = createFreshState();
  for (const community of COMMUNITIES) state.communities[community.id] = { proActive: community.proActive, base: emptyBase(0) };
  for (const profile of PREVIEW_IDENTITIES) state.members[profile.id] = { ...emptyMember(), parts: 0, salvage: 0 };
  state.recoveryNotice = '';
  return state;
}

function normalizeLevel(value, fallback = 1) {
  return Math.min(GAME_CONFIG.maxLevel, Math.max(1, safeInt(value, fallback) || 1));
}

function migrateLegacySave(legacy) {
  const next = createFreshState();
  next.migratedLegacy = true;
  // Existing balances are moved once to the primary preview owner's personal
  // inventory and the primary community. No other identity receives a copy.
  for (const profile of PREVIEW_IDENTITIES) {
    next.members[profile.id] = { ...emptyMember(), parts: 0, salvage: 0 };
  }
  const member = next.members['iron-owner'];
  member.parts = safeInt(legacy?.parts);
  member.stored = Number.isFinite(Number(legacy?.stored)) ? Math.max(0, Number(legacy.stored)) : 0;
  member.salvage = 0;
  member.muted = Boolean(legacy?.muted);

  const primary = next.communities['iron-pines'].base;
  primary.treasury = safeInt(legacy?.treasury);
  const sourceLevels = legacy?.levels && typeof legacy.levels === 'object' ? legacy.levels : {};
  for (const key of Object.keys(GAME_CONFIG.buildings)) primary.levels[key] = normalizeLevel(sourceLevels[key], 1);
  primary.raidCount = safeInt(legacy?.raidCount);
  primary.lastRaidClaimed = safeInt(legacy?.lastRaidClaimed);
  primary.raidCount = Math.max(primary.raidCount, primary.lastRaidClaimed);

  if (legacy?.upgrades && typeof legacy.upgrades === 'object') {
    for (const key of Object.keys(GAME_CONFIG.buildings)) {
      const end = Number(legacy.upgrades[key]?.end);
      const targetLevel = primary.levels[key] + 1;
      if (Number.isFinite(end) && end > 0 && targetLevel <= GAME_CONFIG.maxLevel) {
        const id = `legacy-${key}-${targetLevel}-${Math.floor(end)}`;
        primary.legacyJobs.push({ id, key, targetLevel, end, migratedPaid: true });
      }
    }
  }
  return next;
}

function normalizeWarRecord(war) {
  if (!war || typeof war !== 'object' || typeof war.id !== 'string') return null;
  const communities = ['iron-pines', 'violet-ridge'];
  if (!communities.includes(war.challengerCommunityId) || !communities.includes(war.defenderCommunityId) || war.challengerCommunityId === war.defenderCommunityId) return null;
  const side = source => {
    const levels = {};
    for (const key of Object.keys(GAME_CONFIG.buildings)) levels[key] = normalizeLevel(source?.base?.levels?.[key], 1);
    const hq = levels.hq;
    const landPlots = GAME_CONFIG.landPlots.map(config => {
      const saved = Array.isArray(source?.base?.landPlots) ? source.base.landPlots.find(plot => plot?.id === config.id) : null;
      const status = saved?.status === 'claimed' ? 'claimed' : config.hall === 1 ? 'claimed' : 'wild';
      return { id: config.id, status, barricades: status === 'claimed' ? Math.min(GAME_CONFIG.maxBarricadesPerPlot, safeInt(saved?.barricades)) : 0, facilityLevel: status === 'claimed' ? Math.min(GAME_CONFIG.maxLevel, safeInt(saved?.facilityLevel)) : 0 };
    });
    const structures = defaultLayout().structures;
    for (const key of Object.keys(structures)) {
      const point = source?.base?.layout?.structures?.[key];
      if (isGridCell(point?.x, point?.z)) structures[key] = { x: point.x, z: point.z };
    }
    const walls = Array.isArray(source?.base?.layout?.walls) ? source.base.layout.walls.filter(wall => wall && /^wall-\d+$/.test(wall.id) && isGridCell(wall.x, wall.z)).map(wall => ({ id: wall.id, x: wall.x, z: wall.z, level: Math.min(hq, Math.max(1, safeInt(wall.level, 1))) })).slice(0, MAX_WALLS_PER_HALL[hq]) : [];
    const fortification = landPlots.reduce((total, plot) => total + (plot.status === 'claimed' ? plot.barricades : 0), 0) + Math.min(12, Math.floor(walls.reduce((sum, wall) => sum + wall.level, 0) / 3));
    const facility = Object.fromEntries(landPlots.map(plot => [plot.id, plot.facilityLevel]));
    const defenders = Object.fromEntries(Object.keys(DEFENDER_CONCEPTS).map(role => {
      const saved = source?.base?.defenders?.[role];
      const level = Math.min(GAME_CONFIG.maxLevel, safeInt(saved?.level));
      return [role, { level, post: level && DEFENDER_POSTS[saved?.post] ? saved.post : null }];
    }));
    return {
      communityId: source?.communityId,
      name: String(source?.name || source?.communityId || 'Community'),
      capturedAt: safeInt(source?.capturedAt),
      base: { levels, treasury: safeInt(source?.base?.treasury), landPlots, defenders, layout: { structures, walls } },
      stats: { squadSize: 2 + hq * 2, wallTier: hq, firepower: levels.tower * 25, commsSignal: levels.comms * 20, workshopOutput: levels.workshop * 2, fortification,
        assaultBonus: facility['ridgewatch-range'] * 2, reconBonus: facility['signal-marsh'] * 2, worksDefence: facility['highland-works'] * 2,
        assaultKit: squadBattleStats(levels, 'assault'), reconKit: squadBattleStats(levels, 'recon') },
    };
  };
  const snapshots = { challenger: side(war.snapshots?.challenger), defender: side(war.snapshots?.defender) };
  snapshots.challenger.communityId = war.challengerCommunityId;
  snapshots.defender.communityId = war.defenderCommunityId;
  const states = ['challenged', 'preparation', 'active', 'resolved', 'declined', 'expired'];
  const state = states.includes(war.state) ? war.state : 'expired';
  const roster = {};
  for (const communityId of communities) {
    const source = Array.isArray(war.roster?.[communityId]) ? war.roster[communityId] : [];
    roster[communityId] = source.filter(item => item && typeof item.identityId === 'string').map(item => ({ identityId: item.identityId, name: String(item.name || 'Member'), role: String(item.role || 'member') }));
  }
  const attacks = Array.isArray(war.attacks) ? war.attacks.filter(a => a && typeof a.attackId === 'string' && communities.includes(a.communityId)).map(a => {
    const tactic = a.tactic === 'recon' ? 'recon' : 'assault';
    const attacker = a.communityId === war.challengerCommunityId ? snapshots.challenger : snapshots.defender;
    const defender = a.communityId === war.challengerCommunityId ? snapshots.defender : snapshots.challenger;
    const conditionAtLaunch = normalizeWarCondition(defender, a.conditionAtLaunch);
    const evaluated = a.tactics?.plan ? evaluateWarPlan(defender, tactic, a.tactics.plan, conditionAtLaunch) : null;
    const squad = a.squad?.counts ? evaluateWarSquad(attacker.base.levels, tactic, a.squad.counts, attacker.stats.squadSize, evaluated) : null;
    const normalized = {
      attackId: a.attackId, actionId: String(a.actionId || ''), identityId: String(a.identityId || ''), communityId: a.communityId,
      tactic, at: safeInt(a.at), score: safeInt(a.score), casualties: safeInt(a.casualties), feedback: String(a.feedback || ''),
      baseScore: safeInt(a.baseScore ?? a.score), baseCasualties: safeInt(a.baseCasualties ?? a.casualties),
      combatVersion: a.combatVersion === 2 ? 2 : 1, combatBaseScore: safeInt(a.combatBaseScore),
      orders: Array.isArray(a.orders) ? a.orders.filter(order => evaluateWarFieldOrder(tactic, order?.phase, order?.command).ok)
        .filter((order, index, all) => all.findIndex(item => item.phase === order.phase) === index)
        .slice(0, 2).map(order => ({ ...evaluateWarFieldOrder(tactic, order.phase, order.command), at: safeInt(order.at) })) : [],
      returnAt: safeInt(a.returnAt), returnedAt: safeInt(a.returnedAt), recallPenalty: safeInt(a.recallPenalty), exposureBonus: safeInt(a.exposureBonus), scoutBonus: safeInt(a.scoutBonus), defenderPenalty: safeInt(a.defenderPenalty),
      defenceOrder: Object.hasOwn(WAR_DEFENCE_ORDERS, a.defenceOrder) ? a.defenceOrder : 'balanced',
      defenceOrderActive: Boolean(a.defenceOrderActive), defenceOrderPenalty: safeInt(a.defenceOrderPenalty), defenceExposureShield: safeInt(a.defenceExposureShield),
      tactics: evaluated?.ok ? evaluated : null, squad: squad?.ok ? squad : null, conditionAtLaunch,
    };
    normalized.damage = normalized.combatVersion === 2
      ? simulateWarCombat(attacker, defender, normalized)
      : buildWarDamageReport(attacker, defender, normalized);
    return normalized;
  }) : [];
  const score = Object.fromEntries(communities.map(id => [id, safeInt(war.score?.[id])]));
  const stages = Array.isArray(war.stages) ? war.stages.filter(item => WAR_STAGE_DEFS.some(def => def.id === item?.id)).slice(0, WAR_STAGE_DEFS.length).map(item => ({
    id: item.id, opensAt: safeInt(item.opensAt), closesAt: safeInt(item.closesAt),
    completedBy: Object.fromEntries(communities.map(id => [id, item.completedBy?.[id] && typeof item.completedBy[id].identityId === 'string'
      ? { identityId: item.completedBy[id].identityId, at: safeInt(item.completedBy[id].at), points: Math.min(20, safeInt(item.completedBy[id].points)) } : null])),
  })) : [];
  return {
    id: war.id, challengerCommunityId: war.challengerCommunityId, defenderCommunityId: war.defenderCommunityId,
    challengerIdentityId: String(war.challengerIdentityId || ''), state,
    createdAt: safeInt(war.createdAt), challengeExpiresAt: safeInt(war.challengeExpiresAt), acceptedBy: String(war.acceptedBy || ''),
    acceptedAt: safeInt(war.acceptedAt), prepReadyAt: safeInt(war.prepReadyAt), prepDeadlineAt: safeInt(war.prepDeadlineAt),
    startedBy: String(war.startedBy || ''), startedAt: safeInt(war.startedAt), attackEndsAt: safeInt(war.attackEndsAt),
    resolvedAt: safeInt(war.resolvedAt), declinedAt: safeInt(war.declinedAt), expiredAt: safeInt(war.expiredAt),
    snapshots, roster, attacks, attackIds: [...new Set(attacks.map(a => a.attackId))], score, stages,
    defenceOrders: Object.fromEntries(communities.map(id => {
      const saved = war.defenceOrders?.[id];
      return [id, { order: Object.hasOwn(WAR_DEFENCE_ORDERS, saved?.order) ? saved.order : 'balanced',
        assignedBy: String(saved?.assignedBy || ''), assignedAt: safeInt(saved?.assignedAt) }];
    })),
    winnerCommunityId: communities.includes(war.winnerCommunityId) ? war.winnerCommunityId : null, tie: Boolean(war.tie),
    rewardLedgerIds: Array.isArray(war.rewardLedgerIds) ? war.rewardLedgerIds.filter(id => typeof id === 'string') : [],
    events: Array.isArray(war.events) ? war.events.filter(e => e && typeof e.type === 'string').map(e => ({ type: String(e.type), at: safeInt(e.at), actorId: String(e.actorId || ''), text: String(e.text || ''), details: e.details && typeof e.details === 'object' ? clone(e.details) : {} })) : [],
    replay: war.replay && typeof war.replay === 'object' ? clone(war.replay) : null,
  };
}

function normalizeLoadedState(raw) {
  // A malformed or partially missing save is a recovery case, not a new-game
  // grant. Only createFreshState() for an absent save receives demo balances.
  const fresh = createRecoveryState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fresh;
  fresh.currentIdentityId = PREVIEW_IDENTITIES.some(p => p.id === raw.currentIdentityId) ? raw.currentIdentityId : 'iron-owner';
  fresh.migratedLegacy = Boolean(raw.migratedLegacy);
  fresh.recoveryNotice = typeof raw.recoveryNotice === 'string' ? raw.recoveryNotice : '';
  fresh.createdAt = safeInt(raw.createdAt, Date.now());
  for (const community of COMMUNITIES) {
    const savedCommunity = raw.communities?.[community.id];
    if (!savedCommunity) continue;
    const base = savedCommunity.base || {};
    const normalized = emptyBase(safeInt(base.treasury));
    for (const key of Object.keys(GAME_CONFIG.buildings)) normalized.levels[key] = normalizeLevel(base.levels?.[key], 1);
    for (const role of Object.keys(SQUAD_ROLES)) {
      const order = base.patrolOrders?.[role];
      if (Object.hasOwn(PATROL_ORDERS, order)) normalized.patrolOrders[role] = order;
    }
    for (const role of Object.keys(DEFENDER_CONCEPTS)) {
      const saved = base.defenders?.[role];
      const level = Math.min(GAME_CONFIG.maxLevel, safeInt(saved?.level));
      const targetLevel = level + 1;
      const cost = DEFENDER_COSTS[targetLevel];
      const project = cost && saved?.project?.targetLevel === targetLevel ? {
        targetLevel, cost, funded: Math.min(cost, safeInt(saved.project.funded)),
        donors: Array.isArray(saved.project.donors) ? saved.project.donors.slice(-8).map(d => ({ identityId: String(d.identityId || ''), name: String(d.name || 'Member'), amount: safeInt(d.amount), at: safeInt(d.at) })) : [],
      } : null;
      normalized.defenders[role] = { level, post: level && DEFENDER_POSTS[saved?.post] ? saved.post : null, project };
    }
    normalized.projects = Array.isArray(base.projects) ? base.projects.filter(p => p && typeof p.id === 'string' && GAME_CONFIG.buildings[p.key]).map(p => ({
      id: p.id, key: p.key, targetLevel: normalizeLevel(p.targetLevel, 1), targetAmount: safeInt(p.targetAmount),
      funded: Math.min(safeInt(p.funded), safeInt(p.targetAmount)), benefit: String(p.benefit || ''),
      prerequisites: Array.isArray(p.prerequisites) ? p.prerequisites.map(String) : [],
      status: p.status === 'constructing' && safeInt(p.funded) >= safeInt(p.targetAmount)
        && safeInt(p.startedAt) >= safeInt(p.createdAt) && safeInt(p.finishAt) > safeInt(p.startedAt)
        && Number.isSafeInteger(p.crewSlot) && p.crewSlot >= 0 && p.crewSlot < 3 ? 'constructing'
        : ['completed', 'blocked'].includes(p.status) ? p.status : 'approved', pinned: Boolean(p.pinned),
      createdAt: safeInt(p.createdAt), completedAt: safeInt(p.completedAt),
      crewSlot: p.status === 'constructing' ? safeInt(p.crewSlot) : 0,
      startedAt: p.status === 'constructing' ? safeInt(p.startedAt) : 0,
      finishAt: p.status === 'constructing' ? safeInt(p.finishAt) : 0,
      donors: Array.isArray(p.donors) ? p.donors.slice(-8).map(d => ({ identityId: String(d.identityId || ''), name: String(d.name || 'Member'), amount: safeInt(d.amount), at: safeInt(d.at) })) : [],
    })) : [];
    normalized.nextProjectNumber = Math.max(1, safeInt(base.nextProjectNumber, 1));
    normalized.completedProjectIds = Array.isArray(base.completedProjectIds) ? [...new Set(base.completedProjectIds.filter(v => typeof v === 'string'))] : [];
    normalized.actionRecords = Array.isArray(base.actionRecords) ? base.actionRecords.filter(r => r && typeof r.id === 'string').slice(-500) : [];
    normalized.reinforcementRequests = Array.isArray(base.reinforcementRequests) ? base.reinforcementRequests.filter(request =>
      request && typeof request.id === 'string' && request.id.length <= 160 && TRAINING_ROLES.includes(request.role)
      && PREVIEW_IDENTITIES.some(profile => profile.id === request.identityId && profile.communityId === community.id)
      && Number.isSafeInteger(request.count) && request.count >= 1 && request.count <= MAX_REINFORCEMENTS_PER_REQUEST
      && Number.isSafeInteger(request.donated) && request.donated >= 0 && request.donated <= request.count
      && Number.isFinite(Number(request.createdAt)) && Number.isFinite(Number(request.expiresAt))
    ).slice(-30).map(request => ({ id: request.id, identityId: request.identityId, role: request.role,
      count: request.count, donated: request.donated, createdAt: safeInt(request.createdAt),
      expiresAt: safeInt(request.expiresAt) })) : [];
    const chronicleIds = new Set();
    normalized.chronicle = Array.isArray(base.chronicle) ? base.chronicle.filter(item => {
      if (!item || typeof item.id !== 'string' || !/^(project|land|facility|route|war|defender):[\w-]+(?::\d+)?$/.test(item.id) || chronicleIds.has(item.id)) return false;
      chronicleIds.add(item.id);
      return true;
    }).slice(-120).map(item => ({ id: item.id, kind: ['project', 'land', 'facility', 'route', 'war', 'defender'].includes(item.kind) ? item.kind : 'project', text: String(item.text || '').slice(0, 180), at: safeInt(item.at) })) : [];
    normalized.raidCount = safeInt(base.raidCount);
    normalized.lastRaidClaimed = safeInt(base.lastRaidClaimed);
    normalized.raidCount = Math.max(normalized.raidCount, normalized.lastRaidClaimed);
    normalized.completedLegacyJobIds = Array.isArray(base.completedLegacyJobIds) ? [...new Set(base.completedLegacyJobIds.filter(v => typeof v === 'string'))] : [];
    for (const plot of normalized.landPlots) {
      const savedPlot = Array.isArray(base.landPlots) ? base.landPlots.find(item => item?.id === plot.id) : null;
      const config = GAME_CONFIG.landPlots.find(item => item.id === plot.id);
      if (!savedPlot || !config || config.hall === 1) continue;
      plot.treesRemaining = Math.min(config.trees, safeInt(savedPlot.treesRemaining, config.trees));
      plot.timberFunded = Math.min(config.timberCost, safeInt(savedPlot.timberFunded));
      plot.barricades = Math.min(GAME_CONFIG.maxBarricadesPerPlot, safeInt(savedPlot.barricades));
      plot.status = ['wild', 'cleared', 'approved', 'claimed'].includes(savedPlot.status) ? savedPlot.status : 'wild';
      if (plot.treesRemaining > 0) plot.status = 'wild';
      if (plot.status === 'claimed') plot.timberFunded = config.timberCost;
      if (plot.status !== 'claimed') plot.barricades = 0;
      plot.facilityLevel = plot.status === 'claimed' ? Math.min(GAME_CONFIG.maxLevel, safeInt(savedPlot.facilityLevel)) : 0;
      plot.wear = plot.facilityLevel ? Math.min(BATTLE_WEAR_RULES.maxSeverity, safeInt(savedPlot.wear)) : 0;
      plot.routeLevel = plot.status === 'claimed' ? Math.min(GAME_CONFIG.maxLevel, safeInt(savedPlot.routeLevel)) : 0;
      const project = savedPlot.facilityProject;
      const targetLevel = plot.facilityLevel + 1;
      const costs = GAME_CONFIG.facilities[plot.id]?.costs[targetLevel];
      if (plot.status === 'claimed' && costs && project?.targetLevel === targetLevel) {
        plot.facilityProject = {
          targetLevel, partsCost: costs[0], timberCost: costs[1],
          partsFunded: Math.min(costs[0], safeInt(project.partsFunded)),
          timberFunded: Math.min(costs[1], safeInt(project.timberFunded)),
          donors: Array.isArray(project.donors) ? project.donors.slice(-8).map(d => ({ identityId: String(d.identityId || ''), name: String(d.name || 'Member'), parts: safeInt(d.parts), timber: safeInt(d.timber), at: safeInt(d.at) })) : [],
        };
      }
      const routeProject = savedPlot.routeProject;
      const routeTarget = plot.routeLevel + 1;
      const routeCosts = GAME_CONFIG.routeCosts[routeTarget];
      if (plot.status === 'claimed' && routeCosts && routeProject?.targetLevel === routeTarget) {
        plot.routeProject = {
          targetLevel: routeTarget, partsCost: routeCosts[0], timberCost: routeCosts[1],
          partsFunded: Math.min(routeCosts[0], safeInt(routeProject.partsFunded)),
          timberFunded: Math.min(routeCosts[1], safeInt(routeProject.timberFunded)),
          donors: Array.isArray(routeProject.donors) ? routeProject.donors.slice(-8).map(d => ({ identityId: String(d.identityId || ''), name: String(d.name || 'Member'), parts: safeInt(d.parts), timber: safeInt(d.timber), at: safeInt(d.at) })) : [],
        };
      }
    }
    normalized.repairPriority = normalized.landPlots.some(plot => plot.id === base.repairPriority && plot.wear > 0)
      ? base.repairPriority : normalized.landPlots.find(plot => plot.wear > 0)?.id || null;
    const claimed = new Set(normalized.landPlots.filter(plot => plot.status === 'claimed').map(plot => plot.id));
    const savedLayout = base.layout && typeof base.layout === 'object' ? base.layout : {};
    for (const key of Object.keys(normalized.layout.structures)) {
      const point = savedLayout.structures?.[key];
      if (isGridCell(point?.x, point?.z) && !validateLayoutPosition(normalized.layout, claimed, key, point.x, point.z))
        normalized.layout.structures[key] = { x: point.x, z: point.z };
    }
    const wallIds = new Set();
    for (const wall of Array.isArray(savedLayout.walls) ? savedLayout.walls : []) {
      if (normalized.layout.walls.length >= MAX_WALLS_PER_HALL[normalized.levels.hq]) break;
      if (!wall || typeof wall.id !== 'string' || !/^wall-\d+$/.test(wall.id) || wallIds.has(wall.id)) continue;
      if (!isGridCell(wall.x, wall.z) || validateWallPosition(normalized.layout, claimed, wall.x, wall.z)) continue;
      const level = Math.min(normalized.levels.hq, GAME_CONFIG.maxLevel, Math.max(1, safeInt(wall.level, 1)));
      normalized.layout.walls.push({ id: wall.id, x: wall.x, z: wall.z, level });
      wallIds.add(wall.id);
    }
    normalized.layout.nextWallNumber = Math.max(1, safeInt(savedLayout.nextWallNumber, 1), ...normalized.layout.walls.map(wall => Number(wall.id.slice(5)) + 1));
    const blueprintSlots = new Set();
    normalized.blueprints = (Array.isArray(base.blueprints) ? base.blueprints : []).filter(item => {
      if (!Number.isInteger(item?.slot) || item.slot < 1 || item.slot > 3 || blueprintSlots.has(item.slot)) return false;
      blueprintSlots.add(item.slot);
      return true;
    }).map(item => ({
      slot: item.slot, name: String(item.name || `Plan ${item.slot}`).slice(0, 32), savedAt: safeInt(item.savedAt),
      structures: Object.fromEntries(Object.keys(normalized.layout.structures).map(key => {
        const point = item.structures?.[key];
        return [key, isGridCell(point?.x, point?.z) ? { x: point.x, z: point.z } : null];
      })),
      walls: (Array.isArray(item.walls) ? item.walls : []).slice(0, 72).filter(wall => wall && /^wall-\d+$/.test(wall.id) && isGridCell(wall.x, wall.z))
        .map(wall => ({ id: wall.id, x: wall.x, z: wall.z })),
    }));
    normalized.legacyJobs = Array.isArray(base.legacyJobs) ? base.legacyJobs.filter(j => j && typeof j.id === 'string' && GAME_CONFIG.buildings[j.key] && Number.isFinite(Number(j.end))).map(j => ({ id: j.id, key: j.key, targetLevel: normalizeLevel(j.targetLevel, 1), end: Number(j.end), migratedPaid: true })) : [];
    fresh.communities[community.id] = { proActive: community.eligible ? Boolean(savedCommunity.proActive) : false, base: normalized };
  }
  for (const profile of PREVIEW_IDENTITIES) {
    const saved = raw.members?.[profile.id];
    if (!saved) continue;
    fresh.members[profile.id] = {
      parts: safeInt(saved.parts), stored: Number.isFinite(Number(saved.stored)) ? Math.max(0, Number(saved.stored)) : 0,
      productionAt: safeInt(saved.productionAt),
      salvage: safeInt(saved.salvage), nextClaimAt: safeInt(saved.nextClaimAt), nextTimberClaimAt: safeInt(saved.nextTimberClaimAt),
      timber: safeInt(saved.timber),
      timberStored: Number.isFinite(Number(saved.timberStored)) ? Math.max(0, Math.min(110, Number(saved.timberStored))) : 0,
      timberProductionAt: safeInt(saved.timberProductionAt),
      lifetimeContributed: safeInt(saved.lifetimeContributed),
      forgeJobs: Array.isArray(saved.forgeJobs) ? saved.forgeJobs.filter(j => j && typeof j.id === 'string' && GAME_CONFIG.forgeRecipes.some(r => r.id === j.recipeId)).map(j => ({
        id: j.id, recipeId: j.recipeId, input: safeInt(j.input), output: safeInt(j.output), durationSeconds: safeInt(j.durationSeconds),
        status: ['queued', 'working', 'ready', 'claimed'].includes(j.status) ? j.status : 'queued',
        createdAt: safeInt(j.createdAt), queuedAt: safeInt(j.queuedAt, safeInt(j.createdAt)),
        slot: Number.isSafeInteger(Number(j.slot)) && Number(j.slot) > 0 ? Number(j.slot) : null,
        startedAt: Number.isFinite(Number(j.startedAt)) ? Number(j.startedAt) : null,
        finishAt: Number.isFinite(Number(j.finishAt)) ? Number(j.finishAt) : null, claimedAt: safeInt(j.claimedAt),
      })) : [],
      actionRecords: Array.isArray(saved.actionRecords) ? saved.actionRecords.filter(r => r && typeof r.id === 'string').slice(-500) : [],
      trainingLoadout: saved.trainingLoadout && typeof saved.trainingLoadout === 'object' && !Array.isArray(saved.trainingLoadout)
        ? clone(saved.trainingLoadout) : null,
      // Older saves receive one starter squad; an explicitly empty reserve stays empty.
      trainingReserve: saved.trainingReserve && typeof saved.trainingReserve === 'object' && !Array.isArray(saved.trainingReserve)
        ? normalizedReserve(saved.trainingReserve) : starterReserve(),
      trainingJobs: Array.isArray(saved.trainingJobs) ? saved.trainingJobs.filter(job => job && typeof job.id === 'string' && TRAINING_ROLES.includes(job.role) && Number.isFinite(Number(job.finishAt)))
        .slice(-100).map(job => ({ id: job.id, role: job.role, count: Math.min(12, safeInt(job.count)), finishAt: safeInt(job.finishAt) })).filter(job => job.count > 0) : [],
      warDeployments: Array.isArray(saved.warDeployments) ? saved.warDeployments.filter(item => item && typeof item.warId === 'string' && typeof item.attackId === 'string' && Number.isFinite(Number(item.returnAt)))
        .slice(-100).map(item => ({ warId: item.warId, attackId: item.attackId, returnAt: safeInt(item.returnAt), counts: normalizedReserve(item.counts) })) : [],
      fieldOrders: {
        day: typeof saved.fieldOrders?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.fieldOrders.day) ? saved.fieldOrders.day : '',
        completed: FIELD_ORDERS.map(order => order.id).filter(id => Array.isArray(saved.fieldOrders?.completed) && saved.fieldOrders.completed.includes(id)),
        claimed: FIELD_ORDERS.map(order => order.id).filter(id => Array.isArray(saved.fieldOrders?.claimed) && Array.isArray(saved.fieldOrders?.completed) && saved.fieldOrders.claimed.includes(id) && saved.fieldOrders.completed.includes(id)),
      },
      muted: Boolean(saved.muted),
    };
  }
  fresh.wars = Array.isArray(raw.wars) ? raw.wars.map(normalizeWarRecord).filter(Boolean) : [];
  fresh.scouts = Array.isArray(raw.scouts) ? raw.scouts.filter(scout => scout && typeof scout.id === 'string' && ['iron-pines', 'violet-ridge'].includes(scout.communityId) && ['iron-pines', 'violet-ridge'].includes(scout.targetCommunityId) && scout.communityId !== scout.targetCommunityId && PREVIEW_IDENTITIES.some(profile => profile.id === scout.identityId && profile.communityId === scout.communityId)).slice(-100).map(scout => ({
    id: scout.id, warId: String(scout.warId || ''), identityId: scout.identityId, communityId: scout.communityId, targetCommunityId: scout.targetCommunityId,
    at: safeInt(scout.at), arrivalAt: safeInt(scout.arrivalAt), returnAt: safeInt(scout.returnAt), recalledAt: safeInt(scout.recalledAt),
  })) : [];
  fresh.nextScoutNumber = Math.max(1, safeInt(raw.nextScoutNumber, fresh.scouts.length + 1));
  fresh.warActionRecords = Array.isArray(raw.warActionRecords) ? raw.warActionRecords.filter(r => r && typeof r.id === 'string' && typeof r.actorId === 'string' && r.result && typeof r.result === 'object').slice(-2000).map(r => ({ id: r.id, actorId: r.actorId, kind: String(r.kind || ''), result: clone(r.result), at: safeInt(r.at) })) : [];
  fresh.warRewardLedger = Array.isArray(raw.warRewardLedger) ? raw.warRewardLedger.filter(r => r && typeof r.id === 'string' && typeof r.identityId === 'string').map(r => ({ id: r.id, warId: String(r.warId || ''), identityId: r.identityId, amount: safeInt(r.amount), at: safeInt(r.at) })) : [];
  fresh.nextWarNumber = Math.max(1, safeInt(raw.nextWarNumber, fresh.wars.length + 1));
  fresh.operations = normalizeOperationsState(raw.operations, PREVIEW_IDENTITIES);
  fresh.schemaVersion = 3;
  return fresh;
}

export class LocalGameService {
  constructor({ storage = globalThis.localStorage, now = nowDefault, key = SERVICE_STORAGE_KEY, v2Key = V2_STORAGE_KEY, v2BackupKey = V2_BACKUP_KEY, legacyKey = LEGACY_STORAGE_KEY, backupKey = LEGACY_BACKUP_KEY, logger = globalThis.console } = {}) {
    this.storage = storage;
    this.now = now;
    this.logger = logger;
    this.key = key;
    this.v2Key = v2Key;
    this.v2BackupKey = v2BackupKey;
    this.legacyKey = legacyKey;
    this.backupKey = backupKey;
    this.state = null;
    this._load();
    for (const community of COMMUNITIES) {
      const profile = PREVIEW_IDENTITIES.find(item => item.communityId === community.id);
      if (profile) this.processConstructionJobs(profile.id);
    }
    // Catch up each eligible member exactly once from the last saved clock.
    // Older saves start their production clock now, without a retroactive grant.
    for (const profile of PREVIEW_IDENTITIES) {
      this.advancePartsProduction(profile.id);
      this.advanceTimberProduction(profile.id);
    }
    this.save();
  }

  _preserveRawBackup(key, raw) {
    if (!this.storage || raw === null || raw === undefined) return false;
    try {
      let target = key;
      let suffix = 1;
      while (this.storage.getItem(target) !== null && this.storage.getItem(target) !== raw) target = `${key}-${suffix++}`;
      if (this.storage.getItem(target) === null) this.storage.setItem(target, raw);
      return this.storage.getItem(target) === raw;
    } catch (error) {
      this.logger?.error?.('DZN exact raw save backup could not be written.', error);
      return false;
    }
  }

  _quarantineCorruptV2(raw) {
    if (!this.storage) return false;
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i++) hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619) >>> 0;
    const stem = `${CORRUPT_BACKUP_PREFIX}${hash.toString(16).padStart(8, '0')}`;
    return this._preserveRawBackup(stem, raw);
  }

  _load() {
    let rawV3 = null;
    try { rawV3 = this.storage?.getItem(this.key); } catch (error) { this.logger?.error?.('DZN local save could not be read.', error); }
    if (rawV3 !== null && rawV3 !== undefined) {
      let parsed = null;
      let validV3 = false;
      try {
        parsed = JSON.parse(rawV3);
        validV3 = Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.schemaVersion === 3 && parsed.communities && typeof parsed.communities === 'object' && parsed.members && typeof parsed.members === 'object');
      } catch (error) {
        this.logger?.error?.('DZN version 3 save is corrupt; opening a zero-balance recovery preview.', error);
      }
      if (!validV3) {
        this.state = createRecoveryState();
        this.state.recoveryNotice = 'A damaged or incomplete local save was recovered with zero balances. Its exact original value is quarantined in browser storage so recovery cannot overwrite it.';
        this._preserveCorruptSave = !this._quarantineCorruptV2(rawV3);
        if (!this._preserveCorruptSave) this.save();
      } else {
        this.state = normalizeLoadedState(parsed);
        this.save();
      }
      return;
    }

    let rawV2 = null;
    try { rawV2 = this.storage?.getItem(this.v2Key); } catch (error) { this.logger?.error?.('DZN version 2 save could not be read.', error); }
    if (rawV2 !== null && rawV2 !== undefined) {
      let parsed = null;
      let validV2 = false;
      try {
        parsed = JSON.parse(rawV2);
        validV2 = Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.schemaVersion === 2 && parsed.communities && typeof parsed.communities === 'object' && parsed.members && typeof parsed.members === 'object');
      } catch (error) {
        this.logger?.error?.('DZN version 2 save is corrupt; opening a zero-balance recovery preview.', error);
      }
      if (!validV2) {
        this.state = createRecoveryState();
        this.state.recoveryNotice = 'A damaged or incomplete local save was recovered with zero balances. Its exact original value is quarantined in browser storage so recovery cannot overwrite it.';
        this._preserveCorruptSave = !this._quarantineCorruptV2(rawV2);
        if (!this._preserveCorruptSave) this.save();
      } else {
        this._preserveRawBackup(this.v2BackupKey, rawV2);
        this.state = normalizeLoadedState(parsed);
        this.save();
      }
      return;
    }

    let legacyRaw = null;
    try { legacyRaw = this.storage?.getItem(this.legacyKey); } catch (error) { this.logger?.error?.('DZN legacy save could not be read.', error); }
    if (legacyRaw !== null && legacyRaw !== undefined) {
      let legacy = null;
      try { legacy = JSON.parse(legacyRaw); } catch (error) { this.logger?.error?.('DZN legacy save is corrupt; keeping its raw backup.', error); }
      this.state = migrateLegacySave(legacy);
      this._preserveRawBackup(this.backupKey, legacyRaw);
    } else {
      this.state = createFreshState();
    }
    this.save();
  }

  save() {
    this.state.schemaVersion = 3;
    if (this._preserveCorruptSave) return false;
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.state));
      return true;
    } catch (error) {
      console.error('DZN local save could not be written.', error);
      return false;
    }
  }

  newActionId(prefix = 'action') {
    const random = globalThis.crypto?.randomUUID?.() || `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${random}`;
  }

  profile(identityId = this.state.currentIdentityId) {
    return PREVIEW_IDENTITIES.find(profile => profile.id === identityId) || null;
  }

  community(identityId = this.state.currentIdentityId) {
    const profile = this.profile(identityId);
    const definition = COMMUNITIES.find(community => community.id === profile?.communityId);
    const saved = definition ? this.state.communities[definition.id] : null;
    return definition && saved ? { definition, saved } : null;
  }

  member(identityId = this.state.currentIdentityId) {
    return this.state.members[identityId] || null;
  }

  getIdentityOptions() {
    return PREVIEW_IDENTITIES.map(profile => {
      const community = COMMUNITIES.find(item => item.id === profile.communityId);
      return { ...profile, communityName: community?.name || 'No community' };
    });
  }

  getCommunityInfo(identityId = this.state.currentIdentityId) {
    const entry = this.community(identityId);
    const profile = this.profile(identityId);
    if (!entry || !profile) return null;
    return { id: entry.definition.id, name: entry.definition.name, eligible: entry.definition.eligible, proActive: entry.saved.proActive, role: profile.role };
  }

  // Public-style projection for the local map. No member inventory, donor,
  // treasury, exact location or private roster data crosses this boundary.
  getWorldMap() {
    return COMMUNITIES.map(definition => {
      const saved = this.state.communities[definition.id];
      const base = saved.base;
      return {
        id: definition.id, name: definition.name, map: [...definition.map], illustrative: true,
        accessTier: definition.eligible && saved.proActive ? 'owner Pro active' : 'view only',
        hallLevel: base.levels.hq,
        wallSegments: base.layout.walls.length,
        wallTierTotal: base.layout.walls.reduce((sum, wall) => sum + wall.level, 0),
        buildings: Object.fromEntries(Object.entries(base.levels).map(([key, level]) => [key, level])),
        defenders: Object.fromEntries(Object.entries(base.defenders).map(([role, defender]) => [role, { level: defender.level, post: defender.post }])),
        districts: base.landPlots.map(plot => ({ id: plot.id, status: plot.status, treesRemaining: plot.treesRemaining,
          facilityLevel: plot.facilityLevel, routeLevel: plot.routeLevel, barricades: plot.barricades, wear: plot.wear })),
        construction: base.projects.filter(project => ['approved', 'constructing'].includes(project.status)).map(project => ({
          kind: 'building', name: GAME_CONFIG.buildings[project.key].name, key: project.key, targetLevel: project.targetLevel,
          percent: project.targetAmount > 0 ? Math.floor(project.funded / project.targetAmount * 100) : 0,
          status: project.status, startedAt: project.startedAt || 0, finishAt: project.finishAt || 0,
        })).concat(base.landPlots.flatMap(plot => [
          plot.facilityProject ? { kind: 'facility', name: GAME_CONFIG.facilities[plot.id]?.name || 'District facility', targetLevel: plot.facilityProject.targetLevel,
            percent: Math.floor(100 * (plot.facilityProject.partsFunded + plot.facilityProject.timberFunded) / (plot.facilityProject.partsCost + plot.facilityProject.timberCost)) } : null,
          plot.routeProject ? { kind: 'route', name: 'Supply route', targetLevel: plot.routeProject.targetLevel,
            percent: Math.floor(100 * (plot.routeProject.partsFunded + plot.routeProject.timberFunded) / (plot.routeProject.partsCost + plot.routeProject.timberCost)) } : null,
        ].filter(Boolean))).concat(Object.entries(base.defenders).flatMap(([role, defender]) => defender.project ? [{
          kind: 'defender', name: DEFENDER_CONCEPTS[role].name, key: role, targetLevel: defender.project.targetLevel,
          percent: Math.floor(100 * defender.project.funded / defender.project.cost),
        }] : [])),
      };
    });
  }

  getAwaySquads(communityId, warId) {
    const war = this._warById(warId);
    if (!war || !['preparation', 'active'].includes(war.state)) return [];
    const now = this.now();
    const attacks = war.attacks.filter(attack => attack.communityId === communityId && attack.returnAt > now && (!attack.returnedAt || attack.returnedAt > now));
    const scouts = this.state.scouts.filter(scout => scout.warId === warId && scout.communityId === communityId && scout.returnAt > now && (!scout.recalledAt || scout.recalledAt > now));
    return [...attacks.map(attack => ({ id: attack.attackId, kind: 'attack', returnAt: attack.returnAt })), ...scouts.map(scout => ({ id: scout.id, kind: 'scout', returnAt: scout.returnAt }))];
  }

  getScoutReports(identityId = this.state.currentIdentityId, warId = null) {
    const profile = this.profile(identityId);
    if (!profile || !this.getAccess(identityId).allowed) return [];
    const now = this.now();
    return this.state.scouts.filter(scout => scout.communityId === profile.communityId && (!warId || scout.warId === warId)).map(scout => {
      const arrived = scout.arrivalAt <= now && (!scout.recalledAt || scout.recalledAt >= scout.arrivalAt);
      const war = this._warById(scout.warId);
      const target = war?.snapshots?.challenger?.communityId === scout.targetCommunityId ? war.snapshots.challenger : war?.snapshots?.defender;
      return { ...scout, arrived, active: !scout.recalledAt && now < scout.returnAt,
        intel: arrived && target ? { hallLevel: target.base.levels.hq, towerLevel: target.base.levels.tower,
          fortification: target.stats.fortification, worksDefence: target.stats.worksDefence } : null };
    });
  }

  getAccess(identityId = this.state.currentIdentityId) {
    const profile = this.profile(identityId);
    const entry = this.community(identityId);
    if (!profile || !entry) return { allowed: false, reason: 'Choose a preview identity.' };
    if (!profile.membership || !entry.definition.members.includes(profile.id)) return { allowed: false, reason: 'This identity is not a connected member of this community.' };
    if (!profile.verified) return { allowed: false, reason: 'Access is locked: this connected member is not verified.' };
    if (!entry.definition.eligible) return { allowed: false, reason: 'Access is locked: this community is on the Free preview tier; an eligible owner Pro plan is required.' };
    if (!entry.saved.proActive) return { allowed: false, reason: 'Access is locked: the community owner’s DZN Pro is inactive. The saved base and contributions are preserved.' };
    return { allowed: true, reason: 'Verified connected member · community owner Pro active.' };
  }

  _warActionReplay(identityId, actionId, kind) {
    if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 160) return { ok: false, error: 'A unique action ID of 1–160 characters is required.' };
    const prior = this.state.warActionRecords.find(record => record.id === actionId);
    if (!prior) return null;
    if (prior.actorId !== identityId || prior.kind !== kind) return { ok: false, error: 'This action ID was already used for a different identity or action.' };
    return { ...clone(prior.result), replay: true };
  }

  _recordWarAction(identityId, actionId, kind, result) {
    this.state.warActionRecords.push({ id: actionId, actorId: identityId, kind, result: clone(result), at: this.now() });
    if (this.state.warActionRecords.length > 2000) this.state.warActionRecords.splice(0, this.state.warActionRecords.length - 2000);
  }

  getWarReadiness(communityId, identityId = null) {
    const definition = COMMUNITIES.find(item => item.id === communityId);
    const saved = this.state.communities[communityId];
    if (!definition || !saved) return { communityId, communityName: 'Unknown community', eligible: false, unmetGates: ['This community is not available in the local war preview.'], levels: null };
    const levels = { ...saved.base.levels };
    const unmetGates = [];
    if (!['iron-pines', 'violet-ridge'].includes(communityId)) unmetGates.push('This community is not one of the two local war-preview opponents.');
    if (!definition.eligible) unmetGates.push('Community tier: Free preview is locked; war requires an eligible community owner Pro plan.');
    if (!saved.proActive) unmetGates.push('Owner entitlement: community owner Pro must be active (member Pro does not count).');
    if (levels.hq < 3) unmetGates.push(`Command Hall: Level 3 required; current Level ${levels.hq}.`);
    for (const key of SUPPORT_KEYS) {
      if (levels[key] < 2) unmetGates.push(`${GAME_CONFIG.buildings[key].name}: Level 2 required; current Level ${levels[key]}.`);
    }
    if (identityId !== null) {
      const profile = this.profile(identityId);
      if (!profile || profile.communityId !== communityId || !profile.membership || !definition.members.includes(identityId)) unmetGates.push('Membership: a connected member of this community is required.');
      else if (!profile.verified) unmetGates.push('Verification: this connected member is unverified and cannot enter a war.');
    }
    return { communityId, communityName: definition.name, eligible: unmetGates.length === 0, proActive: Boolean(saved.proActive), levels, unmetGates };
  }

  _warIdentityError(identityId, communityId, roles = null) {
    const readiness = this.getWarReadiness(communityId, identityId);
    if (readiness.unmetGates.length) return readiness.unmetGates.join(' ');
    const profile = this.profile(identityId);
    if (roles && !roles.includes(profile?.role)) return `This action is limited to ${roles.join(' or ')} preview roles.`;
    return null;
  }

  _warCommunityError(communityId) {
    const readiness = this.getWarReadiness(communityId);
    return readiness.unmetGates.length ? readiness.unmetGates.join(' ') : null;
  }

  _warSideSnapshot(communityId) {
    const definition = COMMUNITIES.find(item => item.id === communityId);
    const base = this.state.communities[communityId].base;
    const levels = { ...base.levels };
    const hall = levels.hq;
    const landPlots = base.landPlots.map(plot => ({ id: plot.id, status: plot.status, barricades: plot.status === 'claimed' ? plot.barricades : 0, facilityLevel: plot.status === 'claimed' ? plot.facilityLevel : 0 }));
    const structures = clone(base.layout.structures);
    const walls = base.layout.walls.map(wall => ({ id: wall.id, x: wall.x, z: wall.z, level: wall.level }));
    const fortification = landPlots.reduce((total, plot) => total + plot.barricades, 0) + Math.min(12, Math.floor(walls.reduce((sum, wall) => sum + wall.level, 0) / 3));
    const facility = Object.fromEntries(landPlots.map(plot => [plot.id, plot.facilityLevel]));
    const defenders = Object.fromEntries(Object.entries(base.defenders).map(([role, defender]) => [role, { level: defender.level, post: defender.post }]));
    return {
      communityId, name: definition.name, capturedAt: this.now(),
      base: { levels, treasury: safeInt(base.treasury), landPlots, defenders, layout: { structures, walls } },
      stats: { squadSize: 2 + hall * 2, wallTier: hall, firepower: levels.tower * 25, commsSignal: levels.comms * 20, workshopOutput: levels.workshop * 2, fortification,
        assaultBonus: facility['ridgewatch-range'] * 2, reconBonus: facility['signal-marsh'] * 2, worksDefence: facility['highland-works'] * 2,
        assaultKit: squadBattleStats(levels, 'assault'), reconKit: squadBattleStats(levels, 'recon') },
    };
  }

  _warRoster(communityId) {
    const definition = COMMUNITIES.find(item => item.id === communityId);
    return PREVIEW_IDENTITIES.filter(profile => profile.communityId === communityId && profile.membership && profile.verified && definition.members.includes(profile.id))
      .map(profile => ({ identityId: profile.id, name: profile.name, role: profile.role }));
  }

  _warById(warId) { return this.state.wars.find(war => war.id === warId) || null; }

  _syncWarDeadlines() {
    const now = this.now();
    let changed = false;
    for (const war of this.state.wars) {
      if (war.state === 'challenged' && war.challengeExpiresAt <= now) {
        war.state = 'expired'; war.expiredAt = now;
        war.events.push({ type: 'expired', at: now, actorId: '', text: 'Challenge expired without acceptance.', details: {} });
        changed = true;
      } else if (war.state === 'preparation' && war.prepDeadlineAt <= now) {
        war.state = 'expired'; war.expiredAt = now;
        war.events.push({ type: 'expired', at: now, actorId: '', text: 'Preparation window expired before war start.', details: {} });
        changed = true;
      }
    }
    if (changed) this.save();
  }

  getWar(warId) {
    this._syncWarDeadlines();
    const war = this._warById(warId);
    return war ? clone(war) : null;
  }

  getWarCondition(warId, defendingCommunityId) {
    const war = this._warById(warId);
    if (!war || ![war.challengerCommunityId, war.defenderCommunityId].includes(defendingCommunityId)) return null;
    const defender = defendingCommunityId === war.challengerCommunityId ? war.snapshots.challenger : war.snapshots.defender;
    return clone(warConditionAfter(defender, war.attacks.filter(attack => attack.communityId !== defendingCommunityId)));
  }

  getWars(identityId = this.state.currentIdentityId) {
    this._syncWarDeadlines();
    const profile = this.profile(identityId);
    if (!profile) return [];
    return clone(this.state.wars.filter(war => war.challengerCommunityId === profile.communityId || war.defenderCommunityId === profile.communityId)
      .sort((a, b) => b.createdAt - a.createdAt));
  }

  challengeWar(identityId, opponentCommunityId, actionId = this.newActionId('war-challenge')) {
    const replay = this._warActionReplay(identityId, actionId, 'challenge');
    if (replay) return replay;
    this._syncWarDeadlines();
    const profile = this.profile(identityId);
    if (!profile) return { ok: false, error: 'Choose a valid preview identity.' };
    const communityId = profile.communityId;
    const roleError = this._warIdentityError(identityId, communityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    if (communityId === opponentCommunityId) return { ok: false, error: 'A community cannot challenge itself.' };
    if (!['iron-pines', 'violet-ridge'].includes(communityId) || !['iron-pines', 'violet-ridge'].includes(opponentCommunityId)) return { ok: false, error: 'War preview challenges are limited to Iron Pines and Violet Ridge; Free communities stay locked.' };
    const opponentError = this._warCommunityError(opponentCommunityId);
    if (opponentError) return { ok: false, error: `Opponent is not war-ready. ${opponentError}` };
    const active = this.state.wars.find(war => ['challenged', 'preparation', 'active'].includes(war.state));
    if (active) return { ok: false, error: `War ${active.id} is already ${active.state}; duplicate active wars are locked.` };
    const now = this.now();
    const warId = `war-${this.state.nextWarNumber++}-${now.toString(36)}`;
    const war = {
      id: warId, challengerCommunityId: communityId, defenderCommunityId: opponentCommunityId,
      challengerIdentityId: identityId, state: 'challenged', createdAt: now,
      challengeExpiresAt: now + WAR_RULES.challengeLifetimeMs, acceptedBy: '', acceptedAt: 0,
      prepReadyAt: 0, prepDeadlineAt: 0, startedBy: '', startedAt: 0, attackEndsAt: 0,
      resolvedAt: 0, declinedAt: 0, expiredAt: 0,
      snapshots: { challenger: this._warSideSnapshot(communityId), defender: this._warSideSnapshot(opponentCommunityId) },
      roster: { [communityId]: this._warRoster(communityId), [opponentCommunityId]: this._warRoster(opponentCommunityId) },
      attacks: [], attackIds: [], score: { [communityId]: 0, [opponentCommunityId]: 0 }, stages: [],
      defenceOrders: { [communityId]: { order: 'balanced', assignedBy: '', assignedAt: 0 }, [opponentCommunityId]: { order: 'balanced', assignedBy: '', assignedAt: 0 } },
      winnerCommunityId: null, tie: false, rewardLedgerIds: [], events: [], replay: null,
    };
    war.events.push({ type: 'challenge', at: now, actorId: identityId, text: `${this.community(identityId).definition.name} challenged ${COMMUNITIES.find(item => item.id === opponentCommunityId).name}.`, details: { challengeExpiresAt: war.challengeExpiresAt } });
    this.state.wars.push(war);
    const result = { ok: true, warId, state: war.state };
    this._recordWarAction(identityId, actionId, 'challenge', result);
    this.save();
    return result;
  }

  acceptWarChallenge(identityId, warId, actionId = this.newActionId('war-accept')) {
    const replay = this._warActionReplay(identityId, actionId, 'accept');
    if (replay) return replay;
    this._syncWarDeadlines();
    const war = this._warById(warId);
    const profile = this.profile(identityId);
    if (!war || !profile) return { ok: false, error: 'War challenge or preview identity not found.' };
    if (profile.communityId !== war.defenderCommunityId) return { ok: false, error: 'Only the challenged opposing community can accept this war.' };
    const roleError = this._warIdentityError(identityId, war.defenderCommunityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    if (war.state !== 'challenged') return { ok: false, error: `This challenge is ${war.state}; it can no longer be accepted.` };
    const challengerError = this._warCommunityError(war.challengerCommunityId);
    if (challengerError) return { ok: false, error: `Challenger is no longer eligible. ${challengerError}` };
    const now = this.now();
    war.state = 'preparation'; war.acceptedBy = identityId; war.acceptedAt = now;
    war.prepReadyAt = now + WAR_RULES.preparationReadyMs;
    war.prepDeadlineAt = now + WAR_RULES.preparationWindowMs;
    war.events.push({ type: 'accepted', at: now, actorId: identityId, text: `${profile.name} accepted. Preparation is open; launch becomes available in 30 seconds.`, details: { prepReadyAt: war.prepReadyAt, prepDeadlineAt: war.prepDeadlineAt } });
    const result = { ok: true, warId, state: war.state, prepReadyAt: war.prepReadyAt, prepDeadlineAt: war.prepDeadlineAt };
    this._recordWarAction(identityId, actionId, 'accept', result);
    this.save();
    return result;
  }

  setWarDefenceOrder(identityId, warId, order, actionId = this.newActionId('war-defence-order')) {
    const replay = this._warActionReplay(identityId, actionId, 'defence-order');
    if (replay) return replay;
    this._syncWarDeadlines();
    const war = this._warById(warId);
    const profile = this.profile(identityId);
    if (!war || !profile || ![war.challengerCommunityId, war.defenderCommunityId].includes(profile.communityId))
      return { ok: false, error: 'This preview identity is not a participant in the war.' };
    const roleError = this._warIdentityError(identityId, profile.communityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    if (war.state !== 'preparation' || this.now() >= war.prepDeadlineAt)
      return { ok: false, error: 'Defence orders can only be set during preparation, before the war starts.' };
    if (!Object.hasOwn(WAR_DEFENCE_ORDERS, order)) return { ok: false, error: 'Choose a valid defence order.' };
    const at = this.now();
    war.defenceOrders[profile.communityId] = { order, assignedBy: identityId, assignedAt: at };
    war.events.push({ type: 'defence-order', at, actorId: identityId, text: `${profile.name} prepared a sealed home-defence order.`, details: { communityId: profile.communityId } });
    const result = { ok: true, warId, communityId: profile.communityId, order, name: WAR_DEFENCE_ORDERS[order].name, assignedAt: at };
    this._recordWarAction(identityId, actionId, 'defence-order', result);
    this.save();
    return result;
  }

  declineWarChallenge(identityId, warId, actionId = this.newActionId('war-decline')) {
    const replay = this._warActionReplay(identityId, actionId, 'decline');
    if (replay) return replay;
    const war = this._warById(warId);
    const profile = this.profile(identityId);
    if (!war || !profile) return { ok: false, error: 'War challenge or preview identity not found.' };
    if (profile.communityId !== war.defenderCommunityId) return { ok: false, error: 'Only the challenged community can decline this war.' };
    const roleError = this._warIdentityError(identityId, war.defenderCommunityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    if (war.state !== 'challenged') return { ok: false, error: `This challenge is ${war.state}; it can no longer be declined.` };
    war.state = 'declined'; war.declinedAt = this.now();
    war.events.push({ type: 'declined', at: war.declinedAt, actorId: identityId, text: `${profile.name} declined the challenge.`, details: {} });
    const result = { ok: true, warId, state: war.state };
    this._recordWarAction(identityId, actionId, 'decline', result);
    this.save();
    return result;
  }

  startWar(identityId, warId, actionId = this.newActionId('war-start')) {
    const replay = this._warActionReplay(identityId, actionId, 'start');
    if (replay) return replay;
    this._syncWarDeadlines();
    const war = this._warById(warId);
    const profile = this.profile(identityId);
    if (!war || !profile) return { ok: false, error: 'War or preview identity not found.' };
    if (![war.challengerCommunityId, war.defenderCommunityId].includes(profile.communityId)) return { ok: false, error: 'Only a participating community may start this war.' };
    const roleError = this._warIdentityError(identityId, profile.communityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    if (war.state !== 'preparation') return { ok: false, error: `War cannot start while it is ${war.state}.` };
    const otherError = this._warCommunityError(profile.communityId === war.challengerCommunityId ? war.defenderCommunityId : war.challengerCommunityId);
    if (otherError) return { ok: false, error: `Both communities must remain eligible. ${otherError}` };
    const now = this.now();
    if (now < war.prepReadyAt) return { ok: false, error: `Preparation is still underway for ${Math.ceil((war.prepReadyAt - now) / 1000)} seconds.` };
    if (now > war.prepDeadlineAt) return { ok: false, error: 'The preparation window has ended.' };
    war.state = 'active'; war.startedBy = identityId; war.startedAt = now; war.attackEndsAt = now + WAR_RULES.attackWindowMs;
    const stageLength = WAR_RULES.attackWindowMs / WAR_STAGE_DEFS.length;
    war.stages = WAR_STAGE_DEFS.map((stage, index) => ({ id: stage.id, opensAt: now + stageLength * index,
      closesAt: now + stageLength * (index + 1), completedBy: { [war.challengerCommunityId]: null, [war.defenderCommunityId]: null } }));
    war.events.push({ type: 'started', at: now, actorId: identityId, text: 'War started. Each side may deploy up to two verified roster members before the attack window closes.', details: { attackEndsAt: war.attackEndsAt, attackCap: WAR_RULES.maxAttacksPerSide } });
    const result = { ok: true, warId, state: war.state, attackEndsAt: war.attackEndsAt };
    this._recordWarAction(identityId, actionId, 'start', result);
    this.save();
    return result;
  }

  completeWarStage(identityId, warId, stageId, actionId = this.newActionId('war-stage')) {
    const replay = this._warActionReplay(identityId, actionId, `stage:${warId}:${stageId}`);
    if (replay) return replay;
    const war = this._warById(warId);
    const profile = this.profile(identityId);
    const definition = WAR_STAGE_DEFS.find(item => item.id === stageId);
    if (!war || !profile || !definition) return { ok: false, error: 'Choose a valid active war stage.' };
    const communityId = profile.communityId;
    if (![war.challengerCommunityId, war.defenderCommunityId].includes(communityId)) return { ok: false, error: 'Only a participating server can complete this stage.' };
    const accessError = this._warIdentityError(identityId, communityId);
    if (accessError) return { ok: false, error: accessError };
    if (!war.roster[communityId]?.some(member => member.identityId === identityId)) return { ok: false, error: 'Only a verified member on the accepted-war roster can take part.' };
    if (war.state !== 'active') return { ok: false, error: 'Stages run only during an active war.' };
    const stage = war.stages?.find(item => item.id === stageId);
    const now = this.now();
    if (!stage || now < stage.opensAt || now >= stage.closesAt) return { ok: false, error: 'This timed stage is not open.' };
    if (stage.completedBy[communityId]) return { ok: false, error: 'Your server has already completed this stage.' };
    const member = this.member(identityId);
    if (member.parts < definition.parts || member.timber < definition.timber) return { ok: false, error: `Need ${definition.parts} Parts and ${definition.timber} Timber for ${definition.name}.` };
    const side = war.snapshots.challenger.communityId === communityId ? war.snapshots.challenger : war.snapshots.defender;
    const opponentId = communityId === war.challengerCommunityId ? war.defenderCommunityId : war.challengerCommunityId;
    const firstBonus = stage.completedBy[opponentId] ? 0 : 2;
    const points = 6 + Math.min(5, side.base.levels[definition.key]) + firstBonus;
    member.parts -= definition.parts; member.timber -= definition.timber;
    stage.completedBy[communityId] = { identityId, at: now, points };
    war.score[communityId] += points;
    war.events.push({ type: 'stage', at: now, actorId: identityId, text: `${profile.name} completed ${definition.name} at ${definition.building} · +${points} local war points.`, details: { stageId, communityId, points, firstBonus } });
    const result = { ok: true, warId, stageId, points, firstBonus, totalScore: war.score[communityId] };
    this._recordWarAction(identityId, actionId, `stage:${warId}:${stageId}`, result);
    this.save();
    return result;
  }

  dispatchScout(identityId, warId, actionId = this.newActionId('scout-dispatch')) {
    const replay = this._warActionReplay(identityId, actionId, 'scout-dispatch');
    if (replay) return replay;
    const war = this._warById(warId);
    const profile = this.profile(identityId);
    if (!war || !profile || ![war.challengerCommunityId, war.defenderCommunityId].includes(profile.communityId)) return { ok: false, error: 'Choose a war involving your connected community.' };
    const accessError = this._warIdentityError(identityId, profile.communityId);
    if (accessError) return { ok: false, error: accessError };
    if (!war.roster[profile.communityId]?.some(member => member.identityId === identityId)) return { ok: false, error: 'This member was not on the verified pre-war roster.' };
    if (!['preparation', 'active'].includes(war.state)) return { ok: false, error: 'Scouts can deploy during preparation or an active war.' };
    const now = this.now();
    if (war.state === 'preparation' && now > war.prepDeadlineAt || war.state === 'active' && now > war.attackEndsAt) return { ok: false, error: 'The mission window has closed.' };
    if (this.state.scouts.filter(scout => scout.warId === warId && scout.communityId === profile.communityId).length >= WAR_RULES.maxScoutsPerSide) return { ok: false, error: 'This community has deployed its two scouts.' };
    if (this.state.scouts.some(scout => scout.warId === warId && scout.identityId === identityId)) return { ok: false, error: 'This member has already scouted in this war.' };
    if (this.getAwaySquads(profile.communityId, warId).some(squad => war.attacks.some(attack => attack.attackId === squad.id && attack.identityId === identityId))) return { ok: false, error: 'Your war squad is away. Wait for its return before scouting.' };
    const targetCommunityId = profile.communityId === war.challengerCommunityId ? war.defenderCommunityId : war.challengerCommunityId;
    const scout = { id: `scout-${this.state.nextScoutNumber++}`, warId, identityId, communityId: profile.communityId, targetCommunityId,
      at: now, arrivalAt: now + WAR_RULES.scoutArrivalMs, returnAt: now + WAR_RULES.squadReturnMs, recalledAt: 0 };
    this.state.scouts.push(scout);
    if (this.state.scouts.length > 100) this.state.scouts.splice(0, this.state.scouts.length - 100);
    war.events.push({ type: 'scout', at: now, actorId: identityId, text: `${profile.name} dispatched a scout. Home defence is exposed until recall or return.`, details: { scoutId: scout.id, returnAt: scout.returnAt } });
    const result = { ok: true, scoutId: scout.id, arrivalAt: scout.arrivalAt, returnAt: scout.returnAt, targetCommunityId };
    this._recordWarAction(identityId, actionId, 'scout-dispatch', result);
    this.save();
    return result;
  }

  recallScout(identityId, scoutId, actionId = this.newActionId('scout-recall')) {
    const replay = this._warActionReplay(identityId, actionId, 'scout-recall');
    if (replay) return replay;
    const scout = this.state.scouts.find(item => item.id === scoutId);
    const profile = this.profile(identityId);
    if (!scout || !profile || scout.identityId !== identityId) return { ok: false, error: 'Only the scout owner can recall this mission.' };
    const accessError = this._warIdentityError(identityId, scout.communityId);
    if (accessError) return { ok: false, error: accessError };
    const war = this._warById(scout.warId);
    const now = this.now();
    if (!war || !['preparation', 'active'].includes(war.state) || scout.recalledAt || now >= scout.returnAt) return { ok: false, error: 'This scout has already returned or the war has closed.' };
    scout.recalledAt = now;
    war.events.push({ type: 'scout-recall', at: now, actorId: identityId, text: `${profile.name} recalled their scout to reinforce home defence.`, details: { scoutId } });
    const result = { ok: true, scoutId, arrived: now >= scout.arrivalAt, recalledAt: now };
    this._recordWarAction(identityId, actionId, 'scout-recall', result);
    this.save();
    return result;
  }

  submitWarAttack(identityId, warId, tactic, actionId = this.newActionId('war-attack'), plan = null) {
    const replay = this._warActionReplay(identityId, actionId, 'attack');
    if (replay) return replay;
    const war = this._warById(warId);
    const profile = this.profile(identityId);
    if (!war || !profile) return { ok: false, error: 'Active war or preview identity not found.' };
    if (!['assault', 'recon'].includes(tactic)) return { ok: false, error: 'Choose Assault or Recon.' };
    if (![war.challengerCommunityId, war.defenderCommunityId].includes(profile.communityId)) return { ok: false, error: 'Only a participating community may deploy.' };
    const accessError = this._warIdentityError(identityId, profile.communityId);
    if (accessError) return { ok: false, error: accessError };
    if (!war.roster[profile.communityId]?.some(member => member.identityId === identityId)) return { ok: false, error: 'This identity is not on the verified pre-war roster.' };
    if (war.state !== 'active') return { ok: false, error: `Attacks are unavailable while this war is ${war.state}.` };
    const now = this.now();
    if (now > war.attackEndsAt) return { ok: false, error: 'The attack window has closed; leadership can resolve the war.' };
    const sideAttacks = war.attacks.filter(attack => attack.communityId === profile.communityId);
    if (sideAttacks.length >= WAR_RULES.maxAttacksPerSide) return { ok: false, error: `Attack cap reached (${WAR_RULES.maxAttacksPerSide} per community).` };
    if (war.attacks.some(attack => attack.identityId === identityId)) return { ok: false, error: 'Each roster member may deploy once per war.' };
    if (this.getScoutReports(identityId, warId).some(scout => scout.identityId === identityId && scout.active)) return { ok: false, error: 'Your scout squad is still away. Recall it or wait for its return before attacking.' };
    const attacker = profile.communityId === war.challengerCommunityId ? war.snapshots.challenger : war.snapshots.defender;
    const defender = profile.communityId === war.challengerCommunityId ? war.snapshots.defender : war.snapshots.challenger;
    const conditionAtLaunch = this.getWarCondition(warId, defender.communityId);
    const tactics = plan === null ? null : evaluateWarPlan(defender, tactic, plan, conditionAtLaunch);
    if (tactics && !tactics.ok) return { ok: false, error: tactics.error };
    const squad = plan?.squad == null ? null : evaluateWarSquad(attacker.base.levels, tactic, plan.squad, attacker.stats.squadSize, tactics);
    if (squad && !squad.ok) return { ok: false, error: squad.error };
    // Current tactical deployments use the member's trained personal reserve.
    // Historical plan-less attacks retain their saved legacy rules.
    if (squad) {
      const reserve = this.getTrainingReadiness(identityId)?.reserve;
      const missing = TRAINING_ROLES.filter(role => squad.counts[role] > (reserve?.[role] || 0));
      if (missing.length) return { ok: false, error: `Train ${missing.map(role => SQUAD_ROLES[role].name).join(', ')} before deploying this war squad.` };
    }
    const a = attacker.base.levels; const d = defender.base.levels;
    const kit = squad ? squadBattleStats(a, tactic, squad.counts) : tactic === 'assault' ? attacker.stats.assaultKit : attacker.stats.reconKit;
    const rawScore = tactic === 'assault'
      ? 20 + a.hq * 12 + a.tower * 16 + a.comms * 4 - d.hq * 4 - d.tower * 10 - defender.stats.fortification * 3 + attacker.stats.assaultBonus - defender.stats.worksDefence
      : 15 + a.hq * 7 + a.tower * 3 + a.comms * 18 + a.workshop * 3 - d.comms * 10 - d.tower * 4 - defender.stats.fortification + attacker.stats.reconBonus - defender.stats.worksDefence;
    const awaySquads = this.getAwaySquads(defender.communityId, warId).length;
    const defence = defenderBattleEffect(defender.base.defenders, tactic);
    const defenceOrder = evaluateWarDefenceOrder(war.defenceOrders?.[defender.communityId]?.order || 'balanced', tactic, tactics?.plan, awaySquads);
    const exposureBonus = Math.max(0, Math.min(12, awaySquads * 6 - Math.floor(defender.stats.fortification / 2) - defence.exposureShield - defenceOrder.exposureShield));
    const scoutBonus = this.getScoutReports(identityId, warId).some(scout => scout.warId === warId && scout.arrived) ? 4 : 0;
    const score = Math.max(0, Math.min(100, Math.round(rawScore + kit.scoreBonus + exposureBonus + scoutBonus - defence.scorePenalty - defenceOrder.scorePenalty + (tactics?.scoreDelta || 0) + (squad?.scoreDelta || 0))));
    const casualties = Math.max(0, Math.min(attacker.stats.squadSize, Math.round(d.hq + d.tower - Math.floor(a.comms / 2) + (tactic === 'assault' ? 1 : 0) - kit.casualtyShield + defence.casualtyPressure + defenceOrder.casualtyPressure + (tactics?.casualtyDelta || 0) + (squad?.casualtyDelta || 0))));
    const attackId = `attack-${war.id}-${war.attacks.length + 1}`;
    if (war.attackIds.includes(attackId)) return { ok: false, error: 'Duplicate attack ID rejected.' };
    const feedback = `${defender.name} counterfire from Hall L${d.hq}, Arc Battery L${d.tower}, ${defender.stats.fortification} barricades, Defence Works -${defender.stats.worksDefence} and assigned defenders -${defence.scorePenalty}; ${tactic === 'assault' ? 'the direct push' : 'the signal sweep'} used ${kit.ability}, +${kit.scoreBonus} upgraded kit, +${tactic === 'assault' ? attacker.stats.assaultBonus : attacker.stats.reconBonus} district support, +${scoutBonus} scout intel and +${exposureBonus} exposed-defence advantage${defenceOrder.active ? `; ${defenceOrder.name} cut ${defenceOrder.scorePenalty} planning points and shielded ${defenceOrder.exposureShield} exposure` : ''}${tactics ? `; ${tactics.laneName} ${tactics.methodName.toLowerCase()} toward ${tactics.objectiveName}, ${tactics.wallCount} walls in corridor, ${tactics.scoreDelta >= 0 ? '+' : ''}${tactics.scoreDelta} tactical planning points` : ''}${squad ? `; selected ${Object.entries(squad.counts).filter(([, count]) => count).map(([role, count]) => `${count} ${SQUAD_ROLES[role].name}`).join(', ')}, ${squad.scoreDelta >= 0 ? '+' : ''}${squad.scoreDelta} composition planning points${squad.specialties.length ? ` (${squad.specialties.join(', ')})` : ''}` : ''}.`;
    const returnAt = now + WAR_RULES.squadReturnMs;
    const attack = { attackId, actionId, identityId, communityId: profile.communityId, tactic, at: now, returnAt, returnedAt: 0, recallPenalty: 0, exposureBonus, scoutBonus, defenderPenalty: defence.scorePenalty,
      defenceOrder: defenceOrder.order, defenceOrderActive: defenceOrder.active, defenceOrderPenalty: defenceOrder.scorePenalty, defenceExposureShield: defenceOrder.exposureShield,
      combatVersion: tactics?.ok ? 2 : 1, combatBaseScore: score,
      baseScore: score, baseCasualties: casualties, score, casualties, feedback, tactics, squad, orders: [], conditionAtLaunch };
    attack.damage = attack.combatVersion === 2 ? simulateWarCombat(attacker, defender, attack) : buildWarDamageReport(attacker, defender, attack);
    if (!attack.damage.ok) return attack.damage;
    if (attack.combatVersion === 2) {
      attack.score = attack.baseScore = attack.damage.score;
      attack.casualties = attack.baseCasualties = attack.damage.casualties;
      attack.feedback += ` The locked battle dealt ${attack.damage.objective.maxHealth - attack.damage.objective.remainingHealth}/${attack.damage.objective.maxHealth} objective damage, broke ${attack.damage.walls.filter(wall => !wall.remainingHealth).length}/${attack.damage.walls.length} route walls and withdrew ${attack.casualties}/${attacker.stats.squadSize} troops, scoring ${attack.score}.`;
    }
    if (squad) {
      const member = this.member(identityId);
      for (const role of TRAINING_ROLES) member.trainingReserve[role] -= squad.counts[role];
      member.warDeployments.push({ warId, attackId, returnAt, counts: clone(squad.counts) });
    }
    war.attacks.push(attack); war.attackIds.push(attackId); war.score[profile.communityId] += attack.score;
    war.events.push({ type: 'attack', at: now, actorId: identityId, text: `${profile.name} deployed ${tactic === 'assault' ? 'Assault' : 'Recon'} · ${attack.score} points · ${attack.casualties} squad losses.`, details: clone(attack) });
    const result = { ok: true, warId, attackId, tactic, score: attack.score, casualties: attack.casualties, feedback: attack.feedback, tactics, squad, damage: attack.damage, returnAt, exposureBonus, scoutBonus, defenderPenalty: defence.scorePenalty,
      defenceOrder: defenceOrder.order, defenceOrderActive: defenceOrder.active, defenceOrderPenalty: defenceOrder.scorePenalty, defenceExposureShield: defenceOrder.exposureShield,
      totalScore: war.score[profile.communityId], attacksRemaining: WAR_RULES.maxAttacksPerSide - sideAttacks.length - 1 };
    this._recordWarAction(identityId, actionId, 'attack', result);
    this.save();
    return result;
  }

  issueWarFieldOrder(identityId, warId, attackId, phase, command, actionId = this.newActionId('war-field-order')) {
    const replay = this._warActionReplay(identityId, actionId, 'war-field-order');
    if (replay) return replay;
    const war = this._warById(warId);
    const attack = war?.attacks.find(item => item.attackId === attackId);
    const profile = this.profile(identityId);
    if (!attack || !profile || attack.identityId !== identityId) return { ok: false, error: 'Only this deployed squad’s commander can issue its field orders.' };
    const accessError = this._warIdentityError(identityId, attack.communityId);
    if (accessError) return { ok: false, error: accessError };
    if (war.state !== 'active' || this.now() > war.attackEndsAt || this.now() > attack.at + 60_000 || attack.returnedAt)
      return { ok: false, error: 'This battle’s field-order window has closed.' };
    const effect = evaluateWarFieldOrder(attack.tactic, phase, command);
    if (!effect.ok) return effect;
    if (attack.orders?.some(order => order.phase === phase)) return { ok: false, error: 'One order has already been issued for this phase.' };
    if (phase === 'withdrawal' && !attack.orders?.some(order => order.phase === 'contact'))
      return { ok: false, error: 'Issue the contact order before directing withdrawal.' };
    const attacker = attack.communityId === war.challengerCommunityId ? war.snapshots.challenger : war.snapshots.defender;
    const previousScore = attack.score;
    const previousCasualties = attack.casualties;
    const defender = attack.communityId === war.challengerCommunityId ? war.snapshots.defender : war.snapshots.challenger;
    const order = { ...effect, at: this.now() };
    attack.orders.push(order);
    if (attack.combatVersion === 2) {
      attack.damage = simulateWarCombat(attacker, defender, attack);
      if (!attack.damage.ok) { attack.orders.pop(); return attack.damage; }
      attack.score = attack.damage.score;
      attack.casualties = attack.damage.casualties;
    } else {
      attack.score = Math.max(0, Math.min(100, attack.score + effect.scoreDelta));
      attack.casualties = Math.max(0, Math.min(attacker.stats.squadSize, attack.casualties + effect.casualtyDelta));
      attack.damage = buildWarDamageReport(attacker, defender, attack);
    }
    war.score[attack.communityId] += attack.score - previousScore;
    attack.feedback += ` ${order.name} during ${phase}: ${attack.score - previousScore >= 0 ? '+' : ''}${attack.score - previousScore} points, ${attack.casualties - previousCasualties >= 0 ? '+' : ''}${attack.casualties - previousCasualties} squad losses.`;
    const attackEvent = war.events.find(event => event.type === 'attack' && event.details?.attackId === attackId);
    if (attackEvent) {
      attackEvent.details = clone(attack);
      attackEvent.text = `${profile.name} deployed ${attack.tactic === 'assault' ? 'Assault' : 'Recon'} · ${attack.score} points · ${attack.casualties} squad losses after field orders.`;
    }
    war.events.push({ type: 'field-order', at: order.at, actorId: identityId, text: `${profile.name}: ${order.name} · ${attack.score} attack points, ${attack.casualties} squad losses.`, details: { attackId, phase, command, score: attack.score, casualties: attack.casualties } });
    const result = { ok: true, warId, attackId, order, score: attack.score, casualties: attack.casualties, damage: attack.damage,
      totalScore: war.score[attack.communityId], feedback: attack.feedback };
    this._recordWarAction(identityId, actionId, 'war-field-order', result);
    this.save();
    return result;
  }

  recallWarSquad(identityId, warId, attackId, actionId = this.newActionId('war-recall')) {
    const replay = this._warActionReplay(identityId, actionId, 'war-recall');
    if (replay) return replay;
    const war = this._warById(warId);
    const attack = war?.attacks.find(item => item.attackId === attackId);
    const profile = this.profile(identityId);
    if (!attack || !profile || attack.identityId !== identityId) return { ok: false, error: 'Only the deployed squad owner can recall this attack.' };
    const accessError = this._warIdentityError(identityId, attack.communityId);
    if (accessError) return { ok: false, error: accessError };
    const now = this.now();
    if (war.state !== 'active' || attack.returnedAt || !attack.returnAt || now >= attack.returnAt) return { ok: false, error: 'This squad has returned or the war is closed.' };
    const penalty = Math.ceil(attack.score / 4);
    attack.returnedAt = now;
    attack.recallPenalty = penalty;
    attack.score -= penalty;
    war.score[attack.communityId] -= penalty;
    war.events.push({ type: 'squad-recall', at: now, actorId: identityId, text: `${profile.name} recalled a war squad to defend home · -${penalty} attack points.`, details: { attackId, penalty } });
    const result = { ok: true, warId, attackId, returnedAt: now, penalty, score: attack.score, totalScore: war.score[attack.communityId] };
    this._recordWarAction(identityId, actionId, 'war-recall', result);
    this.save();
    return result;
  }

  resolveWar(identityId, warId, actionId = this.newActionId('war-resolve')) {
    const replay = this._warActionReplay(identityId, actionId, 'resolve');
    if (replay) return replay;
    const war = this._warById(warId);
    const profile = this.profile(identityId);
    if (!war || !profile) return { ok: false, error: 'War or preview identity not found.' };
    if (![war.challengerCommunityId, war.defenderCommunityId].includes(profile.communityId)) return { ok: false, error: 'Only a participating community may resolve this war.' };
    const roleError = this._warIdentityError(identityId, profile.communityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    if (war.state !== 'active') return { ok: false, error: `War has already ended or cannot resolve from state ${war.state}.` };
    const challengerCount = war.attacks.filter(attack => attack.communityId === war.challengerCommunityId).length;
    const defenderCount = war.attacks.filter(attack => attack.communityId === war.defenderCommunityId).length;
    if (war.stages?.length && this.now() < war.attackEndsAt) return { ok: false, error: 'The three timed build challenges must finish before this war can resolve.' };
    if (this.now() < war.attackEndsAt && (challengerCount < WAR_RULES.maxAttacksPerSide || defenderCount < WAR_RULES.maxAttacksPerSide)) return { ok: false, error: 'Resolve when both attack caps are reached or after the attack window ends.' };
    const now = this.now();
    const challengerScore = war.score[war.challengerCommunityId];
    const defenderScore = war.score[war.defenderCommunityId];
    war.tie = challengerScore === defenderScore;
    war.winnerCommunityId = war.tie ? null : challengerScore > defenderScore ? war.challengerCommunityId : war.defenderCommunityId;
    war.state = 'resolved'; war.resolvedAt = now;
    const wear = [];
    for (const communityId of [war.challengerCommunityId, war.defenderCommunityId]) {
      const base = this.state.communities[communityId].base;
      for (const attack of war.attacks.filter(item => item.communityId !== communityId)) {
        const preference = attack.tactic === 'recon'
          ? ['signal-marsh', 'timberline-depot', 'ridgewatch-range', 'highland-works']
          : ['ridgewatch-range', 'highland-works', 'timberline-depot', 'signal-marsh'];
        const plot = preference.map(id => base.landPlots.find(item => item.id === id))
          .find(item => item?.status === 'claimed' && item.facilityLevel > 0 && item.wear < BATTLE_WEAR_RULES.maxSeverity);
        if (!plot) continue;
        plot.wear++;
        if (!base.repairPriority) base.repairPriority = plot.id;
        wear.push({ communityId, plotId: plot.id, severity: plot.wear, attackId: attack.attackId });
      }
    }
    const winnerSide = war.winnerCommunityId === war.challengerCommunityId ? war.snapshots.challenger : war.snapshots.defender;
    const loserSide = war.winnerCommunityId === war.challengerCommunityId ? war.snapshots.defender : war.snapshots.challenger;
    const winnerRegion = COMMUNITIES.find(item => item.id === war.winnerCommunityId);
    const loserRegion = COMMUNITIES.find(item => item.id === loserSide.communityId);
    const victoryMultiplier = war.tie ? 1 : routeBriefing(
      { map: winnerRegion.map, hallLevel: winnerSide.base.levels.hq },
      { map: loserRegion.map, hallLevel: loserSide.base.levels.hq, defenders: loserSide.base.defenders },
    ).rewardMultiplier;
    const rewards = [];
    for (const identity of [...new Set(war.attacks.map(attack => attack.identityId))]) {
      const ledgerId = `war-reward:${war.id}:${identity}`;
      if (this.state.warRewardLedger.some(entry => entry.id === ledgerId)) continue;
      const member = this.member(identity);
      if (!member) continue;
      const attacker = war.attacks.find(attack => attack.identityId === identity);
      const amount = attacker.communityId === war.winnerCommunityId ? Math.round(WAR_RULES.localRewardParts * victoryMultiplier) : WAR_RULES.localRewardParts;
      member.parts += amount;
      this.state.warRewardLedger.push({ id: ledgerId, warId: war.id, identityId: identity, amount, at: now });
      war.rewardLedgerIds.push(ledgerId);
      rewards.push({ identityId: identity, amount, ledgerId });
    }
    war.replay = { version: 2, attackIds: [...war.attackIds], attacks: clone(war.attacks), stages: clone(war.stages || []), score: clone(war.score), winnerCommunityId: war.winnerCommunityId, tie: war.tie };
    const resultText = war.tie ? 'War resolved as a tie.' : `${COMMUNITIES.find(item => item.id === war.winnerCommunityId).name} won ${Math.max(challengerScore, defenderScore)}–${Math.min(challengerScore, defenderScore)}.`;
    war.events.push({ type: 'resolved', at: now, actorId: identityId, text: resultText, details: { score: clone(war.score), winnerCommunityId: war.winnerCommunityId, tie: war.tie, rewards: clone(rewards), wear: clone(wear) } });
    for (const communityId of [war.challengerCommunityId, war.defenderCommunityId]) {
      const opponentId = communityId === war.challengerCommunityId ? war.defenderCommunityId : war.challengerCommunityId;
      const opponent = COMMUNITIES.find(item => item.id === opponentId)?.name || 'opponent';
      const outcome = war.tie ? 'draw' : war.winnerCommunityId === communityId ? 'victory' : 'defeat';
      this._recordChronicle(this.state.communities[communityId].base, `war:${war.id}`, 'war', `War against ${opponent}: ${outcome}. ${war.score[communityId]}–${war.score[opponentId]}.`, now);
    }
    const result = { ok: true, warId, state: war.state, winnerCommunityId: war.winnerCommunityId, tie: war.tie, score: clone(war.score), rewards, wear };
    this._recordWarAction(identityId, actionId, 'resolve', result);
    this.save();
    return result;
  }

  selectIdentity(identityId) {
    if (!this.profile(identityId)) return { ok: false, error: 'Unknown preview identity.' };
    this.processConstructionJobs(identityId);
    this.advancePartsProduction(identityId);
    this.advanceTimberProduction(identityId);
    this.state.currentIdentityId = identityId;
    this.save();
    return { ok: true };
  }

  setOwnerProActive(identityId, active) {
    const profile = this.profile(identityId);
    const entry = this.community(identityId);
    if (!profile || !entry) return { ok: false, error: 'Unknown preview identity.' };
    if (profile.role !== 'owner') return { ok: false, error: 'Only this community’s owner can change its simulated Pro status.' };
    if (!entry.definition.eligible) return { ok: false, error: 'The Free preview community is not eligible for this Pro toggle.' };
    for (const member of PREVIEW_IDENTITIES.filter(item => item.communityId === profile.communityId)) {
      this.advancePartsProduction(member.id);
      this.advanceTimberProduction(member.id);
    }
    entry.saved.proActive = Boolean(active);
    this.save();
    return { ok: true, proActive: entry.saved.proActive };
  }

  snapshot(identityId = this.state.currentIdentityId) {
    const profile = this.profile(identityId);
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!profile || !entry || !member) return null;
    return clone({ profile, community: { id: entry.definition.id, name: entry.definition.name, eligible: entry.definition.eligible, proActive: entry.saved.proActive }, access: this.getAccess(identityId), base: entry.saved.base, member });
  }

  _recordChronicle(base, id, kind, text, at = this.now()) {
    if (!base.chronicle) base.chronicle = [];
    if (base.chronicle.some(item => item.id === id)) return;
    base.chronicle.push({ id, kind, text, at });
    if (base.chronicle.length > 120) base.chronicle.splice(0, base.chronicle.length - 120);
  }

  getChronicle(identityId = this.state.currentIdentityId) {
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError, entries: [] };
    const entry = this.community(identityId);
    const base = entry.saved.base;
    const events = [...(base.chronicle || [])];
    const addEarlier = (id, kind, text, at = 0) => {
      if (!events.some(item => item.id === id)) events.push({ id, kind, text, at });
    };
    for (const project of base.projects.filter(item => item.status === 'completed')) {
      addEarlier(`project:${project.id}`, 'project', `${GAME_CONFIG.buildings[project.key].name} reached Level ${project.targetLevel}.`, project.completedAt);
    }
    for (const plot of base.landPlots.slice(1)) {
      const config = GAME_CONFIG.landPlots.find(item => item.id === plot.id);
      if (plot.status === 'claimed') addEarlier(`land:${plot.id}`, 'land', `${config.name} claimed for the community.`);
      if (plot.facilityLevel) addEarlier(`facility:${plot.id}:${plot.facilityLevel}`, 'facility', `${GAME_CONFIG.facilities[plot.id].name} reached Level ${plot.facilityLevel}.`);
      if (plot.routeLevel) addEarlier(`route:${plot.id}:${plot.routeLevel}`, 'route', `${config.name} supply route reached Level ${plot.routeLevel}.`);
    }
    for (const [role, defender] of Object.entries(base.defenders)) {
      for (let level = 1; level <= defender.level; level++) addEarlier(`defender:${role}:${level}`, 'defender', `${DEFENDER_CONCEPTS[role].name} reached Level ${level}.`);
    }
    for (const war of this.state.wars.filter(item => item.state === 'resolved' && [item.challengerCommunityId, item.defenderCommunityId].includes(entry.definition.id))) {
      const opponentId = war.challengerCommunityId === entry.definition.id ? war.defenderCommunityId : war.challengerCommunityId;
      const opponent = COMMUNITIES.find(item => item.id === opponentId)?.name || 'opponent';
      const outcome = war.tie ? 'draw' : war.winnerCommunityId === entry.definition.id ? 'victory' : 'defeat';
      addEarlier(`war:${war.id}`, 'war', `War against ${opponent}: ${outcome}. ${war.score[entry.definition.id]}–${war.score[opponentId]}.`, war.resolvedAt);
    }
    events.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    return { ok: true, beaconLevel: base.levels.hq, entries: clone(events.slice(0, 120)) };
  }

  getUpgradeRequirement(identityId, key) {
    const profile = this.profile(identityId);
    const entry = this.community(identityId);
    const access = this.getAccess(identityId);
    if (!profile || !entry || !GAME_CONFIG.buildings[key]) return { ok: false, key, reason: 'Building unavailable.', prerequisites: [] };
    const base = entry.saved.base;
    const level = base.levels[key];
    const targetLevel = level + 1;
    const prerequisites = [];
    if (!access.allowed) prerequisites.push(access.reason);
    if (targetLevel > GAME_CONFIG.maxLevel) prerequisites.push('Maximum demo level reached (Level 5).');
    if (key === 'hq' && targetLevel <= GAME_CONFIG.maxLevel) {
      const required = level;
      for (const supportKey of SUPPORT_KEYS) {
        if (base.levels[supportKey] < required) prerequisites.push(`${GAME_CONFIG.buildings[supportKey].name} must reach Level ${required} (currently Level ${base.levels[supportKey]}).`);
      }
    } else if (key !== 'hq' && targetLevel <= GAME_CONFIG.maxLevel && targetLevel > base.levels.hq) {
      prerequisites.push(`Command Hall must reach Level ${targetLevel} first (currently Level ${base.levels.hq}).`);
    }
    if (base.projects.some(project => project.key === key && ['approved', 'constructing'].includes(project.status))) prerequisites.push('A project for this building is already approved or under construction.');
    if (base.legacyJobs.some(job => job.key === key)) prerequisites.push('A previously paid legacy construction job is still finishing.');
    const definition = GAME_CONFIG.buildings[key];
    return {
      ok: prerequisites.length === 0,
      key, name: definition.name, level, targetLevel,
      cost: targetLevel <= GAME_CONFIG.maxLevel ? definition.costs[targetLevel - 1] : 0,
      currentBenefit: definition.benefits[level - 1],
      nextBenefit: targetLevel <= GAME_CONFIG.maxLevel ? definition.benefits[targetLevel - 1] : 'Maximum level reached.',
      prerequisites,
    };
  }

  _accessError(identityId) {
    const access = this.getAccess(identityId);
    return access.allowed ? null : access.reason;
  }

  _roleError(identityId, roles) {
    const profile = this.profile(identityId);
    if (!profile || !roles.includes(profile.role)) return `This action is limited to ${roles.join(' or ')} preview roles.`;
    return null;
  }

  _recordAction(records, id, result, kind) {
    records.push({ id, kind, result: clone(result), at: this.now() });
    if (records.length > 500) records.splice(0, records.length - 500);
  }

  _findAction(records, id) {
    return records.find(record => record.id === id) || null;
  }

  _fieldOrderState(member) {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (member.fieldOrders?.day !== day) member.fieldOrders = { day, completed: [], claimed: [] };
    return member.fieldOrders;
  }

  _completeFieldOrder(member, orderId) {
    const orders = this._fieldOrderState(member);
    if (!orders.completed.includes(orderId)) orders.completed.push(orderId);
  }

  getFieldOrders(identityId = this.state.currentIdentityId) {
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError, orders: [] };
    const member = this.member(identityId);
    if (!member) return { ok: false, error: 'Member inventory unavailable.', orders: [] };
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const current = member.fieldOrders?.day === day ? member.fieldOrders : { completed: [], claimed: [] };
    return {
      ok: true, day, resetsAt: Date.parse(`${day}T00:00:00.000Z`) + DAY_MS,
      orders: FIELD_ORDERS.map(order => ({ ...order, completed: current.completed.includes(order.id), claimed: current.claimed.includes(order.id) })),
    };
  }

  claimFieldOrder(identityId, orderId) {
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    const order = FIELD_ORDERS.find(item => item.id === orderId);
    if (!order) return { ok: false, error: 'Unknown Field Order.' };
    const member = this.member(identityId);
    const progress = this._fieldOrderState(member);
    if (!progress.completed.includes(orderId)) return { ok: false, error: 'Complete this Field Order before claiming its reward.' };
    if (progress.claimed.includes(orderId)) return { ok: false, error: 'This Field Order reward was already claimed today.' };
    progress.claimed.push(orderId);
    member.parts += order.rewardParts;
    this.save();
    return { ok: true, orderId, amount: order.rewardParts };
  }

  getDefenderRequirement(identityId, role) {
    const config = DEFENDER_CONCEPTS[role];
    const entry = this.community(identityId);
    if (!config || !entry) return { ok: false, role, prerequisites: ['Defender unavailable.'] };
    const base = entry.saved.base;
    const defender = base.defenders[role];
    const targetLevel = defender.level + 1;
    const prerequisites = [];
    const accessError = this._accessError(identityId);
    if (accessError) prerequisites.push(accessError);
    if (targetLevel > GAME_CONFIG.maxLevel) prerequisites.push('Maximum defender level reached.');
    if (base.levels.hq < Math.max(config.hall, targetLevel)) prerequisites.push(`Command Hall Level ${Math.max(config.hall, targetLevel)} required.`);
    if (base.levels[config.support] < Math.max(config.supportLevel, targetLevel)) prerequisites.push(`${GAME_CONFIG.buildings[config.support].name} Level ${Math.max(config.supportLevel, targetLevel)} required.`);
    if (defender.project) prerequisites.push('An approved upgrade is already being funded.');
    return { ok: prerequisites.length === 0, role, level: defender.level, targetLevel,
      cost: DEFENDER_COSTS[targetLevel] || 0, prerequisites, project: clone(defender.project), post: defender.post };
  }

  _defenderContext(identityId, role, actionId, operation) {
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!entry || !member || !DEFENDER_CONCEPTS[role]) return { error: 'Defender or member unavailable.' };
    if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 160) return { error: 'A unique action ID of 1–160 characters is required.' };
    const kind = `defender-${operation}-${role}-${identityId}`;
    const prior = this._findAction(entry.saved.base.actionRecords, actionId);
    if (prior) return prior.kind === kind ? { replay: { ...clone(prior.result), replay: true } } : { error: 'This action ID was already used for another action or identity.' };
    const accessError = this._accessError(identityId);
    if (accessError) return { error: accessError };
    return { entry, member, defender: entry.saved.base.defenders[role], kind };
  }

  approveDefender(identityId, role, actionId = this.newActionId('defender-approve')) {
    const context = this._defenderContext(identityId, role, actionId, 'approve');
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const roleError = this._roleError(identityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    const requirement = this.getDefenderRequirement(identityId, role);
    if (!requirement.ok) return { ok: false, error: requirement.prerequisites.join(' ') };
    context.defender.project = { targetLevel: requirement.targetLevel, cost: requirement.cost, funded: 0, donors: [] };
    const result = { ok: true, role, targetLevel: requirement.targetLevel, cost: requirement.cost };
    this._recordAction(context.entry.saved.base.actionRecords, actionId, result, context.kind);
    this.save();
    return result;
  }

  fundDefender(identityId, role, amount, actionId = this.newActionId('defender-fund')) {
    const context = this._defenderContext(identityId, role, actionId, 'fund');
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const numeric = Number(amount);
    if (!Number.isSafeInteger(numeric) || numeric < 1) return { ok: false, error: 'Enter a positive whole number of Parts.' };
    const project = context.defender.project;
    if (!project) return { ok: false, error: 'Leadership must approve this defender upgrade before funding.' };
    const accepted = Math.min(numeric, project.cost - project.funded, context.member.parts);
    if (accepted < 1) return { ok: false, error: 'No personal Parts are available or the project is fully funded.' };
    context.member.parts -= accepted;
    context.member.lifetimeContributed += accepted;
    project.funded += accepted;
    project.donors.push({ identityId, name: this.profile(identityId).name, amount: accepted, at: this.now() });
    project.donors = project.donors.slice(-8);
    const completed = project.funded === project.cost && context.defender.level === project.targetLevel - 1;
    if (completed) {
      context.defender.level = project.targetLevel;
      context.defender.project = null;
      this._recordChronicle(context.entry.saved.base, `defender:${role}:${project.targetLevel}`, 'defender', `${DEFENDER_CONCEPTS[role].name} reached Level ${project.targetLevel}.`);
    }
    const result = { ok: true, role, accepted, remaining: completed ? 0 : project.cost - project.funded, completed, level: context.defender.level };
    this._recordAction(context.entry.saved.base.actionRecords, actionId, result, context.kind);
    this.save();
    return result;
  }

  assignDefender(identityId, role, post, actionId = this.newActionId('defender-assign')) {
    const context = this._defenderContext(identityId, role, actionId, 'assign');
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const roleError = this._roleError(identityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    if (!context.defender.level) return { ok: false, error: 'Unlock this defender before assigning a post.' };
    if (post !== null && !DEFENDER_POSTS[post]) return { ok: false, error: 'Choose a valid defensive post or stand down.' };
    context.defender.post = post;
    const result = { ok: true, role, post, level: context.defender.level };
    this._recordAction(context.entry.saved.base.actionRecords, actionId, result, context.kind);
    this.save();
    return result;
  }

  assignPatrolOrder(identityId, role, order, actionId = this.newActionId('patrol-order')) {
    const entry = this.community(identityId);
    if (!entry) return { ok: false, error: 'Community unavailable.' };
    if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 160) return { ok: false, error: 'A unique action ID of 1–160 characters is required.' };
    const kind = `patrol-order-${identityId}`;
    const prior = this._findAction(entry.saved.base.actionRecords, actionId);
    if (prior) return prior.kind === kind && prior.result.role === role && prior.result.order === order
      ? { ...clone(prior.result), replay: true }
      : { ok: false, error: 'This action ID was already used for another order or identity.' };
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    const roleError = this._roleError(identityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    if (!Object.hasOwn(SQUAD_ROLES, role) || !Object.hasOwn(PATROL_ORDERS, order)) return { ok: false, error: 'Choose a valid squad and patrol destination.' };
    if (!squadUnlocked(role, entry.saved.base.levels)) return { ok: false, error: 'Unlock this squad before assigning its patrol.' };
    entry.saved.base.patrolOrders[role] = order;
    const result = { ok: true, role, order };
    this._recordAction(entry.saved.base.actionRecords, actionId, result, kind);
    this.save();
    return result;
  }

  setRepairPriority(identityId, plotId, actionId = this.newActionId('repair-priority')) {
    const entry = this.community(identityId);
    if (!entry) return { ok: false, error: 'Community unavailable.' };
    if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 160) return { ok: false, error: 'A unique action ID of 1–160 characters is required.' };
    const prior = this._findAction(entry.saved.base.actionRecords, actionId);
    const kind = `repair-priority-${identityId}`;
    if (prior) return prior.kind === kind && prior.result.plotId === plotId
      ? { ...clone(prior.result), replay: true } : { ok: false, error: 'This action ID was already used.' };
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    const roleError = this._roleError(identityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    const plot = entry.saved.base.landPlots.find(item => item.id === plotId && item.wear > 0);
    if (!plot) return { ok: false, error: 'Choose a damaged district for repair priority.' };
    entry.saved.base.repairPriority = plotId;
    const result = { ok: true, plotId };
    this._recordAction(entry.saved.base.actionRecords, actionId, result, kind);
    this.save();
    return result;
  }

  repairDistrict(identityId, plotId, actionId = this.newActionId('district-repair')) {
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!entry || !member) return { ok: false, error: 'Community or member unavailable.' };
    if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 160) return { ok: false, error: 'A unique action ID of 1–160 characters is required.' };
    const prior = this._findAction(entry.saved.base.actionRecords, actionId);
    const kind = `district-repair-${identityId}`;
    if (prior) return prior.kind === kind && prior.result.plotId === plotId
      ? { ...clone(prior.result), replay: true } : { ok: false, error: 'This action ID was already used.' };
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    const base = entry.saved.base;
    const plot = base.landPlots.find(item => item.id === plotId && item.wear > 0);
    if (!plot) return { ok: false, error: 'This district has no battle wear to repair.' };
    if (base.repairPriority !== plotId) return { ok: false, error: 'Leadership must prioritise this district first.' };
    if (member.parts < BATTLE_WEAR_RULES.repairParts || member.timber < BATTLE_WEAR_RULES.repairTimber)
      return { ok: false, error: `Repair needs ${BATTLE_WEAR_RULES.repairParts} Parts and ${BATTLE_WEAR_RULES.repairTimber} Timber.` };
    member.parts -= BATTLE_WEAR_RULES.repairParts;
    member.timber -= BATTLE_WEAR_RULES.repairTimber;
    member.lifetimeContributed += BATTLE_WEAR_RULES.repairParts;
    plot.wear--;
    if (!plot.wear) base.repairPriority = base.landPlots.find(item => item.wear > 0)?.id || null;
    const result = { ok: true, plotId, remaining: plot.wear, completed: plot.wear === 0, nextPriority: base.repairPriority };
    this._recordAction(base.actionRecords, actionId, result, kind);
    this.save();
    return result;
  }

  _landContext(identityId, plotId, actionId, kind) {
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!entry || !member) return { error: 'Community or member unavailable.' };
    if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 160) return { error: 'A unique action ID of 1–160 characters is required.' };
    const prior = this._findAction(entry.saved.base.actionRecords, actionId);
    if (prior) return prior.kind === `land-${kind}-${identityId}` && prior.result.plotId === plotId
      ? { replay: { ...clone(prior.result), replay: true } }
      : { error: 'This action ID was already used for another action or identity.' };
    const accessError = this._accessError(identityId);
    if (accessError) return { error: accessError };
    const config = GAME_CONFIG.landPlots.find(plot => plot.id === plotId);
    const plot = entry.saved.base.landPlots.find(item => item.id === plotId);
    if (!config || !plot || config.hall === 1) return { error: 'Choose an unlockable land plot.' };
    if (entry.saved.base.levels.hq < config.hall) return { error: `Command Hall Level ${config.hall} is required to work this district.` };
    return { entry, member, config, plot, kind: `land-${kind}-${identityId}` };
  }

  chopTree(identityId, plotId, actionId = this.newActionId('chop')) {
    const context = this._landContext(identityId, plotId, actionId, 'chop');
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const { entry, member, plot, config, kind } = context;
    if (plot.status !== 'wild' || plot.treesRemaining < 1) return { ok: false, error: 'This plot has no standing trees left.' };
    plot.treesRemaining -= 1;
    member.timber += GAME_CONFIG.timberPerTree;
    if (plot.treesRemaining === 0) plot.status = 'cleared';
    const result = { ok: true, plotId, treesRemaining: plot.treesRemaining, timberEarned: GAME_CONFIG.timberPerTree, status: plot.status, name: config.name };
    this._recordAction(entry.saved.base.actionRecords, actionId, result, kind);
    this.save();
    return result;
  }

  approveLandClaim(identityId, plotId, actionId = this.newActionId('approve-land')) {
    const context = this._landContext(identityId, plotId, actionId, 'approve');
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const roleError = this._roleError(identityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    const { entry, plot, kind } = context;
    if (plot.status !== 'cleared' || plot.treesRemaining !== 0) return { ok: false, error: 'All trees must be cleared before the owner approves this land claim.' };
    plot.status = 'approved';
    const result = { ok: true, plotId, status: plot.status };
    this._recordAction(entry.saved.base.actionRecords, actionId, result, kind);
    this.save();
    return result;
  }

  contributeTimber(identityId, plotId, amount, actionId = this.newActionId('timber')) {
    const context = this._landContext(identityId, plotId, actionId, 'contribute');
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const { entry, member, plot, config, kind } = context;
    if (plot.status !== 'approved') return { ok: false, error: 'The land claim must be approved before members can build it.' };
    if (!Number.isSafeInteger(amount) || amount < 1) return { ok: false, error: 'Contribute a positive whole amount of Timber.' };
    const accepted = Math.min(amount, member.timber, config.timberCost - plot.timberFunded);
    if (accepted < 1) return { ok: false, error: 'No Timber available for this claim.' };
    member.timber -= accepted;
    plot.timberFunded += accepted;
    if (plot.timberFunded === config.timberCost) {
      plot.status = 'claimed';
      this._recordChronicle(entry.saved.base, `land:${plotId}`, 'land', `${config.name} claimed for the community.`);
    }
    const result = { ok: true, plotId, accepted, funded: plot.timberFunded, status: plot.status };
    this._recordAction(entry.saved.base.actionRecords, actionId, result, kind);
    this.save();
    return result;
  }

  buildBarricade(identityId, plotId, actionId = this.newActionId('barricade')) {
    const context = this._landContext(identityId, plotId, actionId, 'barricade');
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const { entry, member, plot, kind } = context;
    if (plot.status !== 'claimed') return { ok: false, error: 'Claim this plot before building its defences.' };
    if (plot.barricades >= GAME_CONFIG.maxBarricadesPerPlot) return { ok: false, error: 'This plot has reached its barricade capacity.' };
    if (member.timber < GAME_CONFIG.barricadeTimberCost) return { ok: false, error: `Need ${GAME_CONFIG.barricadeTimberCost} Timber to build a barricade.` };
    member.timber -= GAME_CONFIG.barricadeTimberCost;
    plot.barricades += 1;
    const result = { ok: true, plotId, barricades: plot.barricades };
    this._recordAction(entry.saved.base.actionRecords, actionId, result, kind);
    this.save();
    return result;
  }

  _layoutContext(identityId, actionId, operation, request) {
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!entry || !member) return { error: 'Community or member unavailable.' };
    if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 160) return { error: 'A unique action ID of 1–160 characters is required.' };
    const kind = `layout-${operation}-${identityId}`;
    const prior = this._findAction(entry.saved.base.actionRecords, actionId);
    if (prior) return prior.kind === kind && prior.result.request === request
      ? { replay: { ...clone(prior.result), replay: true } }
      : { error: 'This action ID was already used for another layout action.' };
    const accessError = this._accessError(identityId);
    if (accessError) return { error: accessError };
    const roleError = this._roleError(identityId, ['owner']);
    if (roleError) return { error: roleError };
    return { entry, member, base: entry.saved.base, kind, request };
  }

  _blueprintCandidate(base, blueprint) {
    if (!blueprint) return { error: 'This blueprint slot is empty.' };
    const current = base.layout;
    const expected = new Set(current.walls.map(wall => wall.id));
    if (!Array.isArray(blueprint.walls) || blueprint.walls.length !== expected.size
      || blueprint.walls.some(wall => !expected.has(wall.id))
      || new Set(blueprint.walls.map(wall => wall.id)).size !== expected.size)
      return { error: 'Wall inventory changed. Save this slot again before deploying it.' };
    const positions = new Map(blueprint.walls.map(wall => [wall.id, wall]));
    const structures = {};
    for (const key of Object.keys(current.structures)) {
      const point = blueprint.structures?.[key];
      if (!isGridCell(point?.x, point?.z)) return { error: 'This blueprint has an invalid building position.' };
      structures[key] = { x: point.x, z: point.z };
    }
    const candidate = { structures, walls: current.walls.map(wall => ({ ...wall, x: positions.get(wall.id).x, z: positions.get(wall.id).z })), nextWallNumber: current.nextWallNumber };
    const claimed = new Set(base.landPlots.filter(plot => plot.status === 'claimed').map(plot => plot.id));
    for (const [key, point] of Object.entries(structures)) {
      if (key in DISTRICT_DEFAULTS && !claimed.has(key)) continue;
      const error = validateLayoutPosition(candidate, claimed, key, point.x, point.z);
      if (error) return { error: `${key}: ${error}` };
    }
    for (const wall of candidate.walls) {
      const error = validateWallPosition(candidate, claimed, wall.x, wall.z, wall.id);
      if (error) return { error: `${wall.id}: ${error}` };
    }
    return { layout: candidate };
  }

  getBlueprints(identityId = this.state.currentIdentityId) {
    const base = this.community(identityId)?.saved.base;
    if (!base) return [];
    return [1, 2, 3].map(slot => {
      const blueprint = base.blueprints.find(item => item.slot === slot);
      const candidate = this._blueprintCandidate(base, blueprint);
      return { slot, name: blueprint?.name || `Plan ${slot}`, savedAt: blueprint?.savedAt || 0,
        walls: blueprint?.walls.length || 0, ready: Boolean(candidate.layout), reason: candidate.error || '' };
    });
  }

  saveBlueprint(identityId, slot, name, actionId = this.newActionId('save-blueprint')) {
    const label = String(name || '').trim().slice(0, 32);
    const context = this._layoutContext(identityId, actionId, 'save-blueprint', `${slot}:${label}`);
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    if (!Number.isInteger(slot) || slot < 1 || slot > 3 || !label) return { ok: false, error: 'Choose a slot and a short blueprint name.' };
    const { base } = context;
    const blueprint = { slot, name: label, savedAt: this.now(), structures: clone(base.layout.structures),
      walls: base.layout.walls.map(({ id, x, z }) => ({ id, x, z })) };
    base.blueprints = base.blueprints.filter(item => item.slot !== slot).concat(blueprint).sort((a, b) => a.slot - b.slot);
    const result = { ok: true, slot, name: label, request: context.request };
    this._recordAction(base.actionRecords, actionId, result, context.kind);
    this.save();
    return result;
  }

  applyBlueprint(identityId, slot, actionId = this.newActionId('apply-blueprint')) {
    const context = this._layoutContext(identityId, actionId, 'apply-blueprint', String(slot));
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const { base, entry } = context;
    if (this.state.wars.some(war => ['challenged', 'preparation', 'active'].includes(war.state)
      && [war.challengerCommunityId, war.defenderCommunityId].includes(entry.definition.id)))
      return { ok: false, error: 'A war is pending or active. Deploy saved layouts after it closes.' };
    const blueprint = base.blueprints.find(item => item.slot === slot);
    const candidate = this._blueprintCandidate(base, blueprint);
    if (candidate.error) return { ok: false, error: candidate.error };
    base.layout = candidate.layout;
    const result = { ok: true, slot, name: blueprint.name, request: context.request };
    this._recordAction(base.actionRecords, actionId, result, context.kind);
    this.save();
    return result;
  }

  drillBlueprint(identityId, slot) {
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    const entry = this.community(identityId);
    const blueprint = entry.saved.base.blueprints.find(item => item.slot === slot);
    const candidate = this._blueprintCandidate(entry.saved.base, blueprint);
    if (candidate.error) return { ok: false, error: candidate.error };
    const defender = this._warSideSnapshot(entry.definition.id);
    defender.base.layout = clone(candidate.layout);
    const attacker = clone(defender);
    attacker.name = 'DZN training squad';
    const lanes = ['west', 'south', 'east'].map(lane => {
      const tactics = evaluateWarPlan(defender, 'assault', { lane, objective: 'hq', method: 'breach' });
      const combat = tactics.ok ? simulateWarCombat(attacker, defender, {
        tactic: 'assault', tactics, combatBaseScore: Math.max(0, Math.min(100, 44 + tactics.scoreDelta)), orders: [],
      }) : tactics;
      return { lane, name: tactics.laneName || lane, score: combat.score ?? 0,
        casualties: combat.casualties ?? 0, wallCount: tactics.wallCount || 0,
        breached: combat.walls?.filter(wall => wall.remainingHealth === 0).length || 0,
        objectiveDamage: combat.objective ? combat.objective.maxHealth - combat.objective.remainingHealth : 0,
        error: combat.error || '' };
    });
    return { ok: true, slot, name: blueprint.name, lanes, worst: lanes.reduce((a, b) => b.score > a.score ? b : a),
      simulated: true, reward: 0 };
  }

  moveStructure(identityId, key, x, z, actionId = this.newActionId('move-structure')) {
    const context = this._layoutContext(identityId, actionId, 'move-structure', `${key}:${x}:${z}`);
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const { base } = context;
    const claimed = new Set(base.landPlots.filter(plot => plot.status === 'claimed').map(plot => plot.id));
    const error = validateLayoutPosition(base.layout, claimed, key, x, z);
    if (error) return { ok: false, error };
    base.layout.structures[key] = { x, z };
    const result = { ok: true, key, x, z, request: context.request };
    this._recordAction(base.actionRecords, actionId, result, context.kind);
    this.save();
    return result;
  }

  placeWallRow(identityId, start, end = start, actionId = this.newActionId('wall-row')) {
    const request = `${start?.x}:${start?.z}:${end?.x}:${end?.z}`;
    const context = this._layoutContext(identityId, actionId, 'wall-row', request);
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const { base, member } = context;
    const cells = rowCells(start, end);
    if (!cells) return { ok: false, error: 'Choose a straight row of up to 16 grid cells.' };
    if (base.layout.walls.length + cells.length > MAX_WALLS_PER_HALL[base.levels.hq]) return { ok: false, error: 'Command Hall wall capacity reached.' };
    const claimed = new Set(base.landPlots.filter(plot => plot.status === 'claimed').map(plot => plot.id));
    for (const cell of cells) {
      const error = validateWallPosition(base.layout, claimed, cell.x, cell.z);
      if (error) return { ok: false, error: `${error} Row unchanged.` };
    }
    const cost = WALL_COSTS[1];
    const partsCost = cost.parts * cells.length, timberCost = cost.timber * cells.length;
    if (member.parts < partsCost || member.timber < timberCost) return { ok: false, error: `Need ${partsCost} Parts and ${timberCost} Timber for this row.` };
    member.parts -= partsCost; member.timber -= timberCost;
    const walls = cells.map(cell => ({ id: `wall-${base.layout.nextWallNumber++}`, ...cell, level: 1 }));
    base.layout.walls.push(...walls);
    const result = { ok: true, walls: clone(walls), partsCost, timberCost, request };
    this._recordAction(base.actionRecords, actionId, result, context.kind);
    this.save();
    return result;
  }

  moveWall(identityId, wallId, x, z, actionId = this.newActionId('move-wall')) {
    const context = this._layoutContext(identityId, actionId, 'move-wall', `${wallId}:${x}:${z}`);
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const { base } = context;
    const wall = base.layout.walls.find(item => item.id === wallId);
    if (!wall) return { ok: false, error: 'Choose a wall in this base.' };
    const claimed = new Set(base.landPlots.filter(plot => plot.status === 'claimed').map(plot => plot.id));
    const error = validateWallPosition(base.layout, claimed, x, z, wallId);
    if (error) return { ok: false, error };
    wall.x = x; wall.z = z;
    const result = { ok: true, wall: clone(wall), request: context.request };
    this._recordAction(base.actionRecords, actionId, result, context.kind);
    this.save();
    return result;
  }

  upgradeWallRow(identityId, start, end = start, actionId = this.newActionId('upgrade-wall-row')) {
    const request = `${start?.x}:${start?.z}:${end?.x}:${end?.z}`;
    const context = this._layoutContext(identityId, actionId, 'upgrade-wall-row', request);
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const { base, member } = context;
    const cells = rowCells(start, end);
    if (!cells) return { ok: false, error: 'Choose a straight row of up to 16 grid cells.' };
    const walls = cells.map(cell => base.layout.walls.find(wall => wall.x === cell.x && wall.z === cell.z));
    if (walls.some(wall => !wall)) return { ok: false, error: 'Every cell in the upgrade row needs an existing wall.' };
    if (walls.some(wall => wall.level >= base.levels.hq || wall.level >= GAME_CONFIG.maxLevel)) return { ok: false, error: 'Unlock a higher Command Hall tier before upgrading this whole row.' };
    const partsCost = walls.reduce((sum, wall) => sum + WALL_COSTS[wall.level + 1].parts, 0);
    const timberCost = walls.reduce((sum, wall) => sum + WALL_COSTS[wall.level + 1].timber, 0);
    if (member.parts < partsCost || member.timber < timberCost) return { ok: false, error: `Need ${partsCost} Parts and ${timberCost} Timber for this upgrade.` };
    member.parts -= partsCost; member.timber -= timberCost;
    for (const wall of walls) wall.level++;
    const result = { ok: true, walls: clone(walls), partsCost, timberCost, request };
    this._recordAction(base.actionRecords, actionId, result, context.kind);
    this.save();
    return result;
  }

  approveFacility(identityId, plotId, actionId = this.newActionId('approve-facility')) {
    const context = this._landContext(identityId, plotId, actionId, 'facility-approve');
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const roleError = this._roleError(identityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    const { entry, plot, kind } = context;
    if (plot.status !== 'claimed') return { ok: false, error: 'Claim this land before approving its facility.' };
    if (plot.facilityProject) return { ok: false, error: 'This facility already has an approved project.' };
    const targetLevel = plot.facilityLevel + 1;
    const costs = GAME_CONFIG.facilities[plotId]?.costs[targetLevel];
    if (!costs) return { ok: false, error: 'This facility is fully upgraded.' };
    if (targetLevel > entry.saved.base.levels.hq) return { ok: false, error: `Command Hall Level ${targetLevel} is required for this facility tier.` };
    plot.facilityProject = { targetLevel, partsCost: costs[0], timberCost: costs[1], partsFunded: 0, timberFunded: 0, donors: [] };
    const result = { ok: true, plotId, targetLevel, partsCost: costs[0], timberCost: costs[1] };
    this._recordAction(entry.saved.base.actionRecords, actionId, result, kind);
    this.save();
    return result;
  }

  contributeFacility(identityId, plotId, parts, timber, actionId = this.newActionId('facility-donate')) {
    const context = this._landContext(identityId, plotId, actionId, 'facility-contribute');
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const { entry, member, plot, kind } = context;
    const project = plot.facilityProject;
    if (plot.status !== 'claimed' || !project) return { ok: false, error: 'Leadership must approve a claimed facility project first.' };
    if (!Number.isSafeInteger(parts) || parts < 0 || !Number.isSafeInteger(timber) || timber < 0 || parts + timber < 1) return { ok: false, error: 'Donate a positive whole amount of Parts or Timber.' };
    const acceptedParts = Math.min(parts, member.parts, project.partsCost - project.partsFunded);
    const acceptedTimber = Math.min(timber, member.timber, project.timberCost - project.timberFunded);
    if (acceptedParts + acceptedTimber < 1) return { ok: false, error: 'No required Parts or Timber are available to donate.' };
    member.parts -= acceptedParts;
    member.timber -= acceptedTimber;
    member.lifetimeContributed += acceptedParts;
    project.partsFunded += acceptedParts;
    project.timberFunded += acceptedTimber;
    project.donors.push({ identityId, name: this.profile(identityId).name, parts: acceptedParts, timber: acceptedTimber, at: this.now() });
    project.donors = project.donors.slice(-8);
    const completed = project.partsFunded === project.partsCost && project.timberFunded === project.timberCost;
    const targetLevel = project.targetLevel;
    if (completed) {
      if (plotId === 'timberline-depot') for (const profile of PREVIEW_IDENTITIES.filter(item => item.communityId === entry.definition.id)) this.advanceTimberProduction(profile.id);
      plot.facilityLevel = targetLevel; plot.facilityProject = null;
      this._recordChronicle(entry.saved.base, `facility:${plotId}:${targetLevel}`, 'facility', `${GAME_CONFIG.facilities[plotId].name} reached Level ${targetLevel}.`);
    }
    const result = { ok: true, plotId, acceptedParts, acceptedTimber, completed, targetLevel, facilityLevel: plot.facilityLevel };
    this._recordAction(entry.saved.base.actionRecords, actionId, result, kind);
    this.save();
    return result;
  }

  approveRoute(identityId, plotId, actionId = this.newActionId('approve-route')) {
    const context = this._landContext(identityId, plotId, actionId, 'route-approve');
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const roleError = this._roleError(identityId, ['owner', 'admin']);
    if (roleError) return { ok: false, error: roleError };
    const { entry, plot, kind } = context;
    if (plot.status !== 'claimed') return { ok: false, error: 'Claim this district before approving a supply route.' };
    if (plot.routeProject) return { ok: false, error: 'This supply route already has an approved project.' };
    const targetLevel = plot.routeLevel + 1;
    const costs = GAME_CONFIG.routeCosts[targetLevel];
    if (!costs) return { ok: false, error: 'This supply route is fully upgraded.' };
    if (targetLevel > entry.saved.base.levels.hq) return { ok: false, error: `Command Hall Level ${targetLevel} is required for this route tier.` };
    plot.routeProject = { targetLevel, partsCost: costs[0], timberCost: costs[1], partsFunded: 0, timberFunded: 0, donors: [] };
    const result = { ok: true, plotId, targetLevel, partsCost: costs[0], timberCost: costs[1] };
    this._recordAction(entry.saved.base.actionRecords, actionId, result, kind);
    this.save();
    return result;
  }

  contributeRoute(identityId, plotId, parts, timber, actionId = this.newActionId('route-donate')) {
    const context = this._landContext(identityId, plotId, actionId, 'route-contribute');
    if (context.replay) return context.replay;
    if (context.error) return { ok: false, error: context.error };
    const { entry, member, plot, kind } = context;
    const project = plot.routeProject;
    if (plot.status !== 'claimed' || !project) return { ok: false, error: 'Leadership must approve a claimed district route first.' };
    if (!Number.isSafeInteger(parts) || parts < 0 || !Number.isSafeInteger(timber) || timber < 0 || parts + timber < 1) return { ok: false, error: 'Donate a positive whole amount of Parts or Timber.' };
    const acceptedParts = Math.min(parts, member.parts, project.partsCost - project.partsFunded);
    const acceptedTimber = Math.min(timber, member.timber, project.timberCost - project.timberFunded);
    if (acceptedParts + acceptedTimber < 1) return { ok: false, error: 'No required Parts or Timber are available to donate.' };
    member.parts -= acceptedParts;
    member.timber -= acceptedTimber;
    member.lifetimeContributed += acceptedParts;
    project.partsFunded += acceptedParts;
    project.timberFunded += acceptedTimber;
    project.donors.push({ identityId, name: this.profile(identityId).name, parts: acceptedParts, timber: acceptedTimber, at: this.now() });
    project.donors = project.donors.slice(-8);
    const completed = project.partsFunded === project.partsCost && project.timberFunded === project.timberCost;
    const targetLevel = project.targetLevel;
    if (completed) {
      plot.routeLevel = targetLevel; plot.routeProject = null;
      this._recordChronicle(entry.saved.base, `route:${plotId}:${targetLevel}`, 'route', `${GAME_CONFIG.landPlots.find(item => item.id === plotId).name} supply route reached Level ${targetLevel}.`);
    }
    const result = { ok: true, plotId, acceptedParts, acceptedTimber, completed, targetLevel, routeLevel: plot.routeLevel };
    this._recordAction(entry.saved.base.actionRecords, actionId, result, kind);
    this.save();
    return result;
  }

  routeNetworkBonus(identityId = this.state.currentIdentityId) {
    const plots = this.community(identityId)?.saved.base.landPlots || [];
    return plots.reduce((total, plot) => total + (plot.status === 'claimed' ? plot.routeLevel : 0), 0) * GAME_CONFIG.routeSalvageBonusPerLevel;
  }

  claimDepotTimber(identityId = this.state.currentIdentityId) {
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    const member = this.member(identityId);
    const plot = this.community(identityId)?.saved.base.landPlots.find(item => item.id === 'timberline-depot');
    if (!member || !plot || plot.status !== 'claimed' || plot.facilityLevel < 1) return { ok: false, error: 'Build the Timberline Lumber Yard to unlock daily Timber.' };
    const now = this.now();
    if (member.nextTimberClaimAt > now) return { ok: false, error: 'Lumber Yard resupply is not ready yet.', nextClaimAt: member.nextTimberClaimAt };
    const amount = 20 + (plot.facilityLevel - 1) * 10;
    member.timber += amount;
    member.nextTimberClaimAt = now + DAY_MS;
    this.save();
    return { ok: true, amount, nextClaimAt: member.nextTimberClaimAt };
  }

  collectYardTimber(identityId = this.state.currentIdentityId) {
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    const info = this.getTimberProductionInfo(identityId);
    if (!info?.level) return { ok: false, error: 'Build the Timberline Lumber Yard to collect produced Timber.' };
    this.advanceTimberProduction(identityId);
    const member = this.member(identityId);
    const amount = Math.floor(member.timberStored);
    if (amount < 1) return { ok: false, error: 'No whole Timber is ready to collect yet.' };
    member.timber += amount;
    member.timberStored -= amount;
    this.save();
    return { ok: true, amount };
  }

  recycleTimber(identityId = this.state.currentIdentityId, actionId = this.newActionId('recycle-timber')) {
    const member = this.member(identityId);
    if (!member) return { ok: false, error: 'Member inventory unavailable.' };
    const prior = this._findAction(member.actionRecords, actionId);
    if (prior) return prior.kind === `recycle-timber-${identityId}` ? { ...clone(prior.result), replay: true } : { ok: false, error: 'This action ID was already used for another action.' };
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    if (member.salvage < GAME_CONFIG.recycleSalvageCost) return { ok: false, error: `Need ${GAME_CONFIG.recycleSalvageCost} Salvage to reclaim Timber.` };
    member.salvage -= GAME_CONFIG.recycleSalvageCost;
    member.timber += GAME_CONFIG.recycledTimber;
    const result = { ok: true, amount: GAME_CONFIG.recycledTimber, cost: GAME_CONFIG.recycleSalvageCost };
    this._recordAction(member.actionRecords, actionId, result, `recycle-timber-${identityId}`);
    this.save();
    return result;
  }

  approveProject(identityId, key, actionId = this.newActionId('approve')) {
    const entry = this.community(identityId);
    if (!entry) return { ok: false, error: 'Community unavailable.' };
    const prior = this._findAction(entry.saved.base.actionRecords, actionId);
    if (prior) return { ...clone(prior.result), replay: true };
    const accessError = this._accessError(identityId);
    const roleError = this._roleError(identityId, ['owner', 'admin']);
    const requirement = this.getUpgradeRequirement(identityId, key);
    if (accessError || roleError || !requirement.ok) return { ok: false, error: accessError || roleError || requirement.prerequisites.join(' ') };
    const base = entry.saved.base;
    const id = `project-${entry.definition.id}-${base.nextProjectNumber++}`;
    const project = {
      id, key, targetLevel: requirement.targetLevel, targetAmount: requirement.cost, funded: 0,
      benefit: requirement.nextBenefit, prerequisites: requirement.prerequisites,
      status: 'approved', pinned: false, createdAt: this.now(), completedAt: 0, donors: [],
    };
    base.projects.push(project);
    const result = { ok: true, projectId: id };
    this._recordAction(base.actionRecords, actionId, result, 'approve-project');
    this.save();
    return result;
  }

  pinProject(identityId, projectId, pinned, actionId = this.newActionId('pin')) {
    const entry = this.community(identityId);
    if (!entry) return { ok: false, error: 'Community unavailable.' };
    const base = entry.saved.base;
    const prior = this._findAction(base.actionRecords, actionId);
    if (prior) return { ...clone(prior.result), replay: true };
    const accessError = this._accessError(identityId);
    const roleError = this._roleError(identityId, ['owner', 'admin']);
    const project = base.projects.find(p => p.id === projectId && p.status === 'approved');
    if (!project) return { ok: false, error: 'That approved project is no longer available.' };
    if (accessError || roleError) return { ok: false, error: accessError || roleError };
    if (pinned && !project.pinned && base.projects.filter(p => p.status === 'approved' && p.pinned).length >= 3) return { ok: false, error: 'A community can pin at most three project priorities.' };
    project.pinned = Boolean(pinned);
    const result = { ok: true, pinned: project.pinned };
    this._recordAction(base.actionRecords, actionId, result, 'pin-project');
    this.save();
    return result;
  }

  _completeProject(entry, project, at = this.now()) {
    const base = entry.saved.base;
    if (base.completedProjectIds.includes(project.id)) return false;
    if (base.levels[project.key] !== project.targetLevel - 1) {
      project.status = 'blocked';
      project.pinned = false;
      return false;
    }
    if (project.key === 'workshop') for (const member of PREVIEW_IDENTITIES.filter(item => item.communityId === entry.definition.id)) this.advancePartsProduction(member.id, at);
    base.levels[project.key] = project.targetLevel;
    project.status = 'completed';
    project.completedAt = at;
    project.pinned = false;
    base.completedProjectIds.push(project.id);
    this._recordChronicle(base, `project:${project.id}`, 'project', `${GAME_CONFIG.buildings[project.key].name} reached Level ${project.targetLevel}.`, project.completedAt);
    return true;
  }

  getBuilderCapacity(identityId = this.state.currentIdentityId) {
    const hall = this.community(identityId)?.saved.base.levels.hq || 1;
    return hall >= 5 ? 3 : hall >= 3 ? 2 : 1;
  }

  _startProjectConstruction(entry, project) {
    if (project.status !== 'approved' || project.funded < project.targetAmount) return false;
    const now = this.now();
    const capacity = entry.saved.base.levels.hq >= 5 ? 3 : entry.saved.base.levels.hq >= 3 ? 2 : 1;
    const available = Array.from({ length: capacity }, () => now);
    for (const active of entry.saved.base.projects.filter(item => item.status === 'constructing')) {
      if (active.crewSlot >= 0 && active.crewSlot < available.length) available[active.crewSlot] = Math.max(available[active.crewSlot], active.finishAt);
    }
    const crewSlot = available.indexOf(Math.min(...available));
    project.status = 'constructing';
    project.pinned = false;
    project.crewSlot = crewSlot;
    project.startedAt = available[crewSlot];
    project.finishAt = project.startedAt + GAME_CONFIG.constructionSecondsPerLevel * project.targetLevel * 1000;
    return true;
  }

  processConstructionJobs(identityId = this.state.currentIdentityId) {
    const entry = this.community(identityId);
    if (!entry) return [];
    const completed = [];
    for (const project of entry.saved.base.projects.filter(item => item.status === 'constructing' && item.finishAt <= this.now()).sort((a, b) => a.finishAt - b.finishAt)) {
      if (this._completeProject(entry, project, project.finishAt)) completed.push(project.key);
    }
    if (completed.length) this.save();
    return completed;
  }

  contributeToProject(identityId, projectId, amount, actionId = this.newActionId('donate')) {
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!entry || !member) return { ok: false, error: 'Member inventory unavailable.' };
    const base = entry.saved.base;
    const prior = this._findAction(base.actionRecords, actionId);
    if (prior) return { ...clone(prior.result), replay: true };
    const accessError = this._accessError(identityId);
    const numeric = Number(amount);
    if (accessError) return { ok: false, error: accessError };
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return { ok: false, error: 'Enter a positive whole number of Parts.' };
    const project = base.projects.find(p => p.id === projectId && p.status === 'approved');
    if (!project) return { ok: false, error: 'This approved project is not open for funding.' };
    const remaining = Math.max(0, project.targetAmount - project.funded);
    const accepted = Math.min(numeric, remaining, member.parts);
    if (accepted < 1) return { ok: false, error: member.parts < 1 ? 'No personal Parts are available to contribute.' : 'This project is already fully funded.' };
    member.parts -= accepted;
    project.funded += accepted;
    member.lifetimeContributed += accepted;
    project.donors.push({ identityId, name: this.profile(identityId).name, amount: accepted, at: this.now() });
    project.donors = project.donors.slice(-8);
    const constructionStarted = this._startProjectConstruction(entry, project);
    const result = { ok: true, accepted, remaining: Math.max(0, project.targetAmount - project.funded), completed: false, constructionStarted, projectId };
    this._recordAction(base.actionRecords, actionId, result, 'project-contribution');
    this.save();
    return result;
  }

  allocateTreasury(identityId, projectId, amount, actionId = this.newActionId('allocate')) {
    const entry = this.community(identityId);
    if (!entry) return { ok: false, error: 'Community unavailable.' };
    const base = entry.saved.base;
    const prior = this._findAction(base.actionRecords, actionId);
    if (prior) return { ...clone(prior.result), replay: true };
    const accessError = this._accessError(identityId);
    const roleError = this._roleError(identityId, ['owner', 'admin']);
    const numeric = Number(amount);
    if (accessError || roleError) return { ok: false, error: accessError || roleError };
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return { ok: false, error: 'Enter a positive whole number of Treasury Parts.' };
    const project = base.projects.find(p => p.id === projectId && p.status === 'approved');
    if (!project) return { ok: false, error: 'This approved project is not open for allocation.' };
    const remaining = Math.max(0, project.targetAmount - project.funded);
    const accepted = Math.min(numeric, remaining, base.treasury);
    if (accepted < 1) return { ok: false, error: base.treasury < 1 ? 'No unallocated Treasury Parts are available.' : 'This project is already fully funded.' };
    base.treasury -= accepted;
    project.funded += accepted;
    const constructionStarted = this._startProjectConstruction(entry, project);
    const result = { ok: true, accepted, remaining: Math.max(0, project.targetAmount - project.funded), completed: false, constructionStarted, projectId };
    this._recordAction(base.actionRecords, actionId, result, 'treasury-allocation');
    this.save();
    return result;
  }

  collectParts(identityId = this.state.currentIdentityId) {
    const accessError = this._accessError(identityId);
    const member = this.member(identityId);
    if (accessError) return { ok: false, error: accessError };
    if (!member) return { ok: false, error: 'Member inventory unavailable.' };
    this.advancePartsProduction(identityId);
    const amount = Math.floor(member.stored);
    if (!Number.isSafeInteger(amount) || amount < 1) return { ok: false, error: 'No whole Parts are ready to collect yet.' };
    member.parts += amount;
    member.stored -= amount;
    this._completeFieldOrder(member, 'parts');
    this.save();
    return { ok: true, amount };
  }

  claimDailySalvage(identityId = this.state.currentIdentityId) {
    const accessError = this._accessError(identityId);
    const member = this.member(identityId);
    if (accessError) return { ok: false, error: accessError };
    if (!member) return { ok: false, error: 'Member inventory unavailable.' };
    const now = this.now();
    if (member.nextClaimAt > now) return { ok: false, error: 'Daily Salvage resupply is not ready yet.', nextClaimAt: member.nextClaimAt };
    const amount = GAME_CONFIG.dailySalvage + this.routeNetworkBonus(identityId);
    member.salvage += amount;
    member.nextClaimAt = now + DAY_MS;
    this.save();
    return { ok: true, amount, nextClaimAt: member.nextClaimAt };
  }

  forgeSlotCount(identityId = this.state.currentIdentityId) {
    const entry = this.community(identityId);
    const hall = entry?.saved.base.levels.hq || 1;
    return hall >= 5 ? 3 : hall >= 3 ? 2 : 1;
  }

  processForge(identityId = this.state.currentIdentityId) {
    const member = this.member(identityId);
    if (!member || !this.community(identityId)) return [];
    const now = this.now();
    const slots = this.forgeSlotCount(identityId);
    let changed = false;
    const assign = (job, key, value) => {
      if (job[key] !== value) { job[key] = value; changed = true; }
    };
    const jobs = member.forgeJobs;

    // Completed/started work retains its original slot and timestamps. Future
    // queued schedules may move onto newly unlocked HQ slots; paid active work never restarts.
    for (const job of jobs) {
      const scheduled = Number.isFinite(job.startedAt) && Number.isFinite(job.finishAt) && Number.isInteger(job.slot) && job.slot > 0;
      if (!scheduled || job.status === 'claimed') continue;
      if (job.finishAt <= now) assign(job, 'status', 'ready');
      else if (job.startedAt <= now) assign(job, 'status', 'working');
      else assign(job, 'status', 'queued');
    }

    const availableAt = new Map();
    for (let slot = 1; slot <= slots; slot++) availableAt.set(slot, 0);
    for (const job of jobs) {
      if (!Number.isInteger(job.slot) || job.slot < 1 || !Number.isFinite(job.finishAt)) continue;
      const isCommitted = job.status === 'working' || job.status === 'ready' || job.status === 'claimed';
      if (!isCommitted) continue;
      availableAt.set(job.slot, Math.max(availableAt.get(job.slot) || 0, job.finishAt));
    }

    const queued = jobs.filter(job => job.status === 'queued').sort((a, b) =>
      (a.queuedAt ?? a.createdAt) - (b.queuedAt ?? b.createdAt) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const job of queued) {
      // Existing future timestamps are intentionally replanned, not charged again.
      const recipe = GAME_CONFIG.forgeRecipes.find(item => item.id === job.recipeId);
      if (!recipe) continue;
      let bestSlot = 1;
      let bestStart = Math.max(availableAt.get(1) || 0, Number(job.queuedAt ?? job.createdAt) || 0);
      for (let slot = 2; slot <= slots; slot++) {
        const candidate = Math.max(availableAt.get(slot) || 0, Number(job.queuedAt ?? job.createdAt) || 0);
        if (candidate < bestStart) { bestStart = candidate; bestSlot = slot; }
      }
      const finishAt = bestStart + recipe.durationSeconds * 1000;
      assign(job, 'slot', bestSlot);
      assign(job, 'startedAt', bestStart);
      assign(job, 'finishAt', finishAt);
      assign(job, 'status', finishAt <= now ? 'ready' : bestStart <= now ? 'working' : 'queued');
      availableAt.set(bestSlot, finishAt);
    }

    if (changed) this.save();
    return clone(jobs);
  }

  startForgeJob(identityId, recipeId, actionId = this.newActionId('forge')) {
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!entry || !member) return { ok: false, error: 'Member inventory unavailable.' };
    const prior = this._findAction(member.actionRecords, actionId);
    if (prior) return { ...clone(prior.result), replay: true };
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    const recipe = GAME_CONFIG.forgeRecipes.find(item => item.id === recipeId);
    if (!recipe) return { ok: false, error: 'Choose a listed Forge recipe.' };
    this.processForge(identityId);
    const activeCount = member.forgeJobs.filter(job => ['working', 'queued'].includes(job.status)).length;
    if (activeCount >= this.forgeSlotCount(identityId) + GAME_CONFIG.forgeQueueBuffer) return { ok: false, error: 'Forge queue is full. Claim ready jobs or wait for a slot.' };
    if (member.salvage < recipe.input) return { ok: false, error: `Need ${recipe.input - member.salvage} more Salvage for this recipe.` };
    member.salvage -= recipe.input;
    const job = {
      id: this.newActionId('forge-job'), recipeId, input: recipe.input, output: recipe.output,
      durationSeconds: recipe.durationSeconds, status: 'queued', createdAt: this.now(), queuedAt: this.now(),
      slot: null, startedAt: null, finishAt: null, claimedAt: 0,
    };
    member.forgeJobs.push(job);
    this.processForge(identityId);
    const result = { ok: true, jobId: job.id, status: job.status };
    this._recordAction(member.actionRecords, actionId, result, 'forge-start');
    this.save();
    return result;
  }

  claimForgeJob(identityId, jobId, actionId = `claim-${jobId}`) {
    const member = this.member(identityId);
    if (!member) return { ok: false, error: 'Member inventory unavailable.' };
    const job = member.forgeJobs.find(item => item.id === jobId);
    // A repeated claim is a rejected state transition, even if its idempotency
    // key matches the successful first request. The job status is authoritative.
    if (job?.status === 'claimed') return { ok: false, error: 'This Forge output has already been claimed.' };
    const prior = this._findAction(member.actionRecords, actionId);
    if (prior) return { ...clone(prior.result), replay: true };
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    this.processForge(identityId);
    if (!job || job.status !== 'ready') return { ok: false, error: 'This Forge job is not ready to claim.' };
    member.parts += job.output;
    job.status = 'claimed';
    job.claimedAt = this.now();
    this._completeFieldOrder(member, 'forge');
    const result = { ok: true, amount: job.output, jobId };
    this._recordAction(member.actionRecords, actionId, result, 'forge-claim');
    this.save();
    return result;
  }

  setMemberValue(identityId, key, value) {
    const member = this.member(identityId);
    if (!member || !['muted', 'parts', 'stored', 'salvage'].includes(key)) return;
    if (key === 'muted') member.muted = Boolean(value);
    else if (key === 'stored') member.stored = Math.max(0, Number(value) || 0);
    else member[key] = safeInt(value);
    this.save();
  }

  getProductionInfo(identityId = this.state.currentIdentityId) {
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!entry || !member) return null;
    const level = entry.saved.base.levels.workshop;
    return { stored: member.stored, capacity: 500 + (level - 1) * 250,
      perSecond: this.getAccess(identityId).allowed ? GAME_CONFIG.buildings.workshop.stats[level - 1].partsPerSecond : 0 };
  }

  advancePartsProduction(identityId = this.state.currentIdentityId, timestamp = this.now()) {
    const member = this.member(identityId);
    const info = this.getProductionInfo(identityId);
    if (!member || !info) return 0;
    const now = Math.max(0, Math.floor(Number(timestamp) || 0));
    const previous = safeInt(member.productionAt);
    if (now <= previous) return 0;
    member.productionAt = now;
    if (!previous || !info.perSecond) return 0;
    const produced = info.perSecond * Math.min(now - previous, DAY_MS) / 1000;
    const before = member.stored;
    member.stored = Math.max(before, Math.min(info.capacity, before + produced));
    return member.stored - before;
  }

  getTimberProductionInfo(identityId = this.state.currentIdentityId) {
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!entry || !member) return null;
    const plot = entry.saved.base.landPlots.find(item => item.id === 'timberline-depot');
    const level = plot?.status === 'claimed' ? plot.facilityLevel : 0;
    return { level, stored: member.timberStored, capacity: level ? 30 + (level - 1) * 20 : 0,
      perMinute: level && this.getAccess(identityId).allowed ? level * 2 : 0 };
  }

  advanceTimberProduction(identityId = this.state.currentIdentityId) {
    const member = this.member(identityId);
    const info = this.getTimberProductionInfo(identityId);
    if (!member || !info) return 0;
    const now = Math.max(0, Math.floor(Number(this.now()) || 0));
    const previous = safeInt(member.timberProductionAt);
    member.timberProductionAt = now;
    if (!previous || now <= previous || !info.perMinute) return 0;
    const produced = info.perMinute * Math.min(now - previous, DAY_MS) / 60_000;
    const before = member.timberStored;
    member.timberStored = Math.max(before, Math.min(info.capacity, before + produced));
    return member.timberStored - before;
  }

  getTrainingLoadout(identityId = this.state.currentIdentityId) {
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!entry || !member) return null;
    const levels = entry.saved.base.levels;
    return { counts: normalizedTrainingLoadout(member.trainingLoadout, levels), capacity: trainingCapacity(levels) };
  }

  _settleTraining(identityId) {
    const member = this.member(identityId);
    if (!member) return;
    const now = this.now();
    const pending = [];
    const away = [];
    let changed = false;
    for (const job of member.trainingJobs) {
      if (job.finishAt > now) { pending.push(job); continue; }
      member.trainingReserve[job.role] = Math.min(100, member.trainingReserve[job.role] + job.count);
      changed = true;
    }
    for (const deployment of member.warDeployments) {
      const attack = this._warById(deployment.warId)?.attacks.find(item => item.attackId === deployment.attackId && item.identityId === identityId);
      if (!attack) { changed = true; continue; }
      if (Math.min(deployment.returnAt, attack.returnedAt || Infinity) > now) { away.push(deployment); continue; }
      // The final saved combat report includes field orders issued after launch.
      // Only its surviving soldiers return; a reload cannot grant them twice.
      for (const soldier of attack.damage?.squad || []) if (TRAINING_ROLES.includes(soldier.role) && soldier.remainingHealth > 0)
        member.trainingReserve[soldier.role] = Math.min(100, member.trainingReserve[soldier.role] + 1);
      changed = true;
    }
    if (changed) { member.trainingJobs = pending; member.warDeployments = away; this.save(); }
  }

  getTrainingReadiness(identityId = this.state.currentIdentityId) {
    const loadout = this.getTrainingLoadout(identityId);
    const member = this.member(identityId);
    if (!loadout || !member) return null;
    this._settleTraining(identityId);
    const reserve = normalizedReserve(member.trainingReserve);
    const missing = Object.fromEntries(TRAINING_ROLES.map(role => [role, Math.max(0, loadout.counts[role] - reserve[role])]));
    return { ...loadout, reserve, missing, ready: TRAINING_ROLES.every(role => missing[role] === 0),
      jobs: clone(member.trainingJobs), away: clone(member.warDeployments), reserveCapacity: loadout.capacity * 2,
      occupied: TRAINING_ROLES.reduce((sum, role) => sum + reserve[role], 0) + member.trainingJobs.reduce((sum, job) => sum + job.count, 0)
        + member.warDeployments.reduce((sum, deployment) => sum + TRAINING_ROLES.reduce((count, role) => count + deployment.counts[role], 0), 0) };
  }

  getReinforcementRequests(identityId = this.state.currentIdentityId) {
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError, requests: [] };
    const now = this.now();
    const requests = this.community(identityId).saved.base.reinforcementRequests
      .filter(request => request.expiresAt > now && request.donated < request.count)
      .map(request => ({ ...request, remaining: request.count - request.donated,
        name: this.profile(request.identityId)?.name || 'Member' }));
    return { ok: true, requests: clone(requests) };
  }

  requestReinforcements(identityId, role, count, actionId = this.newActionId('reinforcement-request')) {
    const entry = this.community(identityId);
    if (!entry) return { ok: false, error: 'Choose a connected preview member.' };
    if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 160) return { ok: false, error: 'A unique request action is required.' };
    const prior = this._findAction(entry.saved.base.actionRecords, actionId);
    if (prior) return prior.kind === `reinforcement-request:${identityId}:${role}:${count}`
      ? { ...clone(prior.result), replay: true } : { ok: false, error: 'This action ID was already used.' };
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    if (!TRAINING_ROLES.includes(role) || !squadUnlocked(role, entry.saved.base.levels)) return { ok: false, error: 'That troop role is not unlocked for this community.' };
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_REINFORCEMENTS_PER_REQUEST) return { ok: false, error: `Request 1–${MAX_REINFORCEMENTS_PER_REQUEST} whole troops.` };
    const now = this.now();
    const base = entry.saved.base;
    if (base.reinforcementRequests.some(request => request.identityId === identityId && request.expiresAt > now && request.donated < request.count))
      return { ok: false, error: 'Finish or wait for your current request before posting another.' };
    const readiness = this.getTrainingReadiness(identityId);
    if (readiness.occupied + count > readiness.reserveCapacity) return { ok: false, error: 'Leave enough free camp spaces for the requested troops.' };
    const request = { id: actionId, identityId, role, count, donated: 0, createdAt: now, expiresAt: now + REINFORCEMENT_REQUEST_MS };
    base.reinforcementRequests.push(request);
    if (base.reinforcementRequests.length > 30) base.reinforcementRequests.splice(0, base.reinforcementRequests.length - 30);
    const result = { ok: true, requestId: request.id, expiresAt: request.expiresAt };
    this._recordAction(base.actionRecords, actionId, result, `reinforcement-request:${identityId}:${role}:${count}`);
    this.save();
    return result;
  }

  donateReinforcements(identityId, requestId, count, actionId = this.newActionId('reinforcement-donation')) {
    const entry = this.community(identityId);
    if (!entry) return { ok: false, error: 'Choose a connected preview member.' };
    if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 160) return { ok: false, error: 'A unique donation action is required.' };
    const prior = this._findAction(entry.saved.base.actionRecords, actionId);
    if (prior) return prior.kind === `reinforcement-donation:${identityId}:${requestId}:${count}`
      ? { ...clone(prior.result), replay: true } : { ok: false, error: 'This action ID was already used.' };
    const accessError = this._accessError(identityId);
    if (accessError) return { ok: false, error: accessError };
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_REINFORCEMENTS_PER_REQUEST) return { ok: false, error: 'Donate a whole troop count within the request limit.' };
    const request = entry.saved.base.reinforcementRequests.find(item => item.id === requestId);
    if (!request || request.expiresAt <= this.now() || request.donated >= request.count) return { ok: false, error: 'This reinforcement request is closed or expired.' };
    if (request.identityId === identityId) return { ok: false, error: 'Members cannot donate to their own request.' };
    if (count > request.count - request.donated) return { ok: false, error: 'That exceeds the remaining requested troops.' };
    if (this._accessError(request.identityId)) return { ok: false, error: 'The receiving member is no longer eligible.' };
    this._settleTraining(identityId);
    const recipientReadiness = this.getTrainingReadiness(request.identityId);
    if (recipientReadiness.occupied + count > recipientReadiness.reserveCapacity) return { ok: false, error: 'The receiving camp has no room for this donation.' };
    const donor = this.member(identityId);
    if (donor.trainingReserve[request.role] < count) return { ok: false, error: 'Train the requested troops before donating them.' };
    donor.trainingReserve[request.role] -= count;
    this.member(request.identityId).trainingReserve[request.role] += count;
    request.donated += count;
    const result = { ok: true, requestId, role: request.role, count, recipientId: request.identityId, remaining: request.count - request.donated };
    this._recordAction(entry.saved.base.actionRecords, actionId, result, `reinforcement-donation:${identityId}:${requestId}:${count}`);
    this.save();
    return result;
  }

  trainTroops(identityId, role, count, actionId = this.newActionId('training')) {
    const access = this.getAccess(identityId);
    if (!access.allowed) return { ok: false, error: access.reason };
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!TRAINING_ROLES.includes(role) || !squadUnlocked(role, entry.saved.base.levels)) return { ok: false, error: 'This troop is not unlocked.' };
    if (!Number.isSafeInteger(count) || count < 1 || count > trainingCapacity(entry.saved.base.levels)) return { ok: false, error: 'Choose a whole troop count within camp capacity.' };
    if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 160) return { ok: false, error: 'A unique training action is required.' };
    const prior = this._findAction(member.actionRecords, actionId);
    if (prior) return prior.kind === `train-${role}-${count}` ? { ...clone(prior.result), replay: true } : { ok: false, error: 'This action ID was already used.' };
    const readiness = this.getTrainingReadiness(identityId);
    if (readiness.occupied + count > readiness.reserveCapacity) return { ok: false, error: `Camp holds ${readiness.reserveCapacity} ready or training troops.` };
    const cost = TRAINING_COSTS[role] * count;
    if (member.parts < cost) return { ok: false, error: `Need ${cost} personal Parts to train ${count} ${SQUAD_ROLES[role].name}.` };
    const lastFinish = member.trainingJobs.at(-1)?.finishAt || 0;
    const finishAt = Math.max(this.now(), lastFinish) + TRAINING_SECONDS[role] * count * 1000;
    member.parts -= cost;
    member.trainingJobs.push({ id: actionId, role, count, finishAt });
    const result = { ok: true, role, count, cost, finishAt };
    this._recordAction(member.actionRecords, actionId, result, `train-${role}-${count}`);
    this.save();
    return result;
  }

  setTrainingLoadout(identityId, counts) {
    const access = this.getAccess(identityId);
    if (!access.allowed) return { ok: false, error: access.reason };
    const entry = this.community(identityId);
    const levels = entry.saved.base.levels;
    if (!validTrainingLoadout(counts, levels)) return { ok: false, error: `Select 1–${trainingCapacity(levels)} unlocked troops with whole-number counts.` };
    const loadout = normalizedTrainingLoadout(counts, levels);
    this.member(identityId).trainingLoadout = loadout;
    this.save();
    return { ok: true, counts: clone(loadout), capacity: trainingCapacity(levels) };
  }

  recordTrainingVictory(identityId, raidId, reward) {
    const entry = this.community(identityId);
    const member = this.member(identityId);
    if (!entry || !member || !this.getAccess(identityId).allowed) return { ok: false, error: 'Training reward is locked.' };
    const base = entry.saved.base;
    const id = safeInt(raidId);
    if (id <= base.lastRaidClaimed) return { ok: false, error: 'This training reward was already claimed.' };
    if (id > base.raidCount) return { ok: false, error: 'This training encounter was not recorded.' };
    base.lastRaidClaimed = id;
    base.raidCount = Math.max(base.raidCount, id);
    member.parts += safeInt(reward);
    this._completeFieldOrder(member, 'drill');
    this.save();
    return { ok: true, reward: safeInt(reward) };
  }

  processLegacyJobs(identityId = this.state.currentIdentityId) {
    const entry = this.community(identityId);
    if (!entry) return [];
    const base = entry.saved.base;
    const now = this.now();
    const completed = [];
    const pending = [];
    for (const job of base.legacyJobs) {
      if (job.end > now) { pending.push(job); continue; }
      if (base.completedLegacyJobIds.includes(job.id)) continue;
      if (base.levels[job.key] < job.targetLevel) base.levels[job.key] = job.targetLevel;
      base.completedLegacyJobIds.push(job.id);
      completed.push(job.key);
    }
    if (completed.length || pending.length !== base.legacyJobs.length) {
      base.legacyJobs = pending;
      this.save();
    }
    return completed;
  }

  recordTrainingAttempt(raidId, identityId = this.state.currentIdentityId) {
    const entry = this.community(identityId);
    if (!entry || !this.getAccess(identityId).allowed) return { ok: false, error: 'Training access is locked.' };
    const id = safeInt(raidId);
    if (id < 1) return { ok: false, error: 'Invalid training encounter.' };
    const base = entry.saved.base;
    const actionKey = `training-attempt:${id}`;
    const prior = this._findAction(base.actionRecords, actionKey);
    if (prior) return prior.kind === `training-attempt-${identityId}` ? { ...clone(prior.result), replay: true } : { ok: false, error: 'This encounter belongs to another member.' };
    if (id !== base.raidCount + 1) return { ok: false, error: 'Prepare the next training encounter.' };
    const readiness = this.getTrainingReadiness(identityId);
    if (!readiness.ready) return { ok: false, error: 'Train the missing troops before launching the drill.' };
    const member = this.member(identityId);
    for (const role of TRAINING_ROLES) member.trainingReserve[role] -= readiness.counts[role];
    base.raidCount = id;
    const result = { ok: true, raidId: id, counts: clone(readiness.counts) };
    this._recordAction(base.actionRecords, actionKey, result, `training-attempt-${identityId}`);
    this.save();
    return result;
  }
}
