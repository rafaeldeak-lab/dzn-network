import {
  canReadDznStoreAccountPurchasesReadModel,
  DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ROUTE,
  DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION,
  readDznStoreAccountPurchasesReadModel,
  safetyBoundary,
} from "../../_lib/dzn-store-account-purchases";
import { json, methodNotAllowed } from "../../_lib/http";
import { getRequestSessionUser } from "../../_lib/owner-access";
import { privateNoStoreHeaders } from "../../_lib/performance";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const access = canReadDznStoreAccountPurchasesReadModel(env);
  if (!access.ok) {
    return json({
      ok: false,
      private: true,
      cache: "no-store",
      scope: "current_user",
      route: DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ROUTE,
      schema_version: DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION,
      error: access.code,
      message: access.message,
      purchases_available: false,
      live_checkout_enabled: false,
      safety: safetyBoundary(),
    }, { status: access.status, headers: privateNoStoreHeaders() });
  }

  const user = await getRequestSessionUser(env, request);
  if (!user) {
    return json({
      ok: false,
      private: true,
      cache: "no-store",
      scope: "current_user",
      route: DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ROUTE,
      schema_version: DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION,
      error: "Unauthorized",
      message: "Login with Discord before viewing private DZN Store purchases.",
      purchases_available: false,
      live_checkout_enabled: false,
      safety: safetyBoundary(),
    }, { status: 401, headers: privateNoStoreHeaders() });
  }

  const result = await readDznStoreAccountPurchasesReadModel(env, user);
  return json(result.body, { status: result.status, headers: privateNoStoreHeaders() });
};
