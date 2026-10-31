// Five original DZN perimeter segments, sized for the 2 m Stronghold grid.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.FileReader) globalThis.FileReader = class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(bytes => { this.result = bytes; this.onloadend?.(); }); } };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../preview/assets/models/walls');
await mkdir(root, { recursive: true });
const exporter = new GLTFExporter();
const mat = (color, metalness = .15, roughness = .7, glow = 0) => new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive: glow ? color : 0, emissiveIntensity: glow });
const steel = mat(0x343c42, .78, .4), stone = mat(0x5b625b, .06, .92), edge = mat(0x858e8b, .6, .45);
const bark = mat(0x6b4731, .03, .9), purple = mat(0x724399, .5, .38), lime = mat(0x93f652, .14, .32, .5);
function part(group, geo, material, name, x, y, z) { const item = new THREE.Mesh(geo, material); item.name = name; item.position.set(x, y, z); group.add(item); return item; }
function box(group, w, h, d, material, name, x, y, z) { return part(group, new RoundedBoxGeometry(w, h, d, 3, Math.min(w,h,d)*.12), material, name, x, y, z); }
function cylinder(group, radius, height, material, name, x, y, z, sides = 16) { return part(group, new THREE.CylinderGeometry(radius, radius, height, sides), material, name, x, y, z); }
function segment(level) {
  const g = new THREE.Group(); g.name = `dzn_wall_l0${level}`;
  box(g, 1.84, .18, .82, stone, 'continuous_footing', 0, .09, 0);
  if (level <= 2) {
    for (const x of [-.57, 0, .57]) {
      const log = cylinder(g, .21, 1.68, bark, 'reclaimed_timber', x, .93, 0, 20);
      log.rotation.z = Math.PI / 2;
      cylinder(g, .07, 1.67, edge, 'steel_binding', x, .84, .21, 12).rotation.z = Math.PI / 2;
    }
    for (const x of [-.75, .75]) box(g, .11, 1.48, .52, level === 2 ? steel : stone, 'end_post', x, .83, 0);
    if (level === 2) box(g, 1.72, .11, .55, purple, 'purple_upgrade_cap', 0, 1.62, 0);
  } else {
    box(g, 1.72, 1.52 + (level - 3) * .19, .62, steel, 'armoured_barrier', 0, 1.0 + (level - 3) * .095, 0);
    for (const x of [-.61, 0, .61]) {
      box(g, .49, .94, .09, level === 5 ? purple : stone, 'separate_face_plate', x, 1.0, .37);
      for (const y of [.62, 1.39]) cylinder(g, .035, .025, edge, 'fastener', x, y, .43).rotation.x = Math.PI / 2;
    }
    box(g, 1.81, .13, .77, purple, 'tier_cap', 0, 1.79 + (level - 3) * .19, 0);
    if (level >= 4) {
      box(g, 1.44, .065, .045, lime, 'powered_safety_rail', 0, 1.44, .43);
      for (const x of [-.81,.81]) box(g, .13, 1.84 + (level-4)*.2, .71, edge, 'reinforced_terminal', x, 1.01, 0);
    }
    if (level === 5) {
      for (const x of [-.58,.58]) {
        box(g, .2, .42, .13, lime, 'active_defence_node', x, 1.91, .22);
        cylinder(g, .11, .16, steel, 'sensor_housing', x, 2.02, .32).rotation.x = Math.PI / 2;
      }
    }
  }
  return g;
}
const manifest = { schemaVersion: 1, provenance: 'Original local procedural DZN perimeter geometry; no paid service', license: 'Project-owned original', assets: {} };
for (let level = 1; level <= 5; level++) {
  const name = `wall_l0${level}`;
  const model = segment(level);
  const bytes = Buffer.from(await exporter.parseAsync(model, { binary: true, onlyVisible: true }));
  await writeFile(path.join(root, `${name}.glb`), bytes);
  manifest.assets[name] = { file: `assets/models/walls/${name}.glb`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, meshes: model.getObjectsByProperty('isMesh', true).length };
}
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created ${Object.keys(manifest.assets).length} wall levels`);
