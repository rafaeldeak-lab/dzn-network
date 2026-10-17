import type { HubGameId, HubSummary } from "./games-hub";

export type OperationDefinition = {
  id: HubGameId;
  code: string;
  discipline: string;
  name: string;
  objective: string;
  pressure: string;
};

// This is presentation metadata only. Rewards, session state, and unlocks remain
// fully owned by their individual server-verified game handlers.
export const HUB_OPERATIONS: Record<HubGameId, OperationDefinition> = {
  minefield: {
    id: "minefield", code: "OP-01", discipline: "Field clearance", name: "Sector Sweep",
    objective: "Map a live minefield without wasting a single move.", pressure: "Spatial risk",
  },
  trivia: {
    id: "trivia", code: "OP-02", discipline: "Survival intelligence", name: "Blackout Briefing",
    objective: "Make the call before the field window closes.", pressure: "Knowledge under time",
  },
  "word-chain": {
    id: "word-chain", code: "OP-03", discipline: "Network relay", name: "Open Channel",
    objective: "Keep the community relay alive with an accepted handoff.", pressure: "Shared coordination",
  },
  "hide-seek": {
    id: "hide-seek", code: "OP-04", discipline: "Signal recovery", name: "Lost Beacon",
    objective: "Recover classified signals without exposing the remaining field.", pressure: "Search discipline",
  },
  "relay-rush": {
    id: "relay-rush", code: "OP-05", discipline: "Rapid response", name: "Pulse Run",
    objective: "Catch server-timed transmission windows before they disappear.", pressure: "Reaction timing",
  },
  "cipher-grid": {
    id: "cipher-grid", code: "OP-06", discipline: "Cryptanalysis", name: "Dead Letter",
    objective: "Break the field cipher before the final attempt burns.", pressure: "Pattern deduction",
  },
  "echo-array": {
    id: "echo-array", code: "OP-07", discipline: "Signal memory", name: "Echo Protocol",
    objective: "Rebuild the array sequence after every unstable pulse.", pressure: "Memory under load",
  },
  "outpost-run": {
    id: "outpost-run", code: "OP-08", discipline: "Field extraction", name: "No Light Out",
    objective: "Find the relay route through a fogged evacuation sector.", pressure: "Route planning",
  },
  "signal-shift": {
    id: "signal-shift", code: "OP-09", discipline: "Tactical routing", name: "Crosswire",
    objective: "Shift the signal grid without collapsing the route.", pressure: "Grid control",
  },
  "circuit-forge": {
    id: "circuit-forge", code: "OP-10", discipline: "Systems repair", name: "Cold Start",
    objective: "Bring the outpost circuit online one precise rotation at a time.", pressure: "Systems thinking",
  },
  "ranger-range": {
    id: "ranger-range", code: "OP-11", discipline: "Range discipline", name: "Silent Range",
    objective: "Read each target window and commit a clean bow shot.", pressure: "Aim and restraint",
  },
  "night-run": {
    id: "night-run", code: "OP-12", discipline: "Convoy survival", name: "Dark Route",
    objective: "Keep the convoy moving through a hostile blackout corridor.", pressure: "Sustained focus",
  },
};

export type FieldClearance = {
  level: number;
  title: string;
  floorXp: number;
  nextXp: number | null;
};

const CLEARANCE_BANDS: FieldClearance[] = [
  { level: 1, title: "Candidate", floorXp: 0, nextXp: 150 },
  { level: 2, title: "Pathfinder", floorXp: 150, nextXp: 450 },
  { level: 3, title: "Field Specialist", floorXp: 450, nextXp: 900 },
  { level: 4, title: "Watch Commander", floorXp: 900, nextXp: 1800 },
  { level: 5, title: "Network Operative", floorXp: 1800, nextXp: 3600 },
  { level: 6, title: "Vanguard", floorXp: 3600, nextXp: null },
];

export type OperationsRecord = {
  clearance: FieldClearance;
  clearanceProgress: number;
  recentOutcomes: number;
  dailyRewards: number;
  weeklyXp: number;
  streak: number;
  assemblies: number;
};

export function buildOperationsRecord(summary: HubSummary): OperationsRecord {
  const clearance = [...CLEARANCE_BANDS].reverse().find((band) => summary.xp >= band.floorXp) ?? CLEARANCE_BANDS[0];
  const clearanceProgress = clearance.nextXp === null
    ? 100
    : Math.min(100, Math.max(0, ((summary.xp - clearance.floorXp) / (clearance.nextXp - clearance.floorXp)) * 100));
  return {
    clearance,
    clearanceProgress,
    recentOutcomes: summary.history.length,
    dailyRewards: summary.challenges.dailyRewards,
    weeklyXp: summary.challenges.weeklyXp,
    streak: summary.challenges.streak,
    assemblies: summary.assemblies,
  };
}

export function operationForGame(id: HubGameId) {
  return HUB_OPERATIONS[id];
}
