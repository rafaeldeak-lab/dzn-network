// Cosmetic 3D concept previews. Defence slots, research and battle effects are
// intentionally separate from the existing five-role combat system.
export const DEFENDER_CONCEPTS = Object.freeze({
  guardian: { name: 'DZN Guardian', role: 'Gate barrier', detail: 'Armoured shield specialist for entrances and choke points.' },
  aegis: { name: 'DZN Aegis', role: 'Interceptor control', detail: 'Protective operator with two hovering interceptor drones.' },
  trapper: { name: 'DZN Trapper', role: 'Perimeter snares', detail: 'Engineer carrying three deployable snare modules.' },
  hound: { name: 'DZN Hound', role: 'Robotic patrol', detail: 'Four-legged tracker built for perimeter response.' },
});
const level = value => Math.max(1, Math.min(5, Math.floor(Number(value) || 1)));
export const defenderAsset = (key, tier) => DEFENDER_CONCEPTS[key] ? `assets/models/defenders/${key}_l0${level(tier)}.glb` : null;
export const defenderPortrait = key => DEFENDER_CONCEPTS[key] ? `assets/portraits/defenders/${key}.png` : null;
