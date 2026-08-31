import { getRequestSessionUser } from "./owner-access";
import { privateNoStoreHeaders } from "./performance";
import type { Env, SessionUser } from "./types";

export const DZN_COMMS_MESSAGE_READ_ROUTE = "/api/dzn-comms/channels/:channelId/messages";
export const DZN_COMMS_MESSAGE_READ_SCHEMA_VERSION = "2026-08-31.dzn-comms-message-read-v1";
export const DZN_COMMS_MESSAGE_READ_ENABLED_FLAG = "DZN_COMMS_MESSAGE_READ_ENABLED";
export const DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME_FLAG = "DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME";
export const DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED_FLAG = "DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED";
export const DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED_FLAG = "DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED";

export const DZN_COMMS_PUBLIC_CHANNEL_KEYS = ["global", "new-players", "server-owners", "events"] as const;
export const DZN_COMMS_MESSAGE_READ_UNAVAILABLE_ACTIONS = [
  "message_sending",
  "reaction_runtime",
  "report_routes",
  "moderation_mutations",
  "dzn_assist_ai_runtime",
  "durable_objects",
  "websockets",
  "analytics_tracking",
  "store_payment_changes",
  "live_checkout",
  "production_mutations",
  "retained_exports",
  "issue_49_changes",
] as const;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MAX_SAFE_TEXT_LENGTH = 4_000;
const CHANNEL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const SAFE_MESSAGE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,120}$/;
const ROLE_LABELS = new Set(["Owner", "Mod", "VIP", "Member", "AI", "Website Support"]);

export type DznCommsMessageReadRuntime = "local" | "test";
export type DznCommsChannelType = "public" | "private_group";
export type DznCommsMessageVisibility =
  | "visible"
  | "locked"
  | "hidden"
  | "deleted"
  | "quarantined"
  | "expired"
  | "staff_only"
  | "unavailable";
export type DznCommsMessageKind = "user_message" | "system_notice" | "pinned_guidance" | "safety_notice";

export type DznCommsMessageReadEnv = Env & {
  DZN_COMMS_MESSAGE_READ_ENABLED?: string;
  DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME?: string;
  DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED?: string;
  DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED?: string;
};

export type DznCommsChannelRow = {
  id: string;
  channel_key: string;
  channel_type: DznCommsChannelType;
  label: string;
  scope: string;
  is_enabled: number;
};

export type DznCommsMessageRow = {
  id: string;
  channel_id: string;
  author_user_id: string | null;
  author_display_name: string | null;
  author_role_label: string | null;
  author_avatar_initials: string | null;
  author_profile_href: string | null;
  body: string | null;
  visibility: DznCommsMessageVisibility;
  message_kind: DznCommsMessageKind | null;
  reply_to_message_id: string | null;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
};

export type DznCommsMessageReadStorage = {
  readChannel(channelIdOrKey: string): Promise<DznCommsChannelRow | null>;
  hasActivePrivateMembership(channelId: string, userId: string, nowIso: string): Promise<boolean>;
  readVisibleMessages(input: DznCommsVisibleMessagesInput): Promise<DznCommsMessageRow[]>;
};

export type DznCommsVisibleMessagesInput = {
  channelId: string;
  nowIso: string;
  limitPlusOne: number;
  cursor: DznCommsMessageCursor | null;
  direction: DznCommsMessageReadDirection;
};

export type DznCommsMessageReadDirection = "older" | "newer";

export type DznCommsMessageCursor = {
  createdAt: string;
  messageId: string;
};

export type DznCommsMessageReadInput = {
  env: DznCommsMessageReadEnv;
  request: Request;
  channelId: unknown;
  storage?: DznCommsMessageReadStorage | null;
  sessionResolver?: (env: Env, request: Request) => Promise<SessionUser | null>;
  now?: Date;
};

export type DznCommsMessageReadResult = {
  status: 200 | 400 | 401 | 403 | 404 | 503;
  body: DznCommsMessageReadPayload | DznCommsMessageReadErrorPayload;
  headers: Headers;
};

export type DznCommsMessageReadPayload = {
  ok: true;
  status: "ok";
  private: true;
  cache: "no-store";
  route: typeof DZN_COMMS_MESSAGE_READ_ROUTE;
  schema_version: typeof DZN_COMMS_MESSAGE_READ_SCHEMA_VERSION;
  generated_at: string;
  channel: {
    id: string;
    type: DznCommsChannelType;
    label: string;
    scope: string;
    readOnly: true;
  };
  messages: DznCommsPublicMessage[];
  page: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    direction: DznCommsMessageReadDirection;
  };
  safety: DznCommsMessageReadSafety;
  unavailable_actions: typeof DZN_COMMS_MESSAGE_READ_UNAVAILABLE_ACTIONS;
};

export type DznCommsMessageReadErrorPayload = {
  ok: false;
  status: "disabled" | "error";
  private: true;
  cache: "no-store";
  route: typeof DZN_COMMS_MESSAGE_READ_ROUTE;
  schema_version: typeof DZN_COMMS_MESSAGE_READ_SCHEMA_VERSION;
  error: string;
  message: string;
  messages_available: false;
  safety: DznCommsMessageReadSafety;
  unavailable_actions: typeof DZN_COMMS_MESSAGE_READ_UNAVAILABLE_ACTIONS;
};

export type DznCommsPublicMessage = {
  id: string;
  visibility: Extract<DznCommsMessageVisibility, "visible" | "locked">;
  createdAt: string;
  author: {
    displayName: string;
    roleLabel: string | null;
    avatarInitials: string;
    profileHref: string | null;
  };
  body: string;
  replyToMessageId: string | null;
  presentation: {
    kind: DznCommsMessageKind;
  };
};

export type DznCommsMessageReadSafety = {
  read_only: true;
  local_test_only: true;
  authenticated_player_required: true;
  private_group_membership_required: true;
  public_safe_author_fields_only: true;
  no_hidden_body_exposure: true;
  no_read_receipts: true;
  no_last_read_persistence: true;
  no_message_sending: true;
  no_reaction_runtime: true;
  no_report_routes: true;
  no_moderation_mutations: true;
  no_dzn_assist_ai_runtime: true;
  no_durable_objects: true;
  no_websockets: true;
  no_analytics_tracking: true;
  no_store_payment_changes: true;
  no_live_checkout: true;
  no_production_mutations: true;
  no_retained_exports: true;
  issue_49_changed: false;
  billing_effect: false;
  owner_entitlement_effect: false;
  ranking_effect: false;
  discovery_effect: false;
  review_effect: false;
  badge_effect: false;
  season_effect: false;
  event_effect: false;
  server_wars_effect: false;
  ctf_effect: false;
  xp_award_effect: false;
  calling_card_award_effect: false;
  public_profile_visibility_effect: false;
  competitive_eligibility_effect: false;
};

type MessageReadAccess =
  | { ok: true; runtime: DznCommsMessageReadRuntime }
  | { ok: false; status: 404; code: string; message: string };

export class D1DznCommsMessageReadStorage implements DznCommsMessageReadStorage {
  constructor(private readonly db: D1Database) {}

  async readChannel(channelIdOrKey: string) {
    return await this.db
      .prepare(
        `SELECT id, channel_key, channel_type, label, scope, is_enabled
         FROM dzn_comms_channels
         WHERE is_enabled = 1
           AND (channel_key = ? OR id = ?)
         LIMIT 1`,
      )
      .bind(channelIdOrKey, channelIdOrKey)
      .first<DznCommsChannelRow>();
  }

  async hasActivePrivateMembership(channelId: string, userId: string, nowIso: string) {
    const row = await this.db
      .prepare(
        `SELECT id
         FROM dzn_comms_channel_memberships
         WHERE channel_id = ?
           AND user_id = ?
           AND membership_state = 'active'
           AND (expires_at IS NULL OR expires_at > ?)
         LIMIT 1`,
      )
      .bind(channelId, userId, nowIso)
      .first<{ id: string }>();
    return Boolean(row);
  }

  async readVisibleMessages(input: DznCommsVisibleMessagesInput) {
    const directionSql = input.direction === "newer" ? "ASC" : "DESC";
    const comparisonSql = input.direction === "newer" ? ">" : "<";
    const cursorWhere = input.cursor
      ? `AND (created_at ${comparisonSql} ? OR (created_at = ? AND id ${comparisonSql} ?))`
      : "";
    const bindings: unknown[] = [input.channelId, input.nowIso];
    if (input.cursor) bindings.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.messageId);
    bindings.push(input.limitPlusOne);

    return await this.db
      .prepare(
        `SELECT
           id,
           channel_id,
           author_user_id,
           author_display_name,
           author_role_label,
           author_avatar_initials,
           author_profile_href,
           body,
           visibility,
           message_kind,
           reply_to_message_id,
           created_at,
           updated_at,
           expires_at
         FROM dzn_comms_messages
         WHERE channel_id = ?
           AND visibility IN ('visible', 'locked')
           AND (expires_at IS NULL OR expires_at > ?)
           ${cursorWhere}
         ORDER BY created_at ${directionSql}, id ${directionSql}
         LIMIT ?`,
      )
      .bind(...bindings)
      .all<DznCommsMessageRow>()
      .then((result) => result.results ?? []);
  }
}

export async function readDznCommsChannelMessages(input: DznCommsMessageReadInput): Promise<DznCommsMessageReadResult> {
  const headers = dznCommsMessageReadHeaders();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const access = canUseDznCommsMessageReadRuntime(input.env);
  if (!access.ok) return errorResult(access.status, access.code, access.message, headers);

  const channelId = normalizeDznCommsChannelId(input.channelId);
  if (!channelId) {
    return errorResult(404, "DZN_COMMS_CHANNEL_NOT_FOUND", "DZN Comms channel is not available.", headers);
  }

  if (isDznCommsPublicChannelKey(channelId) && !isFlagEnabled(input.env.DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED)) {
    return errorResult(404, "DZN_COMMS_PUBLIC_CHANNEL_HISTORY_DISABLED", "DZN Comms public message history is disabled.", headers);
  }

  const cursor = parseCursorFromRequest(input.request);
  if (!cursor.ok) return errorResult(400, cursor.code, cursor.message, headers);

  const user = await (input.sessionResolver ?? getRequestSessionUser)(input.env, input.request);
  if (!user) {
    return errorResult(401, "DZN_COMMS_MESSAGE_READ_UNAUTHENTICATED", "Login with Discord before reading DZN Comms message history.", headers);
  }

  const storage = input.storage ?? (input.env.DB ? new D1DznCommsMessageReadStorage(input.env.DB) : null);
  if (!storage) {
    return errorResult(503, "DZN_COMMS_MESSAGE_READ_DB_UNAVAILABLE", "DZN Comms message history storage is not available.", headers);
  }

  let channel: DznCommsChannelRow | null = null;
  let rows: DznCommsMessageRow[] = [];
  const limit = parseMessageLimit(input.request);
  const direction = parseMessageDirection(input.request);

  try {
    channel = await storage.readChannel(channelId);
    if (!channel || channel.is_enabled !== 1) {
      return errorResult(404, "DZN_COMMS_CHANNEL_NOT_FOUND", "DZN Comms channel is not available.", headers);
    }

    if (channel.channel_type === "public") {
      if (!isDznCommsPublicChannelKey(channel.channel_key)) {
        return errorResult(404, "DZN_COMMS_CHANNEL_NOT_FOUND", "DZN Comms channel is not available.", headers);
      }
      if (!isFlagEnabled(input.env.DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED)) {
        return errorResult(404, "DZN_COMMS_PUBLIC_CHANNEL_HISTORY_DISABLED", "DZN Comms public message history is disabled.", headers);
      }
    } else if (channel.channel_type === "private_group") {
      if (!isFlagEnabled(input.env.DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED)) {
        return errorResult(404, "DZN_COMMS_PRIVATE_GROUP_HISTORY_DISABLED", "DZN Comms private group message history is disabled.", headers);
      }
      const member = await storage.hasActivePrivateMembership(channel.id, user.id, nowIso);
      if (!member) {
        return errorResult(403, "DZN_COMMS_PRIVATE_GROUP_FORBIDDEN", "DZN Comms channel is not available.", headers);
      }
    } else {
      return errorResult(404, "DZN_COMMS_CHANNEL_NOT_FOUND", "DZN Comms channel is not available.", headers);
    }

    rows = await storage.readVisibleMessages({
      channelId: channel.id,
      nowIso,
      limitPlusOne: limit + 1,
      cursor: cursor.value,
      direction,
    });
  } catch {
    return errorResult(503, "DZN_COMMS_MESSAGE_READ_UNAVAILABLE", "DZN Comms message history is unavailable.", headers);
  }
  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows.at(-1) ?? null;

  return {
    status: 200,
    headers,
    body: {
      ok: true,
      status: "ok",
      private: true,
      cache: "no-store",
      route: DZN_COMMS_MESSAGE_READ_ROUTE,
      schema_version: DZN_COMMS_MESSAGE_READ_SCHEMA_VERSION,
      generated_at: nowIso,
      channel: {
        id: publicChannelId(channel),
        type: channel.channel_type,
        label: safeText(channel.label, "DZN Comms", 80),
        scope: channel.channel_type === "public" ? "dzn-public" : "dzn-private-group",
        readOnly: true,
      },
      messages: pageRows.map(toPublicMessage),
      page: {
        nextCursor: rows.length > limit && lastRow ? encodeMessageCursor(lastRow) : null,
        hasMore: rows.length > limit,
        limit,
        direction,
      },
      safety: dznCommsMessageReadSafety(),
      unavailable_actions: DZN_COMMS_MESSAGE_READ_UNAVAILABLE_ACTIONS,
    },
  };
}

export function canUseDznCommsMessageReadRuntime(env: DznCommsMessageReadEnv): MessageReadAccess {
  if (!isFlagEnabled(env.DZN_COMMS_MESSAGE_READ_ENABLED)) {
    return {
      ok: false,
      status: 404,
      code: "DZN_COMMS_MESSAGE_READ_DISABLED",
      message: "DZN Comms message history is disabled.",
    };
  }

  const runtime = normalizeLocalTestRuntime(env.DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME);
  if (!runtime) {
    return {
      ok: false,
      status: 404,
      code: "DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME_REQUIRED",
      message: "DZN Comms message history requires the local/test runtime flag.",
    };
  }

  return { ok: true, runtime };
}

export function dznCommsMessageReadHeaders(headers?: HeadersInit) {
  const next = privateNoStoreHeaders(headers);
  next.set("x-dzn-comms-message-read-contract", "read-only-local-test");
  next.set("x-dzn-comms-message-read-schema", DZN_COMMS_MESSAGE_READ_SCHEMA_VERSION);
  return next;
}

export function dznCommsMessageReadSafety(): DznCommsMessageReadSafety {
  return {
    read_only: true,
    local_test_only: true,
    authenticated_player_required: true,
    private_group_membership_required: true,
    public_safe_author_fields_only: true,
    no_hidden_body_exposure: true,
    no_read_receipts: true,
    no_last_read_persistence: true,
    no_message_sending: true,
    no_reaction_runtime: true,
    no_report_routes: true,
    no_moderation_mutations: true,
    no_dzn_assist_ai_runtime: true,
    no_durable_objects: true,
    no_websockets: true,
    no_analytics_tracking: true,
    no_store_payment_changes: true,
    no_live_checkout: true,
    no_production_mutations: true,
    no_retained_exports: true,
    issue_49_changed: false,
    billing_effect: false,
    owner_entitlement_effect: false,
    ranking_effect: false,
    discovery_effect: false,
    review_effect: false,
    badge_effect: false,
    season_effect: false,
    event_effect: false,
    server_wars_effect: false,
    ctf_effect: false,
    xp_award_effect: false,
    calling_card_award_effect: false,
    public_profile_visibility_effect: false,
    competitive_eligibility_effect: false,
  };
}

export function normalizeDznCommsChannelId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  return CHANNEL_ID_PATTERN.test(normalized) ? normalized : null;
}

export function isDznCommsPublicChannelKey(value: string): value is (typeof DZN_COMMS_PUBLIC_CHANNEL_KEYS)[number] {
  return (DZN_COMMS_PUBLIC_CHANNEL_KEYS as readonly string[]).includes(value);
}

function parseMessageLimit(request: Request) {
  const url = new URL(request.url);
  const parsed = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(parsed), MAX_LIMIT));
}

function parseMessageDirection(request: Request): DznCommsMessageReadDirection {
  const value = new URL(request.url).searchParams.get("direction")?.trim().toLowerCase();
  return value === "newer" ? "newer" : "older";
}

function parseCursorFromRequest(request: Request):
  | { ok: true; value: DznCommsMessageCursor | null }
  | { ok: false; code: string; message: string } {
  const raw = new URL(request.url).searchParams.get("cursor");
  if (!raw) return { ok: true, value: null };
  const decoded = decodeMessageCursor(raw);
  if (!decoded) {
    return {
      ok: false,
      code: "DZN_COMMS_INVALID_CURSOR",
      message: "DZN Comms message-history cursor is invalid.",
    };
  }
  return { ok: true, value: decoded };
}

function toPublicMessage(row: DznCommsMessageRow): DznCommsPublicMessage {
  const displayName = safeText(row.author_display_name, "DZN Player", 80);
  return {
    id: safeMessageId(row.id),
    visibility: row.visibility === "locked" ? "locked" : "visible",
    createdAt: safeIso(row.created_at),
    author: {
      displayName,
      roleLabel: safeRoleLabel(row.author_role_label),
      avatarInitials: safeInitials(row.author_avatar_initials, displayName),
      profileHref: null,
    },
    body: safeText(row.body, "", MAX_SAFE_TEXT_LENGTH),
    replyToMessageId: safeOptionalMessageId(row.reply_to_message_id),
    presentation: {
      kind: safeMessageKind(row.message_kind),
    },
  };
}

function publicChannelId(channel: DznCommsChannelRow) {
  return channel.channel_type === "public" ? channel.channel_key : channel.channel_key;
}

function errorResult(
  status: DznCommsMessageReadResult["status"],
  error: string,
  message: string,
  headers: Headers,
): DznCommsMessageReadResult {
  return {
    status,
    headers,
    body: {
      ok: false,
      status: status === 404 && error.includes("DISABLED") ? "disabled" : "error",
      private: true,
      cache: "no-store",
      route: DZN_COMMS_MESSAGE_READ_ROUTE,
      schema_version: DZN_COMMS_MESSAGE_READ_SCHEMA_VERSION,
      error,
      message,
      messages_available: false,
      safety: dznCommsMessageReadSafety(),
      unavailable_actions: DZN_COMMS_MESSAGE_READ_UNAVAILABLE_ACTIONS,
    },
  };
}

function normalizeLocalTestRuntime(value: string | undefined): DznCommsMessageReadRuntime | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "local" || normalized === "test" ? normalized : null;
}

function isFlagEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function safeText(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  const source = text || fallback;
  return source.length > maxLength ? source.slice(0, maxLength) : source;
}

function safeRoleLabel(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return ROLE_LABELS.has(trimmed) ? trimmed : null;
}

function safeInitials(value: unknown, displayName: string) {
  const explicit = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (/^[A-Z0-9]{1,3}$/.test(explicit)) return explicit;
  const computed = displayName
    .split(/\s|_/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return computed || "D";
}

function safeMessageId(value: unknown) {
  if (typeof value === "string" && SAFE_MESSAGE_ID_PATTERN.test(value)) return value;
  return "msg_unavailable";
}

function safeOptionalMessageId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return safeMessageId(value);
}

function safeMessageKind(value: unknown): DznCommsMessageKind {
  if (value === "system_notice" || value === "pinned_guidance" || value === "safety_notice") return value;
  return "user_message";
}

function safeIso(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}

function encodeMessageCursor(row: DznCommsMessageRow) {
  const payload = JSON.stringify({ v: 1, t: safeIso(row.created_at), id: safeMessageId(row.id) });
  return base64UrlEncode(payload);
}

function decodeMessageCursor(value: string): DznCommsMessageCursor | null {
  if (!/^[A-Za-z0-9_-]{8,512}$/.test(value)) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(value)) as Partial<{ v: number; t: string; id: string }>;
    if (parsed.v !== 1 || typeof parsed.t !== "string" || typeof parsed.id !== "string") return null;
    if (!Number.isFinite(Date.parse(parsed.t)) || !SAFE_MESSAGE_ID_PATTERN.test(parsed.id)) return null;
    return { createdAt: new Date(Date.parse(parsed.t)).toISOString(), messageId: parsed.id };
  } catch {
    return null;
  }
}

function base64UrlEncode(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}
