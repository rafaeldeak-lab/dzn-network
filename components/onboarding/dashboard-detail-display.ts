import { getSubscriptionPlanPublicContract } from "../../lib/billing/plans";
import { dashboardBillingPlan } from "./dashboard-plan-display";

type BillingPeriod = {
  plan_key: string;
  plan_status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
} | null;

export function dashboardBillingPeriod(billing: BillingPeriod, now = Date.now()) {
  if (!billing) return { label: "Billing Period", value: "Checking billing..." };
  const end = billing.current_period_end ? Date.parse(billing.current_period_end) : NaN;
  if (!Number.isFinite(end)) return { label: "Billing Period", value: "Awaiting Stripe update" };
  const date = new Date(end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const plan = dashboardBillingPlan(billing);
  const active = plan === "pro" || plan === "starter";
  if (end <= now) return active
    ? { label: "Billing Date", value: `Needs review (${date})` }
    : { label: "Last Period Ended", value: date };
  return { label: active ? billing.cancel_at_period_end ? "Cancels On" : "Renews" : "Billing Period End", value: date };
}

export function dashboardBumpCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "Checking";
}

export function dashboardAccessLabel(value: string | null | undefined) {
  if (!value || !["free", "starter", "pro", "premium", "network", "partner"].includes(value)) return "Checking access";
  return value === "free" ? "Free" : value === "starter" ? "Starter" : "Pro";
}

export function dashboardPromotionCredits(billing: { plan_key: string; plan_status: string } | null) {
  const plan = dashboardBillingPlan(billing);
  if (plan === null) return "Checking";
  return String(getSubscriptionPlanPublicContract(plan)?.promotionCreditsPerMonth ?? 0);
}

export function dashboardAdvancedStatsMessage(reason: string | null | undefined) {
  if (reason === "advanced_stats_snapshot_pending") return "Advanced showcase is not available yet. Core gameplay statistics remain available.";
  return "Advanced showcase is temporarily unavailable. Core gameplay statistics remain available.";
}

type SelectedServerAccess = {
  source?: "billing" | "complimentary_showcase" | null;
  effectiveListingPlan?: string | null;
} | null;

type AdvertisingAccess = {
  access_source?: "billing" | "complimentary_showcase" | null;
  effective_listing_plan?: string | null;
  listing_label?: string | null;
} | null;

export function dashboardAdvertisingListing(advertising: AdvertisingAccess) {
  const advertisedPlan = advertising?.effective_listing_plan;
  const listingTier = advertisedPlan === "free" || advertisedPlan === "starter" || advertisedPlan === "pro"
    ? advertisedPlan
    : null;
  const complimentary = advertising?.access_source === "complimentary_showcase" && listingTier === "pro";
  return {
    listingTier,
    complimentary,
    label: complimentary
      ? "Pro Listing (complimentary)"
      : listingTier === "pro"
        ? "Pro Listing"
        : listingTier === "starter"
          ? "Starter Listing"
          : listingTier === "free"
            ? "Free Listing"
            : "Checking plan...",
  };
}

export function dashboardSelectedServerAccess(
  input: {
    healthAccess: SelectedServerAccess;
    healthGeneratedAt: string | null;
    advertisingAccess: AdvertisingAccess;
    advertisingGeneratedAt: string | null;
    serverDisplayPlan: string | null;
  },
) {
  const healthTime = input.healthGeneratedAt ? Date.parse(input.healthGeneratedAt) : NaN;
  const advertisingTime = input.advertisingGeneratedAt ? Date.parse(input.advertisingGeneratedAt) : NaN;
  const useAdvertising = Boolean(input.advertisingAccess?.access_source) && (
    !Number.isFinite(healthTime) ||
    (Number.isFinite(advertisingTime) && advertisingTime >= healthTime)
  );
  if (useAdvertising && input.advertisingAccess?.access_source) {
    return {
      source: input.advertisingAccess.access_source,
      effectivePlan: input.advertisingAccess.effective_listing_plan ?? null,
    };
  }
  if (input.healthAccess?.source) {
    return {
      source: input.healthAccess.source,
      effectivePlan: input.healthAccess.effectiveListingPlan ?? null,
    };
  }
  return {
    source: null,
    effectivePlan: null,
  };
}

export function dashboardCurrentAdvertisingDetails<T extends AdvertisingAccess>(
  input: {
    healthGeneratedAt: string | null;
    advertisingAccess: T;
    advertisingGeneratedAt: string | null;
  },
  selectedAccess: ReturnType<typeof dashboardSelectedServerAccess>,
): T | null {
  if (!input.advertisingAccess?.access_source) return null;
  const healthTime = input.healthGeneratedAt ? Date.parse(input.healthGeneratedAt) : NaN;
  const advertisingTime = input.advertisingGeneratedAt ? Date.parse(input.advertisingGeneratedAt) : NaN;
  const advertisingIsNewest = !Number.isFinite(healthTime) || (
    Number.isFinite(advertisingTime) && advertisingTime >= healthTime
  );
  void selectedAccess;
  return advertisingIsNewest ? input.advertisingAccess : null;
}
