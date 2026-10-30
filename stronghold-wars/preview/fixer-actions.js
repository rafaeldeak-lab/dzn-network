import * as THREE from 'three';

const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const lastBonePoses = new WeakMap();

export function fixerActionPose(time, moving, stop, breachAge = Infinity, reducedMotion = false) {
  if (reducedMotion) return { task: null, arm: 0, hand: 0, support: 0, look: 0, breach: 0 };
  const task = !moving && ['workshop', 'hall', 'yard'].includes(stop) ? stop : null;
  const breach = Math.max(0, 1 - Math.max(0, breachAge) / .65);
  const tempo = task === 'yard' ? 3.4 : 4.6;
  const stroke = task ? Math.sin(time * tempo) : 0;
  return {
    task,
    arm: task === 'yard' ? -.14 + stroke * .12 : task ? -.1 + stroke * .08 : breach ? -.16 * breach : 0,
    hand: task === 'yard' ? .03 + stroke * .08 : task ? stroke * .07 : breach ? .08 * breach : 0,
    support: task === 'yard' ? -.07 - stroke * .04 : task ? -.06 - stroke * .035 : 0,
    look: task ? Math.sin(time * .7) * .045 : 0,
    breach,
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

export function applyFixerAction(model, pose) {
  if (!model || !pose) return;
  poseBone(model, 'UpperArm_L', [[axisX, pose.arm]]);
  poseBone(model, 'Hand_L', [[axisX, pose.hand]]);
  poseBone(model, 'UpperArm_R', [[axisX, pose.support]]);
  poseBone(model, 'Neck', [[axisY, pose.look]]);
}

export function fixerToolPosition(soldier, target = new THREE.Vector3()) {
  const hand = soldier.getObjectByName('squad_model')?.getObjectByName('Hand_L');
  if (!hand) return target.copy(soldier.position).add(new THREE.Vector3(0, 1.1, 0));
  hand.getWorldPosition(target);
  return target.add(new THREE.Vector3(0, -.08, .17).applyQuaternion(soldier.getWorldQuaternion(new THREE.Quaternion())));
}

export function clearFixerWork(soldier) {
  const work = soldier.userData.fixerWork;
  if (!work) return;
  work.root.parent?.remove(work.root);
  work.root.traverse(object => object.geometry?.dispose());
  work.material.dispose();
  soldier.userData.fixerWork = null;
}

export function stepFixerWork(soldier, time, task, tier = 1, reducedMotion = false) {
  let work = soldier.userData.fixerWork;
  if (!work && task && !reducedMotion) {
    const root = new THREE.Group(); root.name = 'fixer_tool_activity'; soldier.add(root);
    const material = new THREE.MeshBasicMaterial({ color: 0xffb34f, transparent: true, opacity: .75, depthWrite: false });
    const particles = [];
    for (let i = 0; i < 2 + Math.min(5, tier); i++) {
      const particle = new THREE.Mesh(new THREE.OctahedronGeometry(.02 + i % 2 * .008, 0), material);
      root.add(particle); particles.push(particle);
    }
    work = soldier.userData.fixerWork = { root, material, particles };
  }
  if (!work) return;
  work.root.visible = Boolean(task && !reducedMotion);
  if (!work.root.visible) return;
  soldier.updateMatrixWorld(true);
  const origin = soldier.worldToLocal(fixerToolPosition(soldier));
  work.material.color.setHex(task === 'yard' ? 0xd4a673 : 0xffb34f);
  work.particles.forEach((particle, index) => {
    const cycle = ((time * (task === 'yard' ? 1.8 : 2.6) + index / work.particles.length) % 1 + 1) % 1;
    const spread = .045 + cycle * .22;
    particle.position.set(origin.x + Math.cos(index * 2.4) * spread,
      origin.y + (task === 'yard' ? -cycle * .26 : cycle * .19),
      origin.z + Math.sin(index * 2.4) * spread);
    particle.scale.setScalar(1 - cycle * .7);
  });
}

export function clearFixerUpgradeReveal(soldier) {
  const reveal = soldier.userData.fixerReveal;
  if (!reveal) return;
  reveal.root.parent?.remove(reveal.root);
  reveal.root.traverse(object => object.geometry?.dispose());
  reveal.material.dispose();
  soldier.userData.fixerReveal = null;
}

export function startFixerUpgradeReveal(soldier, tier) {
  clearFixerUpgradeReveal(soldier);
  const root = new THREE.Group(); root.name = 'fixer_upgrade_reveal'; soldier.add(root);
  const material = new THREE.MeshBasicMaterial({ color: 0xffb34f, transparent: true, opacity: .8, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.48, .023, 8, 48), material);
  ring.rotation.x = Math.PI / 2; ring.position.y = .06; root.add(ring);
  const sparks = [];
  for (let i = 0; i < 3 + tier; i++) {
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(.035, 0), material);
    root.add(spark); sparks.push(spark);
  }
  soldier.userData.fixerReveal = { root, ring, sparks, material, age: 0 };
  return soldier.userData.fixerReveal;
}

export function stepFixerUpgradeReveal(soldier, dt, reducedMotion = false) {
  const reveal = soldier.userData.fixerReveal;
  if (!reveal) return false;
  if (reducedMotion) { clearFixerUpgradeReveal(soldier); return false; }
  reveal.age += Math.max(0, dt);
  const progress = Math.min(1, reveal.age / 1.5);
  if (progress >= 1) { clearFixerUpgradeReveal(soldier); return false; }
  reveal.ring.scale.setScalar(.5 + progress * 2.1);
  reveal.material.opacity = .8 * (1 - progress);
  reveal.sparks.forEach((spark, index) => {
    const angle = index / reveal.sparks.length * Math.PI * 2 + progress;
    spark.position.set(Math.cos(angle) * (.3 + progress * .55), .12 + progress * 1.4, Math.sin(angle) * (.3 + progress * .55));
  });
  return true;
}
