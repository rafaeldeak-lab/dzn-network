import { requireDb } from "./db";
import type { Env } from "./types";

type CacheRow = {
  snapshot_key: string;
  payload_json: string;
  generated_at: string;
  source: string | null;
  stale_allowed_until: string | null;
  updated_at: string | null;
};

export type PublicApiCacheMetadata = {
  generated_at: string;
  source: "live" | "snapshot" | "empty_no_cache" | "empty_no_db";
  stale: boolean;
  error?: string;
  fallback_reason?: string;
};

let publicApiCacheSchemaReady = false;

export async function writePublicApiCache(env: Env, cacheKey: string, payload: unknown, generatedAt = new Date().toISOString()) {
  if (!env.DB) return;
  await ensurePublicApiCacheSchema(env);
  await requireDb(env)
    .prepare(
      `INSERT INTO public_stats_snapshots (id, snapshot_key, payload_json, generated_at, source, stale_allowed_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'live', datetime(?, '+7 days'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(snapshot_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         generated_at = excluded.generated_at,
         source = excluded.source,
         stale_allowed_until = excluded.stale_allowed_until,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(crypto.randomUUID(), cacheKey, JSON.stringify(payload), generatedAt, generatedAt)
    .run();
}

export async function readPublicApiCache<T>(env: Env, cacheKey: string): Promise<{ payload: T; generated_at: string } | null> {
  if (!env.DB) return null;
  await ensurePublicApiCacheSchema(env);
  const row = await requireDb(env)
    .prepare("SELECT snapshot_key, payload_json, generated_at, source, stale_allowed_until, updated_at FROM public_stats_snapshots WHERE snapshot_key = ? LIMIT 1")
    .bind(cacheKey)
    .first<CacheRow>();
  if (!row?.payload_json) return null;
  try {
    return {
      payload: JSON.parse(row.payload_json) as T,
      generated_at: row.generated_at,
    };
  } catch {
    return null;
  }
}

export function withPublicApiMetadata<T extends object>(
  payload: T,
  metadata: PublicApiCacheMetadata,
): T & PublicApiCacheMetadata & { ok: true; data: T } {
  return {
    ...payload,
    ok: true,
    data: payload,
    generated_at: metadata.generated_at,
    source: metadata.source,
    stale: metadata.stale,
    ...(metadata.error ? { error: metadata.error } : {}),
    ...(metadata.fallback_reason ? { fallback_reason: metadata.fallback_reason } : {}),
  };
}

export function safePublicCacheError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").slice(0, 500);
}

export function logPublicApiLoadFailed(endpoint: string, status: number, error: unknown, requestId?: string | null) {
  console.warn("DZN PUBLIC API LOAD FAILED", {
    endpoint,
    status,
    request_id: requestId ?? null,
    error: safePublicCacheError(error),
  });
}

async function ensurePublicApiCacheSchema(env: Env) {
  if (publicApiCacheSchemaReady) return;
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS public_stats_snapshots (
        id TEXT PRIMARY KEY,
        snapshot_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        source TEXT,
        stale_allowed_until TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_public_stats_snapshots_updated_at ON public_stats_snapshots(updated_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_public_stats_snapshots_key ON public_stats_snapshots(snapshot_key)").run();
  publicApiCacheSchemaReady = true;
}
