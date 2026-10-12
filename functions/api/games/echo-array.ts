import { handleGamesEchoArray } from "../../_lib/games-echo-array";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesEchoArray(request, env);
