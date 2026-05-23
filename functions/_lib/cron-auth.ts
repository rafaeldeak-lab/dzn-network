import type { Env } from "./types";

export const DZN_CRON_SECRET_HEADER = "x-dzn-cron-secret";

export function requireCronSecret(request: Request, env: Env): Response | null {
  if (isCronSecretAuthorized(request, env)) return null;
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function isCronSecretAuthorized(request: Request, env: Env) {
  const expected = getCronSecret(env);
  if (!expected) return false;
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  const provided = request.headers.get(DZN_CRON_SECRET_HEADER) ?? bearer;
  if (!provided) return false;
  return timingSafeEqual(provided, expected);
}

export function getCronSecret(env: Env) {
  return env.DZN_CRON_SECRET || env.SYNC_CRON_SECRET || null;
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
