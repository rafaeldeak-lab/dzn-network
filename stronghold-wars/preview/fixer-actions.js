import * as THREE from 'three';

const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const meshyFixerBones = {
  UpperArm_L: 'mixamorig:LeftArm', Hand_L: 'mixamorig:LeftHand',
  UpperArm_R: 'mixamorig:RightArm', Neck: 'mixamorig:Neck',
};
const lastBonePoses = new WeakMap();
const clamp01 = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };

function woodTexture(cut = false) {
  if (typeof document === 'undefined') {
    const color = cut ? [182, 138, 85, 255] : [85, 57, 35, 255];
    const texture = new THREE.DataTexture(new Uint8Array(color), 1, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = cut ? '#b68a55' : '#553923';
  ctx.fillRect(0, 0, 256, 256);
  if (cut) {
    for (let ring = 1; ring <= 10; ring++) {
      ctx.beginPath();
      ctx.ellipse(128, 128, ring * 11.2, ring * 10.5, ring * .04, 0, Math.PI * 2);
      ctx.strokeStyle = ring % 2 ? '#8e643b' : '#d1a66b';
      ctx.lineWidth = ring % 3 ? 2 : 3;
      ctx.stroke();
    }
  } else for (let stripe = 0; stripe < 75; stripe++) {
    const x = stripe * 29 % 256;
    const offset = stripe * 41 % 61;
    ctx.beginPath();
    ctx.moveTo(x, -15);
    ctx.bezierCurveTo(x + offset / 6, 65, x - offset / 5, 168, x + offset / 7, 271);
    ctx.strokeStyle = stripe % 3 ? '#8b5d38' : '#30251c';
    ctx.lineWidth = stripe % 4 ? 2 : 4;
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function chopCycle(time) {
  const phase = ((time * .58) % 1 + 1) % 1;
  const lift = ease(phase / .34);
  const strike = ease((phase - .43) / .16);
  const recover = ease((phase - .82) / .18);
  return { phase, arm: -.08 - .18 * lift + .28 * strike - .1 * recover,
    hand: -.02 * lift + .05 * strike - .03 * recover,
    impact: phase >= .56 && phase < .8 ? Math.sin((phase - .56) / .24 * Math.PI) : 0,
    split: phase >= .59 ? ease((phase - .59) / .2) : 0 };
}

export function fixerTaskForStop(stop, construction, now, allowed, timber = null) {
  if (!allowed || !stop) return null;
  if (stop === 'yard' && !(timber?.perMinute > 0 && timber.stored < timber.capacity)) return null;
  if (stop === 'depot' && !(timber?.stored > 0)) return null;
  if (stop === construction?.stop && now < construction.finishAt) return 'construction';
  return stop;
}

export function fixerActionPose(time, moving, stop, breachAge = Infinity, reducedMotion = false) {
  if (reducedMotion) return { task: null, arm: 0, hand: 0, support: 0, look: 0, breach: 0 };
  const task = !moving && ['workshop', 'hall', 'yard', 'depot', 'construction'].includes(stop) ? stop : null;
  const breach = Math.max(0, 1 - Math.max(0, breachAge) / .65);
  const tempo = 4.6;
  const stroke = task ? Math.sin(time * tempo) : 0;
  const chop = task === 'yard' ? chopCycle(time) : null;
  return {
    task,
    arm: chop ? chop.arm : task ? -.1 + stroke * .08 : breach ? -.16 * breach : 0,
    hand: chop ? chop.hand : task ? stroke * .07 : breach ? .08 * breach : 0,
    support: chop ? -.08 - chop.impact * .04 : task ? -.06 - stroke * .035 : 0,
    look: task ? Math.sin(time * .7) * .045 : 0,
    breach,
  };
}

function poseBone(model, name, rotations) {
  const bone = model.getObjectByName(name) || model.getObjectByName(meshyFixerBones[name]);
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
  const model = soldier.getObjectByName('squad_model');
  const hand = model?.getObjectByName('Hand_L') || model?.getObjectByName('mixamorig:LeftHand');
  if (!hand) return target.copy(soldier.position).add(new THREE.Vector3(0, 1.1, 0));
  hand.getWorldPosition(target);
  return target.add(new THREE.Vector3(0, -.08, .17).applyQuaternion(soldier.getWorldQuaternion(new THREE.Quaternion())));
}

export function clearFixerWork(soldier) {
  const work = soldier.userData.fixerWork;
  if (!work) return;
  work.root.parent?.remove(work.root);
  work.root.traverse(object => object.geometry?.dispose());
  for (const material of work.materials) material.dispose();
  for (const texture of work.textures) texture.dispose();
  soldier.userData.fixerWork = null;
}

export function stepFixerWork(soldier, time, task, tier = 1, reducedMotion = false) {
  let work = soldier.userData.fixerWork;
  if (work && work.tier !== tier) {
    clearFixerWork(soldier);
    work = null;
  }
  if (!work && task && !reducedMotion) {
    const root = new THREE.Group(); root.name = 'fixer_tool_activity'; soldier.add(root);
    // Meshy's left glove sits across the model from the old rig's left glove.
    // Keep the work station on the tool side without changing the source mesh.
    if (soldier.getObjectByName('mixamorig:LeftHand')) root.scale.x = -1;
    const material = new THREE.MeshBasicMaterial({ color: 0xffb34f, transparent: true, opacity: .75, depthWrite: false });
    const barkMap = woodTexture();
    const endMap = woodTexture(true);
    const bark = new THREE.MeshStandardMaterial({ map: barkMap, roughness: 1 });
    const timber = new THREE.MeshStandardMaterial({ map: endMap, roughness: .95 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x4e5552, metalness: .7, roughness: .45 });
    const light = new THREE.MeshStandardMaterial({ color: 0xffba65, emissive: 0xff8b32, emissiveIntensity: 1.5 });
    const yard = new THREE.Group(); yard.name = 'fixer_chopping_station'; root.add(yard);
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(.15, .18, .36, 24), [bark, timber, bark]);
    stump.position.set(-.18, .18, .42); yard.add(stump);
    const whole = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .4, 20), [bark, timber, timber]);
    whole.rotation.x = Math.PI / 2; whole.position.set(-.18, .46, .42); yard.add(whole);
    const halves = [];
    for (const side of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .4, 20, 1, false,
        side < 0 ? 0 : Math.PI, Math.PI), [bark, timber, timber]);
      half.rotation.x = Math.PI / 2;
      yard.add(half); halves.push(half);
    }
    const outputPlanks = [];
    if (tier >= 2) {
      const outline = new THREE.Shape();
      outline.moveTo(-.14, -.038); outline.lineTo(.14, -.038);
      outline.lineTo(.14, .038); outline.lineTo(-.14, .038); outline.closePath();
      const plankGeometry = new THREE.ExtrudeGeometry(outline, {
        depth: .034, bevelEnabled: true, bevelThickness: .005,
        bevelSize: .006, bevelSegments: 2, curveSegments: 4,
      });
      for (let row = 0; row < Math.min(4, tier + 1); row++) {
        const plank = new THREE.Mesh(plankGeometry, [timber, bark]);
        plank.rotation.x = Math.PI / 2;
        yard.add(plank); outputPlanks.push(plank);
      }
    }
    const depot = new THREE.Group(); depot.name = 'fixer_depot_delivery'; root.add(depot);
    const deliveryPlanks = [];
    const pallet = new THREE.Mesh(new THREE.CylinderGeometry(.34, .36, .075, 8), steel);
    pallet.scale.z = .55; pallet.position.set(.78, .065, .55); depot.add(pallet);
    const depotShape = new THREE.Shape();
    depotShape.moveTo(-.17, -.035); depotShape.lineTo(.17, -.035);
    depotShape.lineTo(.17, .035); depotShape.lineTo(-.17, .035); depotShape.closePath();
    const deliveryGeometry = new THREE.ExtrudeGeometry(depotShape, {
      depth: .038, bevelEnabled: true, bevelThickness: .006,
      bevelSize: .007, bevelSegments: 2,
    });
    for (let index = 0; index < Math.min(5, tier + 1); index++) {
      const plank = new THREE.Mesh(deliveryGeometry, [timber, bark]);
      plank.rotation.x = Math.PI / 2;
      depot.add(plank); deliveryPlanks.push(plank);
    }
    const clamps = [];
    if (tier >= 3) for (const side of [-1, 1]) {
      const clamp = new THREE.Group();
      clamp.position.set(-.18 + side * .19, .4, .42);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(.013, .013, .34, 12), steel);
      rail.rotation.x = Math.PI / 2; clamp.add(rail);
      const jaw = new THREE.Mesh(new THREE.CylinderGeometry(.026, .026, .06, 12), steel);
      jaw.rotation.z = Math.PI / 2; jaw.position.x = -side * .025; clamp.add(jaw);
      yard.add(clamp); clamps.push(clamp);
    }
    let feedWheel = null;
    if (tier >= 4) {
      feedWheel = new THREE.Mesh(new THREE.CylinderGeometry(.065, .065, .035, 16), steel);
      feedWheel.rotation.x = Math.PI / 2;
      feedWheel.position.set(.04, .49, .42); yard.add(feedWheel);
    }
    let guide = null;
    if (tier >= 5) {
      guide = new THREE.Mesh(new THREE.SphereGeometry(.025, 12, 10), light);
      guide.position.set(-.18, .58, .42); yard.add(guide);
    }
    const particles = [];
    for (let i = 0; i < 2 + Math.min(5, tier); i++) {
      const particle = new THREE.Mesh(new THREE.OctahedronGeometry(.02 + i % 2 * .008, 0), material);
      root.add(particle); particles.push(particle);
    }
    work = soldier.userData.fixerWork = { root, material, materials: [material, bark, timber, steel, light],
      textures: [barkMap, endMap],
      particles, yard, depot, deliveryPlanks, whole, halves, outputPlanks, clamps, feedWheel, guide, tier };
  }
  if (!work) return;
  work.root.visible = Boolean(task && !reducedMotion);
  if (!work.root.visible) return;
  work.yard.visible = task === 'yard';
  work.depot.visible = task === 'depot';
  const chop = task === 'yard' ? chopCycle(time) : null;
  if (work.feedWheel) work.feedWheel.rotation.z = time * .9;
  work.whole.visible = !chop || chop.phase < .59;
  work.halves.forEach((half, index) => {
    half.visible = Boolean(chop && chop.phase >= .59);
    half.position.set(-.18 + (index ? 1 : -1) * (.018 + (chop?.split || 0) * .08),
      .46 + (chop?.split || 0) * .012, .42);
    half.rotation.y = (index ? 1 : -1) * (chop?.split || 0) * .18;
  });
  work.outputPlanks.forEach((plank, index) => {
    const delivery = chop ? ease((chop.phase - .62 - index * .035) / .23) : 0;
    plank.visible = Boolean(chop && chop.phase >= .62 + index * .035);
    plank.position.set(-.53 - delivery * .14, .055 + index * .043,
      .4 + index % 2 * .024);
    plank.rotation.z = (1 - delivery) * -.08;
  });
  const deliveryPhase = ((time * .43) % 1 + 1) % 1;
  work.deliveryPlanks.forEach((plank, index) => {
    const threshold = .12 + index * .14;
    const progress = ease((deliveryPhase - threshold) / .09);
    plank.visible = task === 'depot' && deliveryPhase >= threshold;
    plank.position.set(.78, .14 + index * .048 + (1 - progress) * .09, .55 + index % 2 * .025);
    plank.rotation.z = (1 - progress) * -.08;
  });
  work.clamps.forEach((clamp, index) => {
    const open = chop ? ease((chop.phase - .48) / .15) : 0;
    clamp.position.x = -.18 + (index ? 1 : -1) * (.19 + open * .045);
  });
  if (work.guide) {
    const pulse = chop?.impact || 0;
    work.guide.scale.setScalar(1 + pulse * 1.3);
    work.guide.material.emissiveIntensity = .5 + pulse * 2.2;
  }
  soldier.updateMatrixWorld(true);
  const origin = chop ? new THREE.Vector3(-.18, .55, .42) : soldier.worldToLocal(fixerToolPosition(soldier));
  if (!chop) origin.x /= work.root.scale.x;
  work.material.color.setHex(task === 'yard' ? 0xd4a673 : 0xffb34f);
  work.particles.forEach((particle, index) => {
    const cycle = ((time * 2.6 + index / work.particles.length) % 1 + 1) % 1;
    const burst = chop ? chop.impact : 1;
    const spread = .045 + cycle * (chop ? .18 : .22);
    particle.visible = burst > .02;
    particle.position.set(origin.x + Math.cos(index * 2.4) * spread,
      origin.y + (chop ? cycle * .22 : cycle * .19),
      origin.z + Math.sin(index * 2.4) * spread);
    particle.scale.setScalar((1 - cycle * .7) * burst);
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
