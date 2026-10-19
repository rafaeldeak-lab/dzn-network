import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const writesQuiesced = env.DZN_GAMES_CIPHER_GRID_ENABLED === "false" && env.DZN_ACCOUNT_DELETE_ENABLED === "false";
  if (!writesQuiesced) return json({ error: "No protected migration maintenance is active." }, { status: 404 });
  return json({ status: "protected-migration-maintenance" }, { status: 200 });
};
