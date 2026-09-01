import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const globalsSource = readFileSync("app/globals.css", "utf8");
const siteHeaderSource = readFileSync("components/site-header.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");

const headerNavBlock = sourceBlock(globalsSource, ".dzn-header-nav {", ".dzn-header-logo {");
const headerLinksBlock = sourceBlock(globalsSource, ".dzn-header-links {", ".dzn-header-links a {");
const headerActionsBlock = sourceBlock(globalsSource, ".dzn-header-actions {", ".dzn-header-nav--logged-out .dzn-header-links");
const headerContainerBlock = sourceBlock(globalsSource, "@container dzn-header (max-width: 1820px)", "@media (max-width: 1500px)");

assert.match(headerNavBlock, /width:\s*min\(100%, 1880px\);/, "Shared header must have enough desktop width for authenticated actions before wrapping.");
assert.match(headerNavBlock, /flex-wrap:\s*wrap;/, "Shared header row must be allowed to wrap instead of overlapping.");
assert.match(headerNavBlock, /row-gap:\s*10px;/, "Wrapped header rows need deliberate vertical spacing.");
assert.match(headerNavBlock, /container:\s*dzn-header \/ inline-size;/, "Header must use a container query so wrapping is based on header width, not only viewport width.");

assert.match(headerLinksBlock, /flex:\s*1 1 520px;/, "Header links need a stable basis in the shared row.");
assert.match(headerLinksBlock, /min-width:\s*min\(100%, 420px\);/, "Header links must not shrink into the action cluster.");
assert.match(headerLinksBlock, /flex-wrap:\s*wrap;/, "Header links must wrap when labels are too wide for the available space.");
assert.match(headerLinksBlock, /row-gap:\s*6px;/, "Wrapped header links need a deliberate row gap.");

assert.match(headerActionsBlock, /flex:\s*0 1 auto;/, "Header actions must be allowed to shrink as a group.");
assert.match(headerActionsBlock, /max-width:\s*100%;/, "Header actions must stay inside the header container.");
assert.match(headerActionsBlock, /flex-wrap:\s*wrap;/, "Header actions must wrap rather than overlap links.");
assert.match(headerActionsBlock, /row-gap:\s*8px;/, "Wrapped header actions need a deliberate row gap.");

assert.match(headerContainerBlock, /\.dzn-header-nav--authenticated \.dzn-header-links/, "Authenticated nav must get the early wrap rule.");
assert.match(headerContainerBlock, /order:\s*3;/, "Authenticated links should move onto their own row before they collide with owner actions.");
assert.match(headerContainerBlock, /flex:\s*1 0 100%;/, "Authenticated links should use a full row at crowded widths.");
assert.match(headerContainerBlock, /overflow-x:\s*auto;/, "Header links need a final overflow fallback for narrow or zoomed layouts.");

assert.equal(siteHeaderSource.includes("Player Hub"), true, "Logged-in player access must remain in the shared header.");
assert.equal(siteHeaderSource.includes("DznPulseBell"), true, "DZN Pulse bell must remain available for authenticated users.");
assert.equal(siteHeaderSource.includes("checkout.sessions.create"), false, "Header visual fix must not introduce checkout creation.");
assert.equal(siteHeaderSource.includes("DZN_LIVE_CHECKOUT_ENABLED=true"), false, "Header visual fix must not enable live checkout.");
assert.equal(packageSource.includes("\"test:site-header-overlap\": \"tsx scripts/test-site-header-overlap.ts\""), true, "Header overlap test must be registered.");

for (const forbidden of [
  "store_orders",
  "supporter_cards",
  "earned_spins",
  "spin_ledger",
  "new DurableObject",
  "WebSocket",
  "analytics",
  "trackEvent",
]) {
  assert.equal(siteHeaderSource.includes(forbidden), false, `Header layout fix must not introduce ${forbidden}.`);
}

console.log("Site header overlap tests passed.");

function sourceBlock(source: string, startNeedle: string, endNeedle: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}
