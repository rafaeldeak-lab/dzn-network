import { handleStrongholdBootstrap } from "../../_lib/stronghold-bootstrap";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleStrongholdBootstrap(request, env);
