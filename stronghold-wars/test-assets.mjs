import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILDING_ASSETS } from './preview/building-assets.js';
import { SQUAD_ROLES, squadAsset, squadPortrait, squadTier } from './preview/squad-assets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'preview');
const manifest = readFileSync(join(root, 'ASSET_SHA256.txt'), 'utf8').trim().split(/\r?\n/);
const recorded = new Map();
for (const line of manifest) {
  const match = /^([a-f0-9]{64}) (assets\/[\w./-]+)$/.exec(line);
  if (!match || recorded.has(match[2])) throw new Error(`Invalid or duplicate asset manifest entry: ${line}`);
  recorded.set(match[2], match[1]);
  const bytes = readFileSync(join(root, ...match[2].split('/')));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== match[1]) throw new Error(`Asset checksum mismatch: ${match[2]}`);
}

let pairs = 0;
for (const [key, definition] of Object.entries(BUILDING_ASSETS)) {
  if (definition.levels.length !== 5) throw new Error(`${key} does not have five levels`);
  for (const [index, level] of definition.levels.entries()) {
    for (const [format, signature] of [['glb', 'glTF'], ['png', '\x89PNG']]) {
      const path = level[format];
      if (!recorded.has(path)) throw new Error(`Unrecorded ${key} level ${index + 1} ${format}: ${path}`);
      const bytes = readFileSync(join(root, ...path.split('/')));
      if (bytes.toString('latin1', 0, 4) !== signature) throw new Error(`Invalid ${format} signature: ${path}`);
    }
    pairs += 1;
  }
}
if (pairs !== 20 || recorded.size !== 44) throw new Error(`Expected 20 building pairs and 44 assets, got ${pairs} and ${recorded.size}`);
const sceneryManifest = JSON.parse(readFileSync(join(root, 'assets/models/scenery/manifest.json'), 'utf8'));
const sceneryNames = Object.keys(sceneryManifest.assets);
if (sceneryNames.length !== 9 || ![1, 2, 3, 4, 5].every(level => sceneryNames.includes(`pine_l0${level}`))) throw new Error('Scenery kit must contain five tree stages and four clearing props.');
for (const [name, entry] of Object.entries(sceneryManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Missing GLB scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.nodes?.length || !gltf.scenes?.length) throw new Error(`Incomplete GLB scene: ${name}`);
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Scenery integrity mismatch: ${name}`);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(dimension => !Number.isFinite(dimension) || dimension <= 0)) throw new Error(`Invalid model bounds: ${name}`);
}
console.log(`Stronghold preview assets verified: ${pairs} building level pairs, ${recorded.size} original checksums, ${sceneryNames.length} original scenery GLBs.`);
const facilityManifest = JSON.parse(readFileSync(join(root, 'assets/models/facilities/manifest.json'), 'utf8'));
const families = ['timberline', 'ridgewatch', 'signal', 'highland'];
const facilityNames = Object.keys(facilityManifest.assets);
if (facilityNames.length !== 20 || !families.every(family => [1, 2, 3, 4, 5].every(level => facilityNames.includes(`${family}_l0${level}`)))) throw new Error('Facility kit must contain four distinct five-level families.');
for (const [name, entry] of Object.entries(facilityManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid facility GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Missing facility scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.nodes?.length || !gltf.scenes?.length) throw new Error(`Incomplete facility GLB scene: ${name}`);
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Facility integrity mismatch: ${name}`);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(dimension => !Number.isFinite(dimension) || dimension <= 0)) throw new Error(`Invalid facility model bounds: ${name}`);
}
console.log(`Additional district facilities verified: ${facilityNames.length} original GLBs across four five-level families.`);
const routeManifest = JSON.parse(readFileSync(join(root, 'assets/models/routes/manifest.json'), 'utf8'));
const routeNames = Object.keys(routeManifest.assets);
if (routeNames.length !== 5 || ![1, 2, 3, 4, 5].every(level => routeNames.includes(`supply_route_l0${level}`))) throw new Error('Supply route kit must contain five distinct visual tiers.');
const routeHashes = new Set();
for (const [name, entry] of Object.entries(routeManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid route GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Missing route scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.nodes?.length || !gltf.scenes?.length) throw new Error(`Incomplete route GLB scene: ${name}`);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== entry.bytes || actual !== entry.sha256 || routeHashes.has(actual)) throw new Error(`Route integrity or visual-tier mismatch: ${name}`);
  routeHashes.add(actual);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(dimension => !Number.isFinite(dimension) || dimension <= 0)) throw new Error(`Invalid route model bounds: ${name}`);
}
console.log(`DZN supply routes verified: ${routeNames.length} original levelled GLBs.`);
const chronicleManifest = JSON.parse(readFileSync(join(root, 'assets/models/chronicle/manifest.json'), 'utf8'));
const chronicleNames = Object.keys(chronicleManifest.assets);
if (chronicleNames.length !== 5 || ![1, 2, 3, 4, 5].every(level => chronicleNames.includes(`chronicle_beacon_l0${level}`))) throw new Error('Chronicle Beacon kit must contain five visual stages.');
const chronicleHashes = new Set();
for (const [name, entry] of Object.entries(chronicleManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid Chronicle GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Missing Chronicle scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.nodes?.length || !gltf.scenes?.length) throw new Error(`Incomplete Chronicle GLB scene: ${name}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== entry.bytes || hash !== entry.sha256 || chronicleHashes.has(hash)) throw new Error(`Chronicle integrity or visual-tier mismatch: ${name}`);
  chronicleHashes.add(hash);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(dimension => !Number.isFinite(dimension) || dimension <= 0)) throw new Error(`Invalid Chronicle model bounds: ${name}`);
}
console.log(`DZN Chronicle Beacon verified: ${chronicleNames.length} original levelled GLBs.`);
const worldManifest = JSON.parse(readFileSync(join(root, 'assets/world/manifest.json'), 'utf8'));
const worldBytes = readFileSync(join(root, ...worldManifest.asset.split('/')));
if (worldBytes.toString('latin1', 0, 4) !== '\x89PNG' || worldBytes.readUInt32BE(16) !== worldManifest.dimensions[0] || worldBytes.readUInt32BE(20) !== worldManifest.dimensions[1]) throw new Error('Invalid Stronghold world texture size or PNG signature.');
if (createHash('sha256').update(worldBytes).digest('hex') !== worldManifest.sha256) throw new Error('Stronghold world texture checksum mismatch.');
console.log(`DZN world map verified: ${worldManifest.dimensions.join('x')} original texture.`);
const squadManifest = JSON.parse(readFileSync(join(root, 'assets/models/squads/manifest.json'), 'utf8'));
const squadNames = Object.keys(squadManifest.assets);
if (squadNames.length !== 15 || Object.keys(SQUAD_ROLES).some(role => [1, 2, 3, 4, 5].some(level => !squadNames.includes(`${role}_l0${level}`)))) throw new Error('DZN squad kit must contain three roles at five levels each.');
if (squadTier('assault', { hq: 3, tower: 5 }) !== 3 || squadTier('recon', { hq: 5, comms: 2 }) !== 2 || squadTier('engineer', { hq: 4, workshop: 3 }) !== 3) throw new Error('Squad gear must follow the specialist and Hall visual cap.');
const squadHashes = new Set();
for (const [name, entry] of Object.entries(squadManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (entry.file !== squadAsset(name.split('_')[0], Number(name.slice(-1))) || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid squad GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Invalid squad scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const nodeNames = new Set((gltf.nodes || []).map(node => node.name));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.scenes?.length || !['left_arm', 'right_arm', 'left_leg', 'right_leg'].every(limb => nodeNames.has(limb))) throw new Error(`Incomplete animatable soldier: ${name}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== entry.sha256 || entry.bytes !== bytes.length || squadHashes.has(hash) || entry.meshes < 20) throw new Error(`Squad integrity or tier distinction failed: ${name}`);
  squadHashes.add(hash);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(d => !Number.isFinite(d) || d <= 0)) throw new Error(`Invalid squad bounds: ${name}`);
}
console.log(`DZN squad kit verified: ${squadNames.length} original, distinct and animatable GLBs.`);
const portraitManifest = JSON.parse(readFileSync(join(root, 'assets/portraits/squads/manifest.json'), 'utf8'));
const portraits = Object.entries(portraitManifest.assets);
if (portraits.length !== 15) throw new Error('DZN squad kit requires a close-up portrait for every GLB.');
const portraitHashes = new Set();
for (const [name, entry] of portraits) {
  if (!squadManifest.assets[name] || entry.file !== squadPortrait(name.split('_')[0], Number(name.slice(-1)))) throw new Error(`Squad portrait does not match a model: ${name}`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.toString('latin1', 0, 4) !== '\x89PNG' || bytes.readUInt32BE(16) !== 400 || bytes.readUInt32BE(20) !== 400 || hash !== entry.sha256 || bytes.length !== entry.bytes || portraitHashes.has(hash)) throw new Error(`Invalid squad portrait: ${name}`);
  portraitHashes.add(hash);
}
console.log(`DZN squad portraits verified: ${portraits.length} distinct 400x400 PNGs rendered from the GLBs.`);
