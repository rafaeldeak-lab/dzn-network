// Reproducible, original low-poly scenery kit for the local Stronghold preview.
// No external generator, account credit, or third-party asset is involved.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
const mat = color => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
const bark = mat(0x66472e);
const barkDark = mat(0x493526);
const cutWood = mat(0xc09a60);
const stone = mat(0x56635c);
const stoneDark = mat(0x3c4943);
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
  cylinder(group, trunkRadius * .72, trunkRadius, trunkHeight, bark, 0, trunkHeight / 2, 0, 14).name = 'tapered_trunk';
  cylinder(group, trunkRadius * .86, trunkRadius * 1.4, .12, barkDark, 0, .06, 0, 14);
  const crownCount = 3 + Math.min(level, 4);
  const crownBase = .35 + trunkHeight * .35;
  const crownTop = trunkHeight + 1.08 + level * .25;
  const leaves = [];
  for (let i = 0; i < crownCount; i++) {
    const t = i / crownCount;
    const radius = (.5 + level * .18) * (1 - t * .66);
    const y = crownBase + i * (crownTop - crownBase) / crownCount;
    const h = (crownTop - crownBase) / crownCount * 1.8;
    const core = new THREE.ConeGeometry(radius, h, 12);
    core.translate(0, y + h * .2, 0);
    leaves.push(core);
    for (let branch = 0; branch < 3; branch++) {
      const a = branch * Math.PI * 2 / 3 + i * .65;
      const tuft = new THREE.SphereGeometry(1, 8, 6);
      tuft.scale(radius * .45, h * .25, radius * .36);
      tuft.translate(Math.sin(a) * radius * .56, y - h * .02, Math.cos(a) * radius * .56);
      leaves.push(tuft);
    }
  }
  mesh(group, mergeGeometries(leaves, false), foliage[level - 1]).name = 'layered_branch_crown';
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
  const rock = mesh(group, new THREE.IcosahedronGeometry(.95, 1), stone, 0, .55, 0);
  rock.scale.set(1.36, .62, .98);
  const shard = mesh(group, new THREE.IcosahedronGeometry(.48, 1), stoneDark, .82, .3, .35);
  shard.scale.set(.95, .6, 1.1);
  for (const [x, z] of [[-.5, .22], [.1, -.35], [.64, .21]]) {
    const moss = mesh(group, new THREE.SphereGeometry(.24, 10, 7), foliage[2], x, .87 - Math.abs(x) * .22, z);
    moss.scale.set(1.2, .12, .9);
  }
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

function fallenTrunk() {
  const group = new THREE.Group(); group.name = 'fallen_trunk';
  const body = cylinder(group, .31, .39, 3.65, bark, 0, .42, 0, 16);
  body.rotation.z = Math.PI / 2;
  for (const x of [-1.84, 1.84]) {
    const end = cylinder(group, .29, .29, .035, cutWood, x, .42, 0, 16);
    end.rotation.z = Math.PI / 2;
    mesh(group, new THREE.TorusGeometry(.18, .012, 6, 24), barkDark, x + (x > 0 ? .025 : -.025), .42, 0).rotation.y = Math.PI / 2;
  }
  for (const x of [-1.2, -.55, .36, 1.24]) {
    const knot = mesh(group, new THREE.SphereGeometry(.16, 9, 6), barkDark, x, .62, .18);
    knot.scale.set(1.2, .4, .65);
  }
  return group;
}
function fernPatch() {
  const group = new THREE.Group(); group.name = 'fern_patch';
  for (let stem = 0; stem < 7; stem++) {
    const a = stem * 2.39996;
    const radius = .12 + stem % 3 * .12;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius;
    const frond = mesh(group, new THREE.ConeGeometry(.24 + stem % 2 * .07, .55 + stem % 3 * .13, 9), foliage[stem % foliage.length], x, .32, z, a);
    frond.rotation.z = Math.sin(a) * .38;
    frond.rotation.x = Math.cos(a) * .38;
  }
  return group;
}
function rockCluster() {
  const group = new THREE.Group(); group.name = 'mossy_rock_cluster';
  for (const [x, y, z, scale] of [[0, .34, 0, .68], [.65, .25, .22, .43], [-.49, .21, -.31, .36]]) {
    const rock = mesh(group, new THREE.IcosahedronGeometry(1, 1), stone, x, y, z);
    rock.scale.set(scale * 1.2, scale * .64, scale);
    const moss = mesh(group, new THREE.IcosahedronGeometry(1, 1), foliage[2], x, y + scale * .42, z);
    moss.scale.set(scale * .72, .04, scale * .56);
  }
  return group;
}
function brushPile() {
  const group = new THREE.Group(); group.name = 'brush_pile';
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996;
    const twig = cylinder(group, .045, .06, .85 + i % 3 * .2, barkDark, Math.sin(a) * .2, .16 + i % 2 * .055, Math.cos(a) * .2, 8);
    twig.rotation.z = Math.PI / 2 + Math.sin(a) * .3;
    twig.rotation.y = a;
  }
  for (let i = 0; i < 5; i++) {
    const a = i * 1.2566;
    mesh(group, new THREE.SphereGeometry(.2, 8, 6), foliage[i], Math.sin(a) * .43, .25, Math.cos(a) * .4).scale.set(1.25, .35, 1);
  }
  return group;
}
function lumberPallet() {
  const group = new THREE.Group(); group.name = 'lumber_pallet';
  for (const z of [-.45, .45]) box(group, 1.85, .12, .18, barkDark, 0, .13, z);
  for (let i = 0; i < 6; i++) box(group, .2, .08, 1.45, cutWood, -.75 + i * .3, .26, 0);
  for (let stack = 0; stack < 3; stack++) for (let i = 0; i < 4; i++) {
    box(group, 1.7, .09, .16, stack % 2 ? bark : cutWood, 0, .38 + stack * .1, -.38 + i * .24);
  }
  for (const x of [-.75, .75]) box(group, .07, .4, .08, metal, x, .48, .56);
  return group;
}

const assets = Object.fromEntries([
  ...Array.from({ length: 5 }, (_, index) => [`pine_l0${index + 1}`, tree(index + 1)]),
  ['pine_stump', stump()], ['pine_log_stack', logStack()],
  ['granite_boulder', boulder()], ['claim_marker', claimMarker()],
  ['fallen_trunk', fallenTrunk()], ['fern_patch', fernPatch()],
  ['mossy_rock_cluster', rockCluster()], ['brush_pile', brushPile()], ['lumber_pallet', lumberPallet()],
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
