import type {
  FullOperatorBodyPresetId,
  FullOperatorCatalogItem,
  FullOperatorCategory,
  FullOperatorEntitlement,
  FullOperatorItemKind,
  FullOperatorRarity,
} from "./types";
import { FULL_OPERATOR_BODY_PRESETS } from "./types";

type SeedDefinition = {
  category: FullOperatorCategory;
  slot: string;
  kind: FullOperatorItemKind;
  names: string[];
  entitlement?: FullOperatorEntitlement;
  factory: FullOperatorCatalogItem["geometry"]["factory"];
  attachmentPoint?: FullOperatorCatalogItem["geometry"]["attachmentPoint"];
  finish: FullOperatorCatalogItem["material"]["finish"];
  baseLevel?: number;
  source?: string;
};

export const FULL_OPERATOR_CATEGORY_LABELS: Record<FullOperatorCategory, string> = {
  body: "Body",
  skin: "Skin",
  face: "Face",
  eyes: "Eyes",
  hair: "Hair",
  facial_hair: "Facial Hair",
  scars: "Scars",
  face_paint: "Face Paint",
  helmet: "Helmet",
  face_mask: "Face Mask",
  upper_body: "Upper Body",
  outerwear: "Outerwear",
  chest_plate: "Chest Plate / Vest",
  gloves: "Gloves",
  belt: "Belt",
  trousers: "Trousers",
  knee_pads: "Knee Pads",
  boots: "Boots / Shoes",
  backpack: "Backpack",
  accessories: "Accessories",
  patches: "Patches",
  emblems: "Emblems",
  primary_weapon: "Primary Weapon",
  secondary_weapon: "Secondary Weapon",
  melee_weapon: "Melee Weapon",
  throwable: "Throwable",
  primary_skin: "Primary Skin",
  secondary_skin: "Secondary Skin",
  optic: "Optic",
  muzzle: "Muzzle",
  stock: "Stock",
  magazine: "Magazine",
  weapon_charm: "Weapon Charm",
  pose: "Pose",
  card_background: "Operator Card Background",
  card_frame: "Operator Card Frame",
  entrance_animation: "Entrance Animation",
  victory_animation: "Victory Animation",
  profile_accent: "Profile Accent",
  rank_emblem: "Rank Emblem",
  title: "Title",
  power: "Powers and Perks",
};

export const FULL_OPERATOR_STUDIO_RAIL = [
  {
    group: "Identity",
    categories: ["body", "skin", "face", "eyes", "hair", "facial_hair", "scars", "face_paint"] as const,
  },
  {
    group: "Appearance",
    categories: ["helmet", "face_mask", "upper_body", "outerwear", "chest_plate", "gloves", "belt", "trousers", "knee_pads", "boots", "backpack", "accessories", "patches", "emblems"] as const,
  },
  {
    group: "Weapons",
    categories: ["primary_weapon", "secondary_weapon", "melee_weapon", "throwable", "primary_skin", "secondary_skin", "optic", "muzzle", "stock", "magazine", "weapon_charm"] as const,
  },
  {
    group: "Presentation",
    categories: ["pose", "card_background", "card_frame", "entrance_animation", "victory_animation", "profile_accent", "rank_emblem", "title"] as const,
  },
  {
    group: "Powers and perks",
    categories: ["power"] as const,
  },
] as const;

export const FULL_OPERATOR_BODY_PRESET_ITEMS = [
  ["body-scout", "Scout", "Lean reconnaissance silhouette for visual identity only."],
  ["body-standard", "Standard", "Balanced DZN Operator proportions for all players."],
  ["body-assault", "Assault", "Broader tactical stance with heavier shoulder silhouette."],
  ["body-heavy", "Heavy", "Large armour-forward presentation silhouette."],
  ["body-tall", "Tall", "Extended height profile with long-leg proportions."],
  ["body-compact", "Compact", "Shorter compact profile for tight tactical framing."],
] as const;

const skinTones = [
  "Frost Sand",
  "Warm Birch",
  "Copper Field",
  "Amber Ridge",
  "Olive Tan",
  "Bronze Dune",
  "Mahogany Signal",
  "Umber Night",
  "Deep Sable",
  "Ebony Slate",
];

const seedDefinitions: SeedDefinition[] = [
  { category: "skin", slot: "skin_tone", kind: "identity", names: skinTones, entitlement: "free", factory: "face", finish: "matte", source: "Starter identity palette" },
  { category: "face", slot: "face_preset", kind: "identity", names: ["Angular", "Broad", "Soft", "Narrow", "Veteran", "Recon", "Warden", "Pathfinder"], entitlement: "free", factory: "face", finish: "matte", source: "Starter identity preset" },
  { category: "eyes", slot: "eye_colour", kind: "identity", names: ["Steel Blue", "Signal Green", "Amber Watch", "Slate Grey", "Hazel Grid", "Dark Ember"], entitlement: "free", factory: "face", finish: "holographic", source: "Starter identity palette" },
  { category: "hair", slot: "hair", kind: "identity", names: ["Shaved", "Buzz Cut", "Tactical Fade", "Short Crop", "Side Part", "Swept", "Mohawk", "Tied Back", "Short Curls", "Medium Curls", "Undercut", "Field Braid"], entitlement: "free", factory: "hair", attachmentPoint: "hair_attachment", finish: "fabric", source: "Starter identity style" },
  { category: "facial_hair", slot: "facial_hair", kind: "identity", names: ["Clean Shaven", "Stubble", "Moustache", "Goatee", "Short Beard", "Full Beard", "Tactical Beard", "Trimmed Beard"], entitlement: "free", factory: "hair", attachmentPoint: "face_attachment", finish: "fabric", source: "Starter identity style" },
  { category: "scars", slot: "scar", kind: "identity", names: ["No Scar", "Signal Cut", "Brow Mark", "Cheek Line", "Field Nick", "Bridge Slash", "Warden Mark", "Pathfinder Mark"], entitlement: "free", factory: "face", attachmentPoint: "face_attachment", finish: "matte", source: "Starter face detail" },
  { category: "face_paint", slot: "face_paint", kind: "identity", names: ["No Paint", "Grid Sweep", "Night Stripe", "Cyan Underline", "Vanguard Split", "Recon Ash", "Emerald Field", "Signal Half Mask"], entitlement: "free", factory: "face", attachmentPoint: "face_attachment", finish: "matte", source: "Starter face detail" },
  { category: "helmet", slot: "helmet", kind: "wardrobe", names: ["Field Ballistic Helmet", "Signal Ops Helmet", "Recon Mesh Helmet", "Warden Hardcap", "Night Relay Helmet", "Pathfinder Hood", "Cyan Grid Helmet", "Vanguard Shell", "Sentinel Half Dome", "Ridge Patrol Helmet", "Blackline Hood", "DZN Icon Helm"], factory: "armour", attachmentPoint: "headgear_attachment", finish: "polymer" },
  { category: "face_mask", slot: "face_mask", kind: "wardrobe", names: ["Open Face", "Signal Balaclava", "Breather Wrap", "Ridge Mask", "Night Mesh", "Field Respirator", "Warden Guard", "Recon Scarf", "Blackout Mask", "Cyan Visor Mask"], factory: "accessory", attachmentPoint: "face_attachment", finish: "fabric" },
  { category: "upper_body", slot: "upper_body", kind: "wardrobe", names: ["Standard Combat Shirt", "Signal Grid Jacket", "Recon Softshell", "Vanguard Field Top", "Warden Utility Shirt", "Night Ops Hoodie", "Pathfinder Layer", "Sentinel Combat Top", "Cinder Field Shirt", "Cyan Relay Jersey", "Ridge Tactical Top", "DZN Icon Upper"], factory: "clothing", finish: "fabric", source: "Operator wardrobe" },
  { category: "outerwear", slot: "outerwear", kind: "wardrobe", names: ["No Outerwear", "Weather Shell", "Field Parka", "Vanguard Coat", "Night Poncho", "Signal Cape", "Recon Rain Layer", "Warden Plate Coat", "Cyan Relay Coat", "Legend Grid Duster"], factory: "clothing", finish: "fabric" },
  { category: "chest_plate", slot: "chest_plate", kind: "wardrobe", names: ["Soft Plate Carrier", "Signal Plate Rig", "Recon Harness", "Vanguard Vest", "Warden Shield Vest", "Night Ops Carrier", "Pathfinder Webbing", "Sentinel Chest Plate", "Cinder Armour Rig", "Cyan Grid Carrier", "Ridge Plate Set", "DZN Icon Plate"], factory: "armour", attachmentPoint: "torso", finish: "polymer" },
  { category: "gloves", slot: "gloves", kind: "wardrobe", names: ["Grip Gloves", "Signal Gloves", "Recon Fingerless", "Warden Knuckle Gloves", "Night Ops Gloves", "Pathfinder Wraps", "Vanguard Gauntlets", "Cyan Relay Gloves"], factory: "clothing", attachmentPoint: "hands", finish: "fabric" },
  { category: "belt", slot: "belt", kind: "wardrobe", names: ["Field Belt", "Signal Utility Belt", "Recon Low Belt", "Warden Battle Belt", "Night Ops Belt", "Pathfinder Rope Belt", "Vanguard Gear Belt", "Cyan Relay Belt"], factory: "accessory", attachmentPoint: "pelvis", finish: "polymer" },
  { category: "trousers", slot: "trousers", kind: "wardrobe", names: ["Field Trousers", "Signal Cargo", "Recon Slim Cargo", "Vanguard Combat Pants", "Warden Reinforced Pants", "Night Ops Trousers", "Pathfinder Trail Pants", "Sentinel Combat Pants", "Cinder Cargo", "Cyan Relay Pants", "Ridge Patrol Pants", "DZN Icon Trousers"], factory: "clothing", finish: "fabric" },
  { category: "knee_pads", slot: "knee_pads", kind: "wardrobe", names: ["Soft Knee Pads", "Signal Knee Guards", "Recon Light Guards", "Warden Hard Pads", "Night Ops Pads", "Pathfinder Trail Pads", "Vanguard Shield Pads", "Cyan Relay Pads"], factory: "armour", attachmentPoint: "lower_legs", finish: "polymer" },
  { category: "boots", slot: "boots", kind: "wardrobe", names: ["Trail Boots", "Signal Combat Boots", "Recon Low Boots", "Warden Heavy Boots", "Night Ops Boots", "Pathfinder Boots", "Vanguard Tread Boots", "Cyan Relay Boots", "Ridge Patrol Boots", "DZN Icon Boots"], factory: "clothing", attachmentPoint: "feet", finish: "fabric" },
  { category: "backpack", slot: "backpack", kind: "wardrobe", names: ["Scout Pack", "Signal Relay Pack", "Recon Slim Pack", "Warden Support Pack", "Night Ops Pack", "Pathfinder Roll Pack", "Vanguard Gear Pack", "Cyan Grid Pack", "Ridge Patrol Pack", "DZN Icon Pack"], factory: "accessory", attachmentPoint: "backpack_attachment", finish: "fabric" },
  { category: "accessories", slot: "accessory", kind: "wardrobe", names: ["Identity Tag", "Signal Radio", "Field Compass", "Recon Cable", "Warden Flash Patch", "Night Chem Light", "Pathfinder Rope", "Vanguard Clip", "Cyan Relay Key", "Ridge Watch", "Signal Flare Tube", "Grid Wristband", "Operator Coin", "DZN Beacon", "Sentinel Lanyard", "Icon Relay Pin"], factory: "accessory", attachmentPoint: "equipment_attachment_points", finish: "metal" },
  { category: "patches", slot: "patch", kind: "wardrobe", names: ["DZN Field Patch", "Signal Team Patch", "Recon Cell Patch", "Warden Shield Patch", "Night Ops Patch", "Pathfinder Patch", "Vanguard Patch", "Community Patch", "Event Runner Patch", "Season One Patch", "Sentinel Patch", "DZN Icon Patch"], factory: "accessory", attachmentPoint: "emblem_attachment", finish: "fabric" },
  { category: "emblems", slot: "emblem", kind: "wardrobe", names: ["DZN Relay", "Cyan Crown", "Vanguard Mark", "Warden Hex", "Recon Eye", "Pathfinder Arrow", "Night Signal", "Field Star", "Community Anchor", "Event Spark", "Network Crest", "Icon Prism"], factory: "accessory", attachmentPoint: "emblem_attachment", finish: "holographic" },
  { category: "primary_weapon", slot: "primary_weapon", kind: "weapon", names: ["DZN AR-4 Assault Rifle", "DZN Sentinel DMR", "DZN Raptor SMG", "DZN Vanguard Shotgun", "DZN Field LMG", "DZN Recon Carbine", "DZN Ridge Rifle", "DZN Nightline Carbine"], factory: "weapon", attachmentPoint: "weapon_attachment_points", finish: "metal" },
  { category: "secondary_weapon", slot: "secondary_weapon", kind: "weapon", names: ["DZN Sidearm-9", "DZN Heavy Pistol", "DZN Compact PDW", "DZN Signal Revolver", "DZN Field Sidearm", "DZN Warden Pistol"], factory: "weapon", attachmentPoint: "weapon_attachment_points", finish: "metal" },
  { category: "melee_weapon", slot: "melee_weapon", kind: "weapon", names: ["DZN Tactical Knife", "DZN Breach Axe", "DZN Survival Blade", "DZN Field Machete", "DZN Signal Baton"], factory: "weapon", attachmentPoint: "weapon_attachment_points", finish: "metal" },
  { category: "throwable", slot: "throwable", kind: "weapon", names: ["DZN Smoke Canister", "DZN Signal Flare", "DZN Field Marker", "DZN Relay Beacon"], factory: "weapon", attachmentPoint: "equipment_attachment_points", finish: "metal" },
  { category: "primary_skin", slot: "primary_skin", kind: "attachment", names: ["Matte Black Finish", "Signal Cyan Finish", "Emerald Grid Camo", "Amber Field Camo", "Violet Night Camo", "Ridge Digital Camo", "Cinder Stripe Finish", "Warden Carbon Finish", "Pathfinder Dust Camo", "Sentinel White Finish", "Community Green Finish", "DZN Icon Finish"], factory: "weapon", finish: "holographic" },
  { category: "secondary_skin", slot: "secondary_skin", kind: "attachment", names: ["Sidearm Matte Finish", "Sidearm Signal Cyan", "Sidearm Emerald Grid", "Sidearm Amber Field", "Sidearm Violet Night", "Sidearm Ridge Digital", "Sidearm Cinder Stripe", "Sidearm Warden Carbon", "Sidearm Pathfinder Dust", "Sidearm Icon Finish", "Sidearm Community Green", "Sidearm Sentinel White"], factory: "weapon", finish: "holographic" },
  { category: "optic", slot: "optic", kind: "attachment", names: ["Iron Sight", "Signal Reflex", "Recon Dot", "Warden Tube", "Night Prism", "Pathfinder Scope", "Cyan Relay Sight", "Sentinel Range Sight"], factory: "weapon", attachmentPoint: "weapon_attachment_points", finish: "metal" },
  { category: "muzzle", slot: "muzzle", kind: "attachment", names: ["Standard Muzzle", "Signal Brake", "Recon Compensator", "Warden Flash Guard", "Nightline Suppressor", "Cyan Relay Tip"], factory: "weapon", attachmentPoint: "weapon_attachment_points", finish: "metal" },
  { category: "stock", slot: "stock", kind: "attachment", names: ["Standard Stock", "Signal Stock", "Recon Folding Stock", "Warden Heavy Stock", "Pathfinder Skeleton Stock", "Cyan Relay Stock"], factory: "weapon", attachmentPoint: "weapon_attachment_points", finish: "polymer" },
  { category: "magazine", slot: "magazine", kind: "attachment", names: ["Standard Magazine", "Signal Magazine", "Recon Short Magazine", "Warden Box Magazine", "Pathfinder Mag", "Cyan Relay Magazine"], factory: "weapon", attachmentPoint: "weapon_attachment_points", finish: "metal" },
  { category: "weapon_charm", slot: "weapon_charm", kind: "attachment", names: ["DZN Relay Charm", "Signal Coin", "Recon Token", "Warden Shield Charm", "Night Spark", "Pathfinder Arrow Charm", "Vanguard Tag", "Community Loop", "Event Medal Charm", "Icon Prism Charm"], factory: "accessory", attachmentPoint: "weapon_attachment_points", finish: "holographic" },
  { category: "pose", slot: "pose", kind: "presentation", names: ["Standard Ready", "Patrol Hold", "Vanguard Guard", "Recon Scan", "Warden Stand", "Pathfinder Kneel", "Victory Angle", "Operator Spotlight"], factory: "body", finish: "matte" },
  { category: "card_background", slot: "card_background", kind: "presentation", names: ["Zinc Grid", "Signal Command", "Emerald Network", "Amber Field", "Violet Season", "Ridge Tactical", "Night Relay", "DZN Icon Field"], factory: "accessory", finish: "holographic" },
  { category: "card_frame", slot: "card_frame", kind: "presentation", names: ["Standard Slate", "Signal Cyan", "Emerald Frame", "Amber Field Frame", "Violet Legend Frame", "Warden Steel", "Pathfinder Trim", "DZN Icon Frame"], factory: "accessory", finish: "holographic" },
  { category: "entrance_animation", slot: "entrance_animation", kind: "presentation", names: ["Static Signal", "Relay Burst", "Grid Rise", "Night Drop"], factory: "accessory", finish: "holographic" },
  { category: "victory_animation", slot: "victory_animation", kind: "presentation", names: ["Field Salute", "Crown Flare", "Signal Sweep", "Vanguard Mark"], factory: "accessory", finish: "holographic" },
  { category: "profile_accent", slot: "profile_accent", kind: "presentation", names: ["Cyan Accent", "Emerald Accent", "Amber Accent", "Violet Accent", "Slate Accent", "Cinder Accent", "Warden Accent", "Pathfinder Accent", "Community Accent", "Icon Accent"], factory: "accessory", finish: "holographic" },
  { category: "rank_emblem", slot: "rank_emblem", kind: "presentation", names: ["Recruit Emblem", "Scout Emblem", "Tracker Emblem", "Pathfinder Emblem", "Vanguard Emblem", "Warden Emblem", "Sentinel Emblem", "Commander Emblem", "Elite Commander Emblem", "Network Champion Emblem", "Network Legend Emblem", "DZN Icon Emblem"], factory: "accessory", attachmentPoint: "emblem_attachment", finish: "holographic" },
  { category: "title", slot: "title", kind: "presentation", names: ["Signal Recruit", "Field Scout", "Grid Runner", "Pathfinder", "Vanguard", "Warden", "Sentinel", "Commander", "Elite Commander", "Network Champion", "Network Legend", "DZN Icon"], factory: "accessory", finish: "holographic" },
  { category: "power", slot: "power", kind: "power", names: ["Recon Pulse", "Field Medic", "Pathfinder", "Night Operations", "Warden Shield", "Engineer", "Tracker", "Survivalist", "Vanguard", "Community Leader", "Event Specialist", "Network Scout"], factory: "power", attachmentPoint: "emblem_attachment", finish: "holographic", source: "Cosmetic power module" },
];

export const FULL_OPERATOR_CATALOG = [
  ...FULL_OPERATOR_BODY_PRESET_ITEMS.map(([id, displayName, description], index) => createItem({
    id,
    displayName,
    description,
    category: "body",
    slot: "body_preset",
    kind: "identity",
    index,
    entitlement: "free",
    factory: "body",
    finish: "matte",
    source: "Starter body preset",
  })),
  ...seedDefinitions.flatMap((definition) => definition.names.map((name, index) => createItem({
    id: `${definition.category}-${slug(name)}`,
    displayName: name,
    description: buildDescription(name, definition),
    category: definition.category,
    slot: definition.slot,
    kind: definition.kind,
    index,
    entitlement: definition.entitlement ?? (index < 2 ? "free" : "premium"),
    factory: definition.factory,
    attachmentPoint: definition.attachmentPoint,
    finish: definition.finish,
    baseLevel: definition.baseLevel,
    source: definition.source,
  }))),
] satisfies FullOperatorCatalogItem[];

export const FULL_OPERATOR_DEFAULT_ITEM_IDS: Record<FullOperatorCategory, string> = Object.fromEntries(
  Array.from(new Set(FULL_OPERATOR_CATALOG.map((item) => item.category))).map((category) => {
    const freeItem = FULL_OPERATOR_CATALOG.find((item) => item.category === category && item.entitlement === "free");
    const firstItem = FULL_OPERATOR_CATALOG.find((item) => item.category === category);
    if (!freeItem && !firstItem) throw new Error(`Missing full operator category: ${category}`);
    return [category, (freeItem ?? firstItem)?.id];
  }),
) as Record<FullOperatorCategory, string>;

export function getFullOperatorCatalogItems(category?: FullOperatorCategory): FullOperatorCatalogItem[] {
  return category ? FULL_OPERATOR_CATALOG.filter((item) => item.category === category) : FULL_OPERATOR_CATALOG;
}

export function getFullOperatorItem(itemId: string | null | undefined): FullOperatorCatalogItem | null {
  if (!itemId) return null;
  return FULL_OPERATOR_CATALOG.find((item) => item.id === itemId) ?? null;
}

export function getFullOperatorDefaultItem(category: FullOperatorCategory): FullOperatorCatalogItem {
  const item = getFullOperatorItem(FULL_OPERATOR_DEFAULT_ITEM_IDS[category]);
  if (!item) throw new Error(`Missing default item for ${category}`);
  return item;
}

function createItem({
  id,
  displayName,
  description,
  category,
  slot,
  kind,
  index,
  entitlement,
  factory,
  attachmentPoint,
  finish,
  baseLevel,
  source,
}: {
  id: string;
  displayName: string;
  description: string;
  category: FullOperatorCategory;
  slot: string;
  kind: FullOperatorItemKind;
  index: number;
  entitlement: FullOperatorEntitlement;
  factory: FullOperatorCatalogItem["geometry"]["factory"];
  attachmentPoint?: FullOperatorCatalogItem["geometry"]["attachmentPoint"];
  finish: FullOperatorCatalogItem["material"]["finish"];
  baseLevel?: number;
  source?: string;
}): FullOperatorCatalogItem {
  const rarity = getRarity(index, entitlement);
  const levelRequirement = entitlement === "free" ? 1 : Math.max(2, (baseLevel ?? 2) + index);
  return {
    id,
    displayName,
    description,
    category,
    slot,
    kind,
    rarity,
    entitlement,
    levelRequirement,
    unlockCondition: {
      type: entitlement === "free" ? "starter" : category.includes("weapon") || category === "primary_skin" || category === "secondary_skin" ? "weapon_mastery" : "operator_level",
      description: entitlement === "free"
        ? "Available to every DZN Operator from the standard starter kit."
        : `Unlock at Operator level ${levelRequirement} through fixed cosmetic progression.`,
    },
    compatibleBodyPresets: getCompatibleBodyPresets(category, displayName),
    material: getMaterial(category, index, finish),
    geometry: {
      factory,
      silhouette: `${category}-${index + 1}`,
      attachmentPoint,
      scale: 0.86 + (index % 5) * 0.045,
    },
    accessibilityLabel: `${displayName}, ${rarity} ${FULL_OPERATOR_CATEGORY_LABELS[category]} cosmetic, ${entitlement} entitlement, level ${levelRequirement}.`,
    previewLabel: `${displayName} - ${FULL_OPERATOR_CATEGORY_LABELS[category]}`,
    fixedUnlockSource: source ?? (entitlement === "free" ? "Standard DZN starter identity" : `Fixed Operator level ${levelRequirement} reward`),
  };
}

function getCompatibleBodyPresets(category: FullOperatorCategory, displayName: string): FullOperatorBodyPresetId[] {
  if (category === "chest_plate" && /DZN Icon|Warden Shield|Vanguard/i.test(displayName)) {
    return ["assault", "heavy"];
  }
  if (category === "outerwear" && /Legend Grid|Warden Plate/i.test(displayName)) {
    return ["standard", "assault", "heavy", "tall"];
  }
  return [...FULL_OPERATOR_BODY_PRESETS] as FullOperatorBodyPresetId[];
}

function buildDescription(name: string, definition: SeedDefinition): string {
  if (definition.kind === "weapon") return `${name} is an original DZN display weapon for Operator identity only. It has no damage, recoil, accuracy, or combat-performance value.`;
  if (definition.kind === "attachment") return `${name} is an original DZN visual attachment or finish for showcase loadouts only.`;
  if (definition.kind === "power") return `${name} changes Operator aura, card styling, or challenge grouping only and never alters scoring, XP, eligibility, voting, matchmaking, or rewards.`;
  return `${name} is an original DZN ${FULL_OPERATOR_CATEGORY_LABELS[definition.category].toLowerCase()} option for cosmetic identity and presentation only.`;
}

function getRarity(index: number, entitlement: FullOperatorEntitlement): FullOperatorRarity {
  if (entitlement === "free") return index === 0 ? "starter" : "field";
  if (index > 9) return "legendary";
  if (index > 6) return "elite";
  if (index > 3) return "rare";
  return "field";
}

function getMaterial(category: FullOperatorCategory, index: number, finish: FullOperatorCatalogItem["material"]["finish"]) {
  const palettes = [
    ["#22d3ee", "#0f172a", "#84cc16"],
    ["#10b981", "#111827", "#67e8f9"],
    ["#f97316", "#1c1917", "#fde047"],
    ["#8b5cf6", "#020617", "#c4b5fd"],
    ["#94a3b8", "#0f172a", "#22c55e"],
    ["#eab308", "#1f2937", "#fb7185"],
  ];
  const palette = palettes[(category.length + index) % palettes.length];
  return {
    primary: palette[0],
    secondary: palette[1],
    accent: palette[2],
    finish,
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
