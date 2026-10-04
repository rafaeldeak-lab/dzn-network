import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import { privateNoStoreHeaders } from "./performance";
import { readDznCommsLiveFlags, readDznCommsPrivateGroupFlags } from "./dzn-comms-live";
import type { Env, SessionUser } from "./types";

const MAX_REQUEST_BYTES = 2_048;
const MUTATIONS_PER_MINUTE = 30;
const MUTATION_RETENTION_DAYS = 7;
const RATE_SLOT_RETENTION_DAYS = 2;

const reactionCatalog = [
  { key: "heart", emoji: "\u{1F49C}", label: "Heart" },
  { key: "boost", emoji: "\u{1F680}", label: "Boost" },
  { key: "laugh", emoji: "\u{1F602}", label: "Laugh" },
  { key: "salute", emoji: "\u{1FAE1}", label: "Salute" },
  { key: "fire", emoji: "\u{1F525}", label: "Fire" },
  { key: "skull", emoji: "\u{1F480}", label: "Skull" },
] as const;
const allowedReactionKeys = new Set(reactionCatalog.map((reaction) => reaction.key));

type ReactionKey = (typeof reactionCatalog)[number]["key"];
type AddInput = { clientMutationId?: unknown; reactionKey?: unknown };
type RemoveInput = { clientMutationId?: unknown };
type MessageAccessRow = {
  id: string;
  channel_id: string;
  visibility_state: string;
  expires_at: string | null;
  channel_visibility: string;
  channel_kind: string;
  is_readable: number;
};
type MutationReceipt = {
  request_hash: string;
  result: "added" | "already_present" | "removed" | "already_absent";
  response_status: number;
  message_id: string | null;
  reaction_key: string;
};
type ReactionCountRow = { message_id: string; reaction_key: string; reaction_count: number; latest_update: string | null };
type CurrentReactionRow = { message_id: string; reaction_key: string };
type ReactionSummary = {
  revision: string;
  available_reactions: typeof reactionCatalog;
  counts: { key: ReactionKey; emoji: string; label: string; count: number; current_user_reacted: boolean }[];
};

export function readDznCommsReactionFlags(env: Env, request?: Request) {
  const live = readDznCommsLiveFlags(env, request);
  const scope = clean(env.DZN_COMMS_REACTIONS_SCOPE, 32).toLowerCase();
  const localRequest = request ? isLocalRequest(request) : false;
  const scoped = scope === "production" || (scope === "local_test" && localRequest);
  const readEnabled = live.enabled && scoped && booleanFlag(env.DZN_COMMS_REACTIONS_READ_ENABLED);
  const writeEnabled = readEnabled && booleanFlag(env.DZN_COMMS_REACTIONS_WRITE_ENABLED);
  return { readEnabled, writeEnabled, scope, localRequest, liveEnabled: live.enabled };
}

export async function handleDznCommsReactions(request: Request, env: Env, rawMessageId: unknown) {
  if (request.method === "GET") return readReactions(request, env, rawMessageId);
  if (request.method === "POST") return addReaction(request, env, rawMessageId);
  return methodNotAllowed();
}

export async function handleDznCommsReactionRemoval(request: Request, env: Env, rawMessageId: unknown, rawReactionKey: unknown) {
  if (request.method !== "DELETE") return methodNotAllowed();
  const flags = readDznCommsReactionFlags(env, request);
  if (!flags.writeEnabled) return unavailable();
  if (!sameOrigin(request)) return error(403, "CROSS_ORIGIN", "Cross-origin reaction requests are not allowed.");
  const user = await getSessionUser(env, request);
  if (!user) return error(401, "UNAUTHORIZED", "Log in with Discord to remove a reaction.");
  const messageId = safeId(rawMessageId);
  const reactionKey = normalizeReactionKey(rawReactionKey);
  if (!messageId || !reactionKey) return error(422, "INVALID_REACTION", "Choose an available DZN reaction.");
  const parsed = await readBoundedJson<RemoveInput>(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return error(parsed.status, parsed.error, parsed.message);
  if (!exactKeys(parsed.value, ["clientMutationId"])) return error(400, "INVALID_REQUEST", "Reaction request fields are invalid.");
  const clientMutationId = mutationId(parsed.value.clientMutationId);
  if (!clientMutationId) return error(400, "INVALID_REQUEST", "Create a new reaction retry ID and try again.");
  return mutateReaction(request, env, user, messageId, reactionKey, clientMutationId, "remove");
}

async function readReactions(request: Request, env: Env, rawMessageId: unknown) {
  const flags = readDznCommsReactionFlags(env, request);
  if (!flags.readEnabled) return unavailable();
  const messageId = safeId(rawMessageId);
  if (!messageId) return error(404, "MESSAGE_UNAVAILABLE", "That message is unavailable.");
  const db = requireDb(env);
  const user = await getSessionUser(env, request);
  const access = await readMessageAccess(db, messageId);
  if (access?.channel_visibility === "private_group" && !readDznCommsPrivateGroupFlags(env, request).enabled) {
    return error(404, "MESSAGE_UNAVAILABLE", "That message is unavailable.");
  }
  if (!access || !(await canReadMessage(db, access, user))) return error(404, "MESSAGE_UNAVAILABLE", "That message is unavailable.");
  const summary = await readReactionSummary(db, messageId, user?.id ?? null);
  if (!(await canReadMessage(db, access, user))) return error(404, "MESSAGE_UNAVAILABLE", "That message is unavailable.");
  return json({ ok: true, message_id: messageId, ...summary }, { headers: privateNoStoreHeaders() });
}

async function addReaction(request: Request, env: Env, rawMessageId: unknown) {
  const flags = readDznCommsReactionFlags(env, request);
  if (!flags.writeEnabled) return unavailable();
  if (!sameOrigin(request)) return error(403, "CROSS_ORIGIN", "Cross-origin reaction requests are not allowed.");
  const user = await getSessionUser(env, request);
  if (!user) return error(401, "UNAUTHORIZED", "Log in with Discord to add a reaction.");
  const messageId = safeId(rawMessageId);
  if (!messageId) return error(404, "MESSAGE_UNAVAILABLE", "That message is unavailable.");
  const parsed = await readBoundedJson<AddInput>(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return error(parsed.status, parsed.error, parsed.message);
  if (!exactKeys(parsed.value, ["clientMutationId", "reactionKey"])) return error(400, "INVALID_REQUEST", "Reaction request fields are invalid.");
  const clientMutationId = mutationId(parsed.value.clientMutationId);
  const reactionKey = normalizeReactionKey(parsed.value.reactionKey);
  if (!clientMutationId) return error(400, "INVALID_REQUEST", "Create a new reaction retry ID and try again.");
  if (!reactionKey) return error(422, "INVALID_REACTION", "Choose an available DZN reaction.");
  return mutateReaction(request, env, user, messageId, reactionKey, clientMutationId, "add");
}

async function mutateReaction(
  request: Request,
  env: Env,
  user: SessionUser,
  messageId: string,
  reactionKey: ReactionKey,
  clientMutationId: string,
  action: "add" | "remove",
) {
  const db = requireDb(env);
  const access = await readMessageAccess(db, messageId);
  if (access?.channel_visibility === "private_group" && !readDznCommsPrivateGroupFlags(env, request).enabled) {
    return error(404, "MESSAGE_UNAVAILABLE", "That message is unavailable.");
  }
  const readable = access ? await canReadMessage(db, access, user) : false;
  if (!readable) {
    return error(404, "MESSAGE_UNAVAILABLE", "That message is unavailable.");
  }
  const existing = await readOwnReaction(db, messageId, user.id, reactionKey);

  const secret = env.DZN_COMMS_LEDGER_SECRET!;
  const actorMutationKey = await digest(`mutation:${user.id}\n${clientMutationId}`, secret);
  const actorRateKey = await digest(`reaction-rate:${user.id}`, secret);
  const requestHash = await digest(`${action}\n${messageId}\n${reactionKey}`, secret);
  const privateChannelId = access!.channel_visibility === "private_group" ? access!.channel_id : null;
  const replay = await readMutationReceipt(db, actorMutationKey);
  if (replay) {
    if (replay.request_hash !== requestHash) return error(409, "MUTATION_ID_CONFLICT", "This reaction retry ID was already used for another change.");
    return mutationResponse(db, access!, user, messageId, reactionKey, replay.result, replay.response_status, true);
  }

  const active = existing?.active === 1;
  const result = action === "add" ? (active ? "already_present" : "added") : (active ? "removed" : "already_absent");
  const status = result === "added" ? 201 : 200;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MUTATION_RETENTION_DAYS * 86_400_000).toISOString();
  try {
    await db.batch([
      db.prepare("DELETE FROM dzn_comms_reaction_mutations WHERE actor_mutation_key = ? AND julianday(expires_at) <= julianday('now')").bind(actorMutationKey),
      allocateReactionSlot(db, actorRateKey, now.toISOString().slice(0, 16)),
      action === "add"
        ? db.prepare(`INSERT INTO dzn_comms_message_reactions
            (id, message_id, actor_user_id, reaction_key, active, removed_at)
          SELECT ?, ?, ?, ?, 1, NULL
          WHERE ? IS NULL OR EXISTS (
            SELECT 1 FROM dzn_comms_private_group_members
            WHERE channel_id = ? AND user_id = ? AND membership_state = 'active'
          )
          ON CONFLICT(message_id, actor_user_id, reaction_key) DO UPDATE SET
            active = 1, updated_at = CURRENT_TIMESTAMP, removed_at = NULL`).bind(
              crypto.randomUUID(), messageId, user.id, reactionKey,
              privateChannelId, privateChannelId, user.id,
            )
        : db.prepare(`UPDATE dzn_comms_message_reactions
          SET active = 0, updated_at = CURRENT_TIMESTAMP, removed_at = CURRENT_TIMESTAMP
          WHERE message_id = ? AND actor_user_id = ? AND reaction_key = ? AND active = 1
            AND (? IS NULL OR EXISTS (
              SELECT 1 FROM dzn_comms_private_group_members
              WHERE channel_id = ? AND user_id = ? AND membership_state = 'active'
            ))`).bind(messageId, user.id, reactionKey, privateChannelId, privateChannelId, user.id),
      db.prepare(`INSERT INTO dzn_comms_reaction_mutations
        (id, actor_mutation_key, message_id, reaction_key, action, request_hash, result, response_status, expires_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ? IS NULL OR EXISTS (
          SELECT 1 FROM dzn_comms_private_group_members
          WHERE channel_id = ? AND user_id = ? AND membership_state = 'active'
        )`).bind(
          crypto.randomUUID(), actorMutationKey, messageId, reactionKey, action, requestHash, result, status, expiresAt,
          privateChannelId, privateChannelId, user.id,
        ),
    ]);
  } catch (cause) {
    const concurrentReplay = await readMutationReceipt(db, actorMutationKey);
    if (concurrentReplay?.request_hash === requestHash) {
      return mutationResponse(db, access!, user, messageId, reactionKey, concurrentReplay.result, concurrentReplay.response_status, true);
    }
    if (concurrentReplay) return error(409, "MUTATION_ID_CONFLICT", "This reaction retry ID was already used for another change.");
    if (isReactionQuotaError(cause)) return error(429, "REACTION_RATE_LIMITED", "Too many reactions were changed. Wait a moment and retry.");
    return error(503, "REACTION_STORAGE_UNAVAILABLE", "That reaction could not be saved. Retry shortly.");
  }
  return mutationResponse(db, access!, user, messageId, reactionKey, result, status, false);
}

async function mutationResponse(
  db: D1Database,
  access: MessageAccessRow,
  user: SessionUser,
  messageId: string,
  reactionKey: ReactionKey,
  result: MutationReceipt["result"],
  status: number,
  replayed: boolean,
) {
  const summary = await readReactionSummary(db, messageId, user.id);
  if (!(await canReadMessage(db, access, user))) return error(404, "MESSAGE_UNAVAILABLE", "That message is unavailable.");
  const selected = summary.counts.find((reaction) => reaction.key === reactionKey);
  return json({
    ok: true,
    code: result.toUpperCase(),
    result,
    replayed,
    message_id: messageId,
    reaction: selected ?? { ...catalogEntry(reactionKey), count: 0, current_user_reacted: false },
    revision: summary.revision,
  }, { status, headers: privateNoStoreHeaders() });
}

async function readMessageAccess(db: D1Database, messageId: string) {
  return db.prepare(`SELECT messages.id, messages.channel_id, messages.visibility_state, messages.expires_at,
      channels.visibility AS channel_visibility, channels.kind AS channel_kind, channels.is_readable
    FROM dzn_comms_messages AS messages
    JOIN dzn_comms_channels AS channels ON channels.id = messages.channel_id
    WHERE messages.id = ? LIMIT 1`).bind(messageId).first<MessageAccessRow>();
}

async function canReadMessage(db: D1Database, access: MessageAccessRow, user: SessionUser | null) {
  if (access.visibility_state !== "visible" || access.is_readable !== 1 || isExpired(access.expires_at)) return false;
  if (access.channel_visibility === "public" && access.channel_kind === "public") return true;
  if (access.channel_visibility !== "private_group" || access.channel_kind !== "private_group" || !user) return false;
  const membership = await db.prepare(`SELECT 1 AS allowed FROM dzn_comms_private_group_members
    WHERE channel_id = ? AND user_id = ? AND membership_state = 'active' LIMIT 1`).bind(access.channel_id, user.id).first<{ allowed: number }>();
  return membership?.allowed === 1;
}

async function readOwnReaction(db: D1Database, messageId: string, userId: string, reactionKey: ReactionKey) {
  return db.prepare(`SELECT active FROM dzn_comms_message_reactions
    WHERE message_id = ? AND actor_user_id = ? AND reaction_key = ? LIMIT 1`).bind(messageId, userId, reactionKey).first<{ active: number }>();
}

async function readMutationReceipt(db: D1Database, actorMutationKey: string) {
  return db.prepare(`SELECT request_hash, result, response_status, message_id, reaction_key
    FROM dzn_comms_reaction_mutations
    WHERE actor_mutation_key = ? AND julianday(expires_at) > julianday('now') LIMIT 1`).bind(actorMutationKey).first<MutationReceipt>();
}

export async function readDznCommsReactionSummaries(db: D1Database, messageIds: string[], userId: string | null) {
  const safeMessageIds = [...new Set(messageIds.map(safeId).filter(Boolean))] as string[];
  const result = new Map<string, ReactionSummary>();
  if (safeMessageIds.length === 0) return result;
  const placeholders = safeMessageIds.map(() => "?").join(", ");
  const counts = await db.prepare(`SELECT message_id, reaction_key, COUNT(*) AS reaction_count,
      MAX(updated_at) AS latest_update
    FROM dzn_comms_message_reactions
    WHERE message_id IN (${placeholders}) AND active = 1
    GROUP BY message_id, reaction_key ORDER BY message_id, reaction_key`).bind(...safeMessageIds).all<ReactionCountRow>();
  const current = userId
    ? await db.prepare(`SELECT message_id, reaction_key FROM dzn_comms_message_reactions
        WHERE message_id IN (${placeholders}) AND actor_user_id = ? AND active = 1`)
      .bind(...safeMessageIds, userId).all<CurrentReactionRow>()
    : { results: [] as CurrentReactionRow[] };
  const countsByMessage = new Map<string, ReactionCountRow[]>();
  const currentByMessage = new Map<string, Set<string>>();
  for (const row of counts.results ?? []) {
    const rows = countsByMessage.get(row.message_id) ?? [];
    rows.push(row);
    countsByMessage.set(row.message_id, rows);
  }
  for (const row of current.results ?? []) {
    const keys = currentByMessage.get(row.message_id) ?? new Set<string>();
    keys.add(row.reaction_key);
    currentByMessage.set(row.message_id, keys);
  }
  for (const messageId of safeMessageIds) {
    result.set(messageId, buildReactionSummary(countsByMessage.get(messageId) ?? [], currentByMessage.get(messageId) ?? new Set()));
  }
  return result;
}

async function readReactionSummary(db: D1Database, messageId: string, userId: string | null) {
  return (await readDznCommsReactionSummaries(db, [messageId], userId)).get(messageId) ?? buildReactionSummary([], new Set());
}

function buildReactionSummary(counts: ReactionCountRow[], currentKeys: Set<string>): ReactionSummary {
  const countMap = new Map(counts.map((row) => [row.reaction_key, Number(row.reaction_count ?? 0)]));
  const latest = counts.map((row) => row.latest_update ?? "").sort().at(-1) ?? "";
  return {
    revision: latest || "empty",
    available_reactions: reactionCatalog,
    counts: reactionCatalog
      .filter((reaction) => (countMap.get(reaction.key) ?? 0) > 0 || currentKeys.has(reaction.key))
      .map((reaction) => ({ ...reaction, count: countMap.get(reaction.key) ?? 0, current_user_reacted: currentKeys.has(reaction.key) })),
  };
}

export function reactionRetentionStatements(db: D1Database, timestamp: string, slotCutoff: string) {
  return [
    db.prepare("DELETE FROM dzn_comms_reaction_mutations WHERE julianday(expires_at) <= julianday(?)").bind(timestamp),
    db.prepare("DELETE FROM dzn_comms_reaction_rate_slots WHERE julianday(created_at) <= julianday(?)").bind(slotCutoff),
  ];
}

function allocateReactionSlot(db: D1Database, actorRateKey: string, minuteBucket: string) {
  return db.prepare(`WITH RECURSIVE slots(slot) AS (SELECT 1 UNION ALL SELECT slot + 1 FROM slots WHERE slot < ${MUTATIONS_PER_MINUTE})
    INSERT INTO dzn_comms_reaction_rate_slots (actor_rate_key, minute_bucket, slot)
    SELECT ?, ?, (SELECT MIN(slot) FROM slots WHERE slot NOT IN (
      SELECT slot FROM dzn_comms_reaction_rate_slots WHERE actor_rate_key = ? AND minute_bucket = ?
    ))`).bind(actorRateKey, minuteBucket, actorRateKey, minuteBucket);
}

function catalogEntry(key: ReactionKey) { return reactionCatalog.find((reaction) => reaction.key === key)!; }
function normalizeReactionKey(value: unknown): ReactionKey | null { const key = clean(value, 24).toLowerCase(); return allowedReactionKeys.has(key as ReactionKey) ? key as ReactionKey : null; }
function safeId(value: unknown) { const id = clean(value, 80); return /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? id : ""; }
function mutationId(value: unknown) { const id = clean(value, 80); return /^[a-zA-Z0-9_-]{16,80}$/.test(id) ? id : ""; }
function exactKeys(value: unknown, keys: string[]) { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).sort().join("|") === [...keys].sort().join("|")); }
function isExpired(value: string | null) { return Boolean(value && Number.isFinite(Date.parse(value)) && Date.parse(value!) <= Date.now()); }
function booleanFlag(value: unknown) { return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()); }
function clean(value: unknown, max: number) { return typeof value === "string" ? value.normalize("NFKC").trim().slice(0, max) : ""; }
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); if (!origin) return false; try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; } }
function isLocalRequest(request: Request) { try { const host = new URL(request.url).hostname.toLowerCase(); return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost"); } catch { return false; } }
function unavailable() { return error(404, "DZN_COMMS_REACTIONS_DISABLED", "DZN Comms reactions are not enabled in this environment."); }
function error(status: number, code: string, message: string) { return json({ ok: false, code, message }, { status, headers: privateNoStoreHeaders() }); }
function isReactionQuotaError(cause: unknown) { const message = cause instanceof Error ? cause.message : String(cause ?? ""); return /(?:constraint failed|constraint_error|not null constraint|unique constraint)/i.test(message) && /dzn_comms_reaction_rate_slots/i.test(message); }
async function digest(value: string, secret: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`dzn-comms-reactions:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value.normalize("NFKC"))))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

export const dznCommsReactionRetention = {
  mutationDays: MUTATION_RETENTION_DAYS,
  rateSlotDays: RATE_SLOT_RETENTION_DAYS,
};
