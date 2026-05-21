export const SERVER_CATEGORIES = [
  "deathmatch",
  "pvp",
  "pve",
  "pvp_pve",
  "hardcore",
  "roleplay",
  "faction_wars",
  "vanilla",
  "modded",
] as const;

export type ServerCategory = typeof SERVER_CATEGORIES[number];

const CATEGORY_LABELS: Record<ServerCategory, string> = {
  deathmatch: "Deathmatch",
  pvp: "PvP",
  pve: "PvE",
  pvp_pve: "PvP/PvE",
  hardcore: "Hardcore",
  roleplay: "Roleplay",
  faction_wars: "Faction Wars",
  vanilla: "Vanilla",
  modded: "Modded",
};

const CATEGORY_THEMES: Record<ServerCategory, {
  accent: string;
  border: string;
  glow: string;
}> = {
  deathmatch: { accent: "#fb7185", border: "rgba(251,113,133,0.42)", glow: "rgba(251,113,133,0.22)" },
  pvp: { accent: "#f97316", border: "rgba(249,115,22,0.42)", glow: "rgba(249,115,22,0.22)" },
  pve: { accent: "#22d3ee", border: "rgba(34,211,238,0.42)", glow: "rgba(34,211,238,0.2)" },
  pvp_pve: { accent: "#a78bfa", border: "rgba(167,139,250,0.44)", glow: "rgba(167,139,250,0.24)" },
  hardcore: { accent: "#f43f5e", border: "rgba(244,63,94,0.42)", glow: "rgba(244,63,94,0.22)" },
  roleplay: { accent: "#38bdf8", border: "rgba(56,189,248,0.42)", glow: "rgba(56,189,248,0.18)" },
  faction_wars: { accent: "#c084fc", border: "rgba(192,132,252,0.44)", glow: "rgba(192,132,252,0.24)" },
  vanilla: { accent: "#e2e8f0", border: "rgba(226,232,240,0.28)", glow: "rgba(226,232,240,0.12)" },
  modded: { accent: "#60a5fa", border: "rgba(96,165,250,0.38)", glow: "rgba(96,165,250,0.18)" },
};

export type ServerCategoryInput = {
  server_category?: unknown;
  category?: unknown;
  server_type?: unknown;
  server_mode?: unknown;
  mode?: unknown;
} | null | undefined;

export class ServerCategoryMismatchError extends Error {
  code = "CATEGORY_MISMATCH" as const;

  constructor(message = "Only servers in the same category can compete in this event.") {
    super(message);
    this.name = "ServerCategoryMismatchError";
  }
}

export function normalizeServerCategory(input: unknown): ServerCategory | null {
  const raw = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ");

  if (!raw) return null;
  if (["deathmatch", "dm", "death match", "death-match", "death_match"].includes(raw)) return "deathmatch";
  if (["pvp", "pvp only", "pvp_only", "pvp-only", "player versus player"].includes(raw)) return "pvp";
  if (["pve", "pve only", "pve_only", "pve-only", "player versus environment"].includes(raw)) return "pve";
  if (["pvp/pve", "pvp / pve", "pvp_pve", "pvp-pve", "pvpve", "mixed", "hybrid"].includes(raw)) return "pvp_pve";
  if (["hardcore", "hc", "hard core"].includes(raw)) return "hardcore";
  if (["roleplay", "rp", "role play", "role-play"].includes(raw)) return "roleplay";
  if (["faction wars", "faction_wars", "faction-wars", "factions", "faction"].includes(raw)) return "faction_wars";
  if (["vanilla", "official-like", "official like"].includes(raw)) return "vanilla";
  if (["modded", "modded server", "mods"].includes(raw)) return "modded";
  return null;
}

export function normalizeServerCategoryFromRecord(input: ServerCategoryInput): ServerCategory | null {
  if (!input) return null;
  return normalizeServerCategory(input.server_category)
    ?? normalizeServerCategory(input.category)
    ?? normalizeServerCategory(input.server_type)
    ?? normalizeServerCategory(input.server_mode)
    ?? normalizeServerCategory(input.mode);
}

export function assertSameServerCategory(serverA: ServerCategoryInput, serverB: ServerCategoryInput): ServerCategory {
  const categoryA = normalizeServerCategoryFromRecord(serverA);
  const categoryB = normalizeServerCategoryFromRecord(serverB);
  if (!categoryA || !categoryB || categoryA !== categoryB) {
    throw new ServerCategoryMismatchError();
  }
  return categoryA;
}

export function getServerCategoryLabel(category: unknown) {
  const normalized = normalizeServerCategory(category);
  return normalized ? CATEGORY_LABELS[normalized] : "Unclassified";
}

export function getServerCategoryTheme(category: unknown) {
  const normalized = normalizeServerCategory(category) ?? "modded";
  return CATEGORY_THEMES[normalized];
}

export function categoryMismatchPayload() {
  return {
    ok: false,
    error: "CATEGORY_MISMATCH",
    message: "Only servers in the same category can compete in this event.",
  };
}
