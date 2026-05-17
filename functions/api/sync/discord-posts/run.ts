import { dispatchQueuedDiscordPostUpdates } from "../../../_lib/discord-posting";
import { isCronSecretAuthorized } from "../../../_lib/cron-auth";
import { json, readJson } from "../../../_lib/http";
import type { Env, PagesContext, PagesFunction } from "../../../_lib/types";

type DiscordPostRunBody = {
  max_jobs?: number;
  cron?: string;
};

type DiscordPostRunHandlers = {
  dispatch: typeof dispatchQueuedDiscordPostUpdates;
};

const DEFAULT_HANDLERS: DiscordPostRunHandlers = {
  dispatch: dispatchQueuedDiscordPostUpdates,
};

export const onRequestPost: PagesFunction = (context) => handleDiscordPostRun(context);

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "POST, OPTIONS" },
});

export const onRequestGet: PagesFunction = () => json(
  { error: "Method not allowed", allowed: ["POST"] },
  { status: 405, headers: { Allow: "POST" } },
);

export async function handleDiscordPostRun(
  { request, env }: PagesContext,
  handlers: DiscordPostRunHandlers = DEFAULT_HANDLERS,
) {
  const body = await readJson<DiscordPostRunBody>(request);
  if (!isDiscordPostCronAuthorized(request, env)) return json({ error: "Unauthorized" }, { status: 401 });
  const result = await handlers.dispatch(env, {
    maxJobs: sanitizePositiveInteger(body.max_jobs, 25),
  });
  return json({
    ...result,
    cron: typeof body.cron === "string" && body.cron.trim() ? body.cron.trim().slice(0, 80) : null,
  });
}

export function isDiscordPostCronAuthorized(request: Request, env: Env) {
  return isCronSecretAuthorized(request, env);
}

function sanitizePositiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(Math.trunc(number), 100000) : fallback;
}
