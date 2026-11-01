"""Keep Meshy locomotion and author idle and snare-deploy actions for a Trapper.

blender --background --python finish-trapper-soldier.py -- INPUT.glb OUTPUT.glb
"""

import bpy
import sys
from mathutils import Quaternion, Vector


source, output = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
for bone in ('mixamorig:LeftArm', 'mixamorig:RightArm', 'mixamorig:RightHand'):
    assert bone in rig.pose.bones, f'Missing humanoid bone: {bone}'
walk = bpy.data.actions.get('Walking')
run = bpy.data.actions.get('Running')
assert walk and run, 'Meshy must provide walking and running'
walk.name = 'DZN_Trapper_Walk'
run.name = 'DZN_Trapper_Run'


def pose_action(name, deploy=False):
    action = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame in (1, 11, 23, 35, 47):
        bpy.context.scene.frame_set(frame)
        pulse = 1 if frame in (11, 35) else 0
        for bone in rig.pose.bones:
            bone.rotation_mode = 'QUATERNION'
            angle = 0
            axis = Vector((1, 0, 0))
            if bone.name == 'mixamorig:Spine2':
                angle = (.025 if not deploy else -.10) * pulse
            elif bone.name == 'mixamorig:Head':
                axis = Vector((0, 0, 1))
                angle = (.035 if frame < 24 else -.035) if not deploy else -.09
            elif deploy and bone.name == 'mixamorig:RightArm':
                angle = -.38 - .36 * pulse
            elif deploy and bone.name == 'mixamorig:RightForeArm':
                angle = -.38 - .43 * pulse
            elif deploy and bone.name == 'mixamorig:LeftArm':
                angle = -.12 - .16 * pulse
            elif deploy and bone.name == 'mixamorig:RightHand':
                angle = -.12 - .30 * pulse
            bone.rotation_quaternion = Quaternion(axis, angle)
            bone.location = (0, 0, 0)
            bone.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=bone.name)
            bone.keyframe_insert(data_path='location', frame=frame, group=bone.name)


pose_action('DZN_Trapper_Idle')
pose_action('DZN_Trapper_Deploy', deploy=True)
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
print('DZN_TRAPPER_SOLDIER', output, flush=True)
