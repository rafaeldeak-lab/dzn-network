import { requireCronSecret } from "../../../_lib/cron-auth";
import { dispatchDueCtfScorecards } from "../../../_lib/ctf-tournaments";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

type ScorecardRunBody = {
  max_campaigns?: number;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  const body = await readJson<ScorecardRunBody>(request);
  const result = await dispatchDueCtfScorecards(env, {
    maxCampaigns: body.max_campaigns,
  });
  return json(result);
};
