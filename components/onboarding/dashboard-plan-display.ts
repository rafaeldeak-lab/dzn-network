import { normalizeListingPlanKey, type ListingPlanKey } from "../../lib/billing/plans";

type BillingPlan = { plan_key: string; plan_status: string } | null;
type ServerPlan = { server_id: string; current_plan: string; source: string; stale: boolean } | null;
type AccountPlan = { plan_tier?: string; plan_status?: string } | null;

function knownPlan(value: string | undefined): ListingPlanKey | null {
  if (!value || !["free", "starter", "pro", "premium", "network", "partner"].includes(value)) return null;
  return normalizeListingPlanKey(value, "active");
}

function knownStatusPlan(plan: string | undefined, status: string | undefined): ListingPlanKey | null {
  const recognized = ["active", "trialing", "free", "none", "inactive", "canceled", "cancelled", "expired", "unpaid", "past_due", "incomplete", "incomplete_expired", "paused"];
  const normalizedStatus = status?.trim().toLowerCase();
  if (knownPlan(plan) === null || !normalizedStatus || !recognized.includes(normalizedStatus)) return null;
  return normalizeListingPlanKey(plan, normalizedStatus);
}

export function dashboardBillingPlan(billing: BillingPlan): ListingPlanKey | null {
  return knownStatusPlan(billing?.plan_key, billing?.plan_status);
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
  return knownStatusPlan(account?.plan_tier, account?.plan_status);
}
