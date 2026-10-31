import * as THREE from 'three';

const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const lastBonePoses = new WeakMap();

export function lifelineActionPose(time, moving, stop, treatmentAge = Infinity, reducedMotion = false) {
  if (reducedMotion) return { triage: false, treating: 0, arm: 0, wrist: 0, support: 0, look: 0 };
  const triage = !moving && (stop === 'workshop' || stop === 'camp');
  const treating = Math.max(0, 1 - Math.max(0, treatmentAge) / .75);
  const cycle = Math.sin(time * 2.4);
  return {
    triage, treating,
    arm: triage ? -.12 + cycle * .08 : treating ? -.18 * treating : 0,
    wrist: triage ? .04 + cycle * .055 : treating ? .12 * Math.sin((1 - treating) * Math.PI) : 0,
    support: triage ? -.08 - cycle * .045 : treating ? -.08 * treating : 0,
    look: triage ? Math.sin(time * .8) * .045 : 0,
  };
}

function poseBone(model, name, rotations) {
  const bone = model.getObjectByName(name);
  if (!bone) return;
  const previous = lastBonePoses.get(bone);
  const base = previous && bone.quaternion.angleTo(previous.output) < 1e-6
    ? previous.base.clone() : bone.quaternion.clone();
  bone.quaternion.copy(base);
  for (const [axis, angle] of rotations) if (angle) {
    bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  }
  lastBonePoses.set(bone, { base, output: bone.quaternion.clone() });
}

export function applyLifelineAction(model, pose) {
  if (!model || !pose) return;
  poseBone(model, 'UpperArm_R', [[axisX, pose.arm]]);
  poseBone(model, 'Hand_R', [[axisX, pose.wrist]]);
  poseBone(model, 'UpperArm_L', [[axisX, pose.support]]);
  poseBone(model, 'Neck', [[axisY, pose.look]]);
}

export function lifelineInjectorPosition(soldier, target = new THREE.Vector3()) {
  const hand = soldier.getObjectByName('squad_model')?.getObjectByName('Hand_R');
  if (!hand) return target.copy(soldier.position).add(new THREE.Vector3(0, 1.1, 0));
  hand.getWorldPosition(target);
  // This image-guided rig's right-hand joint sits beyond the injector mesh.
  // Pull the effect inward to the visible nozzle rather than the raw joint.
  return target.add(new THREE.Vector3(-.37, .11, .36).applyQuaternion(soldier.getWorldQuaternion(new THREE.Quaternion())));
}

export function clearLifelineTriage(soldier) {
  const triage = soldier.userData.lifelineTriage;
  if (!triage) return;
  triage.root.parent?.remove(triage.root);
  triage.root.traverse(object => object.geometry?.dispose());
  triage.material.dispose();
  soldier.userData.lifelineTriage = null;
}

export function stepLifelineTriage(soldier, time, active, tier = 1, reducedMotion = false) {
  let triage = soldier.userData.lifelineTriage;
  if (!triage && active && !reducedMotion) {
    const root = new THREE.Group(); root.name = 'lifeline_injector_activity'; soldier.add(root);
    const material = new THREE.MeshBasicMaterial({ color: 0x8af8bd, transparent: true, opacity: .8, depthWrite: false });
    const motes = [];
    for (let index = 0; index < 2 + tier; index++) {
      const mote = new THREE.Mesh(new THREE.OctahedronGeometry(.015 + index % 2 * .006, 0), material);
      root.add(mote); motes.push(mote);
    }
    triage = soldier.userData.lifelineTriage = { root, material, motes };
  }
  if (!triage) return;
  triage.root.visible = Boolean(active && !reducedMotion);
  if (!triage.root.visible) return;
  soldier.updateMatrixWorld(true);
  const origin = soldier.worldToLocal(lifelineInjectorPosition(soldier));
  triage.motes.forEach((mote, index) => {
    const cycle = ((time * 1.3 + index / triage.motes.length) % 1 + 1) % 1;
    mote.position.set(origin.x + Math.cos(index * 2.4) * (.025 + cycle * .065),
      origin.y + cycle * .22, origin.z + Math.sin(index * 2.4) * (.025 + cycle * .065));
    mote.scale.setScalar(1 - cycle * .7);
  });
}

export function clearLifelineUpgradeReveal(soldier) {
  const reveal = soldier.userData.lifelineReveal;
  if (!reveal) return;
  reveal.root.parent?.remove(reveal.root);
  reveal.root.traverse(object => object.geometry?.dispose());
  reveal.material.dispose();
  soldier.userData.lifelineReveal = null;
}

export function startLifelineUpgradeReveal(soldier, tier) {
  clearLifelineUpgradeReveal(soldier);
  const root = new THREE.Group(); root.name = 'lifeline_upgrade_reveal'; soldier.add(root);
  const material = new THREE.MeshBasicMaterial({ color: 0x8af8bd, transparent: true, opacity: .8, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.43, .022, 8, 48), material);
  ring.rotation.x = Math.PI / 2; ring.position.y = .06; root.add(ring);
  const motes = [];
  for (let index = 0; index < 3 + tier; index++) {
    const mote = new THREE.Mesh(new THREE.OctahedronGeometry(.028, 0), material);
    root.add(mote); motes.push(mote);
  }
  soldier.userData.lifelineReveal = { root, ring, motes, material, age: 0 };
  return soldier.userData.lifelineReveal;
}

export function stepLifelineUpgradeReveal(soldier, dt, reducedMotion = false) {
  const reveal = soldier.userData.lifelineReveal;
  if (!reveal) return false;
  if (reducedMotion) { clearLifelineUpgradeReveal(soldier); return false; }
  reveal.age += Math.max(0, dt);
  const progress = Math.min(1, reveal.age / 1.55);
  if (progress >= 1) { clearLifelineUpgradeReveal(soldier); return false; }
  reveal.ring.scale.setScalar(.6 + progress * 2.1);
  reveal.material.opacity = .8 * (1 - progress);
  reveal.motes.forEach((mote, index) => {
    const angle = index / reveal.motes.length * Math.PI * 2 + progress;
    mote.position.set(Math.cos(angle) * (.24 + progress * .62), .2 + progress * 1.5,
      Math.sin(angle) * (.24 + progress * .62));
  });
  return true;
}
