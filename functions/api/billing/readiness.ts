import { requireBadgeAdminUser } from "../../_lib/badge-evaluation";
import { json, methodNotAllowed } from "../../_lib/http";
import { getBillingReadinessStatus } from "../../_lib/plans";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const auth = await requireBadgeAdminUser(env, request);
  if (!auth.ok) return json(auth.payload, { status: auth.status });

  return json({
    ok: true,
    role: auth.role,
    ...getBillingReadinessStatus(env),
  });
};
