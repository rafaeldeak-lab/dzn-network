import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  actOnCommunityMemberCandidate,
  bulkActOnCommunityMemberCandidates,
  communityMemberSourceExportPolicy,
  communityMemberSourceExportPolicyReview,
  communityMemberSourceManagementSafeguards,
  createCommunityMemberCandidate,
  exportCommunityMemberSourceAudit,
  listCommunityMemberSourceManagement,
} from "../functions/_lib/community-member-source-management";
import { onRequest as communityMemberSourceAuditExportRoute } from "../functions/api/owner/community-members/export";
import { markCommunityMemberImportNotificationsRead } from "../functions/_lib/dzn-pulse";
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
  expires_at: string | null;
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

const AUDIT_ACTION_VALUES = [
  "candidate_created",
  "candidate_rejected",
  "candidate_imported",
  "candidate_preview_refreshed",
  "candidate_importable",
  "candidate_no_match",
  "duplicate_rejected",
  "ambiguous_rejected",
] as const;
const AUDIT_RESULT_VALUES = ["accepted", "rejected", "skipped", "failed"] as const;

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
  await assertWorkflowExecutionPolishBulkAndReadState();
  await assertAuditHistoryPolishSummariesAndExportSafeViews();
  await assertExportWorkflowPolishDownload();
  await assertExportUxRetentionControls();
  await assertExportPolicyRetentionSettings();
  await assertExportPolicyAdminGuardrails();
  await assertRetainedExportApprovalDesignOnly();
  console.log("Community member source management, import usability, workflow execution, audit-history, export workflow, export UX/retention control, export policy/retention setting, admin guardrail, and retained-export approval design tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    "migrations/0068_community_member_source_management_audit.sql",
    "migrations/0069_community_member_import_usability_polish.sql",
    "functions/_lib/community-member-source-management.ts",
    "functions/_lib/dzn-pulse.ts",
    "functions/api/owner/community-members.ts",
    "functions/api/owner/community-members/[candidateId].ts",
    "functions/api/owner/community-members/bulk.ts",
    "functions/api/owner/community-members/export.ts",
    "functions/api/owner/community-members/notifications/read.ts",
    "components/community/community-member-source-dashboard.tsx",
    "app/dashboard/community-members/page.tsx",
    "app/owner/community-members/page.tsx",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/COMMUNITY_MEMBER_SOURCE_MANAGEMENT_AUDIT_HANDOFF.md",
    "docs/COMMUNITY_MEMBER_IMPORT_WORKFLOW_EXECUTION_POLISH_HANDOFF.md",
    "docs/COMMUNITY_MEMBER_IMPORT_AUDIT_HISTORY_POLISH_HANDOFF.md",
    "docs/COMMUNITY_MEMBER_IMPORT_EXPORT_WORKFLOW_POLISH_HANDOFF.md",
    "docs/COMMUNITY_MEMBER_EXPORT_UX_RETENTION_CONTROLS_HANDOFF.md",
    "docs/COMMUNITY_MEMBER_EXPORT_POLICY_RETENTION_SETTINGS_HANDOFF.md",
    "docs/COMMUNITY_MEMBER_EXPORT_POLICY_ADMIN_GUARDRAILS_HANDOFF.md",
    "docs/COMMUNITY_MEMBER_RETAINED_EXPORT_APPROVAL_DESIGN_HANDOFF.md",
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
    "bulkActOnCommunityMemberCandidates",
    "CommunityMemberBulkCandidateActionInput",
    "CommunityMemberBulkCandidateExecutionSummary",
    "CommunityMemberBulkActionSummary",
    "CommunityMemberSourceAuditGroup",
    "CommunityMemberSourceExportSafeAuditItem",
    "CommunityMemberSourceAuditExport",
    "CommunityMemberSourceAuditExportFilters",
    "CommunityMemberSourceAuditExportRetention",
    "CommunityMemberSourceExportPolicy",
    "CommunityMemberSourceExportPolicyReview",
    "CommunityMemberRetainedExportApprovalDesign",
    "MAX_BULK_ACTION_CANDIDATES",
    "MAX_EXPORT_LIMIT",
    "execution_summaries",
    "audit_groups",
    "export_safe_audit",
    "export_policy",
    "export_policy_review",
    "exportCommunityMemberSourceAudit",
    "communityMemberSourceAuditExportRetention",
    "communityMemberSourceExportPolicy",
    "communityMemberSourceExportPolicyReview",
    "buildCommunityMemberSourceAuditCsv",
    "cleanAuditExportDateBoundary",
    "clampExportLimit",
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
    "selected_row_bulk_actions: true",
    "bulk_actions_recheck_server_side: true",
    "admin_repeated_source_filters: true",
    "owner_importable_notification_hook: true",
    "notification_hook_dzn_pulse_only: true",
    "notification_read_state_private_per_owner: true",
    "community_import_alert_read_state_private_per_owner: true",
    "bulk_partial_success_execution_summaries: true",
    "filterable_bulk_action_audit_groups: true",
    "export_safe_audit_views: true",
    "bounded_export_downloads: true",
    "export_download_private_owner_admin_only: true",
    "export_filters_action_result_date: true",
    "export_uses_export_safe_audit_rows: true",
    "export_history_affordance_client_only: true",
    "export_download_non_persistent_by_default: true",
    "export_private_artifact_notice: true",
    "export_retention_controls: true",
    "export_policy_surface_owner_admin_visible: true",
    "export_policy_explains_download_rules: true",
    "export_persistent_retention_settings_disabled_without_explicit_approval: true",
    "export_persistent_retention_requires_expiry: true",
    "export_persistent_retention_requires_audit_controls: true",
    "export_retention_policy_has_no_storage_side_effect: true",
    "export_policy_review_admin_only: true",
    "export_policy_review_confirms_all_owner_scope_defaults: true",
    "future_retained_export_work_blocked_until_dedicated_approval: true",
    "future_retained_export_work_requires_migration: true",
    "future_retained_export_work_requires_expiry_model: true",
    "future_retained_export_work_requires_storage_plan: true",
    "future_retained_export_work_requires_security_review: true",
    "retained_export_approval_design",
    "status: \"design_only_not_approved\"",
    "implementation_blocked: true",
    "required_approver_role: \"dzn_platform_owner\"",
    "required_review_roles: [\"security_reviewer\", \"data_retention_owner\"]",
    "approval_record: \"dedicated_retained_export_approval_issue_or_pr\"",
    "issue_49_reserved_for_live_checkout: true",
    "owner_self_approval_allowed: false",
    "admin_ui_toggle_allowed: false",
    "status: \"design_only_not_applied\"",
    "proposed_filename: \"future_retained_community_member_audit_exports.sql\"",
    "community_member_retained_export_policies",
    "community_member_retained_exports",
    "community_member_retained_export_access_audit",
    "default_retention_days: 7",
    "max_retention_days: 30",
    "expires_at_required: true",
    "expired_downloads_denied: true",
    "deletion_job_auth: \"cron_secret_only\"",
    "tombstone_on_delete: true",
    "provider: \"cloudflare_r2_private_bucket\"",
    "binding_name: \"COMMUNITY_MEMBER_EXPORTS_BUCKET\"",
    "public_urls_enabled: false",
    "signed_downloads_require_owner_admin_auth: true",
    "persisted_payload: \"export_safe_csv_only\"",
    "retained_export_approval_design_only: true",
    "retained_export_design_requires_platform_owner_approval: true",
    "retained_export_design_requires_security_review_before_build: true",
    "retained_export_design_has_no_migration_side_effect: true",
    "retained_export_design_has_no_storage_side_effect: true",
    "retained_export_design_has_no_write_api: true",
    "retained_export_design_blocks_implementation_until_approved: true",
    "retained_export_design_keeps_issue_49_reserved: true",
    "admin_only: true",
    "owner_scope_review: \"all_owner_scopes\"",
    "retention_work_status: \"blocked_until_approved\"",
    "approval_required_before_retained_export_work: true",
    "Dedicated approval required",
    "Migration required",
    "Expiry model required",
    "Storage plan required",
    "Security review required",
    "persisted_exports_enabled: false",
    "persistent_retention_model",
    "requires_explicit_approval: true",
    "requires_expiry: true",
    "requires_audit_controls: true",
    "sharing_links_enabled: false",
    "browser_persistence_enabled: false",
    "rejects_duplicate_members: true",
    "rejects_ambiguous_user_bridge: true",
    "normalizeAuditActionFilter",
    "normalizeAuditResultFilter",
    "buildCommunityMemberSourceAuditGroups",
    "buildExportSafeCommunityMemberSourceAuditRows",
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
    "countUnreadCommunityMemberImportNotifications",
    "markCommunityMemberImportNotificationsRead",
    "communityMemberImportNotificationConditionSql",
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
    "auditAction: url.searchParams.get(\"audit_action\")",
    "auditResult: url.searchParams.get(\"audit_result\")",
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

  const bulkRoute = read("functions/api/owner/community-members/bulk.ts");
  for (const snippet of [
    "authorizeCommunityMemberSourceRequest(env, request)",
    "bulkActOnCommunityMemberCandidates",
    "readBoundedJson<CommunityMemberBulkCandidateActionInput>",
    "privateNoStoreHeaders",
    "methodNotAllowed",
  ]) {
    assert.equal(bulkRoute.includes(snippet), true, `Owner community member bulk route must include ${snippet}.`);
  }
  assertOrder(bulkRoute, "authorizeCommunityMemberSourceRequest", "readBoundedJson", "bulk candidate action route must authorize before reading the body");
  assertNoExternalOrLivePaymentMutation(bulkRoute, "Owner community member bulk route");

  const exportRoute = read("functions/api/owner/community-members/export.ts");
  for (const snippet of [
    "authorizeCommunityMemberSourceRequest(env, request)",
    "exportCommunityMemberSourceAudit",
    "auditAction: url.searchParams.get(\"audit_action\")",
    "auditResult: url.searchParams.get(\"audit_result\")",
    "dateFrom: url.searchParams.get(\"date_from\")",
    "dateTo: url.searchParams.get(\"date_to\")",
    "privateNoStoreHeaders",
    "\"content-disposition\"",
    "result.content_type",
    "\"x-dzn-export-safe\"",
    "\"x-dzn-export-generated-at\"",
    "\"x-dzn-export-artifact\"",
    "\"x-dzn-export-retention\"",
    "\"x-dzn-export-persisted-by-dzn\"",
    "\"x-dzn-export-dashboard-history\"",
    "\"x-dzn-export-policy\"",
    "\"x-dzn-export-persistent-retention\"",
    "\"x-dzn-export-retention-expiry-required-if-approved\"",
    "\"x-dzn-export-retention-audit-required-if-approved\"",
    "methodNotAllowed",
  ]) {
    assert.equal(exportRoute.includes(snippet), true, `Owner community member export route must include ${snippet}.`);
  }
  assert.equal(exportRoute.includes("readBoundedJson"), false, "Audit export route must stay a GET-only download without a mutation body.");
  assertNoExternalOrLivePaymentMutation(exportRoute, "Owner community member audit export route");

  const notificationReadRoute = read("functions/api/owner/community-members/notifications/read.ts");
  for (const snippet of [
    "authorizeCommunityMemberSourceRequest(env, request)",
    "markCommunityMemberImportNotificationsRead",
    "privateNoStoreHeaders",
    "methodNotAllowed",
  ]) {
    assert.equal(notificationReadRoute.includes(snippet), true, `Community member import alert read route must include ${snippet}.`);
  }
  assertNoExternalOrLivePaymentMutation(notificationReadRoute, "Community member import alert read route");

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
    "Bulk import selected",
    "Bulk reject selected",
    "Each selected row is rechecked server-side",
    "Bulk action summaries",
    "execution_summaries",
    "Mark import alerts read",
    "/api/owner/community-members/bulk",
    "/api/owner/community-members/notifications/read",
    "Repeated no-match",
    "Repeated duplicate",
    "Audit action",
    "Audit result",
    "Filterable bulk action audit grouping",
    "Export-safe audit view",
    "downloadAuditExport",
    "/api/owner/community-members/export",
    "Download audit CSV",
    "Export policy",
    "Owner/admin visible policy",
    "Optional retention settings",
    "Persistent retention disabled",
    "Requires explicit approval",
    "Expiry and audit required",
    "Stored export files off",
    "Shared export links off",
    "No stored export history",
    "Admin export policy review",
    "Admin only",
    "All owner scopes",
    "Current defaults confirmed",
    "Future retained-export work blocked",
    "Dedicated approval required",
    "Migration required",
    "Expiry model required",
    "Storage plan required",
    "Security review required",
    "retained-export design only",
    "Retained-export approval design",
    "Design only, not approved",
    "DZN platform owner",
    "Dedicated issue/PR",
    "Issue #49 stays reserved for live checkout",
    "Design only, not applied",
    "future_retained_community_member_audit_exports.sql",
    "7-day default",
    "30-day maximum",
    "cron-secret-only deletion",
    "Private R2 only",
    "No public URLs",
    "No admin toggle",
    "Security review checklist",
    "Proof requirements",
    "Rollback rules",
    "Private export",
    "Recent exports",
    "Clear local history",
    "Owner/admin artifact",
    "Download-only by default",
    "Not persisted by DZN",
    "Client-session history only",
    "CLIENT_RECENT_EXPORT_LIMIT",
    "Last {exportPolicy.dashboard_history_limit} downloads",
    "Export from",
    "Export to",
    "Export rows",
    "buildExportFilterSummary",
    "parseHeaderNumber",
    "action, result, date filters",
    "bounded export downloads",
    "export action/result/date filters",
    "client-only export history",
    "non-persistent exports",
    "filenameFromContentDisposition",
    "public profile opt-in handle",
    "CTF scoring rows",
    "Hidden until player opt-in",
    "Source audit history",
    "method: \"POST\"",
  ]) {
    assert.equal(ui.includes(snippet), true, `Source dashboard UI must include ${snippet}.`);
  }
  assert.doesNotMatch(ui, /dangerouslySetInnerHTML|DZN_LIVE_CHECKOUT_ENABLED|createCheckoutSession|stripe|NITRADO_TOKEN|DISCORD_BOT_TOKEN|fetchNitrado|fetchDiscord/i, "UI must not touch checkout, secrets, or external services.");
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB|community_member_export_history/i, "Export UX history must stay client-session-only and non-persistent by default.");

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
  assert.equal(packageJson.includes("test:community-member-import-workflow-execution-polish"), true, "Focused import workflow execution polish test must be wired into package scripts.");
  assert.equal(packageJson.includes("test:community-member-import-audit-history-polish"), true, "Focused import audit-history polish test must be wired into package scripts.");
  assert.equal(packageJson.includes("test:community-member-import-export-workflow-polish"), true, "Focused import export workflow polish test must be wired into package scripts.");
  assert.equal(packageJson.includes("test:community-member-export-ux-retention-controls"), true, "Focused export UX and retention controls test must be wired into package scripts.");
  assert.equal(packageJson.includes("test:community-member-export-policy-retention-settings"), true, "Focused export policy and retention settings test must be wired into package scripts.");
  assert.equal(packageJson.includes("test:community-member-export-policy-admin-guardrails"), true, "Focused export policy admin guardrails test must be wired into package scripts.");
  assert.equal(packageJson.includes("test:community-member-retained-export-approval-design"), true, "Focused retained-export approval design test must be wired into package scripts.");

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  for (const snippet of [
    "Trusted Community Member Source Management and Audit Slice",
    "Community Member Import Usability Polish Slice",
    "Community Member Import Workflow Execution Polish Slice",
    "Community Member Import Audit-History Polish Slice",
    "Community Member Import Export Workflow Polish Slice",
    "Community Member Export UX and Retention Controls Slice",
    "Community Member Export Policy and Optional Retention Settings Slice",
    "Community Member Export Policy Review and Admin Guardrails Slice",
    "Community Member Retained Export Approval Design Slice",
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
    "selected-row bulk",
    "per-candidate execution summaries",
    "filterable bulk action audit grouping",
    "export-safe audit view",
    "bounded downloadable export action",
    "client-session-only recent export history",
    "downloaded file is a private owner/admin artifact",
    "non-persistent by default",
    "owner/admin-visible export policy surface",
    "optional retention settings",
    "Persistent export retention remains disabled",
    "requires explicit approval",
    "expiry and audit controls",
    "admin-only policy review",
    "all owner scopes",
    "future retained-export work as blocked",
    "dedicated approval",
    "migration",
    "expiry model",
    "storage plan",
    "security review",
    "design-only retained-export approval model",
    "`dzn_platform_owner`",
    "`future_retained_community_member_audit_exports.sql`",
    "`community_member_retained_export_policies`",
    "`community_member_retained_exports`",
    "`community_member_retained_export_access_audit`",
    "7-day default retention",
    "30-day maximum retention",
    "`COMMUNITY_MEMBER_EXPORTS_BUCKET`",
    "private R2 bucket",
    "rollback rules",
    "proof requirements",
    "no retained export files, export-history rows, sharing links, or retention write APIs",
    "`/api/owner/community-members/export`",
    "`date_from`",
    "`date_to`",
    "bulkActOnCommunityMemberCandidates",
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
    "Selected-row bulk import/reject actions",
    "Per-candidate bulk execution summaries",
    "filterable audit action/result grouping",
    "export-safe owner/admin audit view",
    "`/api/owner/community-members/bulk`",
    "`/api/owner/community-members/export`",
    "`/api/owner/community-members/notifications/read`",
    "bounded downloadable export action",
    "date/action/result filters",
    "client-session-only recent export history",
    "private owner/admin artifact",
    "non-persistent by default",
    "owner/admin-visible export policy surface",
    "optional retention settings",
    "persistent retention is disabled unless a later approved slice adds expiry and audit controls",
    "admin-only policy review",
    "all owner scopes",
    "future retained-export work is blocked until a dedicated approval, migration, expiry model, storage plan, and security review exist",
    "retained-export approval design",
    "DZN platform owner",
    "dedicated retained-export approval issue or PR",
    "future retained-export migration shape",
    "7-day default retention",
    "30-day maximum retention",
    "private R2 bucket",
    "no retained export files, export-history rows, sharing links, or retention write APIs",
    "Public profile visibility still requires the player's opt-in generated handle",
  ]) {
    assert.equal(accessPolicy.includes(snippet), true, `Public access policy must document ${snippet}.`);
  }

  const workflowHandoff = read("docs/COMMUNITY_MEMBER_IMPORT_WORKFLOW_EXECUTION_POLISH_HANDOFF.md");
  for (const snippet of [
    "Community Member Import Workflow Execution Polish",
    "selected-row bulk import/reject execution",
    "`community_member_candidate_importable`",
    "`bulkActOnCommunityMemberCandidates`",
    "`/api/owner/community-members/bulk`",
    "`/api/owner/community-members/notifications/read`",
    "rechecks owner/admin scope",
    "current user's active `community_member_candidate_importable` alerts",
    "Public visibility remains player-controlled",
    "No production D1 migration was applied",
  ]) {
    assert.equal(workflowHandoff.includes(snippet), true, `Workflow execution handoff must document ${snippet}.`);
  }

  const auditHistoryHandoff = read("docs/COMMUNITY_MEMBER_IMPORT_AUDIT_HISTORY_POLISH_HANDOFF.md");
  for (const snippet of [
    "Community Member Import Audit-History Polish",
    "per-candidate execution summaries",
    "partial success",
    "filterable bulk action audit grouping",
    "export-safe owner/admin audit views",
    "`audit_action`",
    "`audit_result`",
    "`execution_summaries`",
    "`audit_groups`",
    "`export_safe_audit`",
    "No production D1 migration was applied",
    "DZN_LIVE_CHECKOUT_ENABLED remains disabled",
  ]) {
    assert.equal(auditHistoryHandoff.includes(snippet), true, `Audit-history polish handoff must document ${snippet}.`);
  }

  const exportHandoff = read("docs/COMMUNITY_MEMBER_IMPORT_EXPORT_WORKFLOW_POLISH_HANDOFF.md");
  for (const snippet of [
    "Community Member Import Export Workflow Polish",
    "bounded downloadable export action",
    "`/api/owner/community-members/export`",
    "`exportCommunityMemberSourceAudit`",
    "`date_from`",
    "`date_to`",
    "`audit_action`",
    "`audit_result`",
    "CSV attachment",
    "export-safe owner/admin rows",
    "No production D1 migration was applied",
    "DZN_LIVE_CHECKOUT_ENABLED remains disabled",
  ]) {
    assert.equal(exportHandoff.includes(snippet), true, `Export workflow polish handoff must document ${snippet}.`);
  }

  const retentionHandoff = read("docs/COMMUNITY_MEMBER_EXPORT_UX_RETENTION_CONTROLS_HANDOFF.md");
  for (const snippet of [
    "Community Member Export UX and Retention Controls",
    "client-session-only recent export history",
    "private owner/admin artifact",
    "download-only retention",
    "non-persistent by default",
    "`x-dzn-export-generated-at`",
    "`x-dzn-export-retention`",
    "No production D1 migration was applied",
    "DZN_LIVE_CHECKOUT_ENABLED remains disabled",
  ]) {
    assert.equal(retentionHandoff.includes(snippet), true, `Export UX retention handoff must document ${snippet}.`);
  }

  const exportPolicyHandoff = read("docs/COMMUNITY_MEMBER_EXPORT_POLICY_RETENTION_SETTINGS_HANDOFF.md");
  for (const snippet of [
    "Community Member Export Policy and Optional Retention Settings",
    "owner/admin-visible export policy surface",
    "Optional retention settings",
    "persistent retention is disabled",
    "requires explicit approval",
    "expiry and audit controls",
    "No production D1 migration was applied",
    "DZN_LIVE_CHECKOUT_ENABLED remains disabled",
  ]) {
    assert.equal(exportPolicyHandoff.includes(snippet), true, `Export policy retention handoff must document ${snippet}.`);
  }

  const adminGuardrailsHandoff = read("docs/COMMUNITY_MEMBER_EXPORT_POLICY_ADMIN_GUARDRAILS_HANDOFF.md");
  for (const snippet of [
    "Community Member Export Policy Review and Admin Guardrails",
    "admin-only policy review",
    "all owner scopes",
    "`export_policy_review`",
    "Current defaults confirmed",
    "Future retained-export work blocked",
    "Dedicated approval required",
    "Migration required",
    "Expiry model required",
    "Storage plan required",
    "Security review required",
    "No production D1 migration was applied",
    "DZN_LIVE_CHECKOUT_ENABLED remains disabled",
  ]) {
    assert.equal(adminGuardrailsHandoff.includes(snippet), true, `Export policy admin guardrails handoff must document ${snippet}.`);
  }

  const retainedExportHandoff = read("docs/COMMUNITY_MEMBER_RETAINED_EXPORT_APPROVAL_DESIGN_HANDOFF.md");
  for (const snippet of [
    "Community Member Retained Export Approval Design",
    "design-only retained-export approval model",
    "DZN platform owner",
    "security reviewer",
    "data retention owner",
    "dedicated retained-export approval issue or PR",
    "issue #49 remains reserved for final live checkout activation",
    "future_retained_community_member_audit_exports.sql",
    "community_member_retained_export_policies",
    "community_member_retained_exports",
    "community_member_retained_export_access_audit",
    "7-day default retention",
    "30-day maximum retention",
    "cron-secret-only deletion",
    "private R2 bucket",
    "COMMUNITY_MEMBER_EXPORTS_BUCKET",
    "No retained export files were implemented",
    "No export-history rows were implemented",
    "No sharing links were implemented",
    "No retention write APIs were implemented",
    "Security review checklist",
    "Rollback rules",
    "Proof requirements",
    "DZN_LIVE_CHECKOUT_ENABLED remains disabled",
  ]) {
    assert.equal(retainedExportHandoff.includes(snippet), true, `Retained export approval design handoff must document ${snippet}.`);
  }
}

function assertSafeguards() {
  const safeguards = communityMemberSourceManagementSafeguards();
  assert.equal(safeguards.access, "owner_admin_only");
  assert.equal(safeguards.public_profile_link_requires_player_opt_in_handle, true);
  assert.equal(safeguards.trusted_dzn_user_bridge_required, true);
  assert.equal(safeguards.import_preview_requires_trusted_bridge, true);
  assert.equal(safeguards.import_previews_from_trusted_snapshots_where_available, true);
  assert.equal(safeguards.selected_row_bulk_actions, true);
  assert.equal(safeguards.bulk_actions_recheck_server_side, true);
  assert.equal(safeguards.bulk_partial_success_execution_summaries, true);
  assert.equal(safeguards.filterable_bulk_action_audit_groups, true);
  assert.equal(safeguards.export_safe_audit_views, true);
  assert.equal(safeguards.bounded_export_downloads, true);
  assert.equal(safeguards.export_download_private_owner_admin_only, true);
  assert.equal(safeguards.export_filters_action_result_date, true);
  assert.equal(safeguards.export_uses_export_safe_audit_rows, true);
  assert.equal(safeguards.export_history_affordance_client_only, true);
  assert.equal(safeguards.export_download_non_persistent_by_default, true);
  assert.equal(safeguards.export_private_artifact_notice, true);
  assert.equal(safeguards.export_retention_controls, true);
  assert.equal(safeguards.export_policy_surface_owner_admin_visible, true);
  assert.equal(safeguards.export_policy_explains_download_rules, true);
  assert.equal(safeguards.export_persistent_retention_settings_disabled_without_explicit_approval, true);
  assert.equal(safeguards.export_persistent_retention_requires_expiry, true);
  assert.equal(safeguards.export_persistent_retention_requires_audit_controls, true);
  assert.equal(safeguards.export_retention_policy_has_no_storage_side_effect, true);
  assert.equal(safeguards.export_policy_review_admin_only, true);
  assert.equal(safeguards.export_policy_review_confirms_all_owner_scope_defaults, true);
  assert.equal(safeguards.future_retained_export_work_blocked_until_dedicated_approval, true);
  assert.equal(safeguards.future_retained_export_work_requires_migration, true);
  assert.equal(safeguards.future_retained_export_work_requires_expiry_model, true);
  assert.equal(safeguards.future_retained_export_work_requires_storage_plan, true);
  assert.equal(safeguards.future_retained_export_work_requires_security_review, true);
  assert.equal(safeguards.retained_export_approval_design_only, true);
  assert.equal(safeguards.retained_export_design_requires_platform_owner_approval, true);
  assert.equal(safeguards.retained_export_design_requires_security_review_before_build, true);
  assert.equal(safeguards.retained_export_design_has_no_migration_side_effect, true);
  assert.equal(safeguards.retained_export_design_has_no_storage_side_effect, true);
  assert.equal(safeguards.retained_export_design_has_no_write_api, true);
  assert.equal(safeguards.retained_export_design_blocks_implementation_until_approved, true);
  assert.equal(safeguards.retained_export_design_keeps_issue_49_reserved, true);
  assert.equal(safeguards.admin_repeated_source_filters, true);
  assert.equal(safeguards.owner_importable_notification_hook, true);
  assert.equal(safeguards.notification_hook_dzn_pulse_only, true);
  assert.equal(safeguards.notification_read_state_private_per_owner, true);
  assert.equal(safeguards.community_import_alert_read_state_private_per_owner, true);
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

async function assertWorkflowExecutionPolishBulkAndReadState() {
  const state = createFakeState();
  state.users.push({ id: "player-2", discord_id: "222233334444555566", username: "Second Visible Player" });
  state.candidates.push(makeCandidate("bulk-import-a", "111122223333444455", "matched", "pending", "player-1"));
  state.candidates.push(makeCandidate("bulk-import-b", "222233334444555566", "matched", "pending", "player-2"));
  const env = { DB: createFakeDb(state), DZN_PULSE_ENABLED: "true" } as Env;
  const ownerActor = { user: OWNER_USER, role: "owner" as const };

  const importResult = await bulkActOnCommunityMemberCandidates(env, ownerActor, {
    action: "import",
    candidate_ids: ["bulk-import-a", "bulk-import-b"],
    reason: "Bulk import selected rows after server-side recheck.",
  });
  assert.equal(importResult.ok, true);
  if (!("results" in importResult)) assert.fail("Bulk import must return per-row results.");
  assert.equal(importResult.status, 200);
  assert.equal(importResult.imported_count, 2);
  assert.equal(importResult.rejected_count, 0);
  assert.equal(importResult.blocked_count, 0);
  assert.equal(state.communityMembers.length, 2);
  assert.equal(state.audit.filter((item) => item.action === "candidate_imported").length, 2);
  assert.equal(state.privacy.find((item) => item.user_id === "player-1")?.public_profile_enabled, 0, "Bulk import must not publish an opted-out profile.");
  assert.equal(state.privacy.find((item) => item.user_id === "player-2"), undefined, "Bulk import must not create profile visibility preferences.");
  assert.equal(state.operations.filter((operation) => operation.sql.includes("SELECT candidate_discord_id FROM community_member_candidates")).length >= 2, true, "Bulk import must re-read private candidate bridge evidence per row.");
  assert.equal(state.operations.filter((operation) => operation.sql.includes("FROM users WHERE id")).length >= 2, true, "Bulk import must resolve the trusted DZN user bridge per row.");

  state.candidates.push(makeCandidate("bulk-reject-a", "333344445555666677", "no_match", "pending"));
  const rejectResult = await bulkActOnCommunityMemberCandidates(env, ownerActor, {
    action: "reject",
    candidate_ids: ["bulk-reject-a"],
    reason: "Selected row rejected from owner/admin review.",
  });
  assert.equal(rejectResult.ok, true);
  if (!("results" in rejectResult)) assert.fail("Bulk reject must return per-row results.");
  assert.equal(rejectResult.rejected_count, 1);
  assert.equal(state.candidates.find((candidate) => candidate.id === "bulk-reject-a")?.status, "rejected");
  assert.equal(state.audit.some((item) => item.candidate_id === "bulk-reject-a" && item.action === "candidate_rejected"), true);

  const crossOwnerState = createFakeState();
  crossOwnerState.candidates.push(makeCandidate("owner-only-candidate", "111122223333444455", "matched", "pending", "player-1"));
  const crossOwnerEnv = { DB: createFakeDb(crossOwnerState), DZN_PULSE_ENABLED: "true" } as Env;
  const otherActor = { user: OTHER_OWNER_USER, role: "owner" as const };
  const crossOwnerResult = await bulkActOnCommunityMemberCandidates(crossOwnerEnv, otherActor, {
    action: "import",
    candidate_ids: ["owner-only-candidate"],
    reason: "Cross-owner attempt should be denied.",
  });
  assert.equal(crossOwnerResult.ok, false);
  if (!("results" in crossOwnerResult)) assert.fail("Cross-owner bulk attempt must return per-row denial results.");
  assert.equal(crossOwnerResult.status, 207);
  assert.equal(crossOwnerResult.blocked_count, 1);
  assert.equal(crossOwnerResult.results[0]?.error, "CANDIDATE_NOT_FOUND");
  assert.equal(crossOwnerState.communityMembers.length, 0);
  assert.equal(crossOwnerState.candidates.find((candidate) => candidate.id === "owner-only-candidate")?.status, "pending");

  state.notifications.push(
    makeNotification("owner-importable", OWNER_USER.id, "community_member_candidate_importable", null),
    makeNotification("owner-general", OWNER_USER.id, "dzn_announcement", null),
    makeNotification("other-owner-importable", OTHER_OWNER_USER.id, "community_member_candidate_importable", null),
    makeNotification("owner-expired-importable", OWNER_USER.id, "community_member_candidate_importable", "2026-01-01T00:00:00.000Z"),
    { ...makeNotification("owner-read-importable", OWNER_USER.id, "community_member_candidate_importable", null), read_at: "2026-08-26T09:00:00.000Z" },
  );
  const readResult = await markCommunityMemberImportNotificationsRead(env, OWNER_USER);
  assert.equal(readResult.ok, true);
  if (!("marked" in readResult)) assert.fail("Community member import alert read-state result must include a marked count.");
  assert.equal(readResult.marked, 1);
  assert.equal(readResult.communityMemberImportUnreadCount, 0);
  assert.equal(readResult.unreadCount, 1, "General owner Pulse alerts must remain unread.");
  assert.notEqual(state.notifications.find((item) => item.id === "owner-importable")?.read_at, null);
  assert.equal(state.notifications.find((item) => item.id === "owner-general")?.read_at, null);
  assert.equal(state.notifications.find((item) => item.id === "other-owner-importable")?.read_at, null);
  assert.equal(state.notifications.find((item) => item.id === "owner-expired-importable")?.read_at, null);

  assertNoForbiddenSqlWrites(state.operations);
  assertNoForbiddenSqlWrites(crossOwnerState.operations);
}

async function assertAuditHistoryPolishSummariesAndExportSafeViews() {
  const state = createFakeState();
  state.candidates.push(makeCandidate("partial-import-ready", "111122223333444455", "matched", "pending", "player-1"));
  state.candidates.push(makeCandidate("partial-import-no-match", "222233334444555566", "no_match", "pending"));
  const env = { DB: createFakeDb(state), DZN_PULSE_ENABLED: "true" } as Env;
  const ownerActor = { user: OWNER_USER, role: "owner" as const };

  const partialResult = await bulkActOnCommunityMemberCandidates(env, ownerActor, {
    action: "import",
    candidate_ids: ["partial-import-ready", "partial-import-no-match"],
    reason: "Mixed bulk execution should expose per-candidate summaries for player-1 and 111122223333444455.",
  });

  assert.equal(partialResult.ok, false);
  assert.equal(partialResult.status, 207);
  if (!("execution_summaries" in partialResult)) assert.fail("Bulk partial success must return execution_summaries.");
  if (!("summary" in partialResult)) assert.fail("Bulk partial success must return a summary object.");
  assert.equal(partialResult.summary.partial_success, true);
  assert.equal(partialResult.summary.imported_count, 1);
  assert.equal(partialResult.summary.blocked_count, 1);
  assert.equal(partialResult.imported_count, 1);
  assert.equal(partialResult.blocked_count, 1);
  assert.match(partialResult.message, /1 imported, 0 rejected, 1 blocked, 0 failed/);

  const importedSummary = partialResult.execution_summaries.find((item) => item.candidate_id === "partial-import-ready");
  const blockedSummary = partialResult.execution_summaries.find((item) => item.candidate_id === "partial-import-no-match");
  assert.ok(importedSummary, "Imported row should have a per-candidate execution summary.");
  assert.ok(blockedSummary, "Blocked row should have a per-candidate execution summary.");
  assert.equal(importedSummary.outcome, "imported");
  assert.equal(importedSummary.result_status, "accepted");
  assert.equal(importedSummary.export_safe, true);
  assert.equal(blockedSummary.outcome, "blocked");
  assert.equal(blockedSummary.result_status, "skipped");
  assert.equal(blockedSummary.error, "NO_TRUSTED_USER_BRIDGE");
  assert.equal(blockedSummary.export_safe, true);
  assertNoSensitiveExportIdentifiers(partialResult.execution_summaries, "Bulk execution summaries");

  const importedAudit = await listCommunityMemberSourceManagement(env, ownerActor, {
    status: "all",
    auditAction: "candidate_imported",
    auditResult: "accepted",
    limit: 80,
  });
  assert.equal(importedAudit.filters.audit_action, "candidate_imported");
  assert.equal(importedAudit.filters.audit_result, "accepted");
  assert.equal(importedAudit.audit.length, 1);
  assert.equal(importedAudit.audit[0]?.action, "candidate_imported");
  assert.equal(importedAudit.audit[0]?.result_status, "accepted");
  assert.equal(importedAudit.audit_groups.length, 1);
  assert.equal(importedAudit.audit_groups[0]?.action, "candidate_imported");
  assert.equal(importedAudit.audit_groups[0]?.result_status, "accepted");
  assert.equal(importedAudit.audit_groups[0]?.accepted_count, 1);
  assert.equal(importedAudit.audit_groups[0]?.export_safe, true);
  assert.equal(Object.prototype.hasOwnProperty.call(importedAudit.audit_groups[0], "linked_server_id"), false);
  assertNoSensitiveExportIdentifiers(importedAudit.audit_groups, "Audit groups");
  assert.equal(importedAudit.export_safe_audit.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(importedAudit.export_safe_audit[0], "actor_user_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(importedAudit.export_safe_audit[0], "community_guild_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(importedAudit.export_safe_audit[0], "linked_server_id"), false);
  assertNoSensitiveExportIdentifiers(importedAudit.export_safe_audit, "Export-safe audit rows");

  const skippedAudit = await listCommunityMemberSourceManagement(env, ownerActor, {
    status: "all",
    auditAction: "candidate_no_match",
    auditResult: "skipped",
    limit: 80,
  });
  assert.equal(skippedAudit.audit.length, 1);
  assert.equal(skippedAudit.audit_groups[0]?.skipped_count, 1);
  assert.equal(state.communityMembers.length, 1, "Only the importable candidate should create a presentation bridge row.");
  assert.equal(state.candidates.find((candidate) => candidate.id === "partial-import-no-match")?.status, "pending");
  assert.equal(state.privacy.find((item) => item.user_id === "player-1")?.public_profile_enabled, 0);
  assertNoForbiddenSqlWrites(state.operations);
}

async function assertExportWorkflowPolishDownload() {
  const state = createFakeState();
  state.servers.push({
    id: "server-2",
    user_id: OTHER_OWNER_USER.id,
    public_slug: "other-owner-server",
    display_name: "Other Owner Server",
    hostname: null,
    server_name: "Other Owner Server",
    nitrado_service_name: null,
    status: "active",
    discord_guild_id: "guild-row-2",
  });
  state.guilds.push({ id: "guild-row-2", name: "Other Owner Discord" });
  state.audit.push(
    makeAudit("audit-export-a", "server-1", "guild-row-1", "player-1-candidate-raw", "member-111122223333444455", "candidate_imported", "accepted", "Imported player-1 from 111122223333444455 for owner-user.", "2026-08-26T10:00:00.000Z"),
    makeAudit("audit-export-b", "server-1", "guild-row-1", "player-2-candidate-raw", "member-222233334444555566", "candidate_imported", "accepted", "Imported player-2 from 222233334444555566 for owner-user.", "2026-08-26T11:00:00.000Z"),
    makeAudit("audit-export-skipped", "server-1", "guild-row-1", "no-match-candidate", null, "candidate_no_match", "skipped", "No trusted bridge yet.", "2026-08-25T10:00:00.000Z"),
    makeAudit("audit-export-other-owner", "server-2", "guild-row-2", "other-owner-candidate", null, "candidate_imported", "accepted", "Other owner row must not export for owner-user.", "2026-08-26T10:30:00.000Z"),
  );
  const env = { DB: createFakeDb(state), DZN_PULSE_ENABLED: "true" } as Env;
  const ownerActor = { user: OWNER_USER, role: "owner" as const };

  const exportResult = await exportCommunityMemberSourceAudit(env, ownerActor, {
    auditAction: "candidate_imported",
    auditResult: "accepted",
    dateFrom: "2026-08-26",
    dateTo: "2026-08-26",
    limit: 1,
  });
  assert.equal(exportResult.ok, true);
  if (!exportResult.ok) assert.fail("Export helper must return an export-safe CSV payload.");
  assert.equal(exportResult.status, 200);
  assert.equal(exportResult.content_type, "text/csv; charset=utf-8");
  assert.match(exportResult.filename, /^dzn-community-member-import-audit-\d{8}-\d{6}\.csv$/);
  assert.equal(exportResult.filters.audit_action, "candidate_imported");
  assert.equal(exportResult.filters.audit_result, "accepted");
  assert.equal(exportResult.filters.date_from, "2026-08-26T00:00:00.000Z");
  assert.equal(exportResult.filters.date_to, "2026-08-26T23:59:59.999Z");
  assert.equal(exportResult.filters.limit, 1);
  assert.equal(exportResult.row_count, 1);
  assert.equal(exportResult.truncated, true, "Export must fetch one extra row and report server-side truncation.");
  assert.equal(exportResult.export_safe, true);
  assert.equal(exportResult.retention.mode, "download_only");
  assert.equal(exportResult.retention.persisted_by_dzn, false);
  assert.equal(exportResult.retention.dashboard_history, "client_session_only");
  assert.equal(exportResult.retention.private_artifact, true);
  assert.equal(exportResult.policy.owner_admin_visible, true);
  assert.equal(exportResult.policy.current_retention_mode, "download_only");
  assert.equal(exportResult.policy.persisted_exports_enabled, false);
  assert.equal(exportResult.policy.dashboard_history, "client_session_only");
  assert.equal(exportResult.policy.dashboard_history_limit, 5);
  assert.equal(exportResult.policy.max_rows_per_download, 500);
  assert.equal(exportResult.policy.sharing_links_enabled, false);
  assert.equal(exportResult.policy.browser_persistence_enabled, false);
  assert.equal(exportResult.policy.persistent_retention_model.status, "not_approved");
  assert.equal(exportResult.policy.persistent_retention_model.requires_explicit_approval, true);
  assert.equal(exportResult.policy.persistent_retention_model.requires_expiry, true);
  assert.equal(exportResult.policy.persistent_retention_model.requires_audit_controls, true);
  assert.equal(exportResult.policy.rules.some((rule) => rule.includes("Persistent export retention requires a separate approved slice")), true);
  assert.equal(exportResult.safeguards.bounded_export_downloads, true);
  assert.equal(exportResult.safeguards.export_history_affordance_client_only, true);
  assert.equal(exportResult.safeguards.export_download_non_persistent_by_default, true);
  assert.equal(exportResult.safeguards.export_private_artifact_notice, true);
  assert.equal(exportResult.safeguards.export_retention_controls, true);
  assert.equal(exportResult.safeguards.export_policy_surface_owner_admin_visible, true);
  assert.equal(exportResult.safeguards.export_persistent_retention_settings_disabled_without_explicit_approval, true);
  assert.match(exportResult.body, /^exported_at,export_safe,filter_linked_server_ref,filter_audit_action,filter_audit_result,filter_date_from,filter_date_to,audit_ref,/);
  assert.match(exportResult.body, /candidate_imported/);
  assert.doesNotMatch(exportResult.body, /candidate_no_match|Other Owner Server/);
  assertNoDownloadExportIdentifiers(exportResult.body, "CSV export body");

  const invalidDate = await exportCommunityMemberSourceAudit(env, ownerActor, { dateFrom: "not-a-date" });
  assert.equal(invalidDate.ok, false);
  assert.equal(invalidDate.status, 400);
  assert.equal(invalidDate.error, "INVALID_EXPORT_DATE");

  const invalidRange = await exportCommunityMemberSourceAudit(env, ownerActor, { dateFrom: "2026-08-27", dateTo: "2026-08-26" });
  assert.equal(invalidRange.ok, false);
  assert.equal(invalidRange.status, 400);
  assert.equal(invalidRange.error, "INVALID_EXPORT_DATE_RANGE");

  const boundedExport = await exportCommunityMemberSourceAudit(env, ownerActor, { limit: 9999 });
  assert.equal(boundedExport.ok, true);
  if (!boundedExport.ok) assert.fail("Bounded export should still succeed.");
  assert.equal(boundedExport.filters.limit, 500);

  const routeResponse = await communityMemberSourceAuditExportRoute({
    request: new Request("https://dzn.example/api/owner/community-members/export?linked_server_id=server-1&audit_action=candidate_imported&audit_result=accepted&date_from=2026-08-26&date_to=2026-08-26&limit=2", {
      method: "GET",
    }),
    env: { ...env, MOCK_AUTH: "true" } as Env,
    params: {},
    waitUntil: () => undefined,
    next: async () => new Response(null, { status: 404 }),
    data: {},
  });
  assert.equal(routeResponse.status, 200);
  assert.match(routeResponse.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(routeResponse.headers.get("content-disposition") ?? "", /attachment; filename="dzn-community-member-import-audit-/);
  assert.equal(routeResponse.headers.get("cache-control")?.includes("private"), true);
  assert.equal(routeResponse.headers.get("x-dzn-export-safe"), "true");
  assert.equal(routeResponse.headers.get("x-dzn-export-row-count"), "2");
  assert.equal(routeResponse.headers.get("x-dzn-export-limit"), "2");
  assert.equal(routeResponse.headers.get("x-dzn-export-truncated"), "false");
  assert.match(routeResponse.headers.get("x-dzn-export-generated-at") ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(routeResponse.headers.get("x-dzn-export-artifact"), "private-owner-admin");
  assert.equal(routeResponse.headers.get("x-dzn-export-retention"), "download_only");
  assert.equal(routeResponse.headers.get("x-dzn-export-persisted-by-dzn"), "false");
  assert.equal(routeResponse.headers.get("x-dzn-export-dashboard-history"), "client_session_only");
  assert.equal(routeResponse.headers.get("x-dzn-export-policy"), "owner-admin-private-download-only");
  assert.equal(routeResponse.headers.get("x-dzn-export-persistent-retention"), "not_approved");
  assert.equal(routeResponse.headers.get("x-dzn-export-retention-expiry-required-if-approved"), "true");
  assert.equal(routeResponse.headers.get("x-dzn-export-retention-audit-required-if-approved"), "true");
  const routeCsv = await routeResponse.text();
  assert.match(routeCsv, /candidate_imported/);
  assert.doesNotMatch(routeCsv, /Other Owner Server|candidate_no_match/);
  assertNoDownloadExportIdentifiers(routeCsv, "Route CSV export body");

  assert.equal(state.privacy.find((item) => item.user_id === "player-1")?.public_profile_enabled, 0);
  assert.equal(state.communityMembers.length, 0, "Audit export must not import or alter presentation bridge rows.");
  assertNoForbiddenSqlWrites(state.operations);
}

async function assertExportUxRetentionControls() {
  const state = createFakeState();
  state.audit.push(
    makeAudit("audit-retention-a", "server-1", "guild-row-1", "retention-candidate", "member-retention-a", "candidate_imported", "accepted", "Export retention row should stay private.", "2026-08-26T12:00:00.000Z"),
  );
  const env = { DB: createFakeDb(state), DZN_PULSE_ENABLED: "true" } as Env;
  const ownerActor = { user: OWNER_USER, role: "owner" as const };
  const exportResult = await exportCommunityMemberSourceAudit(env, ownerActor, {
    linkedServerId: "server-1",
    auditAction: "candidate_imported",
    auditResult: "accepted",
    dateFrom: "2026-08-26",
    dateTo: "2026-08-26",
    limit: 100,
  });
  assert.equal(exportResult.ok, true);
  if (!exportResult.ok) assert.fail("Export retention helper must return an export-safe payload.");
  assert.equal(exportResult.retention.mode, "download_only");
  assert.equal(exportResult.retention.persisted_by_dzn, false);
  assert.equal(exportResult.retention.dashboard_history, "client_session_only");
  assert.equal(exportResult.retention.private_artifact, true);
  assert.equal(exportResult.safeguards.export_history_affordance_client_only, true);
  assert.equal(exportResult.safeguards.export_download_non_persistent_by_default, true);
  assert.equal(exportResult.safeguards.export_private_artifact_notice, true);
  assert.equal(exportResult.safeguards.export_retention_controls, true);
  assert.equal(exportResult.safeguards.export_policy_surface_owner_admin_visible, true);
  assert.equal(exportResult.safeguards.export_policy_explains_download_rules, true);
  assert.equal(exportResult.safeguards.export_persistent_retention_settings_disabled_without_explicit_approval, true);
  assert.equal(exportResult.safeguards.export_persistent_retention_requires_expiry, true);
  assert.equal(exportResult.safeguards.export_persistent_retention_requires_audit_controls, true);
  assert.equal(exportResult.safeguards.export_retention_policy_has_no_storage_side_effect, true);
  assert.equal(state.communityMembers.length, 0, "Export UX/retention controls must not import or alter presentation bridge rows.");
  assert.equal(state.privacy.find((item) => item.user_id === "player-1")?.public_profile_enabled, 0);
  assertNoForbiddenSqlWrites(state.operations);

  const helper = read("functions/_lib/community-member-source-management.ts");
  const route = read("functions/api/owner/community-members/export.ts");
  const ui = read("components/community/community-member-source-dashboard.tsx");
  const combined = `${helper}\n${route}\n${ui}`;
  assert.doesNotMatch(combined, /community_member_export_history|export_history_records|INSERT INTO\s+community_member_source_exports|UPDATE\s+player_profile_privacy_preferences/i, "Export UX retention controls must not add persistent export logs or profile visibility mutations.");
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB/i, "Recent export history must stay in component state only.");
  assert.match(ui, /setRecentAuditExports/);
  assert.match(ui, /slice\(0,\s*CLIENT_RECENT_EXPORT_LIMIT\)/, "Recent export affordance should stay bounded in the dashboard.");
  assert.match(ui, /Clear local history/);
  assert.match(ui, /Not persisted by DZN/);
  assert.match(route, /x-dzn-export-retention/);
  assert.match(route, /x-dzn-export-persisted-by-dzn/);
  assert.match(route, /x-dzn-export-policy/);
}

async function assertExportPolicyRetentionSettings() {
  const state = createFakeState();
  state.audit.push(
    makeAudit("audit-policy-a", "server-1", "guild-row-1", "policy-candidate", "member-policy-a", "candidate_imported", "accepted", "Policy surface row remains export-safe.", "2026-08-26T13:00:00.000Z"),
  );
  const env = { DB: createFakeDb(state), DZN_PULSE_ENABLED: "true" } as Env;
  const ownerActor = { user: OWNER_USER, role: "owner" as const };
  const directPolicy = communityMemberSourceExportPolicy();
  assert.equal(directPolicy.owner_admin_visible, true);
  assert.equal(directPolicy.current_retention_mode, "download_only");
  assert.equal(directPolicy.private_artifact, true);
  assert.equal(directPolicy.persisted_exports_enabled, false);
  assert.equal(directPolicy.dashboard_history, "client_session_only");
  assert.equal(directPolicy.dashboard_history_limit, 5);
  assert.equal(directPolicy.max_rows_per_download, 500);
  assert.equal(directPolicy.export_file_retention, "not_persisted_by_dzn");
  assert.equal(directPolicy.sharing_links_enabled, false);
  assert.equal(directPolicy.browser_persistence_enabled, false);
  assert.equal(directPolicy.persistent_retention_model.status, "not_approved");
  assert.equal(directPolicy.persistent_retention_model.requires_explicit_approval, true);
  assert.equal(directPolicy.persistent_retention_model.requires_expiry, true);
  assert.equal(directPolicy.persistent_retention_model.requires_audit_controls, true);
  assert.equal(directPolicy.persistent_retention_model.required_design_controls.length >= 5, true);

  const listResult = await listCommunityMemberSourceManagement(env, ownerActor, { status: "all", limit: 20 });
  assert.equal(listResult.export_policy.current_retention_mode, "download_only");
  assert.equal(listResult.export_policy.persisted_exports_enabled, false);
  assert.equal(listResult.export_policy.persistent_retention_model.status, "not_approved");
  assert.equal(listResult.export_policy.persistent_retention_model.requires_explicit_approval, true);
  assert.equal(listResult.safeguards.export_policy_surface_owner_admin_visible, true);
  assert.equal(listResult.safeguards.export_retention_policy_has_no_storage_side_effect, true);

  const exportResult = await exportCommunityMemberSourceAudit(env, ownerActor, { limit: 9999 });
  assert.equal(exportResult.ok, true);
  if (!exportResult.ok) assert.fail("Export policy helper must return an export-safe payload.");
  assert.equal(exportResult.filters.limit, 500);
  assert.equal(exportResult.policy.max_rows_per_download, 500);
  assert.equal(exportResult.policy.persisted_exports_enabled, false);
  assert.equal(exportResult.policy.persistent_retention_model.status, "not_approved");
  assert.equal(exportResult.policy.persistent_retention_model.requires_expiry, true);
  assert.equal(exportResult.policy.persistent_retention_model.requires_audit_controls, true);
  assert.equal(exportResult.policy.rules.some((rule) => rule.includes("DZN does not persist export files")), true);
  assert.equal(exportResult.safeguards.export_persistent_retention_settings_disabled_without_explicit_approval, true);
  assert.equal(exportResult.safeguards.export_retention_policy_has_no_storage_side_effect, true);

  const helper = read("functions/_lib/community-member-source-management.ts");
  const route = read("functions/api/owner/community-members/export.ts");
  const ui = read("components/community/community-member-source-dashboard.tsx");
  const implementationSurface = `${helper}\n${route}\n${ui}`;
  assert.doesNotMatch(
    implementationSurface,
    /CREATE TABLE IF NOT EXISTS\s+(?:community_member_export|community_member_source_export|export_retention)|INSERT INTO\s+(?:community_member_export|community_member_source_export|export_retention)|UPDATE\s+(?:community_member_export|community_member_source_export|export_retention)|DELETE FROM\s+(?:community_member_export|community_member_source_export|export_retention)/i,
    "Policy slice must not add persistent export-retention tables or writes.",
  );
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB/i, "Policy surface must not persist dashboard export history in browser storage.");
  assert.match(ui, /Export policy/);
  assert.match(ui, /Owner\/admin visible policy/);
  assert.match(ui, /Optional retention settings/);
  assert.match(ui, /Persistent retention disabled/);
  assert.match(ui, /Requires explicit approval/);
  assert.match(ui, /Expiry and audit required/);
  assert.match(ui, /Stored export files off/);
  assert.match(ui, /Shared export links off/);
  assert.match(ui, /No stored export history/);
  assert.match(route, /x-dzn-export-persistent-retention/);
  assert.match(route, /x-dzn-export-retention-expiry-required-if-approved/);
  assert.match(route, /x-dzn-export-retention-audit-required-if-approved/);
  assert.equal(state.communityMembers.length, 0, "Export policy settings must not import or alter presentation bridge rows.");
  assert.equal(state.privacy.find((item) => item.user_id === "player-1")?.public_profile_enabled, 0);
  assertNoForbiddenSqlWrites(state.operations);
}

async function assertExportPolicyAdminGuardrails() {
  const state = createFakeState();
  state.audit.push(
    makeAudit("audit-admin-policy-a", "server-1", "guild-row-1", "policy-admin-candidate", "member-admin-policy-a", "candidate_imported", "accepted", "Admin policy review row remains export-safe.", "2026-08-26T14:00:00.000Z"),
  );
  const env = { DB: createFakeDb(state), DZN_PULSE_ENABLED: "true" } as Env;
  const ownerActor = { user: OWNER_USER, role: "owner" as const };
  const adminActor = { user: OWNER_USER, role: "admin" as const };
  const directReview = communityMemberSourceExportPolicyReview();
  assert.equal(directReview.admin_only, true);
  assert.equal(directReview.owner_scope_review, "all_owner_scopes");
  assert.equal(directReview.current_defaults_confirmed, true);
  assert.equal(directReview.retention_work_status, "blocked_until_approved");
  assert.equal(directReview.approval_required_before_retained_export_work, true);
  for (const gate of [
    "Dedicated approval required",
    "Migration required",
    "Expiry model required",
    "Storage plan required",
    "Security review required",
  ]) {
    assert.equal(directReview.required_approval_gates.includes(gate), true, `Admin policy review must require ${gate}.`);
  }
  assert.equal(directReview.checked_defaults.every((item) => item.ok), true, "Admin policy review must confirm every current export default.");
  assert.equal(directReview.checked_defaults.some((item) => item.key === "current_retention_mode" && item.actual === "download_only"), true);
  assert.equal(directReview.checked_defaults.some((item) => item.key === "persisted_exports_enabled" && item.actual === "false"), true);
  assert.equal(directReview.checked_defaults.some((item) => item.key === "export_file_retention" && item.actual === "not_persisted_by_dzn"), true);
  assert.equal(directReview.checked_defaults.some((item) => item.key === "dashboard_history" && item.actual === "client_session_only"), true);
  assert.equal(directReview.checked_defaults.some((item) => item.key === "sharing_links_enabled" && item.actual === "false"), true);
  assert.equal(directReview.checked_defaults.some((item) => item.key === "browser_persistence_enabled" && item.actual === "false"), true);
  assert.equal(directReview.blocked_future_work.length, 1);
  assert.equal(directReview.blocked_future_work[0]?.blocked, true);

  const ownerList = await listCommunityMemberSourceManagement(env, ownerActor, { status: "all", limit: 20 });
  assert.equal(ownerList.export_policy_review, null, "Normal owners must not receive the admin-only policy review payload.");
  assert.equal(ownerList.safeguards.export_policy_review_admin_only, true);
  assert.equal(ownerList.safeguards.future_retained_export_work_blocked_until_dedicated_approval, true);

  const adminList = await listCommunityMemberSourceManagement(env, adminActor, { status: "all", limit: 20 });
  assert.equal(adminList.export_policy_review?.admin_only, true);
  assert.equal(adminList.export_policy_review?.owner_scope_review, "all_owner_scopes");
  assert.equal(adminList.export_policy_review?.current_defaults_confirmed, true);
  assert.equal(adminList.export_policy_review?.retention_work_status, "blocked_until_approved");
  assert.equal(adminList.safeguards.export_policy_review_confirms_all_owner_scope_defaults, true);
  assert.equal(adminList.safeguards.future_retained_export_work_requires_migration, true);
  assert.equal(adminList.safeguards.future_retained_export_work_requires_expiry_model, true);
  assert.equal(adminList.safeguards.future_retained_export_work_requires_storage_plan, true);
  assert.equal(adminList.safeguards.future_retained_export_work_requires_security_review, true);

  const helper = read("functions/_lib/community-member-source-management.ts");
  const ui = read("components/community/community-member-source-dashboard.tsx");
  const docs = `${read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md")}\n${read("docs/PUBLIC_ACCESS_POLICY.md")}\n${read("docs/COMMUNITY_MEMBER_EXPORT_POLICY_ADMIN_GUARDRAILS_HANDOFF.md")}`;
  const combined = `${helper}\n${ui}\n${docs}`;
  assert.doesNotMatch(
    combined,
    /CREATE TABLE IF NOT EXISTS\s+(?:community_member_export|community_member_source_export|export_retention)|INSERT INTO\s+(?:community_member_export|community_member_source_export|export_retention)|UPDATE\s+(?:community_member_export|community_member_source_export|export_retention)|DELETE FROM\s+(?:community_member_export|community_member_source_export|export_retention)/i,
    "Admin guardrail slice must not add persistent export-retention tables or writes.",
  );
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB/i, "Admin policy review must not persist dashboard export history in browser storage.");
  assert.match(ui, /payload\?\.role === "admin"/, "Admin policy review UI must be role-gated by the server payload.");
  assert.match(ui, /exportPolicyReview/);
  assert.match(ui, /Admin export policy review/);
  assert.match(ui, /Current defaults confirmed/);
  assert.match(ui, /Future retained-export work blocked/);
  assert.equal(state.communityMembers.length, 0, "Admin policy review must not import or alter presentation bridge rows.");
  assert.equal(state.privacy.find((item) => item.user_id === "player-1")?.public_profile_enabled, 0);
  assertNoForbiddenSqlWrites(state.operations);
}

async function assertRetainedExportApprovalDesignOnly() {
  const state = createFakeState();
  state.audit.push(
    makeAudit("audit-retained-design-a", "server-1", "guild-row-1", "retained-design-candidate", null, "candidate_importable", "accepted", "Retained export approval design remains metadata only.", "2026-08-26T15:00:00.000Z"),
  );
  const env = { DB: createFakeDb(state), DZN_PULSE_ENABLED: "true" } as Env;
  const ownerActor = { user: OWNER_USER, role: "owner" as const };
  const adminActor = { user: OWNER_USER, role: "admin" as const };

  const directReview = communityMemberSourceExportPolicyReview();
  const design = directReview.retained_export_approval_design;
  assert.equal(design.status, "design_only_not_approved");
  assert.equal(design.implementation_blocked, true);
  assert.equal(design.approval_authority.required_approver_role, "dzn_platform_owner");
  assert.equal(design.approval_authority.required_review_roles.includes("security_reviewer"), true);
  assert.equal(design.approval_authority.required_review_roles.includes("data_retention_owner"), true);
  assert.equal(design.approval_authority.approval_record, "dedicated_retained_export_approval_issue_or_pr");
  assert.equal(design.approval_authority.issue_49_reserved_for_live_checkout, true);
  assert.equal(design.approval_authority.owner_self_approval_allowed, false);
  assert.equal(design.approval_authority.admin_ui_toggle_allowed, false);
  assert.equal(design.migration_shape.status, "design_only_not_applied");
  assert.equal(design.migration_shape.proposed_filename, "future_retained_community_member_audit_exports.sql");
  assert.equal(design.migration_shape.tables.some((table) => table.name === "community_member_retained_export_policies" && table.columns.includes("retention_days")), true);
  assert.equal(design.migration_shape.tables.some((table) => table.name === "community_member_retained_exports" && table.columns.includes("expires_at")), true);
  assert.equal(design.migration_shape.tables.some((table) => table.name === "community_member_retained_export_access_audit" && table.columns.includes("result_status")), true);
  assert.equal(design.migration_shape.prohibited_without_approval.includes("retained export migration file"), true);
  assert.equal(design.migration_shape.prohibited_without_approval.includes("export-history rows"), true);
  assert.equal(design.migration_shape.prohibited_without_approval.includes("stored export files"), true);
  assert.equal(design.migration_shape.prohibited_without_approval.includes("sharing links"), true);
  assert.equal(design.migration_shape.prohibited_without_approval.includes("retention setting write APIs"), true);
  assert.equal(design.expiry_model.default_retention_days, 7);
  assert.equal(design.expiry_model.max_retention_days, 30);
  assert.equal(design.expiry_model.expires_at_required, true);
  assert.equal(design.expiry_model.expired_downloads_denied, true);
  assert.equal(design.expiry_model.deletion_job_auth, "cron_secret_only");
  assert.equal(design.expiry_model.tombstone_on_delete, true);
  assert.equal(design.storage_plan.provider, "cloudflare_r2_private_bucket");
  assert.equal(design.storage_plan.binding_name, "COMMUNITY_MEMBER_EXPORTS_BUCKET");
  assert.equal(design.storage_plan.public_urls_enabled, false);
  assert.equal(design.storage_plan.signed_downloads_require_owner_admin_auth, true);
  assert.equal(design.storage_plan.persisted_payload, "export_safe_csv_only");
  assert.equal(design.storage_plan.forbidden_payloads.includes("raw Discord IDs"), true);
  assert.equal(design.storage_plan.forbidden_payloads.includes("Stripe secrets"), true);
  assert.equal(design.security_review_checklist.some((item) => item.includes("Cross-owner access denial")), true);
  assert.equal(design.rollback_rules.some((item) => item.includes("Disable retained export creation")), true);
  assert.equal(design.proof_requirements.some((item) => item.includes("Mutation scans prove no retained export files")), true);

  const ownerList = await listCommunityMemberSourceManagement(env, ownerActor, { status: "all", limit: 20 });
  assert.equal(ownerList.export_policy_review, null, "Normal owners must not receive the retained-export approval design payload.");
  assert.equal(ownerList.safeguards.retained_export_approval_design_only, true);
  assert.equal(ownerList.safeguards.retained_export_design_has_no_write_api, true);

  const adminList = await listCommunityMemberSourceManagement(env, adminActor, { status: "all", limit: 20 });
  const adminDesign = adminList.export_policy_review?.retained_export_approval_design;
  assert.equal(adminDesign?.status, "design_only_not_approved");
  assert.equal(adminDesign?.implementation_blocked, true);
  assert.equal(adminDesign?.approval_authority.required_approver_role, "dzn_platform_owner");
  assert.equal(adminDesign?.approval_authority.owner_self_approval_allowed, false);
  assert.equal(adminDesign?.approval_authority.admin_ui_toggle_allowed, false);
  assert.equal(adminDesign?.expiry_model.default_retention_days, 7);
  assert.equal(adminDesign?.expiry_model.max_retention_days, 30);
  assert.equal(adminDesign?.storage_plan.public_urls_enabled, false);
  assert.equal(adminList.safeguards.retained_export_design_requires_platform_owner_approval, true);
  assert.equal(adminList.safeguards.retained_export_design_requires_security_review_before_build, true);
  assert.equal(adminList.safeguards.retained_export_design_has_no_migration_side_effect, true);
  assert.equal(adminList.safeguards.retained_export_design_has_no_storage_side_effect, true);
  assert.equal(adminList.safeguards.retained_export_design_blocks_implementation_until_approved, true);
  assert.equal(adminList.safeguards.retained_export_design_keeps_issue_49_reserved, true);

  assert.equal(existsSync("migrations/future_retained_community_member_audit_exports.sql"), false, "Retained-export approval design must not add a migration file.");
  for (const path of [
    "functions/api/owner/community-members/retained-exports.ts",
    "functions/api/owner/community-members/retained-exports/[exportId].ts",
    "functions/api/owner/community-members/retained-exports/share.ts",
    "functions/api/owner/community-members/retention.ts",
  ]) {
    assert.equal(existsSync(path), false, `${path} must not exist in the design-only slice.`);
  }

  const helper = read("functions/_lib/community-member-source-management.ts");
  const ui = read("components/community/community-member-source-dashboard.tsx");
  const packageJson = read("package.json");
  const docs = `${read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md")}\n${read("docs/PUBLIC_ACCESS_POLICY.md")}\n${read("docs/COMMUNITY_MEMBER_RETAINED_EXPORT_APPROVAL_DESIGN_HANDOFF.md")}`;
  const combined = `${helper}\n${ui}\n${packageJson}\n${docs}`;
  const implementationSources = `${helper}\n${ui}\n${packageJson}`;
  assert.doesNotMatch(
    combined,
    /(?:CREATE\s+TABLE|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:community_member_retained_export_policies|community_member_retained_exports|community_member_retained_export_access_audit)\b/i,
    "Retained-export approval design must not add retained-export tables or writes.",
  );
  assert.doesNotMatch(
    implementationSources,
    /COMMUNITY_MEMBER_EXPORTS_BUCKET\s*\.\s*(?:put|get|delete|head)|\bR2Bucket\b|createSignedUrl|signedUrl|localStorage|sessionStorage|indexedDB|community_member_export_history/i,
    "Retained-export approval design must not add storage, signing, or browser-persistent history behavior.",
  );
  assertNoExternalOrLivePaymentMutation(helper, "Retained export approval helper");
  assertNoForbiddenMutationTargets(helper, "Retained export approval helper");
  assert.equal(state.communityMembers.length, 0, "Retained-export approval design must not import or alter presentation bridge rows.");
  assert.equal(state.privacy.find((item) => item.user_id === "player-1")?.public_profile_enabled, 0);
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

function makeAudit(
  id: string,
  linkedServerId: string,
  communityGuildId: string,
  candidateId: string | null,
  communityMemberId: string | null,
  action: string,
  resultStatus: string,
  reason: string | null,
  createdAt: string,
): FakeAudit {
  return {
    id,
    candidate_id: candidateId,
    community_member_id: communityMemberId,
    linked_server_id: linkedServerId,
    community_guild_id: communityGuildId,
    actor_user_id: OWNER_USER.id,
    actor_role: "owner",
    action,
    result_status: resultStatus,
    reason,
    created_at: createdAt,
  };
}

function makeNotification(id: string, userId: string, type: string, expiresAt: string | null): FakeNotification {
  return {
    id,
    user_id: userId,
    server_id: "server-1",
    type,
    title: "DZN Pulse",
    body: "Community member import alert.",
    action_url: "/dashboard/community-members?status=pending&issue=importable",
    dedupe_key: id,
    metadata: null,
    read_at: null,
    created_at: "2026-08-26T10:00:00.000Z",
    expires_at: expiresAt,
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
              const changes = mutate(state, sql, bindings);
              return { success: true, meta: { changes: Number(changes ?? 0) || 0 } };
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
    const linkedServerFilter = sql.includes("community_member_source_audit.linked_server_id = ?")
      ? bindings.find((value): value is string => typeof value === "string" && state.servers.some((server) => server.id === value))
      : null;
    const actionFilter = sql.includes("community_member_source_audit.action = ?")
      ? bindings.find((value): value is typeof AUDIT_ACTION_VALUES[number] => typeof value === "string" && AUDIT_ACTION_VALUES.includes(value as typeof AUDIT_ACTION_VALUES[number]))
      : null;
    const resultFilter = sql.includes("community_member_source_audit.result_status = ?")
      ? bindings.find((value): value is typeof AUDIT_RESULT_VALUES[number] => typeof value === "string" && AUDIT_RESULT_VALUES.includes(value as typeof AUDIT_RESULT_VALUES[number]))
      : null;
    const dateBindings = bindings.filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value));
    const dateFromFilter = sql.includes("datetime(community_member_source_audit.created_at) >= datetime(?)") ? dateBindings[0] : null;
    const dateToFilter = sql.includes("datetime(community_member_source_audit.created_at) <= datetime(?)") ? dateBindings[dateFromFilter ? 1 : 0] : null;
    return state.audit
      .filter((audit) => scopedAudit(state, audit, bindings))
      .filter((audit) => !linkedServerFilter || audit.linked_server_id === linkedServerFilter)
      .filter((audit) => !actionFilter || audit.action === actionFilter)
      .filter((audit) => !resultFilter || audit.result_status === resultFilter)
      .filter((audit) => !dateFromFilter || new Date(audit.created_at).getTime() >= new Date(dateFromFilter).getTime())
      .filter((audit) => !dateToFilter || new Date(audit.created_at).getTime() <= new Date(dateToFilter).getTime())
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
  if (sql.includes("SELECT COUNT(*) AS count") && sql.includes("FROM user_notifications")) {
    const userId = String(bindings[0] ?? "");
    const typeFilter = notificationTypeFilter(bindings.slice(1));
    return {
      count: state.notifications.filter((notification) => (
        notification.user_id === userId &&
        notification.read_at === null &&
        notificationIsActive(notification) &&
        (!typeFilter || typeFilter.has(notification.type))
      )).length,
    };
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
    if (!candidate) return 0;
    candidate.status = "rejected";
    candidate.reviewed_by_user_id = nullableString(bindings[0]);
    candidate.reason = nullableString(bindings[1]) ?? candidate.reason;
    return 1;
  }
  if (sql.includes("UPDATE user_notifications") && sql.includes("SET read_at = COALESCE")) {
    const readAt = String(bindings[0] ?? "");
    const userId = String(bindings[1] ?? "");
    const typeFilter = notificationTypeFilter(bindings.slice(2));
    let changes = 0;
    for (const notification of state.notifications) {
      if (
        notification.user_id === userId &&
        notification.read_at === null &&
        notificationIsActive(notification) &&
        (!typeFilter || typeFilter.has(notification.type))
      ) {
        notification.read_at = readAt;
        changes += 1;
      }
    }
    return changes;
  }
  if (sql.includes("INSERT OR IGNORE INTO user_notifications")) {
    const userId = String(bindings[1]);
    const dedupeKey = String(bindings[11]);
    if (state.notifications.some((item) => item.user_id === userId && item.dedupe_key === dedupeKey)) return 0;
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
      expires_at: nullableString(bindings[14]),
    });
    return 1;
  }
  return 0;
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

function notificationTypeFilter(bindings: unknown[]) {
  const types = bindings
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .filter((value) => value !== OWNER_USER.id && value !== OTHER_OWNER_USER.id);
  return types.length ? new Set(types) : null;
}

function notificationIsActive(notification: FakeNotification) {
  if (!notification.expires_at) return true;
  const expiresAt = new Date(notification.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > new Date("2026-08-26T10:00:00.000Z").getTime();
}

function assertNoForbiddenSqlWrites(operations: CapturedOperation[]) {
  for (const operation of operations.filter((item) => item.kind === "run")) {
    assertNoForbiddenMutationTargets(operation.sql, "Executed SQL");
  }
}

function assertNoSensitiveExportIdentifiers(value: unknown, label: string) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    OWNER_USER.id,
    OWNER_USER.discord_id,
    OTHER_OWNER_USER.id,
    OTHER_OWNER_USER.discord_id,
    "player-1",
    "player-2",
    "111122223333444455",
    "222233334444555566",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${label} must not expose ${forbidden}.`);
  }
}

function assertNoDownloadExportIdentifiers(value: unknown, label: string) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  for (const forbidden of [
    OWNER_USER.id,
    OWNER_USER.discord_id,
    OTHER_OWNER_USER.id,
    OTHER_OWNER_USER.discord_id,
    "server-1",
    "server-2",
    "guild-row-1",
    "guild-row-2",
    "player-1",
    "player-2",
    "111122223333444455",
    "222233334444555566",
    "audit-export-a",
    "audit-export-b",
    "player-1-candidate-raw",
    "player-2-candidate-raw",
    "member-111122223333444455",
    "member-222233334444555566",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${label} must not expose ${forbidden}.`);
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
