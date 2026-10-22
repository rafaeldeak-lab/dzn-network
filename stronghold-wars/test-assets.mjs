import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILDING_ASSETS } from './preview/building-assets.js';

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
