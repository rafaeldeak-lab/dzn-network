import type { Env } from "./types";

export const DZN_CRON_SECRET_HEADER = "x-dzn-cron-secret";

export function isCronSecretAuthorized(request: Request, env: Env) {
  const expected = getCronSecret(env);
  if (!expected) return false;
  const provided = request.headers.get(DZN_CRON_SECRET_HEADER);
  if (!provided) return false;
  return timingSafeEqual(provided, expected);
}

export function getCronSecret(env: Env) {
  return env.DZN_CRON_SECRET || null;
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
