"""Rig a Rosebud textured DZN Warden source model in Blender and export a walking GLB."""

import bpy
import math
import sys
from mathutils import Matrix, Quaternion, Vector

source_path, output_path, tier_text = sys.argv[sys.argv.index('--') + 1:]
tier = int(tier_text)
assert 1 <= tier <= 5
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source_path)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
assert meshes, 'Source GLB has no meshes'

# Baking into vertex coordinates leaves an identity transform for the skin.
for mesh in meshes:
    mesh.data.transform(mesh.matrix_world)
    mesh.matrix_world = Matrix.Identity(4)

points = [vertex.co for mesh in meshes for vertex in mesh.data.vertices]
min_z = min(point.z for point in points)
max_z = max(point.z for point in points)
height = max_z - min_z
assert 0.2 < height < 5, f'Unexpected source height: {height}'
scale = 1.8 / height
for mesh in meshes:
    for vertex in mesh.data.vertices:
        vertex.co.z = (vertex.co.z - min_z) * scale
        vertex.co.x *= scale
        vertex.co.y *= scale

armature_data = bpy.data.armatures.new('DZN_Warden_Rig')
armature = bpy.data.objects.new('DZN_Warden_Rig', armature_data)
bpy.context.collection.objects.link(armature)
bpy.context.view_layer.objects.active = armature
armature.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')


def bone(name, head, tail, parent=None):
    b = armature_data.edit_bones.new(name)
    b.head = head
    b.tail = tail
    if parent:
        b.parent = armature_data.edit_bones[parent]
    return b


bone('Root', (0, 0, 0.03), (0, 0, 0.78))
bone('Spine', (0, 0, 0.78), (0, 0, 1.21), 'Root')
bone('Chest', (0, 0, 1.21), (0, 0, 1.44), 'Spine')
bone('Neck', (0, 0, 1.44), (0, 0, 1.56), 'Chest')
bone('Head', (0, 0, 1.56), (0, 0, 1.78), 'Neck')
for suffix, sign in [('L', -1), ('R', 1)]:
    bone(f'UpperArm_{suffix}', (0, sign * 0.23, 1.42), (0, sign * 0.41, 1.18), 'Chest')
    bone(f'Forearm_{suffix}', (0, sign * 0.41, 1.18), (0, sign * 0.51, 0.96), f'UpperArm_{suffix}')
    bone(f'Hand_{suffix}', (0, sign * 0.51, 0.96), (0, sign * 0.58, 0.83), f'Forearm_{suffix}')
    bone(f'UpperLeg_{suffix}', (0, sign * 0.13, 0.79), (0, sign * 0.13, 0.43), 'Root')
    bone(f'LowerLeg_{suffix}', (0, sign * 0.13, 0.43), (0, sign * 0.13, 0.12), f'UpperLeg_{suffix}')
    bone(f'Foot_{suffix}', (0, sign * 0.13, 0.12), (0.12, sign * 0.13, 0.03), f'LowerLeg_{suffix}')
bpy.ops.object.mode_set(mode='OBJECT')

# Preserve the source's PBR textures while binding its surface to the skeleton.
for mesh in meshes:
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    assert any(mod.type == 'ARMATURE' for mod in mesh.modifiers)

    # Some generated meshes have disconnected armour plates that defeat Bone
    # Heat. In that case, assign nearby limb bones directly instead of
    # exporting an action whose surface never deforms.
    if not all(vertex.groups for vertex in mesh.data.vertices):
        indices = list(range(len(mesh.data.vertices)))
        for group in mesh.vertex_groups:
            group.remove(indices)
        bones = {b.name: b for b in armature.data.bones}

        def segment_distance(point, name):
            b = bones[name]
            segment = b.tail_local - b.head_local
            fraction = max(0.0, min(1.0, (point - b.head_local).dot(segment) / segment.length_squared))
            return (point - b.head_local - fraction * segment).length

        for vertex in mesh.data.vertices:
            point = vertex.co
            if point.z > 1.52:
                candidates = ['Head', 'Neck']
            elif point.z > 0.86 and abs(point.y) > 0.24:
                suffix = 'L' if point.y < 0 else 'R'
                candidates = [f'UpperArm_{suffix}', f'Forearm_{suffix}', f'Hand_{suffix}']
            elif point.z < 0.82 and abs(point.y) > 0.07:
                suffix = 'L' if point.y < 0 else 'R'
                candidates = [f'UpperLeg_{suffix}', f'LowerLeg_{suffix}', f'Foot_{suffix}']
            else:
                candidates = ['Root', 'Spine', 'Chest', 'Neck']
            nearest = sorted(candidates, key=lambda name: segment_distance(point, name))[:2]
            strengths = [1 / (segment_distance(point, name) + 0.015) ** 4 for name in nearest]
            total = sum(strengths)
            for name, strength in zip(nearest, strengths):
                mesh.vertex_groups[name].add([vertex.index], strength / total, 'REPLACE')
        print('Applied nearest-bone weights to disconnected source mesh', mesh.name)

walk = bpy.data.actions.new('DZN_Warden_Walk')
armature.animation_data_create()
armature.animation_data.action = walk


def swing(name, radians):
    pose = armature.pose.bones[name]
    axis = pose.bone.matrix_local.to_3x3().inverted() @ Vector((0, 1, 0))
    pose.rotation_mode = 'QUATERNION'
    pose.rotation_quaternion = Quaternion(axis, radians)
    pose.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=name)


for frame, leg_swing in [(1, 0), (7, 0.32), (13, 0), (19, -0.32), (25, 0)]:
    for suffix, sign in [('L', 1), ('R', -1)]:
        swing(f'UpperLeg_{suffix}', leg_swing * sign)
        swing(f'LowerLeg_{suffix}', max(0, -leg_swing * sign) * 0.35)
        swing(f'UpperArm_{suffix}', -leg_swing * sign * 0.65)
        swing(f'Forearm_{suffix}', 0.05)
    swing('Chest', math.sin((frame - 1) * math.pi / 12) * 0.018)

for fc in walk.fcurves:
    for key in fc.keyframe_points:
        key.interpolation = 'BEZIER'

bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 25
bpy.context.scene.render.fps = 24
bpy.context.scene.frame_set(1)
for obj in list(bpy.context.scene.objects):
    if obj != armature and obj not in meshes:
        bpy.data.objects.remove(obj, do_unlink=True)
print('PRE_EXPORT', [(obj.name, obj.type) for obj in bpy.context.scene.objects])
bpy.ops.object.select_all(action='DESELECT')
armature.select_set(True)
for mesh in meshes:
    mesh.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_nla_strips=False,
    export_apply=False,
)
print('exported', output_path, 'tier', tier, 'source meshes', len(meshes), 'bones', len(armature_data.bones))
for mesh in meshes:
    print('weighted mesh', mesh.name, 'groups', len(mesh.vertex_groups), 'vertices', len(mesh.data.vertices))
