"""Render a Hound's idle, walking and pounce poses for visual review."""

import math
import sys

import bpy
from mathutils import Vector


source, output_prefix = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        obj.select_set(False)

world = bpy.data.worlds.new('Proof world')
bpy.context.scene.world = world
world.color = (.06, .07, .10)
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.045, .06, .075, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .7

bpy.ops.mesh.primitive_plane_add(size=200)
floor = bpy.context.object
floor.name = 'Proof floor'
floor.data.materials.clear()
mat = bpy.data.materials.new('Ground')
mat.diffuse_color = (.045, .075, .075, 1)
floor.data.materials.append(mat)
floor.location.z = -.06

def light(name, location, power, color):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.color = color
    data.shape = 'DISK'
    data.size = 4
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, 0, .8)) - obj.location).to_track_quat('-Z', 'Y').to_euler()

light('Key', (2.5, -3, 4), 850, (1, 1, 1))
light('Rim', (-2, 2, 3), 450, (.5, .75, 1))

cam_data = bpy.data.cameras.new('Proof camera')
cam = bpy.data.objects.new('Proof camera', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (3.4, -4.2, 2.6)
cam.rotation_euler = (Vector((0, 0, .86)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 4.4
bpy.context.scene.camera = cam
bpy.context.scene.render.engine = 'BLENDER_EEVEE'
bpy.context.scene.render.resolution_x = 620
bpy.context.scene.render.resolution_y = 620
bpy.context.scene.render.resolution_percentage = 100
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.context.scene.render.film_transparent = False
bpy.context.scene.render.fps = 24

for name, frame, suffix in [('DZN_Hound_Idle', 1, 'idle'),
                            ('DZN_Hound_Walk', 7, 'walk'),
                            ('DZN_Hound_Pounce', 10, 'pounce')]:
    rig.animation_data.action = bpy.data.actions[name]
    bpy.context.scene.frame_set(frame)
    bpy.context.scene.render.filepath = f'{output_prefix}-{suffix}.png'
    bpy.ops.render.render(write_still=True)
    print('DZN_HOUND_PROOF', bpy.context.scene.render.filepath)
