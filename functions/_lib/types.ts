export type Env = {
  DB?: D1DatabaseLike;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_REDIRECT_URI?: string;
  SESSION_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  MOCK_AUTH?: string;
  MOCK_NITRADO?: string;
};

export type PagesContext = {
  request: Request;
  env: Env;
  params: Record<string, string>;
  waitUntil: (promise: Promise<unknown>) => void;
  next: () => Promise<Response>;
  data: Record<string, unknown>;
};

export type PagesFunction = (context: PagesContext) => Response | Promise<Response>;

export type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatementLike;
};

export type D1PreparedStatementLike = {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<unknown>;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
};

export type DiscordUser = {
  id: string;
  username: string;
  avatar: string | null;
};

export type DiscordGuild = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
};

export type SessionUser = {
  id: number;
  discord_id: string;
  username: string;
  avatar: string | null;
};

export type ServerType = "PVP" | "DEATHMATCH" | "PVE" | "PVP / PVE";

export type NitradoService = {
  id: string;
  name: string;
  game: string;
  region?: string;
};
