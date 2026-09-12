import { handleGamesHub } from "../../_lib/games-hub";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesHub(request, env);
