/*
 * Replaceable local-preview service boundary for DZN Stronghold Wars.
 * This module owns entitlement/role checks, shared community state, personal
 * inventories, idempotent actions, progression, and Forge persistence. It is
 * intentionally local-only; it is not an authentication or security boundary.
 */
export const SERVICE_STORAGE_KEY = 'dzn-stronghold-save-v3';
export const V2_STORAGE_KEY = 'dzn-stronghold-save-v2';
export const V2_BACKUP_KEY = 'dzn-stronghold-save-v2-backup';
export const LEGACY_STORAGE_KEY = 'dzn-stronghold-save-v1';
export const LEGACY_BACKUP_KEY = 'dzn-stronghold-save-v1-backup';
export const CORRUPT_BACKUP_PREFIX = `${SERVICE_STORAGE_KEY}-corrupt-backup-v1-`;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const WAR_RULES = Object.freeze({
  challengeLifetimeMs: 24 * 60 * 60 * 1000,
  preparationReadyMs: 30 * 1000,
  preparationWindowMs: 5 * 60 * 1000,
  attackWindowMs: 10 * 60 * 1000,
  maxAttacksPerSide: 2,
  localRewardParts: 40,
});

export const GAME_CONFIG = Object.freeze({
  maxLevel: 5,
  revealSeconds: 2.5,
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
    'timberline-depot': Object.freeze({ name: 'Timberline Lumber Yard', model: 'timberline', purpose: 'Daily personal Timber resupply', costs: Object.freeze([[0, 0], [100, 30], [250, 60], [500, 90], [900, 120], [1500, 150]]) }),
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
      name: 'Watchtower', kind: 'support', costs: Object.freeze([0, 250, 700, 1600, 3200]),
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
  Object.freeze({ id: 'iron-pines', name: 'Iron Pines Collective', eligible: true, proActive: true, members: Object.freeze(['iron-owner', 'iron-admin', 'iron-member', 'iron-unverified']) }),
  Object.freeze({ id: 'violet-ridge', name: 'Violet Ridge Syndicate', eligible: true, proActive: true, members: Object.freeze(['violet-owner', 'violet-admin', 'violet-member']) }),
  Object.freeze({ id: 'mossback-free', name: 'Mossback Free Community', eligible: false, proActive: false, members: Object.freeze(['free-owner', 'free-member']) }),
]);

const SUPPORT_KEYS = Object.freeze(['workshop', 'tower', 'comms']);
const nowDefault = () => Date.now();
const safeInt = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
};
const clone = value => JSON.parse(JSON.stringify(value));

function emptyBase(treasury = 200) {
  return {
    levels: { hq: 1, workshop: 1, tower: 1, comms: 1 },
    treasury: safeInt(treasury), projects: [], nextProjectNumber: 1,
    completedProjectIds: [], actionRecords: [], raidCount: 0, lastRaidClaimed: 0,
    legacyJobs: [], completedLegacyJobIds: [],
    landPlots: GAME_CONFIG.landPlots.map(plot => ({
      id: plot.id, treesRemaining: plot.trees, status: plot.hall === 1 ? 'claimed' : 'wild',
      timberFunded: 0, barricades: 0, facilityLevel: 0, facilityProject: null, routeLevel: 0, routeProject: null,
    })),
  };
}

function emptyMember() {
  return { parts: 600, stored: 0, salvage: 150, timber: 0, nextClaimAt: 0, nextTimberClaimAt: 0, lifetimeContributed: 0, forgeJobs: [], actionRecords: [], muted: false };
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
    warActionRecords: [],
    warRewardLedger: [],
    nextWarNumber: 1,
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
    const fortification = landPlots.reduce((total, plot) => total + (plot.status === 'claimed' ? plot.barricades : 0), 0);
    const facility = Object.fromEntries(landPlots.map(plot => [plot.id, plot.facilityLevel]));
    return {
      communityId: source?.communityId,
      name: String(source?.name || source?.communityId || 'Community'),
      capturedAt: safeInt(source?.capturedAt),
      base: { levels, treasury: safeInt(source?.base?.treasury), landPlots },
      stats: { squadSize: 2 + hq * 2, wallTier: hq, firepower: levels.tower * 25, commsSignal: levels.comms * 20, workshopOutput: levels.workshop * 2, fortification,
        assaultBonus: facility['ridgewatch-range'] * 2, reconBonus: facility['signal-marsh'] * 2, worksDefence: facility['highland-works'] * 2 },
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
  const attacks = Array.isArray(war.attacks) ? war.attacks.filter(a => a && typeof a.attackId === 'string' && communities.includes(a.communityId)).map(a => ({
    attackId: a.attackId, actionId: String(a.actionId || ''), identityId: String(a.identityId || ''), communityId: a.communityId,
    tactic: a.tactic === 'recon' ? 'recon' : 'assault', at: safeInt(a.at), score: safeInt(a.score), casualties: safeInt(a.casualties), feedback: String(a.feedback || ''),
  })) : [];
  const score = Object.fromEntries(communities.map(id => [id, safeInt(war.score?.[id])]));
  return {
    id: war.id, challengerCommunityId: war.challengerCommunityId, defenderCommunityId: war.defenderCommunityId,
    challengerIdentityId: String(war.challengerIdentityId || ''), state,
    createdAt: safeInt(war.createdAt), challengeExpiresAt: safeInt(war.challengeExpiresAt), acceptedBy: String(war.acceptedBy || ''),
    acceptedAt: safeInt(war.acceptedAt), prepReadyAt: safeInt(war.prepReadyAt), prepDeadlineAt: safeInt(war.prepDeadlineAt),
    startedBy: String(war.startedBy || ''), startedAt: safeInt(war.startedAt), attackEndsAt: safeInt(war.attackEndsAt),
    resolvedAt: safeInt(war.resolvedAt), declinedAt: safeInt(war.declinedAt), expiredAt: safeInt(war.expiredAt),
    snapshots, roster, attacks, attackIds: [...new Set(attacks.map(a => a.attackId))], score,
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
    normalized.projects = Array.isArray(base.projects) ? base.projects.filter(p => p && typeof p.id === 'string' && GAME_CONFIG.buildings[p.key]).map(p => ({
      id: p.id, key: p.key, targetLevel: normalizeLevel(p.targetLevel, 1), targetAmount: safeInt(p.targetAmount),
      funded: Math.min(safeInt(p.funded), safeInt(p.targetAmount)), benefit: String(p.benefit || ''),
      prerequisites: Array.isArray(p.prerequisites) ? p.prerequisites.map(String) : [],
      status: p.status === 'completed' ? 'completed' : 'approved', pinned: Boolean(p.pinned),
      createdAt: safeInt(p.createdAt), completedAt: safeInt(p.completedAt),
      donors: Array.isArray(p.donors) ? p.donors.slice(-8).map(d => ({ identityId: String(d.identityId || ''), name: String(d.name || 'Member'), amount: safeInt(d.amount), at: safeInt(d.at) })) : [],
    })) : [];
    normalized.nextProjectNumber = Math.max(1, safeInt(base.nextProjectNumber, 1));
    normalized.completedProjectIds = Array.isArray(base.completedProjectIds) ? [...new Set(base.completedProjectIds.filter(v => typeof v === 'string'))] : [];
    normalized.actionRecords = Array.isArray(base.actionRecords) ? base.actionRecords.filter(r => r && typeof r.id === 'string').slice(-500) : [];
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
    normalized.legacyJobs = Array.isArray(base.legacyJobs) ? base.legacyJobs.filter(j => j && typeof j.id === 'string' && GAME_CONFIG.buildings[j.key] && Number.isFinite(Number(j.end))).map(j => ({ id: j.id, key: j.key, targetLevel: normalizeLevel(j.targetLevel, 1), end: Number(j.end), migratedPaid: true })) : [];
    fresh.communities[community.id] = { proActive: community.eligible ? Boolean(savedCommunity.proActive) : false, base: normalized };
  }
  for (const profile of PREVIEW_IDENTITIES) {
    const saved = raw.members?.[profile.id];
    if (!saved) continue;
    fresh.members[profile.id] = {
      parts: safeInt(saved.parts), stored: Number.isFinite(Number(saved.stored)) ? Math.max(0, Number(saved.stored)) : 0,
      salvage: safeInt(saved.salvage), nextClaimAt: safeInt(saved.nextClaimAt), nextTimberClaimAt: safeInt(saved.nextTimberClaimAt),
      timber: safeInt(saved.timber),
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
      muted: Boolean(saved.muted),
    };
  }
  fresh.wars = Array.isArray(raw.wars) ? raw.wars.map(normalizeWarRecord).filter(Boolean) : [];
  fresh.warActionRecords = Array.isArray(raw.warActionRecords) ? raw.warActionRecords.filter(r => r && typeof r.id === 'string' && typeof r.actorId === 'string' && r.result && typeof r.result === 'object').slice(-2000).map(r => ({ id: r.id, actorId: r.actorId, kind: String(r.kind || ''), result: clone(r.result), at: safeInt(r.at) })) : [];
  fresh.warRewardLedger = Array.isArray(raw.warRewardLedger) ? raw.warRewardLedger.filter(r => r && typeof r.id === 'string' && typeof r.identityId === 'string').map(r => ({ id: r.id, warId: String(r.warId || ''), identityId: r.identityId, amount: safeInt(r.amount), at: safeInt(r.at) })) : [];
  fresh.nextWarNumber = Math.max(1, safeInt(raw.nextWarNumber, fresh.wars.length + 1));
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
    const fortification = landPlots.reduce((total, plot) => total + plot.barricades, 0);
    const facility = Object.fromEntries(landPlots.map(plot => [plot.id, plot.facilityLevel]));
    return {
      communityId, name: definition.name, capturedAt: this.now(),
      base: { levels, treasury: safeInt(base.treasury), landPlots },
      stats: { squadSize: 2 + hall * 2, wallTier: hall, firepower: levels.tower * 25, commsSignal: levels.comms * 20, workshopOutput: levels.workshop * 2, fortification,
        assaultBonus: facility['ridgewatch-range'] * 2, reconBonus: facility['signal-marsh'] * 2, worksDefence: facility['highland-works'] * 2 },
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
      attacks: [], attackIds: [], score: { [communityId]: 0, [opponentCommunityId]: 0 },
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
    war.events.push({ type: 'started', at: now, actorId: identityId, text: 'War started. Each side may deploy up to two verified roster members before the attack window closes.', details: { attackEndsAt: war.attackEndsAt, attackCap: WAR_RULES.maxAttacksPerSide } });
    const result = { ok: true, warId, state: war.state, attackEndsAt: war.attackEndsAt };
    this._recordWarAction(identityId, actionId, 'start', result);
    this.save();
    return result;
  }

  submitWarAttack(identityId, warId, tactic, actionId = this.newActionId('war-attack')) {
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
    const attacker = profile.communityId === war.challengerCommunityId ? war.snapshots.challenger : war.snapshots.defender;
    const defender = profile.communityId === war.challengerCommunityId ? war.snapshots.defender : war.snapshots.challenger;
    const a = attacker.base.levels; const d = defender.base.levels;
    const rawScore = tactic === 'assault'
      ? 20 + a.hq * 12 + a.tower * 16 + a.comms * 4 - d.hq * 4 - d.tower * 10 - defender.stats.fortification * 3 + attacker.stats.assaultBonus - defender.stats.worksDefence
      : 15 + a.hq * 7 + a.tower * 3 + a.comms * 18 + a.workshop * 3 - d.comms * 10 - d.tower * 4 - defender.stats.fortification + attacker.stats.reconBonus - defender.stats.worksDefence;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const casualties = Math.max(0, Math.min(attacker.stats.squadSize, Math.round(d.hq + d.tower - Math.floor(a.comms / 2) + (tactic === 'assault' ? 1 : 0))));
    const attackId = `attack-${war.id}-${war.attacks.length + 1}`;
    if (war.attackIds.includes(attackId)) return { ok: false, error: 'Duplicate attack ID rejected.' };
    const feedback = `${defender.name} counterfire from Hall L${d.hq}, Watchtower L${d.tower}, ${defender.stats.fortification} barricades and Defence Works -${defender.stats.worksDefence} withdrew ${casualties}/${attacker.stats.squadSize} troops; ${tactic === 'assault' ? 'the direct push' : 'the signal sweep'} gained +${tactic === 'assault' ? attacker.stats.assaultBonus : attacker.stats.reconBonus} district support and scored ${score}.`;
    const attack = { attackId, actionId, identityId, communityId: profile.communityId, tactic, at: now, score, casualties, feedback };
    war.attacks.push(attack); war.attackIds.push(attackId); war.score[profile.communityId] += score;
    war.events.push({ type: 'attack', at: now, actorId: identityId, text: `${profile.name} deployed ${tactic === 'assault' ? 'Assault' : 'Recon'} · ${score} points · ${casualties} squad losses.`, details: clone(attack) });
    const result = { ok: true, warId, attackId, tactic, score, casualties, feedback, totalScore: war.score[profile.communityId], attacksRemaining: WAR_RULES.maxAttacksPerSide - sideAttacks.length - 1 };
    this._recordWarAction(identityId, actionId, 'attack', result);
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
    if (this.now() < war.attackEndsAt && (challengerCount < WAR_RULES.maxAttacksPerSide || defenderCount < WAR_RULES.maxAttacksPerSide)) return { ok: false, error: 'Resolve when both attack caps are reached or after the attack window ends.' };
    const now = this.now();
    const challengerScore = war.score[war.challengerCommunityId];
    const defenderScore = war.score[war.defenderCommunityId];
    war.tie = challengerScore === defenderScore;
    war.winnerCommunityId = war.tie ? null : challengerScore > defenderScore ? war.challengerCommunityId : war.defenderCommunityId;
    war.state = 'resolved'; war.resolvedAt = now;
    const rewards = [];
    for (const identity of [...new Set(war.attacks.map(attack => attack.identityId))]) {
      const ledgerId = `war-reward:${war.id}:${identity}`;
      if (this.state.warRewardLedger.some(entry => entry.id === ledgerId)) continue;
      const member = this.member(identity);
      if (!member) continue;
      member.parts += WAR_RULES.localRewardParts;
      this.state.warRewardLedger.push({ id: ledgerId, warId: war.id, identityId: identity, amount: WAR_RULES.localRewardParts, at: now });
      war.rewardLedgerIds.push(ledgerId);
      rewards.push({ identityId: identity, amount: WAR_RULES.localRewardParts, ledgerId });
    }
    war.replay = { version: 1, attackIds: [...war.attackIds], attacks: clone(war.attacks), score: clone(war.score), winnerCommunityId: war.winnerCommunityId, tie: war.tie };
    const resultText = war.tie ? 'War resolved as a tie.' : `${COMMUNITIES.find(item => item.id === war.winnerCommunityId).name} won ${Math.max(challengerScore, defenderScore)}–${Math.min(challengerScore, defenderScore)}.`;
    war.events.push({ type: 'resolved', at: now, actorId: identityId, text: resultText, details: { score: clone(war.score), winnerCommunityId: war.winnerCommunityId, tie: war.tie, rewards: clone(rewards) } });
    const result = { ok: true, warId, state: war.state, winnerCommunityId: war.winnerCommunityId, tie: war.tie, score: clone(war.score), rewards };
    this._recordWarAction(identityId, actionId, 'resolve', result);
    this.save();
    return result;
  }

  selectIdentity(identityId) {
    if (!this.profile(identityId)) return { ok: false, error: 'Unknown preview identity.' };
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
    if (base.projects.some(project => project.key === key && project.status === 'approved')) prerequisites.push('A project for this building is already approved.');
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
    if (plot.timberFunded === config.timberCost) plot.status = 'claimed';
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
    if (completed) { plot.facilityLevel = targetLevel; plot.facilityProject = null; }
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
    if (completed) { plot.routeLevel = targetLevel; plot.routeProject = null; }
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

  _completeProject(entry, project) {
    const base = entry.saved.base;
    if (base.completedProjectIds.includes(project.id)) return false;
    if (base.levels[project.key] !== project.targetLevel - 1) {
      project.status = 'blocked';
      project.pinned = false;
      return false;
    }
    base.levels[project.key] = project.targetLevel;
    project.status = 'completed';
    project.completedAt = this.now();
    project.pinned = false;
    base.completedProjectIds.push(project.id);
    return true;
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
    const completed = project.funded >= project.targetAmount ? this._completeProject(entry, project) : false;
    const result = { ok: true, accepted, remaining: Math.max(0, project.targetAmount - project.funded), completed, projectId };
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
    const completed = project.funded >= project.targetAmount ? this._completeProject(entry, project) : false;
    const result = { ok: true, accepted, remaining: Math.max(0, project.targetAmount - project.funded), completed, projectId };
    this._recordAction(base.actionRecords, actionId, result, 'treasury-allocation');
    this.save();
    return result;
  }

  collectParts(identityId = this.state.currentIdentityId) {
    const accessError = this._accessError(identityId);
    const member = this.member(identityId);
    if (accessError) return { ok: false, error: accessError };
    if (!member) return { ok: false, error: 'Member inventory unavailable.' };
    const amount = Math.floor(member.stored);
    if (!Number.isSafeInteger(amount) || amount < 1) return { ok: false, error: 'No whole Parts are ready to collect yet.' };
    member.parts += amount;
    member.stored -= amount;
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

  recordTrainingAttempt(raidId) {
    const entry = this.community();
    if (!entry || !this.getAccess().allowed) return { ok: false, error: 'Training access is locked.' };
    const id = safeInt(raidId);
    if (id < 1) return { ok: false, error: 'Invalid training encounter.' };
    entry.saved.base.raidCount = Math.max(entry.saved.base.raidCount, id);
    this.save();
    return { ok: true, raidId: id };
  }
}
