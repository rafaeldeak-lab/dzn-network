import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { onRequest as playerHubHandler } from "../functions/api/player/hub";
import { communityMemberSourceManagementSafeguards } from "../functions/_lib/community-member-source-management";
import { publicCommunityMemberDirectorySafeguards } from "../functions/_lib/public-community-members";
import type { Env, PagesContext } from "../functions/_lib/types";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertStaticContracts();
  await assertPlayerHubCommunityDirectoryPayload();
  assertPublicDirectorySafeguards();
  assertProtectedInfluenceIsolation();
  console.log("Community member directory Player Hub polish tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    "components/player/player-hub-page.tsx",
    "components/community/public-community-members-page.tsx",
    "components/community/community-member-source-dashboard.tsx",
    "functions/api/player/hub.ts",
    "functions/_lib/community-member-source-management.ts",
    "functions/_lib/public-community-members.ts",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
    "docs/COMMUNITY_MEMBER_DIRECTORY_PLAYER_HUB_POLISH_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const playerHubApi = read("functions/api/player/hub.ts");
  for (const snippet of [
    "community_href",
    "publicCommunityHrefForSlug",
    "/servers/${encodeURIComponent(slug)}/community",
    "pricingUrlForOwnerAccess(OWNER_SETUP_RETURN_TO)",
  ]) {
    assert.equal(playerHubApi.includes(snippet), true, `Player Hub API must include ${snippet}.`);
  }
  assert.doesNotMatch(playerHubApi, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(playerHubApi, /\bstripeFormRequest\b|\bcreateCheckoutSession\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/);
  assert.doesNotMatch(playerHubApi, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);

  const playerHubPage = read("components/player/player-hub-page.tsx");
  for (const snippet of [
    "Community Member Directories",
    "CommunityDirectoryGrid",
    "CommunityDirectoryCard",
    "uniqueCommunityDirectoryServers",
    "server.community_href",
    "Member Directory",
    "Hidden players stay anonymous",
    "Owner setup boundary",
  ]) {
    assert.equal(playerHubPage.includes(snippet), true, `Player Hub page must include ${snippet}.`);
  }
  assert.doesNotMatch(playerHubPage, /localStorage|sessionStorage|indexedDB|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  const publicDirectoryPage = read("components/community/public-community-members-page.tsx");
  for (const snippet of [
    "DirectoryControls",
    "Search public profiles",
    "publicMemberRoleOptions",
    "filterPublicCommunityMembers",
    "Private rows hidden",
    "Copy link",
    "This view only searches already-public profile rows.",
    "record.public_href === expectedHref && record.public_api_href === expectedApiHref",
  ]) {
    assert.equal(publicDirectoryPage.includes(snippet), true, `Public directory page must include ${snippet}.`);
  }
  assert.doesNotMatch(publicDirectoryPage, /dangerouslySetInnerHTML|method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  const sourceDashboard = read("components/community/community-member-source-dashboard.tsx");
  for (const snippet of [
    "PublicDirectoryStatus",
    "publicCommunityDirectoryHref",
    "directory preview presentation-only",
    "Public directory status",
    "View community directory",
    "public member rows stay hidden until the player publishes a profile handle",
  ]) {
    assert.equal(sourceDashboard.includes(snippet), true, `Source dashboard must include ${snippet}.`);
  }
  assert.doesNotMatch(sourceDashboard, /localStorage|sessionStorage|indexedDB|community_member_export_history|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  const sourceHelper = read("functions/_lib/community-member-source-management.ts");
  assert.equal(sourceHelper.includes("public_directory_preview_presentation_only: true"), true);

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:community-member-directory-player-hub-polish"), true);

  const docs = [
    read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md"),
    read("docs/PUBLIC_ACCESS_POLICY.md"),
    read("docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md"),
    read("docs/COMMUNITY_MEMBER_DIRECTORY_PLAYER_HUB_POLISH_HANDOFF.md"),
  ].join("\n");
  for (const snippet of [
    "Community Member Directory and Player Hub Surfacing Polish Slice",
    "public directory preview is presentation-only",
    "retained export files, export-history rows, sharing links, storage bindings, retention write APIs",
    "Issue #49 remains reserved",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }
  assert.equal(docs.toLowerCase().includes("live checkout remains disabled"), true, "Docs must confirm live checkout remains disabled.");
}

async function assertPlayerHubCommunityDirectoryPayload() {
  const response = await playerHubHandler({
    request: new Request("https://dzn.example/api/player/hub"),
    env: { MOCK_AUTH: "true" } as Env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Response;

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    ok?: boolean;
    access?: { owner_setup_href?: string; owner_setup_requires_entitlement?: boolean };
    suggested_servers?: { servers?: Array<{ public_slug?: string | null; href?: string; community_href?: string | null }> };
    profile_entry_points?: Array<{ key?: string; owner_entitlement_required?: boolean; href?: string }>;
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.access?.owner_setup_href, "/pricing?intent=owner_setup&returnTo=%2Fsetup");
  assert.equal(payload.access?.owner_setup_requires_entitlement, true);
  assert.equal(payload.suggested_servers?.servers?.[0]?.href, "/servers/profile?slug=pandora-dayz");
  assert.equal(payload.suggested_servers?.servers?.[0]?.community_href, "/servers/pandora-dayz/community");
  assert.equal(payload.suggested_servers?.servers?.[1]?.community_href, "/servers/warlords-pvp/community");
  assert.equal(
    payload.profile_entry_points?.some((entry) => entry.key === "owner_setup" && entry.owner_entitlement_required === true && entry.href === "/pricing?intent=owner_setup&returnTo=%2Fsetup"),
    true,
  );
}

function assertPublicDirectorySafeguards() {
  const publicSafeguards = publicCommunityMemberDirectorySafeguards();
  assert.equal(publicSafeguards.link_mode, "presentation_only");
  assert.equal(publicSafeguards.exposes_private_identifiers, false);
  assert.equal(publicSafeguards.affects_billing, false);
  assert.equal(publicSafeguards.affects_rankings, false);
  assert.equal(publicSafeguards.affects_reviews, false);
  assert.equal(publicSafeguards.affects_xp_awards, false);
  assert.equal(publicSafeguards.affects_calling_card_awards, false);
  assert.equal(publicSafeguards.affects_competitive_eligibility, false);

  const sourceSafeguards = communityMemberSourceManagementSafeguards();
  assert.equal(sourceSafeguards.public_directory_preview_presentation_only, true);
  assert.equal(sourceSafeguards.affects_public_profile_visibility_without_player_opt_in_handle, false);
  assert.equal(sourceSafeguards.affects_billing, false);
  assert.equal(sourceSafeguards.affects_rankings, false);
  assert.equal(sourceSafeguards.affects_reviews, false);
  assert.equal(sourceSafeguards.affects_xp_awards, false);
  assert.equal(sourceSafeguards.affects_calling_card_awards, false);
  assert.equal(sourceSafeguards.affects_competitive_eligibility, false);
}

function assertProtectedInfluenceIsolation() {
  for (const file of [
    "functions/api/billing/create-checkout-session.ts",
    "functions/_lib/server-ranking.ts",
    "functions/_lib/public-leaderboards.ts",
    "functions/_lib/server-visibility.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/_lib/server-reviews.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/api/cron/player-progression/awards.ts",
    "functions/_lib/player-progression.ts",
    "functions/api/events/[slug]/join.ts",
    "functions/api/events/matchmaking.ts",
    "functions/_lib/ctf-tournaments.ts",
    "functions/api/servers/[serverId]/ctf/dashboard.ts",
    "functions/api/servers/[serverId]/ctf/roster.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /CommunityDirectoryGrid|CommunityDirectoryCard|PublicDirectoryStatus|publicCommunityDirectoryHref|community_href|public_directory_preview_presentation_only/i,
      `${file} must not depend on this presentation polish slice.`,
    );
  }
}

function read(path: string) {
  return readFileSync(path, "utf8");
}
