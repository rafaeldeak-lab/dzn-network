export type CommsHistoryMessage = {
  id: string;
  author_display_name: string;
  author_role_label: string;
  body: string;
  visibility_state: "visible" | "hidden" | "deleted" | "quarantined" | "expired";
  created_at: string | null;
  edited_at: string | null;
  public_safe: true;
  read_only: true;
};

export type CommsHistoryPayload = {
  ok: true;
  generated_at: string;
  read_only: true;
  presentation_only: true;
  channel: { slug: string; kind: "public"; name: string; description: string | null; visibility: "public" };
  access: { public_channel: true; private_group_membership_required: false; current_user_member_role: null };
  messages: CommsHistoryMessage[];
  feature_flags: { route_enabled: boolean } & Record<(typeof disabledFeatures)[number], false>;
  fairness_boundary: string[];
};

const disabledFeatures = ["sending_enabled", "reactions_enabled", "report_actions_enabled",
  "moderation_mutations_enabled", "ai_assist_runtime_enabled", "durable_objects_or_websockets_enabled",
  "analytics_or_tracking_enabled"] as const;
// Thirty 2,000-code-unit bodies plus bounded metadata must fit even with six-byte JSON escapes.
export const COMMS_HISTORY_MAX_BYTES = 512 * 1_024;
export const COMMS_HISTORY_TIMEOUT_MS = 5_000;
const unavailable = () => new Error("Comms history unavailable");

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) throw unavailable();
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

// Project only the current public channel contract. Never pass an arbitrary response through to JSX.
export function parseCommsHistory(value: unknown): CommsHistoryPayload {
  const input = record(value), channel = record(input.channel), access = record(input.access), flags = record(input.feature_flags);
  if (input.ok !== true || input.read_only !== true || input.presentation_only !== true
    || channel.slug !== "global-chat" || channel.kind !== "public" || channel.visibility !== "public"
    || access.public_channel !== true || access.private_group_membership_required !== false
    || access.current_user_member_role !== null || flags.route_enabled !== true
    || disabledFeatures.some(key => flags[key] !== false)) throw unavailable();
  const generatedAt = timestamp(input.generated_at);
  if (!generatedAt || !Array.isArray(input.messages) || input.messages.length > 30
    || !Array.isArray(input.fairness_boundary) || input.fairness_boundary.length > 8) throw unavailable();
  const ids = new Set<string>();
  const messages = input.messages.map((value): CommsHistoryMessage => {
    const row = record(value), id = text(row.id, 120);
    if (ids.has(id) || row.public_safe !== true || row.read_only !== true) throw unavailable();
    ids.add(id);
    const state = row.visibility_state;
    if (state !== "visible" && state !== "hidden" && state !== "deleted" && state !== "quarantined") throw unavailable();
    const name = text(row.author_display_name, 60), role = text(row.author_role_label, 24), body = text(row.body, 2_000, true);
    const placeholder = state === "deleted" ? "Message deleted." : state === "quarantined"
      ? "Message unavailable while DZN Safety reviews it." : "Message hidden by DZN Safety.";
    return {
      id, visibility_state: state, public_safe: true as const, read_only: true as const,
      author_display_name: state === "visible" ? name : "DZN Safety",
      author_role_label: state === "visible" ? role : "System",
      body: state === "visible" ? body : placeholder,
      created_at: timestamp(row.created_at), edited_at: timestamp(row.edited_at),
    };
  });
  const boundary = input.fairness_boundary.map(value => text(value, 1_000));
  if (new Set(boundary).size !== boundary.length) throw unavailable();
  return {
    ok: true, generated_at: generatedAt, read_only: true, presentation_only: true,
    channel: { slug: "global-chat", kind: "public", visibility: "public", name: text(channel.name, 80), description: nullableText(channel.description, 180) },
    access: { public_channel: true, private_group_membership_required: false, current_user_member_role: null },
    messages,
    feature_flags: {
      route_enabled: true, sending_enabled: false, reactions_enabled: false, report_actions_enabled: false,
      moderation_mutations_enabled: false, ai_assist_runtime_enabled: false,
      durable_objects_or_websockets_enabled: false, analytics_or_tracking_enabled: false,
    },
    fairness_boundary: boundary,
  };
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

export async function loadCommsHistory(signal: AbortSignal, options: { fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<CommsHistoryPayload> {
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
      const response = await (options.fetcher ?? fetch)("/api/comms/message-history?channel=global-chat&limit=30", {
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
