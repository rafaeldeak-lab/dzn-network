import { handleGamesCipherGrid } from "../../_lib/games-cipher-grid";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleGamesCipherGrid(request, env);
