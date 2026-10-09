import { handleDznCommsSelfDelete } from "../../../_lib/dzn-comms-live";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = ({ request, env, params }) => handleDznCommsSelfDelete(request, env, params.messageId ?? "");
