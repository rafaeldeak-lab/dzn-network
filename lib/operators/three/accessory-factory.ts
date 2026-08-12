import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

import type { OperatorMaterialSet } from "./operator-materials";

export function createAccessoryMeshes(THREE: typeof import("three"), loadout: FullOperatorLoadout, materials: OperatorMaterialSet) {
  const meshes: import("three").Mesh[] = [];
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.7, 0.18), materials.darkCloth as import("three").Material);
  pack.name = "backpack_attachment";
  pack.position.set(0, 1.43, -0.32);
  meshes.push(pack);

  for (const x of [-0.25, 0, 0.25]) {
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.08), materials.armour as import("three").Material);
    pouch.name = "equipment_attachment_points_pouch";
    pouch.position.set(x, 1.25, 0.34);
    meshes.push(pouch);
  }

  const emblem = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.018, 6), materials.trim as import("three").Material);
  emblem.name = "emblem_attachment";
  emblem.position.set(0.24, 1.72, 0.35);
  emblem.rotation.x = Math.PI / 2;
  meshes.push(emblem);

  const auraPower = Object.values(loadout.powerSlots).filter(Boolean).length;
  if (auraPower > 0) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.01, 8, 64), materials.glow as import("three").Material);
    ring.name = "cosmetic_power_aura";
    ring.position.set(0, 1.1, 0);
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(1 + auraPower * 0.06);
    meshes.push(ring);
  }
  return meshes;
}
