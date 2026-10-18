export const SURVIVAL_COMMAND_SECTORS = {
  perimeter: {
    name: "Perimeter sweep",
    coordinate: "GRID 02 / 18",
    briefing: "Trace a broken supply line through the outer woods before the trail goes cold.",
    headquartersLevel: 1,
    workshopLevel: 1,
    watchtowerLevel: 1,
    communicationsLevel: 1,
    deploymentCost: 1,
    durationMs: 6 * 60_000,
    reward: { salvage: [4, 8], intel: [1, 2] },
  },
  rail_yard: {
    name: "Rail-yard recovery",
    coordinate: "GRID 07 / 11",
    briefing: "Recover components from a stalled freight yard while the weather closes in.",
    headquartersLevel: 2,
    workshopLevel: 2,
    watchtowerLevel: 1,
    communicationsLevel: 1,
    deploymentCost: 2,
    durationMs: 14 * 60_000,
    reward: { salvage: [9, 15], intel: [2, 4] },
  },
  radio_ridge: {
    name: "Radio ridge",
    coordinate: "GRID 14 / 04",
    briefing: "Reach an abandoned relay position and determine which signal is still transmitting.",
    headquartersLevel: 3,
    workshopLevel: 2,
    watchtowerLevel: 2,
    communicationsLevel: 2,
    deploymentCost: 2,
    durationMs: 22 * 60_000,
    reward: { salvage: [13, 21], intel: [4, 7] },
  },
  blacksite: {
    name: "Cold blacksite",
    coordinate: "GRID 19 / 22",
    briefing: "Survey a sealed military compound. The route is exposed, but the cache may change the settlement's reach.",
    headquartersLevel: 4,
    workshopLevel: 3,
    watchtowerLevel: 3,
    communicationsLevel: 3,
    deploymentCost: 3,
    durationMs: 36 * 60_000,
    reward: { salvage: [22, 34], intel: [7, 11] },
  },
} as const;

export type SurvivalCommandSector = keyof typeof SURVIVAL_COMMAND_SECTORS;
export const SURVIVAL_COMMAND_SECTOR_KEYS = Object.keys(SURVIVAL_COMMAND_SECTORS) as SurvivalCommandSector[];

export const SURVIVAL_COMMAND_APPROACHES = {
  scout: { name: "Scout route", detail: "Lower exposure. Favors signal intelligence over raw salvage." },
  balanced: { name: "Balanced route", detail: "A controlled recovery plan for a stable return." },
  breach: { name: "Breach route", detail: "Commit to the fastest recovery path and accept higher exposure." },
} as const;
export type SurvivalCommandApproach = keyof typeof SURVIVAL_COMMAND_APPROACHES;
export const SURVIVAL_COMMAND_APPROACH_KEYS = Object.keys(SURVIVAL_COMMAND_APPROACHES) as SurvivalCommandApproach[];

export const SURVIVAL_COMMAND_INCIDENTS = {
  signal: {
    title: "Unmarked transmission",
    detail: "A narrowband signal repeats from beyond the original search route.",
    actions: ["triangulate", "secure", "ignore"],
  },
  cache: {
    title: "Unstable cache",
    detail: "A damaged field cache is still accessible, but movement around it is drawing attention.",
    actions: ["extract", "stabilize", "mark"],
  },
  crossing: {
    title: "Broken crossing",
    detail: "The planned way out has failed. The team must choose what it risks to return with.",
    actions: ["reroute", "bridge", "hold"],
  },
} as const;
export type SurvivalCommandIncident = keyof typeof SURVIVAL_COMMAND_INCIDENTS;
export type SurvivalCommandAction = (typeof SURVIVAL_COMMAND_INCIDENTS)[SurvivalCommandIncident]["actions"][number];

export type SurvivalCommandBuildingLevels = {
  headquarters: number;
  workshop: number;
  watchtower: number;
  communications: number;
};

export type SurvivalCommandOutcome = "clean" | "strained" | "breakthrough";

export type SurvivalCommandSectorView = {
  key: SurvivalCommandSector;
  name: string;
  coordinate: string;
  briefing: string;
  deploymentCost: number;
  durationMs: number;
  reward: { salvage: readonly [number, number]; intel: readonly [number, number] };
  unlocked: boolean;
  lockReason: string | null;
};

export type SurvivalCommandExpedition = {
  id: string;
  sector: SurvivalCommandSector;
  approach: SurvivalCommandApproach;
  startedAt: number;
  readyAt: number;
  version: number;
  state: "in-transit" | "ready";
  incident: { key: SurvivalCommandIncident; title: string; detail: string; actions: readonly string[] } | null;
};

export type SurvivalCommandHistory = {
  id: string;
  sector: SurvivalCommandSector;
  approach: SurvivalCommandApproach;
  outcome: SurvivalCommandOutcome;
  action: string;
  salvage: number;
  intel: number;
  resolvedAt: number;
};

export type SurvivalCommandPayload = {
  serverTime: number;
  profile: { establishedAt: number } | null;
  resources: { salvage: number; intel: number; resolvedExpeditions: number };
  deployment: { used: number; capacity: number; dayKey: string };
  buildings: SurvivalCommandBuildingLevels | null;
  sectors: SurvivalCommandSectorView[];
  expedition: SurvivalCommandExpedition | null;
  history: SurvivalCommandHistory[];
};

export function isSurvivalCommandSector(value: unknown): value is SurvivalCommandSector {
  return typeof value === "string" && SURVIVAL_COMMAND_SECTOR_KEYS.includes(value as SurvivalCommandSector);
}

export function isSurvivalCommandApproach(value: unknown): value is SurvivalCommandApproach {
  return typeof value === "string" && SURVIVAL_COMMAND_APPROACH_KEYS.includes(value as SurvivalCommandApproach);
}

export function sectorLockReason(sector: SurvivalCommandSector, buildings: SurvivalCommandBuildingLevels | null) {
  if (!buildings) return "Establish your Command Centre before deploying a field team.";
  const requirements = SURVIVAL_COMMAND_SECTORS[sector];
  const missing = [
    ["Headquarters", buildings.headquarters, requirements.headquartersLevel],
    ["Workshop", buildings.workshop, requirements.workshopLevel],
    ["Watchtower", buildings.watchtower, requirements.watchtowerLevel],
    ["Comms Array", buildings.communications, requirements.communicationsLevel],
  ].find(([, current, required]) => Number(current) < Number(required));
  return missing ? `${missing[0]} must reach Level ${missing[2]} first.` : null;
}

export function deploymentCapacity(buildings: SurvivalCommandBuildingLevels | null) {
  return buildings ? 3 + Math.max(0, Math.min(2, buildings.communications - 1)) : 0;
}

function hash(value: string) {
  let output = 2166136261;
  for (let index = 0; index < value.length; index++) {
    output ^= value.charCodeAt(index);
    output = Math.imul(output, 16777619);
  }
  return output >>> 0;
}

export function incidentForSeed(seed: string): SurvivalCommandIncident {
  const keys = Object.keys(SURVIVAL_COMMAND_INCIDENTS) as SurvivalCommandIncident[];
  return keys[hash(`${seed}:incident`) % keys.length];
}

export function validIncidentAction(incident: SurvivalCommandIncident, action: unknown): action is SurvivalCommandAction {
  return typeof action === "string" && (SURVIVAL_COMMAND_INCIDENTS[incident].actions as readonly string[]).includes(action);
}

export function resolveSurvivalCommandOutcome(input: {
  seed: string;
  sector: SurvivalCommandSector;
  approach: SurvivalCommandApproach;
  action: SurvivalCommandAction;
  buildings: SurvivalCommandBuildingLevels;
}) {
  const sector = SURVIVAL_COMMAND_SECTORS[input.sector];
  const roll = hash(`${input.seed}:${input.approach}:${input.action}:outcome`) % 100;
  const approachShift = input.approach === "scout" ? { salvage: -1, intel: 2, threshold: 16 }
    : input.approach === "breach" ? { salvage: 3, intel: -1, threshold: 30 }
      : { salvage: 1, intel: 1, threshold: 23 };
  const actionShift = hash(`${input.action}:action`) % 3;
  const workshopBonus = Math.max(0, input.buildings.workshop - 1);
  const watchtowerBonus = Math.max(0, input.buildings.watchtower - 1);
  const outcome: SurvivalCommandOutcome = roll < 14 ? "strained" : roll < approachShift.threshold + workshopBonus * 2 ? "breakthrough" : "clean";
  const salvageBase = sector.reward.salvage[0] + hash(`${input.seed}:salvage`) % (sector.reward.salvage[1] - sector.reward.salvage[0] + 1);
  const intelBase = sector.reward.intel[0] + hash(`${input.seed}:intel`) % (sector.reward.intel[1] - sector.reward.intel[0] + 1);
  const multiplier = outcome === "breakthrough" ? 1.45 : outcome === "strained" ? 0.55 : 1;
  const salvage = Math.max(1, Math.floor((salvageBase + approachShift.salvage + actionShift + workshopBonus) * multiplier));
  const intel = Math.max(1, Math.floor((intelBase + approachShift.intel + watchtowerBonus) * multiplier));
  const detail = outcome === "breakthrough"
    ? "The field decision opened a secondary route. The return team brought back more than the original brief predicted."
    : outcome === "strained"
      ? "The team returned under pressure. The recovery was reduced, but the operation was not lost."
      : "The team completed the recovery plan and returned with a clean operational record.";
  return { outcome, salvage, intel, detail, fingerprint: hash(`${input.seed}:${input.approach}:${input.action}:${outcome}:${salvage}:${intel}`).toString(16).padStart(8, "0") };
}
