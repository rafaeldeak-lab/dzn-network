// Original DZN Chronicle Beacon artwork. Five Hall-linked stages, generated locally.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.FileReader) globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); }); }
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../preview/assets/models/chronicle');
await mkdir(root, { recursive: true });
const exporter = new GLTFExporter();
const mat = color => new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .12, flatShading: true });
const glow = color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .55, roughness: .4, flatShading: true });
const M = { concrete: mat(0x626c68), dark: mat(0x27322f), steel: mat(0x87918c),
  olive: mat(0x526348), brass: mat(0xb9a16b), purple: glow(0x9b66d3), green: glow(0x65db9a) };
function box(group, w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z); group.add(mesh); return mesh;
}
function beacon(level) {
  const group = new THREE.Group();
  box(group, 2.7, .2, 2.7, M.concrete, 0, .1, 0);
  box(group, 2.25, .18, 2.25, M.dark, 0, .29, 0);
  const height = 1.15 + level * .57;
  box(group, 1.12, height, 1.12, M.olive, 0, .38 + height / 2, 0);
  for (const x of [-.59, .59]) for (const z of [-.59, .59]) {
    box(group, .16, height + .18, .16, M.steel, x, .38 + (height + .18) / 2, z);
  }
  for (let tier = 0; tier < level; tier++) {
    const y = .76 + tier * .5;
    box(group, 1.28, .12, 1.28, M.brass, 0, y, 0);
    box(group, .8, .18, .045, tier % 2 ? M.green : M.purple, 0, y + .24, .59);
    box(group, .8, .18, .045, tier % 2 ? M.purple : M.green, 0, y + .24, -.59);
  }
  box(group, 1.62, .2, 1.62, M.steel, 0, .48 + height, 0);
  box(group, 1.26, .12, 1.26, M.purple, 0, .65 + height, 0);
  if (level >= 2) for (const x of [-1.03, 1.03]) box(group, .12, height * .75, .12, M.steel, x, .38 + height * .4, 0);
  if (level >= 3) {
    box(group, .12, .75, .12, M.steel, 0, 1.1 + height, 0);
    box(group, .8, .08, .08, M.green, 0, 1.38 + height, 0);
  }
  if (level >= 4) for (const x of [-1.05, 1.05]) box(group, .2, .2, .2, M.green, x, .7 + height, 0);
  if (level >= 5) {
    const crown = new THREE.Mesh(new THREE.OctahedronGeometry(.54, 0), M.purple);
    crown.position.set(0, 1.67 + height, 0); group.add(crown);
    for (const z of [-1.06, 1.06]) box(group, .1, .6, .1, M.brass, 0, 1.02 + height, z);
  }
  return group;
}

const manifest = { schemaVersion: 1, provenance: 'Original procedural DZN Chronicle Beacon artwork; no paid provider or third-party game art.', license: 'Project-owned original', unit: 'metre', coordinateSystem: 'Y up', assets: {} };
for (let level = 1; level <= 5; level++) {
  const name = `chronicle_beacon_l0${level}`;
  const scene = beacon(level); scene.name = name;
  const bytes = Buffer.from(await exporter.parseAsync(scene, { binary: true, onlyVisible: true }));
  await writeFile(path.join(root, `${name}.glb`), bytes);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  manifest.assets[name] = { file: `assets/models/chronicle/${name}.glb`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, dimensions: size.toArray().map(n => Number(n.toFixed(3))) };
}
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created ${Object.keys(manifest.assets).length} DZN Chronicle Beacon GLBs in ${root}`);
