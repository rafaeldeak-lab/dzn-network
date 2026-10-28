// Canonical uploaded building artwork. Paths are verified against the project asset inventory.
// Yaw corrections are SHA-reviewed degrees, applied before bounds normalization.
export const BUILDING_ASSETS = Object.freeze({
  depot: Object.freeze({
    footprint: 5.8,
    levels: Object.freeze([1, 2, 3, 4, 5].map(level => Object.freeze({
      glb: null, yawDegrees: 0,
      png: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" rx="14" fill="#14201d"/><path d="M20 91l60 23 60-23V42L80 18 20 42z" fill="#202b2b" stroke="#8c51bd" stroke-width="4"/><path d="M20 42l60 25 60-25M80 67v47" fill="none" stroke="#7dbd59" stroke-width="3"/><ellipse cx="80" cy="46" rx="29" ry="15" fill="#434c4a" stroke="#d3e5b9" stroke-width="4"/><text x="80" y="53" fill="#b5f96b" font-size="16" font-weight="bold" text-anchor="middle">DZN</text><text x="131" y="105" fill="#bfe8a8" font-size="14" font-weight="bold" text-anchor="end">L${level}</text></svg>`)}`,
    }))),
  }),
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

export const BUILDING_FAMILY_FOR_KEY = Object.freeze({ hq: 'hq', workshop: 'workshop', tower: 'tower', comms: 'comms', depot: 'depot' });

export function getBuildingAsset(key, level) {
  const family = BUILDING_ASSETS[BUILDING_FAMILY_FOR_KEY[key]];
  const boundedLevel = Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));
  return family ? { family, ...family.levels[boundedLevel - 1], level: boundedLevel } : null;
}
