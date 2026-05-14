import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  return json({ mockAuth: isMockAuth(env.MOCK_AUTH) });
};
