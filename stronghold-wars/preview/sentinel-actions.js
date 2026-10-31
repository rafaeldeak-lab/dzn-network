import * as THREE from 'three';

const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const axisZ = new THREE.Vector3(0, 0, 1);
const restQuaternions = new WeakMap();

// Apply these offsets after the imported clip has posed the skeleton. The
// rifle and both gloves are skinned to the same upper-body chain, so turning
// that chain keeps the two-handed grip together.
export function sentinelActionPose(time, moving, stop, fireAge = Infinity, reducedMotion = false) {
  if (reducedMotion) return { scan: 0, lean: 0, recoil: 0, braced: false };
  const braced = !moving && (stop === 'tower' || stop === 'hall');
  const shot = Math.max(0, 1 - Math.max(0, fireAge) / .34);
  return {
    scan: braced ? Math.sin(time * .68) * .21 : 0,
    lean: braced ? Math.sin(time * .45) * .018 : 0,
    recoil: shot ? Math.sin((1 - shot) * Math.PI) * .09 : 0,
    braced,
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

export function applySentinelAction(model, pose) {
  if (!model || !pose) return;
  poseBone(model, 'Spine', [[axisY, pose.scan * .28], [axisZ, pose.lean]]);
  poseBone(model, 'Neck', [[axisY, pose.scan * .72]]);
  poseBone(model, 'Chest', [[axisX, -pose.recoil]]);
}

export function sentinelMuzzlePosition(soldier, target = new THREE.Vector3()) {
  const hand = soldier.getObjectByName('squad_model')?.getObjectByName('Hand_R');
  if (!hand) return target.copy(soldier.position).add(new THREE.Vector3(0, 1.15, 0));
  hand.getWorldPosition(target);
  const forward = new THREE.Vector3(0, 0, .36).applyQuaternion(soldier.getWorldQuaternion(new THREE.Quaternion()));
  return target.add(forward);
}

function disposeReveal(reveal) {
  if (!reveal) return;
  reveal.root.parent?.remove(reveal.root);
  reveal.root.traverse(object => {
    object.geometry?.dispose();
    if (object.material) object.material.dispose();
  });
}

export function clearSentinelUpgradeReveal(soldier) {
  disposeReveal(soldier.userData.sentinelReveal);
  soldier.userData.sentinelReveal = null;
}

export function startSentinelUpgradeReveal(soldier, tier) {
  clearSentinelUpgradeReveal(soldier);
  const root = new THREE.Group();
  root.name = 'sentinel_upgrade_reveal';
  soldier.add(root);
  const lime = new THREE.MeshBasicMaterial({ color: 0xb5ff5c, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide });
  const violet = new THREE.MeshBasicMaterial({ color: 0xb979f2, transparent: true, opacity: .65, depthWrite: false, side: THREE.DoubleSide });
  const ground = new THREE.Mesh(new THREE.TorusGeometry(.57, .027, 8, 48), lime);
  ground.rotation.x = Math.PI / 2;
  ground.position.y = .06;
  root.add(ground);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(.55, .018, 8, 48), violet);
  halo.position.y = .92;
  root.add(halo);
  const sparks = [];
  for (let i = 0; i < 5 + tier; i++) {
    const spark = new THREE.Mesh(new THREE.SphereGeometry(.038, 6, 5), i % 2 ? violet : lime);
    root.add(spark);
    sparks.push(spark);
  }
  soldier.userData.sentinelReveal = { root, ground, halo, sparks, lime, violet, age: 0, tier };
  return soldier.userData.sentinelReveal;
}

export function stepSentinelUpgradeReveal(soldier, dt, reducedMotion = false) {
  const reveal = soldier.userData.sentinelReveal;
  if (!reveal) return false;
  if (reducedMotion) { clearSentinelUpgradeReveal(soldier); return false; }
  reveal.age += Math.max(0, dt);
  const progress = Math.min(1, reveal.age / 1.6);
  if (progress >= 1) { clearSentinelUpgradeReveal(soldier); return false; }
  const surge = Math.sin(progress * Math.PI);
  reveal.ground.scale.setScalar(.55 + progress * 1.35);
  reveal.halo.position.y = .3 + progress * 1.45;
  reveal.halo.rotation.z = progress * Math.PI * 1.5;
  reveal.halo.scale.setScalar(.6 + surge * .45);
  reveal.lime.opacity = .85 * (1 - progress);
  reveal.violet.opacity = .7 * (1 - progress);
  reveal.sparks.forEach((spark, index) => {
    const angle = index / reveal.sparks.length * Math.PI * 2 + progress * 2;
    spark.position.set(Math.cos(angle) * (.42 + progress * .55), .25 + progress * 1.6, Math.sin(angle) * (.42 + progress * .55));
  });
  return true;
}
