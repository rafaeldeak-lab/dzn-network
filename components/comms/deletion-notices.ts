import type { CommsHistoryMessage } from "./comms-history-client";

export type DeletionNotice = {
  channelSlug: string;
  message: CommsHistoryMessage;
};

function historyTimestamp(value: string | null) {
  if (value === null) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function insertNoticeChronologically(messages: CommsHistoryMessage[], notice: CommsHistoryMessage) {
  const noticeTimestamp = historyTimestamp(notice.created_at);
  if (noticeTimestamp === null) {
    messages.push(notice);
    return;
  }
  const insertAt = messages.findIndex((message) => {
    const messageTimestamp = historyTimestamp(message.created_at);
    return messageTimestamp !== null && (
      messageTimestamp > noticeTimestamp
      || (messageTimestamp === noticeTimestamp && message.id > notice.id)
    );
  });
  if (insertAt === -1) messages.push(notice);
  else messages.splice(insertAt, 0, notice);
}

export function mergeDeletionNotices(
  messages: readonly CommsHistoryMessage[],
  deletionNotices: ReadonlyMap<string, DeletionNotice>,
  deletedMessageIds: ReadonlySet<string>,
  channelSlug: string,
): CommsHistoryMessage[] {
  const channelNotices = new Map<string, CommsHistoryMessage>();
  for (const [messageId, notice] of deletionNotices) {
    if (notice.channelSlug === channelSlug) channelNotices.set(messageId, notice.message);
  }

  const merged: CommsHistoryMessage[] = [];
  const payloadMessageIds = new Set<string>();
  for (const message of messages) {
    payloadMessageIds.add(message.id);
    const notice = channelNotices.get(message.id);
    if (notice) {
      merged.push(notice);
      continue;
    }
    if (!deletedMessageIds.has(message.id) && message.visibility_state !== "deleted") merged.push(message);
  }

  for (const [messageId, notice] of channelNotices) {
    if (!payloadMessageIds.has(messageId)) insertNoticeChronologically(merged, notice);
  }

  return merged;
}
