import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const OWNER_PREVIEW_PANEL = "components/player/public-profile-owner-preview-panel.tsx";
const PRIVACY_SETTINGS_PANEL = "components/player/profile-privacy-settings.tsx";
const PUBLIC_PROFILE_VIEWER = "components/player/public-player-profile.tsx";
const PUBLIC_PROFILE_API = "functions/api/public/players/[handle].ts";
const PUBLIC_PROFILE_HELPER = "functions/_lib/player-public-profiles.ts";
const PLATFORM_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";

main();

function main() {
  assertFilesExist();
  assertOwnerPreviewPanelContract();
  assertPrivateMountContract();
  assertPublicVisitorContract();
  assertProtectedSystemIsolation();
  assertDocsAndPackageWiring();
  console.log("Public profile owner preview/share polish tests passed.");
}

function assertFilesExist() {
  for (const path of [
    OWNER_PREVIEW_PANEL,
    PRIVACY_SETTINGS_PANEL,
    PUBLIC_PROFILE_VIEWER,
    PUBLIC_PROFILE_API,
    PUBLIC_PROFILE_HELPER,
    PLATFORM_SPEC,
    "package.json",
  ]) {
    assert.equal(existsSync(path), true, `${path} must exist.`);
  }
}

function assertOwnerPreviewPanelContract() {
  const panel = read(OWNER_PREVIEW_PANEL);

  for (const snippet of [
    "PublicProfileOwnerPreviewPanel",
    "How My Public Profile Looks",
    "Visitor View Mirror",
    "Owner Share Controls",
    "Open Public Page",
    "Copy Link",
    "Copy Handle",
    "Share",
    "No copy, open, or share action in this page session.",
    "stores no share history",
    "makes no server-side change",
    "navigator.clipboard?.writeText",
    "navigator.share",
    "new URL(href, \"https://dayz-network.com\").toString()",
    "previewState.status === \"ready\"",
    "shareLockCopy",
    "safePublicProfileHref",
    "safePublicProfileHandle",
  ]) {
    assert.equal(panel.includes(snippet), true, `Owner preview panel must include ${snippet}.`);
  }

  assert.match(
    panel,
    /fetch\(`\/api\/public\/players\/\$\{encodeURIComponent\(validatedHandle\)\}`,[\s\S]+credentials: "omit"/,
    "Owner preview must fetch the same public-safe public profile API without sending player cookies.",
  );
  assert.match(panel, /cache: "no-store"/, "Owner preview must avoid stale preview reads.");
  assert.match(panel, /aria-live="polite"/, "Copy/share feedback must be announced accessibly.");
  assert.doesNotMatch(
    panel,
    /fetch\([^)]*\/api\/player\/profile\/privacy|method:\s*["'](?:POST|PATCH|PUT|DELETE)["']|localStorage|sessionStorage|sendBeacon|gtag|posthog|plausible|document\.cookie/i,
    "Owner preview panel must not write privacy settings, store history, track events, or add mutation requests.",
  );
  assert.doesNotMatch(
    panel,
    /createCheckoutSession|checkout\.session|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN|DurableObject|WebSocket|AI_GATEWAY|OPENAI_API_KEY/i,
    "Owner preview panel must not touch payment, Nitrado, Discord bot, chat runtime, or AI runtime hooks.",
  );
}

function assertPrivateMountContract() {
  const privacySettings = read(PRIVACY_SETTINGS_PANEL);
  assert.match(
    privacySettings,
    /import \{ PublicProfileOwnerPreviewPanel \} from "@\/components\/player\/public-profile-owner-preview-panel"/,
    "Private profile settings must import the owner preview/share panel.",
  );
  assert.match(
    privacySettings,
    /<PublicProfileOwnerPreviewPanel[\s\S]+publicProfileEnabled=\{state\.data\.settings\.public_profile_enabled\}[\s\S]+publicProfileHref=\{state\.data\.public_profile_href\}[\s\S]+publicProfileHandle=\{state\.data\.public_profile_handle\}[\s\S]+sections=\{state\.data\.sections\}/,
    "Private profile settings must mount the preview from the authenticated current-user privacy payload.",
  );
  assert.match(
    privacySettings,
    /fetch\("\/api\/player\/profile\/privacy"/,
    "Private profile settings must keep using the canonical current-user privacy API.",
  );
  assert.match(
    privacySettings,
    /method: "PATCH"/,
    "Only the existing explicit save action may update profile privacy settings.",
  );
}

function assertPublicVisitorContract() {
  const viewer = read(PUBLIC_PROFILE_VIEWER);
  const publicApi = read(PUBLIC_PROFILE_API);
  const helper = read(PUBLIC_PROFILE_HELPER);

  assert.doesNotMatch(
    viewer,
    /PublicProfileOwnerPreviewPanel|How My Public Profile Looks|Owner Share Controls|Copy Handle|copyProfileHandle|navigator\.clipboard|navigator\.share/i,
    "Public visitor profile page must not include private owner preview/share controls.",
  );
  assert.match(
    viewer,
    /fetch\(`\/api\/public\/players\/\$\{encodeURIComponent\(handle\)\}`,[\s\S]+credentials: "omit"/,
    "Public visitor profile page must keep using the public read-only profile API without cookies.",
  );
  assert.match(publicApi, /request\.method !== "GET"/, "Public profile API must remain GET-only.");
  assert.doesNotMatch(publicApi, /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+|DELETE\s+FROM|DROP|ALTER|CREATE\s+TABLE)\b|\.run\(/i, "Public profile API must remain read-only.");
  assert.doesNotMatch(
    helper,
    /PublicProfileOwnerPreviewPanel|How My Public Profile Looks|Owner Share Controls|navigator\.clipboard|navigator\.share/i,
    "Public profile read model must not depend on private owner preview/share controls.",
  );
}

function assertProtectedSystemIsolation() {
  for (const file of protectedInfluenceFiles()) {
    if (!existsSync(file)) continue;
    const source = read(file);
    assert.doesNotMatch(
      source,
      /PublicProfileOwnerPreviewPanel|How My Public Profile Looks|Owner Share Controls|Copy Handle|copyProfileHandle/i,
      `${file} must not depend on public profile owner preview/share polish.`,
    );
  }
}

function assertDocsAndPackageWiring() {
  const spec = read(PLATFORM_SPEC);
  assert.match(spec, /Public Profile Owner Preview And Share Polish/i, "Master spec must record this slice as an implemented current slice.");
  assert.match(spec, /copy\/share controls/i, "Master spec must preserve the copy/share owner-preview contract.");
  assert.match(
    spec,
    /cannot affect profile privacy settings, billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility/i,
    "Master spec must preserve the protected-system isolation statement.",
  );
  assert.match(spec, /DZN Comms\/support remains the next queued product area/i, "Master spec must point the next product area back to DZN Comms safely.");

  const packageJson = read("package.json");
  assert.match(
    packageJson,
    /"test:public-profile-owner-preview-share-polish": "tsx scripts\/test-public-profile-owner-preview-share-polish\.ts"/,
    "Focused owner preview/share polish test must be wired into package scripts.",
  );
  assert.match(
    packageJson,
    /"qa:public-profile-owner-preview-share": "node scripts\/qa-public-profile-owner-preview-share\.mjs"/,
    "Rendered owner preview/share QA must be wired into package scripts.",
  );
  assert.match(
    packageJson,
    /test:public-player-profile-viewer && npm run test:public-profile-owner-preview-share-polish && npm run test:public-profile-discovery-linking/,
    "Full test chain should run owner preview/share guards before discovery-linking guards.",
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
    "functions/api/events/[slug]/join.ts",
    "functions/api/events/matchmaking.ts",
    "functions/_lib/ctf-tournaments.ts",
    "functions/api/servers/[serverId]/ctf/dashboard.ts",
    "functions/api/servers/[serverId]/ctf/roster.ts",
    "functions/api/owner/community-members/export.ts",
    "functions/_lib/community-member-source-management.ts",
  ];
}

function read(path: string) {
  return readFileSync(path, "utf8");
}
