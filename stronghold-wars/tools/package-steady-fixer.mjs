import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(join(root, 'preview/assets/models/squads-v8/manifest.json'), 'utf8'));
const output = join(root, 'preview/assets/models/squads-v12');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = {};
mkdirSync(output, { recursive: true });

for (let level = 1; level <= 5; level++) {
  const name = `engineer_l0${level}`;
  const previous = baseline.assets[name];
  if (!previous?.rosebudJob) throw new Error(`Missing source provenance for ${name}`);
  const file = `assets/models/squads-v12/${name}.glb`;
  copyFileSync(join(root, `review/fixer-l0${level}-grip2.glb`), join(root, 'preview', file));
  const bytes = readFileSync(join(root, 'preview', file));
  const sourceBytes = readFileSync(join(root, previous.source));
  const referenceBytes = readFileSync(join(root, 'preview', previous.reference));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid ${name} GLB`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const triangles = gltf.meshes.flatMap(mesh => mesh.primitives).reduce((count, primitive) => count + gltf.accessors[primitive.indices].count / 3, 0);
  if (!gltf.skins?.length || gltf.skins[0].joints?.length < 15 || gltf.images?.length < 2
    || !gltf.animations?.some(clip => clip.name === 'DZN_Operative_Walk' && clip.channels.length)
    || !gltf.animations?.some(clip => clip.name === 'DZN_Operative_Idle' && clip.channels.length)) throw new Error(`Incomplete ${name} rig`);
  assets[name] = {
    ...previous, file, bytes: bytes.length, sha256: sha(bytes), triangles,
    sourceSha256: sha(sourceBytes), referenceSha256: sha(referenceBytes),
    skins: gltf.skins.length, textures: gltf.images.length,
  };
}

writeFileSync(join(output, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 1, complete: true,
  provenance: 'The five Rosebud image-guided DZN Fixer sources from squads-v8 were retained. Blender re-rigged the axe hand and steadied its walk-cycle grip locally; no additional generation credits were used.',
  usage: baseline.usage, coordinateSystem: baseline.coordinateSystem, assets,
}, null, 2)}\n`);
console.log('Packaged five steady-grip Fixer levels in squads-v12.');
