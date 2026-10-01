import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layoutSource = readFileSync("app/layout.tsx", "utf8");
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

assert.equal(commsSource.includes('id="global-chat"'), true, "Global Chat must have a direct-link target.");
assert.equal(commsSource.includes('id="dzn-assist"'), true, "DZN Assist must have a direct-link target.");
assert.equal(commsSource.includes("Available now"), true, "Global Chat must show its available state.");
assert.equal(commsSource.includes("No AI messages are being generated."), true, "DZN Assist status must state that no AI runtime is active.");
assert.equal(commsSource.includes('pb-24 pt-4 text-zinc-100 sm:pt-6'), true, "Comms must begin directly below the shared header without the old empty spacer.");

for (const forbidden of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "chat.completions", "responses.create", "trackEvent", "checkout.sessions.create"]) {
  assert.equal(launcherSource.includes(forbidden), false, `Comms discovery must not introduce ${forbidden}.`);
}

console.log("Comms discoverability tests passed.");
