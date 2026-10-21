import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layoutSource = readFileSync("app/layout.tsx", "utf8");
const communityPageSource = readFileSync("app/community/page.tsx", "utf8");
const globalStylesSource = readFileSync("app/globals.css", "utf8");
const headerSource = readFileSync("components/site-header.tsx", "utf8");
const launcherSource = readFileSync("components/comms/dzn-comms-launcher.tsx", "utf8");
const commsSource = readFileSync("components/comms/dzn-comms-shell.tsx", "utf8");
const staticPayloadSource = commsSource.slice(
  commsSource.indexOf("const staticPayload"),
  commsSource.indexOf("export function DznCommsShell"),
);
const assistSource = readFileSync("components/comms/dzn-assist.tsx", "utf8");
const assistGuidesSource = readFileSync("lib/dzn-assist.ts", "utf8");
const assistRuntimeSource = readFileSync("lib/dzn-assist-runtime.ts", "utf8");
const publicAccessPolicy = readFileSync("docs/PUBLIC_ACCESS_POLICY.md", "utf8");

assert.equal(layoutSource.includes("<DznCommsLauncher />"), true, "The Comms launcher must be mounted across the site.");
assert.equal(headerSource.includes('{ href: "/community", label: "Chat & Help", active: "community", icon: MessageCircle }'), true, "The shared header must clearly link to chat and help.");
assert.equal(headerSource.includes('if (pathname.startsWith("/community")) return "community";'), true, "The Comms header link must receive the active state.");

assert.equal(launcherSource.includes('href="/community#global-chat"'), true, "The global launcher must open Global Chat directly.");
assert.equal(launcherSource.includes('href="/community#dzn-assist"'), true, "The global launcher must expose the DZN Assist status location.");
assert.equal(launcherSource.includes("NEXT_PUBLIC_DZN_OWNER_DISCORD_ACCESS_UI_ENABLED"), true, "The global launcher must expose owner Discord access only after the explicit public activation flag is enabled.");
assert.equal(launcherSource.includes('href="/login?returnTo=%2Fdiscord-owner-access"'), true, "The global launcher must provide a sign-in-safe route to the owner Discord request flow.");
assert.equal(launcherSource.includes("Server owner access"), true, "The global launcher must name the owner-only request path clearly.");
assert.equal(launcherSource.includes("Guided help live"), true, "The launcher must identify the available guided-help experience.");
assert.equal(launcherSource.includes('pathname.startsWith("/community")'), true, "The floating launcher must not cover the Comms page itself.");
assert.equal(launcherSource.includes('pathname.startsWith("/games")'), true, "Games Hub must compact the floating launcher because its own navigation already labels the Community route.");
assert.equal(launcherSource.includes("<details"), true, "The launcher must use a native disclosure so it works before client hydration completes.");
assert.equal(launcherSource.includes('aria-label="Open DZN Comms"'), true, "The launcher disclosure must have an explicit accessible name.");
assert.equal(launcherSource.includes('disclosureRef.current?.removeAttribute("open")'), true, "The launcher must close when client-side navigation changes the route.");
assert.equal(launcherSource.includes('disclosure.querySelector<HTMLElement>("summary")?.focus()'), true, "The launcher must restore focus to its summary after closing the panel.");
assert.equal(launcherSource.includes('event.key === "Escape"'), true, "The launcher must let keyboard users dismiss the panel with Escape.");
assert.equal(launcherSource.includes("z-40"), true, "The launcher must remain below the shared header and modal layer.");
assert.equal(launcherSource.includes("z-[70]"), false, "The launcher must not cover the DZN Pulse modal.");
assert.equal(launcherSource.includes("Open Global Chat"), true, "The launcher must use neutral copy until the authoritative runtime state is known.");
assert.equal(launcherSource.includes("Open live chat"), false, "The launcher must not infer live availability from public build flags.");
assert.equal(launcherSource.includes("DZN Comms"), true, "The persistent launcher control must name the communication surface without relying on an icon or tooltip.");
assert.equal(launcherSource.includes("Chat &amp; help"), false, "The launcher must not render a second duplicate Chat and Help label.");
assert.equal(launcherSource.includes('aria-label="Open DZN Comms"'), true, "The compact mobile launcher must retain an accessible Comms label.");
assert.equal(launcherSource.includes('"hidden md:block"'), true, "Phone launchers must use an icon-only control so they do not cover page actions.");
assert.equal(launcherSource.includes('h-11 w-11'), true, "The compact phone launcher must preserve a stable touch target.");
assert.equal(launcherSource.includes('pathname === "/"'), true, "The phone homepage must identify the route with its large primary actions.");
assert.equal(launcherSource.includes('"max-md:hidden"'), true, "The phone homepage must defer to the visible Chat and Help navigation while its Discord action is on screen.");
assert.equal(launcherSource.includes("safe-area-inset-bottom"), true, "The launcher must clear mobile safe-area controls.");
assert.equal(launcherSource.includes("safe-area-inset-left"), true, "The launcher must clear mobile safe-area controls in landscape.");
assert.equal(launcherSource.includes("safe-area-inset-right"), true, "The compact phone launcher must clear the right safe-area control.");
assert.equal(launcherSource.includes('disclosure.open = false'), true, "The panel close control must close the native disclosure.");

assert.equal(commsSource.includes('id="global-chat"'), true, "Global Chat must have a direct-link target.");
assert.equal(commsSource.includes('selectedChannelAccessLabel = sendingEnabled\n    ? "Live now"'), true, "The selected Comms channel must identify a live sending runtime.");
assert.equal(commsSource.includes('? "Read-only history"'), true, "Global Chat must identify read-only history.");
assert.equal(commsSource.includes('? "Checking access"'), true, "Global Chat must identify access checks in progress.");
assert.equal(commsSource.includes(': "Preview only"'), true, "Global Chat must identify the static preview state.");
assert.equal(commsSource.includes("Available now"), false, "Global Chat must not claim unconditional availability.");
assert.equal(staticPayloadSource.includes("messages: []"), true, "An unavailable history route must not invent preview messages.");
assert.equal(staticPayloadSource.includes("static-1"), false, "The fallback must not render fabricated chat rows.");
assert.equal(commsSource.includes("No old or fabricated messages are shown."), true, "The fallback must explain that stale chat is never substituted for live history.");
assert.equal(commsSource.includes("No public messages yet"), true, "An empty history must receive a compact, honest visual state.");
assert.equal(commsSource.includes("visible rows"), false, "The public chat count must use normal message language.");
assert.equal(commsSource.includes("<DznAssist />"), true, "The Comms page must render the working DZN Assist experience.");
assert.equal(commsSource.includes("NEXT_PUBLIC_DZN_OWNER_DISCORD_ACCESS_UI_ENABLED"), true, "Comms must use the explicit public owner-access flag before exposing an owner Discord entry point.");
assert.equal(commsSource.includes('href="/login?returnTo=%2Fdiscord-owner-access"'), true, "Comms must send anonymous server owners through sign-in before opening the feature-gated request route.");
assert.equal(assistSource.includes('id="dzn-assist"'), true, "DZN Assist must keep its direct-link target on the functional panel.");
assert.equal(assistSource.includes('window.location.hash === "#dzn-assist"'), true, "DZN Assist must restore direct-anchor position after hydration.");
assert.equal(assistSource.includes('scrollIntoView({ block: "start" })'), true, "DZN Assist must move the direct-linked panel into view after hydration.");
assert.equal(assistSource.includes('window.addEventListener("click", onAssistLinkClick)'), true, "DZN Assist must restore a repeated direct-link fragment.");
assert.equal(assistSource.includes('link?.hash === "#dzn-assist"'), true, "DZN Assist must limit repeated direct-link handling to its own anchor.");
assert.equal(assistSource.includes("Questions stay in this browser."), true, "DZN Assist must explain its local-only question boundary.");
assert.equal(assistSource.includes('fetch("/api/public/leaderboards"'), true, "DZN Assist may read only the existing public standings after an explicit ranking request.");
assert.equal(assistSource.includes('role="log"'), true, "DZN Assist must present a real support conversation transcript.");
assert.equal(assistSource.includes("answerDznAssist"), true, "DZN Assist must use the bounded local support responder.");
assert.equal(assistSource.includes("DZN_SUPPORT_EMAIL_HREF"), true, "DZN Assist must provide a private human-support route.");
assert.equal(assistSource.includes("DZN_PUBLIC_DISCORD_INVITE_URL"), true, "DZN Assist must provide the public DZN Discord route.");
assert.equal(assistSource.includes("ownerDiscordAccessUiEnabled"), true, "DZN Assist must keep the owner-access guide and action behind the explicit public owner-access flag.");
assert.equal(assistSource.includes('href="/login?returnTo=%2Fdiscord-owner-access"'), true, "DZN Assist must send a server owner through Discord sign-in before opening the private request flow.");
assert.equal(assistGuidesSource.includes('href: "/setup"'), true, "DZN Assist must guide owners to resumable server setup.");
assert.equal(assistGuidesSource.includes('id: "server-owner-discord-access"'), true, "DZN Assist must include specific server-owner Discord guidance.");
assert.equal(assistGuidesSource.includes('href: "/login?returnTo=%2Fplayer%2Fprofile%23game-account"'), true, "DZN Assist must preserve the game-account anchor across Discord sign-in.");
assert.equal(assistGuidesSource.includes('href: "/login?returnTo=%2Fdashboard", label: "Manage billing"'), true, "DZN Assist must route cancellation and payment-recovery help to account billing controls.");
assert.equal(publicAccessPolicy.includes("The browser-local DZN Assist may remain public"), true, "The public access policy must permit the released local-only support desk.");
assert.equal(publicAccessPolicy.includes("Any account-aware or generative AI runtime remains a separate release"), true, "The public access policy must keep future AI runtime activation separate.");
assert.equal(commsSource.includes('pb-24 pt-4 text-zinc-100 sm:pt-6'), true, "Comms must begin directly below the shared header without the old empty spacer.");
assert.equal(communityPageSource.includes("Open moderated DZN Global Chat"), true, "Default share metadata must describe the Comms destination accurately.");
assert.equal(globalStylesSource.includes(".dzn-header-nav--logged-out .dzn-header-links {\n  grid-template-columns: repeat(4, minmax(96px, 1fr));"), true, "The signed-out desktop header must allocate one column for each public link.");
assert.equal(globalStylesSource.includes(".dzn-header-nav--logged-out .dzn-header-links {\n    grid-template-columns: repeat(2, minmax(0, 1fr));"), true, "The signed-out mobile header must restore its two-column wrapping.");

for (const forbidden of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "chat.completions", "responses.create", "trackEvent", "checkout.sessions.create"]) {
  assert.equal(launcherSource.includes(forbidden), false, `Comms discovery must not introduce ${forbidden}.`);
  assert.equal(assistSource.includes(forbidden), false, `DZN Assist must not introduce ${forbidden}.`);
  assert.equal(assistGuidesSource.includes(forbidden), false, `DZN Assist guides must not introduce ${forbidden}.`);
  assert.equal(assistRuntimeSource.includes(forbidden), false, `DZN Assist runtime must not introduce ${forbidden}.`);
}

console.log("Comms discoverability tests passed.");
