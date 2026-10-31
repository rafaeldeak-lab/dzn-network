import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fixerTaskForStop, fixerActionPose, stepFixerWork, clearFixerWork } from './preview/fixer-actions.js';

const site = { stop: 'district:timberline-depot', finishAt: 2000 };
assert.equal(fixerTaskForStop(site.stop, site, 1000, true), 'construction');
assert.equal(fixerTaskForStop(site.stop, site, 2000, true), site.stop);
assert.equal(fixerTaskForStop(site.stop, site, 1000, false), null);
assert.equal(fixerTaskForStop('yard', null, 1000, true, { perMinute: 12, stored: 4, capacity: 10 }), 'yard');
assert.equal(fixerTaskForStop('yard', null, 1000, true, { perMinute: 12, stored: 10, capacity: 10 }), null);
assert.equal(fixerTaskForStop('depot', null, 1000, true, { stored: 0 }), null);

for (let tier = 1; tier <= 5; tier++) {
  const soldier = new THREE.Group();
  soldier.userData.squadTier = tier;
  const working = fixerActionPose(1.5, false, 'construction');
  assert.equal(working.task, 'construction');
  stepFixerWork(soldier, 1.5, working.task, tier);
  assert.equal(soldier.userData.fixerWork?.root.visible, true);
  assert.equal(soldier.userData.fixerWork?.yard.visible, false);
  assert.equal(soldier.userData.fixerWork?.depot.visible, false);
  assert.equal(fixerActionPose(1.5, true, 'construction').task, null);
  assert.equal(fixerActionPose(1.5, false, 'construction', Infinity, true).task, null);
  stepFixerWork(soldier, 1.5, null, tier);
  assert.equal(soldier.userData.fixerWork?.root.visible, false);
  clearFixerWork(soldier);
  assert.equal(soldier.userData.fixerWork, null);
}
console.log('Fixer construction task and five-tier work state passed');
