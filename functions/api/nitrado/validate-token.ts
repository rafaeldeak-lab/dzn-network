import { getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { validateNitradoToken } from "../../_lib/nitrado";
import { storePendingNitradoToken } from "../../_lib/onboarding";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJson<{ token?: string }>(request);
  const token = body.token?.trim();
  if (!token) return json({ error: "Nitrado token is required" }, { status: 400 });

  const valid = isMockNitrado(env.MOCK_NITRADO) ? true : await validateNitradoToken(token);
  if (!valid) return json({ tokenValid: false }, { status: 400 });

  await storePendingNitradoToken(env, user?.id ?? 1, token);
  return json({ tokenValid: true });
};
