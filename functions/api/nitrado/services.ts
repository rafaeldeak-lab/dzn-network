import { getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { fetchMockNitradoServices, fetchNitradoServices } from "../../_lib/nitrado";
import { getLatestNitradoToken, getNitradoTokenForLinkedServer } from "../../_lib/onboarding";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });
  if (!user) return json({ error: "Authenticated user is required" }, { status: 401 });

  const services = isMockNitrado(env.MOCK_NITRADO)
    ? await fetchMockNitradoServices()
    : await fetchNitradoServices(await resolveNitradoTokenForServices(env, request, user.id));

  return json({ services });
};

async function resolveNitradoTokenForServices(env: Parameters<PagesFunction>[0]["env"], request: Request, userId: string) {
  const linkedServerId = new URL(request.url).searchParams.get("linked_server_id")?.trim() || null;
  return linkedServerId
    ? (await getNitradoTokenForLinkedServer(env, userId, linkedServerId)) ?? ""
    : (await getLatestNitradoToken(env, userId)) ?? "";
}
