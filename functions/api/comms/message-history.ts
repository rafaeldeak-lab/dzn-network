import { handleDznCommsMessageHistoryRequest } from "../../_lib/dzn-comms-read-history";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  return handleDznCommsMessageHistoryRequest(request, env);
};
