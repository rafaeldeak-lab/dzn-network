import { handleGamesWordChain } from "../../_lib/games-word-chain";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesWordChain(request, env);
