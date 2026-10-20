import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const writesQuiesced = env.DZN_SURVIVAL_COMMAND_FIELD_ORDERS_MIGRATION_MAINTENANCE === "true"
    && env.DZN_ACCOUNT_DELETE_ENABLED === "false";
  if (!writesQuiesced) return json({ error: "No Survival Command field-order maintenance is active." }, { status: 404 });
  return json({ status: "survival-command-field-orders-maintenance" }, { status: 200 });
};
