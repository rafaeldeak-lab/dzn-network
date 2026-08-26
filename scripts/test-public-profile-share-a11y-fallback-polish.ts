import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const SHARE_PANEL = "components/player/public-profile-share-panel.tsx";
const PRIVATE_PROFILE_PAGE = "components/player/player-profile-progression-page.tsx";
const PUBLIC_PROFILE_PAGE = "components/player/public-player-profile-page.tsx";
const GLOBAL_STYLES = "app/globals.css";

main();

function main() {
  assertStaticContracts();
  assertA11yFallbackContracts();
  assertNoPersistenceOrTracking();
  assertProtectedSystemIsolation();
  assertDocumentationContracts();
  console.log("Public profile share accessibility/fallback polish tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    SHARE_PANEL,
    PRIVATE_PROFILE_PAGE,
    PUBLIC_PROFILE_PAGE,
    GLOBAL_STYLES,
    "functions/api/player/profile-privacy.ts",
    "functions/_lib/player-profile-privacy.ts",
    "functions/_lib/public-player-profile.ts",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
    "docs/PUBLIC_PROFILE_OWNER_PREVIEW_SHARE_POLISH_HANDOFF.md",
    "docs/PUBLIC_PROFILE_SHARE_SESSION_FEEDBACK_HANDOFF.md",
    "docs/PUBLIC_PROFILE_SHARE_A11Y_FALLBACK_POLISH_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertA11yFallbackContracts() {
  const sharePanel = read(SHARE_PANEL);
  for (const snippet of [
    "useEffect, useId, useState",
    'type ShareState = "idle" | "copied" | "handle_copied" | "shared" | "clipboard_unavailable" | "share_unavailable" | "error"',
    "type ShareCapabilityState",
    "const [shareCapabilities, setShareCapabilities]",
    "setShareCapabilities",
    "clipboardAvailable()",
    "copyUnavailable",
    "browserShareUnavailable",
    "handleUnavailable",
    "shareStatusDetails",
    "ShareFallbackGuidance",
    "role=\"status\"",
    "aria-live=\"polite\"",
    "aria-atomic=\"true\"",
    "aria-labelledby={panelTitleId}",
    "aria-describedby",
    "aria-label=\"Open your public DZN profile in a new tab\"",
    "aria-label=\"Copy public profile link to clipboard\"",
    "aria-label={preview?.publicHandle ? \"Copy public profile handle to clipboard\" : \"Public profile handle is unavailable\"}",
    "aria-label=\"Open browser share sheet for public profile link\"",
    "focus-visible:ring-2",
    "disabled={copyUnavailable}",
    "disabled={handleUnavailable}",
    "disabled={browserShareUnavailable}",
    "Clipboard copy is unavailable in this browser. Open the public page and copy the address bar link.",
    "Browser share is unavailable here. Copy Link remains the fallback when clipboard access works.",
    "Copy Handle becomes available after your generated public handle exists.",
    "Keyboard users can tab to each public profile share control. Share status updates are announced on this panel.",
    "Share controls ready. Copy, open, and share updates stay on this page only.",
    "Public profile link copied.",
    "Public profile handle copied.",
    "Profile share sheet opened.",
  ]) {
    assert.equal(sharePanel.includes(snippet), true, `Share panel must include ${snippet}.`);
  }

  const styles = read(GLOBAL_STYLES);
  assert.equal(
    styles.includes(".dzn-public-profile-share-fallback-guidance"),
    true,
    "Global styles must include fallback guidance styling.",
  );
}

function assertNoPersistenceOrTracking() {
  const sharePanel = read(SHARE_PANEL);
  assert.doesNotMatch(
    sharePanel,
    /localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|fetchJsonWithRetry|fetch\(|XMLHttpRequest|analytics|trackEvent|gtag|dataLayer|posthog|mixpanel|amplitude|plausible|Sentry|logShare|auditShare/i,
    "Share accessibility/fallback polish must not persist, send, track, or audit copy/open/share activity.",
  );
  assert.doesNotMatch(
    sharePanel,
    /method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i,
    "Share accessibility/fallback polish must remain client UI only with no write, payment, Nitrado, or Discord behavior.",
  );

  const privateProfilePage = read(PRIVATE_PROFILE_PAGE);
  assert.equal(count(privateProfilePage, /fetchJsonWithRetry</g), 2, "Private profile page should keep one profile read and one privacy save request.");
  assert.equal(count(privateProfilePage, /method:\s*"PATCH"/g), 1, "Only the explicit Save Preferences action should patch profile privacy.");
  assert.equal(privateProfilePage.includes('"/api/player/profile-privacy"'), true, "Private profile save must continue using the private player privacy API.");
  assert.doesNotMatch(
    privateProfilePage,
    /ShareCapabilityState|ShareFallbackGuidance|shareStatusDetails|clipboard_unavailable|share_unavailable|localStorage|sessionStorage|navigator\.sendBeacon|analytics|trackEvent|logShare|auditShare/i,
    "Private profile page must not own or persist share accessibility/fallback state.",
  );
}

function assertProtectedSystemIsolation() {
  const publicProfilePage = read(PUBLIC_PROFILE_PAGE);
  assert.doesNotMatch(
    publicProfilePage,
    /ShareCapabilityState|ShareFallbackGuidance|shareStatusDetails|Clipboard copy is unavailable|Browser share is unavailable|dzn-public-profile-share-fallback/i,
    "Visitor public profile route must not depend on private share accessibility/fallback polish.",
  );

  const publicProfileHelper = read("functions/_lib/public-player-profile.ts");
  assert.doesNotMatch(
    publicProfileHelper,
    /ShareCapabilityState|ShareFallbackGuidance|shareStatusDetails|Clipboard copy is unavailable|Browser share is unavailable|navigator\.clipboard|navigator\.share|localStorage|sessionStorage|navigator\.sendBeacon/i,
    "Public profile read model must not depend on private share accessibility/fallback polish.",
  );
  assertNoSqlWrites(publicProfileHelper, "Public profile read model must stay read-only.");

  const profilePrivacyApi = read("functions/api/player/profile-privacy.ts");
  assert.doesNotMatch(
    profilePrivacyApi,
    /ShareCapabilityState|ShareFallbackGuidance|shareStatusDetails|Clipboard copy is unavailable|Browser share is unavailable|navigator\.clipboard|navigator\.share|localStorage|sessionStorage|navigator\.sendBeacon|analytics|trackEvent/i,
    "Profile privacy API must not know about copy/open/share accessibility/fallback polish.",
  );

  for (const file of protectedInfluenceFiles()) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /ShareCapabilityState|ShareFallbackGuidance|shareStatusDetails|Clipboard copy is unavailable|Browser share is unavailable|dzn-public-profile-share-fallback|clipboard_unavailable|share_unavailable|logShare|auditShare/i,
      `${file} must not depend on public profile share accessibility/fallback polish.`,
    );
  }
}

function assertDocumentationContracts() {
  const docs = [
    read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md"),
    read("docs/PUBLIC_ACCESS_POLICY.md"),
    read("docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md"),
    read("docs/PUBLIC_PROFILE_OWNER_PREVIEW_SHARE_POLISH_HANDOFF.md"),
    read("docs/PUBLIC_PROFILE_SHARE_SESSION_FEEDBACK_HANDOFF.md"),
    read("docs/PUBLIC_PROFILE_SHARE_A11Y_FALLBACK_POLISH_HANDOFF.md"),
  ].join("\n");

  for (const snippet of [
    "Public Profile Share Accessibility/Fallback Polish Slice",
    "keyboard and screen-reader",
    "aria-live",
    "Clipboard copy is unavailable",
    "Browser share is unavailable",
    "fallback guidance",
    "no stored share history",
    "no tracking events",
    "no analytics calls",
    "presentation-only",
    "Live checkout remains disabled",
    "Issue #49 remains reserved",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }
  assert.match(
    docs,
    /cannot affect profile privacy settings, billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility/i,
    "Docs must preserve the protected-system isolation statement.",
  );

  const packageJson = read("package.json");
  assert.equal(
    packageJson.includes("test:public-profile-share-a11y-fallback-polish"),
    true,
    "Focused share accessibility/fallback test must be wired into package scripts.",
  );
}

function protectedInfluenceFiles() {
  return [
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/status.ts",
    "functions/_lib/server-ranking.ts",
    "functions/_lib/public-leaderboards.ts",
    "functions/_lib/server-visibility.ts",
    "functions/_lib/server-reviews.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/api/cron/player-progression/awards.ts",
    "functions/_lib/player-progression.ts",
    "functions/api/events/[slug]/join.ts",
    "functions/api/events/matchmaking.ts",
    "functions/_lib/ctf-tournaments.ts",
    "functions/api/servers/[serverId]/ctf/dashboard.ts",
    "functions/api/servers/[serverId]/ctf/roster.ts",
    "functions/api/owner/community-members/export.ts",
    "functions/_lib/community-member-source-management.ts",
  ];
}

function assertNoSqlWrites(source: string, message: string) {
  assert.doesNotMatch(source, /\bINSERT\s+INTO\b|\bUPDATE\b|\bDELETE\s+FROM\b|\bDROP\b|\bALTER\b|\bCREATE\s+(?:TABLE|INDEX)\b/i, message);
  assert.doesNotMatch(source, /\.run\(/, message);
}

function count(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}
