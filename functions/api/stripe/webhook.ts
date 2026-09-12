import { reconcileBillingWebhook } from "../../_lib/billing-webhook";
import { json, methodNotAllowed } from "../../_lib/http";
import { verifyStripeWebhook } from "../../_lib/stripe";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "Stripe webhook is not configured." }, { status: 503 });
  let event;
  try { event = await verifyStripeWebhook(request, env.STRIPE_WEBHOOK_SECRET); }
  catch { return json({ error: "Invalid Stripe webhook signature or payload." }, { status: 400 }); }
  try {
    await reconcileBillingWebhook(env, event);
    return json({ received: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return json({ error: "Could not verify or reconcile Stripe payment. Retry delivery." }, {
      status: 500, headers: { "Cache-Control": "private, no-store", "Retry-After": "5" },
    });
  }
};
