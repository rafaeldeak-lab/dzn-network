import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { BUILDING_ASSETS } from './preview/building-assets.js';
import { SQUAD_ROLES, squadAsset, squadPortrait, squadTier, squadUnlocked, squadProfile, squadBattleStats } from './preview/squad-assets.js';
import { PATROL_NODES, PATROL_STOPS, DEFENDER_POST_NODES, createPatrolMotion, createDefenderMotion, setPatrolOrder, shortestPatrolPath, stepPatrolMotion, patrolNodesForLayout, walkablePatrolPath } from './preview/patrol-routes.js';
import { defaultLayout } from './preview/layout-grid.js';
import { DEFENDER_CONCEPTS, defenderAsset, defenderPortrait } from './preview/defender-assets.js';
import { connectedProMatches, greatCircleKm, routeBriefing } from './preview/world-map.js';
import { FIRST_EDITION_CARDS, cardEarned } from './preview/collectible-cards.js';
import { OPERATIVE_MODELS, operativeAsset } from './preview/operative-assets.js';
import { YARD_CYCLE_SECONDS, yardProcessState } from './preview/yard-process.js';
import { facilityMotion } from './preview/facility-motion.js';
import { createForgeWorkshop, forgePose, forgeWorkState, startForgeUpgradeReveal, stepForgeWorkshop } from './preview/forge-workshop.js';
import { commsPose, createCommsArray, startCommsUpgradeReveal, stepCommsArray } from './preview/comms-array.js';
import { sentinelActionPose, applySentinelAction, sentinelMuzzlePosition, startSentinelUpgradeReveal, stepSentinelUpgradeReveal } from './preview/sentinel-actions.js';
import { wardenActionPose, applyWardenAction, wardenMuzzlePosition, startWardenUpgradeReveal, stepWardenUpgradeReveal } from './preview/warden-actions.js';
import { ghostActionPose, applyGhostAction, ghostScannerPosition, stepGhostScan, startGhostUpgradeReveal, stepGhostUpgradeReveal } from './preview/ghost-actions.js';
import { fixerActionPose, applyFixerAction, fixerToolPosition, stepFixerWork, startFixerUpgradeReveal, stepFixerUpgradeReveal } from './preview/fixer-actions.js';
import { lifelineActionPose, applyLifelineAction, lifelineInjectorPosition, stepLifelineTriage, startLifelineUpgradeReveal, stepLifelineUpgradeReveal } from './preview/lifeline-actions.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'preview');
if (YARD_CYCLE_SECONDS.length !== 5 || YARD_CYCLE_SECONDS.some((time, index) => !Number.isFinite(time) || time <= 0 || (index && time >= YARD_CYCLE_SECONDS[index - 1])))
  throw new Error('Each Timberline upgrade must run a faster visible production cycle.');
for (let level = 1; level <= 5; level++) {
  const production = { perMinute: level * 2, stored: 10, capacity: 100 };
  const seconds = YARD_CYCLE_SECONDS[level - 1];
  if (yardProcessState(level, seconds * .1, production).stage !== 'feed'
    || yardProcessState(level, seconds * .45, production).stage !== 'cut'
    || yardProcessState(level, seconds * .7, production).stage !== 'sort'
    || yardProcessState(level, seconds * .95, production).stage !== 'reset'
    || !yardProcessState(level, seconds * .45, production).sawdust)
    throw new Error(`Timberline L${level} must visibly feed, cut, sort, then reset.`);
  const full = yardProcessState(level, seconds * .45, { ...production, stored: 100 });
  if (full.running || full.stage !== 'stored' || full.fill !== 1 || full.sawdust)
    throw new Error(`Timberline L${level} must stop when storage is full.`);
}
for (let level = 1; level <= 5; level++) {
  const raised = forgePose(level, .1, true);
  const striking = forgePose(level, .5, true);
  const released = forgePose(level, .9, true);
  const idle = forgePose(level, .5, false);
  const accessible = forgePose(level, .5, true, true);
  if (!raised.moving || !(striking.pressHeight < raised.pressHeight)
    || !(striking.feedX > raised.feedX) || !(released.feedX > striking.feedX)
    || !striking.sparks || idle.moving || idle.sparks || accessible.moving || accessible.sparks
    || (level > 1 && !(raised.cycleSeconds < forgePose(level - 1, 0, true).cycleSeconds)))
    throw new Error(`Forge L${level} must feed, strike, eject, speed up and stop safely.`);
  const host = new THREE.Group();
  const rig = createForgeWorkshop(THREE, host, level);
  let meshCount = 0;
  rig.root.traverse(object => { if (object.isMesh) meshCount++; });
  const bounds = new THREE.Box3().setFromObject(rig.root).getSize(new THREE.Vector3());
  if (meshCount < 27 + level || bounds.x > 3.2 || bounds.z > 2.1 || bounds.y > 2.8
    || (level >= 2 && !rig.rollers.some(part => part.feed))
    || (level >= 3 && !rig.fans.length)
    || (level >= 4 && !rig.arm)
    || (level >= 5 && !rig.plasma))
    throw new Error(`Forge L${level} must have bounded, tier-specific articulated equipment.`);
  rig.phase = .5;
  stepForgeWorkshop(rig, 0, 1, { perSecond: level, stored: 10, capacity: 100 }, false, true, false);
  if (!rig.sparks.some(spark => spark.visible) || !(rig.press.position.y < raised.pressHeight))
    throw new Error(`Forge L${level} should visibly strike while producing Parts.`);
  stepForgeWorkshop(rig, 0, 1, { perSecond: level, stored: 100, capacity: 100 }, false, true, false);
  if (rig.sparks.some(spark => spark.visible) || rig.billet.visible || rig.phase !== 0)
    throw new Error(`Forge L${level} should stop safely when Parts storage fills.`);
  startForgeUpgradeReveal(rig);
  stepForgeWorkshop(rig, .1, 1, { perSecond: level, stored: 100, capacity: 100 }, false, true, false);
  if (!rig.revealRing.visible || !rig.revealSparks.every(spark => spark.visible))
    throw new Error(`Forge L${level} should reveal its completed upgrade even with full storage.`);
  stepForgeWorkshop(rig, .1, 1, { perSecond: level, stored: 100, capacity: 100 }, false, true, true);
  if (rig.revealRing.visible || rig.revealSparks.some(spark => spark.visible))
    throw new Error(`Forge L${level} upgrade reveal must respect reduced motion.`);
}
if (!forgeWorkState({ perSecond: 4, stored: 100, capacity: 100 }, true, true).active
  || forgeWorkState({ perSecond: 4, stored: 10, capacity: 100 }, false, false).active)
  throw new Error('A personal Forge job may continue at full storage, but access revocation stops the machine.');
for (let level = 1; level <= 5; level++) {
  const active = commsPose(level, .25, true);
  const idle = commsPose(level, .25, false);
  if (!active.moving || !Number.isFinite(active.yaw) || !Number.isFinite(active.pitch)
    || idle.moving || idle.packet !== 0 || commsPose(level, .25, true, true).moving
    || (level > 1 && active.cycleSeconds >= commsPose(level - 1, .25, true).cycleSeconds))
    throw new Error(`Communications L${level} must scan faster at each tier and stop without access or with reduced motion.`);
  const host = new THREE.Group();
  const rig = createCommsArray(THREE, host, level);
  const bounds = new THREE.Box3().setFromObject(rig.root).getSize(new THREE.Vector3());
  let meshes = 0;
  rig.root.traverse(object => { if (object.isMesh) meshes++; });
  if (meshes < 22 + level || bounds.x > 2.7 || bounds.z > 2.7 || bounds.y > 3.2
    || (level >= 3 && !rig.secondary) || (level >= 4 && !rig.upperScanner)
    || (level >= 5 && rig.contacts.length !== 3))
    throw new Error(`Communications L${level} needs bounded, tier-specific articulated relay equipment.`);
  rig.phase = .25;
  stepCommsArray(rig, 0, 1, true, false);
  if (!rig.signal.visible || !rig.yaw.rotation.y || !rig.pitch.rotation.x)
    throw new Error(`Communications L${level} should visibly scan while the owner has access.`);
  stepCommsArray(rig, 0, 1, false, false);
  if (rig.signal.visible || rig.yaw.rotation.y !== 0)
    throw new Error(`Communications L${level} should park its array without owner access.`);
  startCommsUpgradeReveal(rig);
  stepCommsArray(rig, .1, 1, true, false);
  if (!rig.revealRing.visible) throw new Error(`Communications L${level} should reveal an upgrade.`);
  stepCommsArray(rig, .1, 1, true, true);
  if (rig.revealRing.visible || rig.signal.visible) throw new Error(`Communications L${level} must respect reduced motion.`);
}
if (!facilityMotion(1, 0, true).moving || facilityMotion(1, 0, true, true).moving)
  throw new Error('Other facility motion must respect reduced-motion settings.');
const guard = sentinelActionPose(Math.PI / (2 * .68), false, 'tower');
const transit = sentinelActionPose(2, true, 'tower');
const shot = sentinelActionPose(2, false, 'tower', .17);
const still = sentinelActionPose(2, false, 'tower', .17, true);
if (!guard.braced || guard.scan < .2 || transit.braced || transit.scan || shot.recoil < .08
  || still.scan || still.recoil || still.lean) throw new Error('Sentinel must scan while guarding, brace for a shot, and respect reduced motion.');
const soldierRoot = new THREE.Group();
const soldierModel = new THREE.Group(); soldierModel.name = 'squad_model'; soldierRoot.add(soldierModel);
const spine = new THREE.Bone(); spine.name = 'Spine'; soldierModel.add(spine);
const chest = new THREE.Bone(); chest.name = 'Chest'; spine.add(chest);
const neck = new THREE.Bone(); neck.name = 'Neck'; chest.add(neck);
const right = new THREE.Bone(); right.name = 'Hand_R'; right.position.set(.3, 0, 0); chest.add(right);
const left = new THREE.Bone(); left.name = 'Hand_L'; left.position.set(-.3, 0, 0); chest.add(left);
const gripBefore = right.getWorldPosition(new THREE.Vector3()).distanceTo(left.getWorldPosition(new THREE.Vector3()));
applySentinelAction(soldierModel, shot);
const gripAfter = right.getWorldPosition(new THREE.Vector3()).distanceTo(left.getWorldPosition(new THREE.Vector3()));
const muzzle = sentinelMuzzlePosition(soldierRoot);
if (Math.abs(gripBefore - gripAfter) > 1e-6 || !spine.rotation.y || !neck.rotation.y || !chest.rotation.x
  || muzzle.distanceTo(right.getWorldPosition(new THREE.Vector3())) < .3)
  throw new Error('Sentinel guard and recoil must keep both hands together and launch fire from the weapon hand.');
const firstScan = spine.quaternion.clone();
for (let frame = 0; frame < 600; frame++) applySentinelAction(soldierModel, shot);
if (spine.quaternion.angleTo(firstScan) > 1e-5 || Math.abs(chest.rotation.x) > .12
  || Math.abs(right.getWorldPosition(new THREE.Vector3()).distanceTo(left.getWorldPosition(new THREE.Vector3())) - gripBefore) > 1e-5)
  throw new Error('Sentinel pose offsets must remain bounded through a long guard shift.');
applySentinelAction(soldierModel, transit);
if (Math.abs(spine.rotation.y) > 1e-5 || Math.abs(neck.rotation.y) > 1e-5 || Math.abs(chest.rotation.x) > 1e-5)
  throw new Error('Sentinel must return to the neutral walk posture after firing.');
for (let level = 1; level <= 5; level++) {
  const soldier = new THREE.Group();
  const reveal = startSentinelUpgradeReveal(soldier, level);
  if (reveal.sparks.length !== 5 + level || !stepSentinelUpgradeReveal(soldier, .2)
    || !reveal.root.parent || !stepSentinelUpgradeReveal(soldier, .1, false))
    throw new Error(`Sentinel Level ${level} upgrade should have a visible tier-specific reveal.`);
  stepSentinelUpgradeReveal(soldier, 0, true);
  if (soldier.userData.sentinelReveal || reveal.root.parent) throw new Error('Sentinel upgrade reveal must stop under reduced motion.');
}
const warden = new THREE.Group();
const wardenModel = new THREE.Group(); wardenModel.name = 'squad_model'; warden.add(wardenModel);
const wardenSpine = new THREE.Bone(); wardenSpine.name = 'Spine'; wardenModel.add(wardenSpine);
const wardenChest = new THREE.Bone(); wardenChest.name = 'Chest'; wardenSpine.add(wardenChest);
for (const name of ['UpperArm_R', 'Forearm_R', 'UpperArm_L', 'Forearm_L']) {
  const bone = new THREE.Bone(); bone.name = name; wardenChest.add(bone);
}
const wardenHand = new THREE.Bone(); wardenHand.name = 'Hand_R'; wardenHand.position.set(.25, 1, 0); wardenChest.add(wardenHand);
const wardenGuard = wardenActionPose(Math.PI / (2 * .55), false);
const wardenFire = wardenActionPose(0, false, .16);
if (wardenGuard.scan < .12 || wardenActionPose(0, true).scan || wardenFire.recoil < .07
  || wardenActionPose(0, false, .16, true).recoil) throw new Error('Warden must scan, fire and respect reduced motion.');
applyWardenAction(wardenModel, wardenFire);
const arm = wardenModel.getObjectByName('UpperArm_R');
const stableArm = arm.quaternion.clone();
for (let frame = 0; frame < 600; frame++) applyWardenAction(wardenModel, wardenFire);
if (arm.quaternion.angleTo(stableArm) > 1e-5 || Math.abs(wardenChest.rotation.x) > .1)
  throw new Error('Warden arm pose and recoil must remain bounded during a long guard shift.');
const wardenMuzzle = wardenMuzzlePosition(warden);
if (wardenMuzzle.distanceTo(wardenHand.getWorldPosition(new THREE.Vector3())) < .4)
  throw new Error('Warden shot should originate ahead of the right rifle hand.');
applyWardenAction(wardenModel, wardenActionPose(0, true));
if (Math.abs(wardenSpine.rotation.y) > 1e-5 || Math.abs(wardenChest.rotation.x) > 1e-5)
  throw new Error('Warden should return to its neutral walk posture after firing.');
for (let level = 1; level <= 5; level++) {
  const soldier = new THREE.Group();
  const reveal = startWardenUpgradeReveal(soldier, level);
  if (reveal.sparks.length !== 6 + level || !stepWardenUpgradeReveal(soldier, .2) || !reveal.root.parent)
    throw new Error(`Warden Level ${level} should have a tier-specific upgrade reveal.`);
  stepWardenUpgradeReveal(soldier, 0, true);
  if (soldier.userData.wardenReveal || reveal.root.parent)
    throw new Error('Warden upgrade reveal must stop under reduced motion.');
}
const ghost = new THREE.Group();
const ghostModel = new THREE.Group(); ghostModel.name = 'squad_model'; ghost.add(ghostModel);
const ghostSpine = new THREE.Bone(); ghostSpine.name = 'Spine'; ghostModel.add(ghostSpine);
const ghostNeck = new THREE.Bone(); ghostNeck.name = 'Neck'; ghostSpine.add(ghostNeck);
const ghostHand = new THREE.Bone(); ghostHand.name = 'Hand_R'; ghostHand.position.set(.2, 1, .1); ghostSpine.add(ghostHand);
const ghostSweep = ghostActionPose(Math.PI / (2 * .65), false, 'comms');
const ghostPing = ghostActionPose(1, true, null, .275);
if (!ghostSweep.scanning || ghostSweep.yaw < .14 || ghostActionPose(0, false, 'camp').scanning
  || ghostActionPose(0, true, 'comms').scanning || ghostPing.signal < .49
  || ghostActionPose(1, false, 'comms', .275, true).scanning)
  throw new Error('Ghost should sweep at Communications, signal in battle and respect reduced motion.');
applyGhostAction(ghostModel, ghostSweep);
const stableGhostHand = ghostHand.quaternion.clone();
for (let frame = 0; frame < 600; frame++) applyGhostAction(ghostModel, ghostSweep);
if (ghostHand.quaternion.angleTo(stableGhostHand) > 1e-5 || Math.abs(ghostNeck.rotation.y) > .2)
  throw new Error('Ghost scanner hand and lookout pose must remain bounded.');
ghostHand.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .24);
applyGhostAction(ghostModel, ghostSweep);
if (Math.abs(ghostHand.rotation.y) < .2 || Math.abs(ghostHand.rotation.x) < .03)
  throw new Error('Ghost scanner action must preserve the imported walk animation.');
ghostHand.quaternion.identity();
applyGhostAction(ghostModel, ghostSweep);
const scanner = ghostScannerPosition(ghost);
if (scanner.distanceTo(ghostHand.getWorldPosition(new THREE.Vector3())) < .08)
  throw new Error('Ghost signal should originate from the held scanner.');
stepGhostScan(ghost, 1.8, true);
if (!ghost.userData.ghostScan?.ring.visible || ghost.userData.ghostScan.ring.scale.x < 2)
  throw new Error('Ghost should project a visible scan at Communications.');
stepGhostScan(ghost, 2, false);
if (ghost.userData.ghostScan.ring.visible) throw new Error('Ghost scan should stop while leaving its post.');
stepGhostScan(ghost, 2, true, true);
if (ghost.userData.ghostScan.ring.visible) throw new Error('Ghost scan should respect reduced motion.');
applyGhostAction(ghostModel, ghostActionPose(0, true, null));
if (Math.abs(ghostSpine.rotation.y) > 1e-5 || Math.abs(ghostNeck.rotation.y) > 1e-5 || Math.abs(ghostHand.rotation.x) > 1e-5)
  throw new Error('Ghost should return to its neutral walk pose.');
for (let level = 1; level <= 5; level++) {
  const soldier = new THREE.Group();
  const reveal = startGhostUpgradeReveal(soldier, level);
  if (reveal.signals.length !== 4 + level || !stepGhostUpgradeReveal(soldier, .2) || !reveal.root.parent)
    throw new Error(`Ghost Level ${level} should have a tier-specific reveal.`);
  stepGhostUpgradeReveal(soldier, 0, true);
  if (soldier.userData.ghostReveal || reveal.root.parent)
    throw new Error('Ghost reveal must stop under reduced motion.');
}
const fixer = new THREE.Group();
const fixerModel = new THREE.Group(); fixerModel.name = 'squad_model'; fixer.add(fixerModel);
const fixerArm = new THREE.Bone(); fixerArm.name = 'UpperArm_L'; fixerModel.add(fixerArm);
const fixerHand = new THREE.Bone(); fixerHand.name = 'Hand_L'; fixerHand.position.set(.2, 1, .1); fixerArm.add(fixerHand);
for (const name of ['UpperArm_R', 'Neck']) { const bone = new THREE.Bone(); bone.name = name; fixerModel.add(bone); }
const yardAction = fixerActionPose(Math.PI / (2 * 3.4), false, 'yard');
const forgeAction = fixerActionPose(Math.PI / (2 * 4.6), false, 'workshop');
if (yardAction.task !== 'yard' || forgeAction.task !== 'workshop' || !yardAction.arm || !forgeAction.hand
  || fixerActionPose(0, true, 'yard').task || fixerActionPose(0, false, 'camp').task
  || fixerActionPose(0, false, 'yard', Infinity, true).task || fixerActionPose(0, true, null, .3).breach < .5)
  throw new Error('Fixer should work at the yard and Forge, signal a breach and respect reduced motion.');
applyFixerAction(fixerModel, yardAction);
const stableFixerHand = fixerHand.quaternion.clone();
for (let frame = 0; frame < 600; frame++) applyFixerAction(fixerModel, yardAction);
if (fixerHand.quaternion.angleTo(stableFixerHand) > 1e-5) throw new Error('Fixer tool hand must not drift.');
fixerArm.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .24);
applyFixerAction(fixerModel, fixerActionPose(.34 / .58, false, 'yard'));
if (Math.abs(fixerArm.rotation.y) < .2 || Math.abs(fixerArm.rotation.x) < .15)
  throw new Error('Fixer work motion must preserve the imported 3D walk pose.');
fixerArm.quaternion.identity(); applyFixerAction(fixerModel, fixerActionPose(0, true, null));
if (Math.abs(fixerArm.rotation.x) > 1e-5) throw new Error('Fixer arm must return to neutral while walking.');
if (fixerToolPosition(fixer).distanceTo(fixerHand.getWorldPosition(new THREE.Vector3())) < .1)
  throw new Error('Fixer war cue should originate from the held tool.');
stepFixerWork(fixer, 1, 'yard', 5);
if (!fixer.userData.fixerWork?.root.visible || !fixer.userData.fixerWork.yard.visible
  || fixer.userData.fixerWork.particles.length !== 7 || !fixer.userData.fixerWork.feedWheel)
  throw new Error('Fixer Level 5 should show its powered chopping station and wood chips at the yard.');
stepFixerWork(fixer, 1.2, 'yard', 5);
if (fixer.userData.fixerWork.whole.visible || !fixer.userData.fixerWork.halves.every(half => half.visible))
  throw new Error('The Fixer workpiece should split during the axe strike.');
stepFixerWork(fixer, 1.2, 'workshop', 5);
if (fixer.userData.fixerWork.yard.visible)
  throw new Error('The chopping station must stay hidden at the Forge.');
stepFixerWork(fixer, 1, null, 5);
if (fixer.userData.fixerWork.root.visible) throw new Error('Fixer work cue should stop between buildings.');
stepFixerWork(fixer, 1, 'workshop', 5, true);
if (fixer.userData.fixerWork.root.visible) throw new Error('Fixer work cue should respect reduced motion.');
for (let level = 1; level <= 5; level++) {
  const unit = new THREE.Group();
  const reveal = startFixerUpgradeReveal(unit, level);
  if (reveal.sparks.length !== 3 + level || !stepFixerUpgradeReveal(unit, .2) || !reveal.root.parent)
    throw new Error(`Fixer Level ${level} should have a tier-specific reveal.`);
  stepFixerUpgradeReveal(unit, 0, true);
  if (unit.userData.fixerReveal || reveal.root.parent)
    throw new Error('Fixer upgrade reveal must stop under reduced motion.');
}
const lifeline = new THREE.Group();
const lifelineModel = new THREE.Group(); lifelineModel.name = 'squad_model'; lifeline.add(lifelineModel);
const lifelineArm = new THREE.Bone(); lifelineArm.name = 'UpperArm_R'; lifelineModel.add(lifelineArm);
const lifelineHand = new THREE.Bone(); lifelineHand.name = 'Hand_R'; lifelineHand.position.set(.2, 1, .1); lifelineArm.add(lifelineHand);
for (const name of ['UpperArm_L', 'Neck']) { const bone = new THREE.Bone(); bone.name = name; lifelineModel.add(bone); }
const triage = lifelineActionPose(Math.PI / (2 * 2.4), false, 'workshop');
if (!triage.triage || !triage.arm || lifelineActionPose(0, true, 'workshop').triage
  || lifelineActionPose(0, false, 'comms').triage || lifelineActionPose(0, false, 'workshop', Infinity, true).triage
  || lifelineActionPose(0, true, null, .2).treating < .7)
  throw new Error('Lifeline should work at the Forge or camp, treat allies and respect reduced motion.');
applyLifelineAction(lifelineModel, triage);
const stableLifelineHand = lifelineHand.quaternion.clone();
for (let frame = 0; frame < 600; frame++) applyLifelineAction(lifelineModel, triage);
if (lifelineHand.quaternion.angleTo(stableLifelineHand) > 1e-5) throw new Error('Lifeline injector hand must not drift.');
lifelineArm.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .22);
applyLifelineAction(lifelineModel, triage);
if (Math.abs(lifelineArm.rotation.y) < .2 || Math.abs(lifelineArm.rotation.x) < .02)
  throw new Error('Lifeline work must preserve the imported 3D animation.');
lifelineArm.quaternion.identity(); applyLifelineAction(lifelineModel, lifelineActionPose(0, true, null));
if (Math.abs(lifelineArm.rotation.x) > 1e-5) throw new Error('Lifeline must return to neutral while walking.');
if (lifelineInjectorPosition(lifeline).distanceTo(lifelineHand.getWorldPosition(new THREE.Vector3())) < .1)
  throw new Error('Lifeline treatment must originate from the injector hand.');
stepLifelineTriage(lifeline, 1, true, 5);
if (!lifeline.userData.lifelineTriage?.root.visible || lifeline.userData.lifelineTriage.motes.length !== 7)
  throw new Error('Lifeline Level 5 should show active injector particles.');
stepLifelineTriage(lifeline, 1, false, 5);
if (lifeline.userData.lifelineTriage.root.visible) throw new Error('Lifeline triage must stop between posts.');
stepLifelineTriage(lifeline, 1, true, 5, true);
if (lifeline.userData.lifelineTriage.root.visible) throw new Error('Lifeline triage must respect reduced motion.');
for (let level = 1; level <= 5; level++) {
  const unit = new THREE.Group();
  const reveal = startLifelineUpgradeReveal(unit, level);
  if (reveal.motes.length !== 3 + level || !stepLifelineUpgradeReveal(unit, .2) || !reveal.root.parent)
    throw new Error(`Lifeline Level ${level} should have a tier-specific reveal.`);
  stepLifelineUpgradeReveal(unit, 0, true);
  if (unit.userData.lifelineReveal || reveal.root.parent)
    throw new Error('Lifeline upgrade reveal must stop under reduced motion.');
}
const manifest = readFileSync(join(root, 'ASSET_SHA256.txt'), 'utf8').trim().split(/\r?\n/);
const recorded = new Map();
for (const line of manifest) {
  const match = /^([a-f0-9]{64}) (assets\/[\w./-]+)$/.exec(line);
  if (!match || recorded.has(match[2])) throw new Error(`Invalid or duplicate asset manifest entry: ${line}`);
  recorded.set(match[2], match[1]);
  const bytes = readFileSync(join(root, ...match[2].split('/')));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== match[1]) throw new Error(`Asset checksum mismatch: ${match[2]}`);
}

let pairs = 0;
for (const [key, definition] of Object.entries(BUILDING_ASSETS)) {
  if (definition.levels.length !== 5) throw new Error(`${key} does not have five levels`);
  if (key === 'depot') {
    if (definition.levels.some((level, index) => level.glb !== null || !level.png.startsWith('data:image/svg+xml,') || !decodeURIComponent(level.png).includes(`L${index + 1}`)))
      throw new Error('The original five-stage 3D Supply Depot needs a distinct fallback illustration at every level.');
    continue;
  }
  for (const [index, level] of definition.levels.entries()) {
    for (const [format, signature] of [['glb', 'glTF'], ['png', '\x89PNG']]) {
      const path = level[format];
      if (!recorded.has(path)) throw new Error(`Unrecorded ${key} level ${index + 1} ${format}: ${path}`);
      const bytes = readFileSync(join(root, ...path.split('/')));
      if (bytes.toString('latin1', 0, 4) !== signature) throw new Error(`Invalid ${format} signature: ${path}`);
    }
    pairs += 1;
  }
}
const arcBatteryModels = [...recorded.keys()].filter(path => path.startsWith('assets/models/defense-towers/') && path.endsWith('.glb'));
if (pairs !== 20 || recorded.size !== 49 || arcBatteryModels.length !== 5 || !BUILDING_ASSETS.tower.levels.every(level => arcBatteryModels.includes(level.glb))) throw new Error(`Expected 20 building pairs, five mapped Arc Battery stages and 49 checksums; got ${pairs}, ${arcBatteryModels.length} and ${recorded.size}`);
const sceneryManifest = JSON.parse(readFileSync(join(root, 'assets/models/scenery/manifest.json'), 'utf8'));
const sceneryNames = Object.keys(sceneryManifest.assets);
if (sceneryNames.length !== 14 || ![1, 2, 3, 4, 5].every(level => sceneryNames.includes(`pine_l0${level}`)) || !['fallen_trunk', 'fern_patch', 'mossy_rock_cluster', 'brush_pile', 'lumber_pallet'].every(name => sceneryNames.includes(name))) throw new Error('Scenery kit must contain five tree stages, four clearing props and five forest details.');
for (const [name, entry] of Object.entries(sceneryManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Missing GLB scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.nodes?.length || !gltf.scenes?.length) throw new Error(`Incomplete GLB scene: ${name}`);
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Scenery integrity mismatch: ${name}`);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(dimension => !Number.isFinite(dimension) || dimension <= 0)) throw new Error(`Invalid model bounds: ${name}`);
  if (/^(pine_l0[1-5]|granite_boulder|claim_marker)$/.test(name)) {
    const rosebudVariant = readFileSync(join(root, 'assets/models/scenery', `${name}${name.startsWith('pine_') ? '-3' : '-2'}.glb`));
    if (!rosebudVariant.equals(bytes)) throw new Error(`Rosebud scenery variant differs from review asset: ${name}`);
  }
}
console.log(`Stronghold preview assets verified: ${pairs} building level pairs, ${recorded.size} original checksums, ${sceneryNames.length} original scenery GLBs.`);
const campManifest = JSON.parse(readFileSync(join(root, 'assets/models/camps/manifest.json'), 'utf8'));
const campEntry = campManifest.assets?.squad_bivouac;
if (!campEntry || !/^assets\/models\/camps\/[\w-]+\.glb$/.test(campEntry.file)) throw new Error('DZN squad camp asset mapping is missing.');
const campBytes = readFileSync(join(root, ...campEntry.file.split('/')));
if (campBytes.toString('ascii', 0, 4) !== 'glTF' || campBytes.readUInt32LE(4) !== 2 || campBytes.readUInt32LE(8) !== campBytes.length || campBytes.length !== campEntry.bytes || createHash('sha256').update(campBytes).digest('hex') !== campEntry.sha256) throw new Error('DZN squad camp GLB integrity failed.');
const campJsonLength = campBytes.readUInt32LE(12);
const campGltf = JSON.parse(campBytes.toString('utf8', 20, 20 + campJsonLength));
if (!campGltf.meshes?.length || !campGltf.materials?.length || !campGltf.textures?.length || !campGltf.images?.length || !campGltf.scenes?.length || !Array.isArray(campEntry.dimensions) || campEntry.dimensions.some(dimension => dimension <= 0)) throw new Error('DZN squad camp has incomplete geometry or textures.');
console.log('Textured DZN squad bivouac GLB verified.');
const facilityManifest = JSON.parse(readFileSync(join(root, 'assets/models/facilities/manifest.json'), 'utf8'));
const families = ['timberline_v4', 'ridgewatch', 'signal', 'highland'];
const facilityNames = Object.keys(facilityManifest.assets);
if (facilityNames.length !== 20 || !families.every(family => [1, 2, 3, 4, 5].every(level => facilityNames.includes(`${family}_l0${level}`)))) throw new Error('Facility kit must contain four distinct five-level families.');
for (const [name, entry] of Object.entries(facilityManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid facility GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Missing facility scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.nodes?.length || !gltf.scenes?.length) throw new Error(`Incomplete facility GLB scene: ${name}`);
  if (name.startsWith('timberline_v4_')) {
    const level = Number(name.slice(-1));
    const nodes = new Set(gltf.nodes.map(node => node.name));
    const required = ['stone_yard_base', 'roof_spine', 'saw_carriage', 'saw_rotor', 'circular_saw_blade', 'saw_safety_light',
      'conveyor_roller_0', 'conveyor_roller_10', 'conveyor_roller_20', 'conveyor_roller_30',
      ...(level >= 2 ? ['hydraulic_sorter'] : []), ...(level >= 3 ? ['loading_crane_hook'] : []),
      ...(level >= 4 ? ['auto_feed_motor'] : []), ...(level >= 5 ? ['elite_yard_beacon'] : [])];
    if (required.some(part => !nodes.has(part))) throw new Error(`Incomplete Timberline Level ${level} machinery.`);
    if ((gltf.images?.length || 0) < 2 || (gltf.textures?.length || 0) < 2) throw new Error(`Timberline Level ${level} is missing embedded textures.`);
    if (!nodes.has('yard_safety_lamp')) throw new Error(`Timberline Level ${level} is missing its detailed working bay.`);
  }
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Facility integrity mismatch: ${name}`);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(dimension => !Number.isFinite(dimension) || dimension <= 0)) throw new Error(`Invalid facility model bounds: ${name}`);
}
console.log(`Additional district facilities verified: ${facilityNames.length} original GLBs across four five-level families.`);
const meshyYardManifest = JSON.parse(readFileSync(join(root, 'assets/models/facilities/meshy-pilot-manifest.json'), 'utf8'));
const meshyGeneration = meshyYardManifest.generation;
if (meshyYardManifest.stage !== 'five-level-series' || meshyGeneration.quotedCreditsTotal !== 5 * meshyGeneration.quotedCreditsPerLevel
  || meshyGeneration.quotedCreditsPerLevel > meshyGeneration.approvedPilotCeiling
  || 4 * meshyGeneration.quotedCreditsPerLevel > meshyGeneration.approvedAdditionalCeiling)
  throw new Error('Meshy Timberline series has an invalid generation receipt.');
if (Object.keys(meshyYardManifest.assets).length !== 5) throw new Error('Meshy Timberline must have five levels.');
const meshyYardHashes = new Set();
for (let level = 1; level <= 5; level++) {
  const name = `timberline_l0${level}`, entry = meshyYardManifest.assets[name];
  if (!entry || entry.file !== `assets/models/facilities/timberline_meshy_l0${level}.glb`
    || !/^[a-f0-9]{64}$/.test(entry.sourceSha256) || !/^[a-f0-9]{64}$/.test(entry.referenceSha256))
    throw new Error(`Meshy Timberline Level ${level} has an incomplete provenance record.`);
  for (const [file, expected] of [
    [`timberline-l0${level}-meshy-source.glb`, entry.sourceSha256],
    [`dzn-timberline-l0${level}-reference.png`, entry.referenceSha256],
  ]) {
    const source = readFileSync(join(root, '..', 'source-art', 'meshy', file));
    if (createHash('sha256').update(source).digest('hex') !== expected)
      throw new Error(`Meshy Timberline Level ${level} source integrity failed: ${file}`);
  }
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length
    || bytes.length !== entry.bytes || hash !== entry.sha256 || meshyYardHashes.has(hash))
    throw new Error(`Meshy Timberline Level ${level} GLB integrity failed.`);
  meshyYardHashes.add(hash);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const nodes = new Set(gltf.nodes?.map(node => node.name));
  const movingParts = ['saw_rotor', 'saw_carriage', 'conveyor_roller_0', 'conveyor_roller_10', 'conveyor_roller_20', 'conveyor_roller_30',
    ...(level >= 2 ? ['hydraulic_sorter'] : []), ...(level >= 3 ? ['loading_crane_hook'] : []),
    ...(level >= 4 ? ['auto_feed_motor'] : []), ...(level >= 5 ? ['elite_yard_beacon'] : [])];
  if (!gltf.meshes?.length || !gltf.images?.length || movingParts.some(part => !nodes.has(part)))
    throw new Error(`Meshy Timberline Level ${level} lost its textured shell or moving machinery.`);
}
console.log('Five distinct textured DZN Timberline GLBs and separate moving machinery verified.');
const wallManifest = JSON.parse(readFileSync(join(root, 'assets/models/walls/manifest.json'), 'utf8'));
if (Object.keys(wallManifest.assets).length !== 5) throw new Error('Five wall stages are required.');
const wallHashes = new Set();
for (let level = 1; level <= 5; level++) {
  const name = `wall_l0${level}`, entry = wallManifest.assets[name];
  if (!entry) throw new Error(`Wall Level ${level} is missing.`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length || bytes.length !== entry.bytes || hash !== entry.sha256 || wallHashes.has(hash)) throw new Error(`Wall Level ${level} integrity failed.`);
  wallHashes.add(hash);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const nodes = new Set(gltf.nodes.map(node => node.name));
  if (!nodes.has(level <= 2 ? 'reclaimed_timber' : 'armoured_barrier') || (level === 5 && !nodes.has('active_defence_node'))) throw new Error(`Wall Level ${level} geometry is incomplete.`);
}
console.log('Five distinct DZN perimeter wall GLBs verified.');
const routeManifest = JSON.parse(readFileSync(join(root, 'assets/models/routes/manifest.json'), 'utf8'));
const routeNames = Object.keys(routeManifest.assets);
if (routeNames.length !== 5 || ![1, 2, 3, 4, 5].every(level => routeNames.includes(`supply_route_l0${level}`))) throw new Error('Supply route kit must contain five distinct visual tiers.');
const routeHashes = new Set();
for (const [name, entry] of Object.entries(routeManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid route GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Missing route scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.nodes?.length || !gltf.scenes?.length) throw new Error(`Incomplete route GLB scene: ${name}`);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== entry.bytes || actual !== entry.sha256 || routeHashes.has(actual)) throw new Error(`Route integrity or visual-tier mismatch: ${name}`);
  routeHashes.add(actual);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(dimension => !Number.isFinite(dimension) || dimension <= 0)) throw new Error(`Invalid route model bounds: ${name}`);
}
console.log(`DZN supply routes verified: ${routeNames.length} original levelled GLBs.`);
const chronicleManifest = JSON.parse(readFileSync(join(root, 'assets/models/chronicle/manifest.json'), 'utf8'));
const chronicleNames = Object.keys(chronicleManifest.assets);
if (chronicleNames.length !== 5 || ![1, 2, 3, 4, 5].every(level => chronicleNames.includes(`chronicle_beacon_l0${level}`))) throw new Error('Chronicle Beacon kit must contain five visual stages.');
const chronicleHashes = new Set();
for (const [name, entry] of Object.entries(chronicleManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid Chronicle GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Missing Chronicle scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.nodes?.length || !gltf.scenes?.length) throw new Error(`Incomplete Chronicle GLB scene: ${name}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== entry.bytes || hash !== entry.sha256 || chronicleHashes.has(hash)) throw new Error(`Chronicle integrity or visual-tier mismatch: ${name}`);
  chronicleHashes.add(hash);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(dimension => !Number.isFinite(dimension) || dimension <= 0)) throw new Error(`Invalid Chronicle model bounds: ${name}`);
}
console.log(`DZN Chronicle Beacon verified: ${chronicleNames.length} original levelled GLBs.`);
const worldManifest = JSON.parse(readFileSync(join(root, 'assets/world/manifest.json'), 'utf8'));
const worldBytes = readFileSync(join(root, ...worldManifest.asset.split('/')));
if (worldBytes.toString('latin1', 0, 4) !== '\x89PNG' || worldBytes.readUInt32BE(16) !== worldManifest.dimensions[0] || worldBytes.readUInt32BE(20) !== worldManifest.dimensions[1]) throw new Error('Invalid Stronghold world texture size or PNG signature.');
if (createHash('sha256').update(worldBytes).digest('hex') !== worldManifest.sha256) throw new Error('Stronghold world texture checksum mismatch.');
console.log(`DZN world map verified: ${worldManifest.dimensions.join('x')} original texture.`);
if (greatCircleKm([47, 29], [47, 29]) !== 0 || greatCircleKm([23, 32], [47, 29]) !== greatCircleKm([47, 29], [23, 32])) throw new Error('World route geometry must be zero at origin and symmetric.');
const demoWorld = [
  { name: 'Iron Pines', accessTier: 'owner Pro active', map: [47, 29], hallLevel: 2, defenders: {} },
  { name: 'Violet Ridge', accessTier: 'owner Pro active', map: [23, 32], hallLevel: 4, defenders: { guardian: { level: 1, post: 'gate' } } },
  { name: 'Mossback Free', accessTier: 'view only', map: [82, 38], hallLevel: 1, defenders: {} },
];
const route = routeBriefing(demoWorld[0], demoWorld[1]);
if (route.distanceKm < 1000 || route.travelHours <= 1.5 || route.risk < 2 || route.rewardMultiplier <= 1 || connectedProMatches(demoWorld, 'IRON').length !== 1 || connectedProMatches(demoWorld).length !== 2) throw new Error('World search or route briefing regressed.');
const cardManifest = JSON.parse(readFileSync(join(root, 'assets/cards/manifest.json'), 'utf8'));
if (FIRST_EDITION_CARDS.length !== 3 || Object.keys(cardManifest.assets).length !== 3) throw new Error('First Edition card series is incomplete.');
for (const card of FIRST_EDITION_CARDS) {
  const entry = cardManifest.assets[card.id];
  if (!entry || entry.file !== card.image) throw new Error(`Missing First Edition card ${card.id}.`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('latin1', 0, 4) !== '\x89PNG' || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`First Edition art integrity mismatch: ${card.id}`);
}
if (!cardEarned('fixer', { landPlots: [{ id: 'timberline-depot', facilityLevel: 2 }] }) || cardEarned('guardian', { defenders: { guardian: { level: 1, post: '' } } }) || !cardEarned('ghost', { levels: { comms: 3 } })) throw new Error('Card milestones must follow base progress.');
console.log('World route/search preview and three First Edition card assets verified.');
const squadManifest = JSON.parse(readFileSync(join(root, 'assets/models/squads-v5/manifest.json'), 'utf8'));
const squadNames = Object.keys(squadManifest.assets);
if (squadNames.length !== 25 || Object.keys(SQUAD_ROLES).some(role => [1, 2, 3, 4, 5].some(level => !squadNames.includes(`${role}_l0${level}`)))) throw new Error('DZN squad kit must contain five roles at five levels each.');
if (squadTier('assault', { hq: 3, tower: 5 }) !== 3 || squadTier('recon', { hq: 5, comms: 2 }) !== 2 || squadTier('engineer', { hq: 4, workshop: 3 }) !== 3) throw new Error('Squad gear must follow the specialist and Hall visual cap.');
if (squadUnlocked('sentinel', { hq: 3, tower: 5 }) || squadUnlocked('medic', { hq: 4, workshop: 2 }) || !squadUnlocked('sentinel', { hq: 4, tower: 3 }) || !squadUnlocked('medic', { hq: 4, workshop: 3 })) throw new Error('Specialist units must follow Hall and building unlock gates.');
if (squadProfile('sentinel', { hq: 5, tower: 5 }).maxHealth <= squadProfile('sentinel', { hq: 4, tower: 3 }).maxHealth || squadBattleStats({ hq: 4, tower: 3, workshop: 3 }, 'assault').scoreBonus <= squadBattleStats({ hq: 3, tower: 2, workshop: 2 }, 'assault').scoreBonus || squadBattleStats({ hq: 4, tower: 3, workshop: 3 }, 'assault').casualtyShield <= 0) throw new Error('Upgraded weapons, armour and support must affect local combat.');
const squadHashes = new Set();
const heldSquadParts = {
  assault: ['carbine_barrel', 'carbine_body', 'carbine_sight'],
  recon: ['scanner', 'scanner_screen'], engineer: ['axe_handle', 'axe_head'],
  sentinel: ['heavy_carbine', 'heavy_barrel', 'reflex_sight'],
  medic: ['aid_injector', 'injector_charge'],
};
for (const [name, entry] of Object.entries(squadManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (entry.file !== `assets/models/squads-v5/${name}.glb` || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid squad GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Invalid squad scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const nodeNames = new Set((gltf.nodes || []).map(node => node.name));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.scenes?.length || !['left_arm', 'right_arm', 'left_leg', 'right_leg'].every(limb => nodeNames.has(limb))) throw new Error(`Incomplete animatable soldier: ${name}`);
  if (heldSquadParts[name.split('_')[0]].some(part => !nodeNames.has(part))) throw new Error(`Missing animated held equipment: ${name}`);
  if (name.startsWith('assault_') && Number(name.slice(-1)) >= 4 && !nodeNames.has('forearm_shield')) throw new Error(`Missing upgraded Warden shield: ${name}`);
  if (name.startsWith('sentinel_') && Number(name.slice(-1)) >= 3 && !nodeNames.has('drum_magazine')) throw new Error(`Missing upgraded Sentinel drum: ${name}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== entry.sha256 || entry.bytes !== bytes.length || squadHashes.has(hash) || entry.meshes < 20) throw new Error(`Squad integrity or tier distinction failed: ${name}`);
  squadHashes.add(hash);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(d => !Number.isFinite(d) || d <= 0)) throw new Error(`Invalid squad bounds: ${name}`);
}
console.log(`DZN squad kit verified: ${squadNames.length} original, distinct and animatable GLBs.`);
const wardenManifest = JSON.parse(readFileSync(join(root, 'assets/models/squads-v6/manifest.json'), 'utf8'));
if (Object.keys(wardenManifest.assets).length !== 5) throw new Error('Rosebud Warden upgrade set must have five levels.');
const wardenHashes = new Set();
for (let level = 1; level <= 5; level++) {
  const name = `assault_l0${level}`;
  const entry = wardenManifest.assets[name];
  if (!entry || entry.file !== squadAsset('assault', level)) throw new Error(`Warden Level ${level} asset mapping is missing.`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Warden Level ${level} GLB is invalid.`);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== entry.sha256 || bytes.length !== entry.bytes || wardenHashes.has(hash)) throw new Error(`Warden Level ${level} integrity or distinction failed.`);
  wardenHashes.add(hash);
  if (!gltf.skins?.length || !gltf.animations?.some(clip => clip.name === 'DZN_Warden_Walk') || !gltf.meshes?.length || !gltf.images?.length) throw new Error(`Warden Level ${level} is missing a skin, walk clip, mesh or texture.`);
  if (!(gltf.animations.find(clip => clip.name === 'DZN_Warden_Walk')?.channels?.length > 0)) throw new Error(`Warden Level ${level} has an empty walk clip.`);
}
const carbine = wardenManifest.equipment?.warden_carbine;
if (carbine?.file !== 'assets/models/squads-v6/warden_carbine.glb') throw new Error('Rosebud Warden carbine mapping is missing.');
const carbineBytes = readFileSync(join(root, ...carbine.file.split('/')));
if (carbineBytes.toString('ascii', 0, 4) !== 'glTF' || carbineBytes.readUInt32LE(8) !== carbineBytes.length
  || createHash('sha256').update(carbineBytes).digest('hex') !== carbine.sha256) throw new Error('Warden carbine integrity failed.');
const carbineGltf = JSON.parse(carbineBytes.toString('utf8', 20, 20 + carbineBytes.readUInt32LE(12)));
if (!carbineGltf.meshes?.length || !carbineGltf.images?.length) throw new Error('Warden carbine lacks a 3D mesh or texture.');
console.log('Five distinct, textured and skinned Rosebud Warden levels and a textured 3D carbine verified.');
const ghostManifest = JSON.parse(readFileSync(join(root, 'assets/models/squads-v7/manifest.json'), 'utf8'));
if (Object.keys(ghostManifest.assets || {}).length !== 5) throw new Error('Ghost kit must have five image-guided models.');
const ghostHashes = new Set();
for (let level = 1; level <= 5; level++) {
  const name = `recon_l0${level}`, ghost = ghostManifest.assets[name];
  if (!ghost || ghost.file !== squadAsset('recon', level) || ghost.reference !== squadPortrait('recon', level)) throw new Error(`Ghost Level ${level} model or portrait mapping is missing.`);
  const ghostBytes = readFileSync(join(root, ...ghost.file.split('/')));
  const ghostSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), ghost.source));
  const ghostReference = readFileSync(join(root, ...ghost.reference.split('/')));
  const hash = createHash('sha256').update(ghostBytes).digest('hex');
  if (ghostBytes.toString('ascii', 0, 4) !== 'glTF' || ghostBytes.readUInt32LE(8) !== ghostBytes.length || ghostBytes.length !== ghost.bytes
    || hash !== ghost.sha256 || ghostHashes.has(hash)
    || createHash('sha256').update(ghostSource).digest('hex') !== ghost.sourceSha256
    || createHash('sha256').update(ghostReference).digest('hex') !== ghost.referenceSha256) throw new Error(`Ghost Level ${level} source, portrait or game GLB integrity failed.`);
  ghostHashes.add(hash);
  const ghostGltf = JSON.parse(ghostBytes.toString('utf8', 20, 20 + ghostBytes.readUInt32LE(12)));
  const ghostAnimations = new Map((ghostGltf.animations || []).map(animation => [animation.name, animation.channels.length]));
  const triangles = ghostGltf.meshes?.flatMap(mesh => mesh.primitives).reduce((count, part) => count + ghostGltf.accessors[part.indices].count / 3, 0);
  if (!ghostGltf.meshes?.length || !ghostGltf.skins?.length || ghostGltf.skins[0].joints?.length < 15 || ghostGltf.images?.length < 2
    || triangles !== ghost.triangles || ghost.animations.some(animation => !ghostAnimations.get(animation))) throw new Error(`Ghost Level ${level} lacks textured, skinned walk/idle geometry.`);
}
console.log('Five distinct image-guided DZN Ghost levels verified with retained sources, skins, textures and walk/idle clips.');
const fixerManifest = JSON.parse(readFileSync(join(root, 'assets/models/squads-v12/manifest.json'), 'utf8'));
const fixerBaseline = JSON.parse(readFileSync(join(root, 'assets/models/squads-v8/manifest.json'), 'utf8'));
if (!fixerManifest.complete || Object.keys(fixerManifest.assets || {}).length !== 5) throw new Error('Fixer kit must have five steady-grip models.');
const fixerHashes = new Set();
for (let level = 1; level <= 5; level++) {
  const name = `engineer_l0${level}`, fixer = fixerManifest.assets[name];
  if (!fixer || fixer.file !== squadAsset('engineer', level) || fixer.reference !== squadPortrait('engineer', level) || !fixer.rosebudJob
    || fixer.sourceSha256 !== fixerBaseline.assets[name]?.sourceSha256 || fixer.sha256 === fixerBaseline.assets[name]?.sha256) throw new Error(`Fixer Level ${level} steady-grip model or portrait mapping is missing.`);
  const bytes = readFileSync(join(root, ...fixer.file.split('/')));
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), fixer.source));
  const reference = readFileSync(join(root, ...fixer.reference.split('/')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length || bytes.length !== fixer.bytes
    || hash !== fixer.sha256 || fixerHashes.has(hash)
    || createHash('sha256').update(source).digest('hex') !== fixer.sourceSha256
    || createHash('sha256').update(reference).digest('hex') !== fixer.referenceSha256) throw new Error(`Fixer Level ${level} source, portrait or game GLB integrity failed.`);
  fixerHashes.add(hash);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const clips = new Map((gltf.animations || []).map(animation => [animation.name, animation.channels.length]));
  const triangles = gltf.meshes?.flatMap(mesh => mesh.primitives).reduce((count, part) => count + gltf.accessors[part.indices].count / 3, 0);
  if (!gltf.meshes?.length || !gltf.skins?.length || gltf.skins[0].joints?.length < 15 || gltf.images?.length < 2
    || triangles !== fixer.triangles || fixer.animations.some(animation => !clips.get(animation))) throw new Error(`Fixer Level ${level} lacks textured, skinned walk/idle geometry.`);
}
console.log('Five distinct DZN Fixer steady-grip levels verified with retained image-guided sources, skins, textures and walk/idle clips.');
const medicManifest = JSON.parse(readFileSync(join(root, 'assets/models/squads-v9/manifest.json'), 'utf8'));
if (Object.keys(medicManifest.assets || {}).length !== 5) throw new Error('Lifeline kit must have five image-guided models.');
const medicHashes = new Set();
for (let level = 1; level <= 5; level++) {
  const name = `medic_l0${level}`, medic = medicManifest.assets[name];
  if (!medic || medic.file !== squadAsset('medic', level) || medic.reference !== squadPortrait('medic', level) || !medic.rosebudJob) throw new Error(`Lifeline Level ${level} model or portrait mapping is missing.`);
  const bytes = readFileSync(join(root, ...medic.file.split('/')));
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), medic.source));
  const reference = readFileSync(join(root, ...medic.reference.split('/')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length || bytes.length !== medic.bytes
    || hash !== medic.sha256 || medicHashes.has(hash)
    || createHash('sha256').update(source).digest('hex') !== medic.sourceSha256
    || createHash('sha256').update(reference).digest('hex') !== medic.referenceSha256) throw new Error(`Lifeline Level ${level} source, portrait or game GLB integrity failed.`);
  medicHashes.add(hash);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const clips = new Map((gltf.animations || []).map(animation => [animation.name, animation.channels.length]));
  const triangles = gltf.meshes?.flatMap(mesh => mesh.primitives).reduce((count, part) => count + gltf.accessors[part.indices].count / 3, 0);
  if (!gltf.meshes?.length || !gltf.skins?.length || gltf.skins[0].joints?.length < 15 || gltf.images?.length < 2
    || triangles !== medic.triangles || medic.animations.some(animation => !clips.get(animation))) throw new Error(`Lifeline Level ${level} lacks textured, skinned walk/idle geometry.`);
}
console.log('Five distinct image-guided DZN Lifeline levels verified with retained sources, skins, textures and walk/idle clips.');
const sentinelManifest = JSON.parse(readFileSync(join(root, 'assets/models/squads-v11/manifest.json'), 'utf8'));
const sentinelBaseline = JSON.parse(readFileSync(join(root, 'assets/models/squads-v10/manifest.json'), 'utf8'));
if (!sentinelManifest.complete || Object.keys(sentinelManifest.assets || {}).length !== 5) throw new Error('Sentinel set must contain five complete levels.');
const sentinelHashes = new Set();
for (let level = 1; level <= 5; level++) {
  const name = `sentinel_l0${level}`, entry = sentinelManifest.assets[name];
  if (!entry || entry.file !== squadAsset('sentinel', level) || entry.reference !== squadPortrait('sentinel', level) || !entry.rosebudJob
    || entry.sourceSha256 !== sentinelBaseline.assets[name]?.sourceSha256 || entry.sha256 === sentinelBaseline.assets[name]?.sha256) throw new Error(`Sentinel Level ${level} steady-grip model, portrait or provenance is missing.`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), entry.source));
  const reference = readFileSync(join(root, ...entry.reference.split('/')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length || hash !== entry.sha256 || bytes.length !== entry.bytes || sentinelHashes.has(hash)
    || createHash('sha256').update(source).digest('hex') !== entry.sourceSha256
    || createHash('sha256').update(reference).digest('hex') !== entry.referenceSha256
    || !gltf.skins?.length || gltf.images?.length < 2 || !gltf.animations?.some(animation => animation.name === 'DZN_Operative_Walk' && animation.channels.length)
    || !gltf.animations?.some(animation => animation.name === 'DZN_Operative_Idle' && animation.channels.length)) throw new Error(`Sentinel Level ${level} asset integrity failed.`);
  sentinelHashes.add(hash);
}
console.log('Five distinct DZN Sentinel steady-grip rigs verified against retained image-guided sources, textures and walk/idle clips.');
const operativeManifest = JSON.parse(readFileSync(join(root, 'assets/models/operatives/manifest.json'), 'utf8'));
const operativeHashes = new Set();
if (Object.keys(operativeManifest.assets).length !== 3 || operativeAsset('unknown') !== null) throw new Error('Expected exactly three named DZN commander models.');
for (const [id, entry] of Object.entries(operativeManifest.assets)) {
  if (OPERATIVE_MODELS[id] !== entry.file) throw new Error(`Operative mapping mismatch: ${id}`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length || bytes.length !== entry.bytes || hash !== entry.sha256 || operativeHashes.has(hash)) throw new Error(`Operative mesh integrity or distinction failed: ${id}`);
  operativeHashes.add(hash);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const walk = gltf.animations?.find(clip => clip.name === 'DZN_Operative_Walk');
  const idle = gltf.animations?.find(clip => clip.name === 'DZN_Operative_Idle');
  if (!gltf.meshes?.length || !gltf.skins?.length || gltf.skins[0].joints?.length < 15 || !gltf.images?.length || !gltf.materials?.length || !walk?.channels?.length || !idle?.channels?.length) throw new Error(`Operative ${id} lacks textured, skinned walk/idle geometry.`);
}
console.log('Three distinct Rosebud DZN commanders verified with embedded textures and skinned walk/idle clips.');
const occupied = [
  [0, 0, BUILDING_ASSETS.hq.footprint], [-9, 4, BUILDING_ASSETS.workshop.footprint],
  [8, 6, BUILDING_ASSETS.tower.footprint], [6, -8, BUILDING_ASSETS.comms.footprint],
];
const patrolLayout = defaultLayout();
const patrolNodes = patrolNodesForLayout(patrolLayout);
for (const [role, stops] of Object.entries(PATROL_STOPS)) {
  const motion = createPatrolMotion(role);
  const reached = new Set();
  let walking = 0, resting = 0;
  for (let frame = 0; frame < 3600; frame++) {
    stepPatrolMotion(motion, 0.05, patrolNodes, patrolLayout);
    if (motion.route.length > 2) throw new Error(`${role} took an unnecessary perimeter circuit`);
    if (motion.moving) walking++; else resting++;
    if (!motion.route.length && motion.wait > 0) reached.add(motion.node);
    for (const [x, z, size] of occupied) {
      const clearance = size / 2 + 0.15;
      if (Math.abs(motion.x - x) < clearance && Math.abs(motion.z - z) < clearance) {
        throw new Error(`${role} patrol crossed a building at ${motion.x.toFixed(2)}, ${motion.z.toFixed(2)}`);
      }
    }
  }
  if (!walking || !resting || stops.some(stop => !reached.has(stop))) throw new Error(`${role} patrol did not walk, stop and visit every assigned structure`);
  for (const stop of stops) if (!PATROL_NODES[stop] || !shortestPatrolPath('camp', stop).length) throw new Error(`${role} has an unreachable stop`);
}
console.log('DZN patrols verified: five roles visit assigned buildings and camp, pause, and avoid building footprints.');
const movedPatrolLayout = defaultLayout();
movedPatrolLayout.structures.workshop = { x: -10, z: 4 };
movedPatrolLayout.walls.push({ id: 'wall-1', x: 0, z: 6, level: 1 });
const movedStops = patrolNodesForLayout(movedPatrolLayout);
const wallDetour = walkablePatrolPath([0, 4], [0, 10], movedPatrolLayout);
if (movedStops.workshop[0] !== -10 || !wallDetour || wallDetour.length < 2 || wallDetour.some(point => point[0] === 0 && point[1] === 6)) throw new Error('Moved buildings and placed walls must change the squad walking route.');
const depotConstruction = setPatrolOrder(createPatrolMotion('engineer'), 'standard', ['camp', 'depot', 'camp']);
const depotVisits = new Set();
for (let frame = 0; frame < 4200; frame++) {
  stepPatrolMotion(depotConstruction, .05, movedStops, movedPatrolLayout);
  if (!depotConstruction.route.length && depotConstruction.wait > 0) depotVisits.add(depotConstruction.node);
}
if (!depotVisits.has('depot') || !depotVisits.has('camp')) throw new Error('Fixer must reach the Supply Depot build site and return to camp.');
const walledHallLayout = defaultLayout();
for (const [x, z] of [[0, 4], [4, 0], [-4, 0], [0, -4]]) walledHallLayout.walls.push({ id: `wall-${x}-${z}`, x, z, level: 1 });
const walledHallStop = patrolNodesForLayout(walledHallLayout).hall;
if (walledHallLayout.walls.some(wall => wall.x === walledHallStop[0] && wall.z === walledHallStop[1]) ||
    !walkablePatrolPath(PATROL_NODES.camp, walledHallStop, walledHallLayout)) throw new Error('A ring of wall segments must not put the Hall patrol stop inside a wall.');
const workingYardLayout = { ...defaultLayout(), yardAccessible: true };
const workingYardNodes = patrolNodesForLayout(workingYardLayout);
const yardMotion = setPatrolOrder(createPatrolMotion('engineer'), 'standard', ['workshop', 'yard', 'camp', 'workshop']);
const yardVisits = new Set();
for (let frame = 0; frame < 4800; frame++) {
  stepPatrolMotion(yardMotion, .05, workingYardNodes, workingYardLayout);
  if (!yardMotion.route.length && yardMotion.wait > 0) yardVisits.add(yardMotion.node);
  const site = workingYardLayout.structures['timberline-depot'];
  if (Math.abs(yardMotion.x - site.x) < 3.2 && Math.abs(yardMotion.z - site.z) < 3.2) throw new Error('Fixer walked through the Lumber Yard model.');
}
if (!yardVisits.has('yard') || !yardVisits.has('workshop') || !yardVisits.has('camp')) throw new Error('Fixer did not visit the completed Lumber Yard and return to camp.');
console.log('Dynamic patrol nodes and wall-avoiding grid paths verified.');
for (const role of Object.keys(DEFENDER_CONCEPTS)) for (const [post, node] of Object.entries(DEFENDER_POST_NODES)) {
  const motion = createDefenderMotion(role, post);
  const reached = new Set();
  let walking = 0, resting = 0;
  for (let frame = 0; frame < 3600; frame++) {
    stepPatrolMotion(motion, 0.05, patrolNodes, patrolLayout);
    if (motion.moving) walking++; else resting++;
    if (!motion.route.length && motion.wait > 0) reached.add(motion.node);
    for (const [x, z, size] of occupied) {
      const clearance = size / 2 + 0.15;
      if (Math.abs(motion.x - x) < clearance && Math.abs(motion.z - z) < clearance) throw new Error(`${role} crossed a building en route to ${post}`);
    }
  }
  if (!walking || !resting || !reached.has('camp') || !reached.has(node)) throw new Error(`${role} did not walk between camp and ${post}`);
}
console.log('DZN defenders verified: four 3D roles reach every assigned post and return to camp without crossing buildings.');
const defenderManifest = JSON.parse(readFileSync(join(root, 'assets/models/defenders/manifest.json'), 'utf8'));
const defenderHashes = new Set();
const defenderParts = {
  guardian: ['left_arm', 'right_arm', 'left_leg', 'right_leg', 'barrier_shield', 'barrier_body'],
  aegis: ['left_arm', 'right_arm', 'left_leg', 'right_leg', 'scanner', 'left_drone', 'right_drone'],
  trapper: ['left_arm', 'right_arm', 'left_leg', 'right_leg', 'snare_module_0', 'snare_module_1', 'snare_module_2',
    'snare_charge_0', 'snare_charge_1', 'snare_charge_2'],
  hound: ['hound_head', 'tail', 'left_front_leg', 'right_front_leg', 'left_rear_leg', 'right_rear_leg'],
};
if (Object.keys(defenderManifest.assets).length !== 20) throw new Error('Four DZN defenders need five 3D appearance tiers each.');
for (const role of Object.keys(DEFENDER_CONCEPTS)) for (let level = 1; level <= 5; level++) {
  const name = `${role}_l0${level}`;
  const entry = defenderManifest.assets[name];
  if (!entry || entry.file !== defenderAsset(role, level)) throw new Error(`Missing defender tier: ${name}`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid defender GLB: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const names = new Set((gltf.nodes || []).map(node => node.name));
  if (!gltf.meshes?.length || defenderParts[role].some(part => !names.has(part))) throw new Error(`Incomplete ${role} 3D geometry: ${name}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (entry.sha256 !== hash || entry.bytes !== bytes.length || defenderHashes.has(hash)) throw new Error(`Defender integrity or tier distinction failed: ${name}`);
  defenderHashes.add(hash);
}
const defenderArt = JSON.parse(readFileSync(join(root, 'assets/portraits/defenders/manifest.json'), 'utf8'));
if (Object.keys(defenderArt.assets).length !== 4) throw new Error('Four defender concept images are required.');
for (const role of Object.keys(DEFENDER_CONCEPTS)) {
  const entry = defenderArt.assets[role];
  if (!entry || entry.file !== defenderPortrait(role)) throw new Error(`Missing defender art: ${role}`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('latin1', 0, 4) !== '\x89PNG' || bytes.readUInt32BE(16) !== 1254 || bytes.readUInt32BE(20) !== 1254 || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Invalid defender portrait: ${role}`);
}
console.log('DZN defender concepts verified: 20 distinct 3D GLBs and four unchanged owner images.');
const portraitManifest = JSON.parse(readFileSync(join(root, 'assets/portraits/squads-final/manifest.json'), 'utf8'));
const portraits = Object.entries(portraitManifest.assets);
if (portraits.length !== 25 || portraitManifest.outputSize?.join('x') !== '768x768') throw new Error('DZN squad kit requires all 25 final detailed character portraits.');
const portraitHashes = new Set();
const sourceHashes = new Map();
for (const [name, entry] of portraits) {
  if (!squadManifest.assets[name] || entry.file !== squadPortrait(name.split('_')[0], Number(name.slice(-1)))) throw new Error(`Squad portrait does not match a model: ${name}`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.toString('latin1', 0, 4) !== '\x89PNG' || bytes.readUInt32BE(16) !== 768 || bytes.readUInt32BE(20) !== 768 || bytes[25] !== 6 || hash !== entry.sha256 || bytes.length !== entry.bytes || bytes.length < 250000 || portraitHashes.has(hash)) throw new Error(`Invalid final squad portrait: ${name}`);
  if (!/^[a-f0-9]{64}$/.test(entry.sourceSha256) || !Array.isArray(entry.bbox) || entry.bbox.length !== 4 || entry.opaquePixels < 25000) throw new Error(`Missing final squad provenance: ${name}`);
  if (!/^DZN [\w ,_-]+\.png$/.test(entry.source)) throw new Error(`Invalid source sheet name: ${name}`);
  const sourceHash = createHash('sha256').update(readFileSync(join(root, '..', 'source-art', 'squads', entry.source))).digest('hex');
  if (sourceHash !== entry.sourceSha256) throw new Error(`Original character sheet changed: ${name}`);
  if (sourceHashes.has(name.split('_')[0]) && sourceHashes.get(name.split('_')[0]) !== entry.sourceSha256) throw new Error(`Mixed character sheet source within role: ${name}`);
  sourceHashes.set(name.split('_')[0], entry.sourceSha256);
  portraitHashes.add(hash);
}
if (sourceHashes.size !== 5 || new Set(sourceHashes.values()).size !== 5) throw new Error('Final character portraits must come from five distinct owner-supplied sheets.');
console.log(`DZN squad portraits verified: ${portraits.length} distinct transparent 768x768 PNGs from five supplied character sheets.`);
