import { requireCronSecret } from "../../../_lib/cron-auth";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import {
  dispatchQueuedOwnerRequestNotifications,
  OWNER_REQUEST_NOTIFICATION_MAX_JOBS,
} from "../../../_lib/player-game-identity-owner-notifications";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST" && request.method !== "GET") return methodNotAllowed();
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  if (request.method === "GET") {
    return json({
      ok: true,
      proof_contract: "owner_notification_single_delivery_v1",
      max_jobs_parameter: true,
      max_supported_jobs: OWNER_REQUEST_NOTIFICATION_MAX_JOBS,
    }, {
      headers: {
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const body = await readBoundedJson<Record<string, unknown>>(request, 1024);
  if (!body.ok) return json(body, { status: body.status });
  const requestedJobs = Number(body.value.max_jobs);
  const maxJobs = Number.isFinite(requestedJobs) && requestedJobs > 0
    ? Math.min(Math.trunc(requestedJobs), OWNER_REQUEST_NOTIFICATION_MAX_JOBS)
    : OWNER_REQUEST_NOTIFICATION_MAX_JOBS;
  const result = await dispatchQueuedOwnerRequestNotifications(env, { maxJobs });
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
