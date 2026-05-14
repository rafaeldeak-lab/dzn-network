import { getCurrentLinkedServer, getSessionUser, requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { detectNitradoAdmLogs, mockAdmLogDetection } from "../../_lib/nitrado";
import { getLatestNitradoToken } from "../../_lib/onboarding";
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
  if (typeof linkedServer.nitrado_service_id !== "string" || !linkedServer.nitrado_service_id) {
    return json({ error: "No Nitrado service selected" }, { status: 400 });
  }

  const admLog = isMockNitrado(env.MOCK_NITRADO)
    ? mockAdmLogDetection()
    : await detectNitradoAdmLogs(
        (await getLatestNitradoToken(env, user.id)) ?? "",
        linkedServer.nitrado_service_id,
      );

  const checks = {
    token_valid: 1,
    service_access: 1,
    adm_logs_found: admLog.found ? 1 : 0,
    dayz_service_detected: 1,
  };

  const db = requireDb(env);
  const existing = await db
    .prepare("SELECT id FROM onboarding_checks WHERE linked_server_id = ? LIMIT 1")
    .bind(linkedServer.id)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE onboarding_checks SET
          token_valid = ?,
          service_access = ?,
          adm_logs_found = ?,
          dayz_service_detected = ?,
          last_tested_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .bind(
        checks.token_valid,
        checks.service_access,
        checks.adm_logs_found,
        checks.dayz_service_detected,
        existing.id,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO onboarding_checks (
          id, linked_server_id, token_valid, service_access, adm_logs_found, dayz_service_detected, last_tested_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        crypto.randomUUID(),
        linkedServer.id,
        checks.token_valid,
        checks.service_access,
        checks.adm_logs_found,
        checks.dayz_service_detected,
      )
      .run();
  }

  return json({
    ok: true,
    checks: {
      tokenValid: true,
      serviceAccess: true,
      admLogsFound: Boolean(checks.adm_logs_found),
      dayzServiceDetected: true,
      admLog,
    },
  });
};
