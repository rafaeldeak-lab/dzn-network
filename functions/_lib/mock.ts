import type { DiscordGuild, DiscordUser, NitradoService } from "./types";

export const mockUser: DiscordUser = {
  id: "100000000000000001",
  username: "DZNOwner",
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
  },
  {
    id: "900002",
    name: "Warlords PvP",
    game: "DayZ",
    region: "US-East",
  },
  {
    id: "900003",
    name: "Apocalypse DM",
    game: "DayZ",
    region: "EU-Central",
  },
];

export function isMockAuth(value?: string) {
  return value === "true";
}

export function isMockNitrado(value?: string) {
  return value === "true";
}
