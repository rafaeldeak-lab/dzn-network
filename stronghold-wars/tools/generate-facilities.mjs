// Original, reproducible DZN Stronghold district kit. No paid asset service.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
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
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x60402b, roughness: .91 });
  const woodLight = new THREE.MeshStandardMaterial({ color: 0xaa7950, roughness: .88 });
  const endGrain = new THREE.MeshStandardMaterial({ color: 0xd2ae78, roughness: .86 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x32383b, metalness: .7, roughness: .42 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xa4adb0, metalness: .72, roughness: .33 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x283831, metalness: .42, roughness: .7, side: THREE.DoubleSide });
  wood.name = 'DZN_BARK_TEX'; woodLight.name = 'DZN_LUMBER_TEX'; roof.name = 'DZN_ROOF_TEX';
  const glow = new THREE.MeshStandardMaterial({ color: 0xa0ff80, emissive: 0x56ec51, emissiveIntensity: 1.35, roughness: .3 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x633583, metalness: .42, roughness: .53 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x505a53, roughness: 1 });
  const cylinder = (radius, length, material, x, y, z, sides = 18) => cyl(g, radius, radius, length, material, x, y, z, sides);
  const timber = (x, y, z, length = 1.65, radius = .18) => {
    const trunk = cylinder(radius, length, wood, x, y, z, 18); trunk.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      const face = cylinder(radius * .99, .018, endGrain, x + side * (length / 2 + .007), y, z, 18);
      face.rotation.z = Math.PI / 2;
      const ring = mesh(g, new THREE.TorusGeometry(radius * .68, .013, 5, 24), woodLight, x + side * (length / 2 + .02), y, z);
      ring.rotation.y = Math.PI / 2;
    }
    for (let n = 0; n < 3; n++) {
      const groove = box(g, length * .68, .012, .012, woodLight, x, y + radius * .89, z - .09 + n * .09);
      groove.rotation.x = .15 * n;
    }
  };
  g.name = `timberline_l0${level}`;
  box(g, 6.5, .23, 6.1, stone, 0, .115, 0).name = 'stone_yard_base';
  box(g, 6.12, .045, 5.72, M.edge, 0, .255, 0);
  // A working sawmill: stone footings, timber braces, pitched steel roof and a visible carriage.
  for (const x of [-2.35, 1.08]) for (const z of [-2.2, .48]) {
    cylinder(.16, 2.22, woodLight, x, 1.42, z);
    cylinder(.25, .16, iron, x, .37, z);
    box(g, .29, .12, .29, steel, x, 2.54, z);
  }
  for (const z of [-2.2, .48]) for (const x of [-2.35, 1.08]) {
    beam(g, [x, .45, z], [x + (x < 0 ? .8 : -.8), 1.4, z], .065, wood);
  }
  for (const side of [-1, 1]) {
    const panel = mesh(g, new RoundedBoxGeometry(2.06, .12, 3.12, 3, .045), roof, -.63 + side * .96, 2.82, -.86);
    panel.rotation.z = side * -.31;
    for (let stripe = 0; stripe < 4; stripe++) {
      const x = -.63 + side * (.25 + stripe * .47);
      const seam = box(g, .028, .032, 3.14, iron, x, 2.82 + (.96 - Math.abs(x + .63)) * .28, -.86);
      seam.rotation.z = side * -.31;
    }
  }
  box(g, .15, .12, 3.25, trim, -.63, 3.11, -.86).name = 'roof_spine';
  for (let i = 0; i < 4; i++) box(g, .035, .17, 2.3, woodLight, -2.17 + i * .99, 1.39, -.85);
  for (let i = 0; i < 6; i++) box(g, 3.15, .038, .11, i % 2 ? wood : woodLight, -.64, 1.38, -1.98 + i * .45);
  mesh(g, new RoundedBoxGeometry(2.58, .18, 1.18, 3, .055), iron, -.45, .58, 1.55).name = 'saw_carriage';
  for (const x of [-1.48, .62]) {
    const rail = cylinder(.12, 2.62, steel, x, .78, 1.55); rail.rotation.x = Math.PI / 2;
  }
  for (let i = 0; i < 5 + level; i++) timber(1.65, .53 + Math.floor(i / 3) * .38, -1.55 + i % 3 * .41);
  for (let i = 0; i < 2 + Math.floor(level / 2); i++) timber(-1.47 + i * .25, .78, 2.15, 1.4, .12);
  // Keep the complete blade, hub and teeth on one pivot so gameplay can spin the
  // whole saw, instead of making a moving disk pass through static teeth.
  const rotor = new THREE.Group(); rotor.name = 'saw_rotor'; rotor.position.set(-.5, 1.25, 1.27); g.add(rotor);
  const blade = cyl(rotor, .61, .61, .065, steel, 0, 0, -.05, 32);
  blade.rotation.x = Math.PI / 2;
  blade.name = 'circular_saw_blade';
  mesh(rotor, new THREE.TorusGeometry(.59, .033, 6, 32), iron, 0, 0, 0);
  cyl(rotor, .13, .13, .12, trim, 0, 0, .03).rotation.x = Math.PI / 2;
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    const tooth = box(rotor, .12, .065, .07, steel, Math.cos(angle) * .62, Math.sin(angle) * .62, -.01);
    tooth.rotation.z = angle;
  }
  for (const x of [-1.12, .13]) beam(g, [x, .5, .92], [x, 1.75, .92], .035, iron);
  beam(g, [-1.12, 1.75, .92], [.13, 1.75, .92], .038, iron);
  box(g, 1.25, .06, .13, glow, -.5, 1.76, .92).name = 'saw_safety_light';
  // The unloading bay remains open, with readable machinery even from the game camera.
  for (const x of [-1.95, -.95, .05, 1.05]) {
    const roller = cylinder(.13, 1.7, steel, x, .46, 1.95, 22);
    roller.rotation.x = Math.PI / 2;
    roller.name = `conveyor_roller_${Math.round((x + 1.95) * 10)}`;
    for (const z of [1.26, 2.64]) cylinder(.17, .08, iron, x, .46, z, 18).rotation.x = Math.PI / 2;
  }
  for (const z of [1.05, 2.82]) {
    beam(g, [-2.55, .42, z], [1.63, .42, z], .06, trim);
    for (const x of [-2.3, 1.4]) cylinder(.12, .29, steel, x, .48, z);
  }
  for (const x of [-2.75, 1.75]) {
    beam(g, [x, .28, .63], [x, 1.33, .63], .045, steel);
    box(g, .3, .12, .1, glow, x, 1.38, .63).name = 'yard_safety_lamp';
  }
  const extractor = cylinder(.33, 1.25, iron, -.65, 3.02, -1.37, 24);
  extractor.rotation.x = Math.PI / 2;
  cylinder(.47, .16, steel, -.65, 3.03, -.7, 24).rotation.x = Math.PI / 2;
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI * 2 / 10;
    const chip = mesh(g, new THREE.IcosahedronGeometry(.12 + i % 3 * .025, 0), i % 2 ? woodLight : endGrain,
      2.18 + Math.cos(a) * .42, .38 + i % 4 * .11, -1.15 + Math.sin(a) * .3);
    chip.rotation.set(a * .3, a, a * .5);
  }
  if (level >= 2) {
    box(g, 1.08, 1.18, 1.05, iron, 2.1, .91, 1.2).name = 'hydraulic_sorter';
    for (let i = 0; i < 4; i++) box(g, .17, .33, .04, glow, 1.75 + i * .23, 1.3, 1.75);
    for (const x of [1.68, 2.52]) cylinder(.19, .15, steel, x, .42, 1.52);
  }
  if (level >= 3) {
    beam(g, [2.78, .35, -.3], [2.78, 3.88, -.3], .09, steel);
    beam(g, [2.78, 3.88, -.3], [.3, 3.88, -.3], .09, steel);
    beam(g, [2.78, 3.88, -.3], [2.48, .42, -.3], .048, iron);
    beam(g, [.72, 3.88, -.3], [.72, 2.75, -.3], .028, iron);
    const hook = mesh(g, new THREE.TorusGeometry(.18, .045, 7, 18, Math.PI * 1.5), M.amber, .72, 2.54, -.3);
    hook.rotation.z = Math.PI / 2;
    hook.name = 'loading_crane_hook';
  }
  if (level >= 4) {
    box(g, .89, 1.22, .75, iron, -2.55, 1, 1.48).name = 'auto_feed_motor';
    for (const x of [-2.95, -2.55, -2.15]) cylinder(.11, .11, trim, x, 1.56, 1.85);
    for (const z of [1.08, 1.48, 1.88]) box(g, .62, .03, .04, glow, -2.55, 1.68, z);
  }
  if (level >= 5) {
    beam(g, [-2.18, 2.75, -1.86], [-2.18, 4.26, -1.86], .07, steel);
    const beacon = mesh(g, new THREE.SphereGeometry(.16, 16, 10), glow, -2.18, 4.3, -1.86);
    beacon.name = 'elite_yard_beacon';
    for (const x of [-2.03, .76]) box(g, .055, .08, 2.9, glow, x, 2.47, -.86);
    box(g, 2.25, .11, .1, trim, -.63, 2.94, .6);
  }
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
const align4 = size => (size + 3) & ~3;
const textureRoot = path.resolve(root, '../../textures/timberline');
const timberlineTextures = {
  DZN_BARK_TEX: await readFile(path.join(textureRoot, 'weathered-pine.jpg')),
  DZN_LUMBER_TEX: await readFile(path.join(textureRoot, 'weathered-pine.jpg')),
  DZN_ROOF_TEX: await readFile(path.join(textureRoot, 'weathered-metal.jpg')),
};
function embedTimberlineTextures(original) {
  const jsonLength = original.readUInt32LE(12);
  const gltf = JSON.parse(original.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength;
  const binLength = original.readUInt32LE(binStart);
  const chunks = [original.subarray(binStart + 8, binStart + 8 + binLength)];
  let binSize = binLength;
  const views = new Map();
  gltf.images ||= []; gltf.textures ||= []; gltf.samplers ||= [];
  const sampler = gltf.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }) - 1;
  for (const [materialName, textureBytes] of Object.entries(timberlineTextures)) {
    const material = gltf.materials.find(item => item.name === materialName);
    if (!material) throw new Error(`Missing Timberline material ${materialName}`);
    const textureKey = materialName === 'DZN_ROOF_TEX' ? 'metal' : 'pine';
    if (!views.has(textureKey)) {
      const padding = align4(binSize) - binSize;
      if (padding) { chunks.push(Buffer.alloc(padding)); binSize += padding; }
      const bufferView = gltf.bufferViews.push({ buffer: 0, byteOffset: binSize, byteLength: textureBytes.length }) - 1;
      chunks.push(textureBytes); binSize += textureBytes.length;
      const source = gltf.images.push({ bufferView, mimeType: 'image/jpeg', name: textureKey }) - 1;
      const index = gltf.textures.push({ sampler, source }) - 1;
      views.set(textureKey, index);
    }
    material.pbrMetallicRoughness.baseColorTexture = { index: views.get(textureKey) };
    material.pbrMetallicRoughness.baseColorFactor = materialName === 'DZN_LUMBER_TEX' ? [1, .82, .66, 1] : [1, 1, 1, 1];
  }
  gltf.buffers[0].byteLength = binSize;
  const jsonBytes = Buffer.from(JSON.stringify(gltf));
  const jsonPadded = Buffer.alloc(align4(jsonBytes.length), 0x20); jsonBytes.copy(jsonPadded);
  const binBytes = Buffer.alloc(align4(binSize)); Buffer.concat(chunks).copy(binBytes);
  const header = Buffer.alloc(12);
  header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binBytes.length, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonPadded.length, 0); jsonHeader.write('JSON', 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binBytes.length, 0); binHeader.write('BIN\0', 4);
  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binBytes]);
}
const manifest = {
  schemaVersion: 1,
  provenance: 'Original procedural district geometry authored for DZN Stronghold Wars; no paid provider or third-party game art.',
  license: 'Project-owned original', unit: 'metre', coordinateSystem: 'Y up', assets: {},
};
for (const [family, make] of Object.entries(makers)) for (let level = 1; level <= 5; level++) {
  const name = `${family === 'timberline' ? 'timberline_v4' : family}_l0${level}`;
  const scene = make(level); scene.name = name;
  const exported = Buffer.from(await exporter.parseAsync(scene, { binary: true, onlyVisible: true }));
  const bytes = family === 'timberline' ? embedTimberlineTextures(exported) : exported;
  await writeFile(path.join(root, `${name}.glb`), bytes);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  manifest.assets[name] = {
    file: `assets/models/facilities/${name}.glb`, sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length, dimensions: size.toArray().map(n => Number(n.toFixed(3))),
  };
}
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created ${Object.keys(manifest.assets).length} original district GLBs in ${root}`);
