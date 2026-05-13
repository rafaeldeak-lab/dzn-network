export type Env = CloudflareEnv;

export type PagesContext = {
  request: Request;
  env: Env;
  params: Record<string, string>;
  waitUntil: (promise: Promise<unknown>) => void;
  next: () => Promise<Response>;
  data: Record<string, unknown>;
};

export type PagesFunction = (context: PagesContext) => Response | Promise<Response>;

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
  id: string;
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
