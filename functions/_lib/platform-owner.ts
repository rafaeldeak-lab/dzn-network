import { getSessionUser } from "./db";
import { isMockAuth } from "./mock";
import { json, redirect, secureHeaders } from "./http";
import type { Env, SessionUser } from "./types";

export type PlatformOwnerAuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; status: 401 | 403; reason: "unauthorized" | "forbidden" };

export function parsePlatformOwnerDiscordIds(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^\d+$/.test(entry));
}

export function isPlatformOwnerDiscordId(env: Pick<Env, "DZN_PLATFORM_OWNER_DISCORD_IDS"> | Record<string, unknown>, discordId: unknown) {
  const normalizedDiscordId = String(discordId ?? "").trim();
  if (!normalizedDiscordId) return false;
  return parsePlatformOwnerDiscordIds((env as Record<string, unknown>).DZN_PLATFORM_OWNER_DISCORD_IDS).includes(normalizedDiscordId);
}

export function authorizePlatformOwnerUser(
  env: Pick<Env, "DZN_PLATFORM_OWNER_DISCORD_IDS"> | Record<string, unknown>,
  user: Pick<SessionUser, "discord_id"> | null,
): PlatformOwnerAuthResult {
  if (!user?.discord_id) {
    return { ok: false, status: 401, reason: "unauthorized" };
  }
  if (!isPlatformOwnerDiscordId(env, user.discord_id)) {
    return { ok: false, status: 403, reason: "forbidden" };
  }
  return { ok: true, user: user as SessionUser };
}

export async function getPlatformOwnerSessionUser(env: Env, request: Request) {
  const user = await getSessionUser(env, request);
  if (user) return user;

  if (!isMockAuth(env.MOCK_AUTH)) return null;

  const mockDiscordId = "mock-discord-user";
  if (!isPlatformOwnerDiscordId(env, mockDiscordId)) return null;

  return {
    id: mockDiscordId,
    discord_id: mockDiscordId,
    username: "Mock User",
    avatar: null,
  };
}

export async function requirePlatformOwner(
  env: Env,
  request: Request,
  options: { mode?: "api" | "page" } = {},
): Promise<{ ok: true; user: SessionUser } | { ok: false; response: Response }> {
  const user = await getPlatformOwnerSessionUser(env, request);
  const auth = authorizePlatformOwnerUser(env, user);
  if (auth.ok) return auth;

  if (options.mode === "page") {
    if (auth.status === 401) {
      const url = new URL(request.url);
      const loginUrl = new URL("/login", url.origin);
      loginUrl.searchParams.set("returnTo", `${url.pathname}${url.search}`);
      return { ok: false, response: redirect(`${loginUrl.pathname}${loginUrl.search}`) };
    }

    const headers = secureHeaders({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    });
    return {
      ok: false,
      response: new Response("<!doctype html><title>Forbidden</title><h1>403</h1><p>Platform owner access required.</p>", {
        status: 403,
        headers,
      }),
    };
  }

  return {
    ok: false,
    response: json({ ok: false, error: auth.reason }, { status: auth.status }),
  };
}
