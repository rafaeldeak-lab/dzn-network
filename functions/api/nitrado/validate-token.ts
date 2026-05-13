import { getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { validateNitradoToken } from "../../_lib/nitrado";
import {
  ensureDraftLinkedServer,
  normalizeTags,
  storePendingNitradoToken,
  validateServerType,
} from "../../_lib/onboarding";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJson<{
    token?: string;
    discordGuildId?: string;
    serverType?: string;
    tags?: string[];
  }>(request);
  const token = body.token?.trim();
  if (!token) return json({ error: "Nitrado token is required" }, { status: 400 });
  if (!user) return json({ error: "Authenticated user is required" }, { status: 401 });
  if (!body.discordGuildId || !body.serverType) {
    return json({ error: "Discord guild and server type are required before token validation" }, { status: 400 });
  }
  if (!validateServerType(body.serverType)) return json({ error: "Invalid server type" }, { status: 400 });

  const valid = isMockNitrado(env.MOCK_NITRADO) ? true : await validateNitradoToken(token);
  if (!valid) return json({ tokenValid: false }, { status: 400 });

  const linkedServerId = await ensureDraftLinkedServer(
    env,
    user.id,
    body.discordGuildId,
    body.serverType,
    normalizeTags(body.tags),
  );
  await storePendingNitradoToken(env, user.id, linkedServerId, token);
  return json({ tokenValid: true });
};
