export const OPERATOR_COSMETIC_SLOTS = [
  "head",
  "face",
  "hair",
  "upper_body",
  "lower_body",
  "outerwear",
  "hands",
  "feet",
  "back",
  "armour",
  "utility",
  "accessories",
  "pose",
  "background",
  "frame",
  "entrance_animation",
  "victory_animation",
] as const;

export type OperatorCosmeticSlot = (typeof OPERATOR_COSMETIC_SLOTS)[number];
export type OperatorPlanTier = "free" | "premium";
export type OperatorEntitlement = "free" | "premium";
export type OperatorRarity = "starter" | "field" | "rare" | "elite" | "legendary";

export type OperatorPreviewMetadata = {
  swatch: string;
  accent?: string;
  pattern?: "solid" | "signal" | "chevron" | "grid" | "halo";
};

export type OperatorIdentity = {
  id: string;
  displayName: string;
  callSign: string;
  description: string;
  default: boolean;
};

export type OperatorCosmeticItem = {
  id: string;
  displayName: string;
  description: string;
  slot: OperatorCosmeticSlot;
  rarity: OperatorRarity;
  entitlement: OperatorEntitlement;
  compatibleOperatorIds: string[];
  seasonOrEventLabel?: string;
  preview: OperatorPreviewMetadata;
  accessibilityLabel: string;
};

export type OperatorLoadout = {
  id: string;
  operatorId: string;
  displayName: string;
  selections: Partial<Record<OperatorCosmeticSlot, string>>;
  updatedAt: string;
};

export type OperatorCardPresentation = {
  operatorId: string;
  displayName: string;
  callSign: string;
  frameItemId: string;
  backgroundItemId: string;
  poseItemId: string;
  selectedItems: Record<OperatorCosmeticSlot, OperatorCosmeticItem>;
  palette: {
    primary: string;
    secondary: string;
    trim: string;
  };
  showcaseSlots: number;
  fairnessNotice: string;
};

export type OperatorCatalog = {
  operators: OperatorIdentity[];
  items: OperatorCosmeticItem[];
};

export type OperatorValidationIssueCode =
  | "free_custom_loadout"
  | "operator_unknown"
  | "item_unknown"
  | "item_slot_mismatch"
  | "item_incompatible"
  | "premium_required"
  | "missing_required_slot";

export type OperatorValidationIssue = {
  code: OperatorValidationIssueCode;
  message: string;
  slot?: OperatorCosmeticSlot;
  itemId?: string;
};

export type OperatorValidationResult = {
  valid: boolean;
  issues: OperatorValidationIssue[];
  loadout: OperatorLoadout;
};

export type OperatorPreviewStorageState = {
  version: 1;
  note: "preview_only_non_authoritative";
  loadouts: OperatorLoadout[];
  equippedLoadoutId: string | null;
};

export const PROHIBITED_OPERATOR_COMPETITIVE_FIELDS = [
  "scoreMultiplier",
  "damage",
  "health",
  "armourProtection",
  "speed",
  "rankingBoost",
  "matchmakingWeight",
  "voteMultiplier",
  "rewardMultiplier",
  "winChance",
  "eligibilityBoost",
  "eventPoints",
  "seedingBoost",
  "serverPublicityScore",
] as const;
