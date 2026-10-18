export const COMMAND_CENTRE_BUILDINGS = ["headquarters", "workshop", "watchtower", "communications"] as const;
export type CommandCentreBuilding = typeof COMMAND_CENTRE_BUILDINGS[number];

export type CommandCentreUpgrade = {
  parts: number;
  requiredXp: number;
  durationMs: number;
};

export const COMMAND_CENTRE_TIERS = ["Ruined Camp", "Outpost", "Fort", "Stronghold", "Citadel"] as const;

export const COMMAND_CENTRE_UPGRADES: Record<2 | 3 | 4 | 5, CommandCentreUpgrade> = {
  2: { parts: 8, requiredXp: 80, durationMs: 30 * 60_000 },
  3: { parts: 18, requiredXp: 260, durationMs: 2 * 60 * 60_000 },
  4: { parts: 36, requiredXp: 600, durationMs: 6 * 60 * 60_000 },
  5: { parts: 64, requiredXp: 1100, durationMs: 12 * 60 * 60_000 },
};

export const COMMAND_CENTRE_BUILDING_COPY: Record<CommandCentreBuilding, { name: string; short: string }> = {
  headquarters: { name: "Headquarters", short: "Sets the settlement tier and unlocks higher construction." },
  workshop: { name: "Workshop", short: "Turns verified Games Hub parts into durable player progression." },
  watchtower: { name: "Watchtower", short: "Extends the Command Centre’s long-range operational view." },
  communications: { name: "Comms Array", short: "Anchors the settlement’s network presence without changing live chat access." },
};

export function isCommandCentreBuilding(value: unknown): value is CommandCentreBuilding {
  return typeof value === "string" && (COMMAND_CENTRE_BUILDINGS as readonly string[]).includes(value);
}

export function getCommandCentreUpgrade(level: number): CommandCentreUpgrade | null {
  if (!Number.isInteger(level) || level < 1 || level >= 5) return null;
  return COMMAND_CENTRE_UPGRADES[(level + 1) as 2 | 3 | 4 | 5];
}

export type CommandCentreBuildingView = {
  building: CommandCentreBuilding;
  level: number;
  targetLevel: number | null;
  constructionStartedAt: number | null;
  completesAt: number | null;
  version: number;
  nextUpgrade: CommandCentreUpgrade | null;
  blockedByHeadquarters: boolean;
};

export type CommandCentrePayload = {
  serverTime: number;
  profile: { createdAt: number; updatedAt: number; tier: string } | null;
  resources: { xp: number; partsEarned: number; partsSpent: number; partsAvailable: number };
  buildings: CommandCentreBuildingView[];
};
