// Reproducible, original low-poly scenery kit for the local Stronghold preview.
// No external generator, account credit, or third-party asset is involved.
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../preview/assets/models/scenery');
await mkdir(root, { recursive: true });
const exporter = new GLTFExporter();
const mat = color => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true });
const bark = mat(0x66472e);
const barkDark = mat(0x493526);
const cutWood = mat(0xc09a60);
const stone = mat(0x737c78);
const stoneDark = mat(0x4d5958);
const metal = mat(0x727c77);
const accent = mat(0x58c78b);
const foliage = [0x477b50, 0x3b7250, 0x31694b, 0x295d48, 0x245442].map(mat);

function mesh(group, geometry, material, x = 0, y = 0, z = 0, ry = 0) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(x, y, z);
  item.rotation.y = ry;
  group.add(item);
  return item;
}
function cylinder(group, top, bottom, height, material, x, y, z, sides = 8) {
  return mesh(group, new THREE.CylinderGeometry(top, bottom, height, sides), material, x, y, z);
}
function box(group, w, h, d, material, x, y, z) {
  return mesh(group, new THREE.BoxGeometry(w, h, d), material, x, y, z);
}
function tree(level) {
  const group = new THREE.Group();
  group.name = `pine_l0${level}`;
  const trunkHeight = 1.1 + level * 0.48;
  const trunkRadius = 0.13 + level * 0.045;
  cylinder(group, trunkRadius * 0.75, trunkRadius, trunkHeight, bark, 0, trunkHeight / 2, 0);
  cylinder(group, trunkRadius * 0.85, trunkRadius * 1.25, 0.1, barkDark, 0, 0.05, 0);
  const crownCount = 2 + Math.min(level, 4);
  const crownBase = 0.5 + trunkHeight * 0.36;
  const crownTop = trunkHeight + 1.15 + level * 0.25;
  for (let i = 0; i < crownCount; i++) {
    const t = i / crownCount;
    const radius = (0.55 + level * 0.20) * (1 - t * 0.64);
    const h = (crownTop - crownBase) / crownCount * 1.85;
    mesh(group, new THREE.ConeGeometry(radius, h, 7), foliage[level - 1], 0, crownBase + i * (crownTop - crownBase) / crownCount + h * 0.25, 0, i * 0.15);
  }
  return group;
}
function stump() {
  const group = new THREE.Group(); group.name = 'pine_stump';
  cylinder(group, 0.46, 0.52, 0.62, bark, 0, 0.31, 0, 9);
  cylinder(group, 0.46, 0.46, 0.025, cutWood, 0, 0.635, 0, 9);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    box(group, 0.12, 0.16, 0.36, barkDark, Math.sin(a) * 0.44, 0.08, Math.cos(a) * 0.44);
  }
  return group;
}
function logStack() {
  const group = new THREE.Group(); group.name = 'pine_log_stack';
  for (const [x, y, z] of [[-0.42, 0.22, 0], [0.42, 0.22, 0], [0, 0.61, 0]]) {
    const log = cylinder(group, 0.22, 0.22, 2.25, bark, x, y, z, 9);
    log.rotation.z = Math.PI / 2;
    const end = cylinder(group, 0.22, 0.22, 0.026, cutWood, x + 1.14, y, z, 9);
    end.rotation.z = Math.PI / 2;
  }
  return group;
}
function boulder() {
  const group = new THREE.Group(); group.name = 'granite_boulder';
  const rock = mesh(group, new THREE.IcosahedronGeometry(0.95, 0), stone, 0, 0.7, 0);
  rock.scale.set(1.35, 0.85, 0.95);
  const shard = mesh(group, new THREE.IcosahedronGeometry(0.48, 0), stoneDark, 0.82, 0.30, 0.35);
  shard.scale.set(0.9, 0.55, 1.1);
  return group;
}
function claimMarker() {
  const group = new THREE.Group(); group.name = 'claim_marker';
  cylinder(group, 0.75, 0.83, 0.12, stoneDark, 0, 0.06, 0, 8);
  cylinder(group, 0.61, 0.61, 0.035, stone, 0, 0.14, 0, 8);
  cylinder(group, 0.10, 0.13, 0.75, metal, 0, 0.55, 0);
  box(group, 0.7, 0.36, 0.04, accent, 0.31, 0.85, 0);
  return group;
}

const assets = Object.fromEntries([
  ...Array.from({ length: 5 }, (_, index) => [`pine_l0${index + 1}`, tree(index + 1)]),
  ['pine_stump', stump()], ['pine_log_stack', logStack()],
  ['granite_boulder', boulder()], ['claim_marker', claimMarker()],
]);
const manifest = {
  schemaVersion: 1,
  provenance: 'Original procedural geometry authored for DZN Stronghold Wars; no paid provider or external art source.',
  license: 'Project-owned original',
  unit: 'metre', coordinateSystem: 'Y up',
  assets: {},
};
for (const [name, scene] of Object.entries(assets)) {
  const buffer = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
  const bytes = Buffer.from(buffer);
  const filename = `${name}.glb`;
  await writeFile(path.join(root, filename), bytes);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  manifest.assets[name] = {
    file: `assets/models/scenery/${filename}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    dimensions: size.toArray().map(n => Number(n.toFixed(3))),
  };
}
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created ${Object.keys(assets).length} scenery GLBs in ${root}`);
