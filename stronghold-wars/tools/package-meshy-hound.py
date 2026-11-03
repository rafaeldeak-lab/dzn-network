"""Validate and record the five owner-guided, textured Hound game models."""

import hashlib
import json
import struct
from pathlib import Path


root = Path(__file__).resolve().parents[1]
source = root / 'source-art/meshy-hound-v1'
output = root / 'preview/assets/models/defenders-v5'
assets = {}
hashes = set()
required = {f'DZN_Hound_{action}' for action in ('Idle', 'Walk', 'Run', 'Alert', 'Pounce')}
parts = {'Core', 'Head', 'Tail', *(f'{end}{part}_{side}' for end in ('Front', 'Rear')
                                      for part in ('Upper', 'Lower', 'Paw') for side in ('L', 'R'))}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


for level in range(1, 6):
    name = f'hound_l0{level}'
    file = output / f'{name}.glb'
    mesh = source / f'{name}-meshy-source.glb'
    rig = source / f'{name}-rig.glb'
    reference = source / f'{name}-reference.png'
    data = file.read_bytes()
    if data[:4] != b'glTF' or struct.unpack_from('<I', data, 8)[0] != len(data):
        raise ValueError(f'Invalid game GLB: {name}')
    gltf = json.loads(data[20:20 + struct.unpack_from('<I', data, 12)[0]])
    triangles = sum(gltf['accessors'][part['indices']]['count'] // 3
                    for model in gltf['meshes'] for part in model['primitives'])
    clips = {clip['name'] for clip in gltf.get('animations', [])}
    nodes = {node.get('name') for node in gltf.get('nodes', [])}
    sha = hashlib.sha256(data).hexdigest()
    if not required.issubset(clips) or not parts.issubset(nodes) or not gltf.get('skins') \
            or not gltf.get('images') or not 12000 < triangles < 22000 or sha in hashes:
        raise ValueError(f'Incomplete or duplicated Hound tier: {name}')
    if digest(rig) != sha:
        raise ValueError(f'Game model differs from its rigged source: {name}')
    hashes.add(sha)
    assets[name] = {
        'file': f'assets/models/defenders-v5/{name}.glb',
        'source': f'source-art/meshy-hound-v1/{name}-rig.glb',
        'sourceMesh': f'source-art/meshy-hound-v1/{name}-meshy-source.glb',
        'reference': f'source-art/meshy-hound-v1/{name}-reference.png',
        'portrait': 'assets/portraits/defenders/hound.png',
        'bytes': len(data), 'sha256': sha,
        'sourceSha256': digest(rig), 'sourceMeshSha256': digest(mesh),
        'referenceSha256': digest(reference), 'triangles': triangles,
        'skins': len(gltf['skins']), 'textures': len(gltf['images']),
        'animations': sorted(clips), 'meshyCredits': 25 if level == 1 else 15,
    }

manifest = {
    'schemaVersion': 1, 'complete': True,
    'provenance': ('The owner DZN Hound concept informed five transparent level references. '
                   'Meshy T2.5 Smart Topology produced five private image-guided, textured quadruped models '
                   'using 85 existing credits including one optional 10-credit Level 1 texture refinement. '
                   'Blender added a four-leg, head and tail skin with five authored actions. '
                   'No credits were purchased.'),
    'usage': 'DZN Stronghold Wars game. Rights subject to the owner Meshy and ImageGen accounts and terms.',
    'coordinateSystem': 'glTF Y-up; the Hound faces +Z in the game',
    'assets': assets,
}
output.mkdir(parents=True, exist_ok=True)
with (output / 'manifest.json').open('w', encoding='utf-8', newline='\n') as handle:
    handle.write(json.dumps(manifest, indent=2) + '\n')
print('Packaged five distinct DZN Hound levels with five actions each')
