import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function expandOwnerConsolePreviewWorkflow(source: string) {
  return source.replace(
    /^        run: bash -e (scripts\/github-actions\/dzn-owner-console-preview\/[^\s]+\.sh)$/gm,
    (_match, scriptPath: string) => {
      const script = read(scriptPath).replace(/\r?\n$/, "");
      const indentedScript = script
        .split(/\r?\n/)
        .map((line) => (line.length > 0 ? `          ${line}` : ""))
        .join("\n");
      return `        run: |\n${indentedScript}`;
    },
  );
}

function indexOfOrFail(source: string, snippet: string) {
  const index = source.indexOf(snippet);
  assert.notEqual(index, -1, `Expected snippet not found: ${snippet}`);
  return index;
}

function extractInsertColumns(source: string, table: string) {
  const match = source.match(new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(([\\s\\S]*?)\\)\\s*VALUES`, "i"));
  assert.notEqual(match, null, `Expected lifecycle preview seed INSERT INTO ${table}.`);
  return match![1]
    .split(",")
    .map((column) => column.trim().replace(/^["'`]|["'`]$/g, ""))
    .filter(Boolean);
}

function assertInsertColumnsKnown(source: string, table: string, knownColumns: readonly string[]) {
  const known = new Set(knownColumns);
  const columns = extractInsertColumns(source, table);
  const missing = columns.filter((column) => !known.has(column));
  assert.deepEqual(missing, [], `${table} seed references missing columns.`);
}

const dznOwnerConsolePreviewWorkflowYaml = read(".github/workflows/dzn-owner-console-preview.yml");
const dznOwnerConsolePreviewWorkflow = expandOwnerConsolePreviewWorkflow(dznOwnerConsolePreviewWorkflowYaml);
const billingIntegrityPreviewScript = read("scripts/github-actions/dzn-owner-console-preview/32-verify-billing-integrity-preview.sh");

export function runOwnerConsolePreviewWorkflowBoundaryAssertions() {
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("name: DZN Owner Console Preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("workflow_dispatch:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("\n  push:"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("\n  schedule:"), false);
  const ownerPreviewDispatchBlock = dznOwnerConsolePreviewWorkflow.slice(
    indexOfOrFail(dznOwnerConsolePreviewWorkflow, "workflow_dispatch:"),
    indexOfOrFail(dznOwnerConsolePreviewWorkflow, "\nconcurrency:"),
  );
  assert.equal(ownerPreviewDispatchBlock.includes("branch:"), false, "Owner console preview workflow must not expose a branch input.");
  assert.equal(ownerPreviewDispatchBlock.includes("Branch to preview"), false, "Owner console preview form must not display Branch to preview.");
  assert.equal(ownerPreviewDispatchBlock.includes("preview_project_name:"), false, "Owner console preview form must not ask for preview project name.");
  assert.equal(ownerPreviewDispatchBlock.includes("preview_db_name:"), false, "Owner console preview form must not ask for preview D1 database name.");
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("inputs.branch"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("INPUT_BRANCH"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("feature/owner-console"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("feature/creator-only-event-governance"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("feature/event-platform-performance-foundation"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("feature/billing-phase-1-integrity"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("CANDIDATE_BRANCH: ${{ github.ref_name }}"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("CANDIDATE_REF: ${{ github.ref }}"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("CANDIDATE_SHA: ${{ github.sha }}"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("ref: ${{ github.sha }}"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Checked-out commit does not match github.sha."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Selected workflow ref SHA is not the current remote branch head."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("OWNER_CONSOLE_CANDIDATE_TREE_SHA"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("OWNER_CONSOLE_REMOTE_BRANCH_HEAD"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Owner console preview does not accept tag refs."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Owner console preview does not accept pull-request merge refs."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Owner console preview must never run from main, master, or production."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("feature/event-platform-performance-foundation may only run event-platform-performance-preview mode."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("feature/billing-phase-1-integrity may only run full-preview mode."), true);
  function acceptsOwnerConsolePreviewRef(input: { refName: string; ref?: string; sha?: string }) {
    const ref = input.ref ?? `refs/heads/${input.refName}`;
    const sha = input.sha ?? "184c0fe214810e2343abd7780b9e3e4f24945863";
    if (!input.refName || !sha) return false;
    if (!["refs/heads/feature/owner-console", "refs/heads/feature/creator-only-event-governance", "refs/heads/feature/event-platform-performance-foundation", "refs/heads/feature/billing-phase-1-integrity"].includes(ref)) return false;
    if (!["feature/owner-console", "feature/creator-only-event-governance", "feature/event-platform-performance-foundation", "feature/billing-phase-1-integrity"].includes(input.refName)) return false;
    if (["main", "master", "production"].includes(input.refName)) return false;
    return /^[a-f0-9]{40}$/.test(sha);
  }
  function acceptsOwnerConsolePreviewMode(input: { refName: string; mode: string }) {
    if (!acceptsOwnerConsolePreviewRef({ refName: input.refName })) return false;
    if (!["full-preview", "cleanup-preview-d1", "rebind-preview-d1", "repair-rebound-discord-preview", "verify-existing-creator-governance-preview", "event-platform-performance-preview"].includes(input.mode)) return false;
    if (input.refName === "feature/event-platform-performance-foundation") return input.mode === "event-platform-performance-preview";
    if (input.refName === "feature/billing-phase-1-integrity") return input.mode === "full-preview";
    if (input.mode === "event-platform-performance-preview") return input.refName === "feature/event-platform-performance-foundation";
    if (["rebind-preview-d1", "repair-rebound-discord-preview", "verify-existing-creator-governance-preview"].includes(input.mode)) return input.refName === "feature/creator-only-event-governance";
    return true;
  }
  assert.equal(acceptsOwnerConsolePreviewRef({ refName: "feature/creator-only-event-governance" }), true);
  assert.equal(acceptsOwnerConsolePreviewRef({ refName: "feature/owner-console" }), true);
  assert.equal(acceptsOwnerConsolePreviewRef({ refName: "feature/event-platform-performance-foundation" }), true);
  assert.equal(acceptsOwnerConsolePreviewRef({ refName: "feature/billing-phase-1-integrity" }), true);
  assert.equal(acceptsOwnerConsolePreviewRef({ refName: "main", ref: "refs/heads/main" }), false);
  assert.equal(acceptsOwnerConsolePreviewRef({ refName: "master", ref: "refs/heads/master" }), false);
  assert.equal(acceptsOwnerConsolePreviewRef({ refName: "production", ref: "refs/heads/production" }), false);
  assert.equal(acceptsOwnerConsolePreviewRef({ refName: "feature/other" }), false);
  assert.equal(acceptsOwnerConsolePreviewRef({ refName: "v1.0.0", ref: "refs/tags/v1.0.0" }), false);
  assert.equal(acceptsOwnerConsolePreviewRef({ refName: "123/merge", ref: "refs/pull/123/merge" }), false);
  assert.equal(acceptsOwnerConsolePreviewRef({ refName: "" }), false);
  assert.equal(acceptsOwnerConsolePreviewMode({ refName: "feature/billing-phase-1-integrity", mode: "full-preview" }), true);
  assert.equal(acceptsOwnerConsolePreviewMode({ refName: "feature/billing-phase-1-integrity", mode: "cleanup-preview-d1" }), false);
  assert.equal(acceptsOwnerConsolePreviewMode({ refName: "feature/billing-phase-1-integrity", mode: "rebind-preview-d1" }), false);
  assert.equal(acceptsOwnerConsolePreviewMode({ refName: "feature/billing-phase-1-integrity", mode: "repair-rebound-discord-preview" }), false);
  assert.equal(acceptsOwnerConsolePreviewMode({ refName: "feature/billing-phase-1-integrity", mode: "event-platform-performance-preview" }), false);
  assert.equal(acceptsOwnerConsolePreviewMode({ refName: "feature/event-platform-performance-foundation", mode: "event-platform-performance-preview" }), true);
  assert.equal(acceptsOwnerConsolePreviewMode({ refName: "feature/event-platform-performance-foundation", mode: "full-preview" }), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn_network_db_owner_console_preview_creator_governance_"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn_network_db_owner_console_preview_creator_governance_${CANDIDATE_SHORT_SHA}"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("PREVIEW_DB_NAME=%s"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("OWNER_CONSOLE_CREATOR_EVENT_NAME"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Creator Governance Preview Cup ${CANDIDATE_SHORT_SHA}"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_preview_only must equal PREVIEW_ONLY"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn-network-owner-console-preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn_network_db_owner_console_preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Preview Pages project must not equal the production Pages project."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Preview D1 database must not equal production D1 database."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Missing DZN_PLATFORM_OWNER_DISCORD_IDS for owner console preview."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes('DZN_PLATFORM_OWNER_DISCORD_IDS: "990000000000000101,990000000000000102"'), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes('DZN_PLATFORM_CREATOR_DISCORD_ID: "990000000000000102"'), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Missing fake DZN_PLATFORM_CREATOR_DISCORD_ID for creator-event-governance preview."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes('OWNER_PREVIEW_DISCORD_CLIENT_ID="990000000000000199"'), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("OWNER_PREVIEW_DISCORD_CLIENT_SECRET"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes('OWNER_PREVIEW_DISCORD_REDIRECT_URI="${PREVIEW_BASE_URL}/api/auth/discord/callback"'), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: \"false\""), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: \"false\""), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_PULSE_ENABLED: \"true\""), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("cleanup-preview-d1"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("rebind-preview-d1"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("repair-rebound-discord-preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("verify-existing-creator-governance-preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("event-platform-performance-preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("ACTIVATION_MODE_DEPRECATED_USE_REPAIR_MODE"), true);
  assert.equal(ownerPreviewDispatchBlock.includes("- activate-rebound-discord-preview"), false, "Obsolete activation mode must not be available in the workflow-dispatch form.");
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("preview_db_name_to_delete:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("cleanup_action:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("reviewed_preview_db_id_mask:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_preview_db_cleanup:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("rebind_action:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_preview_d1_rebind:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_rebound_discord_preview_deploy:"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("repair_action:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_rebound_discord_preview_repair:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_existing_creator_governance_preview:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_event_platform_performance_preview:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("APPROVE_STALE_PREVIEW_D1_CLEANUP"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("APPROVE_PREVIEW_D1_REBIND"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("APPROVE_REBOUND_DISCORD_PREVIEW_DEPLOY"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("APPROVE_REPAIR_REBOUND_DISCORD_PREVIEW"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("VERIFY_EXISTING_CREATOR_GOVERNANCE_PREVIEW"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("APPROVE_EVENT_PLATFORM_PERFORMANCE_PREVIEW"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_preview_db_cleanup must equal APPROVE_STALE_PREVIEW_D1_CLEANUP"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_preview_d1_rebind must equal APPROVE_PREVIEW_D1_REBIND"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_rebound_discord_preview_deploy must equal APPROVE_REBOUND_DISCORD_PREVIEW_DEPLOY"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_rebound_discord_preview_repair must equal APPROVE_REPAIR_REBOUND_DISCORD_PREVIEW"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_existing_creator_governance_preview must equal VERIFY_EXISTING_CREATOR_GOVERNANCE_PREVIEW"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_event_platform_performance_preview must equal APPROVE_EVENT_PLATFORM_PERFORMANCE_PREVIEW"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("repair_action must be dry-run or apply"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("rebind_action must be dry-run or apply"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("REBOUND_PREVIEW_PROJECT_NAME"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("REBIND_PREVIEW_PROJECT_NAME: dzn-network-discord-announcements-preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("REBIND_OLD_PREVIEW_DB_NAME: dzn_network_db_discord_announcements_preview_alignment_ee8c812"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("REBIND_OLD_PREVIEW_DB_ID_MASK: 44ef61d8...ef59"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("REBIND_REPLACEMENT_PREVIEW_DB_NAME: dzn_network_db_discord_announcements_preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("ACTIVATE_PREVIEW_PROJECT_NAME: dzn-network-discord-announcements-preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("ACTIVATE_REPLACEMENT_PREVIEW_DB_NAME: dzn_network_db_discord_announcements_preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("ACTIVATE_OLD_PREVIEW_DB_NAME: dzn_network_db_discord_announcements_preview_alignment_ee8c812"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("ACTIVATE_OLD_PREVIEW_DB_ID_MASK: 44ef61d8...ef59"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("APPROVED_MAIN_RUNTIME_SHA: a159571079dda1d8f0102718732008033cdfb763"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("REPAIR_PREVIEW_PROJECT_NAME: dzn-network-discord-announcements-preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("REPAIR_REPLACEMENT_PREVIEW_DB_NAME: dzn_network_db_discord_announcements_preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("REPAIR_OLD_PREVIEW_DB_NAME: dzn_network_db_discord_announcements_preview_alignment_ee8c812"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("REPAIR_OLD_PREVIEW_DB_ID_MASK: 44ef61d8...ef59"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("EXISTING_CREATOR_GOVERNANCE_PREVIEW_PROJECT_NAME: dzn-network-owner-console-preview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("EXISTING_CREATOR_GOVERNANCE_PREVIEW_DB_NAME: dzn_network_db_owner_console_preview_creator_governance_0919c46"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_NAME: Creator Governance Preview Cup 0919c46"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_SLUG: creator-governance-preview-cup-0919c46"), true);
  assert.equal(ownerPreviewDispatchBlock.includes("rebind_project"), false, "Owner console preview form must not ask for a rebind project.");
  assert.equal(ownerPreviewDispatchBlock.includes("old_database"), false, "Owner console preview form must not ask for an old rebind database.");
  assert.equal(ownerPreviewDispatchBlock.includes("replacement_database"), false, "Owner console preview form must not ask for a replacement rebind database.");
  assert.equal(ownerPreviewDispatchBlock.includes("activation_project"), false, "Owner console preview form must not ask for an activation project.");
  assert.equal(ownerPreviewDispatchBlock.includes("activation_database"), false, "Owner console preview form must not ask for activation database names.");
  assert.equal(ownerPreviewDispatchBlock.includes("Activation confirmation"), false, "Owner console preview form must not ask for obsolete activation confirmation.");
  assert.equal(ownerPreviewDispatchBlock.includes("runtime_commit"), false, "Owner console preview form must not ask for a runtime commit.");
  assert.equal(ownerPreviewDispatchBlock.includes("repair_project"), false, "Owner console preview form must not ask for a repair project.");
  assert.equal(ownerPreviewDispatchBlock.includes("repair_database"), false, "Owner console preview form must not ask for repair database names.");
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Refusing cleanup for production D1 database name."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Refusing cleanup for detected production D1 database name."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Refusing cleanup for database name without an approved DZN preview prefix."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Refusing wildcard, pattern, list, or space-containing cleanup target."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("delete cleanup requires reviewed_preview_db_id_mask in masked form"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("reviewed_preview_db_id_mask does not match the current cleanup target ID mask."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("target is bound to the production Pages project"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("target remains bound to Pages"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("target remains bound to a deployed Worker"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("target remains referenced by repository Wrangler config"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("active preview workflow is definitely using target"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("active preview workflow database use is uncertain"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Preview D1 cleanup dry-run completed. No database was deleted."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Final sanitized deletion summary"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Cloudflare cleanup token capability matrix"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("token source | verify | D1 read | Pages list | Pages detail | Worker binding read | D1 delete eligible source"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("CLOUDFLARE_PULSE_PREVIEW_TOKEN"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("CLOUDFLARE_API_TOKEN"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("PREVIEW_D1_PAGES_INVENTORY_UNAVAILABLE"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("PREVIEW_D1_API_REQUEST_INVALID"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("PREVIEW_D1_PAGES_PERMISSION_MISSING"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("PREVIEW_D1_WORKER_BINDING_AUDIT_UNAVAILABLE"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("PREVIEW_D1_BINDING_AUDIT_INCOMPLETE"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes('String(error.code) === "8000024"'), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("result?.status === 400"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("result?.status === 401 || result?.status === 403"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("http_status="), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("cloudflare_error_code="), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("sanitized_error="), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("token_source="), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("response_content_type="), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("response_body_length="), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Fix the workflow request before changing token permissions."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("corrected Pages read request returned 401/403 for all existing token sources."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("no existing Cloudflare token source has D1 read, Pages list/detail read, and Worker binding read"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("delete mode requires CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("PREVIEW_D1_BINDING_AUDIT_INCOMPLETE: delete mode blocked"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Selected cleanup token source:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("BLOCKED FOR DELETION:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("ELIGIBLE FOR EXPLICIT DELETION APPROVAL"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("D1 inventory count:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("D1 inventory: name="), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes('"production-protected"'), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes('"preview-candidate"'), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("pages_bindings="), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Pages projects inventoried:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Pages D1 binding:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Deployed Worker D1 bindings inventoried:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Worker D1 binding:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Repository Wrangler D1 bindings inventoried:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Repository Wrangler D1 binding:"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("repositoryWranglerBindings"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("wrangler.*\\.toml"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("worker-script-list"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("worker-script-settings"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/workers/scripts"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("deployment_configs?.[environment]"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("for (const environment of [\"production\", \"preview\"])"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("async function listPagesProjects(source)"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes('cloudflare(source, "pages-project-list", "/pages/projects")'), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/pages/projects?page=${page}&per_page=${safePerPage}"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("const safePerPage = returnedPerPage > 0 && returnedPerPage <= 20 ? returnedPerPage : 20"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("const d1 = await cloudflare(source, \"d1-database-list\", \"/d1/database?per_page=50&page=1\")"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("page += 1"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("result_info"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/pages/projects"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/pages/projects?per_page=100"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/pages/projects?per_page=50"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Could not list Pages projects before preview D1 cleanup."), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("method: \"DELETE\""), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("wrangler d1 delete"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("wrangler d1 create"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("D1_ACCOUNT_DATABASE_LIMIT: \"10\""), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("PREVIEW_D1_CAPACITY_EXHAUSTED"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Requested preview D1 exists: ${database ? \"yes\" : \"no\"}"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("No preview migrations, seed, Pages configuration, deployment, or event creation were attempted."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Preview-only cleanup candidates requiring review"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Reusing existing preview D1 database"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Production D1 protected by name and ID: yes"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Automatic deletion: none"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Refusing D1 command for non-preview owner console database name."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Refusing migration for non-preview owner console database name."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Refusing preview seed for non-preview owner console database name."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Preview D1 database id equals production D1 database id"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("npx wrangler d1 migrations apply DB --config wrangler.owner-console-preview.toml --remote"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("PRAGMA table_info(server_build_stats)"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("npx wrangler pages secret put DZN_PLATFORM_OWNER_DISCORD_IDS"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("npx wrangler pages secret put DZN_PLATFORM_CREATOR_DISCORD_ID"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("npx wrangler pages secret put SESSION_SECRET"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("npx wrangler pages secret put DISCORD_CLIENT_SECRET"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DISCORD_CLIENT_ID: { type: \"plain_text\", value: ownerPreviewDiscordClientId }"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DISCORD_REDIRECT_URI: { type: \"plain_text\", value: previewRedirectUri }"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DISCORD_CLIENT_ID = ${JSON.stringify(ownerPreviewDiscordClientId)}"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DISCORD_REDIRECT_URI = ${JSON.stringify(previewRedirectUri)}"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("--project-name \"${PREVIEW_PROJECT_NAME}\""), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("--project-name dzn-network"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("wrangler pages deploy out"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("owner-console-preview-immutable-url.txt"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("const retryablePreviewStatuses = new Set([522, 523, 524, 525, 526, 530])"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Waiting for owner console preview readiness"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Owner console preview readiness attempt"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Owner console preview did not become ready within 5 minutes."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("printUnexpectedResponseDiagnostic"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Unexpected owner console preview response"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("safeJsonDiagnostic"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("errorCode"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("requestId"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("bodyLength"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("messagePreview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn_session=[redacted-cookie]"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("[redacted-sql]"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("npm run test:owner-console"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("npm run test:creator-event-governance"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/owner/overview"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/owner/servers"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/owner/audit-log"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/owner/events"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/owner/events/create"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/events/suggest"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Check creator-governance preview test event fixture"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Creator-governance preview event fixture check completed without row deletion."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DELETE FROM sessions"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DELETE FROM competitive_events"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Verify creator-governance preview event row"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("owner-console-creator-event-count.json"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Creator-governance preview D1 row verified."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("owner-console-creator-event-foreign-key-check.json"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("created_by_user_exists"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("activity_count"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("activity_type"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("host_last_event_at_set"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Host registration/activity/foreign keys: verified"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/auth/discord/start?returnTo=%2Fowner"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/auth/discord/callback"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Discord auth start did not redirect to Discord."), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Discord OAuth start route: passed"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/owner logged-out protection: passed"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/owner non-owner 403: passed"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("/owner allowlisted owner access: passed"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Owner API secret redaction: passed"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("encrypted_token"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("TOKEN_ENCRYPTION_KEY"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_PLATFORM_OWNER_DISCORD_IDS"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_PLATFORM_CREATOR_DISCORD_ID"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: false"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: false"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Creator-only Event Control preview: passed"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Production D1 writes: none"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("Production Pages deploy: none"), true);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN Auto Update Schedulers"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("wrangler.adm-sync.toml"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("wrangler.auto-update.toml"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn-adm-sync-worker"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn-auto-update-worker"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("db:migrate:remote"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn_network_db --remote"), false);

  const ownerPreviewValidateInputsStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Validate preview-only inputs");
  const ownerPreviewInstallStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Install");
  const ownerPreviewVerifyExistingStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Verify existing creator-governance preview");
  const ownerPreviewPhase2APreflightStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Preflight event platform performance preview");
  const ownerPreviewPhase2AMigrateStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Apply only Phase 2A migration 0057 to preview");
  const ownerPreviewPhase2ASeedStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Seed deterministic Phase 2A preview data");
  const ownerPreviewPhase2ABuildStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Build Phase 2A preview runtime");
  const ownerPreviewPhase2ADeployStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Deploy Phase 2A preview from isolated directory");
  const ownerPreviewPhase2AVerifyStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Verify Phase 2A performance preview");
  const ownerPreviewPhase2AArtifactStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Upload Phase 2A preview artifact");
  const ownerPreviewValidateBranchStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Validate branch");
  const ownerPreviewCleanupStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Guarded preview D1 cleanup");
  const ownerPreviewRebindStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Guarded Discord preview D1 rebind");
  const ownerPreviewActivationStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Prepare pinned main runtime for Discord preview activation");
  const ownerPreviewActivationPreflightStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Preflight rebound Discord preview activation");
  const ownerPreviewActivationBuildStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Build pinned main runtime for rebound Discord preview");
  const ownerPreviewActivationDeployStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Deploy rebound Discord preview runtime");
  const ownerPreviewActivationVerifyStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Verify activated rebound Discord preview");
  const ownerPreviewRepairStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Audit and repair rebound Discord preview configuration");
  const ownerPreviewRepairPrepareStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Prepare pinned main runtime for rebound Discord preview repair");
  const ownerPreviewRepairBuildStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Build pinned main runtime for rebound Discord preview repair");
  const ownerPreviewRepairDeployStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Deploy repaired rebound Discord preview from isolated directory");
  const ownerPreviewRepairVerifyStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Verify repaired rebound Discord preview");
  const ownerPreviewResolveD1Start = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Resolve or create preview D1 database");
  const ownerPreviewMigrateStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Apply preview D1 migrations");
  const ownerPreviewConfigWrite =
    ownerPreviewResolveD1Start +
    indexOfOrFail(
      dznOwnerConsolePreviewWorkflow.slice(ownerPreviewResolveD1Start, ownerPreviewMigrateStart),
      'fs.writeFileSync("wrangler.owner-console-preview.toml"',
    );
  const ownerPreviewSeedStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Seed preview-only owner console data");
  const ownerPreviewEventFixtureCheckStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Check creator-governance preview test event fixture");
  const ownerPreviewDeployStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Deploy preview Pages project");
  const ownerPreviewVerifyStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Verify owner console preview");
  const ownerPreviewCreatorPost = indexOfOrFail(dznOwnerConsolePreviewWorkflow, 'await postJson("/api/owner/events", creatorCookie, 200, createPayload);');
  const ownerPreviewRowVerifyStart = indexOfOrFail(dznOwnerConsolePreviewWorkflow, "- name: Verify creator-governance preview event row");

  for (const [pattern, label] of [
    [/DELETE\s+FROM\s+sessions/i, "session row delete"],
    [/DELETE\s+FROM\s+competitive_events/i, "competitive event row delete"],
    [/TRUNCATE\s+(?:TABLE\s+)?sessions/i, "session truncate"],
    [/TRUNCATE\s+(?:TABLE\s+)?competitive_events/i, "competitive event truncate"],
    [/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?sessions/i, "session table drop"],
    [/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?competitive_events/i, "competitive event table drop"],
  ] as const) {
    assert.equal(pattern.test(dznOwnerConsolePreviewWorkflow), false, `Owner-console preview workflow must not contain a row-level protected ${label}.`);
  }
  const ownerPreviewSeedBlock = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewSeedStart, ownerPreviewEventFixtureCheckStart);
  assert.equal(ownerPreviewSeedBlock.includes("ON CONFLICT(id) DO UPDATE SET"), true, "Full-preview session fixtures must use a fixture-scoped upsert.");
  assert.equal(ownerPreviewSeedBlock.includes("session_token_hash = excluded.session_token_hash"), true, "Full-preview session upsert must preserve authentication behaviour without deleting sessions.");
  assert.equal(ownerPreviewSeedBlock.includes("DELETE FROM sessions"), false, "Full-preview seed must not delete session rows.");
  assert.equal(ownerPreviewSeedBlock.includes("'owner-console-creator-host', 'owner-console-platform-creator'"), true, "Full-preview must seed a creator-owned official event host fixture.");
  assert.equal(ownerPreviewSeedBlock.includes("'owner-console-creator-host-sub', 'owner-console-creator-host-guild'"), true, "Full-preview creator-owned host must have an eligible subscription fixture.");
  const ownerPreviewEventFixtureCheckBlock = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewEventFixtureCheckStart, ownerPreviewDeployStart);
  assert.equal(ownerPreviewEventFixtureCheckBlock.includes("SELECT COUNT(*) AS existing_event_count"), true, "Full-preview creator event fixture check must be read-only.");
  assert.equal(ownerPreviewEventFixtureCheckBlock.includes("DELETE FROM competitive_events"), false, "Full-preview creator event fixture check must not delete event rows.");
  assert.equal(ownerPreviewEventFixtureCheckBlock.includes("owner-console-creator-event-preflight.json"), true, "Full-preview creator event fixture check must persist a safe preflight result.");
  const ownerPreviewVerifyBlock = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewVerifyStart, ownerPreviewRowVerifyStart);
  assert.equal(ownerPreviewVerifyBlock.includes('hosting_server_id: "owner-console-creator-host"'), true, "Full-preview creator event POST must use the creator-owned host fixture.");
  assert.equal(ownerPreviewVerifyBlock.includes('hosting_server_id: "owner-console-nuketown"'), false, "Full-preview creator event POST must not use another owner server as host.");
  const ownerPreviewMigrateYamlStart = indexOfOrFail(dznOwnerConsolePreviewWorkflowYaml, "- name: Apply preview D1 migrations");
  const ownerPreviewBillingVerifyYamlStart = indexOfOrFail(dznOwnerConsolePreviewWorkflowYaml, "- name: Verify billing integrity preview schema");
  const ownerPreviewSeedYamlStart = indexOfOrFail(dznOwnerConsolePreviewWorkflowYaml, "- name: Seed preview-only owner console data");
  const ownerPreviewBillingVerifyYamlBlock = dznOwnerConsolePreviewWorkflowYaml.slice(ownerPreviewBillingVerifyYamlStart, ownerPreviewSeedYamlStart);
  assert.equal(ownerPreviewBillingVerifyYamlBlock.includes("github.ref_name == 'feature/billing-phase-1-integrity' && inputs.mode == 'full-preview'"), true, "Billing verification step must be branch and full-preview gated.");
  assert.equal(ownerPreviewBillingVerifyYamlBlock.includes("run: bash -e scripts/github-actions/dzn-owner-console-preview/32-verify-billing-integrity-preview.sh"), true, "Billing verification step must call the extracted script.");
  assert.equal(ownerPreviewBillingVerifyYamlBlock.includes("wrangler d1 execute"), false, "Billing verification YAML must not inline remote D1 execution.");
  assert.equal(ownerPreviewBillingVerifyYamlBlock.includes("INSERT INTO"), false, "Billing verification YAML must not insert remote preview rows inline.");
  assert.equal(ownerPreviewBillingVerifyYamlBlock.includes("UPDATE "), false, "Billing verification YAML must not update remote preview rows inline.");
  assert.equal(ownerPreviewBillingVerifyYamlBlock.includes("DELETE FROM"), false, "Billing verification YAML must not delete remote preview rows inline.");
  assert.equal(ownerPreviewMigrateYamlStart < ownerPreviewBillingVerifyYamlStart && ownerPreviewBillingVerifyYamlStart < ownerPreviewSeedYamlStart, true, "Billing verification must run after migrations and before preview seed.");
  assert.equal(billingIntegrityPreviewScript.includes("SELECT name FROM d1_migrations ORDER BY id;"), true, "Billing verification must read the migration ledger.");
  assert.equal(billingIntegrityPreviewScript.includes("0057_event_suggestions_phase_2a.sql"), true, "Billing verification must assert migration 0057 remains event suggestions.");
  assert.equal(billingIntegrityPreviewScript.includes("0058_billing_phase_1_integrity.sql"), true, "Billing verification must assert billing migration 0058.");
  assert.equal(billingIntegrityPreviewScript.includes("0057_billing_phase_1_integrity.sql"), true, "Billing verification must reject stale 0057 billing ledger entries.");
  assert.equal(billingIntegrityPreviewScript.includes("SELECT substr(name, 1, 4) AS prefix, COUNT(*) AS count"), true, "Billing verification must check duplicate migration prefixes.");
  assert.equal(billingIntegrityPreviewScript.includes("linked_server_allowance_reservations"), true, "Billing verification must inspect the reservation table.");
  assert.equal(billingIntegrityPreviewScript.includes("idx_lsar_user_status_expires"), true, "Billing verification must inspect reservation indexes.");
  assert.equal(billingIntegrityPreviewScript.includes("idx_lsar_linked_server_status"), true, "Billing verification must inspect reservation indexes.");
  assert.equal(billingIntegrityPreviewScript.includes("idx_lsar_discord_user_status"), true, "Billing verification must inspect reservation indexes.");
  assert.equal(billingIntegrityPreviewScript.includes("idx_lsar_active_linked_server"), true, "Billing verification must inspect reservation indexes.");
  assert.equal(billingIntegrityPreviewScript.includes("idx_nitrado_connections_user_linked_server_updated"), true, "Billing verification must inspect exact-token lookup indexes.");
  assert.equal(billingIntegrityPreviewScript.includes("idx_linked_servers_user_service_active"), true, "Billing verification must inspect active-service lookup indexes.");
  assert.equal(billingIntegrityPreviewScript.includes("idx_linked_servers_active_service_id"), true, "Billing verification must inspect active-service uniqueness indexes.");
  assert.equal(billingIntegrityPreviewScript.includes("PRAGMA foreign_key_check;"), true, "Billing verification must run foreign_key_check read-only.");
  assert.equal(billingIntegrityPreviewScript.includes("Refusing billing verification for non-preview owner console database name."), true, "Billing verification must reject non-preview D1 names.");
  assert.equal(billingIntegrityPreviewScript.includes("PRODUCTION_D1_DATABASE_NAME"), true, "Billing verification must compare against the production D1 name.");
  assert.equal(billingIntegrityPreviewScript.includes("DETECTED_PRODUCTION_D1_DATABASE_ID"), true, "Billing verification must compare against the detected production D1 id.");
  assert.deepEqual(billingIntegrityPreviewScript.match(/--command\s+"[^"]*\b(?:INSERT|UPDATE|DELETE)\b[^"]*"/gi) ?? [], [], "Billing verification must not execute remote mutating D1 commands.");
  assert.equal(billingIntegrityPreviewScript.includes("npx wrangler d1 migrations apply"), false, "Billing verification must not apply remote migrations.");

  const ownerPreviewValidateBlock = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewValidateInputsStart, ownerPreviewInstallStart);
  assert.equal(ownerPreviewValidateBlock.includes("wrangler.owner-console-preview.toml"), false, "Input validation must not require the generated preview Wrangler config.");
  assert.equal(ownerPreviewValidateBlock.includes("owner-console-creator-event-count.json"), false, "Input validation must not query the creator preview event row.");
  assert.equal(ownerPreviewValidateBlock.includes("rebind-preview-d1"), true, "Input validation must allow the guarded rebind mode.");
  assert.equal(ownerPreviewValidateBlock.includes("verify-existing-creator-governance-preview"), true, "Input validation must allow the existing-preview verification mode.");
  assert.equal(ownerPreviewValidateBlock.includes('PREVIEW_DB_NAME="${EXISTING_CREATOR_GOVERNANCE_PREVIEW_DB_NAME}"'), true, "Existing-preview mode must use the fixed reviewed database name.");
  assert.equal(ownerPreviewValidateBlock.includes('CREATOR_EVENT_NAME="${EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_NAME}"'), true, "Existing-preview mode must use the fixed reviewed event name.");
  assert.equal(ownerPreviewValidateBlock.includes("verify-existing-creator-governance-preview mode may only run from feature/creator-only-event-governance."), true, "Existing-preview verification must be tied to the reviewed feature branch.");
  assert.equal(ownerPreviewValidateBlock.includes("VERIFY_EXISTING_CREATOR_GOVERNANCE_PREVIEW"), true, "Existing-preview verification must require exact confirmation.");
  assert.equal(ownerPreviewValidateBlock.includes("EXISTING_CREATOR_GOVERNANCE_PREVIEW_DB_NAME"), true, "Existing-preview verification must use the fixed reviewed DB env constant.");
  assert.equal(ownerPreviewValidateBlock.includes("rebind-preview-d1 mode may only run from feature/creator-only-event-governance."), true, "Rebind mode must be tied to the reviewed feature branch.");
  assert.equal(ownerPreviewValidateBlock.includes("Refusing rebind for production Pages project."), true, "Rebind mode must reject the real production Pages project.");
  assert.equal(ownerPreviewValidateBlock.includes("Refusing rebind for production D1 database name."), true, "Rebind mode must reject production D1 names.");
  const ownerPreviewVerifyExistingBlock = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewVerifyExistingStart, ownerPreviewPhase2APreflightStart);
  assert.equal(ownerPreviewVerifyExistingBlock.includes("verify-existing-creator-governance-preview"), true, "Existing-preview step must be explicitly mode-gated.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("EXISTING_CREATOR_GOVERNANCE_PREVIEW_DB_NAME"), true, "Existing-preview step must use the fixed reviewed preview D1 env constant.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("CANDIDATE_SHORT_SHA"), false, "Existing-preview step must not derive a new SHA-scoped database.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("Creator Governance Preview Cup 0919c46"), true, "Existing-preview step must verify the fixed reviewed event.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("creator-governance-preview-cup-0919c46"), false, "Existing-preview step must use the slug env constant instead of user-entered literals.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("PREVIEW_D1_DATABASE_ID=${previewId}"), true, "Existing-preview step must resolve the exact preview D1 id.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("Existing creator-governance preview D1 matches production by name or id."), true, "Existing-preview step must reject production D1 by name or id.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("deployment_configs"), true, "Existing-preview step must read Pages project deployment configs.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED"), true, "Existing-preview step must verify server announcement flag remains false.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED"), true, "Existing-preview step must verify Discord notifications flag remains false.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("--command \"${VERIFY_SQL}\""), true, "Existing-preview row query must use --command, not --file.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("> owner-console-creator-event-count.json"), true, "Existing-preview row query must separate stdout JSON.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("2> owner-console-creator-event-count.stderr.log"), true, "Existing-preview row query must separate stderr progress output.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("parseWranglerJsonFile"), true, "Existing-preview step must defensively parse Wrangler JSON.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("byteLength="), true, "Malformed Wrangler output diagnostic must report byte length.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("jsonStartFound="), true, "Malformed Wrangler output diagnostic must report JSON start detection.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("firstSafeLine="), true, "Malformed Wrangler output diagnostic must report only a sanitized first line.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("PRAGMA foreign_key_check;"), true, "Existing-preview step must run foreign_key_check read-only.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("/owner"), true, "Existing-preview step must verify protected owner route.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("/api/owner/overview"), true, "Existing-preview step must verify protected owner APIs.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("/api/public/servers"), true, "Existing-preview step must verify public APIs remain available.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("discordNotificationsEnabled"), true, "Existing-preview step must verify public Discord notifications remain false.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("method: \"POST\""), false, "Existing-preview mode must not POST event creation.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("/api/owner/events"), false, "Existing-preview mode must not call event mutation APIs.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("npx wrangler d1 create"), false, "Existing-preview mode must not create D1 databases.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("method: \"DELETE\""), false, "Existing-preview mode must not delete D1 databases.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("npx wrangler d1 migrations apply"), false, "Existing-preview mode must not run migrations.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("owner-console-preview-seed.sql"), false, "Existing-preview mode must not seed data.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("wrangler pages deploy"), false, "Existing-preview mode must not deploy Pages.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("method: \"PATCH\""), false, "Existing-preview mode must not patch Pages.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("wrangler pages secret put"), false, "Existing-preview mode must not update secrets.");
  assert.equal(ownerPreviewVerifyExistingBlock.includes("discord.com/api"), false, "Existing-preview mode must not call Discord.");
  const ownerPreviewPhase2ABlock = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewPhase2APreflightStart, ownerPreviewValidateBranchStart);
  const ownerPreviewPhase2ACacheStart = ownerPreviewPhase2ABlock.indexOf("async function verifyCache(base)");
  const ownerPreviewPhase2AAuthMatrixStart = ownerPreviewPhase2ABlock.indexOf("function buildVerifierSuggestionPayload()");
  const ownerPreviewPhase2APaginationStart = ownerPreviewPhase2ABlock.indexOf("async function verifyPagination(base)");
  assert.notEqual(ownerPreviewPhase2ACacheStart, -1, "Phase 2A verifier must define a cache verification check.");
  assert.notEqual(ownerPreviewPhase2AAuthMatrixStart, -1, "Phase 2A verifier must define an auth matrix check.");
  assert.notEqual(ownerPreviewPhase2APaginationStart, -1, "Phase 2A verifier must define a pagination check after the auth matrix.");
  const ownerPreviewPhase2ACacheBlock = ownerPreviewPhase2ABlock.slice(ownerPreviewPhase2ACacheStart, ownerPreviewPhase2AAuthMatrixStart);
  const ownerPreviewPhase2AAuthMatrixBlock = ownerPreviewPhase2ABlock.slice(ownerPreviewPhase2AAuthMatrixStart, ownerPreviewPhase2APaginationStart);
  const verifierDescriptionMatch = ownerPreviewPhase2AAuthMatrixBlock.match(/const verifierDescription = "([^"]+)";/);
  assert.notEqual(verifierDescriptionMatch, null, "Phase 2A verifier must use a deterministic valid suggestion description.");
  const verifierDescriptionWordCount = verifierDescriptionMatch![1].split(/\s+/).filter(Boolean).length;
  assert.equal(verifierDescriptionWordCount >= 40 && verifierDescriptionWordCount <= 250, true, "Phase 2A verifier suggestion description must satisfy the API word-count contract.");
  assert.equal(ownerPreviewValidateBlock.includes("event-platform-performance-preview"), true, "Input validation must allow the Phase 2A performance preview mode.");
  assert.equal(ownerPreviewValidateBlock.includes("event-platform-performance-preview mode may only run from feature/event-platform-performance-foundation."), true, "Phase 2A preview mode must be tied to the reviewed feature branch.");
  assert.equal(ownerPreviewValidateBlock.includes("APPROVE_EVENT_PLATFORM_PERFORMANCE_PREVIEW"), true, "Phase 2A preview mode must require exact confirmation.");
  assert.equal(ownerPreviewValidateBlock.includes('PREVIEW_DB_NAME="${EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME}"'), true, "Phase 2A preview must use the fixed reusable preview DB.");
  assert.equal(ownerPreviewValidateBlock.includes("Event platform performance preview must use the fixed reusable preview D1."), true, "Phase 2A preview DB must not come from user input.");
  assert.equal(ownerPreviewValidateBlock.includes('if [ "${MODE}" = "full-preview" ]; then'), true, "Owner preview session/Discord secrets must only be generated for full-preview.");
  assert.equal(ownerPreviewPhase2ABlock.includes("event-platform-performance-preview"), true, "Phase 2A preview steps must be explicitly mode-gated.");
  assert.equal(ownerPreviewPhase2ABlock.includes("dzn-network-owner-console-preview"), true, "Phase 2A preview must use the fixed owner-console preview project.");
  assert.equal(ownerPreviewPhase2ABlock.includes("dzn_network_db_owner_console_preview_creator_governance_0919c46"), true, "Phase 2A preview must use the fixed reusable preview D1.");
  assert.equal(ownerPreviewPhase2ABlock.includes("dzn-network-discord-announcements-preview"), false, "Phase 2A preview must not target the Discord-announcements preview project.");
  assert.equal(ownerPreviewPhase2ABlock.includes("npx wrangler d1 create"), false, "Phase 2A preview mode must not create D1 databases.");
  assert.equal(ownerPreviewPhase2ABlock.includes("method: \"DELETE\""), false, "Phase 2A preview mode must not delete D1 databases.");
  assert.equal(ownerPreviewPhase2ABlock.includes("wrangler pages secret put"), false, "Phase 2A preview mode must not update Pages secrets.");
  assert.equal(ownerPreviewPhase2ABlock.includes("OWNER_PREVIEW_SESSION_SECRET"), false, "Phase 2A preview mode must not generate or use a workflow-only SESSION_SECRET.");
  assert.equal(ownerPreviewPhase2ABlock.includes("OWNER_PREVIEW_DISCORD_CLIENT_SECRET"), false, "Phase 2A preview mode must not rotate preview Discord client secret.");
  assert.equal(ownerPreviewPhase2ABlock.includes("./node_modules/.bin/wrangler d1 migrations apply DB"), true, "Phase 2A preview mode must apply migration 0057 when absent.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_MIGRATION_ROOT=\"${RUNNER_TEMP}/dzn-phase2a-0057-only\""), true, "Phase 2A preview migrations must use an isolated temporary migration root.");
  assert.equal(ownerPreviewPhase2ABlock.includes("--cwd \"${PHASE2A_MIGRATION_ROOT}\""), true, "Phase 2A preview migrations must run Wrangler from the isolated migration root.");
  assert.equal(ownerPreviewPhase2ABlock.includes("--migrations-dir"), false, "Phase 2A preview must not use unsupported Wrangler migration-dir flags.");
  assert.equal(ownerPreviewPhase2ABlock.includes("0057_event_suggestions_phase_2a.sql"), true, "Phase 2A preview must reference migration 0057.");
  assert.equal(ownerPreviewPhase2ABlock.includes("0058_"), false, "Phase 2A preview must not run a follow-up migration.");
  assert.equal(ownerPreviewPhase2ABlock.includes("phase2a-preview-"), true, "Phase 2A preview seed rows must be namespaced.");
  assert.equal(ownerPreviewPhase2ABlock.includes("DELETE FROM event_suggestions WHERE id LIKE"), false, "Phase 2A preview seed must not broadly delete deterministic suggestion fixtures.");
  assert.equal(ownerPreviewPhase2ABlock.includes("owner-console-preview-phase2a-api-member-token"), false, "Phase 2A preview must not create or use a new invalid API verifier token.");
  assert.equal(ownerPreviewPhase2ABlock.includes("INSERT INTO sessions (id, user_id, session_token_hash"), false, "Phase 2A preview must not create a new API verifier session hash.");
  assert.equal(ownerPreviewPhase2ABlock.includes("crypto.createHmac"), false, "Phase 2A preview must not calculate a new session HMAC.");
  assert.equal(ownerPreviewPhase2ABlock.includes("dev-session-secret"), false, "Phase 2A preview must not fall back to dev-session-secret.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_API_MEMBER_USER_ID=owner-console-non-owner-user"), true, "Phase 2A preview must use the existing non-owner member as the API verifier principal.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_API_MEMBER_COOKIE=dzn_session=owner-console-preview-non-owner-token"), true, "Phase 2A preview must reuse OWNER_CONSOLE_NON_OWNER_COOKIE for the API verifier.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_API_MEMBER_COOKIE"), true, "Phase 2A preview must expose the reused verifier cookie internally.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_CREATOR_HOST_ID=phase2a-preview-creator-host"), true, "Phase 2A preview must define a creator-owned host authorization fixture.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_FOREIGN_HOST_ID=phase2a-preview-foreign-host"), true, "Phase 2A preview must define a foreign-owned host authorization fixture.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_HOST_AUTH_FIXTURE_COLLISION"), true, "Phase 2A preview must block unexpected host fixture ownership before upsert.");
  assert.equal(ownerPreviewPhase2ABlock.includes("hostAuthorizationFixturesUpsertedNonDestructively"), true, "Phase 2A seed summary must record non-destructive host fixture upserts.");
  assert.equal(ownerPreviewPhase2ABlock.includes("ON CONFLICT(id) DO UPDATE SET guild_id = excluded.guild_id"), true, "Phase 2A linked-server fixture upserts must not update user_id on conflict.");
  assert.equal(ownerPreviewPhase2ABlock.includes("user_id = excluded.user_id"), false, "Phase 2A linked-server fixture upserts must not overwrite server ownership.");
  assert.equal(ownerPreviewPhase2ABlock.includes("submitted_by_user_id = ${sql(apiMemberId)}"), true, "Phase 2A preview must clean API-generated verifier rows by dedicated user.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_API_VERIFIER_UNEXPECTED_CONVERTED_ROW"), true, "Phase 2A preview must block broad cleanup if the verifier user has a converted suggestion.");
  assert.equal(ownerPreviewPhase2ABlock.includes("DELETE FROM sessions WHERE id = ${sql(obsoleteApiSessionId)};"), false, "Phase 2A preview must not delete even obsolete preview session rows.");
  assert.equal(ownerPreviewPhase2ABlock.includes("obsoletePreviewSessionLeftUntouched"), true, "Phase 2A seed summary must record obsolete preview sessions are left untouched.");
  assert.equal(ownerPreviewPhase2ABlock.includes("sessionRowsDeleted: 0"), true, "Phase 2A seed summary must record zero session row deletes.");
  assert.equal(ownerPreviewPhase2ABlock.includes("owner-console-non-owner-session');"), false, "Phase 2A preview must never delete the canonical non-owner preview session.");
  assert.equal(ownerPreviewPhase2ABlock.includes("SELECT session_token_hash"), false, "Phase 2A preview must not select or print session hashes.");
  assert.equal(ownerPreviewPhase2ABlock.includes("session-verification.json"), true, "Phase 2A preview must write sanitized session verification.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_VERIFIED_MEMBER_SESSION_UNAVAILABLE"), true, "Phase 2A preview must fail clearly when the reused member session is unavailable.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_VERIFIED_MEMBER_SESSION_REJECTED"), true, "Phase 2A verifier must classify a rejected reused member session.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_PREVIEW_ROLE_SESSION_INVALID"), true, "Phase 2A verifier must validate owner/creator/member role sessions before the auth matrix.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_RUN_KEY"), true, "Phase 2A preview must derive a run-scoped conversion fixture key.");
  assert.equal(ownerPreviewPhase2ABlock.includes("GITHUB_RUN_ID"), true, "Phase 2A preview run-scoped fixture must include GITHUB_RUN_ID.");
  assert.equal(ownerPreviewPhase2ABlock.includes("GITHUB_RUN_ATTEMPT"), true, "Phase 2A preview run-scoped fixture must include GITHUB_RUN_ATTEMPT.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_CONVERSION_TARGET_ID"), true, "Phase 2A preview must export the run-scoped conversion target id.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_CONVERSION_EVENT_ID"), true, "Phase 2A preview must export the run-scoped conversion event id.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_RUN_SCOPED_FIXTURE_COLLISION"), true, "Phase 2A preview must block run-scoped fixture collisions instead of resetting rows.");
  assert.equal(ownerPreviewPhase2ABlock.includes("phase2a-preview-conversion-target"), false, "Phase 2A preview must not use the old fixed conversion target.");
  assert.equal(ownerPreviewPhase2ABlock.includes("suggestion-draft-phase2a-preview-conversion-target"), false, "Phase 2A preview must not use the old fixed conversion event id.");
  assert.equal(ownerPreviewPhase2ABlock.includes("protected-row-invariants.json"), true, "Phase 2A preview must record protected row invariants.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_PROTECTED_SESSION_MUTATION_BLOCKED"), true, "Phase 2A preview must scan generated seed SQL for protected session mutations.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_PROTECTED_EVENT_MUTATION_BLOCKED"), true, "Phase 2A preview must scan generated seed SQL for protected event mutations.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_DESTRUCTIVE_SEED_SQL_BLOCKED"), true, "Phase 2A preview must scan generated seed SQL for destructive statements.");
  assert.equal(
    ownerPreviewPhase2ABlock.indexOf("Phase 2A generated seed SQL safety scan passed.") < ownerPreviewPhase2ABlock.indexOf("--file phase2a-preview-seed.sql"),
    true,
    "Phase 2A generated seed SQL safety scan must run before remote seed execution.",
  );
  assert.equal(ownerPreviewPhase2ABlock.includes("Creator Governance Preview Cup 0919c46"), false, "Phase 2A seed must not delete the verified creator-governance preview event.");
  assert.equal(ownerPreviewPhase2ABlock.includes("npm run test:performance-foundation"), true, "Phase 2A preview build must run performance foundation tests.");
  assert.equal(ownerPreviewPhase2ABlock.includes("./node_modules/.bin/wrangler pages functions build functions"), true, "Phase 2A preview build must compile Pages Functions.");
  assert.equal(ownerPreviewPhase2ABlock.includes("node scripts/patch-pages-routes.mjs"), true, "Phase 2A preview build must normalize routes after Functions build.");
  assert.equal(ownerPreviewPhase2ABlock.includes("cp .pages-functions/index.js out/_worker.js"), true, "Phase 2A preview build must package the Functions worker.");
  assert.equal(ownerPreviewPhase2ABlock.includes("test -s out/_worker.js"), true, "Phase 2A preview must require a packaged worker.");
  assert.equal(ownerPreviewPhase2ABlock.includes("DEPLOY_ROOT=\"${RUNNER_TEMP}/dzn-phase2a-preview-deploy\""), true, "Phase 2A deploy must use a clean RUNNER_TEMP directory.");
  assert.equal(ownerPreviewPhase2ABlock.includes("cp -R out \"${DEPLOY_ROOT}/out\""), true, "Phase 2A deploy must copy only final output.");
  assert.equal(ownerPreviewPhase2ABlock.includes("Unapproved Wrangler or env configuration is deploy-visible for Phase 2A preview."), true, "Phase 2A deploy must reject deploy-visible config files.");
  assert.equal(ownerPreviewPhase2ABlock.includes("Deployment-visible Phase 2A output contains the production D1 UUID."), true, "Phase 2A deploy must block exact production D1 ID leakage.");
  assert.equal(ownerPreviewPhase2ABlock.includes("--project-name \"${EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME}\""), true, "Phase 2A deploy must target the fixed preview project.");
  assert.equal(ownerPreviewPhase2ABlock.includes("--project-name dzn-network"), false, "Phase 2A deploy must not target the real production project.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PREVIEW_DEPLOY_CONFIGURATION_DRIFT"), true, "Phase 2A verification must detect binding drift before route probes.");
  assert.equal(
    ownerPreviewPhase2ABlock.indexOf("await verifyProjectConfig();") < ownerPreviewPhase2ABlock.indexOf("await verifyBase(immutableUrl)"),
    true,
    "Phase 2A route probes must run only after post-deploy binding verification.",
  );
  assert.equal(
    ownerPreviewPhase2ABlock.indexOf("phase2a-session-verification.sql") < ownerPreviewPhase2ABlock.indexOf("- name: Build Phase 2A preview runtime"),
    true,
    "Phase 2A preview must check known-good session mappings before build/deploy.",
  );
  assert.equal(
    ownerPreviewPhase2ABlock.indexOf("const sessionVerification = await verifyRoleSessions(stableUrl);") < ownerPreviewPhase2ABlock.indexOf("const apiMemberSubmission = await verifyApiMemberSubmission(stableUrl, sessionVerification);"),
    true,
    "Phase 2A verifier must validate role sessions before the auth matrix submission.",
  );
  assert.equal(ownerPreviewPhase2ABlock.includes("/api/events/suggestions"), true, "Phase 2A preview must verify public suggestions routes.");
  assert.equal(ownerPreviewPhase2ABlock.includes("reportCount"), true, "Phase 2A preview must check report-count privacy.");
  assert.equal(ownerPreviewPhase2ABlock.includes("phase2a-preview-private-draft-event"), true, "Phase 2A preview must check private draft privacy.");
  assert.equal(ownerPreviewPhase2ABlock.includes("phase2a-preview-public-draft-event"), true, "Phase 2A preview must seed a public draft fixture for public-list exclusion checks.");
  assert.equal(ownerPreviewPhase2ABlock.includes("phase2a-preview-unlisted-draft-event"), true, "Phase 2A preview must seed an unlisted draft fixture for public-list exclusion checks.");
  assert.equal(ownerPreviewPhase2ABlock.includes("phase2a-preview-public-live-event"), true, "Phase 2A preview must seed a public non-draft fixture for event cache checks.");
  assert.equal(ownerPreviewPhase2ABlock.includes("phase2a-preview-public-live-activity"), true, "Phase 2A preview must seed a public non-draft activity fixture for live-feed checks.");
  assert.equal(ownerPreviewPhase2ABlock.includes("verifyPublicEventProjectionPrivacy"), true, "Phase 2A verifier must check public event projection privacy after conversion.");
  assert.equal(ownerPreviewPhase2ABlock.includes("/api/events/live-feed?limit=50"), true, "Phase 2A verifier must probe the public live feed.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_PUBLIC_EVENT_PROJECTION_FAILED"), true, "Phase 2A verifier must classify public event projection failures.");
  assert.equal(ownerPreviewPhase2ABlock.includes("privateDraftConversionActivityExcludedFromPublicFeed"), true, "Phase 2A privacy artifact must record public live-feed private draft exclusion.");
  assert.equal(ownerPreviewPhase2ABlock.includes("verifyEventCacheIsolationAndDrafts"), true, "Phase 2A verifier must include event API cache isolation and draft-list checks.");
  assert.equal(ownerPreviewPhase2ABlock.includes('"/api/events?full=true&limit=20"'), true, "Phase 2A verifier must check anonymous full=true event lists are not public-cacheable.");
  assert.equal(ownerPreviewPhase2ABlock.includes('Cookie: creatorCookie'), true, "Phase 2A verifier must check authenticated event responses bypass shared cache.");
  assert.equal(ownerPreviewPhase2ABlock.includes("phase2a-invalid-session-token"), true, "Phase 2A verifier must check invalid session-cookie requests bypass shared cache.");
  assert.equal(ownerPreviewPhase2ABlock.includes("Anonymous public event list was not public-cacheable with Vary: Cookie."), true, "Phase 2A verifier must require Vary: Cookie on public event lists.");
  assert.equal(ownerPreviewPhase2ABlock.includes("Anonymous public event detail was not public-cacheable with Vary: Cookie."), true, "Phase 2A verifier must require Vary: Cookie on public event details.");
  assert.equal(ownerPreviewPhase2ABlock.includes("Anonymous full=true event list was not private/no-store BYPASS with Vary: Cookie."), true, "Phase 2A verifier must require anonymous full=true event lists to bypass shared cache.");
  assert.equal(ownerPreviewPhase2ABlock.includes("Invalid session-cookie event list received public cache headers."), true, "Phase 2A verifier must fail when invalid session-cookie event lists receive public cache headers.");
  assert.equal(ownerPreviewPhase2ABlock.includes("Invalid session-cookie event detail received public cache headers."), true, "Phase 2A verifier must fail when invalid session-cookie event details receive public cache headers.");
  assert.equal(ownerPreviewPhase2ABlock.includes('"/api/events?status=draft&limit=20"'), true, "Phase 2A verifier must check status=draft cannot return public/demo event rows.");
  assert.equal(ownerPreviewPhase2ABlock.includes("INVALID_PUBLIC_EVENT_STATUS"), true, "Phase 2A verifier must require the safe invalid public status error for draft filters.");
  assert.equal(ownerPreviewPhase2ABlock.includes("Public event status filters exposed draft."), true, "Phase 2A verifier must fail if public status filters advertise draft.");
  assert.equal(ownerPreviewPhase2ABlock.includes("/api/events/phase2a-preview-public-draft"), true, "Phase 2A verifier must prove public draft detail returns 404.");
  assert.equal(ownerPreviewPhase2ABlock.includes("/api/events/phase2a-preview-unlisted-draft"), true, "Phase 2A verifier must prove unlisted draft detail returns 404.");
  assert.equal(ownerPreviewPhase2ABlock.includes("/api/owner/events/phase2a-preview-private-draft"), true, "Phase 2A verifier must prove the creator owner API remains the private draft access path.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("Internal archive note for preview privacy check."), true, "Phase 2A verifier must exercise internal moderation reason privacy.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("Archive exposed an internal moderation reason as creatorResponse."), true, "Phase 2A verifier must fail if private actions expose creatorResponse.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("Approve after restore without a new public response exposed stale text."), true, "Phase 2A verifier must prove restored suggestions do not leak stale public responses.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("`/api/events/${encodeURIComponent(eventSlug)}`"), true, "Phase 2A verifier must prove public event detail excludes private converted drafts.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("phase2a-unknown-event-"), true, "Phase 2A verifier must prove unknown event slugs return 404 instead of demo fallback.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("knownPublicEventSlug"), true, "Phase 2A verifier must prove a known public event still returns 200.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("`/owner/events/review?slug=${encodeURIComponent(eventSlug)}`"), true, "Phase 2A verifier must check the fixed owner private draft review page.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("`/api/owner/events/${encodeURIComponent(eventSlug)}`"), true, "Phase 2A verifier must check the creator-only private draft detail API.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("Creator owner draft API did not return the canonical private draft."), true, "Phase 2A verifier must require canonical private draft details for the creator.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("Creator owner draft API was not private/no-store."), true, "Phase 2A verifier must require private no-store owner draft responses.");
  assert.equal(ownerPreviewPhase2ABlock.includes("privateDraftReviewCreatorOnly"), true, "Phase 2A privacy artifact must record creator-only draft review page checks.");
  assert.equal(ownerPreviewPhase2ABlock.includes("privateDraftApiCreatorOnly"), true, "Phase 2A privacy artifact must record creator-only draft API checks.");
  assert.equal(ownerPreviewPhase2ABlock.includes("eventListSessionCacheIsolated"), true, "Phase 2A privacy artifact must record event-list session cache isolation.");
  assert.equal(ownerPreviewPhase2ABlock.includes("eventDetailSessionCacheIsolated"), true, "Phase 2A privacy artifact must record event-detail session cache isolation.");
  assert.equal(ownerPreviewPhase2ABlock.includes("publicEventDraftsExcluded"), true, "Phase 2A privacy artifact must record public draft exclusion.");
  assert.equal(ownerPreviewPhase2ABlock.includes("publicStatusFiltersOmitDraft"), true, "Phase 2A privacy artifact must record public status filter draft exclusion.");
  assert.equal(ownerPreviewPhase2ABlock.includes("publicStatusDraftRejected"), true, "Phase 2A privacy artifact must record status=draft rejection.");
  assert.equal(ownerPreviewPhase2ABlock.includes("creatorDraftOwnerApiOnly"), true, "Phase 2A privacy artifact must record creator-only draft API access.");
  assert.equal(ownerPreviewPhase2ABlock.includes("unknownPublicEventDetailExcluded"), true, "Phase 2A privacy artifact must record unknown event slug 404 checks.");
  assert.equal(ownerPreviewPhase2ABlock.includes("knownPublicEventDetailAvailable"), true, "Phase 2A privacy artifact must record known public event availability checks.");
  assert.equal(ownerPreviewPhase2ABlock.includes("internalModerationReasonNotPublic"), true, "Phase 2A privacy artifact must record moderation reason privacy.");
  assert.equal(ownerPreviewPhase2ABlock.includes("protectedRowsPreserved"), true, "Phase 2A privacy artifact must record protected session/event row preservation.");
  assert.equal(ownerPreviewPhase2ABlock.includes("x-dzn-cache-meta"), true, "Phase 2A preview must verify internal cache metadata is not public.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_SUGGESTIONS_HEAD_HANDLER_MISSING"), true, "Phase 2A preview must classify missing suggestions HEAD handlers clearly.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_VERIFIER_PAYLOAD_INVALID_DESCRIPTION_LENGTH"), true, "Phase 2A verifier must validate its own suggestion payload length.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_MEMBER_SUBMISSION_RESPONSE_INVALID"), true, "Phase 2A verifier must fail clearly when member submission response is malformed.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_AUTH_MATRIX_FAILED"), true, "Phase 2A verifier must classify auth matrix failures.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_MODERATION_STATE_MACHINE_FAILED"), true, "Phase 2A verifier must classify moderation state-machine failures.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_VOTE_RATE_LIMIT_CHECK_FAILED"), true, "Phase 2A verifier must classify vote rate-limit failures.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_CONCURRENT_CONVERSION_FAILED"), true, "Phase 2A verifier must classify concurrent conversion failures.");
  assert.equal(ownerPreviewPhase2ABlock.includes("PHASE2A_D1_FINAL_VERIFICATION_FAILED"), true, "Phase 2A verifier must classify final D1 verification failures.");
  assert.equal(ownerPreviewPhase2ABlock.includes("failure-summary.json"), true, "Phase 2A preview verification failures must create a sanitized failure summary.");
  assert.equal(ownerPreviewPhase2ABlock.includes("verification-progress.json"), true, "Phase 2A preview must persist staged verification progress.");
  assert.equal(ownerPreviewPhase2ABlock.includes('fs.rmSync(`${artifacts}/failure-summary.json`, { force: true })'), true, "Successful Phase 2A verification must remove stale failure summaries before artifact upload.");
  assert.equal(ownerPreviewPhase2ABlock.includes('writeJsonArtifact("route-probes.json"'), true, "Phase 2A route probe report must be written immediately after route probes pass.");
  assert.equal(ownerPreviewPhase2ABlock.includes('writeJsonArtifact("performance-sampling.json"'), true, "Phase 2A performance report must be written immediately after sampling passes.");
  assert.equal(ownerPreviewPhase2ABlock.includes('writeJsonArtifact("cache-verification.json"'), true, "Phase 2A cache report must be written immediately after cache checks pass.");
  assert.equal(ownerPreviewPhase2ABlock.includes('writeJsonArtifact("auth-matrix.json"'), true, "Phase 2A auth report must be written immediately after auth checks pass.");
  assert.equal(ownerPreviewPhase2ABlock.includes("Cache API") || ownerPreviewPhase2ABlock.includes("cache"), true, "Phase 2A preview must include cache verification.");
  assert.equal(ownerPreviewPhase2ACacheBlock.includes("requireDuplicateBypass"), true, "Phase 2A verifier must include duplicate allowed-parameter cache bypass checks.");
  assert.equal(ownerPreviewPhase2ACacheBlock.includes("sort=trending&sort=newest"), true, "Phase 2A verifier must check trending/newest duplicate sort bypass.");
  assert.equal(ownerPreviewPhase2ACacheBlock.includes("sort=newest&sort=trending"), true, "Phase 2A verifier must check newest/trending duplicate sort bypass.");
  assert.equal(ownerPreviewPhase2ACacheBlock.includes("Duplicate sort trending/newest"), true, "Phase 2A verifier must label duplicate sort checks safely.");
  assert.equal(ownerPreviewPhase2ACacheBlock.includes("Duplicate sort newest/trending"), true, "Phase 2A verifier must check reversed duplicate sort first-value semantics.");
  assert.equal(ownerPreviewPhase2ACacheBlock.includes("Repeated duplicate sort request"), true, "Phase 2A verifier must prove duplicate requests never become HIT.");
  assert.equal(ownerPreviewPhase2ACacheBlock.includes('method: "HEAD"'), true, "Phase 2A verifier must check duplicate-parameter HEAD requests.");
  assert.equal(ownerPreviewPhase2ACacheBlock.includes("HEAD with duplicate allowed parameters did not bypass safely."), true, "Phase 2A verifier must fail if duplicate HEAD can poison GET cache.");
  assert.equal(ownerPreviewPhase2ACacheBlock.includes("normalSecondCache"), true, "Phase 2A verifier must prove normal single-sort HIT behaviour remains after duplicate bypasses.");
  assert.equal(ownerPreviewPhase2ABlock.includes("duplicateAllowedCacheParametersBypass"), true, "Phase 2A privacy artifact must record duplicate allowed-parameter cache isolation.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes('fetchJson(base, "/api/events/suggestions", 200'), true, "Successful Phase 2A member submission must expect the actual 200 API contract.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes('fetchJson(base, "/api/events/suggestions", 201'), false, "Phase 2A verifier must not expect 201 for suggestion creation.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes('|| "phase2a-preview-public-voting"'), false, "Phase 2A verifier must not fall back to a seeded suggestion ID.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("const createdId = typeof submitted?.id === \"string\""), true, "Phase 2A verifier must require the returned suggestion ID.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("verifyApiMemberSubmission(base, sessionSummary)"), true, "Phase 2A verifier must authenticate the reused member once and pass the returned suggestion into the matrix.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("anonMalformedSubmit"), true, "Phase 2A verifier must check anonymous malformed suggestion submissions return 401.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("anonOversizedSubmit"), true, "Phase 2A verifier must check anonymous oversized suggestion submissions return 401.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("invalidCookieMalformedSubmit"), true, "Phase 2A verifier must check invalid-cookie malformed suggestion submissions return 401.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("authenticatedMalformedSubmit"), true, "Phase 2A verifier must keep authenticated malformed suggestion submissions at 400.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("authenticatedOversizedSubmit"), true, "Phase 2A verifier must keep authenticated oversized suggestion submissions at 413.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("authPrecedenceRowsAfter !== apiVerifierRowsBeforePrecedence"), true, "Phase 2A verifier must prove auth-precedence submit probes create no rows.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("anonMalformedVote"), true, "Phase 2A verifier must check anonymous malformed votes return 401.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("anonOversizedVote"), true, "Phase 2A verifier must check anonymous oversized votes return 401.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("authenticatedMalformedVote"), true, "Phase 2A verifier must keep authenticated malformed votes at 400.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("authenticatedOversizedVote"), true, "Phase 2A verifier must keep authenticated oversized votes at 413.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("anonMalformedReport"), true, "Phase 2A verifier must check anonymous malformed reports return 401.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("anonOversizedReport"), true, "Phase 2A verifier must check anonymous oversized reports return 401.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("authenticatedMalformedReport"), true, "Phase 2A verifier must keep authenticated malformed reports at 400.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("authenticatedOversizedReport"), true, "Phase 2A verifier must keep authenticated oversized reports at 413.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("Authentication-precedence vote/report probes created mutation rows."), true, "Phase 2A verifier must prove auth-precedence vote/report probes create no rows.");
  assert.equal(ownerPreviewPhase2ABlock.includes("suggestionMutationAuthPrecedence"), true, "Phase 2A privacy artifact must record suggestion mutation auth precedence.");
  assert.equal(ownerPreviewPhase2ABlock.includes("const phase2aRunKey = String(process.env.PHASE2A_RUN_KEY"), true, "Phase 2A verifier must derive the run-scoped key in the verifier block.");
  assert.equal(ownerPreviewPhase2ABlock.includes("async function verifyHostAuthorization(base, runKey)"), true, "Phase 2A verifier must pass the run-scoped key explicitly into official event host authorization checks.");
  assert.equal(ownerPreviewPhase2ABlock.includes("const hostAuthorization = await verifyHostAuthorization(stableUrl, phase2aRunKey);"), true, "Phase 2A verifier must not rely on an undefined host runKey global.");
  assert.equal(ownerPreviewPhase2ABlock.includes("Phase 2A host authorization: runKey="), true, "Phase 2A host verifier must print safe run-key and completion diagnostics.");
  assert.equal(ownerPreviewPhase2ABlock.includes('writeJsonArtifact("host-authorization.json"'), true, "Phase 2A verifier must persist sanitized host authorization evidence.");
  assert.equal(ownerPreviewPhase2ABlock.includes("Cloudflare read failed before route probes"), false, "Cloudflare verifier failures must be stage-aware rather than route-probe specific.");
  for (const [needle, message] of [
    ["operationLabel", "Cloudflare/D1 verifier failures must carry a safe operation label."],
    ["cloudflareCode", "Cloudflare verifier failures must persist the sanitized numeric Cloudflare code."],
    ["cloudflareMessage", "Cloudflare verifier failures must persist a sanitized first Cloudflare error message."],
    ["hostLinkedServerSchemaBeforeOwnerGet", "Host verifier must inspect linked-server schema before Owner Event Control GET."],
    ["hostLinkedServerSchemaAfterOwnerGet", "Host verifier must inspect linked-server schema after Owner Event Control GET."],
    ["eventHostRequiredColumnsPresentBeforeOwnerGet", "Host artifact must record pre-Owner-GET event-host column readiness as a boolean."],
    ["eventHostRequiredColumnsPresentAfterOwnerGet", "Host artifact must record post-Owner-GET event-host column readiness as a boolean."],
    ["PHASE2A_EVENT_HOST_SCHEMA_NOT_READY", "Host verifier must classify event-host schema readiness failures distinctly."],
    ["hostCreatorFixtureRead", "Host verifier must use labelled simple D1 reads for the creator fixture."],
    ["hostForeignFixtureRead", "Host verifier must use labelled simple D1 reads for the foreign fixture."],
    ["hostCreatorSubscriptionRead", "Host verifier must use labelled simple D1 reads for creator fixture subscription state."],
    ["hostForeignSubscriptionRead", "Host verifier must use labelled simple D1 reads for foreign fixture subscription state."],
  ] as const) {
    assert.equal(ownerPreviewPhase2ABlock.includes(needle), true, message);
  }
  assert.equal(ownerPreviewPhase2ABlock.includes("hostFixtureRows"), false, "Host verifier must not use the old compound fixture query before writing diagnostics.");
  assert.equal(
    ownerPreviewPhase2ABlock.indexOf('writeJsonArtifact("host-authorization.json"') < ownerPreviewPhase2ABlock.indexOf("hostLinkedServerSchemaBeforeOwnerGet"),
    true,
    "Phase 2A host verifier must write an initial host artifact before remote schema reads.",
  );
  for (const [needle, message] of [
    ["previousFailureClassification", "Phase 2A host verifier must record a safe diagnosis for host-list mismatches."],
    ["PHASE2A_HOST_INVENTORY_UNAVAILABLE", "Phase 2A host verifier must distinguish host inventory query failures."],
    ["PHASE2A_CREATOR_HOST_NOT_LISTED", "Phase 2A host verifier must distinguish missing creator hosts."],
    ["PHASE2A_FOREIGN_HOST_LISTED", "Phase 2A host verifier must distinguish foreign hosts leaking into the owner list."],
    ["PHASE2A_HOST_FIXTURE_INELIGIBLE", "Phase 2A host verifier must distinguish fixture eligibility failures."],
    ["PHASE2A_FOREIGN_HOST_DENIAL_FAILED", "Phase 2A host verifier must distinguish failed foreign-host denial."],
    ["PHASE2A_OWNED_HOST_CREATE_FAILED", "Phase 2A host verifier must distinguish failed owned-host creation."],
  ] as const) {
    assert.equal(ownerPreviewPhase2ABlock.includes(needle), true, message);
  }
  assert.equal(ownerPreviewPhase2ABlock.indexOf("complete: false") < ownerPreviewPhase2ABlock.indexOf("PHASE2A_CREATOR_HOST_NOT_LISTED"), true, "Phase 2A host verifier must write a partial artifact before host-list assertions.");
  for (const [needle, message] of [
    ["Foreign-owned host attempt did not return the expected generic private/no-store denial.", "Phase 2A verifier must prove foreign host denial is generic and private."],
    ["foreignHostEventRowsCreated", "Phase 2A host artifact must record that foreign host attempts create no events."],
    ["foreignHostMetadataUnchanged", "Phase 2A host artifact must record that foreign host metadata is unchanged."],
    ["ownedHostRegistrationRowsCreated", "Phase 2A host artifact must record creator-owned host registration creation."],
    ["transactionTimeOwnershipTestPassedLocally", "Phase 2A host artifact must record the local transaction race test result."],
    ["creatorHostOwnershipEnforced", "Phase 2A privacy artifact must record creator host ownership enforcement."],
  ] as const) {
    assert.equal(ownerPreviewPhase2ABlock.includes(needle), true, message);
  }
  assert.equal(
    ownerPreviewPhase2AAuthMatrixBlock.indexOf("approve_public_voting") < ownerPreviewPhase2AAuthMatrixBlock.indexOf("`${suggestionPath}/vote`"),
    true,
    "Phase 2A verifier must approve a pending suggestion before voting.",
  );
  assert.equal(
    ownerPreviewPhase2AAuthMatrixBlock.indexOf("approve_public_voting") < ownerPreviewPhase2AAuthMatrixBlock.indexOf("`${suggestionPath}/report`"),
    true,
    "Phase 2A verifier must approve a pending suggestion before reporting.",
  );
  assert.equal(
    ownerPreviewPhase2AAuthMatrixBlock.indexOf("approve_public_voting") < ownerPreviewPhase2AAuthMatrixBlock.indexOf('action: "shortlist"'),
    true,
    "Phase 2A verifier must not shortlist directly from pending moderation.",
  );
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("SELF_VOTE_DENIED"), true, "Phase 2A verifier must test self-vote denial.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("SELF_REPORT_DENIED"), true, "Phase 2A verifier must test self-report denial.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("VOTE_RATE_LIMITED"), true, "Phase 2A verifier must test immediate vote-switch rate limiting.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("setTimeout(resolve, 1700)"), true, "Phase 2A verifier must delay before the successful vote removal check.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("approveActionCountAfterRepeat !== approveActionCount"), true, "Phase 2A verifier must assert repeat moderation does not add another audit row.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("API-submitted verifier suggestion was converted unexpectedly."), true, "Phase 2A verifier must ensure the API-created suggestion is not converted.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("Promise.all(["), true, "Phase 2A verifier must issue concurrent conversion requests.");
  assert.equal(ownerPreviewPhase2AAuthMatrixBlock.includes("one canonical event"), true, "Phase 2A verifier must require one canonical conversion event.");
  assert.equal(ownerPreviewPhase2ABlock.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED") && ownerPreviewPhase2ABlock.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED"), true, "Phase 2A preview must keep both Discord flags false.");
  assert.equal(ownerPreviewPhase2ABlock.includes("discord.com/api"), false, "Phase 2A preview mode must not call Discord.");
  assert.equal(ownerPreviewPhase2ABlock.includes("nitrado.net"), false, "Phase 2A preview mode must not call Nitrado.");
  assert.equal(ownerPreviewPhase2ABlock.includes("dzn-adm-sync-worker"), false, "Phase 2A preview mode must not trigger ADM sync.");
  assert.equal(ownerPreviewPhase2ABlock.includes("actions/upload-artifact@v7"), true, "Phase 2A preview must upload a sanitized artifact.");
  assert.equal(ownerPreviewPhase2ABlock.includes("always() && inputs.mode == 'event-platform-performance-preview'"), true, "Phase 2A artifact upload must run even after verifier failure.");
  assert.equal(ownerPreviewPhase2APreflightStart < ownerPreviewPhase2AMigrateStart, true, "Phase 2A preflight must happen before migration.");
  assert.equal(ownerPreviewPhase2AMigrateStart < ownerPreviewPhase2ASeedStart, true, "Phase 2A migration must happen before seed.");
  assert.equal(ownerPreviewPhase2ASeedStart < ownerPreviewPhase2ABuildStart, true, "Phase 2A seed must happen before build/deploy.");
  assert.equal(ownerPreviewPhase2ABuildStart < ownerPreviewPhase2ADeployStart, true, "Phase 2A build must happen before deploy.");
  assert.equal(ownerPreviewPhase2ADeployStart < ownerPreviewPhase2AVerifyStart, true, "Phase 2A deploy must happen before verification.");
  assert.equal(ownerPreviewPhase2AVerifyStart < ownerPreviewPhase2AArtifactStart, true, "Phase 2A verification must happen before artifact upload.");
  assert.equal(ownerPreviewPhase2AArtifactStart < ownerPreviewValidateBranchStart, true, "Phase 2A preview path must stay separate from full-preview D1 creation.");
  const ownerPreviewCleanupBlock = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewCleanupStart, ownerPreviewRebindStart);
  assert.equal(ownerPreviewCleanupBlock.includes("cleanup-preview-d1"), true, "Cleanup step must be explicitly cleanup-mode gated.");
  assert.equal(ownerPreviewCleanupBlock.includes("npx wrangler d1 migrations apply"), false, "Cleanup mode must not run migrations.");
  assert.equal(ownerPreviewCleanupBlock.includes("wrangler pages deploy"), false, "Cleanup mode must not deploy Pages.");
  assert.equal(ownerPreviewCleanupBlock.includes("wrangler pages secret put"), false, "Cleanup mode must not update Pages secrets.");
  assert.equal(ownerPreviewCleanupBlock.includes("npx wrangler d1 create"), false, "Cleanup mode must not create D1 databases.");
  assert.equal(ownerPreviewCleanupBlock.includes("/pages/projects\", {"), false, "Cleanup mode must not create Pages projects.");
  assert.equal(ownerPreviewCleanupBlock.includes("deployment_configs: {"), false, "Cleanup mode must not patch Pages bindings.");
  assert.equal(ownerPreviewCleanupBlock.includes("owner-console-preview-seed.sql"), false, "Cleanup mode must not seed data.");
  assert.equal(ownerPreviewCleanupBlock.includes("/api/owner/events"), false, "Cleanup mode must not call the deployed application.");
  assert.equal(ownerPreviewCleanupBlock.includes("discord.com/api"), false, "Cleanup mode must not call Discord.");
  assert.equal(ownerPreviewCleanupBlock.includes("method: \"DELETE\""), true, "Cleanup delete must be isolated to the cleanup step.");
  assert.equal(ownerPreviewCleanupBlock.includes("cleanupAction === \"dry-run\""), true, "Dry-run must take a non-destructive return path.");
  assert.equal(ownerPreviewCleanupBlock.includes("Preview D1 cleanup dry-run completed. No database was deleted."), true, "Dry-run must report no deletion.");
  assert.equal(ownerPreviewCleanupBlock.includes("selectedSource.name"), true, "Cleanup must report the selected token source by name.");
  assert.equal(ownerPreviewCleanupBlock.includes("CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN"), true, "Cleanup must consider the dedicated cleanup token.");
  assert.equal(ownerPreviewCleanupBlock.includes("CLOUDFLARE_PULSE_PREVIEW_TOKEN"), true, "Cleanup must consider the existing preview token.");
  assert.equal(ownerPreviewCleanupBlock.includes("CLOUDFLARE_API_TOKEN"), true, "Cleanup must consider the general Cloudflare token.");
  assert.equal(ownerPreviewCleanupBlock.includes("PREVIEW_D1_PAGES_INVENTORY_UNAVAILABLE"), true, "Pages read failures must be categorized.");
  assert.equal(ownerPreviewCleanupBlock.includes("PREVIEW_D1_API_REQUEST_INVALID"), true, "Invalid Cloudflare list options must be categorized separately from permission failures.");
  assert.equal(ownerPreviewCleanupBlock.includes("PREVIEW_D1_PAGES_PERMISSION_MISSING"), true, "401/403 Pages failures must be categorized as permission failures.");
  assert.equal(ownerPreviewCleanupBlock.includes("PREVIEW_D1_WORKER_BINDING_AUDIT_UNAVAILABLE"), true, "Worker read failures must be categorized.");
  assert.equal(ownerPreviewCleanupBlock.includes("PREVIEW_D1_BINDING_AUDIT_INCOMPLETE"), true, "Incomplete binding audit must fail closed for delete mode.");
  assert.equal(ownerPreviewCleanupBlock.includes("BLOCKED FOR DELETION:"), true, "Bound targets must finish dry-run as blocked.");
  assert.equal(ownerPreviewCleanupBlock.includes("ELIGIBLE FOR EXPLICIT DELETION APPROVAL"), true, "Unbound targets must still require explicit deletion approval.");
  assert.equal(ownerPreviewCleanupBlock.includes("targetPagesBindings.length > 0"), true, "Pages-bound targets must block deletion.");
  assert.equal(ownerPreviewCleanupBlock.includes("targetWorkerBindings.length > 0"), true, "Worker-bound targets must block deletion.");
  assert.equal(ownerPreviewCleanupBlock.includes("targetRepositoryBindings.length > 0"), true, "Repository-config-bound targets must block deletion.");
  assert.equal(ownerPreviewCleanupBlock.includes("uncertainActivePreviewRuns.length > 0"), true, "Uncertain active preview runs must block deletion.");
  assert.equal(ownerPreviewCleanupBlock.includes("targetId === productionId"), true, "Production D1 ID must be protected.");
  assert.equal(ownerPreviewCleanupBlock.includes("targetName === productionName"), true, "Production D1 name must be protected.");
  assert.equal(ownerPreviewCleanupBlock.includes("reviewedMask !== targetMask"), true, "Delete mode must require the reviewed masked ID.");
  assert.equal(ownerPreviewCleanupBlock.includes("source.name === \"CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN\""), true, "Delete-capable source must be explicit.");
  assert.equal(ownerPreviewCleanupBlock.includes("selected.d1DeleteEligible"), true, "Delete mode must reject tokens without explicit delete eligibility.");
  assert.equal(ownerPreviewCleanupBlock.includes("cleanupAction === \"delete\" && !selected.d1DeleteEligible"), true, "Dry-run must not require delete capability.");
  assert.equal(ownerPreviewCleanupBlock.includes('cloudflare(source, "pages-project-list", "/pages/projects")'), true, "Pages capability probe must use bare /pages/projects first.");
  assert.equal(ownerPreviewCleanupBlock.includes("/pages/projects?per_page=50"), false, "Pages cleanup audit must not hard-code per_page=50.");
  assert.equal(ownerPreviewCleanupBlock.includes("listPagesProjects(source)"), true, "Pages must use an endpoint-specific inventory helper.");
  assert.equal(ownerPreviewCleanupBlock.includes("listPaginated(selectedSource, \"d1-database-list\", \"/d1/database\""), true, "D1 must keep its own pagination path.");
  assert.equal(ownerPreviewCleanupBlock.includes("diagnosticCodes.has(\"PREVIEW_D1_API_REQUEST_INVALID\")"), true, "Invalid API requests must be surfaced before token recommendations.");
  assert.equal(ownerPreviewCleanupBlock.includes("diagnosticCodes.has(\"PREVIEW_D1_PAGES_PERMISSION_MISSING\")"), true, "Pages permission failures must be distinct from invalid requests.");
  const ownerPreviewRebindBlock = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewRebindStart, ownerPreviewActivationStart);
  assert.equal(ownerPreviewRebindBlock.includes("rebind-preview-d1"), true, "Rebind step must be explicitly rebind-mode gated.");
  assert.equal(ownerPreviewRebindBlock.includes("dzn-network-discord-announcements-preview"), true, "Rebind project must be fixed to the Discord announcements preview project.");
  assert.equal(ownerPreviewRebindBlock.includes("dzn_network_db_discord_announcements_preview_alignment_ee8c812"), true, "Old rebind database must be fixed.");
  assert.equal(ownerPreviewRebindBlock.includes("dzn_network_db_discord_announcements_preview"), true, "Replacement rebind database must be fixed.");
  assert.equal(ownerPreviewRebindBlock.includes("Refusing to rebind production Pages project."), true, "Rebind runtime must reject real production Pages project.");
  assert.equal(ownerPreviewRebindBlock.includes("Refusing to rebind a production D1 database name."), true, "Rebind runtime must reject production D1 names.");
  assert.equal(ownerPreviewRebindBlock.includes("BLOCKED FOR PREVIEW D1 REBIND: production D1 ID detected."), true, "Rebind runtime must reject production D1 IDs.");
  assert.equal(ownerPreviewRebindBlock.includes("old database masked ID changed"), true, "Old masked ID mismatch must block rebind.");
  assert.equal(ownerPreviewRebindBlock.includes("old database is bound to real production Pages project"), true, "Real production Pages bindings must block rebind.");
  assert.equal(ownerPreviewRebindBlock.includes("replacement database is bound to real production Pages project"), true, "Replacement production Pages bindings must block rebind.");
  assert.equal(ownerPreviewRebindBlock.includes("old database has deployed Worker bindings"), true, "Old Worker bindings must block rebind.");
  assert.equal(ownerPreviewRebindBlock.includes("replacement database has deployed Worker bindings"), true, "Replacement Worker bindings must block rebind.");
  assert.equal(ownerPreviewRebindBlock.includes("active workflow uses old database"), true, "Active old-database workflows must block rebind.");
  assert.equal(ownerPreviewRebindBlock.includes("active workflow uses replacement database"), true, "Active replacement-database workflows must block rebind.");
  assert.equal(ownerPreviewRebindBlock.includes("active preview workflow database use is uncertain"), true, "Uncertain active preview runs must block rebind.");
  assert.equal(ownerPreviewRebindBlock.includes("migration 0056 is not applied"), true, "Replacement schema audit must require migration 0056.");
  assert.equal(ownerPreviewRebindBlock.includes("discord_announcement_posts missing columns"), true, "Replacement schema audit must block missing columns.");
  assert.equal(ownerPreviewRebindBlock.includes("discord_announcement_posts missing indexes"), true, "Replacement schema audit must block missing indexes.");
  assert.equal(ownerPreviewRebindBlock.includes("discord_announcement_posts row count is"), true, "Replacement schema audit must block unsafe announcement rows.");
  assert.equal(ownerPreviewRebindBlock.includes("foreign_key_check returned"), true, "Replacement schema audit must block foreign key issues.");
  assert.equal(ownerPreviewRebindBlock.includes("idx_discord_announcement_posts_server_event_created"), true, "Rebind must check the current migration 0056 index names.");
  assert.equal(ownerPreviewRebindBlock.includes("idx_discord_announcement_posts_event_status_created"), true, "Rebind must check the current migration 0056 index names.");
  assert.equal(ownerPreviewRebindBlock.includes("idx_discord_announcement_posts_status_updated"), true, "Rebind must check the current migration 0056 index names.");
  assert.equal(ownerPreviewRebindBlock.includes("rebindAction === \"dry-run\""), true, "Rebind dry-run must return before patching.");
  assert.equal(ownerPreviewRebindBlock.includes("Preview D1 rebind dry-run completed. No Pages binding changed."), true, "Rebind dry-run must report no binding change.");
  assert.equal(ownerPreviewRebindBlock.includes("method: \"PATCH\""), true, "Rebind apply must patch Pages through the API.");
  assert.equal(ownerPreviewRebindBlock.includes("if (blockedReasons.length > 0) fail"), true, "Rebind apply must rerun and enforce every safety check before patching.");
  assert.equal(ownerPreviewRebindBlock.includes("deployment_configs: {"), true, "Rebind apply must patch deployment configs.");
  assert.equal(ownerPreviewRebindBlock.includes("production: patchedProductionConfig"), true, "Rebind apply must patch the production config of the preview project.");
  assert.equal(ownerPreviewRebindBlock.includes("preview: patchedPreviewConfig"), true, "Rebind apply must patch the preview config of the preview project.");
  assert.equal(ownerPreviewRebindBlock.includes("function mergeD1BindingOnly"), true, "Rebind apply must use a config-preserving merge helper.");
  assert.equal(ownerPreviewRebindBlock.includes("...config"), true, "Rebind apply must preserve unrelated project configuration.");
  assert.equal(ownerPreviewRebindBlock.includes("...currentD1"), true, "Rebind apply must preserve unrelated D1 bindings.");
  assert.equal(ownerPreviewRebindBlock.includes("assertDiscordFlagsFalse"), true, "Rebind must verify Discord flags remain false before apply.");
  assert.equal(ownerPreviewRebindBlock.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED"), true, "Rebind must preserve server announcement flag false.");
  assert.equal(ownerPreviewRebindBlock.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED"), true, "Rebind must preserve general Discord flag false.");
  assert.equal(ownerPreviewRebindBlock.includes("Discord messages sent: false"), true, "Rebind summary must state no Discord send.");
  assert.equal(ownerPreviewRebindBlock.includes("discord.com/api"), false, "Rebind mode must not call Discord.");
  assert.equal(ownerPreviewRebindBlock.includes("wrangler pages deploy"), false, "Rebind mode must not deploy Pages.");
  assert.equal(ownerPreviewRebindBlock.includes("npx wrangler d1 migrations apply"), false, "Rebind mode must not run migrations.");
  assert.equal(ownerPreviewRebindBlock.includes("method: \"DELETE\""), false, "Rebind mode must not delete D1 databases.");
  assert.equal(ownerPreviewRebindBlock.includes("/api/owner/events"), false, "Rebind mode must not call the deployed application.");
  assert.equal(ownerPreviewRebindBlock.includes("Pages deployment required after config patch: yes"), true, "Rebind dry-run must report that Pages redeployment is required for active runtime binding changes.");
  const ownerPreviewActivationBlock = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewActivationStart, ownerPreviewRepairStart);
  assert.equal(ownerPreviewActivationBlock.includes("activate-rebound-discord-preview"), true, "Activation steps must be explicitly activation-mode gated.");
  assert.equal(ownerPreviewActivationBlock.includes("git fetch --no-tags --prune origin \"+refs/heads/main:refs/remotes/origin/main\" --depth=1"), true, "Activation must refresh origin/main before using the pinned runtime.");
  assert.equal(ownerPreviewActivationBlock.includes('if [ "${CURRENT_MAIN_SHA}" != "${APPROVED_MAIN_RUNTIME_SHA}" ]; then'), true, "Activation must block if origin/main moved.");
  assert.equal(ownerPreviewActivationBlock.includes("git worktree add --detach runtime-main \"${APPROVED_MAIN_RUNTIME_SHA}\""), true, "Activation must build from a separate pinned main runtime worktree.");
  assert.equal(ownerPreviewActivationBlock.includes("Pinned runtime checkout does not match approved main SHA."), true, "Activation must verify the runtime checkout SHA.");
  assert.equal(ownerPreviewActivationBlock.includes("process.env.ACTIVATE_PREVIEW_PROJECT_NAME"), true, "Activation must use the fixed preview project env constant.");
  assert.equal(ownerPreviewActivationBlock.includes("process.env.ACTIVATE_OLD_PREVIEW_DB_NAME"), true, "Activation must use the fixed former database env constant.");
  assert.equal(ownerPreviewActivationBlock.includes("process.env.ACTIVATE_REPLACEMENT_PREVIEW_DB_NAME"), true, "Activation must use the fixed replacement database env constant.");
  assert.equal(ownerPreviewActivationBlock.includes("Refusing activation against production Pages project."), true, "Activation preflight must reject the real production Pages project.");
  assert.equal(ownerPreviewActivationBlock.includes("Refusing activation against production D1 name."), true, "Activation preflight must reject production D1 names.");
  assert.equal(ownerPreviewActivationBlock.includes("Production D1 ID detected in activation path."), true, "Activation preflight must reject production D1 IDs.");
  assert.equal(ownerPreviewActivationBlock.includes("DB binding does not point to replacement preview D1."), true, "Activation must require both project configurations to point to the replacement D1.");
  assert.equal(ownerPreviewActivationBlock.includes("Old preview D1 still has"), true, "Activation must block if the old D1 remains project-config bound.");
  assert.equal(ownerPreviewActivationBlock.includes("Old preview D1 has deployed Worker bindings before activation."), true, "Activation must block old deployed Worker bindings.");
  assert.equal(ownerPreviewActivationBlock.includes("Replacement preview D1 has deployed Worker bindings."), true, "Activation must block replacement Worker bindings.");
  assert.equal(ownerPreviewActivationBlock.includes("Active preview workflow is using the old stale preview D1."), true, "Activation must block active old-database preview workflows.");
  assert.equal(ownerPreviewActivationBlock.includes("Active preview workflow database use is uncertain."), true, "Activation must block uncertain active preview runs.");
  assert.equal(ownerPreviewActivationBlock.includes("required migrations pending"), true, "Activation must compare replacement D1 migrations with pinned-main migrations.");
  assert.equal(ownerPreviewActivationBlock.includes("migration 0056 is not applied"), true, "Activation must require migration 0056.");
  assert.equal(ownerPreviewActivationBlock.includes("missing required tables"), true, "Activation must require current-runtime tables.");
  assert.equal(ownerPreviewActivationBlock.includes("sessions"), true, "Activation must require the sessions table.");
  assert.equal(ownerPreviewActivationBlock.includes("users"), true, "Activation must require the users table.");
  assert.equal(ownerPreviewActivationBlock.includes("linked_servers"), true, "Activation must require the linked_servers table.");
  assert.equal(ownerPreviewActivationBlock.includes("discord_guilds"), true, "Activation must require the discord_guilds table.");
  assert.equal(ownerPreviewActivationBlock.includes("server_subscriptions"), true, "Activation must require the server_subscriptions table.");
  assert.equal(ownerPreviewActivationBlock.includes("competitive_events"), true, "Activation must require the competitive_events table.");
  assert.equal(ownerPreviewActivationBlock.includes("discord_announcement_posts"), true, "Activation must require the discord_announcement_posts table.");
  assert.equal(ownerPreviewActivationBlock.includes("PRAGMA table_info(discord_announcement_posts);"), true, "Activation must inspect announcement columns read-only.");
  assert.equal(ownerPreviewActivationBlock.includes("idx_discord_announcement_posts_server_event_created"), true, "Activation must check the current migration 0056 index names.");
  assert.equal(ownerPreviewActivationBlock.includes("idx_discord_announcement_posts_event_status_created"), true, "Activation must check the current migration 0056 index names.");
  assert.equal(ownerPreviewActivationBlock.includes("idx_discord_announcement_posts_status_updated"), true, "Activation must check the current migration 0056 index names.");
  assert.equal(ownerPreviewActivationBlock.includes("SELECT COUNT(*) AS row_count FROM discord_announcement_posts;"), true, "Activation must verify announcement row count remains zero.");
  assert.equal(ownerPreviewActivationBlock.includes("PRAGMA foreign_key_check;"), true, "Activation must run a read-only foreign key check.");
  assert.equal(ownerPreviewActivationBlock.includes("npm run test:github-workflows"), true, "Activation pinned runtime build must run workflow tests.");
  assert.equal(ownerPreviewActivationBlock.includes("npm run test:discord-server-announcements"), true, "Activation pinned runtime build must run Discord announcement tests.");
  assert.equal(ownerPreviewActivationBlock.includes("npm run test:owner-console"), true, "Activation pinned runtime build must run owner console tests.");
  assert.equal(ownerPreviewActivationBlock.includes("npm run test"), true, "Activation pinned runtime build must run the full test suite.");
  assert.equal(ownerPreviewActivationBlock.includes("npm run lint"), true, "Activation pinned runtime build must run lint.");
  assert.equal(ownerPreviewActivationBlock.includes("npm run build"), true, "Activation pinned runtime build must build.");
  assert.equal(ownerPreviewActivationBlock.includes("git diff --check"), true, "Activation pinned runtime build must run whitespace checks.");
  assert.equal(ownerPreviewActivationBlock.includes("out/_routes.json"), true, "Activation must verify Cloudflare route output.");
  assert.equal(ownerPreviewActivationBlock.includes('"/api/*", "/owner", "/owner/*"'), true, "Activation must require owner/API route includes.");
  assert.equal(ownerPreviewActivationBlock.includes("include route overlap"), true, "Activation must reject Cloudflare route overlaps.");
  assert.equal(ownerPreviewActivationBlock.includes("--project-name \"${ACTIVATE_PREVIEW_PROJECT_NAME}\""), true, "Activation deploy must target only the fixed preview project.");
  assert.equal(ownerPreviewActivationBlock.includes("Refusing to deploy production Pages project from activation mode."), true, "Activation deploy must reject production Pages project.");
  assert.equal(ownerPreviewActivationBlock.includes("--commit-hash \"${APPROVED_MAIN_RUNTIME_SHA}\""), true, "Activation deploy metadata must use the pinned main commit.");
  assert.equal(ownerPreviewActivationBlock.includes("Wrangler did not report a distinct immutable preview URL"), true, "Activation deploy must require an immutable preview URL.");
  assert.equal(/working-directory: runtime-main\r?\n\s+env:/.test(ownerPreviewActivationBlock), true, "Activation build may use runtime-main.");
  assert.equal(/- name: Deploy rebound Discord preview runtime\r?\n\s+if: \$\{\{ inputs\.mode == 'activate-rebound-discord-preview' \}\}\r?\n\s+working-directory: runtime-main/.test(ownerPreviewActivationBlock), false, "Activation deploy must not run from runtime-main.");
  assert.equal(ownerPreviewActivationBlock.includes('DEPLOY_ROOT="${RUNNER_TEMP}/dzn-discord-preview-deploy"'), true, "Activation deploy must use a clean RUNNER_TEMP directory.");
  assert.equal(ownerPreviewActivationBlock.includes('"${GITHUB_WORKSPACE}/runtime-main/node_modules/.bin/wrangler" pages deploy out'), true, "Activation deploy must run Wrangler from the pinned runtime binary while in the clean deploy directory.");
  assert.equal(ownerPreviewActivationBlock.includes("Production or local Wrangler configuration is deploy-visible."), true, "Activation deploy must reject deploy-visible Wrangler configuration.");
  assert.equal(ownerPreviewActivationBlock.includes("Deployment-visible output contains production project or D1 configuration markers."), true, "Activation deploy must reject production config leaks.");
  assert.equal(ownerPreviewActivationBlock.includes("await verifyBase(immutableUrl);"), true, "Activation verification must check the immutable preview URL.");
  assert.equal(ownerPreviewActivationBlock.includes("await verifyBase(stableUrl);"), true, "Activation verification must check the stable preview URL.");
  assert.equal(ownerPreviewActivationBlock.includes("/api/owner/discord/overview"), true, "Activation verification must check the Discord overview API is protected.");
  assert.equal(ownerPreviewActivationBlock.includes("discordNotificationsEnabled === false"), true, "Activation verification must require disabled public Discord notifications.");
  assert.equal(ownerPreviewActivationBlock.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED"), true, "Activation must keep server announcement flag false.");
  assert.equal(ownerPreviewActivationBlock.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED"), true, "Activation must keep general Discord notifications false.");
  assert.equal(ownerPreviewActivationBlock.includes("Discord messages sent: false"), true, "Activation summary must state no Discord send.");
  assert.equal(ownerPreviewActivationBlock.includes("npx wrangler d1 migrations apply"), false, "Activation mode must not run migrations.");
  assert.equal(ownerPreviewActivationBlock.includes("owner-console-preview-seed.sql"), false, "Activation mode must not seed data.");
  assert.equal(ownerPreviewActivationBlock.includes("npx wrangler d1 create"), false, "Activation mode must not create D1 databases.");
  assert.equal(ownerPreviewActivationBlock.includes("method: \"DELETE\""), false, "Activation mode must not delete D1 databases.");
  assert.equal(ownerPreviewActivationBlock.includes("method: \"PATCH\""), false, "Activation mode must not patch Pages bindings.");
  assert.equal(ownerPreviewActivationBlock.includes("wrangler pages secret put"), false, "Activation mode must not update Pages secrets.");
  assert.equal(ownerPreviewActivationBlock.includes("/api/owner/events"), false, "Activation mode must not call application event mutation APIs.");
  assert.equal(ownerPreviewActivationBlock.includes("discord.com/api"), false, "Activation mode must not call Discord.");
  assert.equal(ownerPreviewActivationStart < ownerPreviewActivationPreflightStart, true, "Activation runtime checkout must happen before activation preflight.");
  assert.equal(ownerPreviewActivationPreflightStart < ownerPreviewActivationBuildStart, true, "Activation preflight must happen before build.");
  assert.equal(ownerPreviewActivationBuildStart < ownerPreviewActivationDeployStart, true, "Activation build must happen before preview deploy.");
  assert.equal(ownerPreviewActivationDeployStart < ownerPreviewActivationVerifyStart, true, "Activation deploy must happen before post-deploy verification.");
  assert.equal(ownerPreviewActivationVerifyStart < ownerPreviewRepairStart, true, "Activation flow must finish before repair mode begins.");
  const ownerPreviewRepairBlock = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewRepairStart, ownerPreviewResolveD1Start);
  assert.equal(ownerPreviewRepairBlock.includes("repair-rebound-discord-preview"), true, "Repair steps must be explicitly repair-mode gated.");
  assert.equal(ownerPreviewRepairBlock.includes("repairAction === \"dry-run\""), true, "Repair dry-run must return before patch/build/deploy.");
  assert.equal(ownerPreviewRepairBlock.includes("Rebound Discord preview repair dry-run completed. No Pages binding changed and no route probes were made."), true, "Repair dry-run must report no mutation or route probes.");
  assert.equal(ownerPreviewRepairBlock.includes("config DB binding classification"), true, "Repair dry-run must classify environment DB bindings.");
  assert.equal(ownerPreviewRepairBlock.includes("real production D1"), true, "Repair audit must explicitly classify production-D1 bindings.");
  assert.equal(ownerPreviewRepairBlock.includes("Preview project quarantined"), true, "Repair audit must report quarantine status.");
  assert.equal(ownerPreviewRepairBlock.includes("Route probes allowed before repair: no"), true, "Repair audit must not probe quarantined preview routes.");
  assert.equal(ownerPreviewRepairBlock.includes("Latest deployment ID:"), true, "Repair audit must report a masked latest deployment ID.");
  assert.equal(ownerPreviewRepairBlock.includes("Applying preview-only repair config patch"), true, "Repair apply must patch preview configuration before deploy.");
  assert.equal(ownerPreviewRepairBlock.includes("verifyProjectSafe(afterProject, replacementId);"), true, "Repair apply must verify both environments before deploy.");
  assert.equal(ownerPreviewRepairBlock.includes("Refusing to repair real production Pages project."), true, "Repair must reject real production Pages project.");
  assert.equal(ownerPreviewRepairBlock.includes("Refusing to repair using production D1 name."), true, "Repair must reject production D1 names.");
  assert.equal(ownerPreviewRepairBlock.includes("Production D1 ID detected in repair path."), true, "Repair must reject production D1 IDs.");
  assert.equal(ownerPreviewRepairBlock.includes("Prepare pinned main runtime for rebound Discord preview repair"), true, "Repair apply must prepare the pinned main runtime.");
  assert.equal(ownerPreviewRepairBlock.includes("git worktree add --detach runtime-main \"${APPROVED_MAIN_RUNTIME_SHA}\""), true, "Repair apply must use the pinned main runtime checkout.");
  assert.equal(ownerPreviewRepairBlock.includes("npm run test:github-workflows"), true, "Repair pinned runtime build must run workflow tests.");
  assert.equal(ownerPreviewRepairBlock.includes("npm run test:discord-server-announcements"), true, "Repair pinned runtime build must run Discord announcement tests.");
  assert.equal(ownerPreviewRepairBlock.includes("npm run test:owner-console"), true, "Repair pinned runtime build must run owner console tests.");
  assert.equal(ownerPreviewRepairBlock.includes("npm run test"), true, "Repair pinned runtime build must run the full test suite.");
  assert.equal(ownerPreviewRepairBlock.includes("npm run lint"), true, "Repair pinned runtime build must run lint.");
  assert.equal(ownerPreviewRepairBlock.includes("npm run build"), true, "Repair pinned runtime build must build.");
  assert.equal(ownerPreviewRepairBlock.includes("./node_modules/.bin/wrangler pages functions build functions"), true, "Repair build must compile Pages Functions after Next build.");
  assert.equal(
    ownerPreviewRepairBlock.indexOf("npm run build") < ownerPreviewRepairBlock.indexOf("./node_modules/.bin/wrangler pages functions build functions"),
    true,
    "Repair Functions build must happen after npm run build.",
  );
  assert.equal(
    ownerPreviewRepairBlock.indexOf("./node_modules/.bin/wrangler pages functions build functions") < ownerPreviewRepairBlock.indexOf("node scripts/patch-pages-routes.mjs"),
    true,
    "Repair route patch must run after the Functions build regenerates routes.",
  );
  assert.equal(ownerPreviewRepairBlock.includes("--outdir .pages-functions"), true, "Repair Functions build must emit .pages-functions.");
  assert.equal(ownerPreviewRepairBlock.includes("--build-output-directory out"), true, "Repair Functions build must use the Next output directory.");
  assert.equal(ownerPreviewRepairBlock.includes("--output-routes-path out/_routes.json"), true, "Repair Functions build must write Pages routes.");
  assert.equal(ownerPreviewRepairBlock.includes("test -s .pages-functions/index.js"), true, "Repair build must require the compiled Functions worker.");
  assert.equal(ownerPreviewRepairBlock.includes("cp .pages-functions/index.js out/_worker.js"), true, "Repair build must copy the Functions worker into Pages output.");
  assert.equal(ownerPreviewRepairBlock.includes("test -s out/_worker.js"), true, "Repair build must require out/_worker.js.");
  assert.equal(ownerPreviewRepairBlock.includes("cmp -s .pages-functions/index.js out/_worker.js"), true, "Repair build must byte-compare copied worker.");
  assert.equal(ownerPreviewRepairBlock.includes("workerByteSize"), true, "Repair build must print safe worker byte size.");
  assert.equal(ownerPreviewRepairBlock.includes("workerShaPrefix"), true, "Repair build must print a safe worker hash prefix.");
  assert.equal(ownerPreviewRepairBlock.includes("hasApiWildcard"), true, "Repair package summary must include required route booleans.");
  assert.equal(ownerPreviewRepairBlock.includes("normalizeRoutes([...(routes.include ?? []), ...requiredIncludes])"), true, "Repair build must normalize required routes after patching.");
  assert.equal(ownerPreviewRepairBlock.includes("fs.writeFileSync(routesPath"), true, "Repair build must write the final normalized _routes.json.");
  assert.equal(ownerPreviewRepairBlock.includes("removedOverlappedIncludeRoutes"), true, "Repair package summary must report removed overlapping include routes.");
  assert.equal(ownerPreviewRepairBlock.includes("removedOverlappedExcludeRoutes"), true, "Repair package summary must report removed overlapping exclude routes.");
  assert.equal(ownerPreviewRepairBlock.includes("git diff --check"), true, "Repair pinned runtime build must run whitespace checks.");
  assert.equal(ownerPreviewRepairBlock.includes('DEPLOY_ROOT="${RUNNER_TEMP}/dzn-discord-preview-deploy"'), true, "Repair deploy must use a clean RUNNER_TEMP directory.");
  assert.equal(ownerPreviewRepairBlock.includes("cp -R runtime-main/out \"${DEPLOY_ROOT}/out\""), true, "Repair deploy must copy only built output into the deployment directory.");
  assert.equal(ownerPreviewRepairBlock.includes("test -s \"${DEPLOY_ROOT}/out/_worker.js\""), true, "Repair deploy output must contain _worker.js.");
  assert.equal(ownerPreviewRepairBlock.includes("test -s \"${DEPLOY_ROOT}/out/_routes.json\""), true, "Repair deploy output must contain _routes.json.");
  assert.equal(ownerPreviewRepairBlock.includes("RUNTIME_WORKER_SHA=\"$(sha256sum runtime-main/out/_worker.js"), true, "Repair deploy must hash the runtime worker.");
  assert.equal(ownerPreviewRepairBlock.includes("DEPLOY_WORKER_SHA=\"$(sha256sum \"${DEPLOY_ROOT}/out/_worker.js\""), true, "Repair deploy must hash the isolated deploy worker.");
  assert.equal(ownerPreviewRepairBlock.includes("Isolated deploy worker does not match runtime-main/out/_worker.js."), true, "Repair deploy must reject worker hash mismatch.");
  assert.equal(ownerPreviewRepairBlock.includes("Unapproved Wrangler or env configuration is deploy-visible."), true, "Repair deploy must reject deploy-visible Wrangler or env files.");
  assert.equal(ownerPreviewRepairBlock.includes("Deployment-visible output contains the production D1 ID."), true, "Repair deploy must block the exact production D1 ID anywhere in deployed output.");
  assert.equal(ownerPreviewRepairBlock.includes("Deployment-visible configuration contains production project or D1 assignment syntax."), true, "Repair deploy must scan configuration-like files for production assignments.");
  assert.equal(ownerPreviewRepairBlock.includes("Repair deploy target is not the fixed preview Pages project."), true, "Repair deploy must verify the fixed preview project target.");
  assert.equal(ownerPreviewRepairBlock.includes("CONFIG_CANDIDATES="), true, "Repair deploy must limit assignment-syntax scans to configuration-like candidates.");
  assert.equal(ownerPreviewRepairBlock.includes("xargs grep -E 'name[[:space:]]*=[[:space:]]*\"dzn-network\"|database_name[[:space:]]*=[[:space:]]*\"dzn_network_db\"'"), true, "Repair deploy must restrict generic production-name scans to assignment syntax.");
  assert.equal(ownerPreviewRepairBlock.includes("grep -R -E 'name[[:space:]]*=[[:space:]]*\"dzn-network\"|database_name[[:space:]]*=[[:space:]]*\"dzn_network_db\"' \"${DEPLOY_ROOT}\""), false, "Repair deploy must not scan all compiled output for generic production names.");
  assert.equal(ownerPreviewRepairBlock.includes("grep -R -E 'name[[:space:]]*=[[:space:]]*\"dzn-network\"|database_name[[:space:]]*=[[:space:]]*\"dzn_network_db\"|dzn_network_db'"), false, "Repair deploy must not reject generic public production URLs or names in compiled code.");
  assert.equal(ownerPreviewRepairBlock.includes('"${GITHUB_WORKSPACE}/runtime-main/node_modules/.bin/wrangler" pages deploy out'), true, "Repair deploy must invoke Wrangler from the pinned runtime binary in the isolated directory.");
  assert.equal(ownerPreviewRepairBlock.includes("--project-name \"${REPAIR_PREVIEW_PROJECT_NAME}\""), true, "Repair deploy must target only the fixed preview project.");
  assert.equal(ownerPreviewRepairBlock.includes("--commit-hash \"${APPROVED_MAIN_RUNTIME_SHA}\""), true, "Repair deploy metadata must use the pinned main commit.");
  assert.equal(ownerPreviewRepairBlock.includes("PREVIEW_DEPLOY_CONFIGURATION_DRIFT"), true, "Repair post-deploy verification must detect config drift.");
  assert.equal(ownerPreviewRepairBlock.includes("repatchAndFail"), true, "Repair post-deploy drift must repatch preview config and fail.");
  assert.equal(ownerPreviewRepairBlock.includes("route probes skipped"), true, "Repair drift handling must skip route probes.");
  assert.equal(ownerPreviewRepairBlock.indexOf("for (const environment of [\"production\", \"preview\"])") < ownerPreviewRepairBlock.indexOf("await verifyBase(immutableUrl);"), true, "Repair route probes must run only after binding safety checks.");
  assert.equal(ownerPreviewRepairBlock.includes("await verifyBase(immutableUrl);"), true, "Repair verification must check the immutable preview URL.");
  assert.equal(ownerPreviewRepairBlock.includes("await verifyBase(stableUrl);"), true, "Repair verification must check the stable preview URL.");
  assert.equal(ownerPreviewRepairBlock.includes("PREVIEW_PAGES_FUNCTIONS_WORKER_MISSING"), true, "Repair verification must diagnose missing Pages Functions worker.");
  assert.equal(ownerPreviewRepairBlock.includes("/owner returned 200 instead of 302"), true, "Repair verification must classify static /owner as missing Functions worker.");
  assert.equal(ownerPreviewRepairBlock.includes("returned 404; ${statusSummary(result)}"), true, "Repair verification must classify owner API 404 as missing Functions worker.");
  assert.equal(ownerPreviewRepairBlock.includes("PREVIEW_OWNER_API_RUNTIME_ERROR"), true, "Repair verification must report owner API 500/503 separately.");
  assert.equal(ownerPreviewRepairBlock.includes("Cache-Control\": \"no-cache\""), true, "Repair route probes must bypass cache.");
  assert.equal(ownerPreviewRepairBlock.includes("for (let attempt = 1; attempt <= 12; attempt += 1)"), true, "Repair route verification must retry bounded deployment propagation.");
  assert.equal(ownerPreviewRepairBlock.includes("await wait(5000)"), true, "Repair route verification must wait between propagation retries.");
  assert.equal(ownerPreviewRepairBlock.includes("body-length="), true, "Repair diagnostics must include safe body length rather than raw body.");
  assert.equal(ownerPreviewRepairBlock.includes("discordNotificationsEnabled === false"), true, "Repair verification must require disabled public Discord notifications.");
  assert.equal(ownerPreviewRepairBlock.includes("SELECT COUNT(*) AS row_count FROM discord_announcement_posts;"), true, "Repair verification must check announcement row count.");
  assert.equal(ownerPreviewRepairBlock.includes("dzn_network_db_discord_announcements_preview_alignment_ee8c812"), false, "Repair steps must use fixed env constants instead of user-entered old database literals.");
  assert.equal(ownerPreviewRepairBlock.includes("npx wrangler d1 migrations apply"), false, "Repair mode must not run migrations.");
  assert.equal(ownerPreviewRepairBlock.includes("owner-console-preview-seed.sql"), false, "Repair mode must not seed data.");
  assert.equal(ownerPreviewRepairBlock.includes("npx wrangler d1 create"), false, "Repair mode must not create D1 databases.");
  assert.equal(ownerPreviewRepairBlock.includes("method: \"DELETE\""), false, "Repair mode must not delete D1 databases.");
  assert.equal(ownerPreviewRepairBlock.includes("wrangler pages secret put"), false, "Repair mode must not update Pages secrets.");
  assert.equal(ownerPreviewRepairBlock.includes("/api/owner/events"), false, "Repair mode must not call application event mutation APIs.");
  assert.equal(ownerPreviewRepairBlock.includes("discord.com/api"), false, "Repair mode must not call Discord.");
  assert.equal(ownerPreviewRepairStart < ownerPreviewRepairPrepareStart, true, "Repair audit/config patch must happen before runtime checkout.");
  assert.equal(ownerPreviewRepairPrepareStart < ownerPreviewRepairBuildStart, true, "Repair runtime checkout must happen before build.");
  assert.equal(ownerPreviewRepairBuildStart < ownerPreviewRepairDeployStart, true, "Repair build must happen before deploy.");
  assert.equal(ownerPreviewRepairDeployStart < ownerPreviewRepairVerifyStart, true, "Repair deploy must happen before post-deploy verification.");
  assert.equal(ownerPreviewRepairVerifyStart < ownerPreviewResolveD1Start, true, "Repair flow must stay separate from full-preview D1 creation.");
  const ownerPreviewResolveD1Block = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewResolveD1Start, ownerPreviewMigrateStart);
  const ownerPreviewCapacityCheck = indexOfOrFail(ownerPreviewResolveD1Block, "PREVIEW_D1_CAPACITY_EXHAUSTED");
  const ownerPreviewCreateCall = indexOfOrFail(ownerPreviewResolveD1Block, 'method: "POST"');
  assert.equal(ownerPreviewCapacityCheck < ownerPreviewCreateCall, true, "Capacity exhaustion must fail before D1 creation is attempted.");
  assert.equal(ownerPreviewConfigWrite > ownerPreviewResolveD1Start, true, "Preview Wrangler config must be generated in the D1 resolution step.");
  assert.equal(ownerPreviewMigrateStart > ownerPreviewConfigWrite, true, "Preview migrations must run after the preview Wrangler config is generated.");
  assert.equal(ownerPreviewSeedStart > ownerPreviewConfigWrite, true, "Preview seed must run after the preview Wrangler config is generated.");
  assert.equal(ownerPreviewEventFixtureCheckStart > ownerPreviewSeedStart, true, "Creator-governance preview event fixture check must run after seed and migrations.");
  assert.equal(ownerPreviewDeployStart > ownerPreviewEventFixtureCheckStart, true, "Preview deployment must run after the exact test-event fixture check.");
  assert.equal(ownerPreviewVerifyStart > ownerPreviewDeployStart, true, "Route/API verification must run after preview deployment.");
  assert.equal(ownerPreviewCreatorPost > ownerPreviewVerifyStart, true, "Creator POST must occur during route/API verification.");
  assert.equal(ownerPreviewRowVerifyStart > ownerPreviewCreatorPost, true, "D1 row verification must run only after the creator POST verification.");
  const ownerPreviewBeforeFullPreviewConfig = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewResolveD1Start, ownerPreviewConfigWrite);
  assert.equal(ownerPreviewBeforeFullPreviewConfig.includes("wrangler.owner-console-preview.toml"), false, "Full-preview D1 commands may not reference wrangler.owner-console-preview.toml before it is created.");
  const ownerPreviewRowVerifyBlock = dznOwnerConsolePreviewWorkflow.slice(ownerPreviewRowVerifyStart);
  assert.equal(ownerPreviewRowVerifyBlock.includes("if: always()"), false, "Creator-governance row verification must not run after failed deployment/API verification.");
  assert.equal(ownerPreviewRowVerifyBlock.includes("--command \"${VERIFY_SQL}\""), true, "Creator-governance row verification must use --command.");
  assert.equal(ownerPreviewRowVerifyBlock.includes("--file owner-console-creator-event-verify.sql"), false, "Creator-governance row verification must not use --file for JSON output.");
  assert.equal(ownerPreviewRowVerifyBlock.includes("> owner-console-creator-event-count.json"), true, "Creator-governance row verification must separate stdout JSON.");
  assert.equal(ownerPreviewRowVerifyBlock.includes("2> owner-console-creator-event-count.stderr.log"), true, "Creator-governance row verification must redirect stderr separately.");
  assert.equal(ownerPreviewRowVerifyBlock.includes("parseWranglerJsonFile"), true, "Creator-governance row verification must defensively parse Wrangler JSON.");
  assert.equal(ownerPreviewRowVerifyBlock.includes("replace(/^\\uFEFF/, \"\")"), true, "Creator-governance parser must strip UTF-8 BOM.");
  assert.equal(ownerPreviewRowVerifyBlock.includes("jsonStartFound=false"), true, "Creator-governance parser must reject output without a JSON start.");
  assert.equal(ownerPreviewRowVerifyBlock.includes("byteLength="), true, "Creator-governance malformed JSON diagnostic must include byte length.");
  assert.equal(ownerPreviewRowVerifyBlock.includes("firstSafeLine="), true, "Creator-governance malformed JSON diagnostic must include only a safe first line.");
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("INSERT INTO server_build_stats (id,"), false);
  assert.equal(dznOwnerConsolePreviewWorkflow.includes("https://dzn-network.pages.dev/api/auth/discord/callback"), false);
  assertInsertColumnsKnown(dznOwnerConsolePreviewWorkflow, "server_build_stats", [
    "linked_server_id",
    "nitrado_service_id",
    "structures_built",
    "build_items_placed",
    "storage_items_placed",
    "traps_placed",
    "build_score",
    "top_builder_name",
    "top_builder_count",
    "last_build_at",
    "updated_at",
  ]);

}
