"""Record and verify the five image-guided, animated Trapper tiers."""

import hashlib
import json
import struct
from pathlib import Path


root = Path(__file__).resolve().parents[1]
output = root / 'preview/assets/models/defenders-v4'
source = root / 'source-art/meshy-trapper-v1'
assets = {}
seen = set()


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


for level in range(1, 6):
    name = f'trapper_l0{level}'
    model = output / f'{name}.glb'
    rig = source / f'{name}-rig.glb'
    reference = source / f'{name}-rig-reference.png'
    data = model.read_bytes()
    if data[:4] != b'glTF' or struct.unpack_from('<I', data, 8)[0] != len(data):
        raise ValueError(f'Invalid game GLB: {model}')
    gltf = json.loads(data[20:20 + struct.unpack_from('<I', data, 12)[0]])
    triangles = sum(gltf['accessors'][part['indices']]['count'] // 3
                    for mesh in gltf['meshes'] for part in mesh['primitives'])
    clips = {clip['name'] for clip in gltf.get('animations', [])}
    required = {f'DZN_Trapper_{action}' for action in ('Idle', 'Walk', 'Run', 'Deploy')}
    nodes = {node.get('name') for node in gltf.get('nodes', [])}
    digest = hashlib.sha256(data).hexdigest()
    if not required.issubset(clips) or 'mixamorig:RightHand' not in nodes or not gltf.get('skins') \
            or not gltf.get('images') or triangles > 22000 or digest in seen:
        raise ValueError(f'Incomplete or duplicated Trapper tier: {name}')
    seen.add(digest)
    assets[name] = {
        'file': f'assets/models/defenders-v4/{name}.glb',
        'source': f'source-art/meshy-trapper-v1/{name}-rig.glb',
        'reference': f'source-art/meshy-trapper-v1/{name}-rig-reference.png',
        'portrait': 'assets/portraits/defenders/trapper.png',
        'bytes': len(data), 'sha256': digest,
        'sourceSha256': sha256(rig), 'referenceSha256': sha256(reference),
        'triangles': triangles, 'skins': len(gltf['skins']),
        'textures': len(gltf['images']), 'animations': sorted(clips),
        'hand': 'mixamorig:RightHand', 'meshyCredits': 15,
    }

manifest = {
    'schemaVersion': 1,
    'complete': True,
    'provenance': ('The owner DZN Trapper concept informed five original tier references. '
                   'Meshy T2.5 Smart Topology produced five private textured models at '
                   '15 existing credits each. An initial Level 1 variant with a held disc '
                   'was rejected after its rig deformed the equipment, costing 15 additional '
                   'existing credits. Meshy free rigging supplied walk/run clips. Blender '
                   'authored idle and snare-deploy actions. The round handheld disc and '
                   'battle snare effects are game geometry attached to the rig.'),
    'usage': 'DZN Stronghold Wars game. Rights subject to the owner Meshy and ImageGen accounts and terms.',
    'coordinateSystem': 'glTF Y-up; the Trapper body faces +Z in the game',
    'assets': assets,
}
with (output / 'manifest.json').open('w', encoding='utf-8', newline='\n') as target:
    target.write(json.dumps(manifest, indent=2) + '\n')
print('Packaged five DZN Trapper levels with Meshy source hashes and four clips each')
