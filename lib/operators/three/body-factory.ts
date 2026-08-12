import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

import type { OperatorMaterialSet } from "./operator-materials";

export function createBodyMeshes(THREE: typeof import("three"), loadout: FullOperatorLoadout, materials: OperatorMaterialSet) {
  const body = loadout.identity.body;
  const height = 1 + (body.height - 50) / 260;
  const shoulders = 1 + (body.shoulderWidth - 50) / 280;
  const torso = 1 + (body.torsoBuild - 50) / 310;
  const arms = 1 + (body.armBuild - 50) / 300;
  const legs = 1 + (body.legBuild - 50) / 300;
  const meshes: import("three").Mesh[] = [
    capsule(THREE, "pelvis", [0, 0.98 * height, 0], [0.42 * torso, 0.34, 0.24], materials.darkCloth),
    capsule(THREE, "torso", [0, 1.52 * height, 0], [0.56 * shoulders, 0.72 * torso, 0.32], materials.cloth),
    capsule(THREE, "neck", [0, 2.08 * height, 0], [0.16, 0.18, 0.16], materials.skin),
    capsule(THREE, "upper_arm_left", [-0.55 * shoulders, 1.62 * height, 0], [0.14 * arms, 0.56, 0.14], materials.cloth, 0.16),
    capsule(THREE, "upper_arm_right", [0.55 * shoulders, 1.62 * height, 0], [0.14 * arms, 0.56, 0.14], materials.cloth, -0.16),
    capsule(THREE, "forearm_left", [-0.7 * shoulders, 1.16 * height, 0.03], [0.13 * arms, 0.52, 0.13], materials.darkCloth, -0.05),
    capsule(THREE, "forearm_right", [0.7 * shoulders, 1.16 * height, 0.03], [0.13 * arms, 0.52, 0.13], materials.darkCloth, 0.05),
    capsule(THREE, "hand_left", [-0.72 * shoulders, 0.82 * height, 0.08], [0.1, 0.16, 0.08], materials.skin),
    capsule(THREE, "hand_right", [0.72 * shoulders, 0.82 * height, 0.08], [0.1, 0.16, 0.08], materials.skin),
    capsule(THREE, "thigh_left", [-0.22, 0.52 * height, 0], [0.18 * legs, 0.7, 0.17], materials.darkCloth, 0.04),
    capsule(THREE, "thigh_right", [0.22, 0.52 * height, 0], [0.18 * legs, 0.7, 0.17], materials.darkCloth, -0.04),
    capsule(THREE, "lower_leg_left", [-0.22, -0.06 * height, 0], [0.15 * legs, 0.62, 0.14], materials.darkCloth),
    capsule(THREE, "lower_leg_right", [0.22, -0.06 * height, 0], [0.15 * legs, 0.62, 0.14], materials.darkCloth),
    boot(THREE, "foot_left", [-0.22, -0.48 * height, 0.08], materials.darkCloth),
    boot(THREE, "foot_right", [0.22, -0.48 * height, 0.08], materials.darkCloth),
  ];
  for (const mesh of meshes) mesh.castShadow = true;
  return meshes;
}

function capsule(
  THREE: typeof import("three"),
  name: string,
  position: [number, number, number],
  scale: [number, number, number],
  material: unknown,
  zRotate = 0,
) {
  const geometry = new THREE.CapsuleGeometry(1, 1, 6, 12);
  const mesh = new THREE.Mesh(geometry, material as import("three").Material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.z = zRotate;
  return mesh;
}

function boot(THREE: typeof import("three"), name: string, position: [number, number, number], material: unknown) {
  const geometry = new THREE.BoxGeometry(0.28, 0.16, 0.46);
  const mesh = new THREE.Mesh(geometry, material as import("three").Material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  return mesh;
}
