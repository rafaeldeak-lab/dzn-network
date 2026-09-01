import { getDiscordOAuthToken, storeDiscordOAuthToken } from "./db";
import { refreshDiscordAccessToken } from "./discord";
import type { Env } from "./types";

export async function getUsableDiscordAccessToken(env: Env, userId: string) {
  const token = await getDiscordOAuthToken(env, userId);
  if (!token?.access_token) return null;

  const expiresAt = token.expires_at ? Date.parse(token.expires_at) : Number.NaN;
  const isExpired = Number.isFinite(expiresAt) && expiresAt <= Date.now() + 30_000;
  if (!isExpired) return token.access_token;
  if (!token.refresh_token) return null;

  const refreshed = await refreshDiscordAccessToken(env, token.refresh_token).catch(() => null);
  if (!refreshed?.access_token) return null;
  await storeDiscordOAuthToken(env, userId, refreshed);
  return refreshed.access_token;
}
