import assert from "node:assert/strict";

import { DZN_OFFICIAL_UPDATES, officialDznUpdates } from "../lib/dzn-updates";

assert.ok(DZN_OFFICIAL_UPDATES.length >= 3, "The public DZN Updates feed needs an initial verified release history.");
assert.equal(new Set(DZN_OFFICIAL_UPDATES.map((update) => update.id)).size, DZN_OFFICIAL_UPDATES.length, "Official DZN update IDs must be unique.");

for (const update of DZN_OFFICIAL_UPDATES) {
  assert.match(update.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Official update IDs must stay stable and URL-safe.");
  assert.ok(Number.isFinite(Date.parse(`${update.publishedAt}T12:00:00.000Z`)), "Every official update needs a valid publication date.");
  assert.ok(update.title.length >= 12 && update.title.length <= 140, "Official update titles must be concise and meaningful.");
  assert.ok(update.summary.length >= 40 && update.summary.length <= 500, "Official updates must give useful player or owner context.");
  assert.match(update.href, /^\/(?!\/)/, "Official update links must stay on the DZN website.");
  assert.doesNotMatch(update.summary, /(?:token|password|secret|private data|payment receipt)/i, "Official updates must not expose sensitive information.");
}

const ordered = officialDznUpdates();
assert.deepEqual(ordered.map((update) => update.id), [...ordered].sort((left, right) => {
  const leftUpdate = DZN_OFFICIAL_UPDATES.find((update) => update.id === left.id)!;
  const rightUpdate = DZN_OFFICIAL_UPDATES.find((update) => update.id === right.id)!;
  return Date.parse(`${rightUpdate.publishedAt}T12:00:00.000Z`) - Date.parse(`${leftUpdate.publishedAt}T12:00:00.000Z`) || left.id.localeCompare(right.id);
}).map((update) => update.id), "Official updates must have a deterministic newest-first order.");

console.log("DZN official updates checks passed.");
