"""Build five small, game-ready DZN Aegis interceptor drones.

blender --background --python build-aegis-drones.py -- OUTPUT_DIRECTORY
The drones remain separate from the humanoid rig. Three.js moves the complete
drone and spins the named fan pivots, so both craft can react independently.
"""

import bpy
import math
import sys
from pathlib import Path
from mathutils import Vector


out_dir = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
out_dir.mkdir(parents=True, exist_ok=True)


def material(name, color, metallic=0, roughness=.38, glow=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    if glow:
        shader.inputs['Emission Color'].default_value = (*color, 1)
        shader.inputs['Emission Strength'].default_value = glow
    return mat


def finish(obj, name, mat, parent, bevel=0):
    obj.name = name
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('DZN machined edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        normal = obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=normal.name)
    return obj


def plate(name, outline, z0, z1, mat, parent, bevel=.007):
    n = len(outline)
    verts = [(x, y, z) for z in (z0, z1) for x, y in outline]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mesh = bpy.data.meshes.new(name + '_mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, parent, bevel)


def cube(name, pos, scale, mat, parent, bevel=.006):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, parent, bevel)


def sphere(name, pos, radius, mat, parent, segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings,
                                         radius=radius, location=pos)
    return finish(bpy.context.object, name, mat, parent)


def rod(name, start, end, radius, mat, parent):
    a, b = Vector(start), Vector(end)
    axis = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius,
                                        depth=axis.length, location=(a + b) / 2)
    obj = bpy.context.object
    obj.rotation_euler = axis.to_track_quat('Z', 'Y').to_euler()
    return finish(obj, name, mat, parent, .003)


def torus(name, pos, major, minor, mat, parent):
    bpy.ops.mesh.primitive_torus_add(major_segments=24, minor_segments=8,
                                     location=pos, major_radius=major,
                                     minor_radius=minor)
    return finish(bpy.context.object, name, mat, parent)


for tier in range(1, 6):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    carbon = material('DZN carbon', (.028, .033, .045), .58, .4)
    gunmetal = material('DZN machined gunmetal', (.105, .115, .14), .79, .29)
    edge = material('DZN titanium edges', (.36, .39, .43), .86, .26)
    violet = material('DZN violet armour', (.19 + tier * .015, .045, .36 + tier * .018), .68, .34)
    lime = material('DZN lime optics', (.48, 1, .015), .22, .2, 2.0)
    blue = material('DZN interceptor exhaust', (.18, .72, 1), .12, .2, 1.3)
    bpy.ops.object.empty_add(type='PLAIN_AXES')
    root = bpy.context.object
    root.name = 'DZN_Aegis_Drone'
    shell = [(-.17, -.17), (-.09, -.27), (.09, -.27), (.17, -.17),
             (.19, .08), (.10, .20), (-.10, .20), (-.19, .08)]
    plate('carbon_hull', shell, -.045, .11, carbon, root, .014)
    plate('upper_violet_armour', [(-.12, -.145), (0, -.20), (.12, -.145),
                                  (.14, .055), (.06, .15), (-.06, .15), (-.14, .055)],
          .108, .13, violet, root, .007)
    plate('nose_sensor_frame', [(-.075, -.255), (.075, -.255), (.055, -.21), (-.055, -.21)],
          .015, .095, edge, root, .006)
    sphere('interceptor_eye', (0, -.261, .06), .046 + tier * .003, lime, root)
    for sign, label in ((-1, 'left'), (1, 'right')):
        wing = [(sign * .13, -.13), (sign * .32, -.235), (sign * .46, -.195),
                (sign * .39, -.04), (sign * .22, .07)]
        plate(f'{label}_swept_wing', wing, -.02, .085, gunmetal, root, .009)
        panel = [(sign * .20, -.12), (sign * .34, -.19), (sign * .39, -.16),
                 (sign * .32, -.045), (sign * .21, .005)]
        plate(f'{label}_violet_wing_panel', panel, .085, .102, violet, root, .005)
        rod(f'{label}_power_conduit', (sign * .20, -.06, .106),
            (sign * .34, -.125, .106), .008, lime, root)
        plate(f'{label}_rear_fin', [(sign * .12, .10), (sign * .29, .22),
                                    (sign * .34, .34), (sign * .18, .25)],
              .0, .075, violet if tier >= 2 else gunmetal, root, .006)
        sphere(f'{label}_wing_light', (sign * .35, -.175, .105), .019, lime, root)
        bpy.ops.object.empty_add(type='PLAIN_AXES', location=(sign * .35, .055, .035))
        rotor = bpy.context.object
        rotor.name = f'drone_rotor_{label}'
        rotor.parent = root
        torus(f'{label}_duct', (sign * .35, .055, .035), .076, .014, edge, rotor)
        sphere(f'{label}_motor', (sign * .35, .055, .035), .025, gunmetal, rotor)
        for blade in range(3):
            angle = blade * math.tau / 3
            start = (sign * .35 + math.cos(angle) * .025,
                     .055 + math.sin(angle) * .025, .035)
            end = (sign * .35 + math.cos(angle) * .068,
                   .055 + math.sin(angle) * .068, .035)
            rod(f'{label}_fan_{blade}', start, end, .007, carbon, rotor)
        sphere(f'{label}_exhaust', (sign * .21, .12, -.04), .032, blue, root)
        if tier >= 3:
            rod(f'{label}_aerial', (sign * .12, .16, .11),
                (sign * .13, .20, .20 + .018 * tier), .011, gunmetal, root)
            sphere(f'{label}_aerial_tip', (sign * .13, .20, .20 + .018 * tier), .018, lime, root)
        if tier >= 4:
            plate(f'{label}_armour_chevron', [(sign * .19, -.13), (sign * .28, -.18),
                                             (sign * .35, -.14), (sign * .26, -.07)],
                  .102, .13, violet, root, .005)
        if tier == 5:
            rod(f'{label}_elite_rail', (sign * .15, -.19, .14),
                (sign * .30, -.15, .14), .011, lime, root)
            plate(f'{label}_elite_winglet', [(sign * .37, -.15), (sign * .51, -.22),
                                             (sign * .46, -.08), (sign * .38, .0)],
                  -.01, .07, violet, root, .006)
    if tier >= 2:
        cube('dorsal_signal_plate', (0, .1, .145), (.12, .10, .027), gunmetal, root)
        for sign in (-1, 1):
            sphere(f'dorsal_indicator_{sign}', (sign * .045, .1, .165), .014, lime, root)
    if tier >= 5:
        torus('elite_energy_iris', (0, -.247, .06), .057, .007, lime, root)

    bpy.ops.object.select_all(action='SELECT')
    output = out_dir / f'aegis_drone_l0{tier}.glb'
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB',
                              export_animations=False, export_apply=False)
    triangles = sum(len(obj.data.polygons) for obj in bpy.context.scene.objects if obj.type == 'MESH')
    print('DZN_AEGIS_DRONE', tier, output, 'faces', triangles, flush=True)
