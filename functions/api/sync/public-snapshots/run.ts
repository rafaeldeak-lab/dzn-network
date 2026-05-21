import { getPublicHomeStatsPayload } from "../../public/home-stats";
import { getPublicServersPayload } from "../../public/servers";
import { getPublicLeaderboardsPayload, getPublicServerLeaderboardPayload } from "../../../_lib/public-leaderboards";
import { requireCronSecret } from "../../../_lib/cron-auth";
import { json, readJson } from "../../../_lib/http";
import { safePublicCacheError, writePublicApiCache } from "../../../_lib/public-api-cache";
import type { Env, PagesContext, PagesFunction } from "../../../_lib/types";

type PublicSnapshotRunBody = {
  cron?: string;
  source?: string;
};

type PublicSnapshotResult = {
  key: string;
  access_level: "preview" | "full";
  status: "generated" | "failed";
  generated_at?: string;
  error?: string;
};

type SnapshotTask = {
  key: string;
  accessLevel: "preview" | "full";
  build: (env: Env) => Promise<unknown>;
};

const PUBLIC_SNAPSHOT_KEYS = {
  homeStatsPreview: "home-stats:preview",
  homeStatsFull: "home-stats:full",
  serversPreview: "servers:preview",
  serversFull: "servers:full",
  leaderboardsPreview: "leaderboards:preview",
  leaderboardsFull: "leaderboards:full",
  serverLeaderboardPreview: "server-leaderboard:preview",
  serverLeaderboardFull: "server-leaderboard:full",
} as const;

export const onRequestPost: PagesFunction = (context) => handlePublicSnapshotsRun(context);

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

export async function handlePublicSnapshotsRun({ request, env }: PagesContext) {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  const body = await readJson<PublicSnapshotRunBody>(request);
  const results = await prewarmPublicApiSnapshots(env);
  const generated = results.filter((result) => result.status === "generated").length;
  const failed = results.length - generated;

  console.log("DZN PUBLIC SNAPSHOTS PREWARMED", {
    generated,
    failed,
    cron: typeof body.cron === "string" ? body.cron.slice(0, 80) : null,
    source: typeof body.source === "string" ? body.source.slice(0, 80) : null,
  });

  return json({
    ok: failed === 0,
    generated,
    failed,
    snapshots: results,
  });
}

export async function prewarmPublicApiSnapshots(env: Env): Promise<PublicSnapshotResult[]> {
  const tasks = publicSnapshotTasks();
  const results: PublicSnapshotResult[] = [];

  for (const task of tasks) {
    try {
      const generatedAt = new Date().toISOString();
      const payload = await task.build(env);
      await writePublicApiCache(env, task.key, payload, generatedAt, task.accessLevel);
      results.push({
        key: task.key,
        access_level: task.accessLevel,
        status: "generated",
        generated_at: generatedAt,
      });
    } catch (error) {
      results.push({
        key: task.key,
        access_level: task.accessLevel,
        status: "failed",
        error: safePublicCacheError(error),
      });
    }
  }

  return results;
}

function publicSnapshotTasks(): SnapshotTask[] {
  return [
    {
      key: PUBLIC_SNAPSHOT_KEYS.homeStatsPreview,
      accessLevel: "preview",
      build: (env) => getPublicHomeStatsPayload(env, false),
    },
    {
      key: PUBLIC_SNAPSHOT_KEYS.homeStatsFull,
      accessLevel: "full",
      build: (env) => getPublicHomeStatsPayload(env, true),
    },
    {
      key: PUBLIC_SNAPSHOT_KEYS.serversPreview,
      accessLevel: "preview",
      build: (env) => getPublicServersPayload(env, null, false),
    },
    {
      key: PUBLIC_SNAPSHOT_KEYS.serversFull,
      accessLevel: "full",
      build: (env) => getPublicServersPayload(env, null, true),
    },
    {
      key: PUBLIC_SNAPSHOT_KEYS.leaderboardsPreview,
      accessLevel: "preview",
      build: (env) => getPublicLeaderboardsPayload(env, false),
    },
    {
      key: PUBLIC_SNAPSHOT_KEYS.leaderboardsFull,
      accessLevel: "full",
      build: (env) => getPublicLeaderboardsPayload(env, true),
    },
    {
      key: PUBLIC_SNAPSHOT_KEYS.serverLeaderboardPreview,
      accessLevel: "preview",
      build: (env) => getPublicServerLeaderboardPayload(env, { limit: 10 }, false),
    },
    {
      key: PUBLIC_SNAPSHOT_KEYS.serverLeaderboardFull,
      accessLevel: "full",
      build: (env) => getPublicServerLeaderboardPayload(env, { limit: 10 }, true),
    },
  ];
}
