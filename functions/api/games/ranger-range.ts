import { handleGamesRangerRange } from "../../_lib/games-ranger-range";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesRangerRange(request, env);
