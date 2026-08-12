import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

import type { OperatorMaterialSet } from "./operator-materials";

export function createHairMeshes(THREE: typeof import("three"), loadout: FullOperatorLoadout, materials: OperatorMaterialSet) {
  const hairId = loadout.identity.hairItemId;
  const meshes: import("three").Mesh[] = [];
  if (!hairId.includes("shaved")) {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), materials.hair as import("three").Material);
    hair.name = "hair_attachment";
    hair.position.set(0, 2.52, 0);
    hair.scale.set(0.31, hairId.includes("mohawk") ? 0.18 : 0.12, 0.28);
    meshes.push(hair);
  }
  if (hairId.includes("braid") || hairId.includes("tied")) {
    const braid = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.34, 5, 8), materials.hair as import("three").Material);
    braid.name = "rear_hair_braid";
    braid.position.set(0, 2.22, -0.25);
    meshes.push(braid);
  }
  if (!loadout.identity.facialHairItemId.includes("clean-shaven")) {
    const beard = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), materials.hair as import("three").Material);
    beard.name = "facial_hair_attachment";
    beard.position.set(0, 2.18, 0.22);
    beard.scale.set(0.2, 0.09, 0.08);
    meshes.push(beard);
  }
  return meshes;
}
