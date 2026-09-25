import { requireCronSecret } from "../../../_lib/cron-auth";
import { json, methodNotAllowed } from "../../../_lib/http";
import { dispatchQueuedPlayerGameIdentityNotifications } from "../../../_lib/player-game-identity-notifications";
import { dispatchQueuedOwnerRequestNotifications } from "../../../_lib/player-game-identity-owner-notifications";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  const [decisionResult, ownerRequestResult] = await Promise.all([
    dispatchQueuedPlayerGameIdentityNotifications(env, { maxJobs: 20 }),
    dispatchQueuedOwnerRequestNotifications(env, { maxJobs: 20 }),
  ]);
  const result = {
    ok: decisionResult.ok && ownerRequestResult.ok,
    unavailable: decisionResult.unavailable && ownerRequestResult.unavailable,
    processed: decisionResult.processed + ownerRequestResult.processed,
    delivered: decisionResult.delivered + ownerRequestResult.delivered,
    retried: decisionResult.retried + ownerRequestResult.retried,
    failed: decisionResult.failed + ownerRequestResult.failed,
    skipped: decisionResult.skipped + ownerRequestResult.skipped,
    decisions: decisionResult,
    owner_requests: ownerRequestResult,
  };
  const taskStatus = result.unavailable || result.processed === 0 ? "no_op" : result.ok ? "success" : "failed";
  return json({
    ...result,
    task_status: taskStatus,
    taskStatus,
    no_op_reason: taskStatus === "no_op" ? result.unavailable ? "delivery_ledger_unavailable" : "no_due_player_link_notifications" : null,
  }, {
    status: result.ok ? 200 : 503,
    headers: {
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
};
