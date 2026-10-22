// Visual-only kit selection. These local model tiers never grant an entitlement or battle score.
export const SQUAD_ROLES = Object.freeze({
  assault: Object.freeze({ name: 'DZN Warden', purpose: 'Direct assault', source: 'tower', kit: 'Carbine · layered armour · shield' }),
  recon: Object.freeze({ name: 'DZN Ghost', purpose: 'Scout and signal sweep', source: 'comms', kit: 'Optic visor · scanner · signal mast' }),
  engineer: Object.freeze({ name: 'DZN Fixer', purpose: 'Construction patrol', source: 'workshop', kit: 'Field tools · repair pack · timber axe' }),
});

export function squadTier(role, levels = {}) {
  const unit = SQUAD_ROLES[role];
  if (!unit) return 1;
  const hall = Math.max(1, Math.min(5, Math.floor(Number(levels.hq) || 1)));
  const specialist = Math.max(1, Math.min(5, Math.floor(Number(levels[unit.source]) || 1)));
  return Math.min(hall, specialist);
}

export function squadAsset(role, tier) {
  if (!SQUAD_ROLES[role]) return null;
  const level = Math.max(1, Math.min(5, Math.floor(Number(tier) || 1)));
  return `assets/models/squads/${role}_l0${level}.glb`;
}

export function squadPortrait(role, tier) {
  return squadAsset(role, tier)?.replace('assets/models/', 'assets/portraits/').replace('.glb', '.png') || null;
}
