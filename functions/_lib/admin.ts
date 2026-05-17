import { getSessionUser } from "./db";
import { isMockAuth } from "./mock";
import type { Env, SessionUser } from "./types";

export async function requireDznAdmin(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (!user) return null;
  if (isDznAdminDiscordId(env, user.discord_id)) return user;
  if (isMockAuth(env.MOCK_AUTH)) return user;
  return null;
}

export function isDznAdminDiscordId(env: Env, discordId: string | null | undefined) {
  if (!discordId) return false;
  const configured = env.DZN_ADMIN_DISCORD_IDS ?? env.DZN_OWNER_DISCORD_IDS ?? "";
  return configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(discordId);
}
