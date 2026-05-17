import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { getBillingPlanSummaries } from "../../_lib/plans";
import type { PagesFunction } from "../../_lib/types";

let hasLoggedBillingPlanRuntimeConfig = false;

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  if (!hasLoggedBillingPlanRuntimeConfig && (isMockAuth(env.MOCK_AUTH) || isMockNitrado(env.MOCK_NITRADO))) {
    console.log("DZN BILLING PLANS RUNTIME CONFIG READY");
    console.log("DZN STRIPE BILLING CONFIG HARDENED");
    hasLoggedBillingPlanRuntimeConfig = true;
  }

  return json({ plans: getBillingPlanSummaries(env) });
};
