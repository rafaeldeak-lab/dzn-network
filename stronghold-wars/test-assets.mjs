import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILDING_ASSETS } from './preview/building-assets.js';
import { SQUAD_ROLES, squadAsset, squadPortrait, squadTier, squadUnlocked, squadProfile, squadBattleStats } from './preview/squad-assets.js';
import { PATROL_NODES, PATROL_STOPS, DEFENDER_POST_NODES, createPatrolMotion, createDefenderMotion, shortestPatrolPath, stepPatrolMotion, patrolNodesForLayout, walkablePatrolPath } from './preview/patrol-routes.js';
import { defaultLayout } from './preview/layout-grid.js';
import { DEFENDER_CONCEPTS, defenderAsset, defenderPortrait } from './preview/defender-assets.js';
import { connectedProMatches, greatCircleKm, routeBriefing } from './preview/world-map.js';
import { FIRST_EDITION_CARDS, cardEarned } from './preview/collectible-cards.js';
import { OPERATIVE_MODELS, operativeAsset } from './preview/operative-assets.js';

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
const arcBatteryModels = [...recorded.keys()].filter(path => path.startsWith('assets/models/defense-towers/') && path.endsWith('.glb'));
if (pairs !== 20 || recorded.size !== 49 || arcBatteryModels.length !== 5 || !BUILDING_ASSETS.tower.levels.every(level => arcBatteryModels.includes(level.glb))) throw new Error(`Expected 20 building pairs, five mapped Arc Battery stages and 49 checksums; got ${pairs}, ${arcBatteryModels.length} and ${recorded.size}`);
const sceneryManifest = JSON.parse(readFileSync(join(root, 'assets/models/scenery/manifest.json'), 'utf8'));
const sceneryNames = Object.keys(sceneryManifest.assets);
if (sceneryNames.length !== 14 || ![1, 2, 3, 4, 5].every(level => sceneryNames.includes(`pine_l0${level}`)) || !['fallen_trunk', 'fern_patch', 'mossy_rock_cluster', 'brush_pile', 'lumber_pallet'].every(name => sceneryNames.includes(name))) throw new Error('Scenery kit must contain five tree stages, four clearing props and five forest details.');
for (const [name, entry] of Object.entries(sceneryManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Missing GLB scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.nodes?.length || !gltf.scenes?.length) throw new Error(`Incomplete GLB scene: ${name}`);
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Scenery integrity mismatch: ${name}`);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(dimension => !Number.isFinite(dimension) || dimension <= 0)) throw new Error(`Invalid model bounds: ${name}`);
  if (/^(pine_l0[1-5]|granite_boulder|claim_marker)$/.test(name)) {
    const rosebudVariant = readFileSync(join(root, 'assets/models/scenery', `${name}${name.startsWith('pine_') ? '-3' : '-2'}.glb`));
    if (!rosebudVariant.equals(bytes)) throw new Error(`Rosebud scenery variant differs from review asset: ${name}`);
  }
}
console.log(`Stronghold preview assets verified: ${pairs} building level pairs, ${recorded.size} original checksums, ${sceneryNames.length} original scenery GLBs.`);
const campManifest = JSON.parse(readFileSync(join(root, 'assets/models/camps/manifest.json'), 'utf8'));
const campEntry = campManifest.assets?.squad_bivouac;
if (!campEntry || !/^assets\/models\/camps\/[\w-]+\.glb$/.test(campEntry.file)) throw new Error('DZN squad camp asset mapping is missing.');
const campBytes = readFileSync(join(root, ...campEntry.file.split('/')));
if (campBytes.toString('ascii', 0, 4) !== 'glTF' || campBytes.readUInt32LE(4) !== 2 || campBytes.readUInt32LE(8) !== campBytes.length || campBytes.length !== campEntry.bytes || createHash('sha256').update(campBytes).digest('hex') !== campEntry.sha256) throw new Error('DZN squad camp GLB integrity failed.');
const campJsonLength = campBytes.readUInt32LE(12);
const campGltf = JSON.parse(campBytes.toString('utf8', 20, 20 + campJsonLength));
if (!campGltf.meshes?.length || !campGltf.materials?.length || !campGltf.textures?.length || !campGltf.images?.length || !campGltf.scenes?.length || !Array.isArray(campEntry.dimensions) || campEntry.dimensions.some(dimension => dimension <= 0)) throw new Error('DZN squad camp has incomplete geometry or textures.');
console.log('Textured DZN squad bivouac GLB verified.');
const facilityManifest = JSON.parse(readFileSync(join(root, 'assets/models/facilities/manifest.json'), 'utf8'));
const families = ['timberline_v4', 'ridgewatch', 'signal', 'highland'];
const facilityNames = Object.keys(facilityManifest.assets);
if (facilityNames.length !== 20 || !families.every(family => [1, 2, 3, 4, 5].every(level => facilityNames.includes(`${family}_l0${level}`)))) throw new Error('Facility kit must contain four distinct five-level families.');
for (const [name, entry] of Object.entries(facilityManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid facility GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Missing facility scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.nodes?.length || !gltf.scenes?.length) throw new Error(`Incomplete facility GLB scene: ${name}`);
  if (name.startsWith('timberline_v4_')) {
    const level = Number(name.slice(-1));
    const nodes = new Set(gltf.nodes.map(node => node.name));
    const required = ['stone_yard_base', 'roof_spine', 'saw_carriage', 'saw_rotor', 'circular_saw_blade', 'saw_safety_light',
      'conveyor_roller_0', 'conveyor_roller_10', 'conveyor_roller_20', 'conveyor_roller_30',
      ...(level >= 2 ? ['hydraulic_sorter'] : []), ...(level >= 3 ? ['loading_crane_hook'] : []),
      ...(level >= 4 ? ['auto_feed_motor'] : []), ...(level >= 5 ? ['elite_yard_beacon'] : [])];
    if (required.some(part => !nodes.has(part))) throw new Error(`Incomplete Timberline Level ${level} machinery.`);
    if ((gltf.images?.length || 0) < 2 || (gltf.textures?.length || 0) < 2) throw new Error(`Timberline Level ${level} is missing embedded textures.`);
    if (!nodes.has('yard_safety_lamp')) throw new Error(`Timberline Level ${level} is missing its detailed working bay.`);
  }
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Facility integrity mismatch: ${name}`);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(dimension => !Number.isFinite(dimension) || dimension <= 0)) throw new Error(`Invalid facility model bounds: ${name}`);
}
console.log(`Additional district facilities verified: ${facilityNames.length} original GLBs across four five-level families.`);
const wallManifest = JSON.parse(readFileSync(join(root, 'assets/models/walls/manifest.json'), 'utf8'));
if (Object.keys(wallManifest.assets).length !== 5) throw new Error('Five wall stages are required.');
const wallHashes = new Set();
for (let level = 1; level <= 5; level++) {
  const name = `wall_l0${level}`, entry = wallManifest.assets[name];
  if (!entry) throw new Error(`Wall Level ${level} is missing.`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length || bytes.length !== entry.bytes || hash !== entry.sha256 || wallHashes.has(hash)) throw new Error(`Wall Level ${level} integrity failed.`);
  wallHashes.add(hash);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const nodes = new Set(gltf.nodes.map(node => node.name));
  if (!nodes.has(level <= 2 ? 'reclaimed_timber' : 'armoured_barrier') || (level === 5 && !nodes.has('active_defence_node'))) throw new Error(`Wall Level ${level} geometry is incomplete.`);
}
console.log('Five distinct DZN perimeter wall GLBs verified.');
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
if (greatCircleKm([47, 29], [47, 29]) !== 0 || greatCircleKm([23, 32], [47, 29]) !== greatCircleKm([47, 29], [23, 32])) throw new Error('World route geometry must be zero at origin and symmetric.');
const demoWorld = [
  { name: 'Iron Pines', accessTier: 'owner Pro active', map: [47, 29], hallLevel: 2, defenders: {} },
  { name: 'Violet Ridge', accessTier: 'owner Pro active', map: [23, 32], hallLevel: 4, defenders: { guardian: { level: 1, post: 'gate' } } },
  { name: 'Mossback Free', accessTier: 'view only', map: [82, 38], hallLevel: 1, defenders: {} },
];
const route = routeBriefing(demoWorld[0], demoWorld[1]);
if (route.distanceKm < 1000 || route.travelHours <= 1.5 || route.risk < 2 || route.rewardMultiplier <= 1 || connectedProMatches(demoWorld, 'IRON').length !== 1 || connectedProMatches(demoWorld).length !== 2) throw new Error('World search or route briefing regressed.');
const cardManifest = JSON.parse(readFileSync(join(root, 'assets/cards/manifest.json'), 'utf8'));
if (FIRST_EDITION_CARDS.length !== 3 || Object.keys(cardManifest.assets).length !== 3) throw new Error('First Edition card series is incomplete.');
for (const card of FIRST_EDITION_CARDS) {
  const entry = cardManifest.assets[card.id];
  if (!entry || entry.file !== card.image) throw new Error(`Missing First Edition card ${card.id}.`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('latin1', 0, 4) !== '\x89PNG' || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`First Edition art integrity mismatch: ${card.id}`);
}
if (!cardEarned('fixer', { landPlots: [{ id: 'timberline-depot', facilityLevel: 2 }] }) || cardEarned('guardian', { defenders: { guardian: { level: 1, post: '' } } }) || !cardEarned('ghost', { levels: { comms: 3 } })) throw new Error('Card milestones must follow base progress.');
console.log('World route/search preview and three First Edition card assets verified.');
const squadManifest = JSON.parse(readFileSync(join(root, 'assets/models/squads-v5/manifest.json'), 'utf8'));
const squadNames = Object.keys(squadManifest.assets);
if (squadNames.length !== 25 || Object.keys(SQUAD_ROLES).some(role => [1, 2, 3, 4, 5].some(level => !squadNames.includes(`${role}_l0${level}`)))) throw new Error('DZN squad kit must contain five roles at five levels each.');
if (squadTier('assault', { hq: 3, tower: 5 }) !== 3 || squadTier('recon', { hq: 5, comms: 2 }) !== 2 || squadTier('engineer', { hq: 4, workshop: 3 }) !== 3) throw new Error('Squad gear must follow the specialist and Hall visual cap.');
if (squadUnlocked('sentinel', { hq: 3, tower: 5 }) || squadUnlocked('medic', { hq: 4, workshop: 2 }) || !squadUnlocked('sentinel', { hq: 4, tower: 3 }) || !squadUnlocked('medic', { hq: 4, workshop: 3 })) throw new Error('Specialist units must follow Hall and building unlock gates.');
if (squadProfile('sentinel', { hq: 5, tower: 5 }).maxHealth <= squadProfile('sentinel', { hq: 4, tower: 3 }).maxHealth || squadBattleStats({ hq: 4, tower: 3, workshop: 3 }, 'assault').scoreBonus <= squadBattleStats({ hq: 3, tower: 2, workshop: 2 }, 'assault').scoreBonus || squadBattleStats({ hq: 4, tower: 3, workshop: 3 }, 'assault').casualtyShield <= 0) throw new Error('Upgraded weapons, armour and support must affect local combat.');
const squadHashes = new Set();
const heldSquadParts = {
  assault: ['carbine_barrel', 'carbine_body', 'carbine_sight'],
  recon: ['scanner', 'scanner_screen'], engineer: ['axe_handle', 'axe_head'],
  sentinel: ['heavy_carbine', 'heavy_barrel', 'reflex_sight'],
  medic: ['aid_injector', 'injector_charge'],
};
for (const [name, entry] of Object.entries(squadManifest.assets)) {
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (entry.file !== `assets/models/squads-v5/${name}.glb` || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid squad GLB container: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength < 50 || jsonLength > bytes.length - 20) throw new Error(`Invalid squad scene JSON: ${name}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const nodeNames = new Set((gltf.nodes || []).map(node => node.name));
  if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.scenes?.length || !['left_arm', 'right_arm', 'left_leg', 'right_leg'].every(limb => nodeNames.has(limb))) throw new Error(`Incomplete animatable soldier: ${name}`);
  if (heldSquadParts[name.split('_')[0]].some(part => !nodeNames.has(part))) throw new Error(`Missing animated held equipment: ${name}`);
  if (name.startsWith('assault_') && Number(name.slice(-1)) >= 4 && !nodeNames.has('forearm_shield')) throw new Error(`Missing upgraded Warden shield: ${name}`);
  if (name.startsWith('sentinel_') && Number(name.slice(-1)) >= 3 && !nodeNames.has('drum_magazine')) throw new Error(`Missing upgraded Sentinel drum: ${name}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== entry.sha256 || entry.bytes !== bytes.length || squadHashes.has(hash) || entry.meshes < 20) throw new Error(`Squad integrity or tier distinction failed: ${name}`);
  squadHashes.add(hash);
  if (!Array.isArray(entry.dimensions) || entry.dimensions.some(d => !Number.isFinite(d) || d <= 0)) throw new Error(`Invalid squad bounds: ${name}`);
}
console.log(`DZN squad kit verified: ${squadNames.length} original, distinct and animatable GLBs.`);
const wardenManifest = JSON.parse(readFileSync(join(root, 'assets/models/squads-v6/manifest.json'), 'utf8'));
if (Object.keys(wardenManifest.assets).length !== 5) throw new Error('Rosebud Warden upgrade set must have five levels.');
const wardenHashes = new Set();
for (let level = 1; level <= 5; level++) {
  const name = `assault_l0${level}`;
  const entry = wardenManifest.assets[name];
  if (!entry || entry.file !== squadAsset('assault', level)) throw new Error(`Warden Level ${level} asset mapping is missing.`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Warden Level ${level} GLB is invalid.`);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== entry.sha256 || bytes.length !== entry.bytes || wardenHashes.has(hash)) throw new Error(`Warden Level ${level} integrity or distinction failed.`);
  wardenHashes.add(hash);
  if (!gltf.skins?.length || !gltf.animations?.some(clip => clip.name === 'DZN_Warden_Walk') || !gltf.meshes?.length || !gltf.images?.length) throw new Error(`Warden Level ${level} is missing a skin, walk clip, mesh or texture.`);
  if (!(gltf.animations.find(clip => clip.name === 'DZN_Warden_Walk')?.channels?.length > 0)) throw new Error(`Warden Level ${level} has an empty walk clip.`);
}
const carbine = wardenManifest.equipment?.warden_carbine;
if (carbine?.file !== 'assets/models/squads-v6/warden_carbine.glb') throw new Error('Rosebud Warden carbine mapping is missing.');
const carbineBytes = readFileSync(join(root, ...carbine.file.split('/')));
if (carbineBytes.toString('ascii', 0, 4) !== 'glTF' || carbineBytes.readUInt32LE(8) !== carbineBytes.length
  || createHash('sha256').update(carbineBytes).digest('hex') !== carbine.sha256) throw new Error('Warden carbine integrity failed.');
const carbineGltf = JSON.parse(carbineBytes.toString('utf8', 20, 20 + carbineBytes.readUInt32LE(12)));
if (!carbineGltf.meshes?.length || !carbineGltf.images?.length) throw new Error('Warden carbine lacks a 3D mesh or texture.');
console.log('Five distinct, textured and skinned Rosebud Warden levels and a textured 3D carbine verified.');
const operativeManifest = JSON.parse(readFileSync(join(root, 'assets/models/operatives/manifest.json'), 'utf8'));
const operativeHashes = new Set();
if (Object.keys(operativeManifest.assets).length !== 3 || operativeAsset('unknown') !== null) throw new Error('Expected exactly three named DZN commander models.');
for (const [id, entry] of Object.entries(operativeManifest.assets)) {
  if (OPERATIVE_MODELS[id] !== entry.file) throw new Error(`Operative mapping mismatch: ${id}`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length || bytes.length !== entry.bytes || hash !== entry.sha256 || operativeHashes.has(hash)) throw new Error(`Operative mesh integrity or distinction failed: ${id}`);
  operativeHashes.add(hash);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const walk = gltf.animations?.find(clip => clip.name === 'DZN_Operative_Walk');
  const idle = gltf.animations?.find(clip => clip.name === 'DZN_Operative_Idle');
  if (!gltf.meshes?.length || !gltf.skins?.length || gltf.skins[0].joints?.length < 15 || !gltf.images?.length || !gltf.materials?.length || !walk?.channels?.length || !idle?.channels?.length) throw new Error(`Operative ${id} lacks textured, skinned walk/idle geometry.`);
}
console.log('Three distinct Rosebud DZN commanders verified with embedded textures and skinned walk/idle clips.');
const occupied = [
  [0, 0, BUILDING_ASSETS.hq.footprint], [-9, 4, BUILDING_ASSETS.workshop.footprint],
  [8, 6, BUILDING_ASSETS.tower.footprint], [6, -8, BUILDING_ASSETS.comms.footprint],
];
const patrolLayout = defaultLayout();
const patrolNodes = patrolNodesForLayout(patrolLayout);
for (const [role, stops] of Object.entries(PATROL_STOPS)) {
  const motion = createPatrolMotion(role);
  const reached = new Set();
  let walking = 0, resting = 0;
  for (let frame = 0; frame < 3600; frame++) {
    stepPatrolMotion(motion, 0.05, patrolNodes, patrolLayout);
    if (motion.route.length > 2) throw new Error(`${role} took an unnecessary perimeter circuit`);
    if (motion.moving) walking++; else resting++;
    if (!motion.route.length && motion.wait > 0) reached.add(motion.node);
    for (const [x, z, size] of occupied) {
      const clearance = size / 2 + 0.15;
      if (Math.abs(motion.x - x) < clearance && Math.abs(motion.z - z) < clearance) {
        throw new Error(`${role} patrol crossed a building at ${motion.x.toFixed(2)}, ${motion.z.toFixed(2)}`);
      }
    }
  }
  if (!walking || !resting || stops.some(stop => !reached.has(stop))) throw new Error(`${role} patrol did not walk, stop and visit every assigned structure`);
  for (const stop of stops) if (!PATROL_NODES[stop] || !shortestPatrolPath('camp', stop).length) throw new Error(`${role} has an unreachable stop`);
}
console.log('DZN patrols verified: five roles visit assigned buildings and camp, pause, and avoid building footprints.');
const movedPatrolLayout = defaultLayout();
movedPatrolLayout.structures.workshop = { x: -10, z: 4 };
movedPatrolLayout.walls.push({ id: 'wall-1', x: 0, z: 6, level: 1 });
const movedStops = patrolNodesForLayout(movedPatrolLayout);
const wallDetour = walkablePatrolPath([0, 4], [0, 10], movedPatrolLayout);
if (movedStops.workshop[0] !== -10 || !wallDetour || wallDetour.length < 2 || wallDetour.some(point => point[0] === 0 && point[1] === 6)) throw new Error('Moved buildings and placed walls must change the squad walking route.');
const walledHallLayout = defaultLayout();
for (const [x, z] of [[0, 4], [4, 0], [-4, 0], [0, -4]]) walledHallLayout.walls.push({ id: `wall-${x}-${z}`, x, z, level: 1 });
const walledHallStop = patrolNodesForLayout(walledHallLayout).hall;
if (walledHallLayout.walls.some(wall => wall.x === walledHallStop[0] && wall.z === walledHallStop[1]) ||
    !walkablePatrolPath(PATROL_NODES.camp, walledHallStop, walledHallLayout)) throw new Error('A ring of wall segments must not put the Hall patrol stop inside a wall.');
console.log('Dynamic patrol nodes and wall-avoiding grid paths verified.');
for (const role of Object.keys(DEFENDER_CONCEPTS)) for (const [post, node] of Object.entries(DEFENDER_POST_NODES)) {
  const motion = createDefenderMotion(role, post);
  const reached = new Set();
  let walking = 0, resting = 0;
  for (let frame = 0; frame < 3600; frame++) {
    stepPatrolMotion(motion, 0.05, patrolNodes, patrolLayout);
    if (motion.moving) walking++; else resting++;
    if (!motion.route.length && motion.wait > 0) reached.add(motion.node);
    for (const [x, z, size] of occupied) {
      const clearance = size / 2 + 0.15;
      if (Math.abs(motion.x - x) < clearance && Math.abs(motion.z - z) < clearance) throw new Error(`${role} crossed a building en route to ${post}`);
    }
  }
  if (!walking || !resting || !reached.has('camp') || !reached.has(node)) throw new Error(`${role} did not walk between camp and ${post}`);
}
console.log('DZN defenders verified: four 3D roles reach every assigned post and return to camp without crossing buildings.');
const defenderManifest = JSON.parse(readFileSync(join(root, 'assets/models/defenders/manifest.json'), 'utf8'));
const defenderHashes = new Set();
const defenderParts = {
  guardian: ['barrier_shield', 'barrier_body'], aegis: ['left_drone', 'right_drone'],
  trapper: ['snare_module_0', 'snare_module_1', 'snare_module_2'],
  hound: ['left_front_leg', 'right_front_leg', 'left_rear_leg', 'right_rear_leg'],
};
if (Object.keys(defenderManifest.assets).length !== 20) throw new Error('Four DZN defenders need five 3D appearance tiers each.');
for (const role of Object.keys(DEFENDER_CONCEPTS)) for (let level = 1; level <= 5; level++) {
  const name = `${role}_l0${level}`;
  const entry = defenderManifest.assets[name];
  if (!entry || entry.file !== defenderAsset(role, level)) throw new Error(`Missing defender tier: ${name}`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid defender GLB: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const names = new Set((gltf.nodes || []).map(node => node.name));
  if (!gltf.meshes?.length || defenderParts[role].some(part => !names.has(part))) throw new Error(`Incomplete ${role} 3D geometry: ${name}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (entry.sha256 !== hash || entry.bytes !== bytes.length || defenderHashes.has(hash)) throw new Error(`Defender integrity or tier distinction failed: ${name}`);
  defenderHashes.add(hash);
}
const defenderArt = JSON.parse(readFileSync(join(root, 'assets/portraits/defenders/manifest.json'), 'utf8'));
if (Object.keys(defenderArt.assets).length !== 4) throw new Error('Four defender concept images are required.');
for (const role of Object.keys(DEFENDER_CONCEPTS)) {
  const entry = defenderArt.assets[role];
  if (!entry || entry.file !== defenderPortrait(role)) throw new Error(`Missing defender art: ${role}`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  if (bytes.toString('latin1', 0, 4) !== '\x89PNG' || bytes.readUInt32BE(16) !== 1254 || bytes.readUInt32BE(20) !== 1254 || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Invalid defender portrait: ${role}`);
}
console.log('DZN defender concepts verified: 20 distinct 3D GLBs and four unchanged owner images.');
const portraitManifest = JSON.parse(readFileSync(join(root, 'assets/portraits/squads-final/manifest.json'), 'utf8'));
const portraits = Object.entries(portraitManifest.assets);
if (portraits.length !== 25 || portraitManifest.outputSize?.join('x') !== '768x768') throw new Error('DZN squad kit requires all 25 final detailed character portraits.');
const portraitHashes = new Set();
const sourceHashes = new Map();
for (const [name, entry] of portraits) {
  if (!squadManifest.assets[name] || entry.file !== squadPortrait(name.split('_')[0], Number(name.slice(-1)))) throw new Error(`Squad portrait does not match a model: ${name}`);
  const bytes = readFileSync(join(root, ...entry.file.split('/')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.toString('latin1', 0, 4) !== '\x89PNG' || bytes.readUInt32BE(16) !== 768 || bytes.readUInt32BE(20) !== 768 || bytes[25] !== 6 || hash !== entry.sha256 || bytes.length !== entry.bytes || bytes.length < 250000 || portraitHashes.has(hash)) throw new Error(`Invalid final squad portrait: ${name}`);
  if (!/^[a-f0-9]{64}$/.test(entry.sourceSha256) || !Array.isArray(entry.bbox) || entry.bbox.length !== 4 || entry.opaquePixels < 25000) throw new Error(`Missing final squad provenance: ${name}`);
  if (!/^DZN [\w ,_-]+\.png$/.test(entry.source)) throw new Error(`Invalid source sheet name: ${name}`);
  const sourceHash = createHash('sha256').update(readFileSync(join(root, '..', 'source-art', 'squads', entry.source))).digest('hex');
  if (sourceHash !== entry.sourceSha256) throw new Error(`Original character sheet changed: ${name}`);
  if (sourceHashes.has(name.split('_')[0]) && sourceHashes.get(name.split('_')[0]) !== entry.sourceSha256) throw new Error(`Mixed character sheet source within role: ${name}`);
  sourceHashes.set(name.split('_')[0], entry.sourceSha256);
  portraitHashes.add(hash);
}
if (sourceHashes.size !== 5 || new Set(sourceHashes.values()).size !== 5) throw new Error('Final character portraits must come from five distinct owner-supplied sheets.');
console.log(`DZN squad portraits verified: ${portraits.length} distinct transparent 768x768 PNGs from five supplied character sheets.`);
