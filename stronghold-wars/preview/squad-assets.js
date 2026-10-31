// Original DZN squad kit and local-preview combat tuning. Server authority must replace this module for live play.
const role = (name, purpose, source, kit, emblem, unlockHall, unlockSource, equipment, health, damage, armour, ability) => Object.freeze({
  name, purpose, source, kit, emblem, unlockHall, unlockSource,
  equipment: Object.freeze(equipment), health: Object.freeze(health), damage: Object.freeze(damage), armour: Object.freeze(armour), ability: Object.freeze(ability),
});

export const SQUAD_ROLES = Object.freeze({
  assault: role('DZN Warden', 'Direct assault', 'tower', 'Carbine · layered armour · shield', '◈', 1, 1,
    ['Field carbine', 'Shoulder armour', 'Knee plates and spare magazine', 'Forearm shield', 'Illuminated shield rank'],
    [100, 120, 145, 175, 210], [20, 24, 29, 35, 42], [3, 7, 10, 14, 19], ['Opening push', 'Cover advance', 'Breach drill', 'Shield rush', 'Last stand']),
  recon: role('DZN Ghost', 'Scout and signal sweep', 'comms', 'Optic visor · scanner · signal mast', '◇', 1, 1,
    ['Optic visor and scanner', 'Hood and utility armour', 'Longer signal mast', 'Wide optic array', 'Elite signal markers'],
    [80, 95, 115, 138, 165], [14, 17, 21, 26, 32], [2, 4, 7, 10, 14], ['Pathfinder', 'Signal trace', 'Sweep', 'Silent approach', 'Ghost relay']),
  engineer: role('DZN Fixer', 'Construction patrol', 'workshop', 'Field tools · repair pack · timber axe', '✦', 1, 1,
    ['Field tools and axe', 'Repair canister', 'Reinforced knees', 'Welding guard', 'Elite work lights'],
    [90, 108, 130, 155, 185], [12, 15, 18, 22, 27], [2, 5, 8, 12, 16], ['Field patch', 'Quick fix', 'Barricade craft', 'Emergency weld', 'Master rebuild']),
  sentinel: role('DZN Sentinel', 'Heavy tactical assault', 'tower', 'Black armour · green optics · heavy carbine', '◆', 4, 3,
    ['Night optics and black uniform', 'Broad shoulder guards', 'Drum magazine and limb protection', 'Purple rank armour', 'Elite optic and reinforced plating'],
    [145, 175, 210, 250, 300], [26, 31, 37, 44, 52], [8, 12, 17, 23, 30], ['Suppress', 'Hold line', 'Armoured breach', 'Bulwark', 'Iron curtain']),
  medic: role('DZN Lifeline', 'Field support and recovery', 'workshop', 'Medical pack · aid injector · support beacon', '✚', 4, 3,
    ['Aid pack and injector', 'Reinforced medical vest', 'Triage satchel', 'Purple field rank', 'Elite recovery beacon'],
    [85, 103, 125, 150, 180], [8, 10, 12, 15, 19], [2, 4, 7, 10, 14], ['First aid', 'Field bandage', 'Triage', 'Rapid recovery', 'Guardian pulse']),
});

const boundedLevel = value => Math.max(1, Math.min(5, Math.floor(Number(value) || 1)));

export function squadTier(key, levels = {}) {
  const unit = SQUAD_ROLES[key];
  return unit ? Math.min(boundedLevel(levels.hq), boundedLevel(levels[unit.source])) : 1;
}

export function squadUnlocked(key, levels = {}) {
  const unit = SQUAD_ROLES[key];
  return Boolean(unit && boundedLevel(levels.hq) >= unit.unlockHall && boundedLevel(levels[unit.source]) >= unit.unlockSource);
}

export function squadProfile(key, levels = {}) {
  const unit = SQUAD_ROLES[key];
  if (!unit) return null;
  const tier = squadTier(key, levels);
  const index = tier - 1;
  return Object.freeze({ role: key, name: unit.name, tier, unlocked: squadUnlocked(key, levels),
    maxHealth: unit.health[index], damage: unit.damage[index], armour: unit.armour[index],
    ability: unit.ability[index], weaponAndOutfit: unit.equipment[index] });
}

// Frozen into each local war snapshot. Damage helps scoring; health, armour and medic support reduce losses.
export function squadBattleStats(levels = {}, tactic = 'assault', selectedCounts = null) {
  const lead = squadProfile(tactic === 'recon' ? 'recon' : 'assault', levels);
  const sentinel = squadProfile('sentinel', levels);
  const medic = squadProfile('medic', levels);
  const reinforcement = tactic === 'assault' && sentinel.unlocked && (selectedCounts === null || selectedCounts.sentinel > 0) ? sentinel : null;
  const support = medic.unlocked && (selectedCounts === null || selectedCounts.medic > 0) ? medic : null;
  const scoreBonus = Math.floor(Math.max(0, lead.damage - (tactic === 'recon' ? 20 : 24)) / 6)
    + (reinforcement ? Math.ceil(reinforcement.damage / 12) : 0);
  const casualtyShield = Math.floor(Math.max(0, lead.maxHealth + lead.armour * 5 - 160) / 50)
    + (reinforcement ? Math.floor((reinforcement.maxHealth + reinforcement.armour * 5) / 160) : 0)
    + (support ? Math.ceil(support.tier / 2) : 0);
  return Object.freeze({ leadRole: lead.role, leadTier: lead.tier, leadHealth: lead.maxHealth,
    leadDamage: lead.damage, leadArmour: lead.armour, ability: lead.ability,
    reinforcementRole: reinforcement?.role || '', reinforcementTier: reinforcement?.tier || 0,
    supportRole: support?.role || '', supportTier: support?.tier || 0, scoreBonus, casualtyShield });
}

// A war army uses every slot in its accepted, frozen Hall snapshot. Only the
// selected roster is deployed; each specialist has a bounded tactical tradeoff.
export function evaluateWarSquad(levels = {}, tactic = 'assault', input, capacity, tactics = null) {
  if (!['assault', 'recon'].includes(tactic) || !input || typeof input !== 'object' || Array.isArray(input)
    || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 12
    || Object.keys(input).some(key => !SQUAD_ROLES[key]))
    return { ok: false, error: 'Choose a valid DZN war squad.' };
  const counts = {};
  let total = 0;
  for (const key of Object.keys(SQUAD_ROLES)) {
    const count = input[key] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || count > capacity || (count && !squadUnlocked(key, levels)))
      return { ok: false, error: 'Use whole-number counts of troops unlocked in the accepted war snapshot.' };
    counts[key] = count;
    total += count;
  }
  const leadRole = tactic === 'recon' ? 'recon' : 'assault';
  if (total !== capacity || counts[leadRole] < 1)
    return { ok: false, error: `Fill all ${capacity} squad slots and include at least one ${tactic === 'recon' ? 'Ghost' : 'Warden'} to lead.` };
  const lead = squadProfile(tactic === 'recon' ? 'recon' : 'assault', levels);
  const baselineDurability = lead.maxHealth + lead.armour * 4;
  let damage = 0, durability = 0;
  for (const [key, count] of Object.entries(counts)) {
    const kit = squadProfile(key, levels);
    damage += kit.damage * count;
    durability += (kit.maxHealth + kit.armour * 4) * count;
  }
  const breachAssist = tactics?.plan?.method === 'breach' && tactics.wallCount > 0 ? Math.min(4, counts.engineer * 2) : 0;
  const flankIntel = tactics?.plan?.method === 'flank' ? Math.min(3, counts.recon) : 0;
  const batteryCover = tactics?.plan?.objective === 'tower' ? Math.min(3, counts.sentinel) : 0;
  const scoreDelta = Math.max(-10, Math.min(10, Math.round((damage - lead.damage * capacity) / (capacity * 4)) + breachAssist + flankIntel + batteryCover));
  const casualtyDelta = Math.max(-3, Math.min(3, Math.round((baselineDurability * capacity - durability) / (capacity * 60)) - Math.min(3, counts.medic)));
  return { ok: true, counts, capacity, scoreDelta, casualtyDelta,
    specialties: [breachAssist ? `Fixer breach +${breachAssist}` : '', flankIntel ? `Ghost intel +${flankIntel}` : '', batteryCover ? `Sentinel cover +${batteryCover}` : '', counts.medic ? `Lifeline recovery -${Math.min(3, counts.medic)} losses` : ''].filter(Boolean) };
}

export function squadAsset(key, tier) {
  if (!SQUAD_ROLES[key]) return null;
  if (key === 'assault') return `assets/models/squads-v6/assault_l0${boundedLevel(tier)}.glb`;
  if (key === 'recon') return `assets/models/squads-v7/recon_l0${boundedLevel(tier)}.glb`;
  if (key === 'engineer') return `assets/models/squads-v13/engineer_l0${boundedLevel(tier)}.glb`;
  if (key === 'medic') return `assets/models/squads-v9/medic_l0${boundedLevel(tier)}.glb`;
  if (key === 'sentinel') return `assets/models/squads-v11/sentinel_l0${boundedLevel(tier)}.glb`;
  return `assets/models/squads-v5/${key}_l0${boundedLevel(tier)}.glb`;
}

export function squadPortrait(key, tier) {
  return SQUAD_ROLES[key] ? `assets/portraits/squads-final/${key}_l0${boundedLevel(tier)}.png` : null;
}
