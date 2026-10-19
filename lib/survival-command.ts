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

export const SURVIVAL_COMMAND_LOADOUTS = {
  field_kit: {
    name: "Field kit",
    detail: "Standard recovery equipment. Reliable, but specialised field advantages remain unavailable.",
    workshopLevel: 1,
    cost: { salvage: 0, intel: 0 },
    salvageBonus: 0,
    intelBonus: 0,
    breakthroughBonus: 0,
    strainReduction: 0,
    preferredActions: [],
  },
  signal_scanner: {
    name: "Signal scanner",
    detail: "A tuned relay scanner that improves intelligence recovery and helps turn a clean scout route into a breakthrough.",
    workshopLevel: 1,
    cost: { salvage: 10, intel: 8 },
    salvageBonus: 0,
    intelBonus: 2,
    breakthroughBonus: 4,
    strainReduction: 0,
    preferredActions: ["triangulate"],
  },
  recovery_kit: {
    name: "Recovery kit",
    detail: "Reinforced extraction gear for high-value cache work. It improves salvage recovery when the team commits to the find.",
    workshopLevel: 2,
    cost: { salvage: 18, intel: 5 },
    salvageBonus: 3,
    intelBonus: 0,
    breakthroughBonus: 2,
    strainReduction: 0,
    preferredActions: ["extract", "stabilize"],
  },
  convoy_plating: {
    name: "Convoy plating",
    detail: "Armoured panels and route hardening. It reduces the chance of a strained return on exposed breach operations.",
    workshopLevel: 3,
    cost: { salvage: 30, intel: 12 },
    salvageBonus: 1,
    intelBonus: 0,
    breakthroughBonus: 2,
    strainReduction: 6,
    preferredActions: ["bridge", "hold"],
  },
} as const;
export type SurvivalCommandLoadout = keyof typeof SURVIVAL_COMMAND_LOADOUTS;
export const SURVIVAL_COMMAND_LOADOUT_KEYS = Object.keys(SURVIVAL_COMMAND_LOADOUTS) as SurvivalCommandLoadout[];

// The directive is calculated from the player and server deployment day. It
// gives a focused route objective without altering DayZ data or standings.
export const SURVIVAL_COMMAND_DAILY_DIRECTIVES = {
  quiet_trace: {
    name: "Quiet trace",
    detail: "Run a perimeter scout route and bring a clean signal picture back to command.",
    sector: "perimeter",
    approach: "scout",
    bonus: { salvage: 0, intel: 2 },
  },
  rail_recovery: {
    name: "Chainbreaker recovery",
    detail: "Hold the balanced route through the rail yard while the recovery window is open.",
    sector: "rail_yard",
    approach: "balanced",
    bonus: { salvage: 3, intel: 1 },
  },
  relay_ghost: {
    name: "Ghost relay",
    detail: "Take a scout route to Radio Ridge and secure fresh relay intelligence.",
    sector: "radio_ridge",
    approach: "scout",
    bonus: { salvage: 1, intel: 4 },
  },
  blacksite_window: {
    name: "Blacksite window",
    detail: "Commit a breach route into the Cold Blacksite before the window closes.",
    sector: "blacksite",
    approach: "breach",
    bonus: { salvage: 5, intel: 2 },
  },
} as const;
export type SurvivalCommandDailyDirectiveKey = keyof typeof SURVIVAL_COMMAND_DAILY_DIRECTIVES;
export type SurvivalCommandDailyDirective = {
  key: SurvivalCommandDailyDirectiveKey;
  name: string;
  detail: string;
  sector: SurvivalCommandSector;
  approach: SurvivalCommandApproach;
  bonus: { salvage: number; intel: number };
};

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

// These orders are chosen after arrival. They are deliberately a trade-off, rather
// than a hidden reward multiplier, so a player owns the tactical call they make.
export const SURVIVAL_COMMAND_FIELD_ORDERS = {
  overwatch: {
    name: "Overwatch protocol",
    detail: "Place the return corridor under watch. It protects the team, but leaves less time for recovery.",
    salvageShift: -2,
    intelShift: 1,
    breakthroughBonus: 1,
    strainReduction: 8,
  },
  intercept: {
    name: "Signal intercept",
    detail: "Commit the field unit to the live transmission. It favors intelligence and rare breakthroughs.",
    salvageShift: -1,
    intelShift: 3,
    breakthroughBonus: 6,
    strainReduction: 0,
  },
  recovery: {
    name: "Recovery priority",
    detail: "Secure the material first. It raises salvage potential, but makes the extraction less forgiving.",
    salvageShift: 4,
    intelShift: -1,
    breakthroughBonus: -3,
    strainReduction: -4,
  },
} as const;
export type SurvivalCommandFieldOrder = keyof typeof SURVIVAL_COMMAND_FIELD_ORDERS;
export const SURVIVAL_COMMAND_FIELD_ORDER_KEYS = Object.keys(SURVIVAL_COMMAND_FIELD_ORDERS) as SurvivalCommandFieldOrder[];

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
  loadout: SurvivalCommandLoadout;
  startedAt: number;
  readyAt: number;
  version: number;
  state: "in-transit" | "ready";
  fieldOrder: SurvivalCommandFieldOrder | null;
  incident: { key: SurvivalCommandIncident; title: string; detail: string; actions: readonly string[] } | null;
};

export type SurvivalCommandHistory = {
  id: string;
  sector: SurvivalCommandSector;
  approach: SurvivalCommandApproach;
  loadout: SurvivalCommandLoadout;
  outcome: SurvivalCommandOutcome;
  fieldOrder: SurvivalCommandFieldOrder | null;
  action: string;
  salvage: number;
  intel: number;
  resolvedAt: number;
};

export type SurvivalCommandPayload = {
  serverTime: number;
  profile: { establishedAt: number } | null;
  resources: {
    salvage: number;
    intel: number;
    salvageEarned: number;
    intelEarned: number;
    salvageSpent: number;
    intelSpent: number;
    resolvedExpeditions: number;
  };
  deployment: { used: number; capacity: number; dayKey: string };
  buildings: SurvivalCommandBuildingLevels | null;
  loadouts: Array<{
    key: SurvivalCommandLoadout;
    name: string;
    detail: string;
    unlocked: boolean;
    workshopLevel: number;
    cost: { salvage: number; intel: number };
    effect: string;
  }>;
  sectors: SurvivalCommandSectorView[];
  dailyDirective: SurvivalCommandDailyDirective & {
    dayKey: string;
    sectorUnlocked: boolean;
    completed: boolean;
  };
  fieldOrdersAvailable: boolean;
  expedition: SurvivalCommandExpedition | null;
  history: SurvivalCommandHistory[];
};

export function isSurvivalCommandSector(value: unknown): value is SurvivalCommandSector {
  return typeof value === "string" && SURVIVAL_COMMAND_SECTOR_KEYS.includes(value as SurvivalCommandSector);
}

export function isSurvivalCommandApproach(value: unknown): value is SurvivalCommandApproach {
  return typeof value === "string" && SURVIVAL_COMMAND_APPROACH_KEYS.includes(value as SurvivalCommandApproach);
}

export function isSurvivalCommandLoadout(value: unknown): value is SurvivalCommandLoadout {
  return typeof value === "string" && SURVIVAL_COMMAND_LOADOUT_KEYS.includes(value as SurvivalCommandLoadout);
}

export function isSurvivalCommandFieldOrder(value: unknown): value is SurvivalCommandFieldOrder {
  return typeof value === "string" && SURVIVAL_COMMAND_FIELD_ORDER_KEYS.includes(value as SurvivalCommandFieldOrder);
}

export function survivalCommandLoadoutEffect(loadout: SurvivalCommandLoadout) {
  const config = SURVIVAL_COMMAND_LOADOUTS[loadout];
  const effects = [];
  if (config.salvageBonus) effects.push(`+${config.salvageBonus} salvage`);
  if (config.intelBonus) effects.push(`+${config.intelBonus} intel`);
  if (config.breakthroughBonus) effects.push(`+${config.breakthroughBonus}% breakthrough`);
  if (config.strainReduction) effects.push(`${config.strainReduction}% less strain`);
  if (config.preferredActions.length) effects.push(`field edge on ${config.preferredActions.join(" / ")}`);
  return effects.length ? effects.join(" • ") : "standard recovery profile";
}

export function survivalCommandFieldOrderEffect(order: SurvivalCommandFieldOrder) {
  const config = SURVIVAL_COMMAND_FIELD_ORDERS[order];
  const effects = [];
  if (config.salvageShift) effects.push(`${config.salvageShift > 0 ? "+" : ""}${config.salvageShift} salvage`);
  if (config.intelShift) effects.push(`${config.intelShift > 0 ? "+" : ""}${config.intelShift} intel`);
  if (config.breakthroughBonus) effects.push(`${config.breakthroughBonus > 0 ? "+" : ""}${config.breakthroughBonus}% breakthrough`);
  if (config.strainReduction) effects.push(`${config.strainReduction > 0 ? `${config.strainReduction}% less strain` : `${Math.abs(config.strainReduction)}% more strain`}`);
  return effects.join(" • ");
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

export function survivalCommandDailyDirectiveFor(userId: string, deploymentDay: string): SurvivalCommandDailyDirective {
  const keys = Object.keys(SURVIVAL_COMMAND_DAILY_DIRECTIVES) as SurvivalCommandDailyDirectiveKey[];
  const key = keys[hash(`${userId}:${deploymentDay}:daily-directive`) % keys.length]!;
  const directive = SURVIVAL_COMMAND_DAILY_DIRECTIVES[key];
  return {
    key,
    name: directive.name,
    detail: directive.detail,
    sector: directive.sector,
    approach: directive.approach,
    bonus: { salvage: directive.bonus.salvage, intel: directive.bonus.intel },
  };
}

export function survivalCommandDirectiveMatches(directive: SurvivalCommandDailyDirective, sector: SurvivalCommandSector, approach: SurvivalCommandApproach) {
  return directive.sector === sector && directive.approach === approach;
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
  loadout: SurvivalCommandLoadout;
  action: SurvivalCommandAction;
  buildings: SurvivalCommandBuildingLevels;
  fieldOrder?: SurvivalCommandFieldOrder | null;
  dailyDirective?: SurvivalCommandDailyDirective | null;
}) {
  const sector = SURVIVAL_COMMAND_SECTORS[input.sector];
  const loadout = SURVIVAL_COMMAND_LOADOUTS[input.loadout];
  const fieldOrder = input.fieldOrder ? SURVIVAL_COMMAND_FIELD_ORDERS[input.fieldOrder] : null;
  const roll = hash(`${input.seed}:${input.approach}:${input.action}:outcome`) % 100;
  const approachShift = input.approach === "scout" ? { salvage: -1, intel: 2, threshold: 16 }
    : input.approach === "breach" ? { salvage: 3, intel: -1, threshold: 30 }
      : { salvage: 1, intel: 1, threshold: 23 };
  const actionShift = hash(`${input.action}:action`) % 3;
  const workshopBonus = Math.max(0, input.buildings.workshop - 1);
  const watchtowerBonus = Math.max(0, input.buildings.watchtower - 1);
  const preferredActions: readonly string[] = loadout.preferredActions;
  const loadoutActionEdge = preferredActions.includes(input.action) ? 1 : 0;
  const strainThreshold = Math.max(4, 14 - loadout.strainReduction - (fieldOrder?.strainReduction ?? 0));
  const breakthroughThreshold = approachShift.threshold + workshopBonus * 2 + loadout.breakthroughBonus + loadoutActionEdge * 2 + (fieldOrder?.breakthroughBonus ?? 0);
  const outcome: SurvivalCommandOutcome = roll < strainThreshold ? "strained" : roll < breakthroughThreshold ? "breakthrough" : "clean";
  const salvageBase = sector.reward.salvage[0] + hash(`${input.seed}:salvage`) % (sector.reward.salvage[1] - sector.reward.salvage[0] + 1);
  const intelBase = sector.reward.intel[0] + hash(`${input.seed}:intel`) % (sector.reward.intel[1] - sector.reward.intel[0] + 1);
  const multiplier = outcome === "breakthrough" ? 1.45 : outcome === "strained" ? 0.55 : 1;
  const directive = input.dailyDirective && survivalCommandDirectiveMatches(input.dailyDirective, input.sector, input.approach) ? input.dailyDirective : null;
  const salvage = Math.max(1, Math.floor((salvageBase + approachShift.salvage + actionShift + workshopBonus + loadout.salvageBonus + loadoutActionEdge + (fieldOrder?.salvageShift ?? 0)) * multiplier) + (directive?.bonus.salvage ?? 0));
  const intel = Math.max(1, Math.floor((intelBase + approachShift.intel + watchtowerBonus + loadout.intelBonus + loadoutActionEdge + (fieldOrder?.intelShift ?? 0)) * multiplier) + (directive?.bonus.intel ?? 0));
  const detail = outcome === "breakthrough"
    ? "The field decision opened a secondary route. The return team brought back more than the original brief predicted."
    : outcome === "strained"
      ? "The team returned under pressure. The recovery was reduced, but the operation was not lost."
      : "The team completed the recovery plan and returned with a clean operational record.";
  return { outcome, salvage, intel, detail, fingerprint: hash(`${input.seed}:${input.approach}:${input.loadout}:${input.fieldOrder ?? "base"}:${directive?.key ?? "standard"}:${input.action}:${outcome}:${salvage}:${intel}`).toString(16).padStart(8, "0") };
}
