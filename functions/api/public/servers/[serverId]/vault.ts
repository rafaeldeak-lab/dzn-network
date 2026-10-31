import { handlePublicServerVault } from "../../../../_lib/vault";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = ({ request, env, params }) => handlePublicServerVault(request, env, params.serverId);
