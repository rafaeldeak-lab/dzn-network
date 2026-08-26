import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { publicCommunityMemberDirectorySafeguards } from "../functions/_lib/public-community-members";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertStaticContracts();
  assertDirectorySafeguards();
  assertProtectedInfluenceIsolation();
  console.log("Public community directory discovery polish tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    "components/community/public-community-members-page.tsx",
    "functions/_lib/public-community-members.ts",
    "functions/api/public/servers/[serverId]/community-members.ts",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
    "docs/COMMUNITY_MEMBER_DIRECTORY_PLAYER_HUB_POLISH_HANDOFF.md",
    "docs/PUBLIC_COMMUNITY_DIRECTORY_DISCOVERY_POLISH_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const page = read("components/community/public-community-members-page.tsx");
  for (const snippet of [
    "DirectorySortMode",
    "DirectoryGroupMode",
    "DirectoryContextGrid",
    "MemberProfileCard",
    "sortPublicCommunityMembers",
    "groupPublicCommunityMembers",
    "buildPublicDirectoryInsights",
    "publicMemberRoleGroup",
    "Featured order",
    "Name A-Z",
    "Role label",
    "Newest public month",
    "Group by role",
    "Group by joined",
    "No groups",
    "Sorting and grouping use public rows only.",
    "Only opted-in public DZN profiles returned by the directory API.",
    "Grouped from public role labels, not hidden Discord or import records.",
    "Directory presentation cannot change scoring, billing, rankings, or awards.",
    "Opt-in public",
  ]) {
    assert.equal(page.includes(snippet), true, `Public directory page must include ${snippet}.`);
  }
  assert.doesNotMatch(page, /dangerouslySetInnerHTML|localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(page, /method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']/i);
  assert.doesNotMatch(page, forbiddenProtectedInfluencePattern());
  assert.doesNotMatch(page, forbiddenProductionMutationPattern());

  const helper = read("functions/_lib/public-community-members.ts");
  for (const snippet of [
    "discovery_polish_presentation_only: true",
    "sorts_and_groups_public_rows_only: true",
    "affects_discovery_score: false",
    "affects_billing: false",
    "affects_rankings: false",
    "affects_reviews: false",
    "affects_badges: false",
    "affects_seasons: false",
    "affects_server_wars_scoring: false",
    "affects_xp_awards: false",
    "affects_calling_card_awards: false",
    "affects_competitive_eligibility: false",
  ]) {
    assert.equal(helper.includes(snippet), true, `Public community member helper must include ${snippet}.`);
  }
  assertNoSqlMutations(helper, "Discovery polish must not add SQL writes to the public community helper.");

  const route = read("functions/api/public/servers/[serverId]/community-members.ts");
  assert.equal(route.includes("request.method !== \"GET\""), true, "Community member API must remain GET-only.");
  assert.equal(route.includes("getPublicCommunityMemberDirectoryPayload"), true, "Community member API must keep using the canonical payload helper.");
  assert.doesNotMatch(route, /method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|requireOwnerRequestAccess|requireActiveOwnerEntitlement|createCheckoutSession/i);

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:public-community-directory-discovery-polish"), true, "Focused discovery polish test must be wired into package scripts.");

  const docs = [
    read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md"),
    read("docs/PUBLIC_ACCESS_POLICY.md"),
    read("docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md"),
    read("docs/COMMUNITY_MEMBER_DIRECTORY_PLAYER_HUB_POLISH_HANDOFF.md"),
    read("docs/PUBLIC_COMMUNITY_DIRECTORY_DISCOVERY_POLISH_HANDOFF.md"),
  ].join("\n");
  for (const snippet of [
    "Public Community Directory Discovery Polish Slice",
    "sorts and groups already-visible public rows only",
    "safe context cards",
    "retained export files, export-history rows, sharing links, storage bindings, retention write APIs",
    "Live checkout remains disabled",
    "Issue #49 remains reserved",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }
}

function assertDirectorySafeguards() {
  const safeguards = publicCommunityMemberDirectorySafeguards();
  assert.equal(safeguards.placement, "public_community_member_directory");
  assert.equal(safeguards.link_mode, "presentation_only");
  assert.equal(safeguards.discovery_polish_presentation_only, true);
  assert.equal(safeguards.sorts_and_groups_public_rows_only, true);
  assert.equal(safeguards.exposes_private_identifiers, false);
  assert.equal(safeguards.affects_ctf_scoring_rows, false);
  assert.equal(safeguards.affects_owner_workflow_rows, false);
  assert.equal(safeguards.affects_approval_decisions, false);
  assert.equal(safeguards.affects_bracket_outcomes, false);
  assert.equal(safeguards.affects_billing, false);
  assert.equal(safeguards.affects_rankings, false);
  assert.equal(safeguards.affects_discovery_score, false);
  assert.equal(safeguards.affects_reviews, false);
  assert.equal(safeguards.affects_badges, false);
  assert.equal(safeguards.affects_seasons, false);
  assert.equal(safeguards.affects_server_wars_scoring, false);
  assert.equal(safeguards.affects_xp_awards, false);
  assert.equal(safeguards.affects_calling_card_awards, false);
  assert.equal(safeguards.affects_competitive_eligibility, false);

  for (const [flag, value] of Object.entries(safeguards.fairness)) {
    assert.equal(value, false, `${flag} must remain false.`);
  }
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
    "functions/api/player/saved-servers.ts",
    "functions/api/player/reviews.ts",
    "functions/api/reviews/moderation.ts",
    "functions/api/reviews/moderation/bulk.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /DirectoryContextGrid|DirectorySortMode|DirectoryGroupMode|sortPublicCommunityMembers|groupPublicCommunityMembers|discovery_polish_presentation_only|sorts_and_groups_public_rows_only/i,
      `${file} must not depend on public directory discovery presentation polish.`,
    );
  }
}

function assertNoSqlMutations(source: string, message: string) {
  const sqlTemplates = source.match(/`[\s\S]*?`/g) ?? [];
  for (const template of sqlTemplates) {
    assert.doesNotMatch(template, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i, message);
  }
}

function forbiddenProtectedInfluencePattern() {
  return /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bserver_rankings\b|\bdiscovery_score\b|\bserver_reviews\b|\breview_score\b|\bserver_badge_awards\b|\bbadge_unlock_progress\b|\bdzn_seasons\b|\bcompetitive_events\b|\bcompetitive_event_matches\b|\bctf_tournament\b|\bevent_matchups\b|\bevent_participants\b|\bserver_war_score_snapshots\b|\bserver_war_events\b|\bplayer_progression_award_sources\b|\bplayer_xp\b|\bcalling_card\b|\bstripe\b|\bnitrado\b|\bdiscord_oauth_tokens\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i;
}

function forbiddenProductionMutationPattern() {
  return /\bcreateCheckoutSession\b|\bstripeFormRequest\b|\bSTRIPE_SECRET_KEY\b|\bDZN_LIVE_CHECKOUT_ENABLED\s*=\s*true\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bwrangler\s+d1\b|\bwrangler\s+secret\b|\bfetchDiscordApi\b|\bfetchNitrado\b/i;
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}
