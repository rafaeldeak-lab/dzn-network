import { getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { fetchMockNitradoServices, fetchNitradoServices } from "../../_lib/nitrado";
import { getLatestNitradoToken } from "../../_lib/onboarding";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });

  const services = isMockNitrado(env.MOCK_NITRADO)
    ? await fetchMockNitradoServices()
    : await fetchNitradoServices((await getLatestNitradoToken(env, user?.id ?? 1)) ?? "");

  return json({ services });
};
