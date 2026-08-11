import type {
  OperatorCatalog,
  OperatorCosmeticItem,
  OperatorCosmeticSlot,
} from "./types";

export const DEFAULT_OPERATOR_ID = "dzn-standard-operator";

export const STARTER_ITEM_IDS_BY_SLOT: Record<OperatorCosmeticSlot, string> = {
  head: "starter-signal-cap",
  face: "starter-clear-visor",
  hair: "starter-low-crop",
  upper_body: "starter-field-jacket",
  lower_body: "starter-field-trousers",
  outerwear: "starter-weather-shell",
  hands: "starter-grip-gloves",
  feet: "starter-trail-boots",
  back: "starter-scout-pack",
  armour: "starter-soft-plate",
  utility: "starter-map-kit",
  accessories: "starter-identity-tag",
  pose: "pose-standard-ready",
  background: "background-zinc-grid",
  frame: "frame-standard-slate",
  entrance_animation: "entrance-static-signal",
  victory_animation: "victory-field-salute",
};

const starterItems: OperatorCosmeticItem[] = [
  item("starter-signal-cap", "Signal Cap", "A standard DZN field cap with a muted relay mark.", "head", "starter", "free", "#475569", "solid"),
  item("starter-clear-visor", "Clear Visor", "Neutral face protection for the default operator identity.", "face", "starter", "free", "#94a3b8", "solid"),
  item("starter-low-crop", "Low Crop", "A clean low-profile starter hair silhouette.", "hair", "starter", "free", "#27272a", "solid"),
  item("starter-field-jacket", "Field Jacket", "A standard DZN utility jacket for every competitor.", "upper_body", "starter", "free", "#164e63", "chevron"),
  item("starter-field-trousers", "Field Trousers", "Durable standard trousers with no competitive modifiers.", "lower_body", "starter", "free", "#334155", "grid"),
  item("starter-weather-shell", "Weather Shell", "A simple outer shell for the standard DZN profile.", "outerwear", "starter", "free", "#0f172a", "solid"),
  item("starter-grip-gloves", "Grip Gloves", "Starter gloves used only for visual identity.", "hands", "starter", "free", "#1e293b", "solid"),
  item("starter-trail-boots", "Trail Boots", "Standard profile boots with no gameplay impact.", "feet", "starter", "free", "#292524", "solid"),
  item("starter-scout-pack", "Scout Pack", "A compact pack for visual profile composition.", "back", "starter", "free", "#155e75", "grid"),
  item("starter-soft-plate", "Soft Plate", "Cosmetic plate carrier shape without protection stats.", "armour", "starter", "free", "#374151", "solid"),
  item("starter-map-kit", "Map Kit", "A utility silhouette for the operator card only.", "utility", "starter", "free", "#0e7490", "signal"),
  item("starter-identity-tag", "Identity Tag", "The starter DZN identity marker.", "accessories", "starter", "free", "#a3e635", "halo"),
  item("pose-standard-ready", "Standard Ready", "Neutral front-facing stance for the standard operator.", "pose", "starter", "free", "#22d3ee", "solid"),
  item("background-zinc-grid", "Zinc Grid", "A quiet network-grid operator card background.", "background", "starter", "free", "#18181b", "grid"),
  item("frame-standard-slate", "Standard Slate", "The basic DZN Operator Card frame.", "frame", "starter", "free", "#64748b", "solid"),
  item("entrance-static-signal", "Static Signal", "A basic signal sweep entrance treatment.", "entrance_animation", "starter", "free", "#38bdf8", "signal"),
  item("victory-field-salute", "Field Salute", "A basic profile victory pose treatment.", "victory_animation", "starter", "free", "#22c55e", "solid"),
];

const premiumItems: OperatorCosmeticItem[] = [
  item("head-ember-hood", "Ember Hood", "A premium ember-lined hood for spotlight cards.", "head", "rare", "premium", "#f97316", "halo", "Founders Season"),
  item("face-ghost-band", "Ghost Band", "A premium geometric face band for operator cards.", "face", "elite", "premium", "#e5e7eb", "chevron"),
  item("hair-neon-crop", "Neon Crop", "A cyan-accent profile hair silhouette.", "hair", "rare", "premium", "#06b6d4", "signal"),
  item("upper-void-anorak", "Void Anorak", "A premium anorak with DZN signal striping.", "upper_body", "elite", "premium", "#7c3aed", "chevron"),
  item("lower-ridge-cargo", "Ridge Cargo", "Layered cargo profile trousers for premium loadouts.", "lower_body", "rare", "premium", "#57534e", "grid"),
  item("outer-aurora-coat", "Aurora Coat", "A premium long coat with aurora trim.", "outerwear", "legendary", "premium", "#14b8a6", "halo", "Winter Circuit"),
  item("hands-spark-gauntlets", "Spark Gauntlets", "Signal-lit gauntlets for visual presentation only.", "hands", "elite", "premium", "#facc15", "signal"),
  item("feet-blacksite-boots", "Blacksite Boots", "Premium boots for a sharper card silhouette.", "feet", "rare", "premium", "#111827", "solid"),
  item("back-relay-rig", "Relay Rig", "A premium back rig shaped around DZN relay geometry.", "back", "elite", "premium", "#0891b2", "grid"),
  item("armour-night-plate", "Night Plate", "A cosmetic plate carrier with no protection value.", "armour", "elite", "premium", "#312e81", "chevron"),
  item("utility-contract-slate", "Contract Slate", "A premium utility plate for contract spotlights.", "utility", "rare", "premium", "#f59e0b", "solid"),
  item("accessory-crown-pin", "Crown Pin", "A premium card accessory for earned spotlight moments.", "accessories", "legendary", "premium", "#facc15", "halo"),
  item("pose-crosswind", "Crosswind", "A premium angled stance for operator cards.", "pose", "rare", "premium", "#a78bfa", "chevron"),
  item("pose-victor-profile", "Victor Profile", "A premium profile pose for winner spotlights.", "pose", "elite", "premium", "#fb7185", "signal"),
  item("background-aurora-map", "Aurora Map", "A premium map-lit operator background.", "background", "rare", "premium", "#0f766e", "grid", "Winter Circuit"),
  item("background-redline-contract", "Redline Contract", "A premium redline background for contract identity.", "background", "elite", "premium", "#dc2626", "signal"),
  item("frame-circuit-cyan", "Circuit Cyan", "A premium cyan Operator Card frame.", "frame", "rare", "premium", "#22d3ee", "grid"),
  item("frame-crown-gold", "Crown Gold", "A premium gold spotlight frame.", "frame", "legendary", "premium", "#f59e0b", "halo"),
  item("entrance-relay-burst", "Relay Burst", "A premium relay burst entrance animation.", "entrance_animation", "elite", "premium", "#06b6d4", "signal"),
  item("victory-crown-flare", "Crown Flare", "A premium victory flare animation for showcases.", "victory_animation", "legendary", "premium", "#facc15", "halo"),
];

export const DZN_OPERATOR_CATALOG: OperatorCatalog = {
  operators: [
    {
      id: DEFAULT_OPERATOR_ID,
      displayName: "DZN Standard Operator",
      callSign: "Signal One",
      description: "The default DZN identity available to every player without changing competition access.",
      default: true,
    },
  ],
  items: [...starterItems, ...premiumItems],
};

export function getCatalogItem(itemId: string, catalog: OperatorCatalog = DZN_OPERATOR_CATALOG) {
  return catalog.items.find((item) => item.id === itemId) ?? null;
}

export function getCatalogItemsForSlot(slot: OperatorCosmeticSlot, catalog: OperatorCatalog = DZN_OPERATOR_CATALOG) {
  return catalog.items.filter((item) => item.slot === slot);
}

export function getStarterItemForSlot(slot: OperatorCosmeticSlot, catalog: OperatorCatalog = DZN_OPERATOR_CATALOG) {
  return getCatalogItem(STARTER_ITEM_IDS_BY_SLOT[slot], catalog);
}

function item(
  id: string,
  displayName: string,
  description: string,
  slot: OperatorCosmeticSlot,
  rarity: OperatorCosmeticItem["rarity"],
  entitlement: OperatorCosmeticItem["entitlement"],
  swatch: string,
  pattern: NonNullable<OperatorCosmeticItem["preview"]["pattern"]>,
  seasonOrEventLabel?: string,
): OperatorCosmeticItem {
  return {
    id,
    displayName,
    description,
    slot,
    rarity,
    entitlement,
    compatibleOperatorIds: [DEFAULT_OPERATOR_ID],
    seasonOrEventLabel,
    preview: {
      swatch,
      accent: entitlement === "premium" ? "#f59e0b" : "#22d3ee",
      pattern,
    },
    accessibilityLabel: `${displayName}, ${entitlement} ${slot.replace(/_/g, " ")} cosmetic.`,
  };
}
