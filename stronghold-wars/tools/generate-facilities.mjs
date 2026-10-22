// Original, reproducible DZN Stronghold district kit. No paid asset service.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.FileReader) {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); });
    }
  };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../preview/assets/models/facilities');
await mkdir(root, { recursive: true });
const exporter = new GLTFExporter();
const material = (color, metalness = 0) => new THREE.MeshStandardMaterial({ color, metalness, roughness: metalness ? 0.58 : 0.94, flatShading: true });
const M = {
  concrete: material(0x535e59), edge: material(0x303b38), olive: material(0x4a5d49),
  canvas: material(0x6d775a), steel: material(0x81918c, 0.45), dark: material(0x26332f, 0.3),
  timber: material(0x755036), cut: material(0xc69c62), sand: material(0x9a8c6b),
  purple: material(0x8750be), violet: material(0xb579e2), green: material(0x5fd69a),
  amber: material(0xe8ac60), water: material(0x385e5e),
};
function mesh(g, geo, mat, x = 0, y = 0, z = 0, ry = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m;
}
const box = (g, w, h, d, mat, x, y, z) => mesh(g, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
const cyl = (g, top, bottom, h, mat, x, y, z, sides = 10) => mesh(g, new THREE.CylinderGeometry(top, bottom, h, sides), mat, x, y, z);
function beam(g, from, to, radius, mat) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
  const m = mesh(g, new THREE.CylinderGeometry(radius, radius, delta.length(), 6), mat, ...a.clone().add(b).multiplyScalar(0.5).toArray());
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
}
function foundation(g, level, marsh = false) {
  box(g, 6.6, 0.23, 6.2, M.edge, 0, 0.115, 0);
  box(g, 6.2, 0.08, 5.8, marsh ? M.water : M.concrete, 0, 0.27, 0);
  for (const x of [-2.8, 2.8]) for (const z of [-2.55, 2.55]) {
    box(g, 0.32, 0.55 + level * 0.08, 0.32, M.dark, x, 0.52, z);
    box(g, 0.25, 0.1, 0.25, level % 2 ? M.green : M.purple, x, 0.85 + level * 0.08, z);
  }
  for (let i = 0; i < level; i++) box(g, 0.28, 0.07, 0.34, M.violet, -2.15 + i * 0.52, 0.34, 2.7);
}
function log(g, x, y, z, length = 1.8) {
  const wood = cyl(g, 0.19, 0.19, length, M.timber, x, y, z, 9); wood.rotation.z = Math.PI / 2;
  const end = cyl(g, 0.19, 0.19, 0.025, M.cut, x + length / 2, y, z, 9); end.rotation.z = Math.PI / 2;
}
function timberline(level) {
  const g = new THREE.Group(); foundation(g, level);
  box(g, 3.8, 0.25, 2.65, M.olive, -0.55, 0.48, -0.7);
  for (const x of [-2.1, 1]) for (const z of [-1.7, 0.3]) box(g, 0.14, 1.75 + level * 0.14, 0.14, M.steel, x, 1.3, z);
  box(g, 3.9, 0.18, 2.75, M.canvas, -0.55, 2.22 + level * 0.14, -0.7);
  box(g, 3.9, 0.09, 0.22, M.purple, -0.55, 2.1 + level * 0.14, 0.64);
  for (let i = 0; i < 3 + level; i++) log(g, 1.65, 0.55 + Math.floor(i / 3) * 0.42, -1.35 + (i % 3) * 0.46);
  box(g, 2.1, 0.18, 0.9, M.dark, -0.45, 0.73, 1.35);
  for (const x of [-1.35, 0.42]) cyl(g, 0.13, 0.13, 0.45, M.steel, x, 0.67, 1.35);
  const blade = cyl(g, 0.65 + level * 0.06, 0.65 + level * 0.06, 0.08, M.steel, -0.45, 1.55, 1.35, 12); blade.rotation.z = Math.PI / 2;
  cyl(g, 0.17, 0.17, 0.12, M.purple, -0.45, 1.55, 1.35);
  if (level >= 2) { box(g, 1.15, 1.2, 1.15, M.olive, 1.9, 0.96, 1.3); box(g, 0.7, 0.38, 0.05, M.green, 1.9, 1.4, 1.9); }
  if (level >= 3) { beam(g, [2.55, 0.45, 0], [2.55, 3.7, 0], 0.11, M.steel); beam(g, [2.55, 3.7, 0], [0.6, 3.7, 0], 0.09, M.steel); box(g, 0.3, 0.65, 0.3, M.amber, 0.7, 3.27, 0); }
  if (level >= 4) { box(g, 0.9, 1.45, 0.9, M.dark, -2.35, 1.04, 1.4); cyl(g, 0.33, 0.33, 0.08, M.violet, -2.35, 1.88, 1.4); }
  if (level >= 5) { box(g, 3.7, 0.12, 0.16, M.green, -0.55, 2.45 + level * 0.14, 0.65); beam(g, [-1.9, 2.8, -1.3], [-1.9, 4.2, -1.3], 0.08, M.steel); box(g, 0.64, 0.4, 0.05, M.violet, -1.58, 3.86, -1.3); }
  return g;
}
function target(g, x, z, level) {
  box(g, 0.12, 1.2, 0.12, M.steel, x, 0.85, z);
  cyl(g, 0.46, 0.46, 0.055, M.sand, x, 1.48, z, 12).rotation.x = Math.PI / 2;
  cyl(g, 0.26, 0.26, 0.06, M.purple, x, 1.48, z + 0.04, 12).rotation.x = Math.PI / 2;
  cyl(g, 0.1, 0.1, 0.065, level > 3 ? M.green : M.amber, x, 1.48, z + 0.07, 12).rotation.x = Math.PI / 2;
}
function ridgewatch(level) {
  const g = new THREE.Group(); foundation(g, level);
  for (let i = 0; i < 3; i++) {
    const x = -1.95 + i * 1.95;
    box(g, 1.4, 0.14, 3.8, i % 2 ? M.olive : M.sand, x, 0.42, 0);
    box(g, 1.52, 0.72 + level * 0.06, 0.3, M.dark, x, 0.73, 1.75);
    target(g, x, -1.45, level);
  }
  for (const x of [-2.6, 2.6]) for (let j = 0; j < 3; j++) box(g, 0.32, 0.23, 0.68, M.sand, x, 0.48 + j * 0.23, 0.7);
  if (level >= 2) { box(g, 1.35, 1.65, 1.4, M.olive, 2.0, 1.17, 1.7); box(g, 1.5, 0.2, 1.55, M.canvas, 2.0, 2.1, 1.7); }
  if (level >= 3) { beam(g, [-2.55, 0.4, 2.0], [-2.55, 3.25, 2.0], 0.13, M.steel); box(g, 1.45, 0.14, 1.45, M.dark, -2.55, 3.25, 2.0); }
  if (level >= 4) { for (const x of [-2.3, 2.3]) { box(g, 0.2, 2.6, 0.2, M.steel, x, 1.6, -2.15); box(g, 0.36, 0.26, 0.36, M.green, x, 2.95, -2.15); } }
  if (level >= 5) { box(g, 3.9, 0.18, 0.22, M.purple, 0, 2.08, 2.02); for (let i = 0; i < 3; i++) box(g, 0.3, 0.38, 0.08, M.green, -1.8 + i * 1.8, 2.15, 2.07); }
  return g;
}
function signal(level) {
  const g = new THREE.Group(); foundation(g, level, true);
  box(g, 5.1, 0.28, 4.25, M.olive, 0, 0.52, 0);
  for (let i = 0; i < 4; i++) box(g, 0.15, 0.9, 0.15, M.steel, (i % 2 ? 2.2 : -2.2), 0.6, (i > 1 ? 1.6 : -1.6));
  box(g, 1.6, 1.85 + level * 0.2, 1.6, M.dark, -0.95, 1.55, 0.35);
  box(g, 1.34, 0.52, 0.06, M.purple, -0.95, 1.75, 1.18);
  cyl(g, 0.12, 0.16, 2.1 + level * 0.32, M.steel, 1.15, 1.7 + level * 0.16, -0.6);
  const dish = cyl(g, 1.05 + level * 0.1, 0.28, 0.28, M.steel, 1.15, 2.9 + level * 0.32, -0.6, 12); dish.rotation.x = 0.48;
  cyl(g, 0.13, 0.13, 0.18, M.green, 1.15, 3.06 + level * 0.32, -0.45);
  if (level >= 2) { box(g, 1.15, 0.08, 0.72, M.purple, 1.8, 0.95, 1.6); for (let i = 0; i < 4; i++) box(g, 0.045, 0.09, 0.78, M.steel, 1.38 + i * 0.3, 1.02, 1.6); }
  if (level >= 3) { beam(g, [-2.1, 0.7, -1.3], [-2.1, 4.6, -1.3], 0.08, M.steel); for (let i = 0; i < 3; i++) box(g, 0.8, 0.08, 0.08, M.green, -2.1, 2.3 + i * 0.62, -1.3); }
  if (level >= 4) { const second = cyl(g, 0.68, 0.22, 0.22, M.steel, -2.0, 2.65, 1.1, 12); second.rotation.z = 0.5; beam(g, [-2, 0.7, 1.1], [-2, 2.65, 1.1], 0.11, M.steel); }
  if (level >= 5) { box(g, 3.8, 0.18, 0.2, M.violet, -0.25, 3.65, 0.25); box(g, 1.35, 0.16, 1.35, M.green, -0.95, 3.8, 0.35); }
  return g;
}
function highland(level) {
  const g = new THREE.Group(); foundation(g, level);
  box(g, 3.3, 2.2 + level * 0.12, 2.3, M.olive, -0.7, 1.5, -0.75);
  box(g, 3.5, 0.22, 2.55, M.dark, -0.7, 2.7 + level * 0.12, -0.75);
  box(g, 1.5, 0.88, 0.1, M.amber, -0.7, 1.27, 0.45);
  for (const x of [-2.15, 0.75]) box(g, 0.2, 1.75, 0.24, M.steel, x, 1.25, 0.48);
  cyl(g, 0.38, 0.4, 2 + level * 0.35, M.dark, 0.2, 2.7 + level * 0.25, -1.55);
  cyl(g, 0.48, 0.48, 0.16, M.steel, 0.2, 3.75 + level * 0.43, -1.55);
  for (let i = 0; i < level + 1; i++) box(g, 0.78, 0.58, 1.1, i % 2 ? M.steel : M.dark, 1.75, 0.62 + Math.floor(i / 3) * 0.6, -1.9 + (i % 3) * 1.15);
  if (level >= 2) { beam(g, [2.55, 0.45, 1.85], [2.55, 3.5, 1.85], 0.13, M.steel); beam(g, [2.55, 3.5, 1.85], [-1, 3.5, 1.85], 0.12, M.steel); }
  if (level >= 3) { box(g, 1.5, 1.05, 1.15, M.dark, 1.65, 0.87, 1.05); box(g, 0.85, 0.28, 0.06, M.purple, 1.65, 1.25, 1.66); }
  if (level >= 4) { for (const x of [-2.5, 2.5]) box(g, 0.24, 2.7, 0.24, M.steel, x, 1.55, -2.35); box(g, 5.3, 0.16, 0.16, M.green, 0, 2.9, -2.35); }
  if (level >= 5) { box(g, 3.2, 0.15, 0.2, M.violet, -0.7, 3.26 + level * 0.12, 0.45); box(g, 1.2, 0.45, 0.1, M.green, -0.7, 3.54 + level * 0.12, 0.45); }
  return g;
}

const makers = { timberline, ridgewatch, signal, highland };
const manifest = {
  schemaVersion: 1,
  provenance: 'Original procedural district geometry authored for DZN Stronghold Wars; no paid provider or third-party game art.',
  license: 'Project-owned original', unit: 'metre', coordinateSystem: 'Y up', assets: {},
};
for (const [family, make] of Object.entries(makers)) for (let level = 1; level <= 5; level++) {
  const name = `${family}_l0${level}`;
  const scene = make(level); scene.name = name;
  const bytes = Buffer.from(await exporter.parseAsync(scene, { binary: true, onlyVisible: true }));
  await writeFile(path.join(root, `${name}.glb`), bytes);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  manifest.assets[name] = {
    file: `assets/models/facilities/${name}.glb`, sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length, dimensions: size.toArray().map(n => Number(n.toFixed(3))),
  };
}
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created ${Object.keys(manifest.assets).length} original district GLBs in ${root}`);
