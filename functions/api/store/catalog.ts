import { json, methodNotAllowed } from "../../_lib/http";
import { listPublishedStore } from "../../_lib/store-commerce";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ env, request }) => {
  if (request.method !== "GET") return methodNotAllowed();
  try {
    const result = await listPublishedStore(env);
    return json(result, { status: result.status, headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } });
  } catch {
    return json({ ok: false, error: "STORE_UNAVAILABLE", message: "The Store is temporarily unavailable." }, { status: 503 });
  }
};
