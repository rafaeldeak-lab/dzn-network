import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  actOnCommunityMemberCandidate,
  communityMemberSourceManagementSafeguards,
  createCommunityMemberCandidate,
  listCommunityMemberSourceManagement,
} from "../functions/_lib/community-member-source-management";
import type { Env, SessionUser } from "../functions/_lib/types";

type CapturedOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

type FakeServer = {
  id: string;
  user_id: string;
  public_slug: string | null;
  display_name: string;
  hostname: string | null;
  server_name: string;
  nitrado_service_name: string | null;
  status: string;
  discord_guild_id: string;
};

type FakeGuild = {
  id: string;
  name: string;
};

type FakeUser = {
  id: string;
  discord_id: string;
  username: string;
};

type FakePrivacy = {
  user_id: string;
  public_profile_enabled: number;
  public_handle: string | null;
};

type FakeCandidate = {
  id: string;
  linked_server_id: string;
  community_guild_id: string;
  candidate_discord_id: string | null;
  candidate_username: string | null;
  candidate_display_name: string | null;
  role_label: string | null;
  source: string;
  status: string;
  match_status: string;
  matched_user_id: string | null;
  imported_member_id: string | null;
  reason: string | null;
  created_by_user_id: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type FakeCommunityMember = {
  id: string;
  community_guild_id: string;
  user_id: string;
  role_label: string | null;
  display_order: number;
  public_member_enabled: number;
  source: string;
  created_at: string;
  updated_at: string;
};

type FakeAudit = {
  id: string;
  candidate_id: string | null;
  community_member_id: string | null;
  linked_server_id: string;
  community_guild_id: string;
  actor_user_id: string;
  actor_role: string;
  action: string;
  result_status: string;
  reason: string | null;
  created_at: string;
};

type FakeSnapshot = {
  id: string;
  linked_server_id: string;
  community_guild_id: string;
  candidate_discord_id: string;
  candidate_username: string | null;
  candidate_display_name: string | null;
  role_label: string | null;
  source: string;
  trust_status: string;
  captured_at: string;
};

type FakeNotification = {
  id: string;
  user_id: string;
  server_id: string | null;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  dedupe_key: string;
  metadata: string | null;
  read_at: string | null;
  created_at: string;
};

type FakeState = {
  operations: CapturedOperation[];
  servers: FakeServer[];
  guilds: FakeGuild[];
  users: FakeUser[];
  privacy: FakePrivacy[];
  candidates: FakeCandidate[];
  communityMembers: FakeCommunityMember[];
  audit: FakeAudit[];
  snapshots: FakeSnapshot[];
  notifications: FakeNotification[];
};

const OWNER_USER: SessionUser = {
  id: "owner-user",
  discord_id: "owner-discord",
  username: "DZN Owner",
  avatar: null,
};

const OTHER_OWNER_USER: SessionUser = {
  id: "other-owner",
  discord_id: "other-owner-discord",
  username: "Other Owner",
  avatar: null,
};

async function main() {
  assertStaticContracts();
  assertSafeguards();
  await assertCandidateImportFlow();
  await assertOwnerScopeAndAmbiguousRejection();
  await assertImportPreviewPolishAndNotifications();
  console.log("Community member source management and import usability tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    "migrations/0068_community_member_source_management_audit.sql",
    "migrations/0069_community_member_import_usability_polish.sql",
    "functions/_lib/community-member-source-management.ts",
    "functions/_lib/dzn-pulse.ts",
    "functions/api/owner/community-members.ts",
    "functions/api/owner/community-members/[candidateId].ts",
    "components/community/community-member-source-dashboard.tsx",
    "app/dashboard/community-members/page.tsx",
    "app/owner/community-members/page.tsx",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/COMMUNITY_MEMBER_SOURCE_MANAGEMENT_AUDIT_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const migration = read("migrations/0068_community_member_source_management_audit.sql");
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS community_member_candidates",
    "CREATE TABLE IF NOT EXISTS community_member_source_audit",
    "candidate_discord_id TEXT",
    "status TEXT NOT NULL DEFAULT 'pending'",
    "match_status TEXT NOT NULL DEFAULT 'pending'",
    "matched_user_id TEXT",
    "imported_member_id TEXT",
    "action TEXT NOT NULL CHECK",
    "duplicate_rejected",
    "ambiguous_rejected",
    "FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)",
    "FOREIGN KEY(community_guild_id) REFERENCES discord_guilds(id)",
    "FOREIGN KEY(matched_user_id) REFERENCES users(id)",
    "idx_community_member_candidates_scope",
    "idx_community_member_source_audit_scope",
  ]) {
    assert.equal(migration.includes(snippet), true, `Migration must include ${snippet}.`);
  }
  assert.doesNotMatch(migration, /\bplayer_stats\b/i, "This slice must not create or depend on player_stats.");
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/i, "Migration must be additive only.");

  const polishMigration = read("migrations/0069_community_member_import_usability_polish.sql");
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS community_member_source_snapshots",
    "candidate_discord_id TEXT NOT NULL",
    "trust_status TEXT NOT NULL DEFAULT 'trusted'",
    "idx_community_member_source_snapshots_lookup",
    "idx_user_notifications_community_member_importable",
    "WHERE type = 'community_member_candidate_importable'",
  ]) {
    assert.equal(polishMigration.includes(snippet), true, `Polish migration must include ${snippet}.`);
  }
  assert.doesNotMatch(polishMigration, /\b(?:DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/i, "Polish migration must be additive only.");

  const helper = read("functions/_lib/community-member-source-management.ts");
  for (const snippet of [
    "authorizeCommunityMemberSourceRequest",
    "requireActiveOwnerEntitlement",
    "isDznAdminDiscordId",
    "communityMemberSourceManagementSafeguards",
    "resolveTrustedUserBridge",
    "readExistingCommunityMemberId",
    "community_member_candidates",
    "community_member_source_audit",
    "community_member_source_snapshots",
    "community_members",
    "user_notifications",
    "player_profile_privacy_preferences",
    "candidate_preview_refreshed",
    "candidate_importable",
    "\"refresh_preview\"",
    "appendCandidateIssueFilter",
    "candidateSnapshotSelectSql",
    "buildImportPreview",
    "maybeNotifyCommunityMemberImportable",
    "community_member_candidate_importable",
    "candidate_discord_id_masked",
    "public_profile_link_requires_player_opt_in_handle: true",
    "import_preview_requires_trusted_bridge: true",
    "import_previews_from_trusted_snapshots_where_available: true",
    "admin_repeated_source_filters: true",
    "owner_importable_notification_hook: true",
    "notification_hook_dzn_pulse_only: true",
    "notification_read_state_private_per_owner: true",
    "rejects_duplicate_members: true",
    "rejects_ambiguous_user_bridge: true",
    "affects_ctf_scoring_rows: false",
    "affects_owner_workflow_decisions: false",
    "affects_approval_decisions: false",
    "affects_bracket_outcomes: false",
    "affects_billing: false",
    "affects_rankings: false",
    "affects_discovery_score: false",
    "affects_reviews: false",
    "affects_badges: false",
    "affects_seasons: false",
    "affects_server_wars_scoring: false",
    "affects_xp_awards: false",
    "affects_calling_card_awards: false",
    "affects_competitive_eligibility: false",
  ]) {
    assert.equal(helper.includes(snippet), true, `Helper must include ${snippet}.`);
  }
  assertNoForbiddenMutationTargets(helper, "Source management helper");
  assertNoExternalOrLivePaymentMutation(helper, "Source management helper");

  const pulse = read("functions/_lib/dzn-pulse.ts");
  for (const snippet of [
    "PULSE_COMMUNITY_NOTIFICATION_TYPES",
    "community_member_candidate_importable",
    "\"community\"",
    "Community",
  ]) {
    assert.equal(pulse.includes(snippet), true, `DZN Pulse must include ${snippet}.`);
  }

  const listRoute = read("functions/api/owner/community-members.ts");
  for (const snippet of [
    "authorizeCommunityMemberSourceRequest(env, request)",
    "listCommunityMemberSourceManagement",
    "createCommunityMemberCandidate",
    "readBoundedJson<CommunityMemberCandidateInput>",
    "privateNoStoreHeaders",
    "methodNotAllowed",
  ]) {
    assert.equal(listRoute.includes(snippet), true, `Owner community members route must include ${snippet}.`);
  }
  assertOrder(listRoute.slice(listRoute.indexOf("export const onRequestPost")), "authorizeCommunityMemberSourceRequest", "readBoundedJson", "candidate create route must authorize before reading the body");
  assertNoExternalOrLivePaymentMutation(listRoute, "Owner community members route");

  const actionRoute = read("functions/api/owner/community-members/[candidateId].ts");
  for (const snippet of [
    "authorizeCommunityMemberSourceRequest(env, request)",
    "actOnCommunityMemberCandidate",
    "readBoundedJson<CommunityMemberCandidateActionInput>",
    "privateNoStoreHeaders",
    "methodNotAllowed",
  ]) {
    assert.equal(actionRoute.includes(snippet), true, `Owner community member action route must include ${snippet}.`);
  }
  assertOrder(actionRoute.slice(actionRoute.indexOf("export const onRequestPost")), "authorizeCommunityMemberSourceRequest", "readBoundedJson", "candidate action route must authorize before reading the body");
  assertNoExternalOrLivePaymentMutation(actionRoute, "Owner community member action route");

  const ui = read("components/community/community-member-source-dashboard.tsx");
  for (const snippet of [
    "CommunityMemberSourceDashboard",
    "/api/owner/community-members",
    "Candidate Source Queue",
    "Duplicate/ambiguous-user rejection",
    "presentation-only community_members bridge",
    "safer import previews",
    "Import preview",
    "Refresh preview",
    "Repeated no-match",
    "Repeated duplicate",
    "public profile opt-in handle",
    "CTF scoring rows",
    "Hidden until player opt-in",
    "Source audit history",
    "method: \"POST\"",
  ]) {
    assert.equal(ui.includes(snippet), true, `Source dashboard UI must include ${snippet}.`);
  }
  assert.doesNotMatch(ui, /dangerouslySetInnerHTML|DZN_LIVE_CHECKOUT_ENABLED|createCheckoutSession|stripe|NITRADO_TOKEN|DISCORD_BOT_TOKEN|fetchNitrado|fetchDiscord/i, "UI must not touch checkout, secrets, or external services.");

  const dashboard = read("components/onboarding/dashboard.tsx");
  for (const snippet of [
    "CommunityMemberSourceDashboard",
    "\"community-members\"",
    "Community Members",
    "Trusted source review, imports, duplicate checks, and audit history.",
  ]) {
    assert.equal(dashboard.includes(snippet), true, `Owner dashboard must include ${snippet}.`);
  }

  const ownerConsole = read("components/owner/owner-console.tsx");
  for (const snippet of [
    "Community Members",
    "Open Community Members",
    "/owner/community-members",
    "player opt-in only",
    "cannot affect CTF scoring rows",
  ]) {
    assert.equal(ownerConsole.includes(snippet), true, `Owner console must include ${snippet}.`);
  }

  const dashboardPage = read("app/dashboard/community-members/page.tsx");
  assert.equal(dashboardPage.includes("CommunityMemberSourceDashboard"), true);
  assert.equal(dashboardPage.includes("homeHref=\"/dashboard\""), true);
  const ownerPage = read("app/owner/community-members/page.tsx");
  assert.equal(ownerPage.includes("CommunityMemberSourceDashboard"), true);
  assert.equal(ownerPage.includes("homeHref=\"/owner\""), true);

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:community-member-source-management-audit"), true, "Focused source management audit test must be wired into package scripts.");
  assert.equal(packageJson.includes("test:community-member-import-usability-polish"), true, "Focused import usability polish test must be wired into package scripts.");

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  for (const snippet of [
    "Trusted Community Member Source Management and Audit Slice",
    "Community Member Import Usability Polish Slice",
    "`community_member_candidates`",
    "`community_member_source_audit`",
    "`community_member_source_snapshots`",
    "`user_notifications`",
    "`/api/owner/community-members`",
    "`/dashboard/community-members`",
    "duplicate and ambiguous user bridges are rejected",
    "safer import previews",
    "repeated no-match",
    "community_member_candidate_importable",
    "cannot make a player publicly visible without the player's opt-in generated handle",
  ]) {
    assert.equal(platformSpec.includes(snippet), true, `Master spec must document ${snippet}.`);
  }

  const accessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  for (const snippet of [
    "`/dashboard/community-members`",
    "`/owner/community-members`",
    "owner/admin-only community member source management",
    "trusted Discord/guild snapshot previews",
    "community_member_candidate_importable",
    "Public profile visibility still requires the player's opt-in generated handle",
  ]) {
    assert.equal(accessPolicy.includes(snippet), true, `Public access policy must document ${snippet}.`);
  }
}

function assertSafeguards() {
  const safeguards = communityMemberSourceManagementSafeguards();
  assert.equal(safeguards.access, "owner_admin_only");
  assert.equal(safeguards.public_profile_link_requires_player_opt_in_handle, true);
  assert.equal(safeguards.trusted_dzn_user_bridge_required, true);
  assert.equal(safeguards.import_preview_requires_trusted_bridge, true);
  assert.equal(safeguards.import_previews_from_trusted_snapshots_where_available, true);
  assert.equal(safeguards.admin_repeated_source_filters, true);
  assert.equal(safeguards.owner_importable_notification_hook, true);
  assert.equal(safeguards.notification_hook_dzn_pulse_only, true);
  assert.equal(safeguards.notification_read_state_private_per_owner, true);
  assert.equal(safeguards.rejects_duplicate_members, true);
  assert.equal(safeguards.rejects_ambiguous_user_bridge, true);
  assert.equal(safeguards.mutates_live_checkout, false);
  assert.equal(safeguards.mutates_stripe_products_or_prices, false);
  assert.equal(safeguards.mutates_cloudflare_secrets, false);
  assert.equal(safeguards.mutates_production_d1, false);
  assert.equal(safeguards.mutates_nitrado, false);
  assert.equal(safeguards.mutates_discord, false);
  assert.equal(safeguards.merges_issue_49, false);
  for (const key of [
    "affects_public_profile_visibility_without_player_opt_in_handle",
    "affects_ctf_scoring_rows",
    "affects_owner_workflow_decisions",
    "affects_approval_decisions",
    "affects_bracket_outcomes",
    "affects_billing",
    "affects_rankings",
    "affects_discovery_score",
    "affects_reviews",
    "affects_badges",
    "affects_seasons",
    "affects_server_wars_scoring",
    "affects_xp_awards",
    "affects_calling_card_awards",
    "affects_competitive_eligibility",
  ] as const) {
    assert.equal(safeguards[key], false, `${key} must remain false.`);
  }
}

async function assertCandidateImportFlow() {
  const state = createFakeState();
  const env = { DB: createFakeDb(state) } as Env;
  const ownerActor = { user: OWNER_USER, role: "owner" as const };

  const createResult = await createCommunityMemberCandidate(env, ownerActor, {
    linked_server_id: "server-1",
    candidate_discord_id: "111122223333444455",
    candidate_display_name: "Visible but private member",
    role_label: "Raid Lead",
    reason: "Discord roster import reviewed by owner.",
  });
  assert.equal(createResult.ok, true);
  assert.equal(createResult.candidate?.match_status, "matched");
  assert.equal(createResult.candidate?.public_profile_linkable, false, "Import candidate must not make a profile public.");
  assert.equal(createResult.candidate?.candidate_discord_id_masked, "1111...4455");

  const candidateId = createResult.candidate?.id;
  assert.ok(candidateId);
  const importResult = await actOnCommunityMemberCandidate(env, ownerActor, candidateId, {
    action: "import",
    reason: "Unique DZN user bridge approved.",
  });
  assert.equal(importResult.ok, true);
  if (!("member" in importResult)) assert.fail("Import action must return the imported community member payload.");
  assert.equal(importResult.member?.source, "trusted_dzn_bridge");
  assert.equal(state.communityMembers.length, 1);
  assert.equal(state.privacy.find((item) => item.user_id === "player-1")?.public_profile_enabled, 0, "Owner import must not alter player profile privacy.");
  assert.equal(state.privacy.find((item) => item.user_id === "player-1")?.public_handle, null, "Owner import must not generate a public handle.");

  const duplicateCandidate = await createCommunityMemberCandidate(env, ownerActor, {
    linked_server_id: "server-1",
    candidate_discord_id: "111122223333444455",
    candidate_display_name: "Duplicate member",
  });
  assert.equal(duplicateCandidate.ok, true);
  assert.equal(duplicateCandidate.candidate?.status, "duplicate");
  assert.equal(duplicateCandidate.candidate?.match_status, "duplicate");

  const duplicateImport = await actOnCommunityMemberCandidate(env, ownerActor, duplicateCandidate.candidate?.id, { action: "import" });
  assert.equal(duplicateImport.ok, false);
  assert.equal(duplicateImport.status, 409);
  assert.equal(duplicateImport.error, "DUPLICATE_COMMUNITY_MEMBER");
  assert.equal(state.communityMembers.length, 1, "Duplicate import must not create another bridge row.");

  const list = await listCommunityMemberSourceManagement(env, ownerActor, { status: "all", limit: 80 });
  assert.equal(list.candidates.length, 2);
  assert.ok(list.audit.some((item) => item.action === "candidate_imported"));
  assert.ok(list.audit.some((item) => item.action === "duplicate_rejected"));
  assert.equal(list.safeguards.affects_billing, false);
  assertNoForbiddenSqlWrites(state.operations);
}

async function assertOwnerScopeAndAmbiguousRejection() {
  const state = createFakeState();
  state.users.push({ id: "player-ambiguous-a", discord_id: "999988887777666655", username: "Ambiguous A" });
  state.users.push({ id: "player-ambiguous-b", discord_id: "999988887777666655", username: "Ambiguous B" });
  const env = { DB: createFakeDb(state) } as Env;
  const ownerActor = { user: OWNER_USER, role: "owner" as const };
  const otherActor = { user: OTHER_OWNER_USER, role: "owner" as const };

  const notOwned = await createCommunityMemberCandidate(env, otherActor, {
    linked_server_id: "server-1",
    candidate_discord_id: "111122223333444455",
  });
  assert.equal(notOwned.ok, false);
  assert.equal(notOwned.status, 404, "Owners must not manage another owner's community source rows.");

  const ambiguous = await createCommunityMemberCandidate(env, ownerActor, {
    linked_server_id: "server-1",
    candidate_discord_id: "999988887777666655",
    candidate_display_name: "Ambiguous member",
  });
  assert.equal(ambiguous.ok, true);
  assert.equal(ambiguous.candidate?.status, "ambiguous");
  assert.equal(ambiguous.candidate?.match_status, "ambiguous");
  assert.equal(state.communityMembers.length, 0);
  assert.ok(state.audit.some((item) => item.action === "ambiguous_rejected"));
  assertNoForbiddenSqlWrites(state.operations);
}

async function assertImportPreviewPolishAndNotifications() {
  const state = createFakeState();
  state.snapshots.push({
    id: "snapshot-1",
    linked_server_id: "server-1",
    community_guild_id: "guild-row-1",
    candidate_discord_id: "222233334444555566",
    candidate_username: "late-bridge",
    candidate_display_name: "Late Bridge Member",
    role_label: "Scout",
    source: "discord_guild_snapshot",
    trust_status: "trusted",
    captured_at: "2026-08-26T08:45:00.000Z",
  });
  const env = { DB: createFakeDb(state), DZN_PULSE_ENABLED: "true" } as Env;
  const ownerActor = { user: OWNER_USER, role: "owner" as const };

  const noMatch = await createCommunityMemberCandidate(env, ownerActor, {
    linked_server_id: "server-1",
    candidate_discord_id: "222233334444555566",
    candidate_display_name: "Late Bridge Member",
    source: "discord_guild_snapshot",
  });
  assert.equal(noMatch.ok, true);
  assert.equal(noMatch.candidate?.match_status, "no_match");
  assert.equal(noMatch.candidate?.import_preview.can_import, false);
  assert.equal(noMatch.candidate?.import_preview.source_trust, "trusted_snapshot");
  assert.equal(noMatch.candidate?.import_preview.snapshot?.source, "discord_guild_snapshot");
  assert.equal(state.notifications.length, 0, "Blocked no-match candidates must not notify owners as importable.");
  assert.ok(state.audit.some((item) => item.action === "candidate_no_match"));

  state.users.push({ id: "player-2", discord_id: "222233334444555566", username: "Late Bridge User" });
  const refreshed = await actOnCommunityMemberCandidate(env, ownerActor, noMatch.candidate?.id, {
    action: "refresh_preview",
    reason: "DZN user logged in after the snapshot was captured.",
  });
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.candidate?.match_status, "matched");
  assert.equal(refreshed.candidate?.import_preview.can_import, true);
  assert.equal(refreshed.candidate?.import_preview.source_trust, "trusted_snapshot");
  assert.equal(state.audit.some((item) => item.action === "candidate_preview_refreshed"), true);
  assert.equal(state.audit.some((item) => item.action === "candidate_importable"), true);
  assert.equal(state.notifications.length, 1, "Importable transition should create one private owner Pulse notification.");
  assert.equal(state.notifications[0].user_id, OWNER_USER.id);
  assert.equal(state.notifications[0].type, "community_member_candidate_importable");
  assert.match(state.notifications[0].action_url ?? "", /\/dashboard\/community-members\?status=pending&issue=importable/);
  assert.equal(state.notifications.some((item) => item.user_id === OTHER_OWNER_USER.id), false, "Importable notification must not leak to another owner.");

  const importableList = await listCommunityMemberSourceManagement(env, ownerActor, { status: "pending", issue: "importable", limit: 80 });
  assert.equal(importableList.filters.issue, "importable");
  assert.equal(importableList.candidates.some((candidate) => candidate.id === refreshed.candidate?.id), true);

  state.candidates.push(makeCandidate("repeat-no-match-a", "555544443333222211", "no_match", "pending"));
  state.candidates.push(makeCandidate("repeat-no-match-b", "555544443333222211", "no_match", "pending"));
  state.candidates.push(makeCandidate("repeat-duplicate-a", "111122223333444455", "duplicate", "duplicate", "player-1", "member-existing"));
  state.candidates.push(makeCandidate("repeat-duplicate-b", "111122223333444455", "duplicate", "duplicate", "player-1", "member-existing"));
  const adminActor = { user: OWNER_USER, role: "admin" as const };
  const repeatedNoMatch = await listCommunityMemberSourceManagement(env, adminActor, { status: "all", issue: "repeated_no_match", limit: 80 });
  assert.equal(repeatedNoMatch.filters.issue, "repeated_no_match");
  assert.equal(repeatedNoMatch.candidates.filter((candidate) => candidate.match_status === "no_match").length >= 2, true);
  const repeatedDuplicate = await listCommunityMemberSourceManagement(env, adminActor, { status: "all", issue: "repeated_duplicate", limit: 80 });
  assert.equal(repeatedDuplicate.filters.issue, "repeated_duplicate");
  assert.equal(repeatedDuplicate.candidates.filter((candidate) => candidate.match_status === "duplicate").length >= 2, true);

  assert.equal(state.privacy.find((item) => item.user_id === "player-2"), undefined, "Preview refresh must not create profile privacy preferences.");
  assertNoForbiddenSqlWrites(state.operations);
}

function makeCandidate(
  id: string,
  candidateDiscordId: string,
  matchStatus: string,
  status: string,
  matchedUserId: string | null = null,
  importedMemberId: string | null = null,
): FakeCandidate {
  return {
    id,
    linked_server_id: "server-1",
    community_guild_id: "guild-row-1",
    candidate_discord_id: candidateDiscordId,
    candidate_username: null,
    candidate_display_name: id,
    role_label: null,
    source: "discord_guild_snapshot",
    status,
    match_status: matchStatus,
    matched_user_id: matchedUserId,
    imported_member_id: importedMemberId,
    reason: null,
    created_by_user_id: OWNER_USER.id,
    reviewed_by_user_id: null,
    reviewed_at: null,
    created_at: "2026-08-26T10:00:00.000Z",
    updated_at: "2026-08-26T10:00:00.000Z",
  };
}

function createFakeState(): FakeState {
  return {
    operations: [],
    servers: [
      {
        id: "server-1",
        user_id: OWNER_USER.id,
        public_slug: "nuketown",
        display_name: "NukeTown Deathmatch",
        hostname: null,
        server_name: "NukeTown",
        nitrado_service_name: null,
        status: "active",
        discord_guild_id: "guild-row-1",
      },
    ],
    guilds: [{ id: "guild-row-1", name: "NukeTown Discord" }],
    users: [
      { id: OWNER_USER.id, discord_id: OWNER_USER.discord_id, username: OWNER_USER.username },
      { id: OTHER_OWNER_USER.id, discord_id: OTHER_OWNER_USER.discord_id, username: OTHER_OWNER_USER.username },
      { id: "player-1", discord_id: "111122223333444455", username: "Visible Player" },
    ],
    privacy: [{ user_id: "player-1", public_profile_enabled: 0, public_handle: null }],
    candidates: [],
    communityMembers: [],
    audit: [],
    snapshots: [],
    notifications: [],
  };
}

function createFakeDb(state: FakeState): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            all: async <T>() => {
              state.operations.push({ kind: "all", sql, bindings });
              return { results: selectAll(state, sql, bindings) as T[] };
            },
            first: async <T>() => {
              state.operations.push({ kind: "first", sql, bindings });
              return selectFirst(state, sql, bindings) as T | null;
            },
            run: async () => {
              state.operations.push({ kind: "run", sql, bindings });
              mutate(state, sql, bindings);
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function selectAll(state: FakeState, sql: string, bindings: unknown[]) {
  if (sql.includes("FROM linked_servers") && sql.includes("INNER JOIN discord_guilds") && !sql.includes("community_member_candidates") && !sql.includes("community_member_source_audit")) {
    return state.servers
      .filter((server) => server.status !== "deleted" && ownerMatches(state, server, bindings[0]))
      .map((server) => serverRow(state, server));
  }
  if (sql.includes("FROM users WHERE discord_id")) {
    return state.users.filter((user) => user.discord_id === bindings[0]);
  }
  if (sql.includes("FROM community_member_candidates") && sql.includes("ORDER BY")) {
    const statusFilter = sql.includes("community_member_candidates.status = ?") ? String(bindings.find((value) => typeof value === "string" && ["pending", "imported", "rejected", "duplicate", "ambiguous"].includes(value))) : null;
    const issueFilter = sql.includes("existing_members.id IS NULL") && sql.includes("match_status = 'matched'")
      ? "importable"
      : sql.includes("repeated_candidates.match_status = 'no_match'")
        ? "repeated_no_match"
        : sql.includes("repeated_candidates.match_status = 'duplicate'")
          ? "repeated_duplicate"
          : "all";
    return state.candidates
      .filter((candidate) => scopedCandidate(state, candidate, bindings))
      .filter((candidate) => !statusFilter || candidate.status === statusFilter)
      .filter((candidate) => matchesIssueFilter(state, candidate, issueFilter))
      .map((candidate) => candidateRow(state, candidate));
  }
  if (sql.includes("FROM community_member_source_audit")) {
    return state.audit
      .filter((audit) => scopedAudit(state, audit, bindings))
      .map((audit) => auditRow(state, audit));
  }
  if (sql.includes("GROUP BY community_member_candidates.status")) {
    return ["pending", "imported", "rejected", "duplicate", "ambiguous"].map((status) => ({
      status,
      count: state.candidates.filter((candidate) => candidate.status === status && scopedCandidate(state, candidate, bindings)).length,
    }));
  }
  return [];
}

function selectFirst(state: FakeState, sql: string, bindings: unknown[]) {
  if (sql.includes("FROM linked_servers") && sql.includes("LEFT JOIN discord_guilds")) {
    const linkedServerId = String(bindings[bindings.length - 1] ?? "");
    const server = state.servers.find((item) => item.id === linkedServerId && ownerMatches(state, item, bindings[0]));
    return server ? serverRow(state, server) : null;
  }
  if (sql.includes("FROM users WHERE id")) {
    return state.users.find((user) => user.id === bindings[0]) ?? null;
  }
  if (sql.includes("FROM community_members")) {
    return state.communityMembers.find((member) => member.community_guild_id === bindings[0] && member.user_id === bindings[1]) ?? null;
  }
  if (sql.includes("SELECT candidate_discord_id FROM community_member_candidates")) {
    const candidate = state.candidates.find((item) => item.id === bindings[0]);
    return candidate ? { candidate_discord_id: candidate.candidate_discord_id } : null;
  }
  if (sql.includes("FROM community_member_candidates")) {
    const candidateId = String(bindings[bindings.length - 1] ?? "");
    const candidate = state.candidates.find((item) => item.id === candidateId && scopedCandidate(state, item, bindings));
    return candidate ? candidateRow(state, candidate) : null;
  }
  return null;
}

function mutate(state: FakeState, sql: string, bindings: unknown[]) {
  if (sql.includes("INSERT INTO community_member_candidates")) {
    state.candidates.push({
      id: String(bindings[0]),
      linked_server_id: String(bindings[1]),
      community_guild_id: String(bindings[2]),
      candidate_discord_id: nullableString(bindings[3]),
      candidate_username: nullableString(bindings[4]),
      candidate_display_name: nullableString(bindings[5]),
      role_label: nullableString(bindings[6]),
      source: String(bindings[7]),
      status: String(bindings[8]),
      match_status: String(bindings[9]),
      matched_user_id: nullableString(bindings[10]),
      imported_member_id: nullableString(bindings[11]),
      reason: nullableString(bindings[12]),
      created_by_user_id: String(bindings[13]),
      reviewed_by_user_id: nullableString(bindings[14]),
      reviewed_at: nullableString(bindings[15]),
      created_at: "2026-08-26T10:00:00.000Z",
      updated_at: "2026-08-26T10:00:00.000Z",
    });
    return;
  }
  if (sql.includes("INSERT INTO community_member_source_audit")) {
    state.audit.push({
      id: String(bindings[0]),
      candidate_id: nullableString(bindings[1]),
      community_member_id: nullableString(bindings[2]),
      linked_server_id: String(bindings[3]),
      community_guild_id: String(bindings[4]),
      actor_user_id: String(bindings[5]),
      actor_role: String(bindings[6]),
      action: String(bindings[7]),
      result_status: String(bindings[8]),
      reason: nullableString(bindings[9]),
      created_at: "2026-08-26T10:00:00.000Z",
    });
    return;
  }
  if (sql.includes("INSERT INTO community_members")) {
    state.communityMembers.push({
      id: String(bindings[0]),
      community_guild_id: String(bindings[1]),
      user_id: String(bindings[2]),
      role_label: nullableString(bindings[3]),
      display_order: 0,
      public_member_enabled: Number(bindings[4]),
      source: "trusted_dzn_bridge",
      created_at: "2026-08-26T10:00:00.000Z",
      updated_at: "2026-08-26T10:00:00.000Z",
    });
    return;
  }
  if (sql.includes("matched_user_id = ?") && sql.includes("imported_member_id = ?") && sql.includes("SET status = ?")) {
    const candidate = state.candidates.find((item) => item.id === bindings[6]);
    if (!candidate) return;
    candidate.status = String(bindings[0]);
    candidate.match_status = String(bindings[1]);
    candidate.matched_user_id = nullableString(bindings[2]);
    candidate.imported_member_id = nullableString(bindings[3]);
    candidate.reviewed_by_user_id = nullableString(bindings[4]);
    candidate.reviewed_at = "2026-08-26T10:05:00.000Z";
    candidate.reason = nullableString(bindings[5]) ?? candidate.reason;
    return;
  }
  if (sql.includes("SET status = 'imported'")) {
    const candidate = state.candidates.find((item) => item.id === bindings[5]);
    if (!candidate) return;
    candidate.status = "imported";
    candidate.match_status = "matched";
    candidate.matched_user_id = nullableString(bindings[0]);
    candidate.imported_member_id = nullableString(bindings[1]);
    candidate.reviewed_by_user_id = nullableString(bindings[2]);
    candidate.reviewed_at = "2026-08-26T10:03:00.000Z";
    candidate.role_label = nullableString(bindings[3]) ?? candidate.role_label;
    candidate.reason = nullableString(bindings[4]) ?? candidate.reason;
    return;
  }
  if (sql.includes("SET status = 'duplicate'")) {
    const candidate = state.candidates.find((item) => item.id === bindings[5]);
    if (!candidate) return;
    candidate.status = "duplicate";
    candidate.match_status = "duplicate";
    candidate.matched_user_id = nullableString(bindings[0]);
    candidate.imported_member_id = nullableString(bindings[1]);
    candidate.reviewed_by_user_id = nullableString(bindings[2]);
    candidate.reviewed_at = "2026-08-26T10:04:00.000Z";
    candidate.reason = nullableString(bindings[3]) ?? candidate.reason;
    return;
  }
  if (sql.includes("SET status = 'rejected'")) {
    const candidate = state.candidates.find((item) => item.id === bindings[2]);
    if (!candidate) return;
    candidate.status = "rejected";
    candidate.reviewed_by_user_id = nullableString(bindings[0]);
    candidate.reason = nullableString(bindings[1]) ?? candidate.reason;
    return;
  }
  if (sql.includes("INSERT OR IGNORE INTO user_notifications")) {
    const userId = String(bindings[1]);
    const dedupeKey = String(bindings[11]);
    if (state.notifications.some((item) => item.user_id === userId && item.dedupe_key === dedupeKey)) return;
    state.notifications.push({
      id: String(bindings[0]),
      user_id: userId,
      server_id: nullableString(bindings[2]),
      type: String(bindings[5]),
      title: String(bindings[6]),
      body: String(bindings[7]),
      action_url: nullableString(bindings[9]),
      dedupe_key: dedupeKey,
      metadata: nullableString(bindings[12]),
      read_at: null,
      created_at: String(bindings[13]),
    });
  }
}

function serverRow(state: FakeState, server: FakeServer) {
  const guild = state.guilds.find((item) => item.id === server.discord_guild_id);
  return {
    id: server.id,
    user_id: server.user_id,
    public_slug: server.public_slug,
    server_name: server.display_name,
    community_guild_id: guild?.id ?? null,
    community_name: guild?.name ?? null,
  };
}

function candidateRow(state: FakeState, candidate: FakeCandidate) {
  const server = state.servers.find((item) => item.id === candidate.linked_server_id);
  const guild = state.guilds.find((item) => item.id === candidate.community_guild_id);
  const user = state.users.find((item) => item.id === candidate.matched_user_id);
  const privacy = state.privacy.find((item) => item.user_id === candidate.matched_user_id);
  const existingMember = state.communityMembers.find((item) => item.community_guild_id === candidate.community_guild_id && item.user_id === candidate.matched_user_id);
  const snapshot = state.snapshots
    .filter((item) => item.linked_server_id === candidate.linked_server_id && item.community_guild_id === candidate.community_guild_id && item.candidate_discord_id === candidate.candidate_discord_id && item.trust_status === "trusted")
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0];
  return {
    ...candidate,
    owner_user_id: server?.user_id ?? null,
    server_name: server?.display_name ?? null,
    public_slug: server?.public_slug ?? null,
    community_name: guild?.name ?? null,
    matched_username: user?.username ?? null,
    existing_member_id: existingMember?.id ?? null,
    public_profile_enabled: privacy?.public_profile_enabled ?? null,
    public_handle: privacy?.public_handle ?? null,
    snapshot_source: snapshot?.source ?? null,
    snapshot_trust_status: snapshot?.trust_status ?? null,
    snapshot_captured_at: snapshot?.captured_at ?? null,
    snapshot_username: snapshot?.candidate_username ?? null,
    snapshot_display_name: snapshot?.candidate_display_name ?? null,
    snapshot_role_label: snapshot?.role_label ?? null,
  };
}

function auditRow(state: FakeState, audit: FakeAudit) {
  const server = state.servers.find((item) => item.id === audit.linked_server_id);
  const guild = state.guilds.find((item) => item.id === audit.community_guild_id);
  return {
    ...audit,
    server_name: server?.display_name ?? null,
    public_slug: server?.public_slug ?? null,
    community_name: guild?.name ?? null,
  };
}

function ownerMatches(state: FakeState, server: FakeServer, binding: unknown) {
  if (!binding || !state.users.some((user) => user.id === binding)) return true;
  return server.user_id === binding;
}

function scopedCandidate(state: FakeState, candidate: FakeCandidate, bindings: unknown[]) {
  const server = state.servers.find((item) => item.id === candidate.linked_server_id);
  if (!server) return false;
  const ownerBinding = bindings.find((value) => value === OWNER_USER.id || value === OTHER_OWNER_USER.id);
  if (!ownerBinding) return true;
  return server.user_id === ownerBinding;
}

function scopedAudit(state: FakeState, audit: FakeAudit, bindings: unknown[]) {
  const server = state.servers.find((item) => item.id === audit.linked_server_id);
  if (!server) return false;
  const ownerBinding = bindings.find((value) => value === OWNER_USER.id || value === OTHER_OWNER_USER.id);
  if (!ownerBinding) return true;
  return server.user_id === ownerBinding;
}

function matchesIssueFilter(state: FakeState, candidate: FakeCandidate, issueFilter: string) {
  if (issueFilter === "importable") {
    return candidate.status === "pending" &&
      candidate.match_status === "matched" &&
      !state.communityMembers.some((member) => member.community_guild_id === candidate.community_guild_id && member.user_id === candidate.matched_user_id);
  }
  if (issueFilter === "repeated_no_match") {
    return candidate.match_status === "no_match" &&
      Boolean(candidate.candidate_discord_id) &&
      state.candidates.some((other) => other.id !== candidate.id && other.community_guild_id === candidate.community_guild_id && other.candidate_discord_id === candidate.candidate_discord_id && other.match_status === "no_match");
  }
  if (issueFilter === "repeated_duplicate") {
    return candidate.match_status === "duplicate" &&
      state.candidates.some((other) => {
        if (other.id === candidate.id || other.community_guild_id !== candidate.community_guild_id || other.match_status !== "duplicate") return false;
        if (candidate.matched_user_id && other.matched_user_id === candidate.matched_user_id) return true;
        return Boolean(candidate.candidate_discord_id && other.candidate_discord_id === candidate.candidate_discord_id);
      });
  }
  return true;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function assertNoForbiddenSqlWrites(operations: CapturedOperation[]) {
  for (const operation of operations.filter((item) => item.kind === "run")) {
    assertNoForbiddenMutationTargets(operation.sql, "Executed SQL");
  }
}

function assertNoForbiddenMutationTargets(source: string, label: string) {
  assert.doesNotMatch(
    source,
    /\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:player_profile_privacy_preferences|ctf_tournament_rosters|ctf_tournament_matches|ctf_tournament_rounds|owner_billing_accounts|server_reviews|server_review_reports|server_review_moderation_actions|player_saved_servers|server_rankings|leaderboards|discovery_score|player_profiles|kill_events|player_events|competitive_events|server_war_events|server_war_score_snapshots|dzn_seasons|server_badge_awards|player_xp_ledger|player_calling_card_awards|player_challenges|player_challenge_participations)\b/i,
    `${label} must not write to protected influence tables.`,
  );
}

function assertNoExternalOrLivePaymentMutation(source: string, label: string) {
  assert.doesNotMatch(
    source,
    /createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED\s*[:=]\s*(?:true|1)|STRIPE_SECRET_KEY|stripe\.|fetchNitrado|fetchDiscordApi|DISCORD_BOT_TOKEN|NITRADO_TOKEN|wrangler\s+(?:deploy|pages secret|d1 migrations apply).*--remote|issue\s*#49/i,
    `${label} must not enable live payment or mutate external services.`,
  );
}

function assertOrder(source: string, before: string, after: string, message: string) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert.ok(beforeIndex >= 0, `${message}: missing ${before}`);
  assert.ok(afterIndex >= 0, `${message}: missing ${after}`);
  assert.ok(beforeIndex < afterIndex, message);
}

function read(path: string) {
  return readFileSync(path, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
