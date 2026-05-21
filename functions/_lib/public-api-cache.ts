import { requireDb } from "./db";
import type { Env } from "./types";

type CacheRow = {
  snapshot_key: string;
  access_level?: string | null;
  payload_json: string;
  generated_at: string;
  expires_at?: string | null;
  source: string | null;
  stale_allowed_until: string | null;
  updated_at: string | null;
};

export type PublicApiCacheMetadata = {
  generated_at: string;
  source: "live" | "snapshot" | "empty_no_cache" | "empty_no_db";
  stale: boolean;
  snapshot_generated_at?: string;
  message?: string;
  error?: string;
  fallback_reason?: string;
};

let publicApiCacheSchemaReady = false;

export async function writePublicApiCache(env: Env, cacheKey: string, payload: unknown, generatedAt = new Date().toISOString(), accessLevel = accessLevelFromCacheKey(cacheKey)) {
  if (!env.DB) return;
  await ensurePublicApiCacheSchema(env);
  await requireDb(env)
    .prepare(
      `INSERT INTO public_api_snapshots (snapshot_key, access_level, payload_json, generated_at, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime(?, '+7 days'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(snapshot_key) DO UPDATE SET
         access_level = excluded.access_level,
         payload_json = excluded.payload_json,
         generated_at = excluded.generated_at,
         expires_at = excluded.expires_at,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(cacheKey, accessLevel, JSON.stringify(payload), generatedAt, generatedAt)
    .run();
}

export async function readPublicApiCache<T>(env: Env, cacheKey: string): Promise<{ payload: T; generated_at: string } | null> {
  if (!env.DB) return null;
  await ensurePublicApiCacheSchema(env);
  const db = requireDb(env);
  const row = await db
    .prepare("SELECT snapshot_key, access_level, payload_json, generated_at, expires_at, updated_at, NULL AS source, NULL AS stale_allowed_until FROM public_api_snapshots WHERE snapshot_key = ? LIMIT 1")
    .bind(cacheKey)
    .first<CacheRow>();
  const legacyRow = row ?? await db
    .prepare("SELECT snapshot_key, payload_json, generated_at, source, stale_allowed_until, updated_at FROM public_stats_snapshots WHERE snapshot_key = ? LIMIT 1")
    .bind(cacheKey)
    .first<CacheRow>()
    .catch(() => null);
  return parsePublicApiCacheRow<T>(legacyRow);
}

export function publicApiSnapshotKey(surface: "home-stats" | "servers" | "leaderboards" | "server-leaderboard", accessLevel: "preview" | "full", suffix?: string | null) {
  return suffix ? `${surface}:${accessLevel}:${suffix}` : `${surface}:${accessLevel}`;
}

export function publicApiSnapshotAccess(viewerLoggedIn: boolean): "preview" | "full" {
  return viewerLoggedIn ? "full" : "preview";
}

export function publicApiSnapshotFallbackHeaders(viewerLoggedIn: boolean) {
  return viewerLoggedIn
    ? {
        "cache-control": "private, no-store, no-cache, must-revalidate",
        vary: "Cookie",
      }
    : {
        "cache-control": "public, max-age=10, stale-while-revalidate=30",
        vary: "Cookie",
      };
}

function parsePublicApiCacheRow<T>(row: CacheRow | null): { payload: T; generated_at: string } | null {
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
    ...(metadata.snapshot_generated_at ? { snapshot_generated_at: metadata.snapshot_generated_at } : {}),
    ...(metadata.message ? { message: metadata.message } : {}),
  };
}

export function safePublicCacheError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").slice(0, 500);
}

export function logPublicApiLoadFailed(endpoint: string, status: number, error: unknown, requestId?: string | null) {
  console.warn("DZN PUBLIC API LIVE QUERY FAILED", {
    endpoint,
    status,
    request_id: requestId ?? null,
    error: safePublicCacheError(error),
  });
}

export function logPublicApiSnapshotFallbackServed(endpoint: string, cacheKey: string, requestId?: string | null) {
  console.warn("DZN PUBLIC API SNAPSHOT FALLBACK SERVED", {
    endpoint,
    cache_key: cacheKey,
    request_id: requestId ?? null,
  });
}

export function logPublicApi503RootCause(endpoint: string, error: unknown, requestId?: string | null, section?: string) {
  console.warn("DZN PUBLIC API 503 ROOT CAUSE", {
    endpoint,
    request_id: requestId ?? null,
    section: section ?? null,
    error: safePublicCacheError(error),
  });
}

async function ensurePublicApiCacheSchema(env: Env) {
  if (publicApiCacheSchemaReady) return;
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS public_api_snapshots (
        snapshot_key TEXT PRIMARY KEY,
        access_level TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_public_api_snapshots_access_level ON public_api_snapshots(access_level)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_public_api_snapshots_updated_at ON public_api_snapshots(updated_at)").run();

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

function accessLevelFromCacheKey(cacheKey: string): "preview" | "full" {
  return cacheKey.includes(":full") ? "full" : "preview";
}
