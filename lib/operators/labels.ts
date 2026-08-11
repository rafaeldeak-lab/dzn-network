import type { OperatorCosmeticSlot } from "./types";

const SLOT_LABELS: Record<OperatorCosmeticSlot, string> = {
  head: "Head",
  face: "Face",
  hair: "Hair",
  upper_body: "Upper body",
  lower_body: "Lower body",
  outerwear: "Outerwear",
  hands: "Hands",
  feet: "Feet",
  back: "Back",
  armour: "Armour",
  utility: "Utility",
  accessories: "Accessories",
  pose: "Pose",
  background: "Background",
  frame: "Frame",
  entrance_animation: "Entrance",
  victory_animation: "Victory",
};

export function operatorSlotLabel(slot: OperatorCosmeticSlot): string {
  return SLOT_LABELS[slot];
}
