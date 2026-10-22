// Original, reproducible DZN supply-route kit. Five visual tiers, no paid provider.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.FileReader) globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); }); }
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../preview/assets/models/routes');
await mkdir(root, { recursive: true });
const exporter = new GLTFExporter();
const mat = color => new THREE.MeshStandardMaterial({ color, roughness: .88, flatShading: true });
const signal = color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .42, roughness: .52, flatShading: true });
const M = {
  dirt: mat(0x65513b), mud: mat(0x473a32), timber: mat(0x775235), steel: mat(0x758681),
  stone: mat(0x828a80), concrete: mat(0x5d6862), purple: signal(0x9b65cf), green: signal(0x5ee0a0),
  dark: mat(0x26332f), amber: mat(0xd8ad69),
};
function box(group, width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z); group.add(mesh); return mesh;
}
function post(group, x, z, height, glow) {
  box(group, .13, height, .13, M.steel, x, height / 2, z);
  box(group, .32, .16, .32, glow, x, height + .07, z);
}
function route(level) {
  const group = new THREE.Group();
  box(group, 2.35, .06, 3.8, M.mud, 0, .03, 0);
  box(group, 2.13, .055, 3.72, level >= 3 ? M.concrete : M.dirt, 0, .09, 0);
  for (const x of [-.72, .72]) box(group, .22, .035, 3.48, level >= 3 ? M.stone : M.mud, x, .14, 0);
  if (level < 4) {
    for (const z of [-1.45, 1.45]) { post(group, -1.25, z, .62, M.purple); post(group, 1.25, z, .62, M.green); }
    for (const x of [-1.08, 1.08]) box(group, .07, .045, 3.55, x < 0 ? M.purple : M.green, x, .19, 0);
  }
  if (level >= 2) for (let i = 0; i < 9; i++) box(group, 2.26, .085, .19, M.timber, 0, .19, -1.65 + i * .41);
  if (level >= 3) {
    for (const x of [-1.12, 1.12]) box(group, .16, .17, 3.78, M.stone, x, .17, 0);
    for (let i = 0; i < 6; i++) box(group, .75, .018, .18, M.stone, (i % 2 ? .4 : -.4), .255, -1.45 + i * .56);
  }
  if (level >= 4) {
    for (const x of [-1.03, 1.03]) box(group, .12, .07, 3.6, M.steel, x, .3, 0);
    for (const z of [-1.45, 1.45]) { post(group, -1.25, z, .72, M.green); post(group, 1.25, z, .72, M.green); }
  }
  if (level >= 5) {
    box(group, .11, .026, 3.6, M.purple, 0, .28, 0);
    for (const x of [-.94, .94]) box(group, .055, .025, 3.6, M.green, x, .31, 0);
    for (const z of [-1.45, 1.45]) { post(group, -1.25, z, 1.08, M.purple); post(group, 1.25, z, 1.08, M.purple); }
    for (const z of [-.8, .8]) box(group, .25, .025, .25, M.amber, 0, .32, z);
  }
  return group;
}

const manifest = { schemaVersion: 1, provenance: 'Original procedural DZN Stronghold supply-route geometry; no paid provider or third-party game art.', license: 'Project-owned original', unit: 'metre', coordinateSystem: 'Y up', assets: {} };
for (let level = 1; level <= 5; level++) {
  const name = `supply_route_l0${level}`;
  const scene = route(level); scene.name = name;
  const bytes = Buffer.from(await exporter.parseAsync(scene, { binary: true, onlyVisible: true }));
  await writeFile(path.join(root, `${name}.glb`), bytes);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  manifest.assets[name] = { file: `assets/models/routes/${name}.glb`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, dimensions: size.toArray().map(n => Number(n.toFixed(3))) };
}
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created ${Object.keys(manifest.assets).length} DZN supply-route GLBs in ${root}`);
