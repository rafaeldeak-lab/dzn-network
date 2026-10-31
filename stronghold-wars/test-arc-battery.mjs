import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual browser function without starting the WebGL scene.
const source = readFileSync(new URL('./preview/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function stepArcBattery(');
const end = source.indexOf('\nfunction clearArcSplitGeometry(', start);
assert(start >= 0 && end > start, 'Arc Battery motion function must remain testable');

let reducedMotion = false;
const stepArcBattery = runInNewContext(`(${source.slice(start, end)})`, {
  window: { matchMedia: () => ({ matches: reducedMotion }) },
  THREE: {
    MathUtils: {
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      damp: (value, target, speed, dt) => value + (target - value) * Math.min(1, speed * dt),
    },
  },
});

function rig() {
  const muzzles = Array.from({ length: 2 }, () => ({
    node: {},
    flash: { material: { opacity: 0 }, scale: { setScalar(value) { this.value = value; } } },
    light: { intensity: 0 },
  }));
  return {
    yaw: { rotation: { y: 0 }, position: { x: 0, y: 1, z: 0 }, parent: { worldToLocal: point => point } },
    elevation: { rotation: { x: 0 }, position: { y: 0.15 } },
    recoil: { position: { z: 0 } },
    muzzles,
    muzzle: muzzles[1].node,
    barrelIndex: 1,
    flashAmount: 0,
  };
}

const target = { x: 1, y: 2.3, z: 3, clone() { return { ...this }; } };
const moving = rig();
assert.equal(stepArcBattery(moving, 0.1, 1, target, true), false, 'turret waits until it faces the target');
assert(moving.yaw.rotation.y > 0 && moving.yaw.rotation.y <= 0.19, 'yaw has a bounded mechanical turn rate');
assert(moving.elevation.rotation.x < 0 && moving.elevation.rotation.x >= -0.091, 'barrels elevate toward a high target');
let fired = false;
for (let i = 0; i < 8; i += 1) fired ||= stepArcBattery(moving, 0.1, 1, target, true);
assert(fired, 'aligned turret fires');
assert.equal(moving.muzzle, moving.muzzles[moving.barrelIndex].node, 'shot starts at the active barrel');

reducedMotion = true;
const still = rig();
still.yaw.rotation.y = 0.35;
still.elevation.rotation.x = 0.08;
assert.equal(stepArcBattery(still, 0.1, 10), false);
assert.equal(still.yaw.rotation.y, 0.35, 'idle scan stops for reduced motion');
assert.equal(still.elevation.rotation.x, 0.08, 'idle elevation stops for reduced motion');
assert.equal(stepArcBattery(still, 0.1, 10, target, true), true, 'reduced motion still permits defence fire');
assert.equal(still.flashAmount, 0, 'reduced motion has no muzzle flash');
assert.equal(still.recoil.position.z, 0, 'reduced motion has no recoil animation');
assert.equal(still.muzzle, still.muzzles[still.barrelIndex].node, 'reduced-motion shot uses the active barrel');

console.log('Arc Battery yaw, elevation, fire and reduced-motion checks passed.');
