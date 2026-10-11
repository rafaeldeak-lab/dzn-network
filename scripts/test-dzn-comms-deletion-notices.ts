import assert from "node:assert/strict";
import test from "node:test";

import { mergeDeletionNotices, type DeletionNotice } from "../components/comms/deletion-notices";
import type { CommsHistoryMessage } from "../components/comms/comms-history-client";

function message(id: string, body: string, visibilityState: CommsHistoryMessage["visibility_state"] = "visible"): CommsHistoryMessage {
  return {
    id,
    author_display_name: "Player One",
    author_role_label: "Member",
    body,
    visibility_state: visibilityState,
    created_at: "2026-10-11T10:00:00.000Z",
    edited_at: null,
    public_safe: true,
    read_only: true,
    can_delete: visibilityState === "visible",
  };
}

function deletedNotice(id: string): DeletionNotice {
  return {
    channelSlug: "global-chat",
    message: {
      ...message(id, "Message deleted.", "deleted"),
      author_display_name: "DZN Safety",
      author_role_label: "System",
      can_delete: false,
    },
  };
}

test("keeps a temporary deletion notice after a polling response omits the deleted row", () => {
  const notice = deletedNotice("deleted-message");

  assert.deepEqual(
    mergeDeletionNotices([], new Map([["deleted-message", notice]]), "global-chat"),
    [notice.message],
  );
});

test("replaces an in-flight stale payload row with the sanitized deletion notice", () => {
  const notice = deletedNotice("deleted-message");

  assert.deepEqual(
    mergeDeletionNotices([message("deleted-message", "Original private message")], new Map([["deleted-message", notice]]), "global-chat"),
    [notice.message],
  );
});

test("removes deleted rows without an active local notice and never leaks notices across channels", () => {
  const notice = deletedNotice("deleted-message");
  const deleted = message("deleted-message", "Message deleted.", "deleted");
  const visible = message("visible-message", "Still visible");

  assert.deepEqual(mergeDeletionNotices([deleted, visible], new Map(), "global-chat"), [visible]);
  assert.deepEqual(
    mergeDeletionNotices([], new Map([["deleted-message", notice]]), "private-owners"),
    [],
  );
});
