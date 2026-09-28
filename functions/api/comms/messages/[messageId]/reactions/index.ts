import { handleDznCommsReactions } from "../../../../../_lib/dzn-comms-reactions";
import type { PagesFunction } from "../../../../../_lib/types";

export const onRequest: PagesFunction = ({ request, env, params }) =>
  handleDznCommsReactions(request, env, params.messageId);
