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
assert.equal(source.includes('href="/servers"'), true, "The truthful empty state should link to the server directory.");
assert.equal(source.includes("duplicate={index >= items.length}"), true, "Only real items may be duplicated for the animated rail.");

console.log("Live server rail truthfulness tests passed.");
