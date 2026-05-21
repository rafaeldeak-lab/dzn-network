import { getSessionUser } from "../../../_lib/db";
import { joinCompetitiveEvent } from "../../../_lib/events";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

type JoinBody = {
  server_id?: string;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const viewer = await getSessionUser(env, request);
  const body = await readJson<JoinBody>(request);
  const result = await joinCompetitiveEvent(env, viewer, typeof params.slug === "string" ? params.slug : "", body.server_id ?? "");
  return json(result, { status: result.status });
};
