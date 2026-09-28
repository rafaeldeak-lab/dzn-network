import { requireCronSecret } from "../../../_lib/cron-auth";
import { json, methodNotAllowed } from "../../../_lib/http";
import { dispatchQueuedPlayerGameIdentityNotifications } from "../../../_lib/player-game-identity-notifications";
import type { PagesFunction } from "../../../_lib/types";

const CONFIRMATION = "APPROVE_ONE_PLAYER_LINK_NOTIFICATION_TEST";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  const input = await request.json().catch(() => null) as { confirmation?: unknown; delivery_id?: unknown } | null;
  const deliveryId = typeof input?.delivery_id === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(input.delivery_id)
    ? input.delivery_id
    : null;
  if (input?.confirmation !== CONFIRMATION || !deliveryId) {
    return json({
      ok: false,
      error: "INVALID_PROOF_REQUEST",
      message: "A valid confirmation and explicit delivery reference are required.",
    }, { status: 400, headers: proofHeaders() });
  }

  const result = await dispatchQueuedPlayerGameIdentityNotifications(env, { deliveryId, maxJobs: 1 });
  const taskStatus = result.unavailable || result.processed === 0 ? "no_op" : result.ok ? "success" : "failed";
  return json({
    ...result,
    proof_contract: "player_notification_targeted_single_delivery_v1",
    delivery_id: deliveryId,
    task_status: taskStatus,
    taskStatus,
    no_op_reason: taskStatus === "no_op" ? result.unavailable ? "delivery_ledger_unavailable" : "target_delivery_not_due" : null,
  }, {
    status: result.ok ? 200 : 503,
    headers: proofHeaders(),
  });
};

function proofHeaders() {
  return {
    "cache-control": "no-store, private",
    "x-content-type-options": "nosniff",
  };
}
