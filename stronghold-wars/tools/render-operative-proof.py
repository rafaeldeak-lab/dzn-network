"""Render one frame of a rigged operative for visual asset QA."""

import bpy
import math
import sys
from mathutils import Vector


source, target = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 720
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.view_settings.view_transform = 'AgX'
for obj in scene.objects:
    if obj.type == 'ARMATURE' and 'DZN_Operative_Walk' in bpy.data.actions:
        obj.animation_data_create()
        obj.animation_data.action = bpy.data.actions['DZN_Operative_Walk']
scene.frame_set(7)

camera_data = bpy.data.cameras.new('QA Camera')
camera = bpy.data.objects.new('QA Camera', camera_data)
scene.collection.objects.link(camera)
camera.location = (2.8, -4.0, 2.1)
target_point = Vector((0, 0, .95))
camera.rotation_euler = (target_point - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 2.8
scene.camera = camera

for name, location, energy, size in [
    ('Key', (1.5, -2.5, 3.5), 900, 3),
    ('Fill', (-2, -1, 2.2), 650, 4),
    ('Rim', (0, 2, 3), 1200, 2),
]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.shape = 'DISK'
    data.size = size
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (target_point - obj.location).to_track_quat('-Z', 'Y').to_euler()

scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = target
bpy.ops.render.render(write_still=True)
print('DZN_OPERATIVE_PROOF', target)
