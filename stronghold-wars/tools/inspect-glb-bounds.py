"""Print Blender-space bounds for a supplied source GLB."""

import bpy
import sys
from mathutils import Vector

path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
        continue
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    lows = tuple(round(min(point[i] for point in points), 4) for i in range(3))
    highs = tuple(round(max(point[i] for point in points), 4) for i in range(3))
    print('BOUNDS', obj.name, lows, highs, 'vertices', len(obj.data.vertices))
