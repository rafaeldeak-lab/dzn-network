export type SupportedMapKey = "chernarusplus" | "livonia" | "sakhal";

export type DznMapConfig = {
  key: SupportedMapKey;
  displayName: string;
  aliases: string[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  gridSize: number;
  publicAssetPath: string | null;
  boundsConfidence: "verified" | "estimated";
};

export const DZN_MAP_CONFIGS: Record<SupportedMapKey, DznMapConfig> = {
  chernarusplus: {
    key: "chernarusplus",
    displayName: "ChernarusPlus",
    aliases: ["chernarusplus", "chernarus", "chernarus plus", "dayzoffline.chernarusplus"],
    minX: 0,
    maxX: 15360,
    minY: 0,
    maxY: 15360,
    gridSize: 128,
    publicAssetPath: null,
    boundsConfidence: "estimated",
  },
  livonia: {
    key: "livonia",
    displayName: "Livonia",
    aliases: ["livonia", "enoch", "dayzoffline.enoch"],
    minX: 0,
    maxX: 12800,
    minY: 0,
    maxY: 12800,
    gridSize: 128,
    publicAssetPath: null,
    boundsConfidence: "estimated",
  },
  sakhal: {
    key: "sakhal",
    displayName: "Sakhal",
    aliases: ["sakhal", "dayzoffline.sakhal"],
    minX: 0,
    maxX: 15360,
    minY: 0,
    maxY: 15360,
    gridSize: 128,
    publicAssetPath: null,
    boundsConfidence: "estimated",
  },
};

export function resolveDznMapConfig(value: unknown): DznMapConfig | null {
  const normalized = normalizeMapAlias(value);
  if (!normalized) return null;
  return Object.values(DZN_MAP_CONFIGS).find((config) => config.aliases.some((alias) => normalizeMapAlias(alias) === normalized)) ?? null;
}

export function normalizeMapAlias(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
}
