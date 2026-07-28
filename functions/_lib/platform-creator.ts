import { getSessionUser } from "./db";
import { json, redirect, secureHeaders } from "./http";
import type { Env, SessionUser } from "./types";

export const PLATFORM_CREATOR_EVENT_ADMIN_CAPABILITY = "platform_creator_event_admin" as const;

export type PlatformCreatorEnvReadiness =
  | { ok: true; configuredDiscordId: string }
  | { ok: false; reason: "creator_env_missing" | "creator_env_invalid" };

export type PlatformCreatorEventAdminAuthResult =
  | { ok: true; user: SessionUser; capability: typeof PLATFORM_CREATOR_EVENT_ADMIN_CAPABILITY }
  | {
      ok: false;
      status: 401 | 403;
      reason: "unauthorized" | "creator_access_not_configured" | "forbidden";
      readinessReason?: "creator_env_missing" | "creator_env_invalid";
    };

export function parsePlatformCreatorDiscordId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value || value !== value.trim()) return null;
  if (!/^\d{5,32}$/.test(value)) return null;
  return value;
}

export function isPlatformCreatorEventGovernanceConfigured(env: Pick<Env, "DZN_PLATFORM_CREATOR_DISCORD_ID"> | Record<string, unknown>) {
  return getPlatformCreatorEnvReadiness(env).ok;
}

export function getPlatformCreatorEnvReadiness(
  env: Pick<Env, "DZN_PLATFORM_CREATOR_DISCORD_ID"> | Record<string, unknown>,
): PlatformCreatorEnvReadiness {
  const rawValue = (env as Record<string, unknown>).DZN_PLATFORM_CREATOR_DISCORD_ID;
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { ok: false, reason: "creator_env_missing" };
  }
  const configuredDiscordId = parsePlatformCreatorDiscordId(rawValue);
  if (!configuredDiscordId) {
    return { ok: false, reason: "creator_env_invalid" };
  }
  return { ok: true, configuredDiscordId };
}

export function isPlatformCreatorEventAdmin(
  user: Pick<SessionUser, "discord_id"> | null,
  env: Pick<Env, "DZN_PLATFORM_CREATOR_DISCORD_ID"> | Record<string, unknown>,
) {
  const readiness = getPlatformCreatorEnvReadiness(env);
  if (!readiness.ok || !user?.discord_id) return false;
  return user.discord_id === readiness.configuredDiscordId;
}

export function authorizePlatformCreatorEventAdmin(
  env: Pick<Env, "DZN_PLATFORM_CREATOR_DISCORD_ID"> | Record<string, unknown>,
  user: Pick<SessionUser, "discord_id"> | null,
): PlatformCreatorEventAdminAuthResult {
  if (!user?.discord_id) {
    return { ok: false, status: 401, reason: "unauthorized" };
  }

  const readiness = getPlatformCreatorEnvReadiness(env);
  if (!readiness.ok) {
    return { ok: false, status: 403, reason: "creator_access_not_configured", readinessReason: readiness.reason };
  }

  if (user.discord_id !== readiness.configuredDiscordId) {
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
  if (auth.reason === "creator_access_not_configured") {
    const envReason = auth.readinessReason ?? "creator_env_missing";
    return {
      ok: false,
      status: 403,
      error: "CREATOR_ACCESS_NOT_CONFIGURED",
      errorCode: "CREATOR_ACCESS_NOT_CONFIGURED",
      reason: envReason ?? "creator_access_not_configured",
      message: envReason === "creator_env_invalid" ? "Creator event governance is misconfigured." : "Creator event governance is not configured.",
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
