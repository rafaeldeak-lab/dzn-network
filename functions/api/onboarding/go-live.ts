import { getCurrentLinkedServer, getSessionUser, requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import { getOnboardingServiceProof, saveOnboardingServiceChecks } from "../../_lib/onboarding-service-proof";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });
  if (!user) return json({ error: "Authenticated user is required" }, { status: 401 });

  const linkedServer = await getCurrentLinkedServer(env, user.id);
  if (!linkedServer || typeof linkedServer.id !== "string") {
    return json({ error: "No linked server found" }, { status: 400 });
  }

  const db = requireDb(env);
  const checks = await db
    .prepare(
      `SELECT token_valid, service_access, dayz_service_detected
       FROM onboarding_checks
       WHERE linked_server_id = ?
       LIMIT 1`,
    )
    .bind(linkedServer.id)
    .first<{ token_valid: number; service_access: number; dayz_service_detected: number }>();

  if (!checks?.token_valid || !checks.service_access || !checks.dayz_service_detected) {
    return json({ error: "Verification checks must pass before go-live" }, { status: 400 });
  }

  if (typeof linkedServer.nitrado_service_id !== "string" || !linkedServer.nitrado_service_id) {
    return json({ error: "Choose your Nitrado server and run setup checks again." }, { status: 400 });
  }
  const proof = await getOnboardingServiceProof(env, user.id, linkedServer.id, linkedServer.nitrado_service_id);
  if (!proof.checks.tokenValid || !proof.checks.serviceAccess || !proof.checks.dayzServiceDetected) {
    if (!await saveOnboardingServiceChecks(env, proof, false)) {
      return json({ error: "Your server connection changed. Run setup checks again." }, { status: 409 });
    }
    return json({ error: proof.checks.errorMessage, code: proof.checks.errorCode }, { status: 400 });
  }

  const result = await db
    .prepare(`UPDATE linked_servers SET status = 'live', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${proof.guard.sql}
      AND EXISTS (SELECT 1 FROM onboarding_checks WHERE linked_server_id = ?
        AND token_valid = 1 AND service_access = 1 AND dayz_service_detected = 1)`)
    .bind(linkedServer.id, ...proof.guard.bindings, linkedServer.id)
    .run();
  if (!Number(result.meta.changes)) {
    return json({ error: "Your server connection or verification changed. Run setup checks again." }, { status: 409 });
  }

  return json({ ok: true, status: "live" });
};
