import { handleGamesRelayRush } from "../../_lib/games-relay-rush";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesRelayRush(request, env);
