import assert from "node:assert/strict";
import test from "node:test";

import { mergeDeletionNotices, type DeletionNotice } from "../components/comms/deletion-notices";
import type { CommsHistoryMessage } from "../components/comms/comms-history-client";

function message(
  id: string,
  body: string,
  visibilityState: CommsHistoryMessage["visibility_state"] = "visible",
  createdAt = "2026-10-11T10:00:00.000Z",
): CommsHistoryMessage {
  return {
    id,
    author_display_name: "Player One",
    author_role_label: "Member",
    body,
    visibility_state: visibilityState,
    created_at: createdAt,
    edited_at: null,
    public_safe: true,
    read_only: true,
    can_delete: visibilityState === "visible",
  };
}

function deletedNotice(id: string, createdAt?: string): DeletionNotice {
  return {
    channelSlug: "global-chat",
    message: {
      ...message(id, "Message deleted.", "deleted", createdAt),
      author_display_name: "DZN Safety",
      author_role_label: "System",
      can_delete: false,
    },
  };
}

test("keeps a temporary deletion notice after a polling response omits the deleted row", () => {
  const notice = deletedNotice("deleted-message");

  assert.deepEqual(
    mergeDeletionNotices([], new Map([["deleted-message", notice]]), new Set(), "global-chat"),
    [notice.message],
  );
});

test("replaces an in-flight stale payload row with the sanitized deletion notice", () => {
  const notice = deletedNotice("deleted-message");

  assert.deepEqual(
    mergeDeletionNotices([message("deleted-message", "Original private message")], new Map([["deleted-message", notice]]), new Set(), "global-chat"),
    [notice.message],
  );
});

test("removes deleted rows without an active local notice and never leaks notices across channels", () => {
  const notice = deletedNotice("deleted-message");
  const deleted = message("deleted-message", "Message deleted.", "deleted");
  const visible = message("visible-message", "Still visible");

  assert.deepEqual(mergeDeletionNotices([deleted, visible], new Map(), new Set(), "global-chat"), [visible]);
  assert.deepEqual(
    mergeDeletionNotices([], new Map([["deleted-message", notice]]), new Set(), "private-owners"),
    [],
  );
});

test("suppresses a stale deleted row after the temporary notice has expired", () => {
  assert.deepEqual(
    mergeDeletionNotices(
      [message("deleted-message", "Original private message")],
      new Map(),
      new Set(["deleted-message"]),
      "global-chat",
    ),
    [],
  );
});

test("inserts a refreshed deletion notice into its original chronological position", () => {
  const notice = deletedNotice("deleted-message", "2026-10-11T10:01:00.000Z");
  const before = message("before", "Still visible before", "visible", "2026-10-11 10:00:00");
  const after = message("after", "Still visible after", "visible", "2026-10-11 10:02:00");

  assert.deepEqual(
    mergeDeletionNotices([before, after], new Map([["deleted-message", notice]]), new Set(), "global-chat"),
    [before, notice.message, after],
  );
});

test("uses the history ID tie-breaker for notices sharing a timestamp", () => {
  const createdAt = "2026-10-11T10:01:00.000Z";
  const notice = deletedNotice("b", createdAt);
  const before = message("a", "Still visible before", "visible", createdAt);
  const after = message("c", "Still visible after", "visible", createdAt);

  assert.deepEqual(
    mergeDeletionNotices([before, after], new Map([["b", notice]]), new Set(), "global-chat"),
    [before, notice.message, after],
  );
});
