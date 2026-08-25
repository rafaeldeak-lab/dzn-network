import { getSessionUser, MOCK_USER_ID } from "./db";
import { json } from "./http";
import { isMockAuth, mockUser } from "./mock";
import { effectiveEntitlementPlan, getPlanConfig, normalizePlanKey, type PlanKey } from "./plans";
import type { Env, SessionUser } from "./types";

export type EffectiveOwnerPlanKey = "free" | "starter" | "pro" | "premium";

export type OwnerAccessErrorCode = "NOT_AUTHENTICATED" | "OWNER_PLAN_REQUIRED" | "OWNER_ACCESS_UNAVAILABLE";

export type OwnerAccessResult = {
  allowed: boolean;
  status: 200 | 401 | 402 | 503;
  errorCode: OwnerAccessErrorCode | null;
  message: string;
  pricingUrl: string;
  user: SessionUser | null;
  storedPlanKey: PlanKey;
  effectivePlanKey: EffectiveOwnerPlanKey;
  planStatus: string;
  planLabel: string;
  linkedServerLimit: number;
  source: "billing_account" | "mock" | "missing" | "unavailable";
};

type OwnerBillingAccountRow = {
  plan_key: string | null;
  plan_status: string | null;
};

const OWNER_SETUP_PRICING_URL = "/pricing?intent=owner_setup&returnTo=%2Fsetup";
const OWNER_ACCESS_MESSAGE = "Choose Starter or Pro before using owner setup and server-management tools.";

export function pricingUrlForOwnerAccess(returnTo = "/setup") {
  const params = new URLSearchParams({ intent: "owner_setup", returnTo });
  return `/pricing?${params.toString()}`;
}

export function returnToFromRequest(request: Request) {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

export function mockSessionUser(): SessionUser {
  return {
    id: MOCK_USER_ID,
    discord_id: mockUser.id,
    username: mockUser.username,
    avatar: mockUser.avatar,
  };
}

export async function getRequestSessionUser(env: Env, request: Request): Promise<SessionUser | null> {
  if (isMockAuth(env.MOCK_AUTH)) return mockSessionUser();
  return getSessionUser(env, request);
}

export async function requireOwnerRequestAccess(
  env: Env,
  request: Request,
  returnTo = returnToFromRequest(request),
): Promise<OwnerAccessResult> {
  let user: SessionUser | null = null;
  try {
    user = await getRequestSessionUser(env, request);
  } catch {
    return ownerAccessUnavailable(null, returnTo);
  }

  if (!user) {
    return {
      allowed: false,
      status: 401,
      errorCode: "NOT_AUTHENTICATED",
      message: "Login with Discord before using owner tools.",
      pricingUrl: pricingUrlForOwnerAccess(returnTo),
      user: null,
      storedPlanKey: "free",
      effectivePlanKey: "free",
      planStatus: "free",
      planLabel: getPlanConfig("free").name,
      linkedServerLimit: 0,
      source: "missing",
    };
  }

  return requireActiveOwnerEntitlement(env, user, returnTo);
}

export async function requireActiveOwnerEntitlement(
  env: Env,
  user: SessionUser,
  returnTo = "/setup",
): Promise<OwnerAccessResult> {
  const pricingUrl = pricingUrlForOwnerAccess(returnTo);

  if (isMockAuth(env.MOCK_AUTH)) {
    const mockEntitlements = getPlanConfig("starter");
    return {
      allowed: true,
      status: 200,
      errorCode: null,
      message: "Mock owner entitlement is active.",
      pricingUrl,
      user,
      storedPlanKey: "starter",
      effectivePlanKey: "starter",
      planStatus: "trialing",
      planLabel: mockEntitlements.name,
      linkedServerLimit: mockEntitlements.max_linked_servers,
      source: "mock",
    };
  }

  if (!env.DB) return ownerAccessUnavailable(user, returnTo);

  let row: OwnerBillingAccountRow | null = null;
  try {
    row = await env.DB
      .prepare(
        `SELECT plan_key, plan_status
         FROM owner_billing_accounts
         WHERE discord_user_id = ?
         LIMIT 1`,
      )
      .bind(user.discord_id)
      .first<OwnerBillingAccountRow>();
  } catch {
    return ownerAccessUnavailable(user, returnTo);
  }

  const storedPlanKey = normalizePlanKey(row?.plan_key ?? "free");
  const planStatus = row?.plan_status ?? "free";
  const effectivePlanKey = effectiveEntitlementPlan(storedPlanKey, planStatus);
  const entitlements = getPlanConfig(effectivePlanKey);
  const ownerAllowed = effectivePlanKey !== "free";

  return {
    allowed: ownerAllowed,
    status: ownerAllowed ? 200 : 402,
    errorCode: ownerAllowed ? null : "OWNER_PLAN_REQUIRED",
    message: ownerAllowed ? "Owner entitlement is active." : OWNER_ACCESS_MESSAGE,
    pricingUrl,
    user,
    storedPlanKey,
    effectivePlanKey,
    planStatus,
    planLabel: entitlements.name,
    linkedServerLimit: ownerAllowed ? entitlements.max_linked_servers : 0,
    source: row ? "billing_account" : "missing",
  };
}

function ownerAccessUnavailable(user: SessionUser | null, returnTo: string): OwnerAccessResult {
  return {
    allowed: false,
    status: 503,
    errorCode: "OWNER_ACCESS_UNAVAILABLE",
    message: "Owner entitlement status could not be verified.",
    pricingUrl: pricingUrlForOwnerAccess(returnTo),
    user,
    storedPlanKey: "free",
    effectivePlanKey: "free",
    planStatus: "unknown",
    planLabel: getPlanConfig("free").name,
    linkedServerLimit: 0,
    source: "unavailable",
  };
}

export function ownerAccessErrorPayload(access: OwnerAccessResult) {
  return {
    ok: false,
    error: access.errorCode,
    message: access.message,
    pricing_url: access.pricingUrl,
    owner_plan_required: access.errorCode === "OWNER_PLAN_REQUIRED",
    entitlement: {
      stored_plan_key: access.storedPlanKey,
      effective_plan_key: access.effectivePlanKey,
      plan_status: access.planStatus,
      linked_server_limit: access.linkedServerLimit,
    },
  };
}

export function ownerAccessErrorResponse(access: OwnerAccessResult) {
  return json(ownerAccessErrorPayload(access), { status: access.status });
}

export const OWNER_SETUP_PRICING_PATH = OWNER_SETUP_PRICING_URL;
