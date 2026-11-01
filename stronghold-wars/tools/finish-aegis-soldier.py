"""Preserve Meshy walk/run and add authored idle and drone-command clips.

blender --background --python finish-aegis-soldier.py -- INPUT.glb OUTPUT.glb
"""

import bpy
import sys
from mathutils import Quaternion, Vector


source, output = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
assert 'mixamorig:LeftArm' in rig.pose.bones
assert 'mixamorig:RightArm' in rig.pose.bones
walk = bpy.data.actions.get('Walking')
run = bpy.data.actions.get('Running')
assert walk and run, 'Meshy must provide both walking and running'
walk.name = 'DZN_Aegis_Walk'
run.name = 'DZN_Aegis_Run'


def pose_action(name, command=False):
    action = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame in (1, 14, 27, 40, 53):
        bpy.context.scene.frame_set(frame)
        phase = (frame - 1) / 52
        pulse = 1 if frame in (14, 40) else 0
        for bone in rig.pose.bones:
            bone.rotation_mode = 'QUATERNION'
            angle = 0
            axis = Vector((1, 0, 0))
            if bone.name == 'mixamorig:Spine2':
                angle = (.018 if not command else .055) * pulse
            elif bone.name == 'mixamorig:Head':
                axis = Vector((0, 0, 1))
                angle = (.06 if command else .025) * (1 if phase < .5 else -1)
            elif command and bone.name == 'mixamorig:LeftArm':
                angle = .30 + .20 * pulse
            elif command and bone.name == 'mixamorig:LeftForeArm':
                angle = .10 + .18 * pulse
            elif command and bone.name == 'mixamorig:RightArm':
                angle = .14 + .13 * pulse
            elif command and bone.name == 'mixamorig:RightForeArm':
                angle = .22 + .16 * pulse
            bone.rotation_quaternion = Quaternion(axis, angle)
            bone.location = (0, 0, 0)
            bone.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=bone.name)
            bone.keyframe_insert(data_path='location', frame=frame, group=bone.name)


pose_action('DZN_Aegis_Idle')
pose_action('DZN_Aegis_Command', command=True)
rig.animation_data.action = walk
bpy.context.scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=output, export_format='GLB', use_selection=True,
                          export_animations=True, export_animation_mode='ACTIONS',
                          export_nla_strips=False, export_apply=False)
print('DZN_AEGIS_SOLDIER', output, flush=True)
