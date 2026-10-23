// Original 3D appearance tiers and deterministic local-preview defence rules.
// None of these values confer live DZN access or affect production competition.
export const DEFENDER_CONCEPTS = Object.freeze({
  guardian: { name: 'DZN Guardian', role: 'Gate barrier', detail: 'Armoured shield specialist for entrances and choke points.', hall: 2, support: 'tower', supportLevel: 2, ability: 'Assault barrier · -2 attack points per tier' },
  aegis: { name: 'DZN Aegis', role: 'Interceptor control', detail: 'Protective operator with two hovering interceptor drones.', hall: 3, support: 'comms', supportLevel: 2, ability: 'Signal interception · -2 Recon points per tier' },
  trapper: { name: 'DZN Trapper', role: 'Perimeter snares', detail: 'Engineer carrying three deployable snare modules.', hall: 2, support: 'workshop', supportLevel: 2, ability: 'Snare field · -1 attack point per tier' },
  hound: { name: 'DZN Hound', role: 'Robotic patrol', detail: 'Four-legged tracker built for perimeter response.', hall: 3, support: 'workshop', supportLevel: 3, ability: 'Home tracking · reduces away-squad exposure bonus' },
});
export const DEFENDER_POSTS = Object.freeze({ gate: 'South gate', hall: 'Command Hall', tower: 'Arc Battery', comms: 'Communications', workshop: 'Workshop / Forge' });
export const DEFENDER_COSTS = Object.freeze([0, 180, 350, 600, 900, 1300]);
export function defenderBattleEffect(defenders, tactic) {
  const tier = role => {
    const entry = defenders?.[role];
    return entry && DEFENDER_POSTS[entry.post] ? Math.max(0, Math.min(5, Math.floor(Number(entry.level) || 0))) : 0;
  };
  const guardian = tier('guardian'), aegis = tier('aegis'), trapper = tier('trapper'), hound = tier('hound');
  return { scorePenalty: Math.min(18, trapper + (tactic === 'assault' ? guardian * 2 : aegis * 2) + (hound >= 3 ? 1 : 0)),
    exposureShield: hound, casualtyPressure: hound >= 3 ? 1 : 0 };
}
const level = value => Math.max(1, Math.min(5, Math.floor(Number(value) || 1)));
export const defenderAsset = (key, tier) => DEFENDER_CONCEPTS[key] ? `assets/models/defenders/${key}_l0${level(tier)}.glb` : null;
export const defenderPortrait = key => DEFENDER_CONCEPTS[key] ? `assets/portraits/defenders/${key}.png` : null;
