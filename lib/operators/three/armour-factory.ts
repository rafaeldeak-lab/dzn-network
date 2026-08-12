import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

import type { OperatorMaterialSet } from "./operator-materials";

export function createArmourMeshes(THREE: typeof import("three"), loadout: FullOperatorLoadout, materials: OperatorMaterialSet) {
  const meshes: import("three").Mesh[] = [];
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.54, 0.16), materials.armour as import("three").Material);
  vest.name = "armour_layers_chest_plate";
  vest.position.set(0, 1.56, 0.24);
  meshes.push(vest);

  const plateGlow = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.035, 0.018), materials.trim as import("three").Material);
  plateGlow.name = "chest_plate_signal_strip";
  plateGlow.position.set(0, 1.72, 0.33);
  meshes.push(plateGlow);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), materials.armour as import("three").Material);
  helmet.name = "headgear_attachment_helmet";
  helmet.position.set(0, 2.55, 0);
  helmet.scale.set(1.08, 0.58, 0.96);
  meshes.push(helmet);

  if (!String(loadout.selectedItemIds.face_mask).includes("open-face")) {
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.055), materials.darkCloth as import("three").Material);
    mask.name = "face_attachment_mask";
    mask.position.set(0, 2.25, 0.31);
    meshes.push(mask);
  }
  return meshes;
}
