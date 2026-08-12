import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

import type { OperatorMaterialSet } from "./operator-materials";

export function createFaceMeshes(THREE: typeof import("three"), loadout: FullOperatorLoadout, materials: OperatorMaterialSet) {
  const spacing = 0.085 + loadout.identity.face.eyeSpacing / 900;
  const meshes: import("three").Mesh[] = [
    eye(THREE, "eye_left", -spacing, materials.glow),
    eye(THREE, "eye_right", spacing, materials.glow),
    nose(THREE, loadout.identity.face.noseSize, materials.skin),
  ];
  if (!loadout.identity.face.scarItemId.includes("no-scar")) {
    const scar = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.22, 0.012), materials.trim as import("three").Material);
    scar.name = "scar_style";
    scar.position.set(-0.11, 2.34, 0.31);
    scar.rotation.z = -0.35;
    meshes.push(scar);
  }
  if (!loadout.identity.face.facePaintItemId.includes("no-paint")) {
    const paint = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 0.014), materials.trim as import("three").Material);
    paint.name = "face_paint_style";
    paint.position.set(0, 2.28, 0.32);
    meshes.push(paint);
  }
  return meshes;
}

function eye(THREE: typeof import("three"), name: string, x: number, material: unknown) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), material as import("three").Material);
  mesh.name = name;
  mesh.position.set(x, 2.39, 0.29);
  return mesh;
}

function nose(THREE: typeof import("three"), size: number, material: unknown) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.035 + size / 1800, 0.12, 6), material as import("three").Material);
  mesh.name = "nose_structure";
  mesh.position.set(0, 2.31, 0.32);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}
