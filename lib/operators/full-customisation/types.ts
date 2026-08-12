export const FULL_OPERATOR_BODY_GROUPS = [
  "pelvis",
  "torso",
  "neck",
  "head",
  "upper_arms",
  "forearms",
  "hands",
  "thighs",
  "lower_legs",
  "feet",
  "clothing_layers",
  "armour_layers",
  "equipment_attachment_points",
  "weapon_attachment_points",
  "backpack_attachment",
  "headgear_attachment",
  "face_attachment",
  "hair_attachment",
  "emblem_attachment",
] as const;

export type FullOperatorBodyGroup = (typeof FULL_OPERATOR_BODY_GROUPS)[number];

export const FULL_OPERATOR_BODY_PRESETS = [
  "scout",
  "standard",
  "assault",
  "heavy",
  "tall",
  "compact",
] as const;

export type FullOperatorBodyPresetId = (typeof FULL_OPERATOR_BODY_PRESETS)[number];

export const FULL_OPERATOR_CATEGORIES = [
  "body",
  "skin",
  "face",
  "eyes",
  "hair",
  "facial_hair",
  "scars",
  "face_paint",
  "helmet",
  "face_mask",
  "upper_body",
  "outerwear",
  "chest_plate",
  "gloves",
  "belt",
  "trousers",
  "knee_pads",
  "boots",
  "backpack",
  "accessories",
  "patches",
  "emblems",
  "primary_weapon",
  "secondary_weapon",
  "melee_weapon",
  "throwable",
  "primary_skin",
  "secondary_skin",
  "optic",
  "muzzle",
  "stock",
  "magazine",
  "weapon_charm",
  "pose",
  "card_background",
  "card_frame",
  "entrance_animation",
  "victory_animation",
  "profile_accent",
  "rank_emblem",
  "title",
  "power",
] as const;

export type FullOperatorCategory = (typeof FULL_OPERATOR_CATEGORIES)[number];

export const FULL_OPERATOR_STUDIO_SECTIONS = [
  "wardrobe",
  "loadout",
  "progression",
  "identity",
] as const;

export type FullOperatorStudioSection = (typeof FULL_OPERATOR_STUDIO_SECTIONS)[number];

export const FULL_OPERATOR_POWER_SLOTS = [
  "power_slot_1",
  "power_slot_2",
  "power_slot_3",
  "power_slot_4",
] as const;

export type FullOperatorPowerSlot = (typeof FULL_OPERATOR_POWER_SLOTS)[number];

export const FULL_OPERATOR_RARITIES = [
  "starter",
  "field",
  "rare",
  "elite",
  "legendary",
] as const;

export type FullOperatorRarity = (typeof FULL_OPERATOR_RARITIES)[number];
export type FullOperatorEntitlement = "free" | "premium";

export type FullOperatorItemKind =
  | "identity"
  | "wardrobe"
  | "weapon"
  | "attachment"
  | "presentation"
  | "power";

export type FullOperatorUnlockCondition = {
  type: "starter" | "operator_level" | "rank_reward" | "challenge_reward" | "streak_reward" | "weapon_mastery" | "outfit_mastery";
  description: string;
};

export type FullOperatorGeometryMetadata = {
  factory: "body" | "head" | "hair" | "face" | "clothing" | "armour" | "accessory" | "weapon" | "power";
  silhouette: string;
  attachmentPoint?: FullOperatorBodyGroup;
  scale: number;
};

export type FullOperatorMaterialMetadata = {
  primary: string;
  secondary: string;
  accent: string;
  finish: "matte" | "fabric" | "polymer" | "metal" | "holographic" | "carbon";
};

export type FullOperatorCatalogItem = {
  id: string;
  displayName: string;
  description: string;
  category: FullOperatorCategory;
  slot: string;
  kind: FullOperatorItemKind;
  rarity: FullOperatorRarity;
  entitlement: FullOperatorEntitlement;
  levelRequirement: number;
  unlockCondition: FullOperatorUnlockCondition;
  compatibleBodyPresets: FullOperatorBodyPresetId[];
  material: FullOperatorMaterialMetadata;
  geometry: FullOperatorGeometryMetadata;
  accessibilityLabel: string;
  previewLabel: string;
  fixedUnlockSource: string;
};

export type FullOperatorBodySettings = {
  preset: FullOperatorBodyPresetId;
  height: number;
  shoulderWidth: number;
  torsoBuild: number;
  armBuild: number;
  legBuild: number;
};

export type FullOperatorFaceSettings = {
  presetId: string;
  faceWidth: number;
  jawWidth: number;
  cheekDefinition: number;
  noseSize: number;
  browDefinition: number;
  eyeSpacing: number;
  eyeColorItemId: string;
  eyebrowStyle: string;
  scarItemId: string;
  facePaintItemId: string;
};

export type FullOperatorIdentitySettings = {
  body: FullOperatorBodySettings;
  skinToneItemId: string;
  face: FullOperatorFaceSettings;
  hairItemId: string;
  facialHairItemId: string;
  hairColor: string;
  facialHairColor: string;
};

export type FullOperatorWeaponLoadout = {
  primaryWeaponItemId: string;
  secondaryWeaponItemId: string;
  meleeWeaponItemId: string;
  throwableItemId: string;
  primarySkinItemId: string;
  secondarySkinItemId: string;
  opticItemId: string;
  muzzleItemId: string;
  stockItemId: string;
  magazineItemId: string;
  charmItemId: string;
};

export type FullOperatorLoadout = {
  id: string;
  displayName: string;
  callSign: string;
  titleItemId: string;
  featured: boolean;
  identity: FullOperatorIdentitySettings;
  selectedItemIds: Partial<Record<FullOperatorCategory, string>>;
  weapon: FullOperatorWeaponLoadout;
  powerSlots: Record<FullOperatorPowerSlot, string | null>;
  poseItemId: string;
  cardFrameItemId: string;
  cardBackgroundItemId: string;
  profileAccentItemId: string;
  entranceAnimationItemId: string;
  victoryAnimationItemId: string;
  updatedAt: string;
};

export type FullOperatorStudioStorageState = {
  version: 2;
  note: "preview_only_non_authoritative";
  loadouts: FullOperatorLoadout[];
  equippedLoadoutId: string;
  draftLoadout: FullOperatorLoadout;
  featuredLoadoutId: string;
};

export type FullOperatorMasterySummary = {
  totalOperatorLevel: number;
  rankLabel: string;
  xp: number;
  nextUnlock: string;
  unlockedItemCount: number;
  totalCatalogCount: number;
};

export type FullWeaponMasterySummary = {
  weaponItemId: string;
  masteryLevel: number;
  unlockedSkinIds: string[];
  unlockedCharmIds: string[];
  nextCosmeticUnlock: string;
};

export type FullOperatorCardVariant = "full" | "compact" | "leaderboard" | "mobile" | "server-row";

export const FULL_OPERATOR_PROHIBITED_COMPETITIVE_FIELDS = [
  "damage",
  "health",
  "speed",
  "fireRate",
  "recoil",
  "armourPenetration",
  "accuracyBonus",
  "scoreMultiplier",
  "xpMultiplier",
  "rankingModifier",
  "voteMultiplier",
  "matchmakingModifier",
  "rewardOdds",
  "winChance",
  "eligibilityBoost",
  "eventPoints",
  "serverScore",
  "competitionScore",
] as const;
