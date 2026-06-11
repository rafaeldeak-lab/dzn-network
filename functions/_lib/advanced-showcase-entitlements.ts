import { getPlanConfig, normalizePlanKey, type PlanKey } from "./plans";

export type AdvancedShowcasePlan = "free" | "starter" | "pro" | "premium";

export type AdvancedShowcaseAccess = {
  configuredPlan: AdvancedShowcasePlan;
  effectivePlan: AdvancedShowcasePlan;
  subscriptionActive: boolean;
  dashboardAnalytics: boolean;
  publicServerTop15: boolean;
  publicBuildShowcase: boolean;
  publicTravelShowcase: boolean;
  publicExplorationSummary: boolean;
  publicMapOverlay: boolean;
  globalAdvancedBoards: boolean;
  globalPremiumShowcase: boolean;
  lockedModules: Array<{
    key: string;
    title: string;
    requiredPlan: "pro" | "premium";
    reason: string;
  }>;
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export function hasActiveAdvancedSubscription(status: unknown) {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export function advancedShowcasePlanFromSubscription(planKey: unknown, status: unknown): AdvancedShowcasePlan {
  const normalized = normalizePlanKey(planKey) as PlanKey;
  const configured = normalized === "premium" || normalized === "network" || normalized === "partner"
    ? "premium"
    : normalized === "pro"
      ? "pro"
      : normalized === "starter"
        ? "starter"
        : "free";
  if (configured === "free" || configured === "starter") return configured;
  return hasActiveAdvancedSubscription(status) ? configured : "free";
}

export function getAdvancedShowcaseAccess(planKey: unknown, status: unknown): AdvancedShowcaseAccess {
  const configuredPlan = configuredAdvancedPlan(planKey);
  const effectivePlan = advancedShowcasePlanFromSubscription(planKey, status);
  const planConfig = getPlanConfig(effectivePlan);
  const proPlus = effectivePlan === "pro" || effectivePlan === "premium";
  const premium = effectivePlan === "premium";

  return {
    configuredPlan,
    effectivePlan,
    subscriptionActive: effectivePlan === configuredPlan && hasActiveAdvancedSubscription(status),
    dashboardAnalytics: proPlus && planConfig.can_use_advanced_analytics,
    publicServerTop15: proPlus,
    publicBuildShowcase: proPlus,
    publicTravelShowcase: proPlus,
    publicExplorationSummary: proPlus,
    publicMapOverlay: premium,
    globalAdvancedBoards: premium,
    globalPremiumShowcase: premium,
    lockedModules: buildLockedModules(effectivePlan),
  };
}

export function configuredAdvancedPlan(planKey: unknown): AdvancedShowcasePlan {
  const normalized = normalizePlanKey(planKey) as PlanKey;
  if (normalized === "premium" || normalized === "network" || normalized === "partner") return "premium";
  if (normalized === "pro") return "pro";
  if (normalized === "starter") return "starter";
  return "free";
}

function buildLockedModules(plan: AdvancedShowcasePlan): AdvancedShowcaseAccess["lockedModules"] {
  const locks: AdvancedShowcaseAccess["lockedModules"] = [];
  if (plan !== "pro" && plan !== "premium") {
    locks.push({
      key: "server_top15",
      title: "Server Top 15 Showcase",
      requiredPlan: "pro",
      reason: "Pro unlocks server-specific Top 15 boards for real ADM-derived combat, build, travel, and explorer metrics.",
    });
    locks.push({
      key: "exploration_summary",
      title: "Public Exploration Summary",
      requiredPlan: "pro",
      reason: "Pro unlocks public exploration percentage and aggregate explorer boards when supported map data exists.",
    });
  }
  if (plan !== "premium") {
    locks.push({
      key: "global_showcase",
      title: "Global Premium Showcase",
      requiredPlan: "premium",
      reason: "Premium unlocks global advanced showcase eligibility, map overlays, travel boards, and premium public presentation.",
    });
    locks.push({
      key: "map_overlay",
      title: "Public Map Overlay",
      requiredPlan: "premium",
      reason: "Premium unlocks aggregate fog-of-war style map overlays without exposing raw player routes.",
    });
  }
  return locks;
}
