import * as THREE from 'three';

const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const axisZ = new THREE.Vector3(0, 0, 1);
const restQuaternions = new WeakMap();

const rifleGrip = [
  ['UpperArm_R', .62, -.35, -.6],
  ['Forearm_R', .45, -.1, -.35],
  ['UpperArm_L', .7, .35, .6],
  ['Forearm_L', .28, .1, .35],
];

export function wardenActionPose(time, moving, fireAge = Infinity, reducedMotion = false) {
  const shot = reducedMotion ? 0 : Math.max(0, 1 - Math.max(0, fireAge) / .32);
  return {
    scan: reducedMotion || moving ? 0 : Math.sin(time * .55) * .13,
    recoil: shot ? Math.sin((1 - shot) * Math.PI) * .075 : 0,
  };
}

function poseBone(model, name, rotations) {
  const bone = model.getObjectByName(name);
  if (!bone) return;
  if (!restQuaternions.has(bone)) restQuaternions.set(bone, bone.quaternion.clone());
  bone.quaternion.copy(restQuaternions.get(bone));
  for (const [axis, radians] of rotations) if (radians) {
    bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, radians));
  }
}

export function applyWardenAction(model, pose) {
  if (!model || !pose) return;
  for (const [name, forward, across, tuck] of rifleGrip) {
    poseBone(model, name, [[axisX, tuck], [axisY, across], [axisZ, forward]]);
  }
  poseBone(model, 'Spine', [[axisY, pose.scan]]);
  poseBone(model, 'Chest', [[axisX, -pose.recoil]]);
}

export function wardenMuzzlePosition(soldier, target = new THREE.Vector3()) {
  const hand = soldier.getObjectByName('squad_model')?.getObjectByName('Hand_R');
  if (!hand) return target.copy(soldier.position).add(new THREE.Vector3(0, 1.15, 0));
  hand.getWorldPosition(target);
  return target.add(new THREE.Vector3(0, 0, .42).applyQuaternion(soldier.getWorldQuaternion(new THREE.Quaternion())));
}

export function clearWardenUpgradeReveal(soldier) {
  const reveal = soldier.userData.wardenReveal;
  if (!reveal) return;
  reveal.root.parent?.remove(reveal.root);
  reveal.root.traverse(object => { object.geometry?.dispose(); });
  reveal.lime.dispose();
  reveal.violet.dispose();
  soldier.userData.wardenReveal = null;
}

export function startWardenUpgradeReveal(soldier, tier) {
  clearWardenUpgradeReveal(soldier);
  const root = new THREE.Group(); root.name = 'warden_upgrade_reveal'; soldier.add(root);
  const lime = new THREE.MeshBasicMaterial({ color: 0xb5ff5c, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide });
  const violet = new THREE.MeshBasicMaterial({ color: 0xb976f2, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.48, .025, 8, 48), violet);
  ring.rotation.x = Math.PI / 2; ring.position.y = .06; root.add(ring);
  const sparks = [];
  for (let i = 0; i < 6 + tier; i++) {
    const spark = new THREE.Mesh(new THREE.SphereGeometry(.034, 6, 5), i % 2 ? lime : violet);
    root.add(spark); sparks.push(spark);
  }
  soldier.userData.wardenReveal = { root, ring, sparks, lime, violet, age: 0, tier };
  return soldier.userData.wardenReveal;
}

export function stepWardenUpgradeReveal(soldier, dt, reducedMotion = false) {
  const reveal = soldier.userData.wardenReveal;
  if (!reveal) return false;
  if (reducedMotion) { clearWardenUpgradeReveal(soldier); return false; }
  reveal.age += Math.max(0, dt);
  const progress = Math.min(1, reveal.age / 1.4);
  if (progress >= 1) { clearWardenUpgradeReveal(soldier); return false; }
  reveal.ring.scale.setScalar(.65 + progress * 1.3);
  reveal.ring.rotation.z = progress * Math.PI * 1.4;
  reveal.lime.opacity = .9 * (1 - progress);
  reveal.violet.opacity = .8 * (1 - progress);
  reveal.sparks.forEach((spark, index) => {
    const angle = index / reveal.sparks.length * Math.PI * 2 + progress * 2;
    spark.position.set(Math.cos(angle) * (.25 + progress * .55), .3 + progress * 1.55, Math.sin(angle) * (.25 + progress * .55));
  });
  return true;
}
