import { json, methodNotAllowed } from "../../_lib/http";
import { reconcileStoreWebhook } from "../../_lib/store-commerce";
import { verifyStripeWebhook } from "../../_lib/stripe";
import type { PagesFunction } from "../../_lib/types";

const MAX_BODY_BYTES = 64 * 1024;

export const onRequest: PagesFunction = async ({ env, request }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const secret = (env as unknown as Record<string, string | undefined>).STRIPE_STORE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "Store webhook is not configured." }, { status: 503 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "Webhook body is too large." }, { status: 413 });
  const rawBody = await request.clone().text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json({ error: "Webhook body is too large." }, { status: 413 });
  let event;
  try { event = await verifyStripeWebhook(request, secret); }
  catch { return json({ error: "Invalid Store webhook signature or payload." }, { status: 400 }); }
  try {
    const result = await reconcileStoreWebhook(env, event, rawBody);
    return json({ received: true, duplicate: result.duplicate }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return json({ error: "Store payment could not be reconciled. Retry delivery." }, {
      status: 500, headers: { "Cache-Control": "private, no-store", "Retry-After": "5" },
    });
  }
};
