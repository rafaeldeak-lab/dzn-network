import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed } from "./http";
import { noStoreForErrorHeaders, privateNoStoreHeaders } from "./performance";
import { readDznCommsReactionFlags, readDznCommsReactionSummaries } from "./dzn-comms-reactions";
import { readDznCommsPrivateGroupFlags } from "./dzn-comms-live";
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

type DznCommsAvailableChannelRow = {
  slug: string | null;
  kind: "private_group" | null;
  name: string | null;
  description: string | null;
  visibility: "private_group" | null;
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

type DznCommsReactionSummary = {
  revision: string;
  available_reactions: readonly { key: string; emoji: string; label: string }[];
  counts: { key: string; emoji: string; label: string; count: number; current_user_reacted: boolean }[];
};

type DznCommsHistoryCursor = {
  createdAt: string;
  messageId: string;
};

export type DznCommsReadHistoryFlags = {
  enabled: boolean;
  readFlag: boolean;
  localTestScope: boolean;
  scope: string;
  uiFlagName: "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED";
  writeFeaturesEnabled: boolean;
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

  const flags = readDznCommsReadHistoryFlags(env, request);
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
  const cursor = decodeHistoryCursor(url.searchParams.get("cursor"));
  if (url.searchParams.has("cursor") && !cursor) {
    return json(
      { ok: false, code: "INVALID_CURSOR", message: "The message-history cursor is invalid." },
      { status: 400, headers: noStoreForErrorHeaders() },
    );
  }
  if (before && cursor) {
    return json(
      { ok: false, code: "AMBIGUOUS_CURSOR", message: "Use either before or cursor, not both." },
      { status: 400, headers: noStoreForErrorHeaders() },
    );
  }

  const db = requireDb(env);
  const user = await getSessionUser(env, request);
  const privateGroupFlags = readDznCommsPrivateGroupFlags(env, request);
  let channel: DznCommsReadableChannel | null;
  let membership: DznCommsMembershipRow | null = null;
  if (channelSlug === "global-chat") {
    channel = await readChannel(db, channelSlug);
  } else {
    if (!user || !privateGroupFlags.enabled) return unavailableChannel();
    const authorized = await readPrivateChannelForMember(db, channelSlug, user.id);
    if (!authorized) return unavailableChannel();
    channel = authorized.channel;
    membership = authorized.membership;
  }
  if (!channel || channel.visibility === "support_private") return unavailableChannel();


  const rows = await readMessages(
    db,
    channel.id,
    limit + 1,
    cursor,
    before,
    channel.visibility === "private_group" ? user!.id : null,
  );
  const availableChannels = await readAvailableChannels(db, user, privateGroupFlags.enabled);
  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows.at(-1) ?? null;
  const nextCursor = rows.length > limit && lastRow ? encodeHistoryCursor(lastRow) : null;
  const reactionFlags = readDznCommsReactionFlags(env, request);
  const reactionSummaries = reactionFlags.readEnabled
    ? await readDznCommsReactionSummaries(db, pageRows.map((row) => row.id), user?.id ?? null)
    : new Map<string, DznCommsReactionSummary>();
  const messages = pageRows
    .filter((row) => !isExpired(row.expires_at) && normalizeVisibilityState(row.visibility_state) !== "expired")
    .map((row) => publicSafeMessage(row, reactionSummaries.get(row.id)))
    .reverse();
  const finalMembership = channel.visibility === "private_group"
    ? await readMembership(db, channel.id, user!.id)
    : membership;
  if (channel.visibility === "private_group" && !finalMembership) return unavailableChannel();

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
        current_user_member_role: finalMembership?.role ?? null,
      },
      available_channels: availableChannels,
      messages,
      page: {
        next_cursor: nextCursor,
        has_more: nextCursor !== null,
        limit,
      },
      feature_flags: {
        route_enabled: flags.enabled,
        ui_flag_name: flags.uiFlagName,
        sending_enabled: channel.visibility === "private_group" ? privateGroupFlags.enabled : flags.writeFeaturesEnabled,
        private_groups_enabled: privateGroupFlags.enabled,
        reactions_enabled: reactionFlags.readEnabled,
        reactions_write_enabled: reactionFlags.writeEnabled,
        report_actions_enabled: channel.visibility === "private_group" ? privateGroupFlags.enabled : flags.writeFeaturesEnabled,
        moderation_mutations_enabled: channel.visibility === "private_group" ? privateGroupFlags.enabled : flags.writeFeaturesEnabled,
        ai_assist_runtime_enabled: false,
        durable_objects_or_websockets_enabled: false,
        analytics_or_tracking_enabled: false,
      },
      fairness_boundary: dznCommsReadHistoryBoundary(),
    },
    { headers: privateNoStoreHeaders() },
  );
}

function unavailableChannel() {
  return json(
    { ok: false, code: "CHANNEL_NOT_FOUND", message: "That DZN Comms channel is not available." },
    { status: 404, headers: privateNoStoreHeaders() },
  );
}

export function readDznCommsReadHistoryFlags(env: Env, request?: Request): DznCommsReadHistoryFlags {
  const readFlag = parseBooleanFlag(env.DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED);
  const scope = cleanString(env.DZN_COMMS_MESSAGE_HISTORY_READ_SCOPE).toLowerCase();
  const localTestScope = scope === "local_test";
  const liveScope = cleanString(env.DZN_COMMS_LIVE_SCOPE).toLowerCase();
  const sessionSecretReady = typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.length >= 32;
  const ledgerSecretReady = typeof env.DZN_COMMS_LEDGER_SECRET === "string" && env.DZN_COMMS_LEDGER_SECRET.length >= 32;
  const secretReady = sessionSecretReady && ledgerSecretReady;
  const localRequest = request ? isLocalRequest(request) : false;
  const liveEnabled = parseBooleanFlag(env.DZN_COMMS_LIVE_ENABLED) && secretReady && (liveScope === "production" || (liveScope === "local_test" && localRequest));

  return {
    enabled: (readFlag && localTestScope) || liveEnabled,
    readFlag,
    localTestScope,
    scope,
    uiFlagName: "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED",
    writeFeaturesEnabled: liveEnabled,
    aiRuntimeEnabled: false,
  };
}

function isLocalRequest(request: Request) {
  try {
    const host = new URL(request.url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

export function dznCommsReadHistoryBoundary() {
  return [
    "DZN Comms stays disabled by default and requires explicit server and UI release flags.",
    "Authenticated sending, reporting, reactions and platform-owner moderation use separate same-origin routes and separate flags; AI support remains disabled.",
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
  const expectedVisibility = kind === "support" ? "support_private" : kind;
  if (visibility !== expectedVisibility) return null;

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

async function readPrivateChannelForMember(db: D1Database, slug: string, userId: SessionUser["id"]): Promise<{
  channel: DznCommsReadableChannel;
  membership: DznCommsMembershipRow;
} | null> {
  const row = await db.prepare(
    `SELECT c.id, c.slug, c.kind, c.name, c.description, c.visibility, c.is_readable, m.role
     FROM dzn_comms_channels AS c
     JOIN dzn_comms_private_group_members AS m ON m.channel_id = c.id
     WHERE c.slug = ?
       AND c.kind = 'private_group'
       AND c.visibility = 'private_group'
       AND c.is_readable = 1
       AND m.user_id = ?
       AND m.membership_state = 'active'
     LIMIT 1`,
  ).bind(slug, userId).first<DznCommsChannelRow & DznCommsMembershipRow>();
  if (!row || !row.id || !row.slug || !row.name || row.kind !== "private_group" || row.visibility !== "private_group") return null;
  const role = normalizeMemberRole(row.role);
  if (!role) return null;
  return {
    channel: {
      id: row.id,
      slug: row.slug,
      kind: "private_group",
      name: cleanText(row.name, 80) || "DZN Comms",
      description: cleanNullableText(row.description, 180),
      visibility: "private_group",
    },
    membership: { role },
  };
}

async function readAvailableChannels(db: D1Database, user: SessionUser | null, privateGroupsEnabled: boolean) {
  const globalChannel = await readChannel(db, "global-chat");
  const channels: Array<{
    slug: string;
    kind: "public" | "private_group";
    name: string;
    description: string | null;
    visibility: "public" | "private_group";
    current_user_member_role: "owner" | "moderator" | "member" | null;
  }> = [];

  if (globalChannel?.kind === "public" && globalChannel.visibility === "public") {
    channels.push({
      slug: globalChannel.slug,
      kind: "public",
      name: globalChannel.name,
      description: globalChannel.description,
      visibility: "public",
      current_user_member_role: null,
    });
  }

  if (!user || !privateGroupsEnabled) return channels;
  const result = await db.prepare(
    `SELECT c.slug, c.kind, c.name, c.description, c.visibility, m.role
     FROM dzn_comms_private_group_members m
     JOIN dzn_comms_channels c ON c.id = m.channel_id
     WHERE m.user_id = ?
       AND m.membership_state = 'active'
       AND c.kind = 'private_group'
       AND c.visibility = 'private_group'
       AND c.is_readable = 1
     ORDER BY lower(c.name), c.slug
     LIMIT 20`,
  ).bind(user.id).all<DznCommsAvailableChannelRow>();

  for (const row of result.results ?? []) {
    const role = normalizeMemberRole(row.role);
    const slug = sanitizeChannelSlug(row.slug ?? "");
    const name = cleanText(row.name, 80);
    if (!role || !slug || !name || row.kind !== "private_group" || row.visibility !== "private_group") continue;
    channels.push({
      slug,
      kind: "private_group",
      name,
      description: cleanNullableText(row.description, 180),
      visibility: "private_group",
      current_user_member_role: role,
    });
  }

  return channels;
}

async function readMessages(
  db: D1Database,
  channelId: string,
  limit: number,
  cursor: DznCommsHistoryCursor | null,
  before: string | null,
  privateUserId: string | null,
): Promise<DznCommsMessageRow[]> {
  const result = await db
    .prepare(
      `SELECT id, author_display_name, author_role_label, body, visibility_state, created_at, edited_at, expires_at
       FROM dzn_comms_messages AS messages
       WHERE messages.channel_id = ?
         AND julianday(created_at) IS NOT NULL
         AND id IS NOT NULL AND length(id) BETWEEN 1 AND 120
         AND (? IS NULL OR julianday(created_at) < julianday(?) OR (julianday(created_at) = julianday(?) AND id < ?))
         AND (? IS NULL OR julianday(created_at) < julianday(?))
         AND visibility_state != 'expired'
         AND (expires_at IS NULL OR expires_at = '' OR julianday(expires_at) > julianday('now'))
         AND (? IS NULL OR EXISTS (
           SELECT 1
           FROM dzn_comms_private_group_members AS membership
           WHERE membership.channel_id = messages.channel_id
             AND membership.user_id = ?
             AND membership.membership_state = 'active'
         ))
       ORDER BY julianday(created_at) DESC, id DESC
       LIMIT ?`,
    )
    .bind(
      channelId,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.messageId ?? null,
      before,
      before,
      privateUserId,
      privateUserId,
      limit,
    )
    .all<DznCommsMessageRow>();

  return result.results ?? [];
}

function publicSafeMessage(row: DznCommsMessageRow, reactions?: DznCommsReactionSummary) {
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
    ...(visible && reactions ? { reactions } : {}),
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

function encodeHistoryCursor(row: DznCommsMessageRow) {
  const createdAt = canonicalTimestamp(row.created_at);
  const messageId = sanitizeCursorMessageId(row.id);
  if (!createdAt || !messageId) return null;
  return base64UrlEncode(JSON.stringify({ v: 1, t: createdAt, id: messageId }));
}

function decodeHistoryCursor(value: string | null): DznCommsHistoryCursor | null {
  if (!value || !/^[A-Za-z0-9_-]{8,1024}$/.test(value)) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(value)) as Partial<{ v: number; t: string; id: string }>;
    const createdAt = parsed.v === 1 ? canonicalTimestamp(parsed.t) : null;
    const messageId = sanitizeCursorMessageId(parsed.id);
    return createdAt && messageId ? { createdAt, messageId } : null;
  } catch {
    return null;
  }
}

function canonicalTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function sanitizeCursorMessageId(value: unknown) {
  return typeof value === "string" && [...value].length >= 1 && [...value].length <= 120 ? value : null;
}

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function normalizeChannelKind(value: DznCommsChannelRow["kind"]) {
  if (value === "public" || value === "private_group" || value === "support") return value;
  return null;
}

function normalizeChannelVisibility(value: DznCommsChannelRow["visibility"]) {
  if (value === "public" || value === "private_group" || value === "support_private") return value;
  return null;
}

function normalizeMemberRole(value: DznCommsMembershipRow["role"]) {
  if (value === "owner" || value === "moderator" || value === "member") return value;
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
  return [...normalized].slice(0, maxLength).join("");
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
