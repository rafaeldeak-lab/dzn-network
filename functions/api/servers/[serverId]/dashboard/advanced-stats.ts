import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../_lib/types";

const PRIVATE_HEADERS = {
  "cache-control": "private, max-age=20",
};

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  const linkedServerId = sanitizeParam(params.serverId);
  if (!linkedServerId) {
    return json({ ok: false, error: "invalid_server_id" }, { status: 400 });
  }

  const user = await getSessionUser(env, request);
  if (!user) {
    return json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
  if (!access.allowed) {
    return json({
      ok: false,
      error: access.reason === "not_found" ? "server_not_found" : "forbidden",
    }, { status: access.reason === "not_found" ? 404 : 403 });
  }

  try {
    const payload = await readDurableAdvancedStatsSnapshot(linkedServerId);
    if (!payload) {
      return json(advancedStatsPending(), { headers: PRIVATE_HEADERS });
    }
    return json(payload, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.warn("DZN DASHBOARD ADVANCED STATS LOAD FAILED", safeError(error));
    return json({
      ...advancedStatsPending(),
      reason: "advanced_stats_snapshot_unavailable",
      warning: "Advanced showcase data is temporarily unavailable. Core dashboard stats remain live.",
    }, { headers: PRIVATE_HEADERS });
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

function sanitizeParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 96);
}

async function readDurableAdvancedStatsSnapshot(_linkedServerId: string) {
  // Durable advanced analytics snapshots are produced outside the dashboard GET
  // path. Until one exists, the route intentionally degrades instead of
  // rebuilding travel/exploration analytics from raw ADM event tables.
  return null;
}

function advancedStatsPending() {
  return {
    ok: true,
    available: false,
    stale: false,
    reason: "advanced_stats_snapshot_pending",
    generated_at: new Date().toISOString(),
    data: null,
    notes: [
      "Advanced Showcase is temporarily unavailable. Core canonical stats remain live.",
    ],
  };
}

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}
