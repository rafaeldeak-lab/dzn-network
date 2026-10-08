import { handleDznCommsOwnerArchive } from "../../../_lib/dzn-comms-live";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleDznCommsOwnerArchive(request, env);
