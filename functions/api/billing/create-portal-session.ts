import { ensureMockUser, getSessionUser, requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import { ensureBillingSchema } from "../../_lib/plans";
import { getAppUrl, isTestStripeModeOnProductionHost, stripeFormRequest, type StripePortalSession } from "../../_lib/stripe";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  if (isTestStripeModeOnProductionHost(env, request)) {
    return json({ error: "Billing management is temporarily unavailable in this environment." }, {
      status: 403, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  }

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  await ensureBillingSchema(env);
  const account = await requireDb(env)
    .prepare("SELECT stripe_customer_id FROM owner_billing_accounts WHERE discord_user_id = ? LIMIT 1")
    .bind(user.discord_id)
    .first<{ stripe_customer_id: string | null }>();
  if (!account?.stripe_customer_id) return json({ error: "No billing account found." }, { status: 404 });

  const session = await stripeFormRequest<StripePortalSession>(env, "/billing_portal/sessions", {
    customer: account.stripe_customer_id,
    return_url: `${getAppUrl(env, request)}/dashboard`,
  });
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
