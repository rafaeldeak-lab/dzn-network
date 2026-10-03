import { handleGamesHideSeek } from "../../_lib/games-hide-seek";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesHideSeek(request, env);
