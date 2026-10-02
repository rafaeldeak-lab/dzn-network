import { getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { privateNoStoreHeaders } from "../../_lib/performance";
import { listStorePurchases } from "../../_lib/store-commerce";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ env, request }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const user = await getSessionUser(env, request).catch(() => null);
  if (!user) return json({ ok: false, error: "UNAUTHORIZED" }, { status: 401, headers: privateNoStoreHeaders() });
  try { return json(await listStorePurchases(env, user), { headers: privateNoStoreHeaders() }); }
  catch { return json({ ok: false, error: "PURCHASES_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() }); }
};
