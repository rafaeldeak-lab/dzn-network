import { createCompetitiveEvent } from "../../_lib/events";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { requirePlatformCreatorEventAdmin } from "../../_lib/platform-creator";
import type { PagesFunction } from "../../_lib/types";

type CreateEventBody = {
  name?: string;
  description?: string;
  event_type?: string;
  hosting_server_id?: string;
  server_id?: string;
  starts_at?: string;
  ends_at?: string;
  server_limit?: number;
  team_limit?: number;
  status?: string;
  registration_status?: string;
  tournament_channel_id?: string;
  rules?: string;
  rewards?: string;
  visibility?: string;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await requirePlatformCreatorEventAdmin(env, request);
  if (!auth.ok) return auth.response;
  const body = await readJson<CreateEventBody>(request);
  const result = await createCompetitiveEvent(env, auth.user, body);
  return json(result, { status: result.status });
};
