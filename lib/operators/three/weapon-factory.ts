import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

import type { OperatorMaterialSet } from "./operator-materials";

export function createWeaponMeshes(THREE: typeof import("three"), loadout: FullOperatorLoadout, materials: OperatorMaterialSet) {
  const meshes: import("three").Object3D[] = [];
  const primary = weaponGroup(THREE, "primary_weapon_display", 0.78, materials.weapon, materials.metal, materials.trim);
  primary.position.set(0.82, 1.28, 0.28);
  primary.rotation.z = -0.26;
  primary.rotation.y = -0.12;
  meshes.push(primary);

  const sidearm = weaponGroup(THREE, "secondary_weapon_display", 0.38, materials.weapon, materials.metal, materials.trim);
  sidearm.position.set(-0.48, 1.0, 0.31);
  sidearm.rotation.z = 0.9;
  meshes.push(sidearm);

  const melee = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.42, 0.035), materials.metal as import("three").Material);
  melee.name = "melee_weapon_display";
  melee.position.set(-0.48, 0.72, 0.28);
  melee.rotation.z = 0.22;
  meshes.push(melee);

  const throwable = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.18, 12), materials.trim as import("three").Material);
  throwable.name = "throwable_equipment_display";
  throwable.position.set(0.42, 0.98, 0.31);
  meshes.push(throwable);

  if (loadout.weapon.charmItemId) {
    const charm = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), materials.glow as import("three").Material);
    charm.name = "weapon_charm_display";
    charm.position.set(1.14, 1.05, 0.32);
    meshes.push(charm);
  }
  return meshes;
}

function weaponGroup(
  THREE: typeof import("three"),
  name: string,
  length: number,
  weaponMaterial: unknown,
  metalMaterial: unknown,
  trimMaterial: unknown,
) {
  const group = new THREE.Group();
  group.name = name;
  const body = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, 0.08), weaponMaterial as import("three").Material);
  body.name = `${name}_body`;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, length * 0.42, 10), metalMaterial as import("three").Material);
  barrel.name = `${name}_barrel`;
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(length * 0.45, 0.02, 0);
  const optic = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.055, 0.06), trimMaterial as import("three").Material);
  optic.name = `${name}_optic`;
  optic.position.set(0.06, 0.1, 0);
  const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.06), metalMaterial as import("three").Material);
  magazine.name = `${name}_magazine`;
  magazine.position.set(-0.08, -0.16, 0);
  group.add(body, barrel, optic, magazine);
  return group;
}
