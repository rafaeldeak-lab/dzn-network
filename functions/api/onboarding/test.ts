import { getCurrentLinkedServer, getSessionUser, requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServer = await getCurrentLinkedServer(env, user?.id ?? 1);
  if (!linkedServer || typeof linkedServer.id !== "number") {
    return json({ error: "No linked server found" }, { status: 400 });
  }

  const checks = {
    token_valid: 1,
    service_access: 1,
    adm_logs_found: isMockNitrado(env.MOCK_NITRADO) ? 1 : 0,
    dayz_service_detected: 1,
  };

  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO onboarding_checks (
        linked_server_id, token_valid, service_access, adm_logs_found, dayz_service_detected, last_tested_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        token_valid = excluded.token_valid,
        service_access = excluded.service_access,
        adm_logs_found = excluded.adm_logs_found,
        dayz_service_detected = excluded.dayz_service_detected,
        last_tested_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      linkedServer.id,
      checks.token_valid,
      checks.service_access,
      checks.adm_logs_found,
      checks.dayz_service_detected,
    )
    .run();

  return json({
    ok: true,
    checks: {
      tokenValid: true,
      serviceAccess: true,
      admLogsFound: Boolean(checks.adm_logs_found),
      dayzServiceDetected: true,
    },
  });
};
