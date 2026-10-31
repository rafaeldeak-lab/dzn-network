"""Record the five owner-guided Meshy Fixer rigs and game GLBs.

Run after attaching each tier's independent hand axe with attach-fixer-axe.py.
Source rigs and clean reference images stay in source-art/meshy-fixer-v13.
"""

import hashlib
import json
import struct
from pathlib import Path


root = Path(__file__).resolve().parents[1]
output = root / 'preview/assets/models/squads-v13'
source = root / 'source-art/meshy-fixer-v13'
assets = {}
for level in range(1, 6):
    name = f'engineer_l0{level}'
    game_path = output / f'{name}.glb'
    source_path = source / f'{name}-rig.glb'
    reference_path = source / f'{name}-reference.png'
    data = game_path.read_bytes()
    if data[:4] != b'glTF' or struct.unpack_from('<I', data, 8)[0] != len(data):
        raise ValueError(f'Invalid GLB: {game_path}')
    json_size = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + json_size])
    triangles = sum(gltf['accessors'][part['indices']]['count'] // 3
                    for mesh in gltf['meshes'] for part in mesh['primitives'])
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    assets[name] = {
        'file': f'assets/models/squads-v13/{name}.glb',
        'source': f'source-art/meshy-fixer-v13/{name}-rig.glb',
        'reference': f'source-art/meshy-fixer-v13/{name}-reference.png',
        'portrait': f'assets/portraits/squads-final/{name}.png',
        'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
        'sourceSha256': digest(source_path),
        'referenceSha256': digest(reference_path),
        'triangles': triangles,
        'skins': len(gltf.get('skins', [])),
        'textures': len(gltf.get('images', [])),
        'animations': [clip['name'] for clip in gltf.get('animations', [])],
        'handTool': 'mixamorig:LeftHand',
        'meshyCredits': 15,
    }

manifest = {
    'schemaVersion': 1,
    'complete': True,
    'provenance': ('DZN owner portraits informed five clean ImageGen references. '
                   'Meshy T2.5 Smart Topology generated five private, textured A-pose '
                   'models at 15 existing credits each. Meshy humanoid rigging supplied '
                   'walking and running; Blender added an independent hand-bound 3D axe '
                   'and a full-body idle clip.'),
    'usage': 'DZN Stronghold Wars game. Rights subject to the owner Meshy and ImageGen accounts and terms.',
    'coordinateSystem': 'glTF Y-up; the Fixer faces +Z in the game',
    'assets': assets,
}
with (output / 'manifest.json').open('w', encoding='utf-8', newline='\n') as handle:
    handle.write(json.dumps(manifest, indent=2) + '\n')
print('Packaged five DZN Fixer tiers:', sum(asset['bytes'] for asset in assets.values()), 'bytes')
