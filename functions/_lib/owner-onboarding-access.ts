import { requireDb } from "./db";
import { effectiveEntitlementPlan, normalizePlanKey } from "./plans";
import type { Env, SessionUser } from "./types";

type OwnerBillingAccountRow = {
  plan_key: string | null;
  plan_status: string | null;
};

export const OWNER_ONBOARDING_PLAN_REQUIRED = {
  code: "owner_plan_required",
  message: "Choose Starter or Pro and complete Stripe Checkout before starting server setup. No payment or trial starts when you only sign in or visit setup.",
} as const;

/**
 * Owner setup creates and changes connected-server state, so its authorization
 * follows the verified billing record rather than a browser return URL.
 */
export async function canAccessOwnerOnboarding(env: Env, user: SessionUser) {
  try {
    const account = await requireDb(env)
      .prepare(
        `SELECT plan_key, plan_status
         FROM owner_billing_accounts
         WHERE discord_user_id = ?
         LIMIT 1`,
      )
      .bind(user.discord_id)
      .first<OwnerBillingAccountRow>();

    const planStatus = typeof account?.plan_status === "string" ? account.plan_status.trim().toLowerCase() : "free";
    return effectiveEntitlementPlan(
      normalizePlanKey(account?.plan_key ?? "free"),
      planStatus,
    ) !== "free";
  } catch {
    // A missing or unavailable billing record must never authorize owner setup.
    return false;
  }
}
