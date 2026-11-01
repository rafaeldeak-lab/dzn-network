"""Record owner-guided Meshy Guardian rigs and hand-bound shield game models."""

import hashlib
import json
import struct
from pathlib import Path

root = Path(__file__).resolve().parents[1]
output = root / 'preview/assets/models/defenders-v2'
source = root / 'source-art/meshy-guardian-v1'
assets = {}

for level in range(1, 6):
    name = f'guardian_l0{level}'
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
        'file': f'assets/models/defenders-v2/{name}.glb',
        'source': f'source-art/meshy-guardian-v1/{name}-rig.glb',
        'reference': f'source-art/meshy-guardian-v1/{name}-reference.png',
        'portrait': 'assets/portraits/defenders/guardian.png',
        'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
        'sourceSha256': digest(source_path),
        'referenceSha256': digest(reference_path),
        'triangles': triangles,
        'skins': len(gltf.get('skins', [])),
        'textures': len(gltf.get('images', [])),
        'animations': [clip['name'] for clip in gltf.get('animations', [])],
        'shieldHand': 'mixamorig:LeftHand',
        'meshyCredits': 15,
    }

manifest = {
    'schemaVersion': 1,
    'complete': True,
    'provenance': ('The supplied DZN Guardian concept informed five clean A-pose references. '
                   'Meshy T2.5 Smart Topology produced five private textured models at '
                   '15 existing credits each. Meshy humanoid rigging supplied walking '
                   'and running; Blender bound a separate tiered 3D barrier shield to '
                   'the left hand and authored idle and defensive block actions.'),
    'usage': 'DZN Stronghold Wars game. Rights subject to the owner Meshy and ImageGen accounts and terms.',
    'coordinateSystem': 'glTF Y-up; the Guardian faces +Z in the game',
    'assets': assets,
}
with (output / 'manifest.json').open('w', encoding='utf-8', newline='\n') as handle:
    handle.write(json.dumps(manifest, indent=2) + '\n')
print('Packaged five DZN Guardian tiers:', sum(asset['bytes'] for asset in assets.values()), 'bytes')
