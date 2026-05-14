import { getCurrentLinkedServer, getSessionUser, saveServerAdmPath } from "../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { mockAdmLogDetection, testExactNitradoAdmPath } from "../../_lib/nitrado";
import { getLatestNitradoToken } from "../../_lib/onboarding";
import type { PagesFunction } from "../../_lib/types";

type TestAdmPathBody = {
  path?: string;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });
  if (!user) return json({ error: "Authenticated user is required" }, { status: 401 });

  const body = await readJson<TestAdmPathBody>(request);
  const admPath = sanitizeAdmPath(body.path);
  if (!admPath) return json({ error: "Manual ADM log path is required" }, { status: 400 });

  const linkedServer = await getCurrentLinkedServer(env, user.id);
  if (!linkedServer || typeof linkedServer.id !== "string") {
    return json({ error: "No linked server found" }, { status: 400 });
  }
  if (typeof linkedServer.nitrado_service_id !== "string" || !linkedServer.nitrado_service_id) {
    return json({ error: "No Nitrado service selected" }, { status: 400 });
  }

  const admLog = isMockNitrado(env.MOCK_NITRADO)
    ? mockAdmLogDetection()
    : await testExactNitradoAdmPath(
        (await getLatestNitradoToken(env, user.id)) ?? "",
        linkedServer.nitrado_service_id,
        admPath,
      );

  if (admLog.found && admLog.admPath) {
    await saveServerAdmPath(env, linkedServer.id, admLog.admPath.replace(/^\/+/, ""));
  }

  return json({
    ok: true,
    checks: {
      tokenValid: true,
      serviceAccess: true,
      admLogsFound: admLog.found,
      dayzServiceDetected: true,
      admLog,
    },
  });
};

function sanitizeAdmPath(value?: string) {
  const path = value?.trim().replace(/[\u0000-\u001f]/g, "");
  if (!path || path.length > 320 || /^https?:\/\//i.test(path) || path.includes("..")) return null;
  return path;
}
