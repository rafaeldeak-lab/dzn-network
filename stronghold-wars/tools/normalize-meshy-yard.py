"""Fit the owner's Meshy yard shell to the existing DZN animated machinery.

Run with Blender in the background and pass source GLB, existing yard GLB,
output GLB, and optional preview PNG after `--`.
"""

import re
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


def world_bounds(objects):
    corners = [obj.matrix_world @ Vector(corner) for obj in objects if obj.type == 'MESH' for corner in obj.bound_box]
    if not corners:
        raise RuntimeError('GLB has no mesh bounds')
    low = Vector(tuple(min(p[i] for p in corners) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in corners) for i in range(3)))
    return low, high


source, old_yard, output, *preview = sys.argv[sys.argv.index('--') + 1:]
level_match = re.search(r'timberline_v4_l0([1-5])\.glb$', old_yard, re.IGNORECASE)
if not level_match:
    raise RuntimeError('Expected one of the existing five Timberline level models')
level = int(level_match.group(1))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)
shell = list(bpy.context.scene.objects)
low, high = world_bounds(shell)
width = high.x - low.x
scale = 6.5 / width
centre = (low + high) / 2
for obj in shell:
    if obj.parent is None:
        obj.matrix_world = (Matrix.Translation(Vector((-centre.x * scale,
                                                       -centre.y * scale,
                                                       -low.z * scale)))
                            @ Matrix.Scale(scale, 4) @ obj.matrix_world)
bpy.context.view_layer.update()
low, high = world_bounds(shell)
if not 6.49 <= high.x - low.x <= 6.51 or abs(low.z) > 0.02:
    raise RuntimeError(f'Unusable shell bounds: {tuple(low)} {tuple(high)}')

# The L3 generated cage closed the entire front portal as one textured sheet.
# Remove only the sheet inside the steel portal so the retained working saw
# remains visible. Keep the structural side posts and roof above this window.
if level == 3:
    removed = 0
    for obj in shell:
        if obj.type != 'MESH':
            continue
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        portal_faces = []
        for face in bm.faces:
            position = obj.matrix_world @ face.calc_center_median()
            if abs(position.x) < 1.85 and position.y < -1.45 and 0.24 < position.z < 1.92:
                portal_faces.append(face)
        removed += len(portal_faces)
        bmesh.ops.delete(bm, geom=portal_faces, context='FACES')
        bm.to_mesh(obj.data)
        bm.free()
    if removed < 50:
        raise RuntimeError(f'Expected a front cage sheet, removed only {removed} faces')
    print('DZN_OPEN_BAY_REMOVED_FACES', removed)

bpy.ops.import_scene.gltf(filepath=old_yard)
old_objects = set(bpy.context.scene.objects) - set(shell)
names = ('saw_carriage', 'saw_rotor', 'saw_safety_light', 'conveyor_roller_0',
         'conveyor_roller_10', 'conveyor_roller_20', 'conveyor_roller_30')
names += tuple(name for unlock, name in [(2, 'hydraulic_sorter'),
                                          (3, 'loading_crane_hook'),
                                          (4, 'auto_feed_motor'),
                                          (5, 'elite_yard_beacon')] if level >= unlock)
roots = [obj for obj in old_objects if obj.name in names]
if len(roots) != len(names):
    raise RuntimeError(f'Moving machinery incomplete: {[obj.name for obj in roots]}')
keep = set(roots)
for root in roots:
    keep.update(root.children_recursive)
for root in roots:
    if root.parent not in keep:
        transform = root.matrix_world.copy()
        root.parent = None
        root.matrix_world = transform
roller_finish = bpy.data.materials.new('DZN graphite conveyor steel')
roller_finish.diffuse_color = (0.09, 0.11, 0.115, 1)
roller_finish.use_nodes = True
surface = roller_finish.node_tree.nodes.get('Principled BSDF')
surface.inputs['Base Color'].default_value = (0.09, 0.11, 0.115, 1)
surface.inputs['Metallic'].default_value = 0.18
surface.inputs['Roughness'].default_value = 0.88
for material in bpy.data.materials:
    if material.name not in ('Material_3', 'Material_4') or not material.use_nodes:
        continue
    finish = material.node_tree.nodes.get('Principled BSDF')
    if finish:
        finish.inputs['Metallic'].default_value = 0.2
        finish.inputs['Roughness'].default_value = 0.85
for root in roots:
    if root.name.startswith('conveyor_roller_'):
        root.location.y += 0.42
        for obj in [root] + root.children_recursive:
            if obj.type == 'MESH':
                obj.data.materials.clear()
                obj.data.materials.append(roller_finish)
    elif root.name == 'elite_yard_beacon':
        # The new roof is lower than the former L5 kit; seat its signal lamp.
        root.location.z -= 2.16
bpy.context.view_layer.update()
print('DZN_MACHINE_BOUNDS', {root.name: [list(v) for v in world_bounds([root] + root.children_recursive)]
                             for root in roots})
for obj in list(old_objects - keep):
    bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.object.select_all(action='DESELECT')
for obj in list(shell) + list(keep):
    obj.select_set(True)
bpy.context.view_layer.objects.active = shell[0]
bpy.ops.export_scene.gltf(filepath=output, export_format='GLB', use_selection=True,
                          export_apply=True, export_image_format='AUTO')
print('DZN_MESHY_YARD', {'shell_bounds': [list(low), list(high)],
                         'machine_roots': sorted(obj.name for obj in roots),
                         'output': output})

if preview:
    camera_data = bpy.data.cameras.new('review_camera')
    camera = bpy.data.objects.new('review_camera', camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (10, -12, 9)
    target = Vector((0, 0, 1.4))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 11
    bpy.context.scene.camera = camera
    for name, loc, power, size in [
        ('key', (3, -4, 9), 1800, 7), ('fill', (-6, 4, 6), 1100, 6)]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = power
        data.shape = 'DISK'
        data.size = size
        light = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(light)
        light.location = loc
        light.rotation_euler = (target - light.location).to_track_quat('-Z', 'Y').to_euler()
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = preview[0]
    bpy.ops.render.render(write_still=True)
