import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// The five uploaded Forge GLBs are single textured meshes. This separate,
// articulated work area lets them keep their detail while the machinery moves.
export function forgeWorkState(production, crafting, access) {
  const producing = Boolean(access && Number(production?.perSecond) > 0
    && Number(production?.stored) < Number(production?.capacity));
  const forging = Boolean(access && crafting);
  return { active: producing || forging, producing, forging, speed: forging ? 1.35 : 1 };
}

export function forgePose(level, phase, active, reducedMotion = false) {
  const tier = Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));
  const p = ((Number(phase) || 0) % 1 + 1) % 1;
  const moving = Boolean(active && !reducedMotion);
  const strike = moving && p >= .33 && p <= .69 ? Math.sin((p - .33) / .36 * Math.PI) : 0;
  const feed = p < .33 ? -.98 + Math.max(0, (p - .08) / .25) * .98
    : p < .70 ? 0 : Math.min(.98, (p - .70) / .21 * .98);
  return {
    tier,
    moving,
    cycleSeconds: 3.35 - tier * .39,
    pressHeight: 1.53 - strike * .69,
    feedX: moving ? feed : -.98,
    billetVisible: moving ? p >= .08 && p <= .91 : Boolean(active && reducedMotion),
    sparks: moving && p >= .43 && p <= .62,
    heat: active ? .52 + strike * .75 : .1,
    pistonTravel: strike * .69,
    armSwing: moving ? Math.sin(p * Math.PI * 2) * .34 : 0,
    arcVisible: moving && tier >= 4 && p >= .46 && p <= .61,
  };
}

export function createForgeWorkshop(THREE, parent, level) {
  const root = new THREE.Group();
  root.name = `dzn_forge_l${level}_articulated_work_area`;
  root.position.set(1.75, 0, 3.05);
  parent.add(root);

  const material = (color, metalness = .65, roughness = .42, emissive = 0, intensity = 0) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: intensity });
  const dark = material(0x303833, .72, .59);
  const steel = material(0x5f6961, .84, .4);
  const edge = material(0x878a7c, .78, .42);
  const purple = material(0x3f3550, .65, .48);
  const amber = material(0x9d632e, .3, .46, 0xed6221, .2);
  const hotSteel = material(0x9c9682, .8, .27, 0xfa6422, .2);
  const lime = material(0x6e9c41, .3, .45, 0x70ad2e, .18);
  const hazard = material(0x9b824e, .44, .55);
  const materials = [dark, steel, edge, purple, amber, hotSteel, lime, hazard];
  const box = (holder, w, h, d, mat, x, y, z, radius = .035) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 5, h / 5, d / 5)), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    holder.add(mesh);
    return mesh;
  };
  const cyl = (holder, top, bottom, height, mat, x, y, z, segments = 16) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    holder.add(mesh);
    return mesh;
  };
  const ring = (holder, radius, tube, mat, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 24), mat);
    mesh.position.set(x, y, z);
    holder.add(mesh);
    return mesh;
  };
  const rig = { key: 'workshop', level, root, phase: 0, upgradeTime: 0,
    materials, sparks: [], arcs: [], rollers: [], fans: [] };

  // Footprint stays outside the authored doorway and inside the building's grid cell.
  box(root, 2.82, .19, 1.58, dark, 0, .08, 0, .08);
  box(root, 2.6, .055, 1.37, steel, 0, .2, 0);
  for (const x of [-1.24, 1.24]) {
    box(root, .2, 1.66, .24, dark, x, 1.02, -.4);
    box(root, .07, 1.55, .27, edge, x, 1.03, -.4);
  }
  box(root, 2.62, .22, .64, dark, 0, 1.89, -.4);
  box(root, 2.34, .05, .1, purple, 0, 1.99, -.08);
  for (const x of [-1.12, -.56, .56, 1.12]) {
    const bolt = cyl(root, .032, .032, .02, edge, x, 1.9, -.06, 8);
    bolt.rotation.x = Math.PI / 2;
  }
  box(root, 1.3, .19, .71, dark, 0, .45, .05);
  box(root, 1.03, .08, .5, edge, 0, .58, .05);
  for (let i = 0; i < 5; i++) box(root, .13, .018, .48, hazard, -1.1 + i * .55, .23, .64, .006);
  for (const x of [-1.24, 1.24]) {
    for (const y of [.54, 1.15, 1.72]) {
      const rivet = cyl(root, .027, .027, .016, edge, x, y, -.23, 8);
      rivet.rotation.x = Math.PI / 2;
    }
  }

  rig.press = new THREE.Group();
  rig.press.position.y = 1.53;
  root.add(rig.press);
  box(rig.press, 1.16, .28, .76, steel, 0, 0, 0, .05);
  box(rig.press, .78, .12, .48, edge, 0, -.19, .01);
  box(rig.press, .7, .07, .62, purple, 0, .19, 0);
  for (const x of [-.48, .48]) box(rig.press, .075, .1, .56, dark, x, .08, 0);
  for (const x of [-.42, .42]) {
    cyl(rig.press, .055, .055, .18, dark, x, -.15, .23, 12);
    cyl(root, .12, .12, .67, dark, x, 1.48, -.29, 12);
    const rod = cyl(root, .052, .052, .65, steel, x, 1.48, -.29, 12);
    rig.rollers.push({ piston: rod });
  }
  rig.billet = box(root, .48, .11, .32, hotSteel, -.98, .67, .04, .02);
  rig.billet.visible = false;

  // The side furnace and wheel give the forge a readable power source.
  box(root, .48, .68, .65, dark, -1.25, .64, -.72, .08);
  for (const x of [-1.41, -1.28, -1.15]) box(root, .045, .23, .025, edge, x, .78, -.38, .008);
  rig.furnace = box(root, .4, .36, .045, amber, -1.25, .64, -.38, .015);
  rig.flywheel = new THREE.Group();
  rig.flywheel.position.set(1.27, .94, -.33);
  root.add(rig.flywheel);
  const wheelDisc = cyl(rig.flywheel, .39, .39, .15, dark, 0, 0, 0, 24);
  wheelDisc.rotation.z = Math.PI / 2;
  const wheelRim = ring(rig.flywheel, .34, .047, steel, .1, 0, 0);
  wheelRim.rotation.y = Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    box(rig.flywheel, .055, .48, .055, purple, .12, Math.cos(a) * .16, Math.sin(a) * .16, .01).rotation.x = a;
  }
  cyl(rig.flywheel, .1, .1, .2, edge, .15, 0, 0, 16).rotation.z = Math.PI / 2;
  rig.exhaust = new THREE.Vector3(-1.25, 1.24, -.72);

  if (level >= 2) {
    // Level 2 adds powered feed rollers and a guarded intake.
    for (const x of [-.92, -.58, .63, .97]) {
      const roller = cyl(root, .085, .085, .62, steel, x, .48, .02, 14);
      roller.rotation.x = Math.PI / 2;
      rig.rollers.push({ feed: roller });
    }
    box(root, .76, .09, .1, dark, -.81, .8, .28);
    box(root, .76, .09, .1, dark, .81, .8, .28);
    box(root, .18, .3, .18, dark, 1.13, .44, .52);
    box(root, .1, .11, .04, lime, 1.13, .49, .63);
  }

  if (level >= 3) {
    // Hydraulic accumulator and roof fan make the L3-L5 machine visibly busier.
    rig.accumulator = cyl(root, .21, .21, .82, dark, -1.1, 1.25, -.72, 18);
    ring(root, .22, .038, purple, -1.1, 1.64, -.72).rotation.x = Math.PI / 2;
    for (let i = 0; i < 2; i++) {
      const fan = new THREE.Group();
      fan.position.set(-.43 + i * .83, 2.08, -.41);
      for (let j = 0; j < 4; j++) {
        const blade = box(fan, .08, .018, .23, steel, 0, 0, .16, .008);
        blade.rotation.y = j * Math.PI / 2;
        blade.position.x = Math.sin(j * Math.PI / 2) * .16;
        blade.position.z = Math.cos(j * Math.PI / 2) * .16;
      }
      root.add(fan);
      rig.fans.push(fan);
    }
    box(root, .58, .08, .14, lime, -.81, 1.26, .25);
  }

  if (level >= 4) {
    // The assembly arm reaches the press during each strike.
    rig.arm = new THREE.Group();
    rig.arm.position.set(1.03, 1.53, .48);
    root.add(rig.arm);
    cyl(rig.arm, .17, .22, .18, dark, 0, 0, 0);
    box(rig.arm, .18, .16, .8, purple, -.17, -.1, -.39);
    rig.elbow = new THREE.Group();
    rig.elbow.position.set(-.35, -.11, -.78);
    rig.arm.add(rig.elbow);
    box(rig.elbow, .14, .15, .58, steel, -.15, -.05, -.27);
    for (const x of [-.25, -.05]) box(rig.elbow, .055, .23, .16, dark, x, -.2, -.57);
    for (let i = 0; i < 3; i++) {
      const arc = new THREE.Mesh(new THREE.ConeGeometry(.055, .23, 5), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xb9a0ff : 0xffc46c }));
      arc.position.set((i - 1) * .13, .52, .24);
      root.add(arc);
      rig.arcs.push(arc);
    }
  }

  if (level >= 5) {
    // Elite DZN core: orbiting contacts and an energized ring above the press.
    rig.plasma = ring(root, .36, .052, lime, 0, 2.14, -.1);
    rig.plasma.rotation.x = Math.PI / 2;
    rig.contacts = [];
    for (let i = 0; i < 3; i++) {
      const contact = box(root, .12, .12, .12, purple, 0, 2.15, -.1);
      rig.contacts.push(contact);
    }
    for (const x of [-.58, .58]) box(root, .14, .46, .15, lime, x, 1.36, -.37);
  }

  rig.sparks = Array.from({ length: Math.min(2 + level, 7) }, (_, i) => {
    const spark = new THREE.Mesh(new THREE.TetrahedronGeometry(.038 + i % 3 * .013),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffbd61 : 0xd4b2ff }));
    spark.position.set((i - 2) * .12, .6, .18);
    spark.visible = false;
    root.add(spark);
    return spark;
  });
  rig.revealRing = new THREE.Mesh(new THREE.TorusGeometry(.72, .035, 7, 32),
    new THREE.MeshBasicMaterial({ color: 0x9ee45d, transparent: true, opacity: 0, depthWrite: false }));
  rig.revealRing.rotation.x = Math.PI / 2;
  rig.revealRing.position.y = .35;
  rig.revealRing.visible = false;
  root.add(rig.revealRing);
  rig.revealSparks = Array.from({ length: 8 }, (_, i) => {
    const spark = new THREE.Mesh(new THREE.TetrahedronGeometry(.06 + i % 2 * .025),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xf5a65a : 0x9ee45d, transparent: true, opacity: 0 }));
    spark.visible = false;
    root.add(spark);
    return spark;
  });
  return rig;
}

export function startForgeUpgradeReveal(rig) {
  if (rig?.key === 'workshop') rig.upgradeTime = 2.4;
}

export function stepForgeWorkshop(rig, dt, time, production, crafting, access, reducedMotion) {
  const work = forgeWorkState(production, crafting, access);
  if (!work.active || reducedMotion) rig.phase = 0;
  else rig.phase = (rig.phase + Math.max(0, Math.min(dt, .1)) * work.speed
    / forgePose(rig.level, 0, true).cycleSeconds) % 1;
  const pose = forgePose(rig.level, rig.phase, work.active, reducedMotion);
  rig.press.position.y = pose.pressHeight;
  rig.billet.position.x = pose.feedX;
  rig.billet.visible = pose.billetVisible;
  const glow = pose.heat + (pose.moving ? Math.sin(time * 8) * .08 : 0);
  rig.furnace.material.emissiveIntensity = glow;
  rig.billet.material.emissiveIntensity = glow * .75;
  if (pose.moving) rig.flywheel.rotation.x += dt * (2.2 + rig.level * .45);
  rig.rollers.forEach(part => {
    if (part.piston) part.piston.position.y = 1.48 - pose.pistonTravel * .45;
    if (part.feed && pose.moving) part.feed.rotation.z += dt * 4;
  });
  rig.fans.forEach((fan, i) => { if (pose.moving) fan.rotation.y += dt * (2.7 + i * .6); });
  if (rig.accumulator) rig.accumulator.material.emissiveIntensity = pose.moving ? .12 + pose.heat * .1 : 0;
  if (rig.arm) {
    rig.arm.rotation.y = pose.armSwing;
    rig.elbow.rotation.x = pose.moving ? -.27 - Math.max(0, Math.sin(rig.phase * Math.PI * 2)) * .35 : -.27;
  }
  rig.arcs.forEach((arc, i) => {
    arc.visible = pose.arcVisible;
    arc.position.y = .57 + (pose.arcVisible ? Math.sin(time * 18 + i) * .13 : 0);
  });
  if (rig.plasma) {
    rig.plasma.material.emissiveIntensity = pose.moving ? .7 + Math.sin(time * 6) * .25 : .16;
    if (pose.moving) rig.plasma.rotation.z += dt * 1.4;
    rig.contacts.forEach((contact, i) => {
      const angle = (time * (pose.moving ? 1.2 : 0) + i * Math.PI * 2 / 3);
      contact.position.set(Math.cos(angle) * .36, 2.14, -.1 + Math.sin(angle) * .36);
    });
  }
  rig.sparks.forEach((spark, i) => {
    spark.visible = pose.sparks;
    if (spark.visible) {
      spark.position.set((i - 2) * .12 + Math.sin(time * 16 + i) * .09,
        .68 + Math.abs(Math.sin(time * 13 + i * 2)) * .19, .14 + i * .02);
    }
  });
  rig.upgradeTime = Math.max(0, rig.upgradeTime - Math.max(0, Math.min(dt, .1)));
  const reveal = !reducedMotion && rig.upgradeTime > 0;
  const progress = (2.4 - rig.upgradeTime) / 2.4;
  rig.revealRing.visible = reveal;
  if (reveal) {
    rig.revealRing.position.y = .45 + progress * 1.4;
    rig.revealRing.scale.setScalar(1 + progress * 1.5);
    rig.revealRing.material.opacity = (1 - progress) * .7;
  }
  rig.revealSparks.forEach((spark, i) => {
    spark.visible = reveal;
    if (!reveal) return;
    const angle = i * Math.PI / 4 + progress * .8;
    spark.position.set(Math.cos(angle) * (.45 + progress * 1.2), .7 + progress * (1.3 + i % 3 * .22),
      Math.sin(angle) * (.3 + progress * .62));
    spark.material.opacity = 1 - progress;
  });
  return pose.moving;
}
