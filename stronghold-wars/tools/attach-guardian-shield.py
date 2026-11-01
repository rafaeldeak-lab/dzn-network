"""Bind a tiered 3D Guardian barrier shield to a Meshy humanoid hand.

blender --background --python attach-guardian-shield.py -- rig.glb out.glb tier
The shield is separate geometry with full hand weights, so it stays gripped
through walk, run and defensive poses. Never merge it into the body texture.
"""

import bpy
import sys
from mathutils import Matrix, Quaternion, Vector


source, output, level_arg = sys.argv[sys.argv.index('--') + 1:][:3]
level = int(level_arg)
assert 1 <= level <= 5
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
hand = 'mixamorig:LeftHand'
assert hand in rig.data.bones
for obj in list(bpy.context.scene.objects):
    if obj.type == 'MESH' and not obj.find_armature():
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.context.scene.frame_set(1)


def material(name, color, metal=0, rough=.42, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (*color, 1)
    node.inputs['Metallic'].default_value = metal
    node.inputs['Roughness'].default_value = rough
    if emission:
        node.inputs['Emission Color'].default_value = (*color, 1)
        node.inputs['Emission Strength'].default_value = emission
    return mat


carbon = material('DZN_Guardian_Carbon', (.035, .038, .046), .58, .42)
steel = material('DZN_Guardian_Gunmetal', (.18, .19, .22), .8, .3)
edge = material('DZN_Guardian_Titanium', (.38, .4, .43), .84, .27)
violet = material('DZN_Guardian_Violet', (.27, .075, .46), .68, .34)
lime = material('DZN_Guardian_Barrier_Lime', (.58, 1, .045), .3, .23, 1.7)
created = []


def bind(obj, mat, name, bevel=0):
    obj.name = name
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('Machined bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        normal = obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=normal.name)
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.parent = rig
    obj.vertex_groups.new(name=hand).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    arm = obj.modifiers.new('Hand-bound shield', 'ARMATURE')
    arm.object = rig
    created.append(obj)
    return obj


def box(name, center, size, mat, bevel=.009):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return bind(obj, mat, name, bevel)


def rod(name, start, end, radius, mat):
    a, b = Vector(start), Vector(end)
    axis = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=axis.length,
                                        location=(a + b) / 2)
    obj = bpy.context.object
    obj.rotation_euler = axis.to_track_quat('Z', 'Y').to_euler()
    return bind(obj, mat, name, .005)


def plate(name, x, y, z, width, height, depth, mat, taper=.1, bevel=.014):
    # Eight-sided armored panel with a beveled silhouette, extruded in depth.
    hw, hh = width / 2, height / 2
    contour = [(-hw + taper, -hh), (hw - taper, -hh), (hw, -hh + taper),
               (hw, hh - taper), (hw - taper, hh), (-hw + taper, hh),
               (-hw, hh - taper), (-hw, -hh + taper)]
    verts = [(x + dx, yy, z + dz) for yy in (y - depth / 2, y + depth / 2)
             for dx, dz in contour]
    count = len(contour)
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, 2 * count))]
    faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count)
              for i in range(count)]
    mesh = bpy.data.meshes.new(name + '_geometry')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return bind(obj, mat, name, bevel)


center_x = .82
center_z = .92
width = .47 + .035 * (level - 1)
height = 1.06 + .055 * (level - 1)
front_y = -.255
plate('barrier_shield', center_x, -.20, center_z, width, height, .075,
      carbon, taper=.12, bevel=.017)
plate('Guardian_violet_blast_core', center_x, front_y, center_z,
      width * .71, height * .71, .026, violet, taper=.1, bevel=.012)
plate('Guardian_titanium_spine', center_x, front_y - .024, center_z,
      .075, height * .79, .022, steel, taper=.025, bevel=.007)

for sign, label in ((-1, 'left'), (1, 'right')):
    side_x = center_x + sign * (width * .39)
    rod(f'Guardian_{label}_rim', (side_x, front_y - .035, center_z - height * .36),
        (side_x, front_y - .035, center_z + height * .36), .019, edge)
    rod(f'Guardian_{label}_barrier_strip',
        (side_x - sign * .035, front_y - .061, center_z - height * .31),
        (side_x - sign * .035, front_y - .061, center_z + height * .31),
        .008 + .001 * level, lime)
    if level >= 3:
        plate(f'Guardian_{label}_reinforced_wing', center_x + sign * (width * .43),
              front_y + .005, center_z, .13, height * .55, .043,
              steel if level == 3 else violet, taper=.04, bevel=.009)
    if level >= 5:
        plate(f'Guardian_{label}_elite_fin', center_x + sign * (width * .58),
              front_y + .018, center_z + height * .12, .1, height * .44, .044,
              violet, taper=.035, bevel=.009)

for vertical in (-1, 1):
    z = center_z + vertical * (height * .39)
    rod(f'Guardian_crossbrace_{vertical}', (center_x - width * .35, front_y - .039, z),
        (center_x + width * .35, front_y - .039, z), .016, steel)
    if level >= 2:
        box(f'Guardian_energy_socket_{vertical}',
            (center_x, front_y - .061, z), (.075, .018, .034), lime, .004)

# The rear handle reaches the actual left glove. The hard shield face remains
# offset outward, so the torso and legs are visible in the isometric camera.
rod('Guardian_shield_grip', (.57, -.045, 1.02), (.68, -.14, 1.02), .026, steel)
box('Guardian_shield_glove_socket', (.59, -.067, 1.02), (.085, .075, .11), carbon)
if level >= 4:
    for z in (center_z - .21, center_z + .21):
        plate(f'Guardian_command_plate_{z:.2f}', center_x, front_y - .057,
              z, width * .5, .14, .018, violet, taper=.025, bevel=.006)
if level == 5:
    rod('Guardian_elite_energy_spine', (center_x, front_y - .075, center_z - .34),
        (center_x, front_y - .075, center_z + .34), .009, lime)

def carry_motion(source_name, target_name):
    # Preserve Meshy's leg, torso and free-arm movement while keeping the heavy
    # shield arm on its carrying grip. Unmodified walk clips swing the shield
    # through the Guardian's knees at the most visible isometric angles.
    source_action = bpy.data.actions.get(source_name)
    assert source_action, source_name
    rig.animation_data_create()
    rig.animation_data.action = source_action
    frames = range(0, 27 if source_name == 'Walking' else 18)
    sampled = []
    for frame in frames:
        bpy.context.scene.frame_set(frame)
        sampled.append({bone.name: (bone.rotation_quaternion.copy(), bone.location.copy())
                        for bone in rig.pose.bones})
    action = bpy.data.actions.new(target_name)
    rig.animation_data.action = action
    for frame, poses in zip(frames, sampled):
        bpy.context.scene.frame_set(frame)
        for bone in rig.pose.bones:
            rotation, location = poses[bone.name]
            bone.rotation_mode = 'QUATERNION'
            bone.rotation_quaternion = (Quaternion((1, 0, 0, 0))
                                        if bone.name in ('mixamorig:LeftShoulder', 'mixamorig:LeftArm', 'mixamorig:LeftForeArm')
                                        else rotation)
            bone.location = location
            bone.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=bone.name)
            bone.keyframe_insert(data_path='location', frame=frame, group=bone.name)
    bpy.data.actions.remove(source_action)


carry_motion('Walking', 'DZN_Guardian_Walk')
carry_motion('Running', 'DZN_Guardian_Run')


def authored_pose(name, guarding=False):
    action = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame in (1, 25, 49):
        bpy.context.scene.frame_set(frame)
        for bone in rig.pose.bones:
            bone.rotation_mode = 'QUATERNION'
            bone.rotation_quaternion = Quaternion((1, 0, 0, 0))
            if bone.name == 'mixamorig:Spine2' and not guarding:
                bone.rotation_quaternion = Quaternion(Vector((1, 0, 0)), .014 if frame == 25 else 0)
            if guarding and bone.name == 'mixamorig:LeftArm':
                bone.rotation_quaternion = Quaternion(Vector((1, 0, 0)), .62 if frame == 25 else .52)
            if guarding and bone.name == 'mixamorig:LeftForeArm':
                bone.rotation_quaternion = Quaternion(Vector((1, 0, 0)), .22 if frame == 25 else .18)
            bone.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=bone.name)
            bone.location = (0, 0, 0)
            bone.keyframe_insert(data_path='location', frame=frame, group=bone.name)
    return action


authored_pose('DZN_Guardian_Idle')
authored_pose('DZN_Guardian_Block', guarding=True)
rig.animation_data.action = bpy.data.actions.get('DZN_Guardian_Walk')
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
print('DZN_GUARDIAN_SHIELD', output, 'level', level, 'parts', len(created), flush=True)
