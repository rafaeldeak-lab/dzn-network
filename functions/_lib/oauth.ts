import { randomToken } from "./crypto";

export const OAUTH_STATE_COOKIE = "dzn_oauth_state";
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export function createOAuthState() {
  return randomToken(32);
}

export function isValidOAuthState(value: string | null) {
  return Boolean(value && OAUTH_STATE_PATTERN.test(value));
}
