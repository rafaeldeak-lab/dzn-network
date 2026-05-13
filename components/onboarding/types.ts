export type AuthResponse = {
  authenticated: boolean;
  user?: {
    id: string;
    discord_id: string;
    username: string;
    avatar: string | null;
  };
  linkedServer?: LinkedServer | null;
};

export type DiscordGuild = {
  guild_id: string;
  name: string;
  icon: string | null;
  icon_url: string | null;
  owner: boolean;
  permissions: string;
};

export type NitradoService = {
  id: string;
  name: string;
  game: string;
  region?: string;
};

export type LinkedServer = {
  id: string;
  guild_id: string;
  guild_name?: string;
  guild_icon_url?: string | null;
  nitrado_service_id: string;
  nitrado_service_name: string;
  server_name: string;
  server_type: string;
  tags_json: string;
  region: string | null;
  status: "pending" | "live" | "error" | "Pending" | "Live" | "Error";
  public_slug: string;
};
