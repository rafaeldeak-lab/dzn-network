import { handleGamesNightRun } from "../../_lib/games-night-run";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesNightRun(request, env);
