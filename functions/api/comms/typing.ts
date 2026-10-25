import { handleDznCommsTyping } from "../../_lib/dzn-comms-typing";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => handleDznCommsTyping(request, env);
