import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import { privateNoStoreHeaders } from "./performance";
import { requirePlatformOwner } from "./platform-owner";
import type { Env, SessionUser } from "./types";

const MAX_REQUEST_BYTES = 12_288;
const MAX_BODY_CODE_POINTS = 2_000;
const MAX_BODY_BYTES = 8_000;
const SENDS_PER_MINUTE = 20;
const ATTEMPTS_PER_MINUTE = 30;
const REPORTS_PER_MINUTE = 10;
const MESSAGE_RETENTION_DAYS = 30;
const RATE_SLOT_RETENTION_DAYS = 2;
const reportReasons = new Set(["harassment", "hate", "threat", "spam", "personal_information", "other"]);
const moderationActions = new Set(["hide", "restore", "delete", "resolve_report", "dismiss_report"]);

type SendInput = { channelSlug?: unknown; clientRequestId?: unknown; body?: unknown };
type ReportInput = { messageId?: unknown; reason?: unknown };
type ModerateInput = { messageId?: unknown; action?: unknown; reason?: unknown };
type SendChannel = {
  id: string;
  kind: "public" | "private_group";
  visibility: "public" | "private_group";
};

export function readDznCommsLiveFlags(env: Env, request?: Request) {
  const enabled = booleanFlag(env.DZN_COMMS_LIVE_ENABLED);
  const scope = clean(env.DZN_COMMS_LIVE_SCOPE, 32).toLowerCase();
  const sessionSecretReady = typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.length >= 32;
  const ledgerSecretReady = typeof env.DZN_COMMS_LEDGER_SECRET === "string" && env.DZN_COMMS_LEDGER_SECRET.length >= 32;
  const secretReady = sessionSecretReady && ledgerSecretReady;
  const localRequest = request ? isLocalRequest(request) : false;
  return { enabled: enabled && secretReady && (scope === "production" || (scope === "local_test" && localRequest)), scope, secretReady, localRequest };
}

export function readDznCommsOwnerModerationFlags(env: Env, request?: Request) {
  return readScopedFlag(env.DZN_COMMS_OWNER_MODERATION_ENABLED, env.DZN_COMMS_OWNER_MODERATION_SCOPE, request);
}

export function readDznCommsRetentionFlags(env: Env, request?: Request) {
  return readScopedFlag(env.DZN_COMMS_RETENTION_ENABLED, env.DZN_COMMS_RETENTION_SCOPE, request);
}

export function readDznCommsOwnerArchiveFlags(env: Env, request?: Request) {
  const archive = readScopedFlag(env.DZN_COMMS_OWNER_ARCHIVE_ENABLED, env.DZN_COMMS_OWNER_ARCHIVE_SCOPE, request);
  const retention = readDznCommsRetentionFlags(env, request);
  return { ...archive, enabled: archive.enabled && retention.enabled, retentionReady: retention.enabled };
}

export function readDznCommsPrivateGroupFlags(env: Env, request?: Request) {
  const live = readDznCommsLiveFlags(env, request);
  return { ...live, enabled: live.enabled && booleanFlag(env.DZN_COMMS_PRIVATE_GROUPS_ENABLED) };
}

export function moderateDznCommsBody(value: unknown) {
  if (typeof value !== "string") return { decision: "block" as const, code: "INVALID_MESSAGE", body: "" };
  const body = value.normalize("NFKC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  const codePoints = [...body].length;
  const bytes = new TextEncoder().encode(body).byteLength;
  if (!body || codePoints > MAX_BODY_CODE_POINTS || bytes > MAX_BODY_BYTES) {
    return { decision: "block" as const, code: "INVALID_MESSAGE", body: "" };
  }
  const compact = body.toLowerCase().replace(/[^a-z0-9@.:/]+/g, " ");
  if (/mfa\.[a-z0-9_-]{20,}|[a-z0-9_-]{24,}\.[a-z0-9_-]{6}\.[a-z0-9_-]{20,}/i.test(body)) {
    return { decision: "block" as const, code: "SECRET_DETECTED", body: "" };
  }
  if (/(?:discord\.gg|discord(?:app)?\.com\/invite)\//i.test(body) || /(.)\1{14,}/u.test(body)) {
    return { decision: "block" as const, code: "SPAM_BLOCKED", body: "" };
  }
  if (/\b(?:kill yourself|kys|doxx?|swat(?:ting)?|rape threat)\b/i.test(compact)) {
    return { decision: "timeout" as const, code: "SAFETY_TIMEOUT", body: "" };
  }
  return { decision: "allow" as const, code: "MESSAGE_ALLOWED", body };
}

export async function handleDznCommsSend(request: Request, env: Env) {
  if (request.method !== "POST") return methodNotAllowed();
  if (!readDznCommsLiveFlags(env, request).enabled) return unavailable();
  if (!sameOrigin(request)) return error(403, "CROSS_ORIGIN", "Cross-origin chat requests are not allowed.");
  const user = await getSessionUser(env, request);
  if (!user) return error(401, "UNAUTHORIZED", "Log in with Discord to join DZN Comms.");
  const parsed = await readBoundedJson<SendInput>(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return error(parsed.status, parsed.error, parsed.message);
  if (!exactKeys(parsed.value, ["channelSlug", "clientRequestId", "body"])) return error(400, "INVALID_REQUEST", "Chat request fields are invalid.");
  const channelSlug = clean(parsed.value.channelSlug, 64).toLowerCase();
  const requestId = clean(parsed.value.clientRequestId, 80);
  if (!/^[a-z0-9-]{1,64}$/.test(channelSlug) || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) {
    return error(400, "INVALID_REQUEST", "Choose an available DZN Comms channel and retry.");
  }
  const moderated = moderateDznCommsBody(parsed.value.body);
  const db = requireDb(env);
  const ownerArchiveEnabled = readDznCommsOwnerArchiveFlags(env, request).enabled;
  const channel = await readSendChannel(db, channelSlug);
  if (!channel) {
    return channelSlug === "global-chat"
      ? error(503, "CHAT_NOT_READY", "Global Chat is not ready yet.")
      : privateGroupUnavailable();
  }
  if (channel.kind === "private_group") {
    if (!readDznCommsPrivateGroupFlags(env, request).enabled) return privateGroupUnavailable();
    if (!await hasActivePrivateGroupMembership(db, channel.id, user.id)) return privateGroupUnavailable();
  }
  const bodyHash = await keyedDigest(typeof parsed.value.body === "string" ? parsed.value.body : "", env.DZN_COMMS_LEDGER_SECRET!);
  const actorReceiptKey = await receiptDigest(user.id, requestId, env.DZN_COMMS_LEDGER_SECRET!);
  const actorRateKey = await rateLimitDigest(user.id, env.DZN_COMMS_LEDGER_SECRET!);
  const actorAttemptKey = await attemptLimitDigest(user.id, env.DZN_COMMS_LEDGER_SECRET!);
  const now = new Date();
  const minuteBucket = now.toISOString().slice(0, 16);
  try {
    await allocateAttemptSlot(db, actorAttemptKey, minuteBucket).run();
  } catch (cause) {
    if (isQuotaConstraintError(cause)) return error(429, "RATE_LIMITED", "Too many chat attempts were made. Wait a moment and retry.");
    return error(503, "CHAT_STORAGE_UNAVAILABLE", "Global Chat could not verify this attempt. Retry shortly.");
  }
  const replay = await readReceipt(db, actorReceiptKey, channel, user.id, requestId);
  if (replay) {
    if (replay.body_hash !== bodyHash) return error(409, "REQUEST_ID_CONFLICT", "This retry ID was already used for different text.");
    return receiptResponse(replay, true);
  }
  if (channel.kind === "private_group" && !await hasActivePrivateGroupMembership(db, channel.id, user.id)) {
    return error(403, "PRIVATE_GROUP_ACCESS_REVOKED", "Your access to this private DZN Comms group has changed.");
  }
  const timeout = await db.prepare("SELECT expires_at FROM dzn_comms_timeouts WHERE actor_user_id = ? AND julianday(expires_at) > julianday('now') LIMIT 1").bind(user.id).first<{ expires_at: string }>();
  if (timeout) return error(423, "CHAT_TIMEOUT", "Chat is temporarily unavailable for this account.");
  if (moderated.decision !== "allow") return storeRejected(db, user, actorReceiptKey, channel, requestId, bodyHash, moderated.decision, moderated.code);
  const messageId = crypto.randomUUID();
  const receiptId = crypto.randomUUID();
  const expires = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const messageExpires = new Date(now.getTime() + MESSAGE_RETENTION_DAYS * 86_400_000).toISOString();
  try {
    const results = await db.batch([
      deleteExpiredReceipt(db, actorReceiptKey, channel.id, requestId),
      allocateSendSlot(db, actorRateKey, minuteBucket, now.toISOString()),
      db.prepare(`INSERT INTO dzn_comms_messages
        (id, channel_id, author_user_id, author_display_name, author_role_label, body, visibility_state, source_label, expires_at)
        SELECT ?, ?, ?, ?, 'Member', ?, 'visible', 'authenticated_web_chat', ?
        WHERE ? = 'public' OR EXISTS (
          SELECT 1 FROM dzn_comms_private_group_members
          WHERE channel_id = ? AND user_id = ? AND membership_state = 'active'
        )`).bind(messageId, channel.id, user.id, safeName(user), moderated.body, messageExpires,
          channel.kind, channel.id, user.id),
      db.prepare(`INSERT INTO dzn_comms_send_receipts
        (id, actor_receipt_key, channel_id, client_request_id, body_hash, decision, response_status, reason_code,
          message_id, send_rate_key, send_minute_bucket, send_slot, expires_at)
        SELECT ?, ?, ?, ?, ?, 'allow', 201, 'MESSAGE_ALLOWED', ?, ?, ?, slots.slot, ?
        FROM dzn_comms_send_slots AS slots
        JOIN dzn_comms_messages AS messages ON messages.id = ? AND messages.channel_id = ?
        WHERE slots.actor_rate_key = ? AND slots.minute_bucket = ? AND slots.accepted_at = ?
        LIMIT 1`).bind(receiptId, actorReceiptKey, channel.id, requestId, bodyHash, messageId, actorRateKey, minuteBucket, expires,
          messageId, channel.id, actorRateKey, minuteBucket, now.toISOString()),
      ...(ownerArchiveEnabled ? [archiveSnapshotStatement(db, messageId), archiveEventStatement(db, messageId, "sent", user.id)] : []),
    ]);
    if (channel.kind === "private_group" && Number(results[2]?.meta?.changes ?? 0) !== 1) {
      return error(403, "PRIVATE_GROUP_ACCESS_REVOKED", "Your access to this private DZN Comms group has changed.");
    }
  } catch (cause) {
    const concurrentReplay = await readReceipt(db, actorReceiptKey, channel, user.id, requestId);
    if (concurrentReplay?.body_hash === bodyHash) return receiptResponse(concurrentReplay, true);
    if (concurrentReplay) return error(409, "REQUEST_ID_CONFLICT", "This retry ID was already used for different text.");
    if (isQuotaConstraintError(cause)) return error(429, "RATE_LIMITED", "Wait five seconds before sending another message.");
    return error(503, "CHAT_STORAGE_UNAVAILABLE", "Global Chat could not store that message. Retry shortly.");
  }
  return json({ ok: true, code: "MESSAGE_SENT", message_id: messageId, replayed: false }, { status: 201, headers: privateNoStoreHeaders() });
}

export async function handleDznCommsReport(request: Request, env: Env) {
  if (request.method !== "POST") return methodNotAllowed();
  if (!readDznCommsLiveFlags(env, request).enabled) return unavailable();
  if (!sameOrigin(request)) return error(403, "CROSS_ORIGIN", "Cross-origin report requests are not allowed.");
  const user = await getSessionUser(env, request);
  if (!user) return error(401, "UNAUTHORIZED", "Log in with Discord to report a message.");
  const parsed = await readBoundedJson<ReportInput>(request, 2_048);
  if (!parsed.ok) return error(parsed.status, parsed.error, parsed.message);
  if (!exactKeys(parsed.value, ["messageId", "reason"])) return error(400, "INVALID_REPORT", "Report request fields are invalid.");
  const messageId = clean(parsed.value.messageId, 80);
  const reason = clean(parsed.value.reason, 40);
  if (!messageId || !reportReasons.has(reason)) return error(400, "INVALID_REPORT", "Choose a valid report reason.");
  const db = requireDb(env);
  const message = await db.prepare(`SELECT messages.id, messages.author_user_id,
      channels.id AS channel_id, channels.kind, channels.visibility
    FROM dzn_comms_messages AS messages
    JOIN dzn_comms_channels AS channels ON channels.id = messages.channel_id
    WHERE messages.id = ? AND messages.visibility_state = 'visible'
      AND ((channels.slug = 'global-chat' AND channels.kind = 'public' AND channels.visibility = 'public')
        OR (channels.kind = 'private_group' AND channels.visibility = 'private_group'))
    LIMIT 1`).bind(messageId).first<SendChannel & { author_user_id: string | null; channel_id: string }>();
  if (!message || message.author_user_id === user.id) return error(400, "INVALID_REPORT", "That message cannot be reported by this account.");
  if (message.kind === "private_group") {
    if (!readDznCommsPrivateGroupFlags(env, request).enabled) return error(400, "INVALID_REPORT", "That message cannot be reported by this account.");
    if (!await hasActivePrivateGroupMembership(db, message.channel_id, user.id)) return error(400, "INVALID_REPORT", "That message cannot be reported by this account.");
  }
  const dbReport = await db.prepare("SELECT id FROM dzn_comms_reports WHERE message_id = ? AND reporter_user_id = ? LIMIT 1").bind(messageId, user.id).first<{ id: string }>();
  if (dbReport) return json({ ok: true, code: "REPORT_RECEIVED", replayed: true }, { status: 202, headers: privateNoStoreHeaders() });
  const now = new Date();
  try {
    const results = await db.batch([
      allocateReportSlot(db, user.id, now.toISOString().slice(0, 16)),
      db.prepare(`INSERT INTO dzn_comms_reports (id, message_id, reporter_user_id, reason_code)
        SELECT ?, ?, ?, ?
        WHERE ? = 'public' OR EXISTS (
          SELECT 1 FROM dzn_comms_private_group_members
          WHERE channel_id = ? AND user_id = ? AND membership_state = 'active'
        )`).bind(crypto.randomUUID(), messageId, user.id, reason, message.kind, message.channel_id, user.id),
    ]);
    if (message.kind === "private_group" && Number(results[1]?.meta?.changes ?? 0) !== 1) {
      return error(403, "PRIVATE_GROUP_ACCESS_REVOKED", "Your access to this private DZN Comms group has changed.");
    }
  } catch (cause) {
    const replay = await db.prepare("SELECT id FROM dzn_comms_reports WHERE message_id = ? AND reporter_user_id = ? LIMIT 1").bind(messageId, user.id).first<{ id: string }>();
    if (!replay && isQuotaConstraintError(cause)) return error(429, "REPORT_RATE_LIMITED", "Too many reports were sent. Wait a moment and retry.");
    if (!replay) return error(503, "REPORT_STORAGE_UNAVAILABLE", "That report could not be stored. Retry shortly.");
  }
  return json({ ok: true, code: "REPORT_RECEIVED" }, { status: 202, headers: privateNoStoreHeaders() });
}

export async function handleDznCommsSelfDelete(request: Request, env: Env, messageIdInput: string) {
  if (request.method !== "DELETE") return methodNotAllowed();
  if (!readDznCommsLiveFlags(env, request).enabled || !readDznCommsOwnerArchiveFlags(env, request).enabled) return unavailable();
  if (!sameOrigin(request)) return error(403, "CROSS_ORIGIN", "Cross-origin chat requests are not allowed.");
  const user = await getSessionUser(env, request);
  if (!user) return error(401, "UNAUTHORIZED", "Log in with Discord to manage your messages.");
  const messageId = clean(messageIdInput, 80);
  if (!messageId) return error(404, "MESSAGE_NOT_FOUND", "That message is unavailable.");
  const db = requireDb(env);
  const target = await db.prepare(`SELECT messages.id, channels.kind, channels.id AS channel_id
    FROM dzn_comms_messages AS messages
    JOIN dzn_comms_channels AS channels ON channels.id = messages.channel_id
    WHERE messages.id = ? AND messages.author_user_id = ? AND messages.visibility_state = 'visible'
      AND ((channels.slug = 'global-chat' AND channels.kind = 'public' AND channels.visibility = 'public')
        OR (channels.kind = 'private_group' AND channels.visibility = 'private_group'))
    LIMIT 1`).bind(messageId, user.id).first<{ id: string; kind: "public" | "private_group"; channel_id: string }>();
  if (!target || (target.kind === "private_group" && (!readDznCommsPrivateGroupFlags(env, request).enabled || !await hasActivePrivateGroupMembership(db, target.channel_id, user.id)))) {
    return error(404, "MESSAGE_NOT_FOUND", "That message is unavailable.");
  }
  const results = await db.batch([
    archiveSnapshotStatement(db, messageId),
    db.prepare(`UPDATE dzn_comms_messages
      SET body = 'Message deleted.', author_user_id = NULL, author_display_name = 'DZN Safety',
          author_role_label = 'System', visibility_state = 'deleted', edited_at = CURRENT_TIMESTAMP
      WHERE id = ? AND author_user_id = ? AND visibility_state = 'visible'`).bind(messageId, user.id),
    db.prepare(`UPDATE dzn_comms_owner_message_archive
      SET deleted_at = CURRENT_TIMESTAMP, deleted_by_user_id = ?, deletion_kind = 'self_deleted'
      WHERE message_id = ? AND deleted_at IS NULL`).bind(user.id, messageId),
    archiveEventAfterTransitionStatement(db, messageId, "self_deleted", user.id),
    db.prepare(`UPDATE dzn_comms_send_receipts
      SET message_id = NULL, send_rate_key = NULL, send_minute_bucket = NULL, send_slot = NULL
      WHERE message_id = ?`).bind(messageId),
  ]);
  if (Number(results[1]?.meta?.changes ?? 0) !== 1 || Number(results[2]?.meta?.changes ?? 0) !== 1 || Number(results[3]?.meta?.changes ?? 0) !== 1) {
    return error(409, "MESSAGE_NO_CHANGE", "That message was already removed or is no longer available.");
  }
  return json({ ok: true, code: "MESSAGE_DELETED" }, { headers: privateNoStoreHeaders() });
}

export async function handleDznCommsModeration(request: Request, env: Env) {
  if (request.method === "GET") return handleDznCommsModerationQueue(request, env);
  if (request.method !== "POST") return methodNotAllowed();
  if (!readDznCommsOwnerModerationFlags(env, request).enabled) return unavailable();
  if (!sameOrigin(request)) return error(403, "CROSS_ORIGIN", "Cross-origin moderation requests are not allowed.");
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;
  const parsed = await readBoundedJson<ModerateInput>(request, 2_048);
  if (!parsed.ok) return error(parsed.status, parsed.error, parsed.message);
  if (!exactKeys(parsed.value, ["messageId", "action", "reason"])) return error(400, "INVALID_MODERATION", "Moderation request fields are invalid.");
  const messageId = clean(parsed.value.messageId, 80);
  const action = clean(parsed.value.action, 32);
  const reason = clean(parsed.value.reason, 80);
  if (!messageId || !moderationActions.has(action) || !reason) return error(400, "INVALID_MODERATION", "Message, action and reason are required.");
  const state = action === "restore" ? "visible" : action === "delete" ? "deleted" : action === "hide" ? "hidden" : null;
  const db = requireDb(env);
  const target = await db.prepare(`SELECT messages.id, channels.kind
    FROM dzn_comms_messages AS messages
    JOIN dzn_comms_channels AS channels ON channels.id = messages.channel_id
    WHERE messages.id = ?
      AND ((channels.slug = 'global-chat' AND channels.kind = 'public' AND channels.visibility = 'public')
        OR (channels.kind = 'private_group' AND channels.visibility = 'private_group'))
    LIMIT 1`).bind(messageId).first<{ id: string; kind: "public" | "private_group" }>();
  if (!target || (target.kind === "private_group" && !readDznCommsPrivateGroupFlags(env, request).enabled)) {
    return error(404, "MESSAGE_NOT_FOUND", "That DZN Comms message is unavailable.");
  }
  const archiveEnabled = readDznCommsOwnerArchiveFlags(env, request).enabled;
  const statements: D1PreparedStatement[] = [];
  if (state && archiveEnabled) statements.push(archiveSnapshotStatement(db, messageId));
  if (state === "deleted") statements.push(db.prepare("UPDATE dzn_comms_messages SET body = 'Message deleted.', author_user_id = NULL, author_display_name = 'DZN Safety', author_role_label = 'System', visibility_state = 'deleted', edited_at = CURRENT_TIMESTAMP WHERE id = ? AND visibility_state != 'deleted'").bind(messageId));
  else if (state) statements.push(db.prepare("UPDATE dzn_comms_messages SET visibility_state = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ? AND visibility_state != 'deleted' AND visibility_state != ?").bind(state, messageId, state));
  if (action === "resolve_report" || action === "dismiss_report") statements.push(db.prepare("UPDATE dzn_comms_reports SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by_user_id = ? WHERE message_id = ? AND status = 'open'").bind(action === "resolve_report" ? "resolved" : "dismissed", auth.user.id, messageId));
  statements.push(db.prepare("INSERT INTO dzn_comms_moderation_audit (id, message_id, actor_user_id, action, reason_code) SELECT ?, ?, ?, ?, ? WHERE changes() > 0").bind(crypto.randomUUID(), messageId, auth.user.id, action, reason));
  if (state && archiveEnabled) {
    statements.push(db.prepare(`UPDATE dzn_comms_owner_message_archive
      SET deleted_at = CASE WHEN ? = 'deleted' THEN CURRENT_TIMESTAMP ELSE deleted_at END,
          deleted_by_user_id = CASE WHEN ? = 'deleted' THEN ? ELSE deleted_by_user_id END,
          deletion_kind = CASE WHEN ? = 'deleted' THEN 'moderator_deleted' ELSE deletion_kind END
      WHERE message_id = ?
        AND (? != 'deleted' OR deleted_at IS NULL)`).bind(state, state, auth.user.id, state, messageId, state));
    if (state === "deleted") statements.push(archiveEventAfterTransitionStatement(db, messageId, "moderator_deleted", auth.user.id));
  }
  if (state === "deleted") {
    statements.push(db.prepare("UPDATE dzn_comms_reports SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by_user_id = ? WHERE message_id = ? AND status = 'open'").bind(auth.user.id, messageId));
    statements.push(db.prepare("UPDATE dzn_comms_send_receipts SET message_id = NULL, send_rate_key = NULL, send_minute_bucket = NULL, send_slot = NULL WHERE message_id = ?").bind(messageId));
  }
  const results = await db.batch(statements);
  const mutationIndex = state && archiveEnabled ? 1 : 0;
  const auditIndex = mutationIndex + 1;
  if (Number(results[mutationIndex]?.meta?.changes ?? 0) < 1 || Number(results[auditIndex]?.meta?.changes ?? 0) !== 1) {
    return error(409, "MODERATION_NO_CHANGE", "That moderation action no longer changes the current message or report state.");
  }
  return json({ ok: true, code: "MODERATION_RECORDED" }, { headers: privateNoStoreHeaders() });
}

export async function handleDznCommsOwnerArchive(request: Request, env: Env) {
  if (request.method !== "GET") return methodNotAllowed();
  if (!readDznCommsOwnerArchiveFlags(env, request).enabled) return unavailable();
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const query = clean(url.searchParams.get("query"), 80).toLowerCase();
  const filter = clean(url.searchParams.get("filter"), 16);
  const effectiveFilter = filter === "active" ? "visible" : filter || "all";
  if (effectiveFilter !== "all" && effectiveFilter !== "visible" && effectiveFilter !== "hidden" && effectiveFilter !== "deleted") {
    return error(400, "INVALID_ARCHIVE_FILTER", "Choose a valid archive filter.");
  }
  const pattern = query ? `%${escapeLike(query)}%` : "%";
  const db = requireDb(env);
  const result = await db.prepare(`SELECT archive.message_id, channels.slug AS channel_slug,
      archive.author_display_name, archive.author_role_label, archive.original_body, archive.sent_at,
      archive.deleted_at, archive.deletion_kind, users.username AS deleted_by_name,
      COALESCE(messages.visibility_state, CASE WHEN archive.deleted_at IS NOT NULL THEN 'deleted' ELSE 'unavailable' END) AS current_visibility_state
    FROM dzn_comms_owner_message_archive AS archive
    JOIN dzn_comms_channels AS channels ON channels.id = archive.channel_id
    LEFT JOIN dzn_comms_messages AS messages ON messages.id = archive.message_id
    LEFT JOIN users ON users.id = archive.deleted_by_user_id
    WHERE julianday(archive.retained_until) > julianday('now')
      AND (? = 'all' OR COALESCE(messages.visibility_state, CASE WHEN archive.deleted_at IS NOT NULL THEN 'deleted' ELSE 'unavailable' END) = ?)
      AND (lower(archive.author_display_name) LIKE ? ESCAPE '\\' OR lower(archive.original_body) LIKE ? ESCAPE '\\')
    ORDER BY julianday(archive.sent_at) DESC, archive.message_id DESC
    LIMIT 100`).bind(effectiveFilter, effectiveFilter, pattern, pattern).all<Record<string, unknown>>();
  return json({ ok: true, private: true, retention_days: MESSAGE_RETENTION_DAYS, rows: result.results ?? [] }, { headers: privateNoStoreHeaders() });
}

export async function handleDznCommsModerationQueue(request: Request, env: Env) {
  if (!readDznCommsOwnerModerationFlags(env, request).enabled) return unavailable();
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;
  const db = requireDb(env);
  const privateGroupsEnabled = readDznCommsPrivateGroupFlags(env, request).enabled ? 1 : 0;
  const [reports, audit] = await Promise.all([
    db.prepare(`SELECT messages.id AS message_id, messages.author_display_name, messages.body,
        messages.visibility_state, messages.created_at, messages.expires_at,
        COUNT(reports.id) AS report_count, MIN(reports.created_at) AS first_reported_at,
        GROUP_CONCAT(DISTINCT reports.reason_code) AS reasons
      FROM dzn_comms_reports AS reports
      JOIN dzn_comms_messages AS messages ON messages.id = reports.message_id
      JOIN dzn_comms_channels AS channels ON channels.id = messages.channel_id
      WHERE reports.status = 'open'
        AND ((channels.slug = 'global-chat' AND channels.kind = 'public' AND channels.visibility = 'public')
          OR (? = 1 AND channels.kind = 'private_group' AND channels.visibility = 'private_group'))
      GROUP BY messages.id
      ORDER BY MIN(reports.created_at) ASC
      LIMIT 100`).bind(privateGroupsEnabled).all<Record<string, unknown>>(),
    db.prepare(`SELECT audit.id, audit.message_id, audit.action, audit.reason_code, audit.created_at,
        users.username AS actor_name
      FROM dzn_comms_moderation_audit AS audit
      LEFT JOIN users ON users.id = audit.actor_user_id
      ORDER BY audit.created_at DESC, audit.id DESC
      LIMIT 100`).all<Record<string, unknown>>(),
  ]);
  return json({
    ok: true,
    source: "dzn_comms_owner_moderation",
    private: true,
    reports: reports.results ?? [],
    audit: audit.results ?? [],
    archive_available: readDznCommsOwnerArchiveFlags(env, request).enabled,
    retention: { message_days: MESSAGE_RETENTION_DAYS, deleted_body_erasure: true },
  }, { headers: privateNoStoreHeaders() });
}

export async function runDznCommsRetention(db: D1Database, now = new Date()) {
  const timestamp = now.toISOString();
  const slotCutoff = new Date(now.getTime() - RATE_SLOT_RETENTION_DAYS * 86_400_000).toISOString();
  const installedReactionTables = await db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('dzn_comms_reaction_mutations', 'dzn_comms_reaction_rate_slots')`).all<{ name: string }>();
  const reactionTables = new Set((installedReactionTables.results ?? []).map((row) => row.name));
  const ownerArchiveTable = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dzn_comms_owner_message_archive'").first<{ name: string }>();
  const statements = [
    db.prepare(`UPDATE dzn_comms_messages
      SET body = 'Message expired.', author_user_id = NULL, author_display_name = 'DZN Safety',
          author_role_label = 'System', visibility_state = 'expired', edited_at = ?
      WHERE expires_at IS NOT NULL AND julianday(expires_at) <= julianday(?)
        AND visibility_state NOT IN ('deleted', 'expired')`).bind(timestamp, timestamp),
    db.prepare(`UPDATE dzn_comms_reports
      SET status = 'resolved', resolved_at = ?, resolved_by_user_id = NULL
      WHERE status = 'open' AND message_id IN (
        SELECT id FROM dzn_comms_messages WHERE visibility_state = 'expired'
      )`).bind(timestamp),
    db.prepare("DELETE FROM dzn_comms_send_receipts WHERE julianday(expires_at) <= julianday(?)").bind(timestamp),
    db.prepare("DELETE FROM dzn_comms_timeouts WHERE julianday(expires_at) <= julianday(?)").bind(timestamp),
    db.prepare("DELETE FROM dzn_comms_send_slots WHERE julianday(created_at) <= julianday(?)").bind(slotCutoff),
    db.prepare("DELETE FROM dzn_comms_attempt_slots WHERE julianday(created_at) <= julianday(?)").bind(slotCutoff),
    db.prepare("DELETE FROM dzn_comms_report_slots WHERE julianday(created_at) <= julianday(?)").bind(slotCutoff),
  ];
  if (reactionTables.has("dzn_comms_reaction_mutations")) {
    statements.push(db.prepare("DELETE FROM dzn_comms_reaction_mutations WHERE julianday(expires_at) <= julianday(?)").bind(timestamp));
  }
  if (reactionTables.has("dzn_comms_reaction_rate_slots")) {
    statements.push(db.prepare("DELETE FROM dzn_comms_reaction_rate_slots WHERE julianday(created_at) <= julianday(?)").bind(slotCutoff));
  }
  if (ownerArchiveTable) {
    statements.push(db.prepare("DELETE FROM dzn_comms_owner_message_archive WHERE julianday(retained_until) <= julianday(?)").bind(timestamp));
  }
  const results = await db.batch(statements);
  const changes = results.map((result) => Number(result.meta?.changes ?? 0));
  return {
    messagesErased: changes[0] ?? 0,
    reportsResolved: changes[1] ?? 0,
    receiptsDeleted: changes[2] ?? 0,
    timeoutsDeleted: changes[3] ?? 0,
    rateSlotsDeleted: changes.slice(4, 7).reduce((sum, value) => sum + value, 0),
    reactionMutationReceiptsDeleted: reactionTables.has("dzn_comms_reaction_mutations") ? changes[7] ?? 0 : 0,
    reactionRateSlotsDeleted: reactionTables.has("dzn_comms_reaction_rate_slots")
      ? changes[reactionTables.has("dzn_comms_reaction_mutations") ? 8 : 7] ?? 0
      : 0,
    ownerArchiveRowsDeleted: ownerArchiveTable ? changes.at(-1) ?? 0 : 0,
  };
}

function archiveSnapshotStatement(db: D1Database, messageId: string) {
  return db.prepare(`INSERT OR IGNORE INTO dzn_comms_owner_message_archive
    (message_id, channel_id, author_user_id, author_display_name, author_role_label, original_body, sent_at, retained_until)
    SELECT id, channel_id, author_user_id, author_display_name, author_role_label, body, created_at,
      COALESCE(NULLIF(expires_at, ''), datetime(created_at, '+30 days'))
    FROM dzn_comms_messages
    WHERE id = ? AND visibility_state NOT IN ('deleted', 'expired')`).bind(messageId);
}

function archiveEventStatement(db: D1Database, messageId: string, action: "sent" | "self_deleted" | "moderator_deleted", actorUserId: string | null) {
  return db.prepare(`INSERT INTO dzn_comms_owner_message_archive_events (id, message_id, action, actor_user_id)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM dzn_comms_owner_message_archive WHERE message_id = ?)`)
    .bind(crypto.randomUUID(), messageId, action, actorUserId, messageId);
}

function archiveEventAfterTransitionStatement(db: D1Database, messageId: string, action: "self_deleted" | "moderator_deleted", actorUserId: string) {
  return db.prepare(`INSERT INTO dzn_comms_owner_message_archive_events (id, message_id, action, actor_user_id)
    SELECT ?, ?, ?, ? WHERE changes() = 1`)
    .bind(crypto.randomUUID(), messageId, action, actorUserId);
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function storeRejected(db: D1Database, user: SessionUser, actorReceiptKey: string, channel: SendChannel, requestId: string, bodyHash: string, decision: "block" | "timeout", reason: string) {
  const status = decision === "timeout" ? 423 : 422;
  const receiptId = crypto.randomUUID();
  const now = Date.now();
  const statements = [
    deleteExpiredReceipt(db, actorReceiptKey, channel.id, requestId),
    db.prepare(`INSERT INTO dzn_comms_send_receipts
      (id, actor_receipt_key, channel_id, client_request_id, body_hash, decision, response_status, reason_code, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ? = 'public' OR EXISTS (
        SELECT 1 FROM dzn_comms_private_group_members
        WHERE channel_id = ? AND user_id = ? AND membership_state = 'active'
      )`).bind(receiptId, actorReceiptKey, channel.id, requestId, bodyHash, decision, status, reason,
        new Date(now + 7 * 86_400_000).toISOString(), channel.kind, channel.id, user.id),
  ];
  if (decision === "timeout") statements.push(db.prepare(`INSERT INTO dzn_comms_timeouts (actor_user_id, reason_code, expires_at)
    SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM dzn_comms_send_receipts WHERE id = ?)
    ON CONFLICT(actor_user_id) DO UPDATE SET reason_code = excluded.reason_code,
      expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP`).bind(user.id, reason, new Date(now + 10 * 60_000).toISOString(), receiptId));
  try {
    const results = await db.batch(statements);
    if (channel.kind === "private_group" && Number(results[1]?.meta?.changes ?? 0) !== 1) {
      return error(403, "PRIVATE_GROUP_ACCESS_REVOKED", "Your access to this private DZN Comms group has changed.");
    }
  } catch {
    const replay = await readReceipt(db, actorReceiptKey, channel, user.id, requestId);
    if (replay?.body_hash === bodyHash) return receiptResponse(replay, true);
    if (replay) return error(409, "REQUEST_ID_CONFLICT", "This retry ID was already used for different text.");
    return error(503, "CHAT_STORAGE_UNAVAILABLE", "Global Chat could not store that safety decision. Retry shortly.");
  }
  return error(status, reason, decision === "timeout" ? "This account has a short chat timeout for a safety review." : "That message was blocked by DZN Safety.");
}

async function readReceipt(db: D1Database, actorReceiptKey: string, channel: SendChannel, userId: string, requestId: string) {
  return db.prepare(`SELECT receipts.body_hash, receipts.decision, receipts.response_status,
      receipts.reason_code, receipts.message_id
    FROM dzn_comms_send_receipts AS receipts
    WHERE receipts.actor_receipt_key = ? AND receipts.channel_id = ?
      AND receipts.client_request_id = ? AND julianday(receipts.expires_at) > julianday('now')
      AND (? = 'public' OR EXISTS (
        SELECT 1 FROM dzn_comms_private_group_members
        WHERE channel_id = receipts.channel_id AND user_id = ? AND membership_state = 'active'
      ))
    LIMIT 1`).bind(actorReceiptKey, channel.id, requestId, channel.kind, userId)
    .first<{ body_hash: string; decision: string; response_status: number; reason_code: string | null; message_id: string | null }>();
}

async function readSendChannel(db: D1Database, slug: string) {
  return db.prepare(`SELECT id, kind, visibility
    FROM dzn_comms_channels
    WHERE slug = ? AND is_readable = 1
      AND ((slug = 'global-chat' AND kind = 'public' AND visibility = 'public')
        OR (kind = 'private_group' AND visibility = 'private_group'))
    LIMIT 1`).bind(slug).first<SendChannel>();
}

async function hasActivePrivateGroupMembership(db: D1Database, channelId: string, userId: string) {
  const membership = await db.prepare(`SELECT 1 AS allowed
    FROM dzn_comms_private_group_members
    WHERE channel_id = ? AND user_id = ? AND membership_state = 'active'
    LIMIT 1`).bind(channelId, userId).first<{ allowed: number }>();
  return membership?.allowed === 1;
}

function deleteExpiredReceipt(db: D1Database, actorReceiptKey: string, channelId: string, requestId: string) {
  return db.prepare("DELETE FROM dzn_comms_send_receipts WHERE actor_receipt_key = ? AND channel_id = ? AND client_request_id = ? AND julianday(expires_at) <= julianday('now')").bind(actorReceiptKey, channelId, requestId);
}

function receiptResponse(row: { decision: string; response_status: number; reason_code: string | null; message_id: string | null }, replayed: boolean) {
  const ok = row.decision === "allow";
  return json({ ok, code: ok ? "MESSAGE_SENT" : row.reason_code, message_id: row.message_id, replayed }, { status: replayed && ok ? 200 : row.response_status, headers: privateNoStoreHeaders() });
}
function unavailable() { return error(404, "DZN_COMMS_LIVE_DISABLED", "Live DZN Comms is not enabled in this environment."); }
function privateGroupUnavailable() { return error(403, "PRIVATE_GROUP_UNAVAILABLE", "This private DZN Comms group is not available to your account."); }
function error(status: number, code: string, message: string) { return json({ ok: false, code, message }, { status, headers: privateNoStoreHeaders() }); }
function booleanFlag(value: unknown) { return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()); }
function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function safeName(user: SessionUser) { return clean(user.username, 60).replace(/[\u0000-\u001f\u007f]/g, "") || "DZN Player"; }
function exactKeys(value: unknown, keys: string[]) { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).sort().join("|") === [...keys].sort().join("|")); }
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); if (!origin) return false; try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; } }
function isLocalRequest(request: Request) { try { const host = new URL(request.url).hostname.toLowerCase(); return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost"); } catch { return false; } }
function readScopedFlag(enabledValue: unknown, scopeValue: unknown, request?: Request) {
  const enabled = booleanFlag(enabledValue);
  const scope = clean(scopeValue, 32).toLowerCase();
  const localRequest = request ? isLocalRequest(request) : false;
  return { enabled: enabled && (scope === "production" || (scope === "local_test" && localRequest)), scope, localRequest };
}
function isQuotaConstraintError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return /(?:constraint failed|constraint_error|not null constraint|unique constraint)/i.test(message)
    && /dzn_comms_(?:attempt|send|report)_slots/i.test(message);
}
function allocateAttemptSlot(db: D1Database, actorAttemptKey: string, minuteBucket: string) {
  return db.prepare(slotAllocationSql("dzn_comms_attempt_slots", "actor_attempt_key", ATTEMPTS_PER_MINUTE)).bind(actorAttemptKey, minuteBucket, actorAttemptKey, minuteBucket);
}
function allocateReportSlot(db: D1Database, actorId: string, minuteBucket: string) {
  return db.prepare(slotAllocationSql("dzn_comms_report_slots", "reporter_user_id", REPORTS_PER_MINUTE)).bind(actorId, minuteBucket, actorId, minuteBucket);
}
function allocateSendSlot(db: D1Database, actorRateKey: string, minuteBucket: string, acceptedAt: string) {
  return db.prepare(`WITH RECURSIVE slots(slot) AS (SELECT 1 UNION ALL SELECT slot + 1 FROM slots WHERE slot < ${SENDS_PER_MINUTE})
    INSERT INTO dzn_comms_send_slots (actor_rate_key, minute_bucket, slot, accepted_at)
    SELECT ?, ?, CASE WHEN NOT EXISTS (
      SELECT 1 FROM dzn_comms_send_slots WHERE actor_rate_key = ? AND julianday(accepted_at) > julianday(?, '-5 seconds')
    ) THEN (SELECT MIN(slot) FROM slots WHERE slot NOT IN (
      SELECT slot FROM dzn_comms_send_slots WHERE actor_rate_key = ? AND minute_bucket = ?
    )) ELSE NULL END, ?`).bind(actorRateKey, minuteBucket, actorRateKey, acceptedAt, actorRateKey, minuteBucket, acceptedAt);
}
function slotAllocationSql(table: "dzn_comms_attempt_slots" | "dzn_comms_report_slots", actorColumn: "actor_attempt_key" | "reporter_user_id", maximum: number) {
  return `WITH RECURSIVE slots(slot) AS (SELECT 1 UNION ALL SELECT slot + 1 FROM slots WHERE slot < ${maximum})
    INSERT INTO ${table} (${actorColumn}, minute_bucket, slot)
    SELECT ?, ?, (SELECT MIN(slot) FROM slots WHERE slot NOT IN (
      SELECT slot FROM ${table} WHERE ${actorColumn} = ? AND minute_bucket = ?
    ))`;
}
async function keyedDigest(value: string, secret: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`dzn-comms:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value.normalize("NFKC"))))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
async function receiptDigest(actorId: string, requestId: string, secret: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`dzn-comms-receipt:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${actorId.normalize("NFKC")}\n${requestId.normalize("NFKC")}`)))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
async function rateLimitDigest(actorId: string, secret: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`dzn-comms-rate:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(actorId)))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
async function attemptLimitDigest(actorId: string, secret: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`dzn-comms-attempt:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(actorId)))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
