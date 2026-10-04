import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layoutSource = readFileSync("app/layout.tsx", "utf8");
const communityPageSource = readFileSync("app/community/page.tsx", "utf8");
const globalStylesSource = readFileSync("app/globals.css", "utf8");
const headerSource = readFileSync("components/site-header.tsx", "utf8");
const launcherSource = readFileSync("components/comms/dzn-comms-launcher.tsx", "utf8");
const commsSource = readFileSync("components/comms/dzn-comms-shell.tsx", "utf8");
const assistSource = readFileSync("components/comms/dzn-assist.tsx", "utf8");
const assistGuidesSource = readFileSync("lib/dzn-assist.ts", "utf8");
const publicAccessPolicy = readFileSync("docs/PUBLIC_ACCESS_POLICY.md", "utf8");

assert.equal(layoutSource.includes("<DznCommsLauncher />"), true, "The Comms launcher must be mounted across the site.");
assert.equal(headerSource.includes('{ href: "/community", label: "Comms", active: "community", icon: MessageCircle }'), true, "The shared header must link to Comms.");
assert.equal(headerSource.includes('if (pathname.startsWith("/community")) return "community";'), true, "The Comms header link must receive the active state.");

assert.equal(launcherSource.includes('href="/community#global-chat"'), true, "The global launcher must open Global Chat directly.");
assert.equal(launcherSource.includes('href="/community#dzn-assist"'), true, "The global launcher must expose the DZN Assist status location.");
assert.equal(launcherSource.includes("Guided help live"), true, "The launcher must identify the available guided-help experience.");
assert.equal(launcherSource.includes('pathname.startsWith("/community")'), true, "The floating launcher must not cover the Comms page itself.");
assert.equal(launcherSource.includes('event.key === "Escape"'), true, "The launcher must close with Escape.");
assert.equal(launcherSource.includes('document.addEventListener("pointerdown", closeOnOutsideClick)'), true, "The launcher must close when someone clicks elsewhere on the page.");
assert.equal(launcherSource.match(/onClick=\{\(\) => setOpenPath\(null\)\}/g)?.length, 2, "Both launcher navigation links must clear its open state.");
assert.equal(launcherSource.includes("z-40"), true, "The launcher must remain below the shared header and modal layer.");
assert.equal(launcherSource.includes("z-[70]"), false, "The launcher must not cover the DZN Pulse modal.");
assert.equal(launcherSource.includes("Open Global Chat"), true, "The launcher must use neutral copy until the authoritative runtime state is known.");
assert.equal(launcherSource.includes("Open live chat"), false, "The launcher must not infer live availability from public build flags.");
assert.equal(launcherSource.includes("DZN Comms"), true, "The persistent launcher control must identify DZN Comms without relying on an icon or tooltip.");
assert.equal(launcherSource.includes("Chat &amp; help"), true, "The persistent launcher must explain that it opens chat and help.");
assert.equal(launcherSource.includes('className="sr-only text-left leading-none md:not-sr-only"'), true, "Phone and narrow-tablet screens must use the compact launcher while desktop retains its visible label.");
assert.equal(launcherSource.includes('aria-label={open ? "Close DZN Comms menu" : "Open DZN Comms"}'), true, "The compact phone launcher must keep an explicit accessible name.");
assert.equal(launcherSource.includes("safe-area-inset-bottom"), true, "The launcher must clear mobile safe-area controls.");
assert.equal(launcherSource.includes("safe-area-inset-left"), true, "The launcher must clear mobile safe-area controls in landscape.");
assert.equal(launcherSource.includes("safe-area-inset-right"), true, "The compact phone launcher must clear the right safe-area control.");
assert.equal(launcherSource.includes("closeButtonRef.current?.focus()"), true, "Opening the launcher must move keyboard focus into its menu.");
assert.equal(launcherSource.includes("ref={closeButtonRef}"), true, "The launcher close control must be the initial focus target.");
assert.equal(launcherSource.includes("window.requestAnimationFrame(() => triggerButtonRef.current?.focus())"), true, "Closing the launcher with its keyboard paths must restore trigger focus.");
assert.equal(launcherSource.includes("onClick={closeAndRestoreFocus}"), true, "The panel close control must restore focus to the launcher trigger.");
assert.equal(launcherSource.includes("ref={triggerButtonRef}"), true, "The launcher trigger must remain available as the focus return target.");

assert.equal(commsSource.includes('id="global-chat"'), true, "Global Chat must have a direct-link target.");
assert.equal(commsSource.includes('sendingEnabled\n    ? "Live now"'), true, "Global Chat must identify a live sending runtime.");
assert.equal(commsSource.includes('? "Read-only history"'), true, "Global Chat must identify read-only history.");
assert.equal(commsSource.includes('? "Checking access"'), true, "Global Chat must identify access checks in progress.");
assert.equal(commsSource.includes(': "Preview only"'), true, "Global Chat must identify the static preview state.");
assert.equal(commsSource.includes("Available now"), false, "Global Chat must not claim unconditional availability.");
assert.equal(commsSource.includes("<DznAssist />"), true, "The Comms page must render the working DZN Assist experience.");
assert.equal(assistSource.includes('id="dzn-assist"'), true, "DZN Assist must keep its direct-link target on the functional panel.");
assert.equal(assistSource.includes('window.location.hash !== "#dzn-assist"'), true, "DZN Assist must restore direct-anchor position after hydration.");
assert.equal(assistSource.includes('scrollIntoView({ block: "start" })'), true, "DZN Assist must move the direct-linked panel into view after hydration.");
assert.equal(assistSource.includes("document.fonts?.ready.then(scrollToAssist)"), true, "DZN Assist must restore the anchor after web fonts settle.");
assert.equal(assistSource.includes("Your search stays in this browser."), true, "DZN Assist must explain its local-only search boundary.");
assert.equal(assistSource.includes('normalizedQuery.split(/\\s+/).every((term) => searchableGuide.includes(term))'), true, "DZN Assist must match every search term across the guide's combined searchable fields.");
assert.equal(assistSource.includes("DZN_SUPPORT_EMAIL_HREF"), true, "DZN Assist must provide a private human-support route.");
assert.equal(assistSource.includes("DZN_PUBLIC_DISCORD_INVITE_URL"), true, "DZN Assist must provide the public DZN Discord route.");
assert.equal(assistGuidesSource.includes('href: "/setup"'), true, "DZN Assist must guide owners to resumable server setup.");
assert.equal(assistGuidesSource.includes('href: "/login?returnTo=%2Fplayer%2Fprofile%23game-account"'), true, "DZN Assist must preserve the game-account anchor across Discord sign-in.");
assert.equal(assistGuidesSource.includes('href: "/login?returnTo=%2Fdashboard", label: "Manage billing"'), true, "DZN Assist must route cancellation and payment-recovery help to account billing controls.");
assert.equal(publicAccessPolicy.includes("The browser-local DZN Assist guide may remain public"), true, "The public access policy must permit the released local-only guide.");
assert.equal(publicAccessPolicy.includes("Any account-aware or generative AI runtime remains a separate release"), true, "The public access policy must keep future AI runtime activation separate.");
assert.equal(commsSource.includes('pb-24 pt-4 text-zinc-100 sm:pt-6'), true, "Comms must begin directly below the shared header without the old empty spacer.");
assert.equal(communityPageSource.includes("Open moderated DZN Global Chat"), true, "Default share metadata must describe the Comms destination accurately.");
assert.equal(globalStylesSource.includes(".dzn-header-nav--logged-out .dzn-header-links {\n  grid-template-columns: repeat(3, minmax(96px, 1fr));"), true, "The signed-out desktop header must allocate one column for each public link.");
assert.equal(globalStylesSource.includes(".dzn-header-nav--logged-out .dzn-header-links {\n    grid-template-columns: repeat(2, minmax(0, 1fr));"), true, "The signed-out mobile header must restore its two-column wrapping.");

for (const forbidden of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "chat.completions", "responses.create", "trackEvent", "checkout.sessions.create"]) {
  assert.equal(launcherSource.includes(forbidden), false, `Comms discovery must not introduce ${forbidden}.`);
  assert.equal(assistSource.includes(forbidden), false, `DZN Assist must not introduce ${forbidden}.`);
  assert.equal(assistGuidesSource.includes(forbidden), false, `DZN Assist guides must not introduce ${forbidden}.`);
}

console.log("Comms discoverability tests passed.");
