import type { DiscordGuild, DiscordUser, Env } from "./types";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const ADMINISTRATOR = BigInt(8);

export function buildDiscordAuthorizeUrl(env: Env, state: string) {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set("client_id", required(env.DISCORD_CLIENT_ID, "DISCORD_CLIENT_ID"));
  url.searchParams.set("redirect_uri", validateDiscordRedirectUri(required(env.DISCORD_REDIRECT_URI, "DISCORD_REDIRECT_URI")));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");

  if (url.origin !== "https://discord.com" || url.pathname !== "/oauth2/authorize") {
    throw new Error("Discord authorize URL must use the official Discord OAuth endpoint");
  }

  return url.toString();
}

export async function exchangeDiscordCode(env: Env, code: string) {
  const body = new URLSearchParams({
    client_id: required(env.DISCORD_CLIENT_ID, "DISCORD_CLIENT_ID"),
    client_secret: required(env.DISCORD_CLIENT_SECRET, "DISCORD_CLIENT_SECRET"),
    grant_type: "authorization_code",
    code,
    redirect_uri: validateDiscordRedirectUri(required(env.DISCORD_REDIRECT_URI, "DISCORD_REDIRECT_URI")),
  });

  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) throw new Error("Discord token exchange failed");
  return response.json() as Promise<{ access_token: string; token_type: string }>;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Discord user fetch failed");
  return response.json() as Promise<DiscordUser>;
}

export async function fetchDiscordGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const response = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Discord guild fetch failed");
  return response.json() as Promise<DiscordGuild[]>;
}

export function filterAdminGuilds(guilds: DiscordGuild[]) {
  return guilds.filter((guild) => guild.owner || hasAdministrator(guild.permissions));
}

export function guildIconUrl(guild: DiscordGuild) {
  return guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null;
}

function hasAdministrator(permissions: string) {
  try {
    return (BigInt(permissions) & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function validateDiscordRedirectUri(value: string) {
  const url = new URL(value);
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocalhost && url.protocol === "http:")) {
    throw new Error("DISCORD_REDIRECT_URI must use HTTPS outside localhost");
  }
  if (url.pathname !== "/api/auth/discord/callback") {
    throw new Error("DISCORD_REDIRECT_URI must point to /api/auth/discord/callback");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}
