export type CommsReactionKey = string;

export type CommsReactionSummary = {
  revision: string;
  available_reactions: { key: CommsReactionKey; emoji: string; label: string }[];
  counts: { key: CommsReactionKey; emoji: string; label: string; count: number; current_user_reacted: boolean }[];
};

export type CommsReactionMutation = {
  revision: string;
  reaction: CommsReactionSummary["counts"][number];
};

export type CommsHistoryMessage = {
  id: string;
  author_display_name: string;
  author_role_label: string;
  author_avatar_url?: string | null;
  body: string;
  visibility_state: "visible" | "hidden" | "deleted" | "quarantined" | "expired";
  created_at: string | null;
  edited_at: string | null;
  public_safe: true;
  read_only: true;
  can_delete: boolean;
  reactions?: CommsReactionSummary;
};

export type CommsChannel = {
  slug: string;
  kind: "public" | "private_group";
  name: string;
  description: string | null;
  visibility: "public" | "private_group";
  current_user_member_role: "owner" | "moderator" | "member" | null;
};

export type CommsHistoryPayload = {
  ok: true;
  generated_at: string;
  read_only: true;
  presentation_only: true;
  channel: Omit<CommsChannel, "current_user_member_role">;
  access: {
    public_channel: boolean;
    private_group_membership_required: boolean;
    current_user_member_role: "owner" | "moderator" | "member" | null;
  };
  available_channels: CommsChannel[];
  messages: CommsHistoryMessage[];
  page: { next_cursor: string | null; has_more: boolean; limit: number };
  feature_flags: {
    route_enabled: boolean;
    sending_enabled: boolean;
    private_groups_enabled: boolean;
    reactions_enabled: boolean;
    reactions_write_enabled: boolean;
    reactions_custom_emoji_enabled: boolean;
    reactions_custom_emoji_write_enabled: boolean;
    typing_enabled: boolean;
    typing_write_enabled: boolean;
    report_actions_enabled: boolean;
    moderation_mutations_enabled: boolean;
    self_delete_enabled: boolean;
  } & Record<(typeof disabledFeatures)[number], false>;
  fairness_boundary: string[];
};

export type CommsTypingPayload = {
  ok: true;
  channel_slug: string;
  typers: { display_name: string; expires_at: string }[];
  ttl_seconds: number;
  generated_at: string;
};

const disabledFeatures = ["ai_assist_runtime_enabled", "durable_objects_or_websockets_enabled",
  "analytics_or_tracking_enabled"] as const;
const reactionCatalog = [
  { key: "heart", emoji: "\u{1F49C}", label: "Heart" },
  { key: "boost", emoji: "\u{1F680}", label: "Boost" },
  { key: "laugh", emoji: "\u{1F602}", label: "Laugh" },
  { key: "salute", emoji: "\u{1FAE1}", label: "Salute" },
  { key: "fire", emoji: "\u{1F525}", label: "Fire" },
  { key: "skull", emoji: "\u{1F480}", label: "Skull" },
] as const;
const reactionByKey = new Map<string, { key: CommsReactionKey; emoji: string; label: string }>(reactionCatalog.map((reaction) => [reaction.key, reaction]));
// Thirty 2,000-code-unit bodies plus bounded metadata must fit even with six-byte JSON escapes.
export const COMMS_HISTORY_MAX_BYTES = 512 * 1_024;
export const COMMS_HISTORY_TIMEOUT_MS = 5_000;
const unavailable = () => new Error("Comms history unavailable");

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || [...value].length > max || (!allowEmpty && !value.trim())) throw unavailable();
  return value;
}

function nullableText(value: unknown, max: number): string | null {
  return value === null ? null : text(value, max, true);
}

function timestamp(value: unknown): string | null {
  if (value === null) return null;
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result))) throw unavailable();
  return result;
}

function channelSlug(value: unknown): string {
  const slug = text(value, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(slug)) throw unavailable();
  return slug;
}

function memberRole(value: unknown): CommsChannel["current_user_member_role"] {
  if (value === null || value === "owner" || value === "moderator" || value === "member") return value;
  throw unavailable();
}

function projectChannel(value: unknown): CommsChannel {
  const input = record(value);
  const kind = input.kind;
  const visibility = input.visibility;
  if ((kind !== "public" && kind !== "private_group") || visibility !== kind) throw unavailable();
  const role = memberRole(input.current_user_member_role);
  if ((kind === "public" && (input.slug !== "global-chat" || role !== null)) || (kind === "private_group" && role === null)) throw unavailable();
  return {
    slug: channelSlug(input.slug),
    kind,
    name: text(input.name, 80),
    description: nullableText(input.description, 180),
    visibility: kind,
    current_user_member_role: role,
  };
}

function reactionSummary(value: unknown, customEmojiEnabled: boolean): CommsReactionSummary {
  const input = record(value);
  const revision = text(input.revision, 40);
  if (!Array.isArray(input.available_reactions) || input.available_reactions.length > reactionCatalog.length
    || !Array.isArray(input.counts) || input.counts.length > 24) throw unavailable();
  const available = input.available_reactions.map((value) => {
    return reactionEntry(value, customEmojiEnabled);
  });
  if (new Set(available.map((reaction) => reaction.key)).size !== available.length) throw unavailable();
  const keys = new Set<CommsReactionKey>();
  const counts = input.counts.map((value) => {
    const row = record(value), reaction = reactionEntry(row, customEmojiEnabled), key = reaction.key;
    if (keys.has(key)
      || !Number.isSafeInteger(row.count) || Number(row.count) < 1 || row.current_user_reacted !== Boolean(row.current_user_reacted)) throw unavailable();
    keys.add(key);
    return { ...reaction, count: Number(row.count), current_user_reacted: row.current_user_reacted as boolean };
  });
  return { revision, available_reactions: available, counts };
}

function reactionEntry(value: unknown, customEmojiEnabled: boolean): { key: CommsReactionKey; emoji: string; label: string } {
  const row = record(value), key = text(row.key, 64) as CommsReactionKey, emoji = text(row.emoji, 32), label = text(row.label, 24);
  const legacy = reactionByKey.get(key);
  if (legacy) {
    if (emoji !== legacy.emoji || label !== legacy.label) throw unavailable();
    return { ...legacy };
  }
  if (!customEmojiEnabled || !isCustomEmojiKey(key, emoji) || label !== "Emoji") throw unavailable();
  return { key, emoji, label };
}

function isCustomEmojiKey(key: string, emoji: string) {
  if (!/^emoji:[0-9a-f]{1,6}(?:-[0-9a-f]{1,6}){0,15}$/.test(key)) return false;
  try {
    const normalized = emoji.normalize("NFC");
    const codePoints = [...normalized];
    const isKeycap = /^[0-9#*]\uFE0F?\u20E3$/u.test(normalized);
    const isEmojiSequence = /^[\p{Extended_Pictographic}\p{Emoji_Component}\p{Regional_Indicator}\u200D\uFE0E\uFE0F\u20E3]+$/u.test(normalized);
    const hasVisibleEmoji = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(normalized) || isKeycap;
    return codePoints.length > 0 && codePoints.length <= 16 && isEmojiSequence && hasVisibleEmoji
      && `emoji:${codePoints.map((part) => part.codePointAt(0)!.toString(16)).join("-")}` === key;
  } catch {
    return false;
  }
}

// Project only public Global Chat or an explicitly membership-scoped private group.
export function parseCommsHistory(value: unknown): CommsHistoryPayload {
  const input = record(value), channel = record(input.channel), access = record(input.access), flags = record(input.feature_flags), page = record(input.page);
  const kind = channel.kind;
  const visibility = channel.visibility;
  const role = memberRole(access.current_user_member_role);
  const isPublic = kind === "public" && visibility === "public" && channel.slug === "global-chat";
  const isPrivate = kind === "private_group" && visibility === "private_group" && role !== null;
  if (input.ok !== true || input.read_only !== true || input.presentation_only !== true
    || (!isPublic && !isPrivate)
    || access.public_channel !== isPublic || access.private_group_membership_required !== isPrivate
    || flags.route_enabled !== true || typeof flags.private_groups_enabled !== "boolean"
    || typeof flags.sending_enabled !== "boolean" || typeof flags.report_actions_enabled !== "boolean"
    || typeof flags.reactions_enabled !== "boolean" || typeof flags.reactions_write_enabled !== "boolean"
    || typeof flags.reactions_custom_emoji_enabled !== "boolean" || typeof flags.reactions_custom_emoji_write_enabled !== "boolean"
    || typeof flags.typing_enabled !== "boolean" || typeof flags.typing_write_enabled !== "boolean"
    || typeof flags.moderation_mutations_enabled !== "boolean" || typeof flags.self_delete_enabled !== "boolean"
    || (flags.reactions_write_enabled === true && flags.reactions_enabled !== true)
    || (flags.reactions_custom_emoji_enabled === true && flags.reactions_enabled !== true)
    || (flags.reactions_custom_emoji_write_enabled === true && (flags.reactions_custom_emoji_enabled !== true || flags.reactions_write_enabled !== true))
    || (flags.typing_write_enabled === true && flags.typing_enabled !== true)
    || flags.report_actions_enabled !== flags.sending_enabled
    || flags.moderation_mutations_enabled !== flags.sending_enabled
    || (isPrivate && flags.private_groups_enabled !== true)
    || disabledFeatures.some(key => flags[key] !== false)
    || typeof page.has_more !== "boolean" || !Number.isSafeInteger(page.limit) || Number(page.limit) < 1 || Number(page.limit) > 50
    || (page.next_cursor !== null && (typeof page.next_cursor !== "string" || !/^[A-Za-z0-9_-]{8,1024}$/.test(page.next_cursor)))
    || (page.has_more !== (page.next_cursor !== null))) throw unavailable();
  const generatedAt = timestamp(input.generated_at);
  if (!generatedAt || !Array.isArray(input.messages) || input.messages.length > 30
    || !Array.isArray(input.available_channels) || input.available_channels.length > 21
    || !Array.isArray(input.fairness_boundary) || input.fairness_boundary.length > 8) throw unavailable();
  const availableChannels = input.available_channels.map(projectChannel);
  const availableSlugs = new Set(availableChannels.map((item) => item.slug));
  const selectedAvailable = availableChannels.find((item) => item.slug === channel.slug);
  if (availableSlugs.size !== availableChannels.length || !selectedAvailable
    || selectedAvailable.kind !== kind || selectedAvailable.current_user_member_role !== role
    || (flags.private_groups_enabled !== true && availableChannels.some((item) => item.kind === "private_group"))) throw unavailable();
  const ids = new Set<string>();
  const messages = input.messages.map((value): CommsHistoryMessage => {
    const row = record(value), id = text(row.id, 120);
    if (ids.has(id) || row.public_safe !== true || row.read_only !== true || typeof row.can_delete !== "boolean") throw unavailable();
    ids.add(id);
    const state = row.visibility_state;
    if (state !== "visible" && state !== "hidden" && state !== "deleted" && state !== "quarantined") throw unavailable();
    const name = text(row.author_display_name, 60), role = text(row.author_role_label, 24), body = text(row.body, 2_000, true);
    const placeholder = state === "deleted" ? "Message deleted." : state === "quarantined"
      ? "Message unavailable while DZN Safety reviews it." : "Message hidden by DZN Safety.";
    const reactions = flags.reactions_enabled === true && state === "visible"
      ? reactionSummary(row.reactions, flags.reactions_custom_emoji_enabled === true)
      : undefined;
    if (reactions === undefined && row.reactions !== undefined) throw unavailable();
    const authorAvatarUrl = state === "visible" ? discordAvatarUrl(row.author_avatar_url) : null;
    return {
      id, visibility_state: state, public_safe: true as const, read_only: true as const,
      can_delete: state === "visible" && row.can_delete === true,
      author_display_name: state === "visible" ? name : "DZN Safety",
      author_role_label: state === "visible" ? role : "System",
      ...(authorAvatarUrl ? { author_avatar_url: authorAvatarUrl } : {}),
      body: state === "visible" ? body : placeholder,
      created_at: timestamp(row.created_at), edited_at: timestamp(row.edited_at),
      ...(reactions ? { reactions } : {}),
    };
  });
  const boundary = input.fairness_boundary.map(value => text(value, 1_000));
  if (new Set(boundary).size !== boundary.length) throw unavailable();
  return {
    ok: true, generated_at: generatedAt, read_only: true, presentation_only: true,
    channel: { slug: channelSlug(channel.slug), kind: kind as CommsChannel["kind"], visibility: visibility as CommsChannel["visibility"], name: text(channel.name, 80), description: nullableText(channel.description, 180) },
    access: { public_channel: isPublic, private_group_membership_required: isPrivate, current_user_member_role: role },
    available_channels: availableChannels,
    messages,
    page: { next_cursor: page.next_cursor as string | null, has_more: page.has_more as boolean, limit: Number(page.limit) },
    feature_flags: {
      route_enabled: true, sending_enabled: flags.sending_enabled, private_groups_enabled: flags.private_groups_enabled,
      reactions_enabled: flags.reactions_enabled, reactions_write_enabled: flags.reactions_write_enabled,
      reactions_custom_emoji_enabled: flags.reactions_custom_emoji_enabled,
      reactions_custom_emoji_write_enabled: flags.reactions_custom_emoji_write_enabled,
      typing_enabled: flags.typing_enabled, typing_write_enabled: flags.typing_write_enabled,
      report_actions_enabled: flags.report_actions_enabled, moderation_mutations_enabled: flags.moderation_mutations_enabled,
      self_delete_enabled: flags.self_delete_enabled,
      ai_assist_runtime_enabled: false, durable_objects_or_websockets_enabled: false, analytics_or_tracking_enabled: false,
    },
    fairness_boundary: boundary,
  };
}

function discordAvatarUrl(value: unknown) {
  return typeof value === "string" && /^\/api\/public\/players\/[a-z0-9][a-z0-9-]{1,46}[a-z0-9]\/avatar$/.test(value)
    ? value
    : null;
}

async function readResponse(response: Response, signal: AbortSignal): Promise<CommsHistoryPayload> {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  let complete = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const declaredLength = response.headers.get("content-length");
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
      || (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > COMMS_HISTORY_MAX_BYTES))) throw unavailable();
    let size = 0, body = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > COMMS_HISTORY_MAX_BYTES) throw unavailable();
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    complete = true;
    return parseCommsHistory(JSON.parse(body));
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}

export async function loadCommsHistory(signal: AbortSignal, options: { fetcher?: typeof fetch; timeoutMs?: number; channelSlug?: string; cursor?: string } = {}): Promise<CommsHistoryPayload> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let rejectAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(unavailable()); });
  controller.signal.addEventListener("abort", rejectAbort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? COMMS_HISTORY_TIMEOUT_MS);
  try {
    controller.signal.throwIfAborted();
    const request = (async () => {
      const selectedChannel = channelSlug(options.channelSlug ?? "global-chat");
      const cursor = options.cursor === undefined ? null : historyCursor(options.cursor);
      const query = new URLSearchParams({ channel: selectedChannel, limit: "30" });
      if (cursor) query.set("cursor", cursor);
      const response = await (options.fetcher ?? fetch)(`/api/comms/message-history?${query.toString()}`, {
        method: "GET", cache: "no-store", credentials: "include", redirect: "error", headers: { accept: "application/json" }, signal: controller.signal,
      });
      return readResponse(response, controller.signal);
    })();
    return await Promise.race([request, aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}

function historyCursor(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,1024}$/.test(value)) throw unavailable();
  return value;
}

async function requestCommsMutation(method: "POST" | "DELETE", path: string, body: unknown, fallbackMessage: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMMS_HISTORY_TIMEOUT_MS);
  let response: Response;
  let payload: Record<string, unknown> | null;
  try {
    response = await fetch(path, {
      method, credentials: "include", redirect: "error",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    });
    const parsed = await response.json().catch(() => null);
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    throw new Error(fallbackMessage);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok || payload?.ok !== true) throw new Error(typeof payload?.message === "string" ? payload.message : fallbackMessage);
  return payload;
}

async function postCommsMutation(path: string, body: unknown, fallbackMessage: string) {
  return requestCommsMutation("POST", path, body, fallbackMessage);
}

export async function sendCommsMessage(channel: string, body: string, clientRequestId: string) {
  await postCommsMutation("/api/comms/messages", { channelSlug: channelSlug(channel), clientRequestId, body }, "Message could not be sent.");
}

export async function reportCommsMessage(messageId: string, reason = "other") {
  await postCommsMutation("/api/comms/reports", { messageId, reason }, "Report could not be sent.");
}

export async function deleteCommsMessage(messageId: string) {
  await requestCommsMutation("DELETE", `/api/comms/messages/${encodeURIComponent(messageId)}`, {}, "Message could not be deleted.");
}

export async function addCommsReaction(messageId: string, reactionKey: CommsReactionKey, clientMutationId: string) {
  return parseCommsReactionMutation(await requestCommsMutation("POST", `/api/comms/messages/${encodeURIComponent(messageId)}/reactions`,
    { reactionKey, clientMutationId }, "Reaction could not be saved."));
}

export async function removeCommsReaction(messageId: string, reactionKey: CommsReactionKey, clientMutationId: string) {
  return parseCommsReactionMutation(await requestCommsMutation("DELETE", `/api/comms/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(reactionKey)}`,
    { clientMutationId }, "Reaction could not be removed."));
}

function parseCommsReactionMutation(value: unknown): CommsReactionMutation {
  const input = record(value);
  const revision = text(input.revision, 40);
  const reactionInput = record(input.reaction);
  const reaction = reactionEntry(reactionInput, true);
  const count = reactionInput.count;
  const currentUserReacted = reactionInput.current_user_reacted;
  if (!Number.isSafeInteger(count) || Number(count) < 0 || currentUserReacted !== Boolean(currentUserReacted)) throw unavailable();
  return { revision, reaction: { ...reaction, count: Number(count), current_user_reacted: currentUserReacted as boolean } };
}

export async function setCommsTyping(channel: string, typing: boolean) {
  await postCommsMutation("/api/comms/typing", { channelSlug: channelSlug(channel), typing }, "Typing status could not be updated.");
}

export async function loadCommsTyping(signal: AbortSignal, channel = "global-chat", fetcher: typeof fetch = fetch): Promise<CommsTypingPayload> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, COMMS_HISTORY_TIMEOUT_MS);
  try {
    const response = await fetcher(`/api/comms/typing?${new URLSearchParams({ channel: channelSlug(channel) }).toString()}`, {
      method: "GET", cache: "no-store", credentials: "include", redirect: "error", headers: { accept: "application/json" }, signal: controller.signal,
    });
    const length = response.headers.get("content-length");
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
      || (length !== null && (!/^\d+$/.test(length) || Number(length) > 8_192))) throw unavailable();
    return parseCommsTyping(await response.json());
  } catch {
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

function parseCommsTyping(value: unknown): CommsTypingPayload {
  const input = record(value);
  const channel = channelSlug(input.channel_slug);
  if (input.ok !== true || channel !== "global-chat" || !Array.isArray(input.typers)
    || input.typers.length > 5 || !Number.isSafeInteger(input.ttl_seconds)
    || Number(input.ttl_seconds) < 3 || Number(input.ttl_seconds) > 30) throw unavailable();
  const names = new Set<string>();
  const typers = input.typers.map((value) => {
    const row = record(value), displayName = text(row.display_name, 60), expiresAt = timestamp(row.expires_at);
    if (!expiresAt || names.has(displayName)) throw unavailable();
    names.add(displayName);
    return { display_name: displayName, expires_at: expiresAt };
  });
  const generatedAt = timestamp(input.generated_at);
  if (!generatedAt) throw unavailable();
  return { ok: true, channel_slug: channel, typers, ttl_seconds: Number(input.ttl_seconds), generated_at: generatedAt };
}
