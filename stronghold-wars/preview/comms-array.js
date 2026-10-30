import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const clampTier = level => Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));

export function commsPose(level, phase, active, reducedMotion = false) {
  const tier = clampTier(level);
  const p = ((Number(phase) || 0) % 1 + 1) % 1;
  const moving = Boolean(active && !reducedMotion);
  const wave = p * Math.PI * 2;
  return {
    tier, moving,
    cycleSeconds: 8.4 - tier * .82,
    yaw: moving ? Math.sin(wave) * (tier >= 4 ? .66 : .49) : 0,
    pitch: moving ? -.18 + Math.sin(wave * .73) * .13 : -.18,
    secondaryYaw: moving ? -Math.sin(wave * 1.23) * .54 : 0,
    pulse: moving ? .5 + .5 * Math.sin(wave * 2) : 0,
    packet: moving ? p : 0,
  };
}

export function createCommsArray(THREE, host, level) {
  // Keep the authored, textured building GLB. This compact equipment sits at
  // its service edge, inside the selectable grid cell, with its own pivots.
  const tier = clampTier(level);
  const root = new THREE.Group();
  root.name = 'comms_working_array';
  root.position.set(2.85, 0, 1.9);
  host.add(root);
  const dark = new THREE.MeshStandardMaterial({ color: 0x26312d, metalness: .7, roughness: .48 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x777e76, metalness: .85, roughness: .32 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x4a395f, metalness: .65, roughness: .43 });
  const lime = new THREE.MeshStandardMaterial({ color: 0x9bdc5d, emissive: 0x6dbb32, emissiveIntensity: .3, roughness: .35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x282039, metalness: .48, roughness: .2 });
  const materials = [dark, steel, trim, lime, glass];
  const mesh = (parent, geometry, mat, x, y, z) => {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(x, y, z);
    object.castShadow = object.receiveShadow = true;
    parent.add(object);
    return object;
  };
  const box = (parent, w, h, d, mat, x, y, z) => mesh(parent,
    new RoundedBoxGeometry(w, h, d, 2, Math.min(.045, w / 5, h / 5, d / 5)), mat, x, y, z);
  const cyl = (parent, rt, rb, h, mat, x, y, z, sides = 18) => mesh(parent,
    new THREE.CylinderGeometry(rt, rb, h, sides), mat, x, y, z);
  const ring = (parent, radius, tube, mat, x, y, z) => mesh(parent,
    new THREE.TorusGeometry(radius, tube, 8, 28), mat, x, y, z);
  const cable = (parent, points) => mesh(parent,
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 16, .026, 6, false), dark, 0, 0, 0);

  const rig = { key: 'comms', level: tier, root, phase: 0, upgradeTime: 0,
    materials, lamps: [] };
  // Rounded plinth, bolt pattern and a conduit tie this array to the bunker.
  box(root, 1.65, .2, 1.45, dark, 0, .12, 0);
  box(root, 1.47, .055, 1.27, steel, 0, .26, 0);
  for (const x of [-.69, .69]) for (const z of [-.58, .58])
    cyl(root, .035, .035, .025, steel, x, .31, z, 8);
  cable(root, [[-.47, .29, -.46], [-.66, .37, -.72], [-.91, .4, -1.05]]);
  cyl(root, .47, .53, .15, dark, 0, .41, 0, 24);
  cyl(root, .37, .39, .08, trim, 0, .52, 0, 24);
  cyl(root, .24, .28, .14, steel, 0, .63, 0, 24);
  rig.yaw = new THREE.Group();
  rig.yaw.position.y = .72;
  root.add(rig.yaw);
  cyl(rig.yaw, .09, .11, 1.12 + tier * .1, steel, 0, .59, 0, 12);
  for (const y of [.24, .72]) ring(rig.yaw, .14, .025, trim, 0, y, 0).rotation.x = Math.PI / 2;
  const pivotY = 1.2 + tier * .1;
  for (const x of [-.22, .22]) box(rig.yaw, .13, .41, .21, dark, x, pivotY, 0);
  rig.pitch = new THREE.Group();
  rig.pitch.position.y = pivotY;
  rig.yaw.add(rig.pitch);
  cyl(rig.pitch, .085, .085, .6, steel, 0, 0, 0).rotation.z = Math.PI / 2;
  const radius = .4 + tier * .055;
  const dishMat = new THREE.MeshStandardMaterial({ color: 0xa7ac9f, metalness: .35, roughness: .57, side: THREE.DoubleSide });
  materials.push(dishMat);
  const dish = mesh(rig.pitch, new THREE.LatheGeometry([
    new THREE.Vector2(0, -.14), new THREE.Vector2(radius * .32, -.13),
    new THREE.Vector2(radius * .64, -.065), new THREE.Vector2(radius, .075),
  ], 30), dishMat, 0, 0, 0);
  dish.rotation.x = Math.PI / 2;
  ring(rig.pitch, radius, .037, trim, 0, 0, .075);
  cyl(rig.pitch, .085, .085, .59, dark, 0, 0, .34).rotation.x = Math.PI / 2;
  cyl(rig.pitch, .115, .115, .1, lime, 0, 0, .67).rotation.x = Math.PI / 2;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const rib = box(rig.pitch, .025, radius * .7, .025, dark,
      Math.sin(a) * radius * .32, Math.cos(a) * radius * .32, .1);
    rib.rotation.z = -a;
  }
  for (const x of [-.55, .55]) rig.lamps.push(box(root, .09, .08, .08, lime, x, .39, .68));
  box(root, .54, .3, .12, glass, 0, .48, .68);
  rig.scanner = ring(root, .16, .027, lime, 0, .48, .76);

  if (tier >= 2) {
    // Paired receivers and a motorized bearing become visible at L2.
    for (const x of [-.7, .7]) {
      cyl(rig.yaw, .07, .08, .76, steel, x, .39, 0, 10);
      cyl(rig.yaw, .13, .12, .19, dark, x, .82, 0, 16);
      rig.lamps.push(cyl(rig.yaw, .06, .06, .09, lime, x, .95, 0, 12));
    }
    ring(root, .38, .025, lime, 0, .57, 0).rotation.x = Math.PI / 2;
  }
  if (tier >= 3) {
    // Directional side array scans independently of the main gimbal.
    rig.secondary = new THREE.Group();
    rig.secondary.position.set(-.67, .86, -.3);
    root.add(rig.secondary);
    cyl(rig.secondary, .075, .12, .66, steel, 0, .33, 0, 12);
    const panel = box(rig.secondary, .63, .43, .09, dark, 0, .76, .03);
    panel.rotation.x = -.19;
    for (const x of [-.2, 0, .2]) box(rig.secondary, .07, .29, .02, trim, x, .76, .09);
    rig.lamps.push(box(rig.secondary, .11, .1, .035, lime, 0, .76, .105));
    cable(root, [[-.67, .35, -.3], [-.7, .75, -.3], [-.67, 1.2, -.3]]);
  }
  if (tier >= 4) {
    // An elevated encrypted link and dual pulse rings identify the war tier.
    cyl(root, .055, .08, 2.36, dark, .66, 1.46, -.4, 10);
    for (const y of [1.52, 2.03, 2.53]) ring(root, .16, .024, trim, .66, y, -.4).rotation.x = Math.PI / 2;
    rig.lamps.push(cyl(root, .1, .1, .13, lime, .66, 2.72, -.4, 12));
    rig.upperScanner = ring(rig.yaw, .25, .033, lime, 0, pivotY + .16, 0);
    rig.upperScanner.rotation.x = Math.PI / 2;
  }
  if (tier >= 5) {
    // Three phased nodes orbit the elite relay collar.
    rig.contacts = [];
    ring(rig.yaw, .34, .036, trim, 0, pivotY + .28, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) rig.contacts.push(cyl(rig.yaw, .07, .07, .15, lime, 0, pivotY + .28, 0, 12));
  }
  rig.signal = mesh(root, new THREE.TorusGeometry(.31, .03, 8, 30),
    new THREE.MeshBasicMaterial({ color: 0xb5f767, transparent: true, opacity: 0, depthWrite: false }), 0, 1.5 + tier * .1, .82);
  rig.signal.visible = false;
  rig.revealRing = mesh(root, new THREE.TorusGeometry(.56, .035, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xb5f767, transparent: true, opacity: 0, depthWrite: false }), 0, .24, 0);
  rig.revealRing.rotation.x = Math.PI / 2;
  rig.revealRing.visible = false;
  return rig;
}

export function startCommsUpgradeReveal(rig) {
  if (rig?.key === 'comms') rig.upgradeTime = 2.2;
}

// The uploaded GLBs each contain one textured mesh. Extract the high aerial
// assembly into a yaw group so the owner's actual dish art scans in game.
export function articulateCommsModel(THREE, model, level) {
  const mesh = model.getObjectByProperty('isMesh', true);
  const position = mesh?.geometry?.getAttribute('position');
  const index = mesh?.geometry?.getIndex();
  if (!mesh || !position || !index || index.count < 12) return null;
  mesh.geometry.computeBoundingBox();
  const bounds = mesh.geometry.boundingBox;
  const height = bounds.max.y - bounds.min.y;
  const cut = bounds.min.y + height * (clampTier(level) <= 2 ? .68 : .61);
  const fixed = [], moving = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    ((position.getY(a) + position.getY(b) + position.getY(c)) / 3 >= cut ? moving : fixed).push(a, b, c);
  }
  const minimumAerial = clampTier(level) === 1 ? .003 : .025;
  if (moving.length < index.count * minimumAerial || fixed.length < index.count * .4) return null;
  const lowerGeometry = mesh.geometry.clone();
  const upperGeometry = mesh.geometry.clone();
  lowerGeometry.setIndex(fixed);
  upperGeometry.setIndex(moving);
  lowerGeometry.userData.commsSplit = upperGeometry.userData.commsSplit = true;
  const pivotWorld = mesh.localToWorld(new THREE.Vector3(
    (bounds.min.x + bounds.max.x) / 2, cut, (bounds.min.z + bounds.max.z) / 2));
  const rotor = mesh.clone(false);
  rotor.name = 'comms_authored_aerial';
  rotor.geometry = upperGeometry;
  rotor.castShadow = rotor.receiveShadow = true;
  mesh.geometry = lowerGeometry;
  mesh.parent.add(rotor);
  const yaw = new THREE.Group();
  yaw.name = 'comms_authored_yaw';
  model.add(yaw);
  model.updateMatrixWorld(true);
  yaw.position.copy(model.worldToLocal(pivotWorld));
  model.updateMatrixWorld(true);
  yaw.attach(rotor);
  return yaw;
}

export function clearCommsSplitGeometry(model) {
  model?.traverse(object => {
    if (object.isMesh && object.geometry?.userData.commsSplit) object.geometry.dispose();
  });
}

export function stepCommsArray(rig, dt, time, active, reducedMotion = false) {
  const step = Math.max(0, Math.min(.1, dt));
  if (active && !reducedMotion) rig.phase = (rig.phase + step / commsPose(rig.level, 0, true).cycleSeconds) % 1;
  const pose = commsPose(rig.level, rig.phase, active, reducedMotion);
  rig.yaw.rotation.y = pose.yaw;
  rig.pitch.rotation.x = pose.pitch;
  if (rig.modelRotor) rig.modelRotor.rotation.y = pose.yaw * .72;
  if (rig.secondary) rig.secondary.rotation.y = pose.secondaryYaw;
  rig.scanner.rotation.z = pose.moving ? time * (1.2 + rig.level * .2) : 0;
  if (rig.upperScanner) rig.upperScanner.rotation.z = pose.moving ? -time * 1.1 : 0;
  if (rig.contacts) rig.contacts.forEach((contact, index) => {
    const angle = (pose.moving ? time * 1.3 : 0) + index * Math.PI * 2 / 3;
    contact.position.x = Math.cos(angle) * .34;
    contact.position.z = Math.sin(angle) * .34;
  });
  rig.lamps.forEach((lamp, index) => {
    lamp.material.emissiveIntensity = active ? .18 + pose.pulse * (.25 + index % 2 * .13) : .04;
  });
  rig.signal.visible = pose.moving;
  if (rig.signal.visible) {
    rig.signal.position.z = .82 + pose.packet * .68;
    rig.signal.scale.setScalar(.6 + pose.packet * 1.3);
    rig.signal.material.opacity = (1 - pose.packet) * .58;
  }
  rig.upgradeTime = Math.max(0, rig.upgradeTime - step);
  const reveal = !reducedMotion && rig.upgradeTime > 0;
  rig.revealRing.visible = reveal;
  if (reveal) {
    const progress = (2.2 - rig.upgradeTime) / 2.2;
    rig.revealRing.position.y = .24 + progress * 2.65;
    rig.revealRing.scale.setScalar(1 + progress * 2.2);
    rig.revealRing.material.opacity = (1 - progress) * .7;
  }
  return pose.moving;
}
