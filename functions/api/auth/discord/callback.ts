import { createSession, SESSION_COOKIE, storeDiscordOAuthToken, storeGuilds, upsertUser } from "../../../_lib/db";
import {
  DiscordRequestError,
  exchangeDiscordCode,
  fetchDiscordGuilds,
  fetchDiscordUser,
  filterAdminGuilds,
} from "../../../_lib/discord";
import { isCronSecretAuthorized } from "../../../_lib/cron-auth";
import { methodNotAllowed, readCookie, redirect, secureHeaders, setCookie } from "../../../_lib/http";
import { isValidOAuthState, OAUTH_RETURN_COOKIE, OAUTH_STATE_COOKIE, safeReturnTo } from "../../../_lib/oauth";
import type { Env, PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, OAUTH_STATE_COOKIE);
  const returnTo = safeReturnTo(readCookie(request, OAUTH_RETURN_COOKIE));

  if (!code || !isValidOAuthState(state) || !isValidOAuthState(expectedState) || state !== expectedState) {
    const headers = new Headers();
    headers.append("set-cookie", setCookie(OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    headers.append("set-cookie", setCookie(OAUTH_RETURN_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    return redirect(callbackFailurePath(request, env, {
      stage: "state_validation",
      reason: stateFailureReason(code, state, expectedState),
    }, "discord_state"), headers);
  }

  try {
    const token = await exchangeDiscordCode(env, code);
    const user = await fetchDiscordUser(token.access_token);
    const guilds = await fetchDiscordGuilds(token.access_token);
    const userId = await upsertUser(env, user);
    await storeDiscordOAuthToken(env, userId, token);
    await storeGuilds(env, userId, filterAdminGuilds(guilds));
    const session = await createSession(env, userId);

    const headers = secureHeaders({ location: returnTo, "cache-control": "no-store" });
    headers.append("set-cookie", setCookie(SESSION_COOKIE, session.token, { maxAge: session.maxAge }));
    headers.append("set-cookie", setCookie(OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    headers.append("set-cookie", setCookie(OAUTH_RETURN_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const headers = new Headers();
    headers.append("set-cookie", setCookie(OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    headers.append("set-cookie", setCookie(OAUTH_RETURN_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    return redirect(callbackFailurePath(request, env, classifyCallbackFailure(error), "discord_callback"), headers);
  }
};

type CallbackFailure = {
  stage: string;
  reason: string;
  status?: number | null;
};

function classifyCallbackFailure(error: unknown): CallbackFailure {
  if (error instanceof DiscordRequestError) {
    return {
      stage: error.stage,
      reason: error.code,
      status: error.status,
    };
  }
  return {
    stage: "d1_or_session",
    reason: "write_or_session_error",
  };
}

function stateFailureReason(code: string | null, state: string | null, expectedState: string | null) {
  if (!code) return "missing_code";
  if (!state || !isValidOAuthState(state)) return "invalid_state";
  if (!expectedState || !isValidOAuthState(expectedState)) return "missing_expected_state";
  return "state_mismatch";
}

function callbackFailurePath(request: Request, env: Env, failure: CallbackFailure, errorCode: string) {
  const protectedDiagnostic = isProtectedAuthDiagnosticEnabled(request, env);
  if (!protectedDiagnostic && !isPreviewAuthDiagnosticEnabled(request, env)) {
    return `/login?error=${errorCode}`;
  }

  const output = new URL("/login", "https://dzn.local");
  output.searchParams.set("error", errorCode);
  output.searchParams.set("stage", safeDiagnosticValue(failure.stage));
  output.searchParams.set("reason", safeDiagnosticValue(failure.reason));
  if (typeof failure.status === "number") {
    output.searchParams.set("status", String(failure.status));
  }

  const diagnostics = runtimeDiagnostics(request, env, protectedDiagnostic);
  for (const [key, value] of Object.entries(diagnostics)) {
    output.searchParams.set(key, value);
  }

  return `${output.pathname}${output.search}`;
}

function isProtectedAuthDiagnosticEnabled(request: Request, env: Env) {
  const url = new URL(request.url);
  return url.searchParams.get("diagnostic") === "1" && isCronSecretAuthorized(request, env);
}

function isPreviewAuthDiagnosticEnabled(request: Request, env: Env) {
  const host = new URL(request.url).hostname;
  const isPulsePreviewHost = host === "dzn-network-pulse-preview.pages.dev" || host.endsWith(".dzn-network-pulse-preview.pages.dev");
  if (!isPulsePreviewHost) return false;
  return env.DZN_PULSE_PREVIEW_AUTH_DIAGNOSTICS === "true"
    || (env.DZN_PULSE_ENABLED === "true" && env.DZN_DISCORD_NOTIFICATIONS_ENABLED !== "true");
}

function runtimeDiagnostics(request: Request, env: Env, protectedDiagnostic: boolean) {
  const host = new URL(request.url).hostname;
  const redirectUri = stringEnv(env.DISCORD_REDIRECT_URI);
  const appUrl = stringEnv(env.DZN_APP_URL);
  const clientSecret = stringEnv(env.DISCORD_CLIENT_SECRET);
  const sessionSecret = stringEnv(env.SESSION_SECRET);
  const expectedRedirectUri = expectedRedirectUriForHost(host);

  return {
    diagnostic: protectedDiagnostic ? "protected" : "preview",
    client_id: boolParam(Boolean(stringEnv(env.DISCORD_CLIENT_ID))),
    client_secret: boolParam(Boolean(clientSecret)),
    client_secret_trimmed: trimParam(clientSecret),
    redirect_uri: boolParam(Boolean(redirectUri)),
    redirect_uri_host: urlPart(redirectUri, "host"),
    redirect_uri_path: urlPart(redirectUri, "pathname"),
    redirect_uri_expected: boolParam(Boolean(expectedRedirectUri) && redirectUri === expectedRedirectUri),
    app_url: boolParam(Boolean(appUrl)),
    app_url_host: urlPart(appUrl, "host"),
    session_secret: boolParam(Boolean(sessionSecret)),
    session_secret_trimmed: trimParam(sessionSecret),
    pulse_enabled: boolParam(env.DZN_PULSE_ENABLED === "true"),
    discord_pulse_enabled: boolParam(env.DZN_DISCORD_NOTIFICATIONS_ENABLED === "true"),
  };
}

function expectedRedirectUriForHost(host: string) {
  if (host === "dzn-network.pages.dev") return "https://dzn-network.pages.dev/api/auth/discord/callback";
  if (host === "dzn-network-pulse-preview.pages.dev" || host.endsWith(".dzn-network-pulse-preview.pages.dev")) {
    return "https://dzn-network-pulse-preview.pages.dev/api/auth/discord/callback";
  }
  return null;
}

function stringEnv(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function boolParam(value: boolean) {
  return value ? "1" : "0";
}

function trimParam(value: string | null) {
  if (!value) return "missing";
  return value === value.trim() ? "1" : "0";
}

function urlPart(value: string | null, part: "host" | "pathname") {
  if (!value) return "missing";
  try {
    return safeDiagnosticValue(new URL(value)[part]);
  } catch {
    return "invalid";
  }
}

function safeDiagnosticValue(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
  return normalized.slice(0, 80) || "unknown";
}
