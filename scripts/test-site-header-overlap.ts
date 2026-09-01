import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const globalsSource = readFileSync("app/globals.css", "utf8");
const siteHeaderSource = readFileSync("components/site-header.tsx", "utf8");
const pulseProviderSource = readFileSync("components/dzn-pulse/dzn-pulse-provider.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");

const headerNavBlock = sourceBlock(globalsSource, ".dzn-header-nav {", ".dzn-header-nav::before");
const headerFrameBlock = sourceBlock(globalsSource, ".dzn-header-nav::before", ".dzn-header-logo {");
const headerLogoBlock = sourceBlock(globalsSource, ".dzn-header-logo {", ".dzn-header-logo::after");
const headerLinksBlock = sourceBlock(globalsSource, ".dzn-header-links {", ".dzn-header-links::before");
const headerLinkItemBlock = sourceBlock(globalsSource, ".dzn-header-links a {", ".dzn-header-links a:first-child");
const headerLinkStateBlock = sourceBlock(globalsSource, ".dzn-header-links a:hover", ".dzn-header-links a:hover::after");
const headerActionsBlock = sourceBlock(globalsSource, ".dzn-header-actions {", ".dzn-header-pulse-bell");
const headerPulseBlock = sourceBlock(globalsSource, ".dzn-header-pulse-bell {", ".dzn-header-pulse-bell:hover");
const headerPulseBadgeBlock = sourceBlock(globalsSource, ".dzn-header-pulse-bell span {", ".dzn-header-nav--logged-out .dzn-header-links");
const headerContainerBlock = sourceBlock(globalsSource, "@container dzn-header (max-width: 1820px)", "@media (max-width: 1500px)");
const headerTabletBlock = sourceBlock(globalsSource, "@media (max-width: 1500px)", "@media (max-width: 1360px)");
const headerMobileBlock = sourceBlock(globalsSource, "@media (max-width: 720px)", "@media (max-width: 560px)");

assert.match(headerNavBlock, /width:\s*min\(100%, 1880px\);/, "Shared header must have enough desktop width for authenticated actions before wrapping.");
assert.match(headerNavBlock, /display:\s*grid;/, "Shared header must use a stable command-bar grid instead of a collision-prone row.");
assert.match(headerNavBlock, /grid-template-columns:\s*minmax\(230px, 315px\) minmax\(460px, 1fr\) minmax\(380px, 560px\);/, "Desktop header must reserve separate logo, nav, and action zones.");
assert.match(headerNavBlock, /min-height:\s*132px;/, "Desktop command bar needs enough height for the framed action cluster.");
assert.match(headerNavBlock, /border-radius:\s*8px;/, "Command-bar frame should stay angular and DZN-specific.");
assert.match(headerNavBlock, /container:\s*dzn-header \/ inline-size;/, "Header must use a container query so wrapping is based on header width, not only viewport width.");
assert.match(headerFrameBlock, /\.dzn-header-nav::after/, "Command bar must keep the central sci-fi frame notch.");
assert.match(headerFrameBlock, /clip-path:\s*polygon/, "Command bar frame must use angular geometry matching the DZN reference direction.");

assert.match(headerLogoBlock, /clip-path:\s*polygon/, "Logo pod must keep an angular frame.");
assert.match(headerLogoBlock, /min-height:\s*92px;/, "Logo pod must keep the animated logo visible on desktop.");
assert.equal(siteHeaderSource.includes("function HeaderLogoVideo()"), true, "Animated header logo component must remain in place.");
assert.equal(siteHeaderSource.includes("dzn-server-wars-logo-loop-v2.webm"), true, "Header must keep the approved animated WebM logo source.");
assert.equal(siteHeaderSource.includes("dzn-server-wars-logo-poster-v2.jpg"), true, "Header must keep the approved poster fallback.");
assert.equal(siteHeaderSource.includes("setUseVideo(false);"), false, "Transient autoplay failures must not permanently replace the animated logo with the still poster.");

assert.match(headerLinksBlock, /display:\s*grid;/, "Header links must sit in their own framed grid.");
assert.match(headerLinksBlock, /grid-template-columns:\s*repeat\(auto-fit, minmax\(88px, 1fr\)\);/, "Header links must distribute evenly instead of overlapping.");
assert.match(headerLinksBlock, /clip-path:\s*polygon/, "Header links should keep the angular command-panel shape.");
assert.match(headerLinkItemBlock, /flex-direction:\s*column;/, "Header links must use icon-over-label controls like the reference.");
assert.match(headerLinkItemBlock, /white-space:\s*nowrap;/, "Header labels should remain readable inside their grid cells.");
assert.equal(siteHeaderSource.includes("dzn-header-link-icon"), true, "Header nav links must render hoverable icons.");
assert.match(headerLinkStateBlock, /:focus-visible/, "Header link highlight must also work for keyboard focus.");
assert.match(headerLinkStateBlock, /transform:\s*translateY\(-1px\);/, "Header link hover/focus needs visible movement.");
assert.match(headerLinkStateBlock, /text-shadow:\s*0 0 14px/, "Header link hover/focus needs a clear glow state.");

assert.match(headerActionsBlock, /display:\s*grid;/, "Header actions must use a grid instead of overlapping buttons.");
assert.match(headerActionsBlock, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/, "Desktop action bank must use a compact multi-column grid.");
assert.match(headerActionsBlock, /max-width:\s*100%;/, "Header actions must stay inside the header container.");
assert.match(headerActionsBlock, /clip-path:\s*polygon/, "Header actions should keep the angular command-panel shape.");
assert.equal(siteHeaderSource.includes("dzn-header-action-icon"), true, "Header action buttons must render visible icons.");
assert.equal(siteHeaderSource.includes("dzn-header-plan-icon"), true, "Header plan pill must render a visible plan icon.");
assert.match(headerPulseBlock, /position:\s*relative !important;/, "DZN Pulse button must own relative positioning so the unread badge anchors correctly.");
assert.match(headerPulseBadgeBlock, /position:\s*absolute;/, "DZN Pulse unread badge must use explicit absolute placement.");
assert.match(headerPulseBadgeBlock, /top:\s*-4px;/, "DZN Pulse unread badge must anchor to the top of the notification button.");
assert.match(headerPulseBadgeBlock, /right:\s*-4px;/, "DZN Pulse unread badge must anchor to the right of the notification button.");
assert.match(headerPulseBadgeBlock, /z-index:\s*2;/, "DZN Pulse unread badge must sit above the notification button.");
assert.match(headerPulseBadgeBlock, /display:\s*inline-flex;/, "DZN Pulse unread badge must keep its number centered inside the red counter.");
assert.match(headerPulseBadgeBlock, /background:\s*#ef1d28 !important;/, "DZN Pulse badge must be bright red when unread notifications exist.");
assert.equal(pulseProviderSource.includes("bg-red-600"), true, "DZN Pulse unread badge must not keep the old purple Tailwind badge.");
assert.equal(pulseProviderSource.includes("bg-fuchsia-500"), false, "DZN Pulse unread badge must not use the low-visibility purple badge.");

assert.match(headerContainerBlock, /grid-template-columns:\s*minmax\(200px, 285px\) minmax\(430px, 1fr\) minmax\(350px, 520px\);/, "Container query must tighten the command bar before viewport fallbacks.");
assert.match(headerTabletBlock, /grid-template-columns:\s*176px minmax\(0, 1fr\);/, "Crowded desktop/tablet header must move the action bank below logo/nav.");
assert.match(headerTabletBlock, /grid-column:\s*1 \/ -1;/, "Action bank must move to a full row before it overlaps nav links.");
assert.match(headerTabletBlock, /grid-template-columns:\s*repeat\(3, minmax\(120px, 1fr\)\);/, "Wrapped action bank must keep stable button columns.");
assert.match(headerMobileBlock, /grid-template-columns:\s*1fr;/, "Mobile command bar must stack instead of squeezing controls.");
assert.match(headerMobileBlock, /\.dzn-header-links[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/, "Mobile nav links must use two readable columns.");
assert.match(headerMobileBlock, /\.dzn-header-actions[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/, "Mobile actions must use two readable columns before the smallest fallback.");

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
