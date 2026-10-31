"""Bind a Rosebud operative mesh to a 3D walk/idle rig and export a GLB.

Usage: blender --background --python rig-rosebud-operative.py -- input.glb output.glb
"""

import bpy
import bmesh
import math
import sys
from mathutils import Matrix, Quaternion, Vector


source_path, output_path = sys.argv[sys.argv.index('--') + 1:]
source_name = source_path.lower().replace('\\', '/')
is_engineer = 'engineer_l0' in source_name
two_handed = 'sentinel_l0' in source_name
left_hand_occupied = two_handed or is_engineer
right_hand_occupied = two_handed
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source_path)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
assert meshes, 'Source GLB has no meshes'

# The Rosebud characters are Y-forward with their arms along X. Preserve each
# source material/texture, but put the operatives on the same 1.8 m skeleton.
for mesh in meshes:
    mesh.data.transform(mesh.matrix_world)
    mesh.matrix_world = Matrix.Identity(4)
points = [vertex.co for mesh in meshes for vertex in mesh.data.vertices]
low_z = min(point.z for point in points)
height = max(point.z for point in points) - low_z
assert 0.7 < height < 2.5, f'Unexpected source height: {height}'

# Some image-guided runs include a stone display slab. Its broad, flat
# disconnected pieces must not follow the operative around the base.
for mesh in meshes:
    vertices = mesh.data.vertices
    parent = list(range(len(vertices)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for edge in mesh.data.edges:
        parent[find(edge.vertices[0])] = find(edge.vertices[1])
    components = {}
    for vertex in vertices:
        components.setdefault(find(vertex.index), []).append(vertex.index)
    remove = set()
    for indices in components.values():
        coords = [vertices[index].co for index in indices]
        span_x = max(p.x for p in coords) - min(p.x for p in coords)
        span_y = max(p.y for p in coords) - min(p.y for p in coords)
        span_z = max(p.z for p in coords) - min(p.z for p in coords)
        if (len(indices) > 250 and span_x > height * .8 and span_y > height * .8
                and span_z < height * .1 and min(p.z for p in coords) < low_z + height * .14):
            remove.update(indices)
    if remove:
        editable = bmesh.new()
        editable.from_mesh(mesh.data)
        editable.verts.ensure_lookup_table()
        bmesh.ops.delete(editable, geom=[editable.verts[index] for index in remove], context='VERTS')
        editable.to_mesh(mesh.data)
        editable.free()
        print('DZN_FLOOR_REMOVED', mesh.name, len(remove))

points = [vertex.co for mesh in meshes for vertex in mesh.data.vertices]
low_z = min(point.z for point in points)
height = max(point.z for point in points) - low_z
scale = 1.8 / height
for mesh in meshes:
    for vertex in mesh.data.vertices:
        vertex.co.x *= scale
        vertex.co.y *= scale
        vertex.co.z = (vertex.co.z - low_z) * scale

armature_data = bpy.data.armatures.new('DZN_Operative_Rig')
armature = bpy.data.objects.new('DZN_Operative_Rig', armature_data)
bpy.context.collection.objects.link(armature)
bpy.context.view_layer.objects.active = armature
bpy.ops.object.mode_set(mode='EDIT')


def bone(name, head, tail, parent=None):
    part = armature_data.edit_bones.new(name)
    part.head, part.tail = head, tail
    if parent:
        part.parent = armature_data.edit_bones[parent]


bone('Root', (0, 0, .03), (0, 0, .79))
bone('Spine', (0, 0, .79), (0, 0, 1.20), 'Root')
bone('Chest', (0, 0, 1.20), (0, 0, 1.44), 'Spine')
bone('Neck', (0, 0, 1.44), (0, 0, 1.56), 'Chest')
bone('Head', (0, 0, 1.56), (0, 0, 1.78), 'Neck')
for side, sign in [('L', -1), ('R', 1)]:
    if is_engineer and side == 'L':
        # The Fixer source has its gloves close to the torso and forward of
        # the hips; the generic wide-T-pose rig places hand bones ~40 cm away.
        bone(f'UpperArm_{side}', (sign * .20, -.05, 1.42), (sign * .27, -.13, 1.10), 'Chest')
        bone(f'Forearm_{side}', (sign * .27, -.13, 1.10), (sign * .27, -.22, .88), f'UpperArm_{side}')
        bone(f'Hand_{side}', (sign * .27, -.22, .88), (sign * .27, -.27, .78), f'Forearm_{side}')
    else:
        bone(f'UpperArm_{side}', (sign * .22, 0, 1.42), (sign * .41, 0, 1.17), 'Chest')
        bone(f'Forearm_{side}', (sign * .41, 0, 1.17), (sign * .52, 0, .98), f'UpperArm_{side}')
        bone(f'Hand_{side}', (sign * .52, 0, .98), (sign * .59, 0, .87), f'Forearm_{side}')
    bone(f'UpperLeg_{side}', (sign * .13, 0, .79), (sign * .13, 0, .43), 'Root')
    bone(f'LowerLeg_{side}', (sign * .13, 0, .43), (sign * .13, 0, .12), f'UpperLeg_{side}')
    bone(f'Foot_{side}', (sign * .13, 0, .12), (sign * .13, -.12, .03), f'LowerLeg_{side}')
bpy.ops.object.mode_set(mode='OBJECT')

bones = {part.name: part for part in armature.data.bones}


def distance(point, name):
    part = bones[name]
    segment = part.tail_local - part.head_local
    t = max(0, min(1, (point - part.head_local).dot(segment) / segment.length_squared))
    return (point - part.head_local - t * segment).length


for mesh in meshes:
    mesh.parent = armature
    modifier = mesh.modifiers.new('DZN skin', 'ARMATURE')
    modifier.object = armature
    groups = {name: mesh.vertex_groups.new(name=name) for name in bones}
    held_vertices = 0
    for vertex in mesh.data.vertices:
        point = vertex.co
        if is_engineer and -.34 < point.x < 0 and point.y < -.22 and .43 < point.z < .96:
            # The disconnected axe, handle and gripping glove are one visual
            # prop. Keep them rigid on the carrying hand through the walk.
            groups['Hand_L'].add([vertex.index], 1, 'REPLACE')
            held_vertices += 1
            continue
        if point.z > 1.53:
            candidates = ['Head', 'Neck']
        elif (is_engineer and point.x < -.18 and point.z > .74 and (point.z > 1.0 or point.y < -.08)) or (point.z > .86 and abs(point.x) > .24):
            side = 'L' if point.x < 0 else 'R'
            candidates = [f'UpperArm_{side}', f'Forearm_{side}', f'Hand_{side}']
        elif point.z < .81 and abs(point.x) > .07:
            side = 'L' if point.x < 0 else 'R'
            candidates = [f'UpperLeg_{side}', f'LowerLeg_{side}', f'Foot_{side}']
        else:
            candidates = ['Root', 'Spine', 'Chest', 'Neck']
        nearest = sorted(candidates, key=lambda name: distance(point, name))[:2]
        strengths = [1 / (distance(point, name) + .015) ** 4 for name in nearest]
        total = sum(strengths)
        for name, strength in zip(nearest, strengths):
            groups[name].add([vertex.index], strength / total, 'REPLACE')
    if is_engineer:
        print('DZN_FIXER_HAND_WEIGHTED', mesh.name, held_vertices)


def swing(name, radians, frame):
    pose = armature.pose.bones[name]
    axis = pose.bone.matrix_local.to_3x3().inverted() @ Vector((1, 0, 0))
    pose.rotation_mode = 'QUATERNION'
    pose.rotation_quaternion = Quaternion(axis, radians)
    pose.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=name)


walk = bpy.data.actions.new('DZN_Operative_Walk')
armature.animation_data_create()
armature.animation_data.action = walk
for frame, step in [(1, 0), (7, .30), (13, 0), (19, -.30), (25, 0)]:
    for side, sign in [('L', 1), ('R', -1)]:
        swing(f'UpperLeg_{side}', step * sign, frame)
        swing(f'LowerLeg_{side}', max(0, -step * sign) * .40, frame)
        # Keep occupied gloves close to their carried gear. The source art has
        # tools baked into the skinned mesh, so a normal counter-swing visibly
        # separates a hand from its axe or rifle.
        occupied = (left_hand_occupied and side == 'L') or (right_hand_occupied and side == 'R')
        swing(f'UpperArm_{side}', step * .07 if occupied else -step * sign * .52, frame)
        swing(f'Forearm_{side}', 0 if occupied else .04, frame)
    swing('Chest', math.sin((frame - 1) * math.pi / 12) * .014, frame)

armature.animation_data.action = None
idle = bpy.data.actions.new('DZN_Operative_Idle')
armature.animation_data.action = idle
for frame, breath in [(1, 0), (25, .015), (49, 0)]:
    swing('Chest', breath, frame)
    swing('UpperArm_L', breath * .15 if left_hand_occupied else -breath * .7, frame)
    swing('UpperArm_R', breath * .15 if right_hand_occupied else breath * .7, frame)

armature.animation_data.action = walk
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 49
bpy.context.scene.render.fps = 24
bpy.context.scene.frame_set(1)
for obj in list(bpy.context.scene.objects):
    if obj != armature and obj not in meshes:
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
armature.select_set(True)
for mesh in meshes:
    mesh.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB', use_selection=True,
                          export_animations=True, export_animation_mode='ACTIONS',
                          export_nla_strips=False, export_apply=False)
print('DZN_OPERATIVE_EXPORT', output_path, 'vertices', sum(len(mesh.data.vertices) for mesh in meshes),
      'bones', len(armature_data.bones), 'actions', [action.name for action in bpy.data.actions])
