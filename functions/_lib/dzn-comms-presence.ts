import { setCookie } from "./http";

export const DZN_COMMS_PRESENCE_COOKIE_NAME = "dzn_comms_presence";
export const DZN_COMMS_PRESENCE_TTL_SECONDS = 45;
export const DZN_COMMS_PRESENCE_COOKIE_MAX_AGE_SECONDS = 90;
export const DZN_COMMS_PRESENCE_DEFAULT_SCOPE = "community";

export const DZN_COMMS_PRESENCE_SCOPES = ["site", "community", "global_chat"] as const;

export type DznCommsPresenceScope = (typeof DZN_COMMS_PRESENCE_SCOPES)[number];
export type DznCommsPresencePrecision = "approximate" | "unavailable";
export type DznCommsPresenceStatus = "active" | "disabled" | "unavailable";

export type DznCommsPresencePayload = {
  ok: true;
  scope: DznCommsPresenceScope;
  label: "DZN online";
  onlineCount: number | null;
  precision: DznCommsPresencePrecision;
  updatedAt: string;
  ttlSeconds: number;
  status: DznCommsPresenceStatus;
};

export type DznCommsPresenceEnv = {
  DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED?: string;
  DZN_COMMS_PRESENCE_READ_ENABLED?: string;
  DZN_COMMS_PRESENCE_WRITE_ENABLED?: string;
};

export type DznCommsPresenceRecord = {
  presenceKeyHash: string;
  scope: DznCommsPresenceScope;
  firstSeenAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type DznCommsPresenceStorage = {
  cleanupExpired(nowIso: string): Promise<void>;
  upsert(record: DznCommsPresenceRecord): Promise<void>;
  countActive(scope: DznCommsPresenceScope, nowIso: string): Promise<number>;
};

export type DznCommsPresenceReadInput = {
  env: DznCommsPresenceEnv;
  storage?: DznCommsPresenceStorage | null;
  rawScope?: unknown;
  now?: Date;
};

export type DznCommsPresenceHeartbeatInput = DznCommsPresenceReadInput & {
  existingSessionKey?: string | null;
  createSessionKey?: () => string;
  secureCookie?: boolean;
};

export type DznCommsPresenceHeartbeatResult = {
  payload: DznCommsPresencePayload;
  wrote: boolean;
  setCookieHeader?: string;
};

export class D1DznCommsPresenceStorage implements DznCommsPresenceStorage {
  constructor(private readonly db: D1Database) {}

  async cleanupExpired(nowIso: string) {
    await this.db
      .prepare(
        `DELETE FROM dzn_comms_presence_sessions
         WHERE expires_at <= ?`,
      )
      .bind(nowIso)
      .run();
  }

  async upsert(record: DznCommsPresenceRecord) {
    await this.db
      .prepare(
        `INSERT INTO dzn_comms_presence_sessions (
           presence_key_hash,
           scope,
           first_seen_at,
           last_seen_at,
           expires_at
         )
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(presence_key_hash) DO UPDATE SET
           scope = excluded.scope,
           last_seen_at = excluded.last_seen_at,
           expires_at = excluded.expires_at`,
      )
      .bind(record.presenceKeyHash, record.scope, record.firstSeenAt, record.lastSeenAt, record.expiresAt)
      .run();
  }

  async countActive(scope: DznCommsPresenceScope, nowIso: string) {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS online_count
         FROM dzn_comms_presence_sessions
         WHERE scope = ?
           AND expires_at > ?`,
      )
      .bind(scope, nowIso)
      .first<{ online_count?: number | string | null }>();

    return normalizeCount(row?.online_count);
  }
}

export function isDznCommsPublicOnlineCounterEnabled(env: DznCommsPresenceEnv) {
  return isFlagEnabled(env.DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED);
}

export function isDznCommsPresenceReadEnabled(env: DznCommsPresenceEnv) {
  return isDznCommsPublicOnlineCounterEnabled(env) && isFlagEnabled(env.DZN_COMMS_PRESENCE_READ_ENABLED);
}

export function isDznCommsPresenceWriteEnabled(env: DznCommsPresenceEnv) {
  return isDznCommsPublicOnlineCounterEnabled(env) && isFlagEnabled(env.DZN_COMMS_PRESENCE_WRITE_ENABLED);
}

export function normalizeDznCommsPresenceScope(rawScope: unknown): DznCommsPresenceScope {
  const normalized = String(rawScope ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if ((DZN_COMMS_PRESENCE_SCOPES as readonly string[]).includes(normalized)) {
    return normalized as DznCommsPresenceScope;
  }
  return DZN_COMMS_PRESENCE_DEFAULT_SCOPE;
}

export async function readDznCommsPresence(input: DznCommsPresenceReadInput): Promise<DznCommsPresencePayload> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const scope = normalizeDznCommsPresenceScope(input.rawScope);

  if (!isDznCommsPresenceReadEnabled(input.env)) {
    return dznCommsPresencePayload(scope, null, "unavailable", nowIso, "disabled");
  }

  if (!input.storage) {
    return dznCommsPresencePayload(scope, null, "unavailable", nowIso, "unavailable");
  }

  try {
    const count = await input.storage.countActive(scope, nowIso);
    return dznCommsPresencePayload(scope, count, "approximate", nowIso, "active");
  } catch {
    return dznCommsPresencePayload(scope, null, "unavailable", nowIso, "unavailable");
  }
}

export async function refreshDznCommsPresence(input: DznCommsPresenceHeartbeatInput): Promise<DznCommsPresenceHeartbeatResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const scope = normalizeDznCommsPresenceScope(input.rawScope);

  if (!isDznCommsPresenceWriteEnabled(input.env)) {
    return {
      payload: await readDznCommsPresence({ ...input, rawScope: scope, now }),
      wrote: false,
    };
  }

  if (!input.storage) {
    return {
      payload: dznCommsPresencePayload(scope, null, "unavailable", nowIso, "unavailable"),
      wrote: false,
    };
  }

  const sessionKey = isValidPresenceSessionKey(input.existingSessionKey)
    ? input.existingSessionKey
    : (input.createSessionKey ?? createDznCommsPresenceSessionKey)();
  const presenceKeyHash = await hashDznCommsPresenceSessionKey(sessionKey);
  const expiresAt = new Date(now.getTime() + DZN_COMMS_PRESENCE_TTL_SECONDS * 1000).toISOString();

  try {
    await input.storage.cleanupExpired(nowIso);
    await input.storage.upsert({
      presenceKeyHash,
      scope,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      expiresAt,
    });
    return {
      payload: await readDznCommsPresence({ ...input, rawScope: scope, now }),
      wrote: true,
      setCookieHeader: setCookie(DZN_COMMS_PRESENCE_COOKIE_NAME, sessionKey, {
        httpOnly: true,
        maxAge: DZN_COMMS_PRESENCE_COOKIE_MAX_AGE_SECONDS,
        path: "/api/dzn-comms/presence",
        sameSite: "Lax",
        secure: input.secureCookie !== false,
      }),
    };
  } catch {
    return {
      payload: dznCommsPresencePayload(scope, null, "unavailable", nowIso, "unavailable"),
      wrote: false,
    };
  }
}

export function dznCommsPresencePayload(
  scope: DznCommsPresenceScope,
  onlineCount: number | null,
  precision: DznCommsPresencePrecision,
  updatedAt: string,
  status: DznCommsPresenceStatus,
): DznCommsPresencePayload {
  return {
    ok: true,
    scope,
    label: "DZN online",
    onlineCount,
    precision,
    updatedAt,
    ttlSeconds: DZN_COMMS_PRESENCE_TTL_SECONDS,
    status,
  };
}

export function createDznCommsPresenceSessionKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isValidPresenceSessionKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed) ||
    /^[A-Za-z0-9_-]{32,128}$/.test(trimmed);
}

export async function hashDznCommsPresenceSessionKey(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isFlagEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function normalizeCount(value: number | string | null | undefined) {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.trunc(count);
}
