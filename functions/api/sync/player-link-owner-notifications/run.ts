import { requireCronSecret } from "../../../_lib/cron-auth";
import { json, methodNotAllowed } from "../../../_lib/http";
import { dispatchQueuedOwnerRequestNotifications } from "../../../_lib/player-game-identity-owner-notifications";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  const result = await dispatchQueuedOwnerRequestNotifications(env, { maxJobs: 20 });
  const taskStatus = result.unavailable || result.processed === 0 ? "no_op" : result.ok ? "success" : "failed";
  return json({
    ...result,
    task_status: taskStatus,
    taskStatus,
    no_op_reason: taskStatus === "no_op" ? result.unavailable ? "owner_delivery_ledger_unavailable" : "no_due_owner_link_notifications" : null,
  }, {
    status: result.ok ? 200 : 503,
    headers: {
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
};
