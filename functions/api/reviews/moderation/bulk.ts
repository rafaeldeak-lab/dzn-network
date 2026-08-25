import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { authorizeReviewModerationRequest, bulkModerateRepeatedReports } from "../../../_lib/review-moderation-dashboard";
import type { PagesFunction } from "../../../_lib/types";

type BulkModerationBody = {
  action?: unknown;
  pattern_key?: unknown;
  reason?: unknown;
  limit?: unknown;
  min_report_count?: unknown;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const auth = await authorizeReviewModerationRequest(env, request);
  if (!auth.ok) return auth.response;

  const body = await readBoundedJson<BulkModerationBody>(request, 4096);
  if (!body.ok) {
    return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  }

  try {
    const result = await bulkModerateRepeatedReports(env, auth.actor, body.value);
    if (!result.ok) {
      return json(result, { status: result.status, headers: privateNoStoreHeaders() });
    }
    return json(result, { headers: privateNoStoreHeaders() });
  } catch (error) {
    console.warn("DZN review moderation bulk action unavailable", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        ok: false,
        error: "REVIEW_MODERATION_BULK_UNAVAILABLE",
        message: "Bulk review moderation is temporarily unavailable.",
      },
      { status: 500, headers: privateNoStoreHeaders() },
    );
  }
};
