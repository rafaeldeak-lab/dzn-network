import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const SHARE_PANEL = "components/player/public-profile-share-panel.tsx";
const PRIVATE_PROFILE_PAGE = "components/player/player-profile-progression-page.tsx";
const PUBLIC_PROFILE_PAGE = "components/player/public-player-profile-page.tsx";
const GLOBAL_STYLES = "app/globals.css";

main();

function main() {
  assertStaticContracts();
  assertOwnerPreviewShareContracts();
  assertPrivacyAndProtectedSystemIsolation();
  assertDocumentationContracts();
  console.log("Public profile owner preview/share polish tests passed.");
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
    "functions/api/public/player-profiles/[handle].ts",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
    "docs/PUBLIC_PROFILE_OWNER_PREVIEW_SHARE_POLISH_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertOwnerPreviewShareContracts() {
  const sharePanel = read(SHARE_PANEL);
  for (const snippet of [
    "PublicProfileOwnerPreview",
    "PublicProfileOwnerPreviewCard",
    "How My Public Profile Looks",
    "Public view warnings",
    "View Public Page",
    "Copy Link",
    "Copy Handle",
    "copyProfileHandle",
    "Public profile handle copied.",
    "navigator.clipboard.writeText",
    "navigator.share",
    "new URL(href, window.location.origin).toString()",
    "Public Profile Link",
    "Public Profile Not Published",
    "Open Profile Settings",
  ]) {
    assert.equal(sharePanel.includes(snippet), true, `Share panel must include ${snippet}.`);
  }
  assert.doesNotMatch(
    sharePanel,
    /fetchJsonWithRetry|fetch\(|method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i,
    "Owner preview/share panel must remain local browser UI only.",
  );

  const privateProfilePage = read(PRIVATE_PROFILE_PAGE);
  for (const snippet of [
    "buildPublicProfileOwnerPreview",
    "ownerPublicPreview",
    "preview={ownerPublicPreview}",
    "avatarUrl: null",
    "Visitor view mirror",
    "Unsaved preview",
    "Unsaved changes are a local preview only until you save preferences.",
    "This private owner preview mirrors the public-safe profile sections visitors can open from the generated DZN profile link.",
    "Only month-level award labels are shown; exact award times stay hidden.",
    "Public profile display is off, so visitors cannot view this profile.",
    "Save preferences to generate the visitor link before sharing.",
  ]) {
    assert.equal(privateProfilePage.includes(snippet), true, `Private profile page must include ${snippet}.`);
  }
  assert.equal(count(privateProfilePage, /fetchJsonWithRetry</g), 2, "Private profile page should keep one profile read and one privacy save request.");
  assert.equal(count(privateProfilePage, /method:\s*"PATCH"/g), 1, "Only the existing Save Preferences action should patch profile privacy.");
  assert.equal(privateProfilePage.includes('"/api/player/profile-privacy"'), true, "Private profile save must continue using the private player privacy API.");
  assert.doesNotMatch(
    privateProfilePage,
    /method\s*:\s*["'](?:POST|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i,
    "Private owner preview must not add new mutation, payment, Nitrado, or Discord bot behavior.",
  );

  const styles = read(GLOBAL_STYLES);
  for (const snippet of [
    ".dzn-public-profile-owner-share-panel",
    ".dzn-public-profile-owner-preview",
    ".dzn-public-profile-owner-section-row",
    ".dzn-public-profile-owner-share-actions",
  ]) {
    assert.equal(styles.includes(snippet), true, `Global styles must include ${snippet}.`);
  }
}

function assertPrivacyAndProtectedSystemIsolation() {
  const publicProfilePage = read(PUBLIC_PROFILE_PAGE);
  assert.doesNotMatch(
    publicProfilePage,
    /PublicProfileOwnerPreview|dzn-public-profile-owner-|How My Public Profile Looks|Copy Handle|copyProfileHandle/i,
    "Visitor public profile route must not depend on private owner preview/share controls.",
  );
  assert.match(
    publicProfilePage,
    /fetchJsonWithRetry<PublicPlayerProfilePayload>\(`\/api\/public\/player-profiles\/\$\{encodedHandle\}`/,
    "Visitor public profile route must keep using the public read-only profile API.",
  );

  const publicProfileHelper = read("functions/_lib/public-player-profile.ts");
  assert.doesNotMatch(
    publicProfileHelper,
    /PublicProfileOwnerPreview|dzn-public-profile-owner-|How My Public Profile Looks|Copy Handle|navigator\.clipboard|navigator\.share/i,
    "Public profile read model must not depend on private owner preview/share controls.",
  );
  assertNoSqlWrites(publicProfileHelper, "Public profile read model must stay read-only.");

  const profilePrivacyApi = read("functions/api/player/profile-privacy.ts");
  assert.doesNotMatch(
    profilePrivacyApi,
    /PublicProfileOwnerPreview|dzn-public-profile-owner-|navigator\.clipboard|navigator\.share|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i,
    "Private profile privacy API must not know about preview/share presentation controls.",
  );

  for (const file of protectedInfluenceFiles()) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /PublicProfileOwnerPreview|dzn-public-profile-owner-|How My Public Profile Looks|Copy Handle|View Public Page|copyProfileHandle/i,
      `${file} must not depend on public profile owner preview/share polish.`,
    );
  }
}

function assertDocumentationContracts() {
  const docs = [
    read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md"),
    read("docs/PUBLIC_ACCESS_POLICY.md"),
    read("docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md"),
    read("docs/PUBLIC_PROFILE_OWNER_PREVIEW_SHARE_POLISH_HANDOFF.md"),
  ].join("\n");

  for (const snippet of [
    "Public Profile Owner Preview and Share Polish Slice",
    "How My Public Profile Looks",
    "copy/share controls",
    "private owner preview",
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
    packageJson.includes("test:public-profile-owner-preview-share-polish"),
    true,
    "Focused owner preview/share polish test must be wired into package scripts.",
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
