import { handlePrivateVault } from "../../_lib/vault";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handlePrivateVault(request, env, "player");
