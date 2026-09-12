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
  if (end <= now) return { label: "Last Period Ended", value: date };
  const plan = dashboardBillingPlan(billing);
  const active = plan === "pro" || plan === "starter";
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
