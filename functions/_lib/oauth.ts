import { randomToken } from "./crypto";

export const OAUTH_STATE_COOKIE = "dzn_oauth_state";
export const OAUTH_RETURN_COOKIE = "dzn_oauth_return";
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export function createOAuthState() {
  return randomToken(32);
}

export function isValidOAuthState(value: string | null) {
  return Boolean(value && OAUTH_STATE_PATTERN.test(value));
}

export function safeReturnTo(value: string | null, fallback = "/") {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) return fallback;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(trimmed)) return fallback;

  try {
    const url = new URL(trimmed, "https://dzn.local");
    if (url.origin !== "https://dzn.local") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
