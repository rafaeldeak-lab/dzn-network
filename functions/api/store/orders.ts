import {
  createDznStoreSandboxOrder,
  DZN_STORE_ORDER_BODY_LIMIT_BYTES,
  type DznStoreSandboxOrderRequestBody,
  validateDznStoreSandboxOrderBody,
} from "../../_lib/dzn-store-orders";
import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { getRequestSessionUser } from "../../_lib/owner-access";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getRequestSessionUser(env, request);
  if (!user) {
    return json({
      ok: false,
      error: "Unauthorized",
      message: "Login with Discord before creating a DZN Store sandbox order.",
      checkout_available: false,
      stripe_checkout_session_created: false,
      live_checkout_enabled: false,
    }, { status: 401 });
  }

  const bounded = await readBoundedJson<DznStoreSandboxOrderRequestBody>(request, DZN_STORE_ORDER_BODY_LIMIT_BYTES);
  if (!bounded.ok) {
    return json({
      ok: false,
      error: bounded.error,
      message: bounded.message,
      checkout_available: false,
      stripe_checkout_session_created: false,
      live_checkout_enabled: false,
    }, { status: bounded.status });
  }

  const input = validateDznStoreSandboxOrderBody(bounded.value);
  if (!input.ok) {
    return json({
      ok: false,
      error: input.error,
      message: input.message,
      checkout_available: false,
      stripe_checkout_session_created: false,
      live_checkout_enabled: false,
    }, { status: input.status });
  }

  const result = await createDznStoreSandboxOrder(env, user, input.value);
  return json(result.body, { status: result.status });
};
