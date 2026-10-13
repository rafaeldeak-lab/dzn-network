import type { CommsHistoryMessage } from "./comms-history-client";

export type DeletionNotice = {
  channelSlug: string;
  message: CommsHistoryMessage;
};

function isDeletedNotice(message: CommsHistoryMessage) {
  return message.visibility_state === "deleted"
    || (message.author_display_name === "DZN Safety"
      && message.author_role_label === "System"
      && message.body === "Message deleted.");
}

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
    // Older deployments represented a deletion as a visible system message.
    // Suppress that legacy shape too, so a refresh cannot grow the chat with
    // stale deletion rows after the transient two-second notice is gone.
    if (!deletedMessageIds.has(message.id) && !isDeletedNotice(message)) merged.push(message);
  }

  for (const [messageId, notice] of channelNotices) {
    if (!payloadMessageIds.has(messageId)) insertNoticeChronologically(merged, notice);
  }

  return merged;
}
