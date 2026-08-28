import { receiveDznStoreSandboxWebhookReceipt } from "../../_lib/dzn-store-webhook";
import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const result = await receiveDznStoreSandboxWebhookReceipt(env, request);
  return json(result.body, { status: result.status });
};
