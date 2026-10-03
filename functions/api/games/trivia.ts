import { handleGamesTrivia } from "../../_lib/games-trivia";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesTrivia(request, env);
