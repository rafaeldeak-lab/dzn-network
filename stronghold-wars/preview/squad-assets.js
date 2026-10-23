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
export function squadBattleStats(levels = {}, tactic = 'assault') {
  const lead = squadProfile(tactic === 'recon' ? 'recon' : 'assault', levels);
  const sentinel = squadProfile('sentinel', levels);
  const medic = squadProfile('medic', levels);
  const reinforcement = tactic === 'assault' && sentinel.unlocked ? sentinel : null;
  const support = medic.unlocked ? medic : null;
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

export function squadAsset(key, tier) {
  return SQUAD_ROLES[key] ? `assets/models/squads-v3/${key}_l0${boundedLevel(tier)}.glb` : null;
}

export function squadPortrait(key, tier) {
  return SQUAD_ROLES[key] ? `assets/portraits/squads-final/${key}_l0${boundedLevel(tier)}.png` : null;
}
