import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";
import type { Material, Object3D } from "three";

import { createAccessoryMeshes } from "./accessory-factory";
import { createArmourMeshes } from "./armour-factory";
import { createBodyMeshes } from "./body-factory";
import { createClothingMeshes } from "./clothing-factory";
import { createFaceMeshes } from "./face-factory";
import { createHairMeshes } from "./hair-factory";
import { createHeadMeshes } from "./head-factory";
import { createMaterials } from "./operator-materials";
import { applyOperatorPose } from "./pose-controller";
import { createWeaponMeshes } from "./weapon-factory";

export async function buildProceduralOperatorModel(loadout: FullOperatorLoadout) {
  const THREE = await import("three");
  const group = new THREE.Group();
  group.name = "DZN Procedural Tactical Operator";
  group.userData.bodyGroups = [
    "pelvis",
    "torso",
    "neck",
    "head",
    "upper_arms",
    "forearms",
    "hands",
    "thighs",
    "lower_legs",
    "feet",
    "clothing_layers",
    "armour_layers",
    "equipment_attachment_points",
    "weapon_attachment_points",
    "backpack_attachment",
    "headgear_attachment",
    "face_attachment",
    "hair_attachment",
    "emblem_attachment",
  ];

  const materials = createMaterials(THREE, loadout);
  for (const mesh of createBodyMeshes(THREE, loadout, materials)) group.add(mesh);
  for (const mesh of createHeadMeshes(THREE, loadout, materials)) group.add(mesh);
  for (const mesh of createFaceMeshes(THREE, loadout, materials)) group.add(mesh);
  for (const mesh of createHairMeshes(THREE, loadout, materials)) group.add(mesh);
  for (const mesh of createClothingMeshes(THREE, loadout, materials)) group.add(mesh);
  for (const mesh of createArmourMeshes(THREE, loadout, materials)) group.add(mesh);
  for (const mesh of createAccessoryMeshes(THREE, loadout, materials)) group.add(mesh);
  for (const mesh of createWeaponMeshes(THREE, loadout, materials)) group.add(mesh);

  applyOperatorPose(group, loadout.poseItemId);
  return group;
}

export function disposeOperatorModel(model: Object3D) {
  model.traverse((node) => {
    const disposableNode = node as Object3D & {
      geometry?: { dispose: () => void };
      material?: Material | Material[];
    };
    disposableNode.geometry?.dispose();
    const material = disposableNode.material;
    if (Array.isArray(material)) {
      for (const entry of material) entry?.dispose?.();
    } else if (material && typeof material === "object" && "dispose" in material && typeof material.dispose === "function") {
      material.dispose();
    }
  });
}
