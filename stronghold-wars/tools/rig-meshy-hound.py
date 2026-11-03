"""Rig one Meshy Hound mesh and export five quadruped actions.

Usage: blender --background --python tools/rig-meshy-hound.py -- source.glb game.glb
"""

import math
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector


source_path, output_path = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source_path)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
assert len(meshes) == 1, 'The Hound source must have one textured mesh.'
mesh = meshes[0]
assert mesh.data.materials and mesh.data.materials[0].node_tree, 'Hound texture is missing.'
mesh.data.transform(mesh.matrix_world)
mesh.matrix_world = Matrix.Identity(4)

points = [vertex.co for vertex in mesh.data.vertices]
low_z, high_z = min(p.z for p in points), max(p.z for p in points)
scale = 1.7 / (high_z - low_z)
centre_x = (min(p.x for p in points) + max(p.x for p in points)) / 2
centre_y = (min(p.y for p in points) + max(p.y for p in points)) / 2
for vertex in mesh.data.vertices:
    vertex.co = Vector(((vertex.co.x - centre_x) * scale,
                        (vertex.co.y - centre_y) * scale,
                        (vertex.co.z - low_z) * scale))
points = [vertex.co for vertex in mesh.data.vertices]
min_y, max_y = min(p.y for p in points), max(p.y for p in points)
half_width = max(abs(p.x) for p in points)
front_y = min_y + (max_y - min_y) * .27
rear_y = min_y + (max_y - min_y) * .72
hip_x = half_width * .68

rig_data = bpy.data.armatures.new('DZN_Hound_Armature')
rig = bpy.data.objects.new('DZN_Hound_Armature', rig_data)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')


def add_bone(name, head, tail, parent=None):
    part = rig_data.edit_bones.new(name)
    part.head, part.tail = head, tail
    if parent:
        part.parent = rig_data.edit_bones[parent]


add_bone('Core', (0, rear_y, 1.01), (0, front_y, 1.06))
add_bone('Head', (0, front_y, 1.10), (0, min_y + .15, 1.17), 'Core')
add_bone('Tail', (0, rear_y, 1.08), (0, max_y - .05, 1.11), 'Core')
for side, sign in [('L', -1), ('R', 1)]:
    for end, y in [('Front', front_y), ('Rear', rear_y)]:
        hip = (sign * hip_x, y, .98)
        knee = (sign * hip_x, y + (-.08 if end == 'Front' else .09), .52)
        ankle = (sign * hip_x, y + (-.15 if end == 'Front' else .15), .16)
        toe = (sign * hip_x, ankle[1] - .09, .08)
        add_bone(f'{end}Upper_{side}', hip, knee, 'Core')
        add_bone(f'{end}Lower_{side}', knee, ankle, f'{end}Upper_{side}')
        add_bone(f'{end}Paw_{side}', ankle, toe, f'{end}Lower_{side}')
bpy.ops.object.mode_set(mode='OBJECT')

mesh.parent = rig
modifier = mesh.modifiers.new('DZN quadruped skin', 'ARMATURE')
modifier.object = rig
groups = {part.name: mesh.vertex_groups.new(name=part.name) for part in rig_data.bones}


def distance(point, name):
    part = rig_data.bones[name]
    segment = part.tail_local - part.head_local
    t = max(0, min(1, (point - part.head_local).dot(segment) / segment.length_squared))
    return (point - part.head_local - t * segment).length


counts = {name: 0 for name in groups}
for vertex in mesh.data.vertices:
    p = vertex.co
    side = 'L' if p.x < 0 else 'R'
    if p.y < front_y - .23 and p.z > .73 and abs(p.x) < half_width * .76:
        candidates = ['Head', 'Core']
    elif p.y > rear_y + .20 and p.z > .72 and abs(p.x) < half_width * .64:
        candidates = ['Tail', 'Core']
    elif abs(p.x) > half_width * .36 and p.z < 1.12 and p.y < front_y + .28:
        candidates = [f'FrontUpper_{side}', f'FrontLower_{side}', f'FrontPaw_{side}']
    elif abs(p.x) > half_width * .36 and p.z < 1.12 and p.y > rear_y - .28:
        candidates = [f'RearUpper_{side}', f'RearLower_{side}', f'RearPaw_{side}']
    else:
        candidates = ['Core']
    nearest = sorted(candidates, key=lambda name: distance(p, name))[:2]
    strength = [1 / (distance(p, name) + .025) ** 5 for name in nearest]
    total = sum(strength)
    for name, value in zip(nearest, strength):
        groups[name].add([vertex.index], value / total, 'REPLACE')
        counts[name] += 1
assert all(counts[name] > 20 for name in counts if name != 'Tail'), counts


def rotate(name, angle, frame, axis=(1, 0, 0)):
    pose = rig.pose.bones[name]
    local_axis = pose.bone.matrix_local.to_3x3().inverted() @ Vector(axis)
    pose.rotation_mode = 'QUATERNION'
    pose.rotation_quaternion = Quaternion(local_axis, angle)
    pose.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=name)


def lift(height, frame):
    pose = rig.pose.bones['Core']
    pose.location.z = height
    pose.keyframe_insert(data_path='location', frame=frame, group='Core')


rig.animation_data_create()


def action(name):
    clip = bpy.data.actions.new(name)
    rig.animation_data.action = clip
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = Quaternion()
        bone.location = (0, 0, 0)
    return clip


action('DZN_Hound_Idle')
for frame in (1, 13, 25, 37, 49):
    phase = (frame - 1) * math.pi / 24
    lift(.008 * math.sin(phase), frame)
    rotate('Head', .035 * math.sin(phase), frame, (0, 0, 1))
    rotate('Tail', .14 * math.sin(phase * 1.5), frame, (0, 0, 1))
    for side in ('L', 'R'):
        for end in ('Front', 'Rear'):
            rotate(f'{end}Upper_{side}', 0, frame)
            rotate(f'{end}Lower_{side}', 0, frame)


def gait(name, frames, amplitude, bounce):
    action(name)
    for frame in frames:
        phase = (frame - 1) * 2 * math.pi / (frames[-1] - 1)
        lift(bounce * (1 - math.cos(2 * phase)) / 2, frame)
        rotate('Head', -.035 + .035 * math.sin(phase), frame)
        rotate('Tail', .12 * math.sin(phase), frame, (0, 0, 1))
        for end, side, offset in [('Front', 'L', 0), ('Rear', 'R', 0),
                                  ('Front', 'R', math.pi), ('Rear', 'L', math.pi)]:
            stride = math.sin(phase + offset)
            rotate(f'{end}Upper_{side}', amplitude * stride, frame)
            rotate(f'{end}Lower_{side}', max(0, -stride) * amplitude * .46, frame)
            rotate(f'{end}Paw_{side}', -max(0, -stride) * amplitude * .24, frame)


gait('DZN_Hound_Walk', (1, 4, 7, 10, 13, 16, 19, 22, 25), .29, .035)
gait('DZN_Hound_Run', (1, 3, 5, 7, 9, 11, 13, 15, 17), .46, .075)

action('DZN_Hound_Alert')
for frame, amount in ((1, 0), (7, 1), (19, 1), (29, 0)):
    lift(-.035 * amount, frame)
    rotate('Head', -.16 * amount, frame)
    rotate('Tail', .10 * amount, frame, (0, 0, 1))
    for side in ('L', 'R'):
        rotate(f'FrontUpper_{side}', -.08 * amount, frame)
        rotate(f'RearUpper_{side}', .06 * amount, frame)

action('DZN_Hound_Pounce')
for frame, reach, height in ((1, 0, 0), (5, -.2, -.04), (10, .65, .20),
                             (15, .40, .09), (21, -.10, -.02), (25, 0, 0)):
    lift(height, frame)
    rotate('Head', -.08 if reach > .3 else 0, frame)
    for side in ('L', 'R'):
        rotate(f'FrontUpper_{side}', -reach, frame)
        rotate(f'FrontLower_{side}', max(0, reach) * .16, frame)
        rotate(f'RearUpper_{side}', reach * .45, frame)
        rotate(f'RearLower_{side}', max(0, reach) * .15, frame)

rig.animation_data.action = bpy.data.actions['DZN_Hound_Walk']
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 49
bpy.context.scene.render.fps = 24
bpy.context.scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB', use_selection=True,
                          export_animations=True, export_animation_mode='ACTIONS',
                          export_nla_strips=False, export_apply=False)
print('DZN_HOUND_EXPORT', output_path, 'vertices', len(mesh.data.vertices),
      'weights', counts, 'actions', [item.name for item in bpy.data.actions])
