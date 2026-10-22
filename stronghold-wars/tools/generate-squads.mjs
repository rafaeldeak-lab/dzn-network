// Original, reproducible DZN Stronghold soldier kit. No paid generator or external art.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.FileReader) {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); }); }
  };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../preview/assets/models/squads-v2');
await mkdir(root, { recursive: true });
const exporter = new GLTFExporter();
const mat = (color, metalness = 0, emissive = 0) => new THREE.MeshStandardMaterial({
  color, metalness, roughness: metalness ? 0.42 : 0.83,
  emissive: emissive ? color : 0x000000, emissiveIntensity: emissive,
});
const M = {
  fabric: mat(0x171b20), shadow: mat(0x090d12), armour: mat(0x343b45, 0.38), steel: mat(0x69747b, 0.7),
  visor: mat(0x7dff38, 0.18, 0.6), purple: mat(0x633489, 0.46), amber: mat(0xed9c26, 0.24, 0.18),
  skin: mat(0x161c22), pouch: mat(0x23272c), recon: mat(0x191a22), engineer: mat(0x212024),
  tactical: mat(0x101318), carbon: mat(0x252a32, 0.55), obsidian: mat(0x0e1219, 0.45), lime: mat(0xa5ff32, 0.2, 0.85),
  medical: mat(0xe4eee7, 0.1), medicCloth: mat(0x172023),
};
function mesh(group, geometry, material, name, x = 0, y = 0, z = 0) {
  const item = new THREE.Mesh(geometry, material); item.name = name; item.position.set(x, y, z); group.add(item); return item;
}
function box(g, w, h, d, m, name, x = 0, y = 0, z = 0) {
  const radius = Math.max(0.004, Math.min(w, h, d) * 0.18);
  return mesh(g, new RoundedBoxGeometry(w, h, d, 3, radius), m, name, x, y, z);
}
function cyl(g, top, bottom, h, m, name, x = 0, y = 0, z = 0, sides = 8) { return mesh(g, new THREE.CylinderGeometry(top, bottom, h, sides), m, name, x, y, z); }
function orb(g, radius, m, name, x = 0, y = 0, z = 0) {
  return mesh(g, new THREE.SphereGeometry(radius, 16, 12), m, name, x, y, z);
}
function beam(g, from, to, radius, m, name) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
  const item = cyl(g, radius, radius, delta.length(), m, name, ...a.clone().add(b).multiplyScalar(0.5).toArray(), 6);
  item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return item;
}

export function soldier(role, tier) {
  const g = new THREE.Group(); g.name = `${role}_l0${tier}`;
  const cloth = role === 'recon' ? M.recon : role === 'engineer' ? M.engineer : role === 'sentinel' ? M.tactical : role === 'medic' ? M.medicCloth : M.fabric;
  const glow = role === 'assault' ? M.amber : role === 'recon' ? M.purple : role === 'sentinel' ? M.lime : M.visor;
  // Feet start on the world plane. Forward is +Z; the runtime animates the named limb pivots.
  box(g, 0.43, 0.58, 0.28, cloth, 'body', 0, 1.07, 0);
  box(g, 0.5, 0.12, 0.3, M.shadow, 'belt', 0, 0.78, 0);
  box(g, 0.52, 0.41, 0.16, M.carbon, 'segmented_vest', 0, 1.15, 0.16);
  box(g, 0.35, 0.095, 0.035, glow, 'dzn_chest_flash', 0, 1.2, 0.253);
  orb(g, 0.21 + tier * 0.004, M.carbon, 'rounded_helmet', 0, 1.66, 0);
  box(g, 0.37, 0.19, 0.16, M.obsidian, 'enclosed_mask', 0, 1.53, 0.13);
  box(g, 0.4, 0.07, 0.13, M.armour, 'helmet_brow', 0, 1.67, 0.16);
  for (const side of [-1, 1]) {
    orb(g, 0.074, M.visor, side < 0 ? 'left_optic' : 'right_optic', side * 0.105, 1.61, 0.227);
    cyl(g, 0.045, 0.045, 0.04, M.steel, 'mask_filter', side * 0.11, 1.49, 0.224, 12);
    orb(g, 0.068, M.steel, 'helmet_comm', side * 0.215, 1.64, 0);
  }
  box(g, 0.16, 0.09, 0.07, M.steel, 'respirator', 0, 1.51, 0.25);
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.name = side < 0 ? 'left_arm' : 'right_arm'; arm.position.set(side * 0.32, 1.34, 0); g.add(arm);
    box(arm, 0.22, 0.48, 0.22, cloth, 'sleeve', 0, -0.23, 0);
    orb(arm, 0.135, M.armour, 'shoulder_joint', 0, -0.04, 0);
    box(arm, 0.2, 0.12, 0.22, M.shadow, 'glove', 0, -0.51, 0);
    box(arm, 0.24, 0.19, 0.25, M.carbon, 'forearm_plate', 0, -0.34, 0.025);
    const leg = new THREE.Group(); leg.name = side < 0 ? 'left_leg' : 'right_leg'; leg.position.set(side * 0.13, 0.77, 0); g.add(leg);
    box(leg, 0.22, 0.57, 0.25, cloth, 'trouser', 0, -0.29, 0);
    box(leg, 0.24, 0.21, 0.33, M.shadow, 'boot', 0, -0.65, 0.05);
    box(leg, 0.25, 0.2, 0.3, M.carbon, 'shaped_knee_guard', 0, -0.43, 0.06);
    box(leg, 0.23, 0.16, 0.28, tier >= 4 ? M.purple : M.armour, 'shin_plate', 0, -0.56, 0.035);
    if (tier >= 2) box(arm, 0.23, 0.18, 0.24, M.armour, 'shoulder_plate', 0, -0.08, 0);
    if (tier >= 3) box(leg, 0.23, 0.22, 0.28, M.armour, 'knee_plate', 0, -0.49, 0.035);
    if (tier >= 4) box(arm, 0.22, 0.16, 0.25, glow, 'rank_stripe', 0, -0.23, 0);
  }
  box(g, 0.36 + tier * 0.035, 0.45 + tier * 0.035, 0.23, M.pouch, 'field_pack', 0, 1.11, -0.26);
  for (const side of [-1, 1]) {
    box(g, 0.08, 0.52, 0.075, M.steel, 'pack_harness', side * 0.23, 1.15, 0.05);
    box(g, 0.14, 0.08, 0.035, tier >= 4 ? M.purple : M.lime, 'shoulder_light', side * 0.33, 1.31, 0.15);
  }
  for (let i = 0; i < Math.min(4, tier); i++) box(g, 0.1, 0.13, 0.09, M.pouch, `utility_pouch_${i}`, -0.2 + i * 0.13, 0.8, 0.12);

  if (role === 'assault') {
    // DZN Warden: progressively armoured direct-push unit, with a stylised carbine and shield.
    box(g, 0.22, 0.31 + tier * 0.025, 0.08, M.armour, 'front_plate', 0, 1.06, 0.23);
    beam(g, [0.38, 1.0, 0.22], [0.38, 1.0, 0.78], 0.045, M.steel, 'carbine_barrel');
    box(g, 0.13, 0.14, 0.31, M.shadow, 'carbine_body', 0.38, 0.98, 0.34);
    box(g, 0.08, 0.08, 0.12, glow, 'carbine_sight', 0.38, 1.1, 0.37);
    if (tier >= 3) box(g, 0.09, 0.37, 0.11, M.steel, 'spare_magazine', 0.24, 1.08, -0.23);
    if (tier >= 4) box(g, 0.42, 0.57, 0.08, M.armour, 'forearm_shield', -0.44, 1.0, 0.2);
    if (tier === 5) box(g, 0.36, 0.07, 0.09, M.visor, 'shield_light', -0.44, 1.15, 0.25);
  } else if (role === 'recon') {
    // DZN Ghost: hood, sensor visor, map satchel, tiered signal mast.
    box(g, 0.49, 0.22, 0.36, cloth, 'hood', 0, 1.75, -0.05);
    box(g, 0.35, 0.08, 0.06, M.purple, 'optic_band', 0, 1.62, 0.2);
    box(g, 0.33, 0.3, 0.16, M.pouch, 'map_satchel', -0.33, 0.98, -0.11);
    beam(g, [0.19, 1.22, -0.31], [0.19, 1.78 + tier * 0.13, -0.31], 0.018, M.steel, 'signal_mast');
    cyl(g, 0.045, 0.045, 0.08, glow, 'signal_tip', 0.19, 1.82 + tier * 0.13, -0.31);
    box(g, 0.18 + tier * 0.035, 0.1, 0.1, M.shadow, 'scanner', 0.36, 0.99, 0.33);
    box(g, 0.08, 0.06, 0.08, glow, 'scanner_screen', 0.36, 1.05, 0.38);
    if (tier >= 4) for (const side of [-1, 1]) box(g, 0.12, 0.09, 0.15, M.purple, 'optic_wing', side * 0.24, 1.63, 0.16);
  } else if (role === 'sentinel') {
    // Black tactical silhouette and green optics from the supplied progression reference.
    // Geometry and colourway are original, with heavier plates and purple rank details.
    box(g, 0.37, 0.23, 0.11, M.obsidian, 'full_face_mask', 0, 1.54, 0.17);
    box(g, 0.34, 0.07, 0.035, M.lime, 'night_optics', 0, 1.64, 0.24);
    box(g, 0.55 + tier * 0.025, 0.39 + tier * 0.015, 0.14, M.carbon, 'tactical_chest_plate', 0, 1.12, 0.23);
    box(g, 0.27, 0.055, 0.025, tier >= 4 ? M.purple : M.lime, 'chest_insignia', 0, 1.2, 0.31);
    for (const side of [-1, 1]) {
      const arm = g.getObjectByName(side < 0 ? 'left_arm' : 'right_arm');
      if (tier >= 2) box(arm, 0.29 + tier * 0.015, 0.23, 0.29, M.carbon, 'broad_shoulder_guard', 0, -0.09, 0.025);
      if (tier >= 3) box(arm, 0.23, 0.19, 0.26, M.obsidian, 'forearm_guard', 0, -0.36, 0.025);
      if (tier >= 4) box(arm, 0.27, 0.065, 0.29, M.purple, 'purple_rank_trim', 0, -0.08, 0.04);
    }
    box(g, 0.17, 0.19, 0.42 + tier * 0.04, M.obsidian, 'heavy_carbine', 0.38, 1.01, 0.34);
    beam(g, [0.38, 1.07, 0.52], [0.38, 1.07, 0.87 + tier * 0.035], 0.052, M.steel, 'heavy_barrel');
    box(g, 0.1, 0.08, 0.13, M.lime, 'reflex_sight', 0.38, 1.15, 0.38);
    if (tier >= 3) box(g, 0.13, 0.24, 0.1, M.obsidian, 'drum_magazine', 0.38, 0.85, 0.37);
    if (tier === 5) {
      box(g, 0.41, 0.17, 0.13, M.purple, 'elite_back_plate', 0, 1.28, -0.35);
      box(g, 0.42, 0.055, 0.1, M.lime, 'elite_brow_light', 0, 1.76, 0.08);
    }
  } else if (role === 'medic') {
    // Field healer with a visible medical pack, injector and progressively tougher protection.
    box(g, 0.44, 0.48, 0.24, M.medical, 'medical_pack', 0, 1.13, -0.34);
    box(g, 0.09, 0.33, 0.025, M.lime, 'aid_cross_vertical', 0, 1.15, -0.475);
    box(g, 0.28, 0.09, 0.025, M.lime, 'aid_cross_horizontal', 0, 1.15, -0.48);
    box(g, 0.33, 0.11, 0.17, M.medical, 'protective_hood', 0, 1.76, 0.01);
    box(g, 0.12, 0.31, 0.12, M.steel, 'aid_injector', 0.38, 1.0, 0.3);
    box(g, 0.09, 0.07, 0.07, M.lime, 'injector_charge', 0.38, 1.19, 0.3);
    if (tier >= 2) box(g, 0.48, 0.28, 0.1, M.medical, 'reinforced_vest', 0, 1.12, 0.22);
    if (tier >= 3) box(g, 0.19, 0.22, 0.11, M.medical, 'triage_satchel', -0.31, 0.93, -0.1);
    if (tier >= 4) box(g, 0.39, 0.08, 0.07, M.purple, 'field_medical_rank', 0, 1.31, 0.28);
    if (tier === 5) {
      cyl(g, 0.09, 0.09, 0.22, M.lime, 'elite_aid_beacon', 0, 1.57, -0.36);
      box(g, 0.32, 0.06, 0.05, M.purple, 'elite_visor_trim', 0, 1.62, 0.2);
    }
  } else {
    // DZN Fixer: construction/repair specialist, tool harness, timber axe and field repair kit.
    box(g, 0.5, 0.09, 0.39, M.amber, 'safety_helmet_band', 0, 1.75, 0);
    box(g, 0.07, 0.25, 0.07, M.steel, 'helmet_lamp_stem', 0, 1.82, 0.14);
    box(g, 0.13, 0.1, 0.11, glow, 'helmet_lamp', 0, 1.83, 0.23);
    box(g, 0.11, 0.26, 0.1, M.pouch, 'tool_roll', -0.28, 0.9, -0.24);
    beam(g, [0.42, 0.48, 0.3], [0.42, 1.32, 0.3], 0.035, M.pouch, 'axe_handle');
    box(g, 0.3, 0.19, 0.07, M.steel, 'axe_head', 0.42, 1.25, 0.3);
    if (tier >= 2) box(g, 0.16 + tier * 0.025, 0.28, 0.19, M.steel, 'repair_canister', 0.32, 1.04, -0.27);
    if (tier >= 4) box(g, 0.23, 0.29, 0.08, M.armour, 'welding_guard', -0.32, 1.08, 0.24);
  }
  for (let i = 0; i < tier; i++) box(g, 0.055, 0.075, 0.018, glow, `tier_mark_${i}`, -0.12 + i * 0.06, 1.72, 0.21);
  return g;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const manifest = {
  schemaVersion: 1,
  provenance: 'Original procedural 3D geometry and animation pivots styled after the owner-supplied DZN character sheets; no paid provider.',
  license: 'Project-owned original',
  unit: 'metre', coordinateSystem: 'Y up; forward +Z',
  roles: {
    assault: 'DZN Warden: direct-push carbine, armour and shield',
    recon: 'DZN Ghost: scout optics, scanner and signal mast',
    engineer: 'DZN Fixer: timber axe, construction and repair kit',
    sentinel: 'DZN Sentinel: black tactical armour, green optics and heavy carbine',
    medic: 'DZN Lifeline: field medical pack, injector and squad support',
  },
  assets: {},
};
for (const role of Object.keys(manifest.roles)) for (let tier = 1; tier <= 5; tier++) {
  const name = `${role}_l0${tier}`;
  const scene = soldier(role, tier);
  const bytes = Buffer.from(await exporter.parseAsync(scene, { binary: true, onlyVisible: true }));
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  await writeFile(path.join(root, `${name}.glb`), bytes);
  manifest.assets[name] = {
    file: `assets/models/squads-v2/${name}.glb`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    dimensions: size.toArray().map(value => Number(value.toFixed(3))),
    meshes: scene.getObjectsByProperty('isMesh', true).length,
  };
}
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created ${Object.keys(manifest.assets).length} original DZN squad GLBs in ${root}`);
}
