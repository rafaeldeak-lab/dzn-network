import { getSessionUser } from "./db";
import { json, redirect, secureHeaders } from "./http";
import type { Env, SessionUser } from "./types";

export const PLATFORM_CREATOR_EVENT_ADMIN_CAPABILITY = "platform_creator_event_admin" as const;

export type PlatformCreatorEventAdminAuthResult =
  | { ok: true; user: SessionUser; capability: typeof PLATFORM_CREATOR_EVENT_ADMIN_CAPABILITY }
  | {
      ok: false;
      status: 401 | 403;
      reason: "unauthorized" | "creator_event_governance_not_configured" | "forbidden";
    };

export function parsePlatformCreatorDiscordId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value || value !== value.trim()) return null;
  if (!/^\d{5,32}$/.test(value)) return null;
  return value;
}

export function isPlatformCreatorEventGovernanceConfigured(env: Pick<Env, "DZN_PLATFORM_CREATOR_DISCORD_ID"> | Record<string, unknown>) {
  return parsePlatformCreatorDiscordId((env as Record<string, unknown>).DZN_PLATFORM_CREATOR_DISCORD_ID) !== null;
}

export function isPlatformCreatorEventAdmin(
  user: Pick<SessionUser, "discord_id"> | null,
  env: Pick<Env, "DZN_PLATFORM_CREATOR_DISCORD_ID"> | Record<string, unknown>,
) {
  const configuredDiscordId = parsePlatformCreatorDiscordId((env as Record<string, unknown>).DZN_PLATFORM_CREATOR_DISCORD_ID);
  if (!configuredDiscordId || !user?.discord_id) return false;
  return user.discord_id === configuredDiscordId;
}

export function authorizePlatformCreatorEventAdmin(
  env: Pick<Env, "DZN_PLATFORM_CREATOR_DISCORD_ID"> | Record<string, unknown>,
  user: Pick<SessionUser, "discord_id"> | null,
): PlatformCreatorEventAdminAuthResult {
  if (!user?.discord_id) {
    return { ok: false, status: 401, reason: "unauthorized" };
  }

  if (!isPlatformCreatorEventGovernanceConfigured(env)) {
    return { ok: false, status: 403, reason: "creator_event_governance_not_configured" };
  }

  if (!isPlatformCreatorEventAdmin(user, env)) {
    return { ok: false, status: 403, reason: "forbidden" };
  }

  return { ok: true, user: user as SessionUser, capability: PLATFORM_CREATOR_EVENT_ADMIN_CAPABILITY };
}

export function creatorEventAdminDeniedPayload(
  env: Pick<Env, "DZN_PLATFORM_CREATOR_DISCORD_ID"> | Record<string, unknown>,
  user: Pick<SessionUser, "discord_id"> | null,
) {
  const auth = authorizePlatformCreatorEventAdmin(env, user);
  if (auth.ok) return null;
  if (auth.status === 401) {
    return {
      ok: false,
      status: 401,
      error: "UNAUTHORIZED",
      errorCode: "UNAUTHORIZED",
      message: "Log in with Discord to manage official DZN events.",
    };
  }
  if (auth.reason === "creator_event_governance_not_configured") {
    return {
      ok: false,
      status: 403,
      error: "CREATOR_EVENT_GOVERNANCE_NOT_CONFIGURED",
      errorCode: "CREATOR_EVENT_GOVERNANCE_NOT_CONFIGURED",
      message: "Creator event governance is not configured.",
    };
  }
  return {
    ok: false,
    status: 403,
    error: "CREATOR_EVENT_ADMIN_REQUIRED",
    errorCode: "CREATOR_EVENT_ADMIN_REQUIRED",
    message: "Only the DZN platform creator can manage official DZN events.",
  };
}

export async function requirePlatformCreatorEventAdmin(
  env: Env,
  request: Request,
  options: { mode?: "api" | "page" } = {},
): Promise<
  | { ok: true; user: SessionUser; capability: typeof PLATFORM_CREATOR_EVENT_ADMIN_CAPABILITY }
  | { ok: false; response: Response }
> {
  const user = await getSessionUser(env, request);
  const auth = authorizePlatformCreatorEventAdmin(env, user);
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
      response: new Response("<!doctype html><title>Forbidden</title><h1>403</h1><p>Creator event admin access required.</p>", {
        status: 403,
        headers,
      }),
    };
  }

  const payload = creatorEventAdminDeniedPayload(env, user);
  return {
    ok: false,
    response: json(payload ?? { ok: false, error: "forbidden" }, { status: payload?.status ?? 403 }),
  };
}
