import {
  D1DznCommsMessageReadStorage,
  readDznCommsChannelMessages,
} from "../../../../_lib/dzn-comms-message-read";
import { json, methodNotAllowed } from "../../../../_lib/http";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const result = await readDznCommsChannelMessages({
    env,
    request,
    channelId: params.channelId,
    storage: env.DB ? new D1DznCommsMessageReadStorage(env.DB) : null,
  });

  return json(result.body, { status: result.status, headers: result.headers });
};
