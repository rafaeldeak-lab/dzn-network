import { ensureMockUser, getSessionUser } from "../../_lib/db";
import { CheckoutRecoveryError, createOrResumeCheckout } from "../../_lib/billing-checkout";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import {
  getCheckoutSafetyStatus,
  getStripePriceIdForPlan,
  paidPlanKey,
} from "../../_lib/plans";
import { isTestStripeModeOnProductionHost } from "../../_lib/stripe";
import { safeReturnTo } from "../../_lib/oauth";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type CheckoutBody = {
  plan_key?: string;
  returnTo?: string;
  cancelReturnTo?: string;
  accepted_offer?: unknown;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  if (isTestStripeModeOnProductionHost(env, request)) {
    return json({
      error: "Checkout is temporarily unavailable in this environment.",
      errorCode: "TEST_MODE_PRODUCTION_ORIGIN_BLOCKED",
    }, { status: 403, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  }

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJson<CheckoutBody>(request);
  const planKey = paidPlanKey(body.plan_key);
  if (!planKey) return json({ error: "Choose a paid plan." }, { status: 400 });

  const priceId = getStripePriceIdForPlan(env, planKey);
  if (!priceId) return json({ error: "Plan checkout is not configured yet." }, { status: 400 });

  const checkoutSafety = getCheckoutSafetyStatus(env);
  if (!checkoutSafety.checkoutSessionCreationAllowed) {
    return json({
      error: checkoutSafety.checkoutBlockedReason ?? "Checkout is not enabled yet.",
      errorCode: checkoutSafety.checkoutSafetyMode === "live_checkout_paused" ? "LIVE_CHECKOUT_PAUSED" : "CHECKOUT_NOT_ENABLED",
      checkoutSafetyMode: checkoutSafety.checkoutSafetyMode,
    }, { status: 403 });
  }

  try {
    const result = await createOrResumeCheckout(env, request, {
      discordUserId: user.discord_id,
      planKey,
      priceId,
      returnTo: body.returnTo ?? "/dashboard",
      cancelReturnTo: cancellationReturnTo(body.cancelReturnTo),
      acceptedOffer: body.accepted_offer,
    });
    return json(result, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) {
    const known = error instanceof CheckoutRecoveryError;
    return json({ error: known ? error.message : "Checkout is temporarily unavailable. Please try again later.",
      errorCode: known ? error.code : "CHECKOUT_UNAVAILABLE", ...(known && error.offer ? { offer: error.offer } : {}) }, {
      status: known ? error.status : 503,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  }
};

function cancellationReturnTo(value: unknown) {
  const target = safeReturnTo(typeof value === "string" ? value : null, "/pricing");
  const pathname = new URL(target, "https://dzn.invalid").pathname;

  // Completing checkout may continue into setup after Stripe confirms the plan.
  // Cancelling must always return to plan selection, including for legacy callers.
  return pathname === "/setup" || pathname.startsWith("/setup/") ? "/pricing" : target;
}

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
