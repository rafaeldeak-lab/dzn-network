"""Build the five original DZN wall tiers as compact, textured GLBs.

Run from the repository root with Blender 5.x in background mode. One unit is
1.94 m wide and sits on the game's 2 m placement grid. Walls are static;
upgrade feedback is provided by the game scene rather than baked animation.
"""

from pathlib import Path
import hashlib
import json
import math
import bpy


ROOT = Path.cwd() / "stronghold-wars" / "preview"
OUTPUT = ROOT / "assets" / "models" / "walls"
TEXTURES = ROOT / "assets" / "textures" / "timberline"


def material(name, color, metallic=0, roughness=0.7, texture=None, emission=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if texture:
        image = bpy.data.images.load(str(TEXTURES / texture), check_existing=True)
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        mat.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.8
    return mat


def cube(name, location, size, mat, bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("soft_machined_edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        normals = obj.modifiers.new("weighted_face_normals", "WEIGHTED_NORMAL")
        bpy.ops.object.modifier_apply(modifier=normals.name)
    return obj


def cylinder(name, location, radius, depth, mat, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new("machined_rim", "BEVEL")
    bevel.width = min(0.018, depth / 5)
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def make_level(tier):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for old_material in list(bpy.data.materials):
        bpy.data.materials.remove(old_material)
    mats = {
        "timber": material("weathered_reclaimed_pine", (0.57, 0.36, 0.21), roughness=0.93,
                           texture="weathered-pine.jpg"),
        "armor": material("scratched_DZN_armor", (0.2, 0.23, 0.23), metallic=0.6, roughness=0.52,
                          texture="weathered-metal.jpg"),
        "frame": material("blackened_structural_steel", (0.12, 0.14, 0.15), metallic=0.68, roughness=0.44),
        "concrete": material("dark_foundation", (0.33, 0.34, 0.32), roughness=0.91),
        "purple": material("DZN_violet_powdercoat", (0.31, 0.13, 0.46), metallic=0.45, roughness=0.34),
        "lime": material("DZN_lime_power_channel", (0.46, 0.88, 0.16), metallic=0.24,
                         roughness=0.27, emission=(0.34, 0.84, 0.07)),
        "silver": material("machined_fasteners", (0.57, 0.62, 0.58), metallic=0.78, roughness=0.35),
    }
    m = mats
    height = [0, 1.56, 1.70, 1.86, 2.05, 2.24][tier]
    cube("continuous_foundation", (0, 0, 0.085), (1.94, 0.76, 0.17), m["concrete"], 0.04)
    cube("rear_steel_chassis", (0, 0.06, height * 0.48), (1.85, 0.29, height - 0.25), m["frame"], 0.06)
    # Keep the centre filled at every level. The previous L1/L2 models read
    # as isolated posts when a row was viewed from normal gameplay distance.
    if tier <= 2:
        for i in range(5):
            x = (i - 2) * 0.37
            top = height - (0.06 if i % 2 else 0)
            cube(f"pine_panel_{i}", (x, -0.135, top * 0.51), (0.385, 0.30, top - 0.17), m["timber"], 0.035)
            for z in (0.49, 1.25):
                cylinder(f"panel_rivet_{i}_{z}", (x, -0.325, z), 0.035, 0.025, m["silver"], 10)
        for z in (0.46, 1.26):
            cube(f"cross_brace_{z}", (0, -0.31, z), (1.9, 0.12, 0.11), m["armor"], 0.025)
        for x in (-0.88, 0.88):
            cube(f"reinforced_terminal_{x}", (x, 0, height * 0.5),
                 (0.16, 0.53, height - 0.08), m["frame"], 0.03)
        if tier == 2:
            cube("violet_upgrade_cap", (0, 0, height - 0.055), (1.89, 0.57, 0.12), m["purple"], 0.025)
            cube("riveted_armor_inset", (0, -0.338, 0.91), (1.32, 0.06, 0.30), m["armor"], 0.025)
    else:
        cube("continuous_ballistic_shell", (0, -0.11, height * 0.49),
             (1.83, 0.46, height - 0.26), m["armor"], 0.07)
        for i in range(3):
            x = (i - 1) * 0.565
            cube(f"replaceable_front_plate_{i}", (x, -0.38, height * 0.47),
                 (0.51, 0.115, height * 0.67), m["frame"], 0.045)
            cube(f"surface_armor_{i}", (x, -0.445, height * 0.47),
                 (0.42, 0.035, height * 0.57), m["armor"], 0.025)
            for z in (height * 0.25, height * 0.68):
                cylinder(f"service_bolt_{i}_{z}", (x, -0.47, z), 0.035, 0.025, m["silver"], 10)
        cube("upper_violet_cap", (0, 0, height - 0.065), (1.9, 0.67, 0.13), m["purple"], 0.04)
        for x in (-0.89, 0.89):
            cube(f"end_armor_{x}", (x, 0, height * 0.5),
                 (0.15, 0.58, height - 0.11), m["frame"], 0.035)
        if tier >= 4:
            for z in (height * 0.35, height * 0.72):
                cube(f"power_channel_{z}", (0, -0.475, z),
                     (1.61, 0.045, 0.045), m["lime"], 0.012)
            for x in (-0.74, 0.74):
                cube(f"violet_corner_guard_{x}", (x, -0.45, height * 0.48),
                     (0.115, 0.07, height * 0.62), m["purple"], 0.018)
        if tier >= 5:
            for x in (-0.57, 0.57):
                cube(f"sensor_case_{x}", (x, -0.38, height - 0.09),
                     (0.27, 0.25, 0.23), m["frame"], 0.03)
                cube(f"sensor_lens_{x}", (x, -0.515, height - 0.08),
                     (0.16, 0.02, 0.10), m["lime"], 0.012)

    # One export mesh with several material primitives keeps repeated wall
    # placement cheap even when a player builds the maximum number of walls.
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    asset = bpy.context.object
    asset.name = f"DZN_wall_L{tier:02d}"
    path = OUTPUT / f"wall_l0{tier}-2.glb"
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_apply=True,
                              export_yup=True, export_materials="EXPORT")
    print("EXPORTED", path, path.stat().st_size, "bytes", len(asset.data.vertices), "vertices")


for level in range(1, 6):
    make_level(level)

assets = {}
for level in range(1, 6):
    name = f"wall_l0{level}"
    file = OUTPUT / f"{name}-2.glb"
    data = file.read_bytes()
    assets[name] = {
        "file": f"assets/models/walls/{name}-2.glb",
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "meshes": 1,
    }
manifest_text = json.dumps({
    "schemaVersion": 2,
    "provenance": "Original Blender 5.2 DZN modular walls; project-owned design using existing weathered pine and metal textures",
    "license": "Project-owned original",
    "assets": assets,
}, indent=2) + "\n"
with (OUTPUT / "manifest.json").open("w", encoding="utf-8", newline="\n") as stream:
    stream.write(manifest_text)
