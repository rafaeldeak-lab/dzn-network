import { handlePublicPlayerVault } from "../../../../_lib/vault";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = ({ request, env, params }) => handlePublicPlayerVault(request, env, params.handle);
