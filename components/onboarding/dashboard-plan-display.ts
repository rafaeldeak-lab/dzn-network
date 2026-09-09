import { normalizeListingPlanKey, type ListingPlanKey } from "../../lib/billing/plans";

type BillingPlan = { plan_key: string; plan_status: string } | null;
type ServerPlan = { server_id: string; current_plan: string; source: string; stale: boolean } | null;
type AccountPlan = { plan_tier?: string; plan_status?: string } | null;

function knownPlan(value: string | undefined): ListingPlanKey | null {
  if (!value || !["free", "starter", "pro", "premium", "network", "partner"].includes(value)) return null;
  return normalizeListingPlanKey(value, "active");
}

export function dashboardBillingPlan(billing: BillingPlan): ListingPlanKey | null {
  if (!billing || knownPlan(billing.plan_key) === null) return null;
  return normalizeListingPlanKey(billing.plan_key, billing.plan_status);
}

// Display only. Selected-server access is not proof of an account subscription.
export function dashboardServerPlan(serverId: string, health: ServerPlan, billing: BillingPlan, account: AccountPlan = null): ListingPlanKey | null {
  if (health?.server_id === serverId && health.source !== "local_fallback" && !health.stale) {
    const plan = knownPlan(health.current_plan);
    if (plan !== null) return plan;
  }
  const billingPlan = dashboardBillingPlan(billing);
  if (billingPlan !== null) return billingPlan;
  // Auth navigation already supplies effective account access without an extra billing request.
  if (knownPlan(account?.plan_tier) === null || !account?.plan_status) return null;
  return normalizeListingPlanKey(account.plan_tier, account.plan_status);
}
