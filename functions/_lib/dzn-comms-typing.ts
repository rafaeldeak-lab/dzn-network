import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import { noStoreForErrorHeaders, privateNoStoreHeaders } from "./performance";
import { readDznCommsLiveFlags } from "./dzn-comms-live";
import type { Env, SessionUser } from "./types";

export const DZN_COMMS_TYPING_TTL_SECONDS = 9;
export const DZN_COMMS_TYPING_MIN_REFRESH_SECONDS = 3;
const MAX_TYPERS = 5;
const MAX_REQUEST_BYTES = 512;

type TypingInput = { channelSlug?: unknown; typing?: unknown };
type TypingRow = { display_name: string | null; expires_at: string | null };
type ChannelRow = { id: string | null };

export function readDznCommsTypingFlags(env: Env, request?: Request) {
  const live = readDznCommsLiveFlags(env, request);
  const scope = clean(env.DZN_COMMS_TYPING_SCOPE, 32).toLowerCase();
  const localRequest = request ? isLocalRequest(request) : false;
  const scoped = scope === "production" || (scope === "local_test" && localRequest);
  const readEnabled = live.enabled && scoped && booleanFlag(env.DZN_COMMS_TYPING_READ_ENABLED);
  const writeEnabled = readEnabled && booleanFlag(env.DZN_COMMS_TYPING_WRITE_ENABLED);
  return { readEnabled, writeEnabled, scope, localRequest, liveEnabled: live.enabled };
}

export async function handleDznCommsTyping(request: Request, env: Env) {
  if (request.method === "GET") return readTyping(request, env);
  if (request.method === "POST") return updateTyping(request, env);
  return methodNotAllowed();
}

async function readTyping(request: Request, env: Env) {
  const flags = readDznCommsTypingFlags(env, request);
  if (!flags.readEnabled) return unavailable();
  const channelSlug = channelSlugFromUrl(request);
  if (!channelSlug) return error(400, "INVALID_CHANNEL", "Choose a valid DZN Comms channel.");
  const db = requireDb(env);
  const user = await getSessionUser(env, request);
  const channel = await publicChannel(db, channelSlug);
  if (!channel) return error(404, "CHANNEL_NOT_FOUND", "That DZN Comms channel is unavailable.");
  return json(await typingPayload(db, channelSlug, user?.id ?? null), { headers: privateNoStoreHeaders() });
}

async function updateTyping(request: Request, env: Env) {
  const flags = readDznCommsTypingFlags(env, request);
  if (!flags.writeEnabled) return unavailable();
  if (!sameOrigin(request)) return error(403, "CROSS_ORIGIN", "Cross-origin typing requests are not allowed.");
  const user = await getSessionUser(env, request);
  if (!user) return error(401, "UNAUTHORIZED", "Log in with Discord to show typing activity.");
  const parsed = await readBoundedJson<TypingInput>(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return error(parsed.status, parsed.error, parsed.message);
  if (!exactKeys(parsed.value, ["channelSlug", "typing"]) || typeof parsed.value.typing !== "boolean") {
    return error(400, "INVALID_TYPING", "Typing updates are invalid.");
  }
  const channelSlug = clean(parsed.value.channelSlug, 64).toLowerCase();
  if (!validChannelSlug(channelSlug)) return error(400, "INVALID_CHANNEL", "Choose a valid DZN Comms channel.");
  const db = requireDb(env);
  const channel = await publicChannel(db, channelSlug);
  if (!channel) return error(404, "CHANNEL_NOT_FOUND", "That DZN Comms channel is unavailable.");

  try {
    if (parsed.value.typing) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + DZN_COMMS_TYPING_TTL_SECONDS * 1_000).toISOString();
      const refreshNotBefore = new Date(now.getTime() - DZN_COMMS_TYPING_MIN_REFRESH_SECONDS * 1_000).toISOString();
      await db.prepare(`INSERT INTO dzn_comms_typing_sessions
          (channel_id, actor_user_id, display_name, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(channel_id, actor_user_id) DO UPDATE SET
          display_name = excluded.display_name,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at
        WHERE dzn_comms_typing_sessions.updated_at <= ?`)
        .bind(channel.id, user.id, displayName(user), now.toISOString(), expiresAt, refreshNotBefore).run();
    } else {
      await db.prepare("DELETE FROM dzn_comms_typing_sessions WHERE channel_id = ? AND actor_user_id = ?")
        .bind(channel.id, user.id).run();
    }
  } catch {
    return error(503, "TYPING_STORAGE_UNAVAILABLE", "Typing status could not be updated.");
  }
  return json({ ok: true, channel_slug: channelSlug, typing: parsed.value.typing }, { headers: privateNoStoreHeaders() });
}

async function typingPayload(db: D1Database, channelSlug: string, currentUserId: string | null) {
  const now = new Date().toISOString();
  const rows = await db.prepare(`SELECT typing.display_name, MAX(typing.expires_at) AS expires_at
      FROM dzn_comms_typing_sessions AS typing
      JOIN dzn_comms_channels AS channels ON channels.id = typing.channel_id
      WHERE channels.slug = ?
        AND channels.kind = 'public'
        AND channels.visibility = 'public'
        AND channels.is_readable = 1
        AND typing.expires_at > ?
        AND (? IS NULL OR typing.actor_user_id != ?)
      GROUP BY typing.display_name
      ORDER BY MAX(typing.updated_at) ASC
      LIMIT ?`)
    .bind(channelSlug, now, currentUserId, currentUserId, MAX_TYPERS).all<TypingRow>();
  const typers = (rows.results ?? [])
    .map((row) => ({ display_name: clean(row.display_name, 60), expires_at: clean(row.expires_at, 40) }))
    .filter((row) => Boolean(row.display_name) && Boolean(row.expires_at));
  return {
    ok: true as const,
    channel_slug: channelSlug,
    typers,
    ttl_seconds: DZN_COMMS_TYPING_TTL_SECONDS,
    generated_at: now,
  };
}

async function publicChannel(db: D1Database, channelSlug: string) {
  return db.prepare(`SELECT id FROM dzn_comms_channels
      WHERE slug = ? AND kind = 'public' AND visibility = 'public' AND is_readable = 1
      LIMIT 1`).bind(channelSlug).first<ChannelRow>();
}

function channelSlugFromUrl(request: Request) {
  const value = new URL(request.url).searchParams.get("channel") ?? "global-chat";
  const slug = clean(value, 64).toLowerCase();
  return validChannelSlug(slug) ? slug : "";
}

function validChannelSlug(value: string) { return value === "global-chat"; }
function displayName(user: SessionUser) { return clean(user.username, 60) || "DZN Player"; }
function exactKeys(value: unknown, keys: string[]) { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).sort().join("|") === [...keys].sort().join("|")); }
function clean(value: unknown, max: number) { return typeof value === "string" ? value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max) : ""; }
function booleanFlag(value: unknown) { return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()); }
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); if (!origin) return false; try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; } }
function isLocalRequest(request: Request) { try { const host = new URL(request.url).hostname.toLowerCase(); return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost"); } catch { return false; } }
function unavailable() { return json({ ok: false, code: "DZN_COMMS_TYPING_DISABLED", message: "Typing status is not enabled." }, { status: 404, headers: noStoreForErrorHeaders() }); }
function error(status: number, code: string, message: string) { return json({ ok: false, code, message }, { status, headers: privateNoStoreHeaders() }); }
