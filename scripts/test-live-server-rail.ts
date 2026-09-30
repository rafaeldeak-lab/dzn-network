import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("components/servers/live-server-rail.tsx", "utf8");

for (const fabricatedLabel of [
  "Servers joining beta now",
  "Compare Starter and Pro",
  "Pro adverts unlock visuals",
  "Beta onboarding",
]) {
  assert.equal(source.includes(fabricatedLabel), false, `Server rail must not render fabricated fallback content: ${fabricatedLabel}`);
}

assert.equal(source.includes('hasItems ? ('), true, "Real rail cards must require returned server items.");
assert.equal(source.includes('role="status"'), true, "Empty and loading states must be announced accessibly.");
assert.equal(source.includes("No public server listings are available right now"), true);
assert.equal(source.includes("Server listings are temporarily unavailable"), true, "Failed and stale responses need a distinct unavailable state.");
assert.equal(source.includes("setResponseStale(true)"), true, "Invalid and failed responses must not be presented as a successful empty result.");
assert.equal(source.includes('href="/servers"'), true, "The truthful empty state should link to the server directory.");
assert.equal(source.includes("[...items, ...items]"), false, "The animated rail must not clone visible server cards.");
assert.equal(source.includes("dedupeRailItems(items)"), true, "The client must defensively deduplicate server identities.");
assert.equal(source.includes('item.playerCountStatus !== "fresh"'), true, "Stale player counts must not be presented as live values.");

const apiSource = readFileSync("functions/api/public/server-rail.ts", "utf8");
assert.equal(apiSource.includes("dedupeRailRows(rows).map(toRailItem)"), true, "The public API must deduplicate canonical server identities.");

const css = readFileSync("app/globals.css", "utf8");
assert.match(css, /\.dzn-live-server-rail__track\s*\{[\s\S]*animation:\s*dznLiveServerRail/, "The unique-card rail should retain motion.");
assert.equal(css.includes("@keyframes dznLiveServerRailSingle"), true, "A single real server should keep subtle movement without cloning.");

console.log("Live server rail truthfulness tests passed.");
