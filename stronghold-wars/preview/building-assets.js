// Canonical uploaded building artwork. Paths are verified against the project asset inventory.
// Yaw corrections are SHA-reviewed degrees, applied before bounds normalization.
export const BUILDING_ASSETS = Object.freeze({
  hq: Object.freeze({
    footprint: 7.2,
    levels: Object.freeze([
      { glb: 'assets/models/hq_l01.glb', png: 'assets/hq_l01.png', yawDegrees: 90 },
      { glb: 'assets/models/hq_l02.glb', png: 'assets/hq_l02.png', yawDegrees: 90 },
      { glb: 'assets/models/hq_l03.glb', png: 'assets/hq_l03.png', yawDegrees: -90 },
      { glb: 'assets/models/hq_l04.glb', png: 'assets/hq_l04.png', yawDegrees: 0 },
      { glb: 'assets/models/hq_l05.glb', png: 'assets/hq_l05.png', yawDegrees: -90 },
    ]),
  }),
  workshop: Object.freeze({
    family: 'forge',
    footprint: 6.8,
    levels: Object.freeze([
      { glb: 'assets/models/forge_l01.glb', png: 'assets/forge_l01.png', yawDegrees: 0 },
      { glb: 'assets/models/forge_l02.glb', png: 'assets/forge_l02.png', yawDegrees: 0 },
      { glb: 'assets/models/forge_l03.glb', png: 'assets/forge_l03.png', yawDegrees: -90 },
      { glb: 'assets/models/forge_l04.glb', png: 'assets/forge_l04.png', yawDegrees: 0 },
      { glb: 'assets/models/forge_l05.glb', png: 'assets/forge_l05.png', yawDegrees: -90 },
    ]),
  }),
  tower: Object.freeze({
    family: 'arc-battery',
    footprint: 4.8,
    levels: Object.freeze([
      { glb: 'assets/models/defense-towers/one-complete-static-textured-3d-game-asset-dzn-arc-battery-defence-tower-level-1.glb', png: 'assets/watchtower_l01.png', yawDegrees: 0 },
      { glb: 'assets/models/defense-towers/dzn-arc-battery-defence-tower-level-2-one-complete-static-textured-3d-game-asset.glb', png: 'assets/watchtower_l02.png', yawDegrees: 0 },
      { glb: 'assets/models/defense-towers/dzn-arc-battery-defence-tower-level-3-a-single-complete-textured-3d-game-asset-e.glb', png: 'assets/watchtower_l03.png', yawDegrees: 0 },
      { glb: 'assets/models/defense-towers/dzn-arc-battery-defence-tower-level-4-one-complete-high-detail-textured-3d-game.glb', png: 'assets/watchtower_l04.png', yawDegrees: 0 },
      { glb: 'assets/models/defense-towers/dzn-arc-battery-level-5-elite-defence-tower-single-finished-realistic-textured-3.glb', png: 'assets/watchtower_l05.png', yawDegrees: 0 },
    ]),
  }),
  comms: Object.freeze({
    footprint: 5.4,
    levels: Object.freeze([
      { glb: 'assets/models/comms_l01.glb', png: 'assets/comms_l01.png', yawDegrees: 0 },
      { glb: 'assets/models/comms_l02.glb', png: 'assets/comms_l02.png', yawDegrees: 0 },
      { glb: 'assets/models/comms_l03.glb', png: 'assets/comms_l03.png', yawDegrees: 0 },
      { glb: 'assets/models/comms_l04.glb', png: 'assets/comms_l04.png', yawDegrees: 0 },
      { glb: 'assets/models/comms_l05.glb', png: 'assets/comms_l05.png', yawDegrees: 0 },
    ]),
  }),
});

export const BUILDING_FAMILY_FOR_KEY = Object.freeze({ hq: 'hq', workshop: 'workshop', tower: 'tower', comms: 'comms' });

export function getBuildingAsset(key, level) {
  const family = BUILDING_ASSETS[BUILDING_FAMILY_FOR_KEY[key]];
  const boundedLevel = Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));
  return family ? { family, ...family.levels[boundedLevel - 1], level: boundedLevel } : null;
}
