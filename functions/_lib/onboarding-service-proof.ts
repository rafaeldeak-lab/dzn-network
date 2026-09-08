import { decryptToken } from "./crypto";
import { requireDb } from "./db";
import { isMockNitrado } from "./mock";
import { getLatestNitradoConnectionForLinkedServer } from "./onboarding";
import type { Env } from "./types";

type ServiceChecks = {
  tokenValid: boolean;
  serviceAccess: boolean;
  dayzServiceDetected: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

const unavailable: ServiceChecks = {
  tokenValid: false, serviceAccess: false, dayzServiceDetected: false,
  errorCode: "nitrado_api_unavailable",
  errorMessage: "DZN could not check Nitrado right now. Your saved connection has not been changed. Try again shortly.",
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// Only provider game codes count. A customer-controlled hostname containing DayZ is not proof.
const dayzGameCodes = new Set(["dayz", "dayzps", "dayzxb", "dayzstandalone"]);

export async function verifyNitradoSetupService(token: string, serviceId: string): Promise<ServiceChecks> {
  if (!/^\d+$/.test(serviceId)) return { ...unavailable, errorCode: "invalid_service_id", errorMessage: "Choose your Nitrado server again before checking setup." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(`https://api.nitrado.net/services/${serviceId}/gameservers`, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "manual", signal: controller.signal,
    });
    if (response.status === 401) return { ...unavailable, errorCode: "invalid_token", errorMessage: "Nitrado did not accept your saved token. Reconnect Nitrado with a valid long-life token." };
    if (response.status === 403) return { ...unavailable, errorCode: "access_denied", errorMessage: "Your saved Nitrado connection cannot access this server. Check its permissions or reconnect Nitrado." };
    if (response.status === 404) return { ...unavailable, errorCode: "service_not_found", errorMessage: "Nitrado could not find the selected server. Choose your server again." };
    if (!response.ok || !response.body) return { ...unavailable };

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 128 * 1024) return { ...unavailable };
      text += decoder.decode(chunk.value, { stream: true });
    }
    const payload = record(JSON.parse(text + decoder.decode()));
    const server = record(record(payload?.data)?.gameserver);
    if (payload?.status !== "success" || !server) return { ...unavailable };
    // The endpoint is service-scoped. If Nitrado also echoes a service ID, it must agree.
    if (server.service_id != null && String(server.service_id) !== serviceId) return { ...unavailable };
    if (typeof server.game !== "string" || !server.game.trim()) return { ...unavailable };
    if (!dayzGameCodes.has(server.game.trim().toLowerCase())) {
      return { tokenValid: true, serviceAccess: true, dayzServiceDetected: false, errorCode: "not_dayz", errorMessage: "The selected Nitrado server is not a supported DayZ service. Choose your DayZ server." };
    }
    return { tokenValid: true, serviceAccess: true, dayzServiceDetected: true, errorCode: null, errorMessage: null };
  } catch {
    return { ...unavailable };
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) await reader.cancel().catch(() => undefined);
  }
}

export async function getOnboardingServiceProof(env: Env, userId: string, linkedServerId: string, serviceId: string) {
  const connection = await getLatestNitradoConnectionForLinkedServer(env, userId, linkedServerId);
  const snapshot = connection ? [connection.id, connection.encrypted_token, connection.token_iv, connection.token_auth_tag ?? ""].join(":") : "";
  // Bind final writes to the same owner, service and latest encrypted connection that was checked.
  const guard = {
    sql: `EXISTS (SELECT 1 FROM linked_servers AS proof_server
      WHERE proof_server.id = ? AND proof_server.user_id = ? AND proof_server.nitrado_service_id = ?
        AND lower(COALESCE(proof_server.status, 'pending')) NOT IN ('deleted', 'merged')
        AND COALESCE(proof_server.merged_into_server_id, '') = ''
        AND COALESCE((SELECT id || ':' || encrypted_token || ':' || token_iv || ':' || COALESCE(token_auth_tag, '')
          FROM nitrado_connections WHERE user_id = ? AND linked_server_id = ?
          ORDER BY updated_at DESC, id DESC LIMIT 1), '') = ?)`,
    bindings: [linkedServerId, userId, serviceId, userId, linkedServerId, snapshot],
  };
  let checks: ServiceChecks = { ...unavailable };
  let token = "";
  if (isMockNitrado(env.MOCK_NITRADO)) {
    checks = { tokenValid: true, serviceAccess: true, dayzServiceDetected: true, errorCode: null, errorMessage: null };
  } else if (!env.TOKEN_ENCRYPTION_KEY) {
    checks = { ...unavailable, errorCode: "missing_token_encryption_key", errorMessage: "Token encryption key is missing in production. Add TOKEN_ENCRYPTION_KEY in Cloudflare Pages and redeploy." };
  } else if (!connection) {
    checks = { ...unavailable, errorCode: "missing_nitrado_token", errorMessage: "No saved Nitrado token was found. Paste your Nitrado long-life token and validate this service again." };
  } else {
    try {
      token = await decryptToken(connection.encrypted_token, connection.token_iv, connection.token_auth_tag, env.TOKEN_ENCRYPTION_KEY);
    } catch {
      checks = { ...unavailable, errorCode: "token_decrypt_failed", errorMessage: "Your saved Nitrado token cannot be decrypted. Re-save your Nitrado long-life token." };
      return { checks, token, guard, linkedServerId };
    }
    checks = token ? await verifyNitradoSetupService(token, serviceId) : { ...unavailable, errorCode: "missing_nitrado_token" };
  }
  return { checks, token, guard, linkedServerId };
}

export type OnboardingServiceProof = Awaited<ReturnType<typeof getOnboardingServiceProof>>;

export async function onboardingProofStillCurrent(env: Env, proof: OnboardingServiceProof) {
  return Boolean(await requireDb(env).prepare(`SELECT 1 AS current WHERE ${proof.guard.sql}`).bind(...proof.guard.bindings).first());
}

export async function saveOnboardingServiceChecks(env: Env, proof: OnboardingServiceProof, admLogsFound: boolean) {
  const db = requireDb(env);
  const values = [Number(proof.checks.tokenValid), Number(proof.checks.serviceAccess), Number(admLogsFound), Number(proof.checks.dayzServiceDetected)];
  const results = await db.batch([
    db.prepare(`UPDATE onboarding_checks SET token_valid = ?, service_access = ?, adm_logs_found = ?, dayz_service_detected = ?, last_tested_at = CURRENT_TIMESTAMP
      WHERE linked_server_id = ? AND ${proof.guard.sql}`).bind(...values, proof.linkedServerId, ...proof.guard.bindings),
    db.prepare(`INSERT INTO onboarding_checks (id, linked_server_id, token_valid, service_access, adm_logs_found, dayz_service_detected, last_tested_at)
      SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP WHERE ${proof.guard.sql}
        AND NOT EXISTS (SELECT 1 FROM onboarding_checks WHERE linked_server_id = ?)`)
      .bind(crypto.randomUUID(), proof.linkedServerId, ...values, ...proof.guard.bindings, proof.linkedServerId),
  ]);
  return results.some((result) => Number(result.meta.changes) > 0);
}
