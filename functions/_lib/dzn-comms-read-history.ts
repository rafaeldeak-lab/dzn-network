import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed } from "./http";
import { noStoreForErrorHeaders, privateNoStoreHeaders } from "./performance";
import type { Env, SessionUser } from "./types";

type DznCommsChannelRow = {
  id: string;
  slug: string;
  kind: "public" | "private_group" | "support" | null;
  name: string | null;
  description: string | null;
  visibility: "public" | "private_group" | "support_private" | null;
  is_readable: number | null;
};

type DznCommsMembershipRow = {
  role: "owner" | "moderator" | "member" | null;
};

type DznCommsMessageRow = {
  id: string;
  author_display_name: string | null;
  author_role_label: string | null;
  body: string | null;
  visibility_state: "visible" | "hidden" | "deleted" | "quarantined" | "expired" | null;
  created_at: string | null;
  edited_at: string | null;
  expires_at: string | null;
};

type DznCommsReadableChannel = {
  id: string;
  slug: string;
  kind: "public" | "private_group" | "support";
  name: string;
  description: string | null;
  visibility: "public" | "private_group" | "support_private";
};

export type DznCommsReadHistoryFlags = {
  enabled: boolean;
  readFlag: boolean;
  localTestScope: boolean;
  scope: string;
  uiFlagName: "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED";
  writeFeaturesEnabled: false;
  aiRuntimeEnabled: false;
};

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const FLAG_DISABLED_STATUS = 404;
const hiddenBody = "Message hidden by DZN Safety.";
const deletedBody = "Message deleted.";
const quarantinedBody = "Message unavailable while DZN Safety reviews it.";
const expiredBody = "Message expired.";

export async function handleDznCommsMessageHistoryRequest(request: Request, env: Env) {
  if (request.method !== "GET") return methodNotAllowed();

  const flags = readDznCommsReadHistoryFlags(env);
  if (!flags.enabled) {
    return json(
      {
        ok: false,
        code: "DZN_COMMS_MESSAGE_HISTORY_DISABLED",
        message: "DZN Comms message history is not enabled for this environment.",
        flags,
      },
      { status: FLAG_DISABLED_STATUS, headers: noStoreForErrorHeaders() },
    );
  }

  const url = new URL(request.url);
  const channelSlug = sanitizeChannelSlug(url.searchParams.get("channel") ?? "global-chat");
  if (!channelSlug) {
    return json(
      { ok: false, code: "INVALID_CHANNEL", message: "Choose a valid DZN Comms channel." },
      { status: 400, headers: noStoreForErrorHeaders() },
    );
  }

  const limit = boundedLimit(url.searchParams.get("limit"));
  const before = sanitizeBefore(url.searchParams.get("before"));
  if (url.searchParams.has("before") && !before) {
    return json(
      { ok: false, code: "INVALID_CURSOR", message: "The before cursor must be an ISO timestamp." },
      { status: 400, headers: noStoreForErrorHeaders() },
    );
  }

  const db = requireDb(env);
  const channel = await readChannel(db, channelSlug);
  if (!channel) {
    return json(
      { ok: false, code: "CHANNEL_NOT_FOUND", message: "That DZN Comms channel is not available." },
      { status: 404, headers: noStoreForErrorHeaders() },
    );
  }

  const user = channel.visibility === "public" ? null : await getSessionUser(env, request);
  if (channel.visibility !== "public" && !user) {
    return json(
      { ok: false, code: "UNAUTHORIZED", message: "Log in with Discord to read this DZN Comms group." },
      { status: 401, headers: privateNoStoreHeaders() },
    );
  }

  const membership = user ? await readMembership(db, channel.id, user.id) : null;
  if (channel.visibility === "private_group" && !membership) {
    return json(
      { ok: false, code: "FORBIDDEN", message: "This private DZN Comms group is not available to your account." },
      { status: 403, headers: privateNoStoreHeaders() },
    );
  }

  if (channel.visibility === "support_private") {
    return json(
      { ok: false, code: "SUPPORT_HISTORY_BLOCKED", message: "Private support history is not exposed in this read-history foundation." },
      { status: 403, headers: privateNoStoreHeaders() },
    );
  }

  const rows = await readMessages(db, channel.id, limit, before);
  const messages = rows
    .filter((row) => !isExpired(row.expires_at) && normalizeVisibilityState(row.visibility_state) !== "expired")
    .map((row) => publicSafeMessage(row))
    .reverse();

  return json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      read_only: true,
      presentation_only: true,
      channel: {
        slug: channel.slug,
        kind: channel.kind,
        name: channel.name,
        description: channel.description,
        visibility: channel.visibility,
      },
      access: {
        public_channel: channel.visibility === "public",
        private_group_membership_required: channel.visibility === "private_group",
        current_user_member_role: membership?.role ?? null,
      },
      messages,
      feature_flags: {
        route_enabled: flags.enabled,
        ui_flag_name: flags.uiFlagName,
        sending_enabled: false,
        reactions_enabled: false,
        report_actions_enabled: false,
        moderation_mutations_enabled: false,
        ai_assist_runtime_enabled: false,
        durable_objects_or_websockets_enabled: false,
        analytics_or_tracking_enabled: false,
      },
      fairness_boundary: dznCommsReadHistoryBoundary(),
    },
    { headers: privateNoStoreHeaders() },
  );
}

export function readDznCommsReadHistoryFlags(env: Env): DznCommsReadHistoryFlags {
  const readFlag = parseBooleanFlag(env.DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED);
  const scope = cleanString(env.DZN_COMMS_MESSAGE_HISTORY_READ_SCOPE).toLowerCase();
  const localTestScope = scope === "local_test";

  return {
    enabled: readFlag && localTestScope,
    readFlag,
    localTestScope,
    scope,
    uiFlagName: "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED",
    writeFeaturesEnabled: false,
    aiRuntimeEnabled: false,
  };
}

export function dznCommsReadHistoryBoundary() {
  return [
    "DZN Comms read history is disabled by default and local/test-scoped.",
    "The route is GET-only and cannot send chat messages, add reactions, report messages, moderate messages, or call AI support.",
    "Read history does not write analytics, tracking events, billing data, owner entitlements, server ownership, ranking data, discovery formulas, reviews, events, XP, calling-card awards, Server Wars, CTF, retained exports, or competitive eligibility.",
    "Private group history requires current-user membership before any rows are returned.",
  ];
}

async function readChannel(db: D1Database, slug: string): Promise<DznCommsReadableChannel | null> {
  const row = await db
    .prepare(
      `SELECT id, slug, kind, name, description, visibility, is_readable
       FROM dzn_comms_channels
       WHERE slug = ? AND is_readable = 1
       LIMIT 1`,
    )
    .bind(slug)
    .first<DznCommsChannelRow>();

  if (!row) return null;
  const kind = normalizeChannelKind(row.kind);
  const visibility = normalizeChannelVisibility(row.visibility);
  if (!kind || !visibility || !row.id || !row.slug || !row.name) return null;

  return {
    id: row.id,
    slug: row.slug,
    kind,
    name: cleanText(row.name, 80) || "DZN Comms",
    description: cleanNullableText(row.description, 180),
    visibility,
  };
}

async function readMembership(db: D1Database, channelId: string, userId: SessionUser["id"]): Promise<DznCommsMembershipRow | null> {
  return db
    .prepare(
      `SELECT role
       FROM dzn_comms_private_group_members
       WHERE channel_id = ? AND user_id = ? AND membership_state = 'active'
       LIMIT 1`,
    )
    .bind(channelId, userId)
    .first<DznCommsMembershipRow>();
}

async function readMessages(db: D1Database, channelId: string, limit: number, before: string | null): Promise<DznCommsMessageRow[]> {
  const result = await db
    .prepare(
      `SELECT id, author_display_name, author_role_label, body, visibility_state, created_at, edited_at, expires_at
       FROM dzn_comms_messages
       WHERE channel_id = ?
         AND (? IS NULL OR created_at < ?)
         AND (expires_at IS NULL OR expires_at = '' OR expires_at > datetime('now'))
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`,
    )
    .bind(channelId, before, before, limit)
    .all<DznCommsMessageRow>();

  return result.results ?? [];
}

function publicSafeMessage(row: DznCommsMessageRow) {
  const visibilityState = normalizeVisibilityState(row.visibility_state);
  const visible = visibilityState === "visible";

  return {
    id: cleanText(row.id, 120),
    author_display_name: visible ? cleanText(row.author_display_name, 60) || "DZN Player" : "DZN Safety",
    author_role_label: visible ? cleanText(row.author_role_label, 24) || "Member" : "System",
    body: visible ? cleanText(row.body, 2000) : placeholderForState(visibilityState),
    visibility_state: visibilityState,
    created_at: cleanNullableText(row.created_at, 40),
    edited_at: cleanNullableText(row.edited_at, 40),
    public_safe: true,
    read_only: true,
  };
}

function placeholderForState(state: DznCommsMessageRow["visibility_state"]) {
  if (state === "deleted") return deletedBody;
  if (state === "quarantined") return quarantinedBody;
  if (state === "expired") return expiredBody;
  return hiddenBody;
}

function sanitizeChannelSlug(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(trimmed)) return "";
  return trimmed;
}

function boundedLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function sanitizeBefore(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length > 40) return null;
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function normalizeChannelKind(value: DznCommsChannelRow["kind"]) {
  if (value === "public" || value === "private_group" || value === "support") return value;
  return null;
}

function normalizeChannelVisibility(value: DznCommsChannelRow["visibility"]) {
  if (value === "public" || value === "private_group" || value === "support_private") return value;
  return null;
}

function normalizeVisibilityState(value: DznCommsMessageRow["visibility_state"]) {
  if (value === "visible" || value === "hidden" || value === "deleted" || value === "quarantined" || value === "expired") return value;
  return "hidden";
}

function cleanNullableText(value: unknown, maxLength: number) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const normalized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, maxLength);
}

function isExpired(value: string | null) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function parseBooleanFlag(value: unknown) {
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
