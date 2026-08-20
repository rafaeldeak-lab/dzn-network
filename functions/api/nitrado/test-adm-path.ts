import { getCurrentLinkedServer, getSessionUser, saveServerAdmPath } from "../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { getAdmLogStoragePath, mockAdmLogDetection, testExactNitradoAdmPath } from "../../_lib/nitrado";
import {
  assertLinkedServerOwnedByUser,
  getNitradoTokenForLinkedServer,
  LinkedServerOwnershipError,
} from "../../_lib/onboarding";
import type { PagesFunction } from "../../_lib/types";

type TestAdmPathBody = {
  path?: string;
  linkedServerId?: string;
  linked_server_id?: string;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });
  if (!user) return json({ error: "Authenticated user is required" }, { status: 401 });

  const body = await readJson<TestAdmPathBody>(request);
  const admPath = sanitizeAdmPath(body.path);
  if (!admPath) return json({ error: "Manual ADM log path is required" }, { status: 400 });

  const requestedLinkedServerId = sanitizeLinkedServerId(body.linkedServerId ?? body.linked_server_id);
  const linkedServer = requestedLinkedServerId
    ? await assertLinkedServerOwnedByUser(env, user.id, requestedLinkedServerId).catch((error) => {
        if (error instanceof LinkedServerOwnershipError) return null;
        throw error;
      })
    : await getCurrentLinkedServer(env, user.id, { includePrivateAdmPath: true });
  if (!linkedServer || typeof linkedServer.id !== "string") {
    return json({ error: "No linked server found" }, { status: 400 });
  }
  if (typeof linkedServer.nitrado_service_id !== "string" || !linkedServer.nitrado_service_id) {
    return json({ error: "No Nitrado service selected" }, { status: 400 });
  }

  const admLogResult = isMockNitrado(env.MOCK_NITRADO)
    ? mockAdmLogDetection()
    : await resolveExactTokenAndTestAdmPath(env, user.id, linkedServer.id, linkedServer.nitrado_service_id, admPath);
  if (admLogResult instanceof Response) return admLogResult;
  const admLog = admLogResult;

  const admStoragePath = getAdmLogStoragePath(admLog);
  if (admLog.admFileExists && admStoragePath) {
    await saveServerAdmPath(env, linkedServer.id, admStoragePath.replace(/^\/+/, ""));
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

function sanitizeLinkedServerId(value?: string) {
  const id = value?.trim();
  return id && id.length <= 120 ? id : null;
}

async function resolveExactTokenAndTestAdmPath(
  env: Parameters<PagesFunction>[0]["env"],
  userId: string,
  linkedServerId: string,
  serviceId: string,
  admPath: string,
) {
  try {
    const token = await getNitradoTokenForLinkedServer(env, userId, linkedServerId);
    if (!token) {
      throw new Error("missing_nitrado_token");
    }
    return testExactNitradoAdmPath(token, serviceId, admPath);
  } catch (error) {
    const classified = classifyNitradoTokenError(error);
    return json({ error: classified.message, error_code: classified.code }, { status: classified.status });
  }
}

function classifyNitradoTokenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/missing_nitrado_token/i.test(message)) {
    return {
      status: 400,
      code: "missing_nitrado_token",
      message: "No saved Nitrado token was found. Paste your Nitrado long-life token and validate this service again.",
    };
  }
  if (/TOKEN_ENCRYPTION_KEY is not configured/i.test(message)) {
    return {
      status: 500,
      code: "missing_token_encryption_key",
      message: "Token encryption key is missing in production. Add TOKEN_ENCRYPTION_KEY in Cloudflare Pages and redeploy.",
    };
  }
  if (/decrypt|operation|authentication|tag|cipher|iv|key/i.test(message)) {
    return {
      status: 500,
      code: "token_decrypt_failed",
      message: "Your saved Nitrado token cannot be decrypted. Re-save your Nitrado long-life token.",
    };
  }
  return {
    status: 500,
    code: "nitrado_token_unavailable",
    message: "DZN could not read the saved Nitrado token. Re-save your Nitrado long-life token and try again.",
  };
}
