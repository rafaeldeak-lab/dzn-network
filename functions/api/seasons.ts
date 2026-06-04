import { getActiveSeasons, getPublicSeasons } from "../_lib/dzn-seasons";
import { json, methodNotAllowed } from "../_lib/http";
import type { PagesFunction } from "../_lib/types";

export const onRequestGet: PagesFunction = async ({ env }) => {
  const [activeSeasons, seasons] = await Promise.all([getActiveSeasons(env), getPublicSeasons(env)]);
  return json({
    ok: true,
    seasons,
    activeSeasons,
    upcomingSeasons: seasons.filter((season) => ["registration_open", "upcoming"].includes(String(season.status).toLowerCase())),
    completedSeasons: seasons.filter((season) => String(season.status).toLowerCase() === "completed"),
  });
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "GET, OPTIONS" },
});
