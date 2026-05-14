import type { DiscordGuild, DiscordUser, NitradoService } from "./types";

export const mockUser: DiscordUser = {
  id: "mock-discord-user",
  username: "RafaelDeak",
  avatar: null,
};

export const mockGuilds: DiscordGuild[] = [
  {
    id: "200000000000000001",
    name: "Warlords Community",
    icon: null,
    owner: true,
    permissions: "8",
  },
];

export const mockNitradoServices: NitradoService[] = [
  {
    id: "900001",
    name: "Pandora DayZ",
    game: "DayZ",
    region: "EU-West",
    platform: "PlayStation",
    ipAddress: "203.0.113.10",
    playerSlots: 60,
    status: "online",
  },
  {
    id: "900002",
    name: "Warlords PvP",
    game: "DayZ",
    region: "US-East",
    platform: "PlayStation",
    ipAddress: "203.0.113.11",
    playerSlots: 70,
    status: "online",
  },
  {
    id: "900003",
    name: "Apocalypse DM",
    game: "DayZ",
    region: "EU-Central",
    platform: "Xbox",
    ipAddress: "203.0.113.12",
    playerSlots: 50,
    status: "restarting",
  },
];

export function isMockAuth(value?: string) {
  return value === "true";
}

export function isMockNitrado(value?: string) {
  return value === "true";
}
