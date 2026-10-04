import { handleDznCommsPresence } from "../../_lib/dzn-comms-presence";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  return handleDznCommsPresence(request, env);
};
