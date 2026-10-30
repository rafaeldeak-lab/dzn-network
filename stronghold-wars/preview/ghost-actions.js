import * as THREE from 'three';

const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const axisZ = new THREE.Vector3(0, 0, 1);
const lastBonePoses = new WeakMap();

export function ghostActionPose(time, moving, stop, signalAge = Infinity, reducedMotion = false) {
  if (reducedMotion) return { scanning: false, yaw: 0, tap: 0, signal: 0 };
  const scanning = !moving && stop === 'comms';
  const signal = Math.max(0, 1 - Math.max(0, signalAge) / .55);
  return {
    scanning,
    yaw: scanning ? Math.sin(time * .65) * .15 : 0,
    tap: scanning ? Math.sin(time * 2.2) * .065 : signal ? Math.sin((1 - signal) * Math.PI) * .09 : 0,
    signal,
  };
}

function poseBone(model, name, rotations) {
  const bone = model.getObjectByName(name);
  if (!bone) return;
  const previous = lastBonePoses.get(bone);
  // The mixer writes an animated base each frame. If no mixer ran, remove our
  // previous offset before applying the next one so idle poses cannot drift.
  const base = previous && bone.quaternion.angleTo(previous.output) < 1e-6
    ? previous.base.clone() : bone.quaternion.clone();
  bone.quaternion.copy(base);
  for (const [axis, radians] of rotations) if (radians) {
    bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, radians));
  }
  lastBonePoses.set(bone, { base, output: bone.quaternion.clone() });
}

export function applyGhostAction(model, pose) {
  if (!model || !pose) return;
  poseBone(model, 'Spine', [[axisY, pose.yaw * .3]]);
  poseBone(model, 'Neck', [[axisY, pose.yaw * .7]]);
  poseBone(model, 'Hand_R', [[axisX, pose.tap], [axisZ, pose.tap * .3]]);
}

export function ghostScannerPosition(soldier, target = new THREE.Vector3()) {
  const hand = soldier.getObjectByName('squad_model')?.getObjectByName('Hand_R');
  if (!hand) return target.copy(soldier.position).add(new THREE.Vector3(0, 1.1, 0));
  hand.getWorldPosition(target);
  return target.add(new THREE.Vector3(0, .08, .05).applyQuaternion(soldier.getWorldQuaternion(new THREE.Quaternion())));
}

export function clearGhostScan(soldier) {
  const scan = soldier.userData.ghostScan;
  if (!scan) return;
  scan.ring.parent?.remove(scan.ring);
  scan.ring.geometry.dispose();
  scan.ring.material.dispose();
  soldier.userData.ghostScan = null;
}

export function stepGhostScan(soldier, time, scanning, reducedMotion = false) {
  let scan = soldier.userData.ghostScan;
  if (!scan && scanning && !reducedMotion) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.48, .014, 6, 48),
      new THREE.MeshBasicMaterial({ color: 0xba91ff, transparent: true, opacity: 0, depthWrite: false }));
    ring.name = 'ghost_signal_sweep';
    ring.rotation.x = Math.PI / 2;
    ring.position.y = .055;
    soldier.add(ring);
    scan = soldier.userData.ghostScan = { ring };
  }
  if (!scan) return;
  scan.ring.visible = Boolean(scanning && !reducedMotion);
  if (!scan.ring.visible) return;
  const cycle = ((time / 3.6) % 1 + 1) % 1;
  scan.ring.scale.setScalar(.3 + cycle * 3.7);
  scan.ring.material.opacity = .48 * (1 - cycle);
}

export function clearGhostUpgradeReveal(soldier) {
  const reveal = soldier.userData.ghostReveal;
  if (!reveal) return;
  reveal.root.parent?.remove(reveal.root);
  reveal.root.traverse(object => { object.geometry?.dispose(); });
  reveal.lime.dispose(); reveal.violet.dispose();
  soldier.userData.ghostReveal = null;
}

export function startGhostUpgradeReveal(soldier, tier) {
  clearGhostUpgradeReveal(soldier);
  const root = new THREE.Group(); root.name = 'ghost_upgrade_reveal'; soldier.add(root);
  const lime = new THREE.MeshBasicMaterial({ color: 0xb5ff5c, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide });
  const violet = new THREE.MeshBasicMaterial({ color: 0xb88cff, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.45, .023, 8, 48), violet);
  ring.rotation.x = Math.PI / 2; ring.position.y = .06; root.add(ring);
  const signals = [];
  for (let i = 0; i < 4 + tier; i++) {
    const signal = new THREE.Mesh(new THREE.OctahedronGeometry(.035, 0), i % 2 ? lime : violet);
    root.add(signal); signals.push(signal);
  }
  soldier.userData.ghostReveal = { root, ring, signals, lime, violet, age: 0, tier };
  return soldier.userData.ghostReveal;
}

export function stepGhostUpgradeReveal(soldier, dt, reducedMotion = false) {
  const reveal = soldier.userData.ghostReveal;
  if (!reveal) return false;
  if (reducedMotion) { clearGhostUpgradeReveal(soldier); return false; }
  reveal.age += Math.max(0, dt);
  const progress = Math.min(1, reveal.age / 1.55);
  if (progress >= 1) { clearGhostUpgradeReveal(soldier); return false; }
  reveal.ring.scale.setScalar(.5 + progress * 2.5);
  reveal.ring.rotation.z = progress * Math.PI;
  reveal.lime.opacity = .8 * (1 - progress);
  reveal.violet.opacity = .85 * (1 - progress);
  reveal.signals.forEach((signal, index) => {
    const angle = index / reveal.signals.length * Math.PI * 2 + progress;
    signal.position.set(Math.cos(angle) * (.3 + progress * .65), .2 + progress * 1.45, Math.sin(angle) * (.3 + progress * .65));
  });
  return true;
}
