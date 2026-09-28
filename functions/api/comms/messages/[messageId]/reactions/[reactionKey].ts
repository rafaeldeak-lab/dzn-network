import { handleDznCommsReactionRemoval } from "../../../../../_lib/dzn-comms-reactions";
import type { PagesFunction } from "../../../../../_lib/types";

export const onRequest: PagesFunction = ({ request, env, params }) =>
  handleDznCommsReactionRemoval(request, env, params.messageId, params.reactionKey);
