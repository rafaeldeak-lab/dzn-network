export const DZN_COMMS_MESSAGE_HISTORY_UI_FLAG = "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED";
export const DZN_COMMS_MESSAGE_HISTORY_ROUTE_PREFIX = "/api/dzn-comms/channels";
export const DZN_COMMS_MESSAGE_HISTORY_LIMIT = 25;
export const DZN_COMMS_MESSAGE_HISTORY_TIMEOUT_MS = 5_000;
export const DZN_COMMS_MESSAGE_HISTORY_MAX_PAYLOAD_BYTES = 128_000;

export type DznCommsMessageHistorySurfaceKey =
  | "global"
  | "new_players"
  | "server_owners"
  | "events"
  | "pandora_squad"
  | "support";

export type DznCommsMessageHistoryFallbackReason =
  | "client-flag-disabled"
  | "support-static"
  | "invalid-cursor"
  | "login-required"
  | "private-denied"
  | "disabled-or-not-configured"
  | "unavailable"
  | "timeout"
  | "network-error"
  | "malformed-response"
  | "overlarge-response";

export type DznCommsMessageHistoryUiState =
  | {
      status: "static";
      reason: "client-flag-disabled" | "support-static";
      label: string;
      detail: string;
      canRetry: false;
    }
  | {
      status: "loading";
      label: string;
      detail: string;
      canRetry: false;
    }
  | {
      status: "live";
      label: string;
      detail: string;
      canRetry: true;
      generatedAt: string;
      nextCursor: string | null;
      messages: DznCommsMessageHistoryMessage[];
    }
  | {
      status: "fallback";
      reason: Exclude<DznCommsMessageHistoryFallbackReason, "client-flag-disabled" | "support-static">;
      label: string;
      detail: string;
      canRetry: boolean;
      httpStatus?: number;
      error?: string;
    };

export type DznCommsMessageHistoryMessage = {
  id: string;
  visibility: "visible" | "locked";
  createdAt: string;
  author: {
    displayName: string;
    roleLabel: string | null;
    avatarInitials: string;
    profileHref: null;
  };
  body: string;
  replyToMessageId: string | null;
  presentation: {
    kind: "user_message" | "system_notice" | "pinned_guidance" | "safety_notice";
  };
};

export type DznCommsMessageHistoryPayload = {
  ok: true;
  status: "ok";
  private: true;
  cache: "no-store";
  generated_at: string;
  channel: {
    id: string;
    type: "public" | "private_group";
    readOnly: true;
  };
  messages: DznCommsMessageHistoryMessage[];
  page: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    direction: "older" | "newer";
  };
  safety: {
    read_only: true;
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
};

type DznCommsMessageHistoryErrorPayload = {
  ok?: false;
  error?: unknown;
  message?: unknown;
};

export type DznCommsMessageHistoryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const DZN_COMMS_MESSAGE_HISTORY_CHANNEL_IDS: Record<
  Exclude<DznCommsMessageHistorySurfaceKey, "support">,
  string
> = {
  global: "global",
  new_players: "new-players",
  server_owners: "server-owners",
  events: "events",
  pandora_squad: "pandora-squad",
};

const APPROVED_ROLE_LABELS = new Set(["Owner", "Mod", "VIP", "Member", "AI", "Website Support"]);
const APPROVED_MESSAGE_KINDS = new Set(["user_message", "system_notice", "pinned_guidance", "safety_notice"]);
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,120}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;

export function isDznCommsMessageHistoryUiEnabled(value = process.env.NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED) {
  return value?.trim().toLowerCase() === "true";
}

export function dznCommsMessageHistoryChannelId(surfaceKey: DznCommsMessageHistorySurfaceKey) {
  if (surfaceKey === "support") return null;
  return DZN_COMMS_MESSAGE_HISTORY_CHANNEL_IDS[surfaceKey] ?? null;
}

export function dznCommsMessageHistoryUrl(
  surfaceKey: DznCommsMessageHistorySurfaceKey,
  options: { cursor?: string | null; direction?: "older" | "newer" } = {},
) {
  const channelId = dznCommsMessageHistoryChannelId(surfaceKey);
  if (!channelId) return null;

  const params = new URLSearchParams({ limit: String(DZN_COMMS_MESSAGE_HISTORY_LIMIT) });
  if (options.cursor && CURSOR_PATTERN.test(options.cursor)) {
    params.set("cursor", options.cursor);
    params.set("direction", options.direction === "newer" ? "newer" : "older");
  }

  return `${DZN_COMMS_MESSAGE_HISTORY_ROUTE_PREFIX}/${encodeURIComponent(channelId)}/messages?${params.toString()}`;
}

export function dznCommsMessageHistoryStaticState(
  reason: "client-flag-disabled" | "support-static",
): DznCommsMessageHistoryUiState {
  if (reason === "support-static") {
    return {
      status: "static",
      reason,
      label: "Static support preview",
      detail: "Support stays static until a separate DZN Assist runtime is approved.",
      canRetry: false,
    };
  }

  return {
    status: "static",
    reason,
    label: "Static preview active",
    detail: "Saved history is disabled by default. No message-history request is made.",
    canRetry: false,
  };
}

export function dznCommsMessageHistoryLoadingState(): DznCommsMessageHistoryUiState {
  return {
    status: "loading",
    label: "Syncing saved history",
    detail: "Read-only local/test message history is loading. The static shell stays mounted.",
    canRetry: false,
  };
}

export async function loadDznCommsMessageHistory({
  surfaceKey,
  fetcher = fetch,
  timeoutMs = DZN_COMMS_MESSAGE_HISTORY_TIMEOUT_MS,
}: {
  surfaceKey: DznCommsMessageHistorySurfaceKey;
  fetcher?: DznCommsMessageHistoryFetch;
  timeoutMs?: number;
}): Promise<DznCommsMessageHistoryUiState> {
  const url = dznCommsMessageHistoryUrl(surfaceKey);
  if (!url) return dznCommsMessageHistoryStaticState("support-static");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const raw = await response.text();
    if (raw.length > DZN_COMMS_MESSAGE_HISTORY_MAX_PAYLOAD_BYTES) {
      return fallbackState("overlarge-response", response.status);
    }

    const parsed = parseJson(raw);
    if (!response.ok) return fallbackForStatus(response.status, parsed);

    const payload = validateDznCommsMessageHistoryPayload(parsed);
    if (!payload) return fallbackState("malformed-response", response.status);

    return {
      status: "live",
      label: "Saved history synced",
      detail: `${payload.messages.length} read-only message${payload.messages.length === 1 ? "" : "s"} loaded from DZN Comms.`,
      canRetry: true,
      generatedAt: payload.generated_at,
      nextCursor: payload.page.nextCursor,
      messages: payload.messages,
    };
  } catch (error) {
    return fallbackState(isAbortError(error) ? "timeout" : "network-error");
  } finally {
    clearTimeout(timeout);
  }
}

export function validateDznCommsMessageHistoryPayload(value: unknown): DznCommsMessageHistoryPayload | null {
  if (!isObject(value)) return null;
  if (value.ok !== true || value.status !== "ok" || value.private !== true || value.cache !== "no-store") return null;
  if (typeof value.generated_at !== "string" || !Number.isFinite(Date.parse(value.generated_at))) return null;
  if (!isObject(value.channel) || value.channel.readOnly !== true) return null;
  if (value.channel.type !== "public" && value.channel.type !== "private_group") return null;
  if (!Array.isArray(value.messages) || value.messages.length > DZN_COMMS_MESSAGE_HISTORY_LIMIT) return null;
  if (!isObject(value.page)) return null;
  if (value.page.nextCursor !== null && typeof value.page.nextCursor !== "string") return null;
  if (typeof value.page.limit !== "number" || value.page.limit > DZN_COMMS_MESSAGE_HISTORY_LIMIT) return null;
  if (value.page.direction !== "older" && value.page.direction !== "newer") return null;
  if (!hasSafeReadOnlyFlags(value.safety)) return null;

  const messages = value.messages.map(validateHistoryMessage);
  if (messages.some((message) => !message)) return null;

  return {
    ok: true,
    status: "ok",
    private: true,
    cache: "no-store",
    generated_at: value.generated_at,
    channel: {
      id: String(value.channel.id ?? ""),
      type: value.channel.type,
      readOnly: true,
    },
    messages: messages as DznCommsMessageHistoryMessage[],
    page: {
      nextCursor: value.page.nextCursor,
      hasMore: value.page.hasMore === true,
      limit: value.page.limit,
      direction: value.page.direction,
    },
    safety: value.safety as DznCommsMessageHistoryPayload["safety"],
  };
}

function validateHistoryMessage(value: unknown): DznCommsMessageHistoryMessage | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== "string" || !MESSAGE_ID_PATTERN.test(value.id)) return null;
  if (value.visibility !== "visible" && value.visibility !== "locked") return null;
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return null;
  if (typeof value.body !== "string" || value.body.length > 4_000) return null;
  if (value.replyToMessageId !== null && (typeof value.replyToMessageId !== "string" || !MESSAGE_ID_PATTERN.test(value.replyToMessageId))) return null;
  if (!isObject(value.author)) return null;
  if (typeof value.author.displayName !== "string" || value.author.displayName.length < 1 || value.author.displayName.length > 80) return null;
  if (value.author.roleLabel !== null && (typeof value.author.roleLabel !== "string" || !APPROVED_ROLE_LABELS.has(value.author.roleLabel))) return null;
  if (typeof value.author.avatarInitials !== "string" || !/^[A-Z0-9]{1,3}$/.test(value.author.avatarInitials)) return null;
  if (value.author.profileHref !== null) return null;
  if (!isObject(value.presentation) || typeof value.presentation.kind !== "string" || !APPROVED_MESSAGE_KINDS.has(value.presentation.kind)) return null;

  return {
    id: value.id,
    visibility: value.visibility,
    createdAt: new Date(Date.parse(value.createdAt)).toISOString(),
    author: {
      displayName: value.author.displayName,
      roleLabel: value.author.roleLabel,
      avatarInitials: value.author.avatarInitials,
      profileHref: null,
    },
    body: value.body,
    replyToMessageId: value.replyToMessageId,
    presentation: {
      kind: value.presentation.kind as DznCommsMessageHistoryMessage["presentation"]["kind"],
    },
  };
}

function fallbackForStatus(status: number, payload: unknown): DznCommsMessageHistoryUiState {
  if (status === 400) return fallbackState("invalid-cursor", status, payload);
  if (status === 401) return fallbackState("login-required", status, payload);
  if (status === 403) return fallbackState("private-denied", status, payload);
  if (status === 404) return fallbackState("disabled-or-not-configured", status, payload);
  return fallbackState("unavailable", status, payload);
}

function fallbackState(
  reason: Exclude<DznCommsMessageHistoryFallbackReason, "client-flag-disabled" | "support-static">,
  httpStatus?: number,
  payload?: unknown,
): DznCommsMessageHistoryUiState {
  const error = isObject(payload) && typeof (payload as DznCommsMessageHistoryErrorPayload).error === "string"
    ? String((payload as DznCommsMessageHistoryErrorPayload).error)
    : undefined;
  const labels: Record<typeof reason, { label: string; detail: string; canRetry: boolean }> = {
    "invalid-cursor": {
      label: "Saved history reset",
      detail: "The history cursor was rejected. Static preview is shown instead.",
      canRetry: true,
    },
    "login-required": {
      label: "Log in to read saved history",
      detail: "Static preview remains visible. Discord login is required for saved message history.",
      canRetry: false,
    },
    "private-denied": {
      label: "Private group history unavailable",
      detail: "This account does not have trusted private group membership for saved history.",
      canRetry: false,
    },
    "disabled-or-not-configured": {
      label: "Static preview active",
      detail: "Saved history is disabled or not configured. Static preview is shown.",
      canRetry: false,
    },
    unavailable: {
      label: "Saved history unavailable",
      detail: "The read-only message history route is unavailable. Static preview is shown.",
      canRetry: true,
    },
    timeout: {
      label: "History timed out",
      detail: "The read-only request took too long. Static preview is shown.",
      canRetry: true,
    },
    "network-error": {
      label: "Saved history unavailable",
      detail: "The network request failed. Static preview is shown.",
      canRetry: true,
    },
    "malformed-response": {
      label: "Saved history unavailable",
      detail: "The route returned an unexpected response. Static preview is shown.",
      canRetry: true,
    },
    "overlarge-response": {
      label: "Saved history unavailable",
      detail: "The route returned more data than the UI accepts. Static preview is shown.",
      canRetry: true,
    },
  };

  return {
    status: "fallback",
    reason,
    httpStatus,
    error,
    ...labels[reason],
  };
}

function hasSafeReadOnlyFlags(value: unknown) {
  if (!isObject(value)) return false;
  return (
    value.read_only === true &&
    value.no_message_sending === true &&
    value.no_reaction_runtime === true &&
    value.no_report_routes === true &&
    value.no_moderation_mutations === true &&
    value.no_dzn_assist_ai_runtime === true &&
    value.no_durable_objects === true &&
    value.no_websockets === true &&
    value.no_analytics_tracking === true &&
    value.no_store_payment_changes === true &&
    value.no_live_checkout === true &&
    value.no_production_mutations === true &&
    value.no_retained_exports === true &&
    value.billing_effect === false &&
    value.owner_entitlement_effect === false &&
    value.ranking_effect === false &&
    value.discovery_effect === false &&
    value.review_effect === false &&
    value.badge_effect === false &&
    value.season_effect === false &&
    value.event_effect === false &&
    value.server_wars_effect === false &&
    value.ctf_effect === false &&
    value.xp_award_effect === false &&
    value.calling_card_award_effect === false &&
    value.public_profile_visibility_effect === false &&
    value.competitive_eligibility_effect === false
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isAbortError(error: unknown) {
  return isObject(error) && "name" in error && error.name === "AbortError";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
