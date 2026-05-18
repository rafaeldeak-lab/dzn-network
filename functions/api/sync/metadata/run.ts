import { refreshLivePlayerCountsForActiveServers } from "../../../_lib/server-metadata";
import { normalizeAutomationCronSource, recordAutomationCronRun } from "../../../_lib/automation";
import { isCronSecretAuthorized } from "../../../_lib/cron-auth";
import { json, readJson } from "../../../_lib/http";
import type { Env, PagesContext, PagesFunction } from "../../../_lib/types";

type MetadataSyncRunBody = {
  cron?: string;
  source?: string;
  max_servers?: number;
};

type MetadataSyncRunHandlers = {
  refreshMetadata: typeof refreshLivePlayerCountsForActiveServers;
};

const DEFAULT_HANDLERS: MetadataSyncRunHandlers = {
  refreshMetadata: refreshLivePlayerCountsForActiveServers,
};

export const onRequestPost: PagesFunction = (context) => handleMetadataSyncRun(context);

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: {
    Allow: "POST, OPTIONS",
  },
});

export const onRequestGet: PagesFunction = () => json(
  { error: "Method not allowed", allowed: ["POST"] },
  {
    status: 405,
    headers: {
      Allow: "POST",
    },
  },
);

export async function handleMetadataSyncRun(
  { request, env }: PagesContext,
  handlers: MetadataSyncRunHandlers = DEFAULT_HANDLERS,
) {
  const body = await readJson<MetadataSyncRunBody>(request);
  if (!isMetadataCronAuthorized(request, env)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const source = normalizeAutomationCronSource(body.source, body.cron);
  let result: Awaited<ReturnType<typeof refreshLivePlayerCountsForActiveServers>>;
  try {
    result = await handlers.refreshMetadata(env, {
      maxServers: sanitizePositiveInteger(body.max_servers, 25),
      includeResults: true,
    });
    await safeRecordCronRun(env, source, "completed");
  } catch (error) {
    await safeRecordCronRun(env, source, "failed");
    throw error;
  }

  console.log("DZN LIVE PLAYER COUNT AUTO SYNC READY", {
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    skipped: result.skipped,
    updated_player_counts: result.updated_player_counts,
  });
  console.log("DZN METADATA SYNC INDEPENDENT OF ADM READY", {
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    skipped: result.skipped,
  });

  return json({
    ok: true,
    ...result,
    source,
    cron: typeof body.cron === "string" && body.cron.trim() ? body.cron.trim().slice(0, 80) : null,
  });
}

export function isMetadataCronAuthorized(request: Request, env: Env) {
  return isCronSecretAuthorized(request, env);
}

function sanitizePositiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(Math.trunc(number), 100000) : fallback;
}

async function safeRecordCronRun(env: Env, source: ReturnType<typeof normalizeAutomationCronSource>, status: "completed" | "failed") {
  try {
    await recordAutomationCronRun(env, { source, endpoint: "metadata", status });
  } catch (error) {
    console.warn("DZN AUTOMATION CRON RUN RECORD SKIPPED", {
      endpoint: "metadata",
      message: error instanceof Error ? error.message : "record failed",
    });
  }
}
