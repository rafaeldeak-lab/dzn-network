import { getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { fetchMockNitradoServices, fetchNitradoServices } from "../../_lib/nitrado";
import {
  assertLinkedServerOwnedByUser,
  getNitradoTokenForLinkedServer,
  LinkedServerOwnershipError,
} from "../../_lib/onboarding";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });
  if (!user) return json({ error: "Authenticated user is required" }, { status: 401 });

  const linkedServerId = new URL(request.url).searchParams.get("linked_server_id")?.trim();
  if (!linkedServerId) {
    return json({ error: "linked_server_id is required", error_code: "missing_linked_server_id" }, { status: 400 });
  }

  try {
    await assertLinkedServerOwnedByUser(env, user.id, linkedServerId);
    const services = isMockNitrado(env.MOCK_NITRADO)
      ? await fetchMockNitradoServices()
      : await fetchNitradoServices(await requireExactNitradoToken(env, user.id, linkedServerId));
    return json({ services });
  } catch (error) {
    if (error instanceof LinkedServerOwnershipError) {
      return json({ error: "Linked server not found", error_code: error.code }, { status: 404 });
    }
    const tokenError = classifyNitradoTokenError(error);
    if (tokenError) {
      return json({ error: tokenError.message, error_code: tokenError.code }, { status: tokenError.status });
    }
    return json({ error: "Nitrado API unavailable" }, { status: 503 });
  }
};

async function requireExactNitradoToken(env: Parameters<PagesFunction>[0]["env"], userId: string, linkedServerId: string) {
  const token = await getNitradoTokenForLinkedServer(env, userId, linkedServerId);
  if (!token) {
    const error = new Error("missing_nitrado_token");
    error.name = "ExactLinkedServerCredentialMissingError";
    throw error;
  }
  return token;
}

function classifyNitradoTokenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/missing_nitrado_token/i.test(message) || error instanceof Error && error.name === "ExactLinkedServerCredentialMissingError") {
    return {
      status: 400,
      code: "missing_nitrado_token",
      message: "No saved Nitrado token was found for this linked server. Re-save your Nitrado long-life token.",
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
  return null;
}
