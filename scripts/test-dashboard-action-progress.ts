import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync("components/onboarding/dashboard.tsx", "utf8");

function includesAll(snippets: string[]) {
  for (const snippet of snippets) {
    assert.equal(dashboard.includes(snippet), true, `Expected dashboard source to include: ${snippet}`);
  }
}

includesAll([
  "type DashboardActionStatus",
  "type RunDashboardActionInput",
  "function ActionProgressPanel",
  "function ActionProgressToast",
  "async function runDashboardAction",
  "function refreshDashboardDataAfterAction",
  "dzn:activeDashboardAction:",
  "saveDashboardActionState(server.id, initialAction)",
  "setDashboardAction(finalAction)",
  "autoHardRefreshOnComplete = false",
  "Action completed. Refreshing dashboard data",
  "Last-known dashboard data is still visible.",
]);

includesAll([
  "updateAdmChunkDashboardActionProgress",
  "ADM_PROGRESS_ACTION_KEYS",
  "Parsed kills",
  "Written kills",
  "Duplicates",
  "Processing ADM chunks",
  "ADM Job Progress",
  "Backfill Queue Progress",
  "Active File Progress",
]);

includesAll([
  'actionKey: "refresh-server-info"',
  'actionKey: "run-manual-sync"',
  'actionKey: "check-adm-files"',
  'actionKey: "verify-adm-automation"',
  'actionKey: "force-process-latest-adm"',
  'actionKey: "backfill-missing-adm"',
  'actionKey: "recover-stuck-sync-jobs"',
  'actionKey: "import-adm-files"',
  'actionKey: "preview-adm-files"',
  '"continue-import"',
  '"resume-import"',
  'actionKey: "cancel-import"',
  'actionKey: "check-nitrado-log-settings"',
  'actionKey: "save-nitrado-log-settings"',
  'actionKey: "save-auto-post-setup"',
  'actionKey: "run-auto-post-dispatcher"',
  '"test-discord-post"',
  'actionKey: "rebuild-public-cache"',
  'actionKey: "manage-billing"',
  'actionKey: "refresh-plan"',
]);

includesAll([
  "disabled={refreshingServerInfo || isDashboardActionActive}",
  "disabled={syncing || isDashboardActionActive}",
  "disabled={checkingAdmFileDiscovery || isDashboardActionActive}",
  "disabled={verifyingAdmAutomation || isDashboardActionActive}",
  "disabled={forceLatestAdmRunning || isDashboardActionActive}",
  "disabled={admBackfillRunning || isDashboardActionActive}",
  "dashboardActionKey === \"refresh-server-info\"",
  "dashboardActionKey === \"run-manual-sync\"",
  "runDashboardAction={runDashboardAction}",
]);

assert.equal(
  dashboard.includes("setSyncStatus(null)") || dashboard.includes("setRecentEvents([])") || dashboard.includes("setBillingStatus(null)"),
  false,
  "Action progress work must not wipe last-good dashboard data while actions run.",
);

console.log("Dashboard action progress regression checks passed.");
