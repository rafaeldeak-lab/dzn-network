import { handleGamesCircuitForge } from "../../_lib/games-circuit-forge";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesCircuitForge(request, env);
