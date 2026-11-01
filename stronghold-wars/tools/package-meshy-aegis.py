"""Record the five image-guided Aegis rigs and five authored interceptor drones."""

import hashlib
import json
import struct
from pathlib import Path


root = Path(__file__).resolve().parents[1]
output = root / 'preview/assets/models/defenders-v3'
source = root / 'source-art/meshy-aegis-v1'
assets = {}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def glb_record(path):
    data = path.read_bytes()
    if data[:4] != b'glTF' or struct.unpack_from('<I', data, 8)[0] != len(data):
        raise ValueError(f'Invalid GLB: {path}')
    json_size = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + json_size])
    triangles = sum(gltf['accessors'][part['indices']]['count'] // 3
                    for mesh in gltf['meshes'] for part in mesh['primitives'])
    return {
        'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
        'triangles': triangles,
        'skins': len(gltf.get('skins', [])),
        'textures': len(gltf.get('images', [])),
        'animations': [clip['name'] for clip in gltf.get('animations', [])],
        'nodes': [node.get('name') for node in gltf.get('nodes', [])],
    }


for level in range(1, 6):
    name = f'aegis_l0{level}'
    game_path = output / f'{name}.glb'
    source_path = source / f'{name}-rig.glb'
    reference_path = source / f'{name}-reference.png'
    drone_name = f'aegis_drone_l0{level}'
    drone_path = output / f'{drone_name}.glb'
    body = glb_record(game_path)
    drone = glb_record(drone_path)
    assets[name] = {
        'file': f'assets/models/defenders-v3/{name}.glb',
        'source': f'source-art/meshy-aegis-v1/{name}-rig.glb',
        'reference': f'source-art/meshy-aegis-v1/{name}-reference.png',
        'portrait': 'assets/portraits/defenders/aegis.png',
        'bytes': body['bytes'], 'sha256': body['sha256'],
        'sourceSha256': digest(source_path), 'referenceSha256': digest(reference_path),
        'triangles': body['triangles'], 'skins': body['skins'],
        'textures': body['textures'], 'animations': body['animations'],
        'meshyCredits': 15,
    }
    assets[drone_name] = {
        'file': f'assets/models/defenders-v3/{drone_name}.glb',
        'generatedBy': 'tools/build-aegis-drones.py',
        'bytes': drone['bytes'], 'sha256': drone['sha256'],
        'triangles': drone['triangles'], 'skins': drone['skins'],
        'textures': drone['textures'], 'animations': drone['animations'],
        'articulatedNodes': [name for name in drone['nodes'] if name and name.startswith('drone_rotor_')],
        'meshyCredits': 0,
    }

manifest = {
    'schemaVersion': 1,
    'complete': True,
    'provenance': ('The supplied DZN Aegis concept informed five tiered image references. '
                   'Meshy T2.5 Smart Topology produced five private textured body models at '
                   '15 existing credits each. Meshy humanoid rigging supplied walking and '
                   'running. Blender authored idle and drone-command poses, plus two separate '
                   'interceptor drones with tier-specific armour and named spinning fan pivots.'),
    'usage': 'DZN Stronghold Wars game. Rights subject to the owner Meshy and ImageGen accounts and terms.',
    'coordinateSystem': 'glTF Y-up; the Aegis body and drones face +Z in the game',
    'assets': assets,
}
with (output / 'manifest.json').open('w', encoding='utf-8', newline='\n') as output_file:
    output_file.write(json.dumps(manifest, indent=2) + '\n')
print('Packaged five DZN Aegis soldiers and five interceptor tiers')
