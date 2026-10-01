import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layoutSource = readFileSync("app/layout.tsx", "utf8");
const communityPageSource = readFileSync("app/community/page.tsx", "utf8");
const globalStylesSource = readFileSync("app/globals.css", "utf8");
const headerSource = readFileSync("components/site-header.tsx", "utf8");
const launcherSource = readFileSync("components/comms/dzn-comms-launcher.tsx", "utf8");
const commsSource = readFileSync("components/comms/dzn-comms-shell.tsx", "utf8");

assert.equal(layoutSource.includes("<DznCommsLauncher />"), true, "The Comms launcher must be mounted across the site.");
assert.equal(headerSource.includes('{ href: "/community", label: "Comms", active: "community", icon: MessageCircle }'), true, "The shared header must link to Comms.");
assert.equal(headerSource.includes('if (pathname.startsWith("/community")) return "community";'), true, "The Comms header link must receive the active state.");

assert.equal(launcherSource.includes('href="/community#global-chat"'), true, "The global launcher must open Global Chat directly.");
assert.equal(launcherSource.includes('href="/community#dzn-assist"'), true, "The global launcher must expose the DZN Assist status location.");
assert.equal(launcherSource.includes("Not live yet"), true, "The launcher must not present DZN Assist as active.");
assert.equal(launcherSource.includes('pathname.startsWith("/community")'), true, "The floating launcher must not cover the Comms page itself.");
assert.equal(launcherSource.includes('event.key === "Escape"'), true, "The launcher must close with Escape.");
assert.equal(launcherSource.includes('document.addEventListener("pointerdown", closeOnOutsideClick)'), true, "The launcher must close when someone clicks elsewhere on the page.");
assert.equal(launcherSource.match(/onClick=\{\(\) => setOpenPath\(null\)\}/g)?.length, 3, "The launcher close control and both navigation links must clear its open state.");
assert.equal(launcherSource.includes("z-40"), true, "The launcher must remain below the shared header and modal layer.");
assert.equal(launcherSource.includes("z-[70]"), false, "The launcher must not cover the DZN Pulse modal.");
assert.equal(launcherSource.includes("Open Global Chat"), true, "The launcher must use neutral copy until the authoritative runtime state is known.");
assert.equal(launcherSource.includes("Open live chat"), false, "The launcher must not infer live availability from public build flags.");
assert.equal(launcherSource.includes("closeButtonRef.current?.focus()"), true, "Opening the launcher must move keyboard focus into its menu.");
assert.equal(launcherSource.includes("ref={closeButtonRef}"), true, "The launcher close control must be the initial focus target.");

assert.equal(commsSource.includes('id="global-chat"'), true, "Global Chat must have a direct-link target.");
assert.equal(commsSource.includes('id="dzn-assist"'), true, "DZN Assist must have a direct-link target.");
assert.equal(commsSource.includes('sendingEnabled\n    ? "Live now"'), true, "Global Chat must identify a live sending runtime.");
assert.equal(commsSource.includes('? "Read-only history"'), true, "Global Chat must identify read-only history.");
assert.equal(commsSource.includes('? "Checking access"'), true, "Global Chat must identify access checks in progress.");
assert.equal(commsSource.includes(': "Preview only"'), true, "Global Chat must identify the static preview state.");
assert.equal(commsSource.includes("Available now"), false, "Global Chat must not claim unconditional availability.");
assert.equal(commsSource.includes("No AI messages are being generated."), true, "DZN Assist status must state that no AI runtime is active.");
assert.equal(commsSource.includes('pb-24 pt-4 text-zinc-100 sm:pt-6'), true, "Comms must begin directly below the shared header without the old empty spacer.");
assert.equal(communityPageSource.includes("Preview moderated DZN Global Chat"), true, "Default share metadata must describe the Comms preview accurately.");
assert.equal(communityPageSource.includes("Open moderated DZN Global Chat"), false, "Default share metadata must not advertise inactive chat as live.");
assert.equal(globalStylesSource.includes(".dzn-header-nav--logged-out .dzn-header-links {\n  grid-template-columns: repeat(3, minmax(96px, 1fr));"), true, "The signed-out desktop header must allocate one column for each public link.");

for (const forbidden of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "chat.completions", "responses.create", "trackEvent", "checkout.sessions.create"]) {
  assert.equal(launcherSource.includes(forbidden), false, `Comms discovery must not introduce ${forbidden}.`);
}

console.log("Comms discoverability tests passed.");
