import { handleGamesOutpostRun } from "../../_lib/games-outpost-run";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesOutpostRun(request, env);
