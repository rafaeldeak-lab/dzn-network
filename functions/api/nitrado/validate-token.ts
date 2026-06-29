import { getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import {
  fetchMockNitradoServiceById,
  fetchNitradoServiceById,
  NitradoServiceLookupError,
  validateNitradoToken,
} from "../../_lib/nitrado";
import {
  ensureDraftLinkedServer,
  normalizeTags,
  saveLinkedServerNitradoService,
  storePendingNitradoToken,
  validateServerType,
} from "../../_lib/onboarding";
import { normalizeServerCategory } from "../../_lib/server-categories";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJson<{
    token?: string;
    discordGuildId?: string;
    serverType?: string;
    server_category?: string | null;
    tags?: string[];
    serviceId?: string;
  }>(request);
  const token = body.token?.trim();
  const serviceId = body.serviceId?.trim();
  if (!token) return json({ error: "Nitrado token is required" }, { status: 400 });
  if (!user) return json({ error: "Authenticated user is required" }, { status: 401 });
  if (!body.discordGuildId || !body.serverType) {
    return json({ error: "Discord guild and server type are required before token validation" }, { status: 400 });
  }
  if (!validateServerType(body.serverType)) return json({ error: "Invalid server type" }, { status: 400 });
  const serverCategory = typeof body.server_category === "string" && body.server_category.trim()
    ? normalizeServerCategory(body.server_category)
    : null;
  if (body.server_category && !serverCategory) return json({ error: "Invalid server category" }, { status: 400 });

  const tags = normalizeTags(body.tags);

  try {
    const service = serviceId
      ? isMockNitrado(env.MOCK_NITRADO)
        ? await fetchMockNitradoServiceById(serviceId)
        : await fetchNitradoServiceById(token, serviceId)
      : null;

    if (serviceId && !service) {
      return json({ error: "Service ID not found" }, { status: 404 });
    }

    const valid = service ? true : isMockNitrado(env.MOCK_NITRADO) ? true : await validateNitradoToken(token);
    if (!valid) return json({ error: "Invalid token", tokenValid: false }, { status: 400 });

    const linkedServerId = await ensureDraftLinkedServer(
      env,
      user.id,
      body.discordGuildId,
      body.serverType,
      tags,
      serverCategory,
    );

    if (service) {
      const savedLinkedServerId = await saveLinkedServerNitradoService(env, linkedServerId, service, body.serverType, tags, serverCategory);
      await storePendingNitradoToken(env, user.id, savedLinkedServerId, token);
      return json({ tokenValid: true, linkedServerId: savedLinkedServerId, service });
    }

    await storePendingNitradoToken(env, user.id, linkedServerId, token);
    return json({ tokenValid: true, linkedServerId });
  } catch (error) {
    if (error instanceof NitradoServiceLookupError) {
      if (error.code === "invalid_token") return json({ error: "Invalid token", tokenValid: false }, { status: 400 });
      if (error.code === "service_not_found") return json({ error: "Service ID not found" }, { status: 404 });
      if (error.code === "access_denied") return json({ error: "Token does not have access to this service" }, { status: 403 });
      if (error.code === "not_dayz") return json({ error: "This service does not look like a DayZ server" }, { status: 400 });
      return json({ error: "Nitrado API unavailable" }, { status: 503 });
    }
    const tokenSaveError = classifyTokenSaveError(error);
    if (tokenSaveError) {
      return json({
        error: tokenSaveError.message,
        error_code: tokenSaveError.code,
        tokenValid: false,
      }, { status: 500 });
    }
    return json({ error: "Nitrado API unavailable" }, { status: 503 });
  }
};

function classifyTokenSaveError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/TOKEN_ENCRYPTION_KEY is not configured/i.test(message)) {
    return {
      code: "missing_token_encryption_key",
      message: "Token encryption key is missing in production. Add TOKEN_ENCRYPTION_KEY in Cloudflare Pages and redeploy.",
    };
  }
  if (/decrypt|operation|authentication|tag|cipher|iv|key/i.test(message)) {
    return {
      code: "token_decrypt_failed",
      message: "Your saved Nitrado token cannot be decrypted. Re-save your Nitrado long-life token.",
    };
  }
  return null;
}
