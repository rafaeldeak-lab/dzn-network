import { runAdmSync, runScheduledAdmSync } from "../../../_lib/adm-sync";
import { ensureMockUser, getSessionUser } from "../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

type AdmSyncRunBody = {
  linked_server_id?: string;
  max_servers?: number;
  max_lines_per_server?: number;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const body = await readJson<AdmSyncRunBody>(request);
  if (isCronAuthorized(request, env)) {
    const result = await runScheduledAdmSync(env, {
      maxServers: sanitizePositiveInteger(body.max_servers, 25),
      maxLinesPerServer: sanitizePositiveInteger(body.max_lines_per_server, 50000),
      minSyncIntervalMs: 0,
    });
    console.log("DZN RELIABLE ADM AUTO SYNC READY", {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
    });
    return json(result);
  }

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await runAdmSync(env, user.id, sanitizeLinkedServerId(body.linked_server_id), {
      triggerType: "manual",
      maxLinesPerRun: sanitizePositiveInteger(body.max_lines_per_server, 50000),
    });
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "ADM sync failed" }, { status: 400 });
  }
};

export function isCronAuthorized(request: Request, env: Env) {
  const expected = env.SYNC_CRON_SECRET;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;

  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function sanitizePositiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(Math.trunc(number), 100000) : fallback;
}
