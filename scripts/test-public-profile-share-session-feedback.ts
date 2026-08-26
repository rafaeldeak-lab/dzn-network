import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const SHARE_PANEL = "components/player/public-profile-share-panel.tsx";
const PRIVATE_PROFILE_PAGE = "components/player/player-profile-progression-page.tsx";
const PUBLIC_PROFILE_PAGE = "components/player/public-player-profile-page.tsx";
const GLOBAL_STYLES = "app/globals.css";

main();

function main() {
  assertStaticContracts();
  assertSessionFeedbackContracts();
  assertNoPersistenceOrAnalytics();
  assertProtectedSystemIsolation();
  assertDocumentationContracts();
  console.log("Public profile share session feedback tests passed.");
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
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertSessionFeedbackContracts() {
  const sharePanel = read(SHARE_PANEL);
  for (const snippet of [
    'type ShareActivityKind = "opened" | "copied" | "handle_copied" | "shared"',
    "type ShareActivityRecord",
    "const [shareActivity, setShareActivity]",
    "recordShareActivity(\"opened\")",
    "recordShareActivity(\"copied\")",
    "recordShareActivity(\"handle_copied\")",
    "recordShareActivity(\"shared\")",
    "ShareSessionFeedback",
    "shareActivityRecord",
    "formatShareActivityTime",
    "This Page Session",
    "No copy, open, or share action has happened in this tab yet.",
    "Private to this tab. It is not saved or sent to DZN.",
    "Opened Public Page",
    "Copied Profile Link",
    "Copied Profile Handle",
    "Opened Browser Share",
    "target=\"_blank\"",
    "rel=\"noreferrer\"",
  ]) {
    assert.equal(sharePanel.includes(snippet), true, `Share panel must include ${snippet}.`);
  }

  const styles = read(GLOBAL_STYLES);
  for (const snippet of [
    ".dzn-public-profile-share-session-feedback",
    ".dzn-public-profile-share-session-row",
  ]) {
    assert.equal(styles.includes(snippet), true, `Global styles must include ${snippet}.`);
  }
}

function assertNoPersistenceOrAnalytics() {
  const sharePanel = read(SHARE_PANEL);
  assert.doesNotMatch(
    sharePanel,
    /localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|fetchJsonWithRetry|fetch\(|XMLHttpRequest|analytics|trackEvent|gtag|dataLayer|posthog|mixpanel|amplitude|plausible|Sentry|logShare|auditShare/i,
    "Share session feedback must not persist, send, track, or audit copy/open/share activity.",
  );
  assert.doesNotMatch(
    sharePanel,
    /method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i,
    "Share session feedback must remain client UI only with no write, payment, Nitrado, or Discord behavior.",
  );

  const privateProfilePage = read(PRIVATE_PROFILE_PAGE);
  assert.equal(count(privateProfilePage, /fetchJsonWithRetry</g), 2, "Private profile page should keep one profile read and one privacy save request.");
  assert.equal(count(privateProfilePage, /method:\s*"PATCH"/g), 1, "Only the explicit Save Preferences action should patch profile privacy.");
  assert.equal(privateProfilePage.includes('"/api/player/profile-privacy"'), true, "Private profile save must continue using the private player privacy API.");
  assert.doesNotMatch(
    privateProfilePage,
    /ShareActivityKind|ShareSessionFeedback|localStorage|sessionStorage|navigator\.sendBeacon|analytics|trackEvent|logShare|auditShare/i,
    "Private profile page must not own or persist share session feedback state.",
  );
}

function assertProtectedSystemIsolation() {
  const publicProfilePage = read(PUBLIC_PROFILE_PAGE);
  assert.doesNotMatch(
    publicProfilePage,
    /ShareActivityKind|ShareSessionFeedback|This Page Session|Copied Profile Link|Opened Browser Share|dzn-public-profile-share-session/i,
    "Visitor public profile route must not depend on private share session feedback.",
  );

  const publicProfileHelper = read("functions/_lib/public-player-profile.ts");
  assert.doesNotMatch(
    publicProfileHelper,
    /ShareActivityKind|ShareSessionFeedback|This Page Session|navigator\.clipboard|navigator\.share|localStorage|sessionStorage|navigator\.sendBeacon/i,
    "Public profile read model must not depend on private share session feedback.",
  );
  assertNoSqlWrites(publicProfileHelper, "Public profile read model must stay read-only.");

  const profilePrivacyApi = read("functions/api/player/profile-privacy.ts");
  assert.doesNotMatch(
    profilePrivacyApi,
    /ShareActivityKind|ShareSessionFeedback|This Page Session|navigator\.clipboard|navigator\.share|localStorage|sessionStorage|navigator\.sendBeacon|analytics|trackEvent/i,
    "Profile privacy API must not know about copy/open/share session feedback.",
  );

  for (const file of protectedInfluenceFiles()) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /ShareActivityKind|ShareSessionFeedback|This Page Session|Copied Profile Link|Opened Browser Share|dzn-public-profile-share-session|logShare|auditShare/i,
      `${file} must not depend on public profile share session feedback.`,
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
  ].join("\n");

  for (const snippet of [
    "Public Profile Share Session Feedback Slice",
    "This Page Session",
    "Private to this tab",
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
    packageJson.includes("test:public-profile-share-session-feedback"),
    true,
    "Focused share session feedback test must be wired into package scripts.",
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
