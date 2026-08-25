import { ensureMockUser, getLinkedServersForUserSummary, getSessionUser } from "../../_lib/db";
import { json } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import { effectiveEntitlementPlan, getPlanConfig, normalizePlanKey, type PlanKey } from "../../_lib/plans";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type NavigationPlanTier = "free" | "starter" | "pro";
type NavigationPrimaryAction = {
  label: "Owner Plans" | "Upgrade to Pro" | "Owner Dashboard";
  href: string;
  tone: "trial" | "upgrade" | "pro";
};

type OwnerBillingNavigationRow = {
  plan_key: string | null;
  plan_status: string | null;
};

const OWNER_SETUP_PRICING_URL = "/pricing?intent=owner_setup&returnTo=%2Fsetup";

export const onRequest: PagesFunction = async ({ request, env }) => {
  let user = await getSessionUser(env, request);

  if (!user && isMockAuth(env.MOCK_AUTH)) {
    const mock = await ensureMockUser(env);
    user = {
      id: mock.userId,
      discord_id: mock.user.id,
      username: mock.user.username,
      avatar: mock.user.avatar,
    };
  }

  if (!user) {
    return json({ authenticated: false }, { status: 401 });
  }

  const linkedServers = await getLinkedServersForUserSummary(env, user.id);
  const linkedServer = linkedServers[0] ?? null;
  const navigation = await getAuthNavigationSummary(env, user, linkedServers.length);
  return json({ authenticated: true, user, linkedServer, linkedServers, navigation }, {
    headers: {
      "cache-control": "private, max-age=15",
    },
  });
};

async function getAuthNavigationSummary(env: Env, user: SessionUser, linkedServerCount: number) {
  const account = await readOwnerBillingNavigationRow(env, user.discord_id);
  const storedPlanKey = normalizePlanKey(account?.plan_key ?? "free");
  const planStatus = stringOrDefault(account?.plan_status, storedPlanKey === "free" ? "free" : "unknown");
  const effectivePlanKey = effectiveEntitlementPlan(storedPlanKey, planStatus);
  const tier = navigationTierForPlan(effectivePlanKey);
  const config = getPlanConfig(effectivePlanKey);
  const canUseOwnerTools = effectivePlanKey !== "free";
  return {
    effective_plan_key: effectivePlanKey,
    stored_plan_key: storedPlanKey,
    plan_tier: tier,
    plan_label: navigationPlanLabel(effectivePlanKey, planStatus),
    plan_status: planStatus,
    role: canUseOwnerTools ? "owner" : "player",
    can_use_player_surfaces: true,
    can_use_owner_tools: canUseOwnerTools,
    owner_action_required: canUseOwnerTools ? null : "choose_plan",
    owner_pricing_url: OWNER_SETUP_PRICING_URL,
    linked_server_count: linkedServerCount,
    linked_server_limit: canUseOwnerTools ? config.max_linked_servers : 0,
    can_link_more_servers: canUseOwnerTools && linkedServerCount < config.max_linked_servers,
    can_use_pro_tools: tier === "pro",
    primary_action: navigationPrimaryActionForTier(tier),
  };
}

async function readOwnerBillingNavigationRow(env: Env, discordUserId: string) {
  if (!env.DB) return null;
  try {
    return await env.DB
      .prepare("SELECT plan_key, plan_status FROM owner_billing_accounts WHERE discord_user_id = ? LIMIT 1")
      .bind(discordUserId)
      .first<OwnerBillingNavigationRow>();
  } catch {
    return null;
  }
}

function navigationTierForPlan(planKey: PlanKey): NavigationPlanTier {
  if (planKey === "starter") return "starter";
  if (planKey === "pro" || planKey === "premium") return "pro";
  return "free";
}

function navigationPlanLabel(planKey: PlanKey, planStatus: string) {
  if (planKey === "starter") return planStatus.toLowerCase() === "trialing" ? "Starter Trial" : "Starter";
  if (planKey === "pro" || planKey === "premium") return "Pro";
  return "Free";
}

function navigationPrimaryActionForTier(tier: NavigationPlanTier): NavigationPrimaryAction {
  if (tier === "pro") return { label: "Owner Dashboard", href: "/dashboard", tone: "pro" };
  if (tier === "starter") return { label: "Upgrade to Pro", href: "/pricing?intent=pro&returnTo=%2Fdashboard", tone: "upgrade" };
  return { label: "Owner Plans", href: OWNER_SETUP_PRICING_URL, tone: "trial" };
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
