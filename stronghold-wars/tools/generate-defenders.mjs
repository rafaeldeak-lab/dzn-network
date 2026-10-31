// Reproducible 3D interpretations of the owner's four DZN defender concepts.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { soldier } from './generate-squads.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../preview/assets/models/defenders');
await mkdir(root, { recursive: true });
const exporter = new GLTFExporter();
const material = (color, metalness = 0.55, glow = 0) => new THREE.MeshStandardMaterial({
  color, metalness, roughness: 0.42, emissive: glow ? color : 0x000000, emissiveIntensity: glow,
});
const black = material(0x12171d), steel = material(0x414b54), purple = material(0x65328c);
const lime = material(0xa5ff2d, 0.2, 0.85);
function part(group, geometry, mat, name, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, mat); mesh.name = name; mesh.position.set(x, y, z); group.add(mesh); return mesh;
}
function box(group, w, h, d, mat, name, x = 0, y = 0, z = 0) {
  return part(group, new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.16), mat, name, x, y, z);
}
function orb(group, r, mat, name, x = 0, y = 0, z = 0) {
  return part(group, new THREE.SphereGeometry(r, 16, 12), mat, name, x, y, z);
}
function disc(group, r, mat, name, x = 0, y = 0, z = 0) {
  const item = part(group, new THREE.CylinderGeometry(r, r, 0.12, 16), mat, name, x, y, z);
  item.rotation.x = Math.PI / 2;
  return item;
}
function makeHound(tier) {
  const g = new THREE.Group();
  box(g, 0.8, 0.53, 1.35, black, 'hound_core', 0, 0.89, 0);
  box(g, 0.92, 0.22, 1.05, purple, 'dorsal_plating', 0, 1.18, -0.06);
  box(g, 0.7, 0.36, 0.53, steel, 'hound_head', 0, 1.12, 0.88);
  box(g, 0.55, 0.19, 0.39, black, 'muzzle', 0, 0.99, 1.24);
  box(g, 0.48, 0.075, 0.05, lime, 'tracking_optics', 0, 1.2, 1.155);
  for (const side of [-1, 1]) {
    box(g, 0.14, 0.32, 0.19, purple, 'ear_array', side * 0.24, 1.38, 0.81);
    for (const end of [-1, 1]) {
      const leg = new THREE.Group();
      leg.name = `${side < 0 ? 'left' : 'right'}_${end < 0 ? 'rear' : 'front'}_leg`;
      leg.position.set(side * 0.43, 0.9, end * 0.47);
      g.add(leg);
      orb(leg, 0.18, steel, 'hip_joint');
      box(leg, 0.23, 0.57, 0.26, black, 'servo_leg', 0, -0.32, 0);
      box(leg, 0.31, 0.22, 0.42, purple, 'armoured_paw', 0, -0.7, 0.11);
      box(leg, 0.1, 0.3, 0.035, lime, 'servo_light', side * 0.125, -0.32, 0.1);
      if (tier >= 3) box(leg, 0.29, 0.2, 0.32, steel, 'reinforced_knee', 0, -0.43, 0);
    }
  }
  box(g, 0.17, 0.2, 0.6, steel, 'tail', 0, 1.03, -0.92);
  if (tier >= 2) for (const side of [-1, 1]) box(g, 0.12, 0.21, 0.74, purple, 'flank_plate', side * 0.47, 0.91, 0);
  if (tier >= 4) for (const side of [-1, 1]) box(g, 0.16, 0.07, 0.48, lime, 'elite_tracking_light', side * 0.38, 1.32, -0.12);
  if (tier === 5) orb(g, 0.13, lime, 'apex_sensor', 0, 1.47, 0.42);
  return g;
}
function makeDefender(role, tier) {
  if (role === 'hound') return makeHound(tier);
  const g = soldier(role === 'guardian' ? 'sentinel' : role === 'aegis' ? 'recon' : 'engineer', tier);
  g.name = `${role}_l0${tier}`;
  if (role === 'guardian') {
    box(g, 0.74 + tier * 0.045, 0.55, 0.19, purple, 'heavy_chest', 0, 1.16, 0.24);
    box(g, 0.18, 0.12, 0.04, lime, 'guardian_rank', 0, 1.2, 0.35);
    const shield = new THREE.Group(); shield.name = 'barrier_shield'; shield.position.set(-0.66, 0.94, 0.36); g.add(shield);
    box(shield, 0.78 + tier * 0.07, 1.46 + tier * 0.09, 0.21, steel, 'barrier_body');
    box(shield, 0.57, 0.6, 0.06, black, 'barrier_centre', 0, 0.06, 0.14);
    for (const side of [-1, 1]) box(shield, 0.07, 1.14, 0.04, lime, 'barrier_power_strip', side * 0.3, 0, 0.14);
    if (tier >= 4) orb(shield, 0.13, lime, 'barrier_core', 0, 0.1, 0.19);
  } else if (role === 'aegis') {
    box(g, 0.43, 0.42, 0.18, purple, 'control_vest', 0, 1.14, 0.28);
    for (const side of [-1, 1]) {
      const drone = new THREE.Group(); drone.name = side < 0 ? 'left_drone' : 'right_drone';
      drone.position.set(side * (0.75 + tier * 0.06), 1.72 + tier * 0.025, -0.04); g.add(drone);
      orb(drone, 0.17 + tier * 0.01, steel, 'interceptor_core');
      box(drone, 0.45, 0.07, 0.12, purple, 'interceptor_wing');
      box(drone, 0.12, 0.2, 0.31, black, 'interceptor_tail', 0, 0, -0.13);
      orb(drone, 0.08, lime, 'interceptor_eye', 0, 0, 0.17);
    }
    if (tier >= 3) box(g, 0.25, 0.13, 0.08, lime, 'command_console', 0.2, 1.01, 0.35);
  } else {
    g.children.filter(item => ['axe_handle', 'axe_head'].includes(item.name)).forEach(item => g.remove(item));
    box(g, 0.45, 0.46, 0.2, purple, 'snare_pack', 0, 1.11, -0.3);
    for (let index = 0; index < 3; index++) {
      disc(g, 0.17 + tier * 0.012, purple, `snare_module_${index}`, (index - 1) * 0.27, 0.82, 0.31);
      orb(g, 0.055, lime, `snare_charge_${index}`, (index - 1) * 0.27, 0.82, 0.4);
    }
    if (tier >= 4) box(g, 0.3, 0.09, 0.1, lime, 'emp_controller', 0.33, 1.03, 0.35);
  }
  return g;
}

const manifest = { schemaVersion: 1,
  provenance: 'Original procedural 3D defender geometry styled after four owner-supplied DZN concept images; no paid provider.',
  license: 'Project-owned original geometry; owner-supplied visual references',
  unit: 'metre', coordinateSystem: 'Y up; forward +Z', assets: {} };
for (const role of ['guardian', 'aegis', 'trapper', 'hound']) for (let tier = 1; tier <= 5; tier++) {
  const name = `${role}_l0${tier}`;
  const scene = makeDefender(role, tier);
  const bytes = Buffer.from(await exporter.parseAsync(scene, { binary: true, onlyVisible: true }));
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  await writeFile(path.join(root, `${name}.glb`), bytes);
  manifest.assets[name] = { file: `assets/models/defenders/${name}.glb`,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    dimensions: size.toArray().map(value => Number(value.toFixed(3))),
    meshes: scene.getObjectsByProperty('isMesh', true).length };
}
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created ${Object.keys(manifest.assets).length} DZN defender GLBs.`);
