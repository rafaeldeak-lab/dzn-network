import { getCurrentLinkedServer, getSessionUser, requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServer = await getCurrentLinkedServer(env, user?.id ?? 1);
  if (!linkedServer || typeof linkedServer.id !== "number") {
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
    await db
      .prepare("UPDATE linked_servers SET status = 'Error', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(linkedServer.id)
      .run();
    return json({ error: "Verification checks must pass before go-live" }, { status: 400 });
  }

  await db
    .prepare("UPDATE linked_servers SET status = 'Live', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(linkedServer.id)
    .run();

  return json({ ok: true, status: "Live" });
};
