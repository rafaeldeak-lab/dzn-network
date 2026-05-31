import { requireCronSecret } from "../../../_lib/cron-auth";
import { json, readJson } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

type RetryUnreadableBody = {
  serviceId?: string;
  limit?: number;
  onlyLatest?: boolean;
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  const body = await readJson<RetryUnreadableBody>(request);
  const serviceId = sanitizeServiceId(body.serviceId);
  if (!serviceId) {
    return json({ ok: false, error: "invalid_request", message: "serviceId is required." }, { status: 400 });
  }

  try {
    const { retryUnreadableAdmFilesForService } = await import("../../../_lib/adm-sync");
    const result = await retryUnreadableAdmFilesForService(env, {
      serviceId,
      limit: sanitizeLimit(body.limit),
      onlyLatest: body.onlyLatest === true,
    });
    return json(result);
  } catch (error) {
    return json({
      ok: false,
      serviceId,
      error: "retry_unreadable_failed",
      message: error instanceof Error ? error.message : "Retry unreadable ADM files failed.",
    }, { status: 500 });
  }
};

export const onRequestOptions: PagesFunction = ({ request, env }) => {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  return new Response(null, {
    status: 204,
    headers: { Allow: "POST, OPTIONS" },
  });
};

export const onRequestGet: PagesFunction = ({ request, env }) => {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  return json(
    { error: "Method not allowed", allowed: ["POST"] },
    { status: 405, headers: { Allow: "POST" } },
  );
};

function sanitizeServiceId(value: unknown) {
  const text = String(value ?? "").trim();
  return /^[0-9]{4,20}$/.test(text) ? text : null;
}

function sanitizeLimit(value: unknown) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, 25) : 5;
}
