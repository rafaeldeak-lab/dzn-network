import { getActiveSeasons } from "../_lib/dzn-seasons";
import { json, methodNotAllowed } from "../_lib/http";
import type { PagesFunction } from "../_lib/types";

export const onRequestGet: PagesFunction = async ({ env }) => {
  const seasons = await getActiveSeasons(env);
  return json({ ok: true, seasons });
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "GET, OPTIONS" },
});
