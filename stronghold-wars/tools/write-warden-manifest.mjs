import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jobs = [
  'af9dc93f-2eb1-45de-bf18-8d48a5e3ac8c',
  'd74a234b-7c22-4415-95ae-fa3468e36ebc',
  '3d746674-7007-445b-abfe-267839a2ee9c',
  '3534dfcf-183f-436d-adb3-16d888c6ba3f',
  'dcd13f36-6560-4163-baa9-c8dd7cfbf86e',
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = {};
for (let level = 1; level <= 5; level++) {
  const name = `assault_l0${level}`;
  const file = `assets/models/squads-v6/${name}.glb`;
  const source = `source-art/squads/warden_l0${level}_rosebud_tripo.glb`;
  const bytes = readFileSync(join(root, 'preview', ...file.split('/')));
  const sourceBytes = readFileSync(join(root, ...source.split('/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Bad GLB: ${file}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const triangles = (gltf.meshes || []).flatMap(mesh => mesh.primitives || [])
    .reduce((count, primitive) => count + (gltf.accessors[primitive.indices]?.count || 0) / 3, 0);
  if (!gltf.skins?.length || !gltf.animations?.some(clip => clip.name === 'DZN_Warden_Walk')) throw new Error(`Unrigged Warden: ${file}`);
  assets[name] = {
    file, source, rosebudJob: jobs[level - 1], bytes: bytes.length,
    sha256: hash(bytes), sourceSha256: hash(sourceBytes), triangles,
    skins: gltf.skins.length, textures: gltf.images?.length || 0,
    animation: 'DZN_Warden_Walk', heightMetres: 1.8,
  };
}
const manifest = {
  schemaVersion: 1,
  provenance: 'Generated in the owner Rosebud AI account with its Tripo text-to-3D Create option using existing credits. Static source GLBs were separately rigged and animated in Blender; source meshes are retained.',
  usage: 'DZN Stronghold Wars local preview. Rights remain subject to the owner account and Rosebud terms.',
  coordinateSystem: 'glTF Y-up; source character faces +X and game placement rotates it toward +Z',
  assets,
};
const equipmentFile = 'assets/models/squads-v6/warden_carbine.glb';
const equipmentSource = 'source-art/squads/warden_carbine_rosebud_tripo.glb';
const equipmentBytes = readFileSync(join(root, 'preview', ...equipmentFile.split('/')));
const equipmentSourceBytes = readFileSync(join(root, ...equipmentSource.split('/')));
if (equipmentBytes.toString('ascii', 0, 4) !== 'glTF' || equipmentBytes.readUInt32LE(8) !== equipmentBytes.length) throw new Error('Bad Warden carbine GLB.');
const equipmentGltf = JSON.parse(equipmentBytes.toString('utf8', 20, 20 + equipmentBytes.readUInt32LE(12)));
if (!equipmentGltf.meshes?.length || !equipmentGltf.images?.length) throw new Error('Warden carbine is missing mesh or texture.');
manifest.equipment = {
  warden_carbine: {
    file: equipmentFile, source: equipmentSource,
    rosebudJob: 'f652da23-b56f-432b-bd03-d2216356123f',
    bytes: equipmentBytes.length, sha256: hash(equipmentBytes), sourceSha256: hash(equipmentSourceBytes),
    meshes: equipmentGltf.meshes.length, textures: equipmentGltf.images.length,
  },
};
writeFileSync(join(root, 'preview/assets/models/squads-v6/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Wrote five verified Rosebud Warden levels and one carbine.');
