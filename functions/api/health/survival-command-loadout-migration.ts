import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  if (env.DZN_ACCOUNT_DELETE_ENABLED !== "false") {
    return json({ error: "No Survival Command loadout maintenance is active." }, { status: 404 });
  }
  return json({ status: "survival-command-loadout-maintenance" }, { status: 200 });
};
