import {
  createDznStoreSandboxCheckoutSession,
  DZN_STORE_CHECKOUT_SESSION_BODY_LIMIT_BYTES,
  type DznStoreSandboxCheckoutRequestBody,
  validateDznStoreSandboxCheckoutBody,
  validateDznStoreSandboxCheckoutOrderId,
} from "../../../../_lib/dzn-store-checkout";
import { json, methodNotAllowed, readBoundedJson } from "../../../../_lib/http";
import { getRequestSessionUser } from "../../../../_lib/owner-access";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getRequestSessionUser(env, request);
  if (!user) {
    return json({
      ok: false,
      error: "Unauthorized",
      message: "Login with Discord before creating a DZN Store sandbox Checkout Session.",
      checkout_available: false,
      stripe_checkout_session_created: false,
      live_checkout_enabled: false,
    }, { status: 401 });
  }

  const orderId = validateDznStoreSandboxCheckoutOrderId(params.orderId);
  if (!orderId.ok) {
    return json({
      ok: false,
      error: orderId.error,
      message: orderId.message,
      checkout_available: false,
      stripe_checkout_session_created: false,
      live_checkout_enabled: false,
    }, { status: orderId.status });
  }

  const bounded = await readBoundedJson<DznStoreSandboxCheckoutRequestBody>(request, DZN_STORE_CHECKOUT_SESSION_BODY_LIMIT_BYTES);
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

  const input = validateDznStoreSandboxCheckoutBody(bounded.value);
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

  const result = await createDznStoreSandboxCheckoutSession(
    env,
    user,
    { orderId: orderId.value, returnTo: input.value.returnTo },
    { request },
  );
  return json(result.body, { status: result.status });
};
