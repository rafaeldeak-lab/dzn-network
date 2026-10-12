import { handleGamesSignalShift } from "../../_lib/games-signal-shift";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesSignalShift(request, env);
