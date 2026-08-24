import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authShellSource = readFileSync("components/onboarding/auth-shell.tsx", "utf8");

assert.equal(authShellSource.includes("type BriefingCardInfo"), true, "Mission briefing cards should have structured intel content.");
assert.equal(authShellSource.includes("data-briefing-intel={card.signal}"), true, "Mission briefing should expose stable intel panels for rendered checks.");
assert.equal(authShellSource.includes("group-hover:grid-rows-[1fr]"), true, "Mission briefing intel should reveal on desktop hover.");
assert.equal(authShellSource.includes("group-focus:grid-rows-[1fr]"), true, "Mission briefing intel should reveal on keyboard focus or tap/click focus.");
assert.equal(authShellSource.includes("group-active:grid-rows-[1fr]"), true, "Mission briefing intel should reveal immediately while tapping.");
assert.equal(authShellSource.includes("aria-expanded={isOpen}"), true, "Mission briefing cards should expose persistent tapped-open state to assistive tech.");
assert.equal(authShellSource.includes("data-state={isOpen ? \"open\" : \"closed\"}"), true, "Mission briefing intel panels should expose stable open state for rendered checks.");
assert.equal(authShellSource.includes("scroll-mb-28"), true, "Mission briefing cards should keep tapped details clear of the fixed beta ticker.");
assert.equal(authShellSource.includes("MOBILE_BRIEFING_BREAKPOINT_PX"), true, "Mission briefing click auto-scroll should stay limited to mobile-sized viewports.");
assert.equal(authShellSource.includes("MOBILE_TICKER_CLEARANCE_PX"), true, "Mission briefing tap scrolling should include fixed beta ticker clearance.");
assert.equal(authShellSource.includes("BRIEFING_EXPAND_SETTLE_MS"), true, "Mission briefing tap scrolling should recheck after the expansion transition settles.");
assert.equal(authShellSource.includes("ensureBriefingDetailsClearOfTicker"), true, "Mission briefing tap scrolling should measure expanded details against the fixed beta ticker.");
assert.equal(authShellSource.includes("document.querySelector<HTMLElement>(\".dzn-beta-ticker\")"), true, "Mission briefing tap scrolling should use the actual beta ticker position.");
assert.equal(authShellSource.includes("prefers-reduced-motion: reduce"), true, "Mission briefing tap scrolling should respect reduced motion.");
assert.equal(authShellSource.includes("focus-visible:ring-2"), true, "Mission briefing cards should keep a visible keyboard focus state.");
assert.equal(authShellSource.includes("mission-briefing-intel-"), true, "Mission briefing details should have stable accessible IDs.");
assert.equal(authShellSource.includes("useReducedMotion"), false, "Auth shell should not branch rendered background markup on client-only reduced motion.");
assert.equal(authShellSource.includes("auth-hero-breathe absolute inset-0"), true, "Auth shell should keep stable background markup and let CSS media queries reduce motion.");

for (const expectedCopy of [
  "Only the right Discord authority should get control.",
  "Use the Discord community that actually owns the DayZ server.",
  "The service link is what proves DZN is reading the correct server.",
  "Use the exact Nitrado Service ID for the live DayZ service you want DZN to track.",
  "The token is encrypted before storage and cannot be viewed back in the dashboard.",
  "If access fails or the token is changed in Nitrado, replace it instead of sharing it in chat or Discord.",
  "DZN prepares ADM syncing for player activity, kills, deaths, and rankings.",
  "ADM stats are evidence-based and can take time to appear.",
  "Rankings come from imported activity, not paid placement or manual score editing.",
]) {
  assert.equal(authShellSource.includes(expectedCopy), true, `Mission briefing should include: ${expectedCopy}`);
}

console.log("Auth mission briefing tests passed.");
