import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

import type { OperatorMaterialSet } from "./operator-materials";

export function createHeadMeshes(THREE: typeof import("three"), loadout: FullOperatorLoadout, materials: OperatorMaterialSet) {
  const face = loadout.identity.face;
  const width = 0.28 + face.faceWidth / 620;
  const jaw = 0.9 + face.jawWidth / 500;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), materials.skin as import("three").Material);
  head.name = "head";
  head.position.set(0, 2.34, 0.02);
  head.scale.set(width * jaw, 0.36, 0.28);
  head.castShadow = true;

  const chin = new THREE.Mesh(new THREE.ConeGeometry(width * 0.76, 0.18, 5), materials.skin as import("three").Material);
  chin.name = "jaw_and_chin";
  chin.position.set(0, 2.1, 0.04);
  chin.rotation.x = Math.PI;
  chin.castShadow = true;

  const brow = new THREE.Mesh(new THREE.BoxGeometry(width * 1.28, 0.035, 0.035), materials.darkCloth as import("three").Material);
  brow.name = "brow_definition";
  brow.position.set(0, 2.42, 0.28);
  brow.castShadow = true;

  return [head, chin, brow];
}
