import {
  deterministicFullOperatorRandomise,
  getDefaultFullOperatorLoadout,
  selectFullOperatorItem,
} from "./loadouts";
import type { FullOperatorLoadout } from "./types";

export type FullOperatorDemoPlayer = {
  id: string;
  displayName: string;
  publicRef: string;
  linkedServerSlug: string;
  linkedServerName: string;
  level: number;
  rank: string;
  xp: number;
  loadoutCount: number;
  operatorsUnlocked: number;
  equippedLoadout: FullOperatorLoadout;
  achievements: string[];
  leaderboardPositions: Record<"weekly" | "monthly" | "seasonal" | "all_time", number>;
  aggregateStats: {
    confirmedKills: number;
    confirmedDeaths: number;
    longestKillM: number;
    travelKm: number;
    exploredCells: number;
  };
};

export type FullOperatorDemoServer = {
  slug: string;
  serverName: string;
  mapName: string;
  slots: string;
  region: string;
  activeState: string;
  operatorRank: string;
  seasonRank: number;
  weeklyXp: number;
  communityChallenge: {
    title: string;
    progress: number;
    target: number;
    fixedReward: string;
    endsAt: string;
  };
  topOperators: FullOperatorDemoPlayer[];
  recentAchievements: string[];
};

export function getFullOperatorDemoLoadout(seed: string): FullOperatorLoadout {
  let loadout = deterministicFullOperatorRandomise(getDefaultFullOperatorLoadout(), seed);
  const name = seed === "rafael" ? "Rafael Signal Assault" : `${seed.replace(/-/g, " ")} DZN Loadout`;
  loadout = {
    ...loadout,
    id: `full-${seed}`,
    displayName: toTitleCase(name),
    callSign: seed === "viperx" ? "ViperX" : seed === "rafael" ? "Rafael" : "Signal",
    featured: true,
  };
  if (seed === "rafael") {
    loadout = selectFullOperatorItem(loadout, "primary_weapon", "primary_weapon-dzn-ar-4-assault-rifle");
    loadout = selectFullOperatorItem(loadout, "power", "power-recon-pulse");
    loadout.powerSlots.power_slot_1 = "power-recon-pulse";
    loadout.powerSlots.power_slot_2 = "power-pathfinder";
  }
  return loadout;
}

export const FULL_OPERATOR_DEMO_PLAYERS: FullOperatorDemoPlayer[] = [
  player("rafael", "Rafael", "op-rafael", "Pandora DayZ", "pandora-dayz", 24, "Network Champion", 12840, 7, 116, 1),
  player("viperx", "ViperX", "op-viperx", "Pandora DayZ", "pandora-dayz", 21, "Sentinel", 11240, 6, 104, 2),
  player("ironwolf", "IronWolf", "op-ironwolf", "Nuketown Deathmatch", "nuketown", 18, "Warden", 9680, 5, 91, 3),
  player("ghostz", "GhostZ", "op-ghostz", "Chernarus Relay", "chernarus-relay", 15, "Vanguard", 8220, 4, 78, 4),
  player("nightshade", "NightShade", "op-nightshade", "Pandora DayZ", "pandora-dayz", 13, "Pathfinder", 7460, 4, 72, 5),
];

export function getFullOperatorPlayer(playerId: string): FullOperatorDemoPlayer | null {
  return FULL_OPERATOR_DEMO_PLAYERS.find((player) => player.id === playerId || player.publicRef === playerId) ?? null;
}

export function getFullOperatorServer(slug: string): FullOperatorDemoServer | null {
  const players = FULL_OPERATOR_DEMO_PLAYERS.filter((player) => player.linkedServerSlug === slug);
  if (slug !== "pandora-dayz" || players.length === 0) return null;
  return {
    slug,
    serverName: "Pandora DayZ",
    mapName: "Chernarus",
    slots: "60 public slots",
    region: "EU / UK",
    activeState: "Live community preview",
    operatorRank: "Sentinel Community",
    seasonRank: 2,
    weeklyXp: players.reduce((total, player) => total + player.xp, 0),
    communityChallenge: {
      title: "Community Signal Sweep",
      progress: 184,
      target: 250,
      fixedReward: "Pandora Signal Patch",
      endsAt: "2026-06-08T00:00:00.000Z",
    },
    topOperators: players,
    recentAchievements: ["Server reached 100 active Operators", "Community completed Field Marker challenge", "Rafael featured in DZN Spotlight"],
  };
}

function player(
  id: string,
  displayName: string,
  publicRef: string,
  linkedServerName: string,
  linkedServerSlug: string,
  level: number,
  rank: string,
  xp: number,
  loadoutCount: number,
  operatorsUnlocked: number,
  position: number,
): FullOperatorDemoPlayer {
  return {
    id,
    displayName,
    publicRef,
    linkedServerName,
    linkedServerSlug,
    level,
    rank,
    xp,
    loadoutCount,
    operatorsUnlocked,
    equippedLoadout: getFullOperatorDemoLoadout(id),
    achievements: ["First Check-In", "Seven-Day Vanguard", "Challenge Runner", "Operator Spotlight"].slice(0, Math.max(2, 5 - position)),
    leaderboardPositions: {
      weekly: position,
      monthly: position + 1,
      seasonal: position,
      all_time: position,
    },
    aggregateStats: {
      confirmedKills: 120 + position * 18,
      confirmedDeaths: 18 + position * 3,
      longestKillM: 420 + position * 21,
      travelKm: 68 + position * 9,
      exploredCells: 42 + position * 5,
    },
  };
}

function toTitleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}
