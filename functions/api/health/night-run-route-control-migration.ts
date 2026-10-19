import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const writesQuiesced = env.DZN_NIGHT_RUN_ROUTE_CONTROL_MIGRATION_MAINTENANCE === "true" && env.DZN_ACCOUNT_DELETE_ENABLED === "false";
  if (!writesQuiesced) return json({ error: "No Night Run route-control maintenance is active." }, { status: 404 });
  return json({ status: "night-run-route-control-maintenance" }, { status: 200 });
};
