import { getFullOperatorItem } from "@/lib/operators/full-customisation/catalog";
import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

export type OperatorMaterialSet = {
  skin: unknown;
  cloth: unknown;
  darkCloth: unknown;
  armour: unknown;
  trim: unknown;
  metal: unknown;
  weapon: unknown;
  glow: unknown;
  hair: unknown;
};

export function createMaterials(THREE: typeof import("three"), loadout: FullOperatorLoadout): OperatorMaterialSet {
  const upper = getFullOperatorItem(loadout.selectedItemIds.upper_body)?.material.primary ?? "#164e63";
  const armour = getFullOperatorItem(loadout.selectedItemIds.chest_plate)?.material.primary ?? "#1f2937";
  const accent = getFullOperatorItem(loadout.selectedItemIds.profile_accent)?.material.accent ?? "#22d3ee";
  const skin = getFullOperatorItem(loadout.identity.skinToneItemId)?.material.primary ?? "#b77955";
  const weapon = getFullOperatorItem(loadout.weapon.primarySkinItemId)?.material.primary ?? "#334155";

  return {
    skin: new THREE.MeshStandardMaterial({ color: skin, roughness: 0.86, metalness: 0.02 }),
    cloth: new THREE.MeshStandardMaterial({ color: upper, roughness: 0.9, metalness: 0.03 }),
    darkCloth: new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.92, metalness: 0.04 }),
    armour: new THREE.MeshStandardMaterial({ color: armour, roughness: 0.58, metalness: 0.18 }),
    trim: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.26, roughness: 0.42, metalness: 0.18 }),
    metal: new THREE.MeshStandardMaterial({ color: "#64748b", roughness: 0.36, metalness: 0.72 }),
    weapon: new THREE.MeshStandardMaterial({ color: weapon, roughness: 0.48, metalness: 0.52 }),
    glow: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.82, transparent: true, opacity: 0.72 }),
    hair: new THREE.MeshStandardMaterial({ color: loadout.identity.hairColor, roughness: 0.88, metalness: 0.02 }),
  };
}
