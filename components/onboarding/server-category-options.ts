export const SERVER_CATEGORY_OPTIONS = [
  { value: "deathmatch", label: "Deathmatch" },
  { value: "pvp", label: "PvP" },
  { value: "pve", label: "PvE" },
  { value: "pvp_pve", label: "PvP / PvE" },
  { value: "hardcore", label: "Hardcore" },
  { value: "roleplay", label: "Roleplay" },
  { value: "faction_wars", label: "Faction Wars" },
  { value: "vanilla", label: "Vanilla" },
  { value: "modded", label: "Modded" },
] as const;

export type ServerCategoryValue = typeof SERVER_CATEGORY_OPTIONS[number]["value"];

export function getServerCategoryOption(value?: string | null) {
  return SERVER_CATEGORY_OPTIONS.find((option) => option.value === value) ?? null;
}

export function isServerCategoryValue(value: string): value is ServerCategoryValue {
  return SERVER_CATEGORY_OPTIONS.some((option) => option.value === value);
}
