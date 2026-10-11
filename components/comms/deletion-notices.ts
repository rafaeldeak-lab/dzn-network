import type { CommsHistoryMessage } from "./comms-history-client";

export type DeletionNotice = {
  channelSlug: string;
  message: CommsHistoryMessage;
};

function insertNoticeChronologically(messages: CommsHistoryMessage[], notice: CommsHistoryMessage) {
  const noticeCreatedAt = notice.created_at;
  if (noticeCreatedAt === null) {
    messages.push(notice);
    return;
  }
  const insertAt = messages.findIndex((message) => message.created_at !== null && (
    message.created_at > noticeCreatedAt
    || (message.created_at === noticeCreatedAt && message.id > notice.id)
  ));
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
