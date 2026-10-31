"""Add a separate, hand-bound 3D tool to a clean Meshy DZN Fixer rig.

Usage: blender --background --python attach-fixer-axe.py -- input.glb output.glb 1
The axe is made of independent geometry so a moving arm never pulls its head
or shaft away from the operative's glove.
"""

import bpy
import sys
from mathutils import Matrix, Quaternion, Vector


source_path, output_path, tier_arg = sys.argv[sys.argv.index('--') + 1:][:3]
tier = int(tier_arg)
assert 1 <= tier <= 5
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source_path)
armature = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
hand_bone = 'mixamorig:LeftHand' if 'mixamorig:LeftHand' in armature.data.bones else 'Hand_L'
assert hand_bone in armature.data.bones
# Meshy's animation preview includes a display helper sphere. It is not part
# of the operative and would otherwise appear in the game scene.
for obj in list(bpy.context.scene.objects):
    if obj.type == 'MESH' and not obj.find_armature():
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.context.scene.frame_set(1)


def material(name, color, metallic=0, roughness=.5, glow=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    pbr = mat.node_tree.nodes.get('Principled BSDF')
    pbr.inputs['Base Color'].default_value = (*color, 1)
    pbr.inputs['Metallic'].default_value = metallic
    pbr.inputs['Roughness'].default_value = roughness
    if glow:
        pbr.inputs['Emission Color'].default_value = (*color, 1)
        pbr.inputs['Emission Strength'].default_value = glow
    return mat


grip = material('DZN_Fixer_Grip', (.035, .036, .041), .1, .82)
steel = material('DZN_Fixer_Brushed_Steel', (.17, .18, .19), .85, .3)
edge = material('DZN_Fixer_Edge', (.38, .42, .43), .8, .24)
orange = material('DZN_Fixer_Engineering_Orange', (.92, .29, .025), .5, .34, .65 if tier > 2 else 0)
purple = material('DZN_Fixer_Elite_Purple', (.36, .12, .62), .55, .3, .9 if tier == 5 else 0)
created = []


def skin(obj, mat, name):
    obj.name = name
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.parent = armature
    if hand_bone != 'Hand_L':
        # Meshy uses the opposite screen-side convention and its rig is 1.7 m.
        # Reflect the authored left-hand tool into its positive-X glove.
        for vertex in obj.data.vertices:
            vertex.co.x = -vertex.co.x - .09
            vertex.co.z -= .03
        obj.data.flip_normals()
    obj.vertex_groups.new(name=hand_bone).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    modifier = obj.modifiers.new('DZN hand attachment', 'ARMATURE')
    modifier.object = armature
    created.append(obj)
    return obj


def rod(name, start, end, radius, mat, vertices=12):
    start, end = Vector(start), Vector(end)
    axis = end - start
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=axis.length,
                                        location=(start + end) / 2)
    obj = bpy.context.object
    obj.rotation_euler = axis.to_track_quat('Z', 'Y').to_euler()
    bevel = obj.modifiers.new('Machined edge', 'BEVEL')
    bevel.width = min(radius * .22, .008)
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return skin(obj, mat, name)


# The Hand_L rest bone runs from x=-.52, z=.98 to x=-.59, z=.87.
# Put the carrying glove over the wrapped portion of the tool and aim the
# axe head away from the legs. Every vertex is bound rigidly to Hand_L.
top = Vector((-.53, -.03, 1.06))
bottom = Vector((-.76, -.09, .59))
rod('Fixer_axe_shaft', top, bottom, .018 + (tier - 1) * .001, steel)
rod('Fixer_axe_grip', (-.58, -.043, .96), (-.67, -.066, .77), .023, grip, 16)
for fraction in (.2, .48, .76):
    center = Vector((-.58, -.043, .96)).lerp(Vector((-.67, -.066, .77)), fraction)
    rod(f'Fixer_grip_band_{fraction}', center + Vector((0, 0, .005)),
        center - Vector((0, 0, .005)), .025, orange, 16)

# Bevelled side-profile makes the blade read as a proper metal tool even at
# game camera distance. Increasing tiers add a longer cutting face.
blade_span = .17 + (tier - 1) * .012
front = Vector((-.77, -.09, .59))
profile = [
    (.042, .034), (-.025, .050), (-blade_span * .58, .083),
    (-blade_span * .94, .145), (-blade_span * 1.19, .158),
    (-blade_span * 1.24, -.158), (-blade_span * .94, -.145),
    (-blade_span * .58, -.083), (-.025, -.050), (.042, -.034),
]
verts = [(front.x + dx, front.y + depth, front.z + dz)
         for depth in (-.021, .021) for dx, dz in profile]
count = len(profile)
faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, 2 * count))]
faces += [(index, (index + 1) % count, (index + 1) % count + count, index + count)
          for index in range(count)]
mesh = bpy.data.meshes.new('DZN_Fixer_Axe_Head_Geometry')
mesh.from_pydata(verts, [], faces)
mesh.update()
head = bpy.data.objects.new('DZN_Fixer_Axe_Head', mesh)
bpy.context.collection.objects.link(head)
bevel = head.modifiers.new('Forged bevel', 'BEVEL')
bevel.width = .008
bevel.segments = 2
bpy.context.view_layer.objects.active = head
bpy.ops.object.modifier_apply(modifier=bevel.name)
skin(head, steel if tier <= 2 else purple if tier == 5 else edge, 'Fixer_axe_head')

rod('Fixer_cutting_edge', (front.x - blade_span * 1.19, front.y, front.z + .151),
    (front.x - blade_span * 1.24, front.y, front.z - .151),
    .006 + tier * .0006, edge, 10)
if tier >= 2:
    rod('Fixer_head_accent', (front.x - .075, front.y - .027, front.z + .04),
        (front.x - .11, front.y - .027, front.z - .025), .005, orange, 8)
if tier >= 3:
    rod('Fixer_reinforced_socket', (-.72, -.09, .66), (-.78, -.09, .54), .033, steel, 12)
if tier >= 4:
    rod('Fixer_power_conduit', (-.55, -.06, 1.03), (-.73, -.105, .66), .007, orange, 8)
if tier == 5:
    rod('Fixer_elite_power_stripe', (-.76, -.119, .60),
        (-.91, -.119, .61), .008, purple, 8)

if hand_bone != 'Hand_L':
    for action in bpy.data.actions:
        if action.name == 'Walking':
            action.name = 'DZN_Operative_Walk'
        elif action.name == 'Running':
            action.name = 'DZN_Operative_Run'
    # A real in-place idle is required by both the squad and patrol systems.
    # Key every bone so changing from walk to idle resets the entire pose.
    idle = bpy.data.actions.new('DZN_Operative_Idle')
    armature.animation_data_create()
    armature.animation_data.action = idle
    for frame in (1, 25, 49):
        bpy.context.scene.frame_set(frame)
        for part in armature.pose.bones:
            part.rotation_mode = 'QUATERNION'
            part.rotation_quaternion = Quaternion((1, 0, 0, 0))
            if part.name == 'mixamorig:Spine2':
                part.rotation_quaternion = Quaternion(Vector((1, 0, 0)), .018 if frame == 25 else 0)
            part.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=part.name)
            part.location = (0, 0, 0)
            part.keyframe_insert(data_path='location', frame=frame, group=part.name)
    armature.animation_data.action = bpy.data.actions.get('DZN_Operative_Walk')
    bpy.context.scene.frame_set(1)

bpy.ops.object.select_all(action='DESELECT')
armature.select_set(True)
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        obj.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB', use_selection=True,
                          export_animations=True, export_animation_mode='ACTIONS',
                          export_nla_strips=False, export_apply=False)
print('DZN_FIXER_TOOL', output_path, 'tier', tier, 'components', len(created), flush=True)
