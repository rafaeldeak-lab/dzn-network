import { ensureMockUser, getSessionUser, requireDb } from "../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import { ensureBillingSchema, getStripePriceIdForPlan, paidPlanKey } from "../../_lib/plans";
import { billingRedirectUrl, stripeFormRequest, type StripeCheckoutSession } from "../../_lib/stripe";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type CheckoutBody = {
  plan_key?: string;
  returnTo?: string;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJson<CheckoutBody>(request);
  const planKey = paidPlanKey(body.plan_key);
  if (!planKey) return json({ error: "Choose a paid plan." }, { status: 400 });

  const priceId = getStripePriceIdForPlan(env, planKey);
  if (!priceId) return json({ error: "Plan checkout is not configured yet." }, { status: 503 });

  await ensureBillingSchema(env);
  const account = await requireDb(env)
    .prepare("SELECT stripe_customer_id FROM owner_billing_accounts WHERE discord_user_id = ? LIMIT 1")
    .bind(user.discord_id)
    .first<{ stripe_customer_id: string | null }>();

  const session = await stripeFormRequest<StripeCheckoutSession>(env, "/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    customer: account?.stripe_customer_id ?? undefined,
    client_reference_id: user.discord_id,
    success_url: billingRedirectUrl(env, request, body.returnTo ?? "/dashboard", "success"),
    cancel_url: billingRedirectUrl(env, request, body.returnTo ?? "/dashboard", "cancelled"),
    "metadata[discord_user_id]": user.discord_id,
    "metadata[plan_key]": planKey,
    "metadata[source]": "dzn-network",
    "subscription_data[metadata][discord_user_id]": user.discord_id,
    "subscription_data[metadata][plan_key]": planKey,
    "subscription_data[metadata][source]": "dzn-network",
    allow_promotion_codes: true,
  });

  if (!session.url) return json({ error: "Stripe checkout did not return a URL." }, { status: 502 });
  return json({ url: session.url });
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}
