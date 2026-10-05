import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed } from "./http";
import { noStoreForErrorHeaders, privateNoStoreHeaders } from "./performance";
import type { Env } from "./types";

export const DZN_COMMS_PRESENCE_TTL_SECONDS = 75;
export const DZN_COMMS_PRESENCE_MIN_REFRESH_SECONDS = 20;
export const DZN_COMMS_PRESENCE_CLEANUP_BATCH_SIZE = 250;
const scope = "global_chat" as const;

export type PresenceStorage = {
  countActive(nowIso: string): Promise<number>;
  refresh(actorKeyHash: string, nowIso: string, expiresAt: string, refreshNotBefore: string): Promise<boolean>;
  deleteExpired(nowIso: string, limit: number): Promise<number>;
};

export class D1PresenceStorage implements PresenceStorage {
  constructor(private readonly db: D1Database) {}

  async countActive(nowIso: string) {
    const row = await this.db.prepare(
      `SELECT COUNT(*) AS online_count
       FROM dzn_comms_presence_sessions
       WHERE scope = 'global_chat' AND expires_at > ?`,
    ).bind(nowIso).first<{ online_count?: number | string | null }>();
    return normalizeCount(row?.online_count);
  }

  async refresh(actorKeyHash: string, nowIso: string, expiresAt: string, refreshNotBefore: string) {
    const result = await this.db.prepare(
      `INSERT INTO dzn_comms_presence_sessions
         (actor_key_hash, scope, first_seen_at, last_seen_at, expires_at)
       VALUES (?, 'global_chat', ?, ?, ?)
       ON CONFLICT(actor_key_hash, scope) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         expires_at = excluded.expires_at
       WHERE dzn_comms_presence_sessions.last_seen_at <= ?`,
    ).bind(actorKeyHash, nowIso, nowIso, expiresAt, refreshNotBefore).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async deleteExpired(nowIso: string, limit: number) {
    const result = await this.db.prepare(
      `DELETE FROM dzn_comms_presence_sessions
       WHERE rowid IN (
         SELECT rowid
         FROM dzn_comms_presence_sessions
         WHERE scope = 'global_chat' AND expires_at <= ?
         ORDER BY expires_at ASC
         LIMIT ?
       )`,
    ).bind(nowIso, limit).run();
    return Math.max(0, Number(result.meta?.changes ?? 0));
  }
}
export function readDznCommsPresenceFlags(env: Env, request?: Request) {
  const releaseScope = clean(env.DZN_COMMS_PRESENCE_SCOPE).toLowerCase();
  const localRequest = request ? isLocalRequest(request) : false;
  const scoped = releaseScope === "production" || (releaseScope === "local_test" && localRequest);
  const secretReady = typeof env.DZN_COMMS_PRESENCE_SECRET === "string" && env.DZN_COMMS_PRESENCE_SECRET.length >= 32;
  const counterEnabled = booleanFlag(env.DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED);
  return {
    readEnabled: counterEnabled && booleanFlag(env.DZN_COMMS_PRESENCE_READ_ENABLED) && scoped && secretReady,
    writeEnabled: counterEnabled && booleanFlag(env.DZN_COMMS_PRESENCE_WRITE_ENABLED) && scoped && secretReady,
    retentionEnabled: counterEnabled && booleanFlag(env.DZN_COMMS_PRESENCE_RETENTION_ENABLED) && scoped && secretReady,
    scope: releaseScope,
    secretReady,
    localRequest,
  };
}

export async function handleDznCommsPresence(request: Request, env: Env) {
  if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed();
  const flags = readDznCommsPresenceFlags(env, request);
  if (!flags.readEnabled || (request.method === "POST" && !flags.writeEnabled)) return unavailable();
  const url = new URL(request.url);
  if ((url.searchParams.get("scope") ?? scope).trim().toLowerCase().replace(/-/g, "_") !== scope) {
    return error(400, "INVALID_SCOPE", "Choose the Global Chat presence scope.");
  }
  const storage = new D1PresenceStorage(requireDb(env));
  const now = new Date();
  if (request.method === "POST") {
    if (!sameOrigin(request)) return error(403, "CROSS_ORIGIN", "Cross-origin presence requests are not allowed.");
    const user = await getSessionUser(env, request);
    if (!user) return error(401, "UNAUTHORIZED", "Log in with Discord to join the online count.");
    const actorKeyHash = await actorDigest(user.id, env.DZN_COMMS_PRESENCE_SECRET!);
    const expiresAt = new Date(now.getTime() + DZN_COMMS_PRESENCE_TTL_SECONDS * 1000).toISOString();
    const refreshNotBefore = new Date(now.getTime() - DZN_COMMS_PRESENCE_MIN_REFRESH_SECONDS * 1000).toISOString();
    try {
      const refreshed = await storage.refresh(actorKeyHash, now.toISOString(), expiresAt, refreshNotBefore);
      if (refreshed) await cleanupExpiredPresence(storage, now);
    } catch {
      return error(503, "PRESENCE_STORAGE_UNAVAILABLE", "DZN presence could not be refreshed.");
    }
  }
  try {
    return json(await readPresence(storage, now), { headers: privateNoStoreHeaders() });
  } catch {
    return error(503, "PRESENCE_STORAGE_UNAVAILABLE", "DZN presence is temporarily unavailable.");
  }
}

export async function readPresence(storage: PresenceStorage, now = new Date()) {
  return {
    ok: true as const,
    scope,
    label: "DZN online" as const,
    online_count: await storage.countActive(now.toISOString()),
    precision: "approximate" as const,
    ttl_seconds: DZN_COMMS_PRESENCE_TTL_SECONDS,
    generated_at: now.toISOString(),
  };
}

export async function refreshPresence(storage: PresenceStorage, actorId: string, secret: string, now = new Date()) {
  const actorKeyHash = await actorDigest(actorId, secret);
  const expiresAt = new Date(now.getTime() + DZN_COMMS_PRESENCE_TTL_SECONDS * 1000).toISOString();
  const refreshNotBefore = new Date(now.getTime() - DZN_COMMS_PRESENCE_MIN_REFRESH_SECONDS * 1000).toISOString();
  const refreshed = await storage.refresh(actorKeyHash, now.toISOString(), expiresAt, refreshNotBefore);
  if (refreshed) await cleanupExpiredPresence(storage, now);
  return readPresence(storage, now);
}

export async function cleanupExpiredPresence(storage: PresenceStorage, now = new Date()) {
  return {
    deleted_count: await storage.deleteExpired(now.toISOString(), DZN_COMMS_PRESENCE_CLEANUP_BATCH_SIZE),
    batch_limit: DZN_COMMS_PRESENCE_CLEANUP_BATCH_SIZE,
    scope,
  };
}

async function actorDigest(actorId: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`dzn-comms-presence:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(actorId.normalize("NFKC")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeCount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function isLocalRequest(request: Request) {
  try {
    const host = new URL(request.url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost");
  } catch { return false; }
}

function booleanFlag(value: unknown) {
  return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function unavailable() {
  return json({ ok: false, code: "DZN_COMMS_PRESENCE_DISABLED", message: "DZN presence is not enabled." }, { status: 404, headers: noStoreForErrorHeaders() });
}

function error(status: number, code: string, message: string) {
  return json({ ok: false, code, message }, { status, headers: privateNoStoreHeaders() });
}
