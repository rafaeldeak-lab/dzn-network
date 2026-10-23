export type DznAssistLocalHistoryMessage = {
  id: string;
  role: "assist" | "visitor";
  text: string;
  guideIds?: string[];
  replyKind?: DznAssistLocalHistoryReplyKind;
};

export type DznAssistLocalHistoryReplyKind = "boundary" | "fallback" | "guidance" | "ranking";

type DznAssistLocalHistoryInput = Pick<DznAssistLocalHistoryMessage, "role" | "text" | "guideIds" | "replyKind"> & {
  excludeFromLocalHistory?: boolean;
};

export const DZN_ASSIST_LOCAL_HISTORY_STORAGE_KEY = "dzn-assist.local-history.v1";
const HISTORY_VERSION = 2;
const MAX_HISTORY_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_GUIDE_IDS = 8;
const GUIDE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseDznAssistLocalHistory(value: unknown): DznAssistLocalHistoryMessage[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const payload = value as Record<string, unknown>;
  if (payload.version !== HISTORY_VERSION || !Array.isArray(payload.messages) || payload.messages.length > MAX_HISTORY_MESSAGES) return [];

  const messages: DznAssistLocalHistoryMessage[] = [];
  for (const item of payload.messages) {
    const message = parseMessage(item);
    if (!message) return [];
    messages.push({ ...message, id: `dzn-assist-history-${messages.length + 1}` });
  }
  return messages;
}

export function serializeDznAssistLocalHistory(messages: readonly DznAssistLocalHistoryInput[]): string | null {
  const saved = messages
    .slice(-MAX_HISTORY_MESSAGES)
    .filter((message) => !message.excludeFromLocalHistory && (message.role !== "assist" || message.replyKind !== undefined))
    .map((message) => parseMessage(message))
    .filter((message): message is Omit<DznAssistLocalHistoryMessage, "id"> => message !== null);
  if (saved.length === 0) return null;
  return JSON.stringify({ version: HISTORY_VERSION, messages: saved });
}

function parseMessage(value: unknown): Omit<DznAssistLocalHistoryMessage, "id"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if ((message.role !== "assist" && message.role !== "visitor") || !validText(message.text)) return null;
  const guideIds = parseGuideIds(message.guideIds);
  const replyKind = parseReplyKind(message.replyKind);
  if (guideIds === null || replyKind === null || (message.role === "assist" && !replyKind) || (message.role === "visitor" && replyKind)) return null;
  return {
    role: message.role,
    text: message.text,
    ...(guideIds.length > 0 ? { guideIds } : {}),
    ...(replyKind ? { replyKind } : {}),
  };
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= MAX_MESSAGE_LENGTH;
}

function parseGuideIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_GUIDE_IDS) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !GUIDE_ID_PATTERN.test(item) || ids.includes(item)) return null;
    ids.push(item);
  }
  return ids;
}

function parseReplyKind(value: unknown): DznAssistLocalHistoryReplyKind | undefined | null {
  if (value === undefined) return undefined;
  return value === "boundary" || value === "fallback" || value === "guidance" || value === "ranking"
    ? value
    : null;
}
