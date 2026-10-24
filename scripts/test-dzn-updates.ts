import assert from "node:assert/strict";

import { DZN_OFFICIAL_UPDATES, formatDznUpdateDate, officialDznUpdates } from "../lib/dzn-updates";

assert.ok(DZN_OFFICIAL_UPDATES.length >= 8, "The public DZN Updates feed needs a useful verified release history.");
assert.equal(new Set(DZN_OFFICIAL_UPDATES.map((update) => update.id)).size, DZN_OFFICIAL_UPDATES.length, "Official DZN update IDs must be unique.");

for (const id of [
  "global-chat-english-only-safety",
  "dzn-assist-saved-conversations",
  "dzn-assist-verified-server-guidance",
  "global-chat-earlier-history",
]) {
  assert.ok(DZN_OFFICIAL_UPDATES.some((update) => update.id === id), `The verified 23 Oct Comms release '${id}' must remain in the public history.`);
}

const gamesHubDevelopmentNotice = DZN_OFFICIAL_UPDATES.find((update) => update.id === "games-hub-development-notice");
assert.deepEqual(gamesHubDevelopmentNotice, {
  id: "games-hub-development-notice",
  publishedAt: "2026-10-21",
  audience: "Players",
  category: "Games",
  title: "Games Hub is in active development",
  summary: "DZN is improving its games in focused releases. Finished changes will be announced here when they are ready to play, rather than being presented as complete early.",
  href: "/games",
}, "The original Games Hub development release must remain in the public history.");
assert.ok(DZN_OFFICIAL_UPDATES.some((update) => update.id === "games-hub-maintenance-window"), "Games Hub maintenance must be recorded as a separate public release.");

for (const update of DZN_OFFICIAL_UPDATES) {
  assert.match(update.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Official update IDs must stay stable and URL-safe.");
  assert.ok(Number.isFinite(Date.parse(`${update.publishedAt}T12:00:00.000Z`)), "Every official update needs a valid publication date.");
  assert.ok(update.title.length >= 12 && update.title.length <= 140, "Official update titles must be concise and meaningful.");
  assert.ok(update.summary.length >= 40 && update.summary.length <= 500, "Official updates must give useful player or owner context.");
  assert.match(update.href, /^\/(?!\/)/, "Official update links must stay on the DZN website.");
  assert.doesNotMatch(update.summary, /(?:token|password|secret|private data|payment receipt)/i, "Official updates must not expose sensitive information.");
}

const ordered = officialDznUpdates();
assert.deepEqual(ordered.map((update) => update.id), DZN_OFFICIAL_UPDATES
  .map((update, index) => ({ update, index }))
  .sort((left, right) => Date.parse(`${right.update.publishedAt}T12:00:00.000Z`) - Date.parse(`${left.update.publishedAt}T12:00:00.000Z`) || left.index - right.index)
  .map(({ update }) => update.id), "Official updates must keep a deterministic newest-first order while preserving source order on the same day.");
assert.equal(formatDznUpdateDate("2026-10-21"), "21 Oct 2026", "Official update dates must be stable across viewer time zones.");

console.log("DZN official updates checks passed.");
