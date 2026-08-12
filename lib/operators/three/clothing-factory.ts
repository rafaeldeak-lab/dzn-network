import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

import type { OperatorMaterialSet } from "./operator-materials";

export function createClothingMeshes(THREE: typeof import("three"), loadout: FullOperatorLoadout, materials: OperatorMaterialSet) {
  const meshes: import("three").Mesh[] = [];
  const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.68, 0.4), materials.cloth as import("three").Material);
  jacket.name = "clothing_layers_upper_body";
  jacket.position.set(0, 1.48, 0);
  meshes.push(jacket);

  if (!String(loadout.selectedItemIds.outerwear).includes("no-outerwear")) {
    const coat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.46), materials.darkCloth as import("three").Material);
    coat.name = "clothing_layers_outerwear";
    coat.position.set(0, 1.32, -0.015);
    meshes.push(coat);
  }

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.46), materials.armour as import("three").Material);
  belt.name = "belt_attachment";
  belt.position.set(0, 0.98, 0.02);
  meshes.push(belt);

  for (const x of [-0.22, 0.22]) {
    const trouser = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.66, 0.24), materials.darkCloth as import("three").Material);
    trouser.name = x < 0 ? "trousers_left" : "trousers_right";
    trouser.position.set(x, 0.28, 0.02);
    meshes.push(trouser);
  }

  for (const x of [-0.22, 0.22]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.08), materials.armour as import("three").Material);
    pad.name = x < 0 ? "knee_pad_left" : "knee_pad_right";
    pad.position.set(x, 0.14, 0.16);
    meshes.push(pad);
  }
  return meshes;
}
