import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getAdmDiscoveryIntervalMinutes, getAdmPullInterval } from "../lib/billing/plans";

type CheckStatus = "pass" | "warn" | "fail";

type AuditCheck = {
  status: CheckStatus;
  title: string;
  detail: string;
};

const root = process.cwd();
const checks: AuditCheck[] = [];

function repoPath(relativePath: string) {
  return path.join(root, relativePath);
}

function readSource(relativePath: string) {
  const fullPath = repoPath(relativePath);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

function add(status: CheckStatus, title: string, detail: string) {
  checks.push({ status, title, detail });
}

function pass(title: string, detail: string) {
  add("pass", title, detail);
}

function fail(title: string, detail: string) {
  add("fail", title, detail);
}

function checkFile(relativePath: string, title: string) {
  if (existsSync(repoPath(relativePath))) pass(title, `${relativePath} exists.`);
  else fail(title, `${relativePath} is missing.`);
}

function checkIncludes(relativePath: string, expected: string, title: string, detail?: string) {
  const source = readSource(relativePath);
  if (source.includes(expected)) pass(title, detail ?? `${relativePath} contains ${expected}.`);
  else fail(title, `${relativePath} does not contain ${expected}.`);
}

function checkPlanIntervals() {
  checkIncludes("lib/billing/plans.ts", "adm_discovery_interval_minutes", "Plan config includes adm_discovery_interval_minutes");
  const expected = [
    ["starter", 15, 60],
    ["pro", 10, 30],
    ["network", 5, 15],
    ["partner", 3, 10],
  ] as const;

  for (const [plan, discoveryInterval, interval] of expected) {
    const discoveryActual = getAdmDiscoveryIntervalMinutes(plan);
    if (discoveryActual === discoveryInterval) pass(`${plan} ADM discovery interval`, `ADM discovery checks every ${discoveryInterval} minutes.`);
    else fail(`${plan} ADM discovery interval`, `Expected ${discoveryInterval} minutes, got ${discoveryActual}.`);
    const actual = getAdmPullInterval(plan);
    if (actual === interval) pass(`${plan} ADM processing interval`, `ADM processing checks every ${interval} minutes.`);
    else fail(`${plan} ADM interval`, `Expected ${interval} minutes, got ${actual}.`);
  }

  for (const [plan] of expected) {
    const discoveryActual = getAdmDiscoveryIntervalMinutes(plan);
    if (discoveryActual >= 3) pass(`${plan} ADM discovery hard floor`, `${discoveryActual} minutes is at or above the 3-minute floor.`);
    else fail(`${plan} ADM discovery hard floor`, `${discoveryActual} minutes is below the 3-minute floor.`);
    const actual = getAdmPullInterval(plan);
    if (actual >= 10) pass(`${plan} ADM hard floor`, `${actual} minutes is at or above the 10-minute floor.`);
    else fail(`${plan} ADM hard floor`, `${actual} minutes is below the 10-minute floor.`);
  }
}

function auditNewestFileSelection() {
  checkIncludes("functions/_lib/nitrado.ts", "pickNewestAdmFile", "Newest ADM helper exists");
  checkIncludes("functions/_lib/nitrado.ts", "compareAdmFilesNewestFirst", "Newest ADM sort exists");
  checkIncludes("functions/_lib/nitrado.ts", "parseAdmTimestamp(entry.name)", "Filename timestamp parsing used first");
  checkIncludes("functions/_lib/nitrado.ts", "entry.modified", "Modified-time fallback is used");
  checkIncludes("functions/_lib/nitrado.ts", "isAdmFile(entry)", "Only ADM files are selected for ADM parsing");
  checkIncludes("functions/_lib/adm-sync.ts", "compareAdmCandidatesChronological", "Sync candidate sort uses timestamp fallback");
  checkIncludes("functions/_lib/adm-sync.ts", "selectNewestDiscoveredAdmFile", "Newest available ADM is recorded");
  checkIncludes("functions/_lib/adm-sync.ts", "selectNewestReadableAdmFile", "Newest readable ADM is recorded");
}

function auditRestartStateMachine() {
  const states = [
    "idle",
    "checking",
    "waiting_after_restart",
    "new_adm_detected",
    "new_adm_readable",
    "new_data_found",
    "no_new_log_available",
    "latest_adm_unreadable",
    "delayed_after_restart",
    "failed",
  ];
  for (const state of states) {
    checkIncludes("functions/_lib/adm-sync.ts", state, `ADM state ${state}`);
  }
  checkIncludes("functions/_lib/adm-sync.ts", "isAdmDelayedAfterRestart", "45-minute delayed-after-restart helper exists");
  checkIncludes("functions/_lib/adm-sync.ts", "detectAdmRestartFromFiles", "ADM filename restart detection exists");
  checkIncludes("functions/_lib/automation.ts", "last_server_restart_at", "Restart timestamp is stored");
  checkIncludes("functions/_lib/automation.ts", "last_restart_detected_source", "Restart source is stored");
  checkIncludes("functions/_lib/automation.ts", "last_restart_detected_at", "Restart detection time is stored");
  checkIncludes("functions/_lib/automation.ts", "metadata_status", "Metadata status can detect restart-like states");
  checkIncludes("functions/_lib/automation.ts", "adm_filename", "ADM filename can detect new reset file");
  checkIncludes("migrations/0018_adm_reset_state_tracking.sql", "last_restart_detected_source", "Migration stores restart detection source");
  checkIncludes("migrations/0018_adm_reset_state_tracking.sql", "newest_readable_adm_filename", "Migration stores newest readable ADM evidence");
  checkFile("migrations/0019_adm_discovery_and_nitrado_settings.sql", "ADM discovery/settings migration");
  checkIncludes("migrations/0019_adm_discovery_and_nitrado_settings.sql", "next_adm_discovery_due_at", "Migration stores ADM discovery due state");
  checkIncludes("migrations/0019_adm_discovery_and_nitrado_settings.sql", "nitrado_reduce_log_output_confirmed", "Migration stores Nitrado Reduce Log Output confirmation");
  checkFile("migrations/0021_nitrado_log_settings_verification.sql", "Nitrado settings verification migration");
  checkIncludes("migrations/0021_nitrado_log_settings_verification.sql", "nitrado_log_settings_verification_source", "Migration stores Nitrado settings verification source");
  checkIncludes("migrations/0021_nitrado_log_settings_verification.sql", "nitrado_admin_log_enabled", "Migration stores Admin Log verification");
  checkIncludes("migrations/0021_nitrado_log_settings_verification.sql", "nitrado_server_log_enabled", "Migration stores Server Log verification");
  checkFile("migrations/0020_adm_observed_cadence.sql", "ADM observed cadence migration");
  checkIncludes("migrations/0020_adm_observed_cadence.sql", "first_adm_after_restart_delay_minutes", "Migration stores first ADM after restart delay");
  checkIncludes("migrations/0020_adm_observed_cadence.sql", "observed_playerlist_interval_minutes", "Migration stores observed PlayerList interval");
  checkIncludes("migrations/0020_adm_observed_cadence.sql", "last_useful_adm_event_at", "Migration stores last useful ADM event");
}

function auditNoWipeAndUnreadableHandling() {
  checkIncludes("functions/_lib/adm-sync.ts", "lastProcessedLine: Number(existingState?.last_processed_line ?? 0)", "Unreadable/no-file states preserve the processed cursor");
  checkIncludes("functions/_lib/adm-sync.ts", "preservedLastProcessedLine", "Unavailable states log preserved cursor");
  checkIncludes("functions/_lib/adm-sync.ts", "collectReadableAdmFilesUntilUnreadable", "Newest unreadable files stop unsafe old-file replay");
  checkIncludes("functions/_lib/adm-sync.ts", "status: \"unreadable\"", "Unreadable ADM files are queued for retry");
  checkIncludes("functions/_lib/adm-sync.ts", "DZN ADM SELF HEALING ACTIVE", "Unreadable retry logging exists");
  checkIncludes("functions/_lib/automation.ts", "Recovered stale ADM sync lock after 30 minutes.", "Stuck ADM locks are recovered without wiping stats");
}

function auditDueServerSelection() {
  checkIncludes("functions/_lib/automation.ts", "getDueAdmDiscoveryAutomationServers", "Due ADM discovery selector exists");
  checkIncludes("functions/_lib/automation.ts", "getDueAdmAutomationServers", "Due ADM server selector exists");
  checkIncludes("functions/_lib/automation.ts", "lower(server_subscriptions.status) IN ('active', 'trialing')", "Only active/trialing subscriptions are due");
  checkIncludes("functions/_lib/automation.ts", "next_adm_pull_due_at", "ADM due-state controls checks");
  checkIncludes("functions/_lib/automation.ts", "next_adm_discovery_due_at", "ADM discovery due-state controls checks");
  checkIncludes("functions/_lib/automation.ts", "currently_syncing_adm", "Already-syncing servers are skipped");
  checkIncludes("functions/_lib/automation.ts", "minSyncIntervalMs", "Minimum ADM sync interval is enforced");
  checkIncludes("functions/_lib/adm-sync.ts", "Math.max(clampPositiveInteger(options.minSyncIntervalMs ?? 10 * 60 * 1000", "Scheduled ADM runner enforces 10-minute floor");
  checkIncludes("functions/_lib/adm-sync.ts", "runAdmDiscoveryForLinkedServer", "Scheduled ADM runner has lightweight discovery phase");
  checkIncludes("functions/_lib/adm-sync.ts", "readMode: \"sample\"", "ADM discovery uses sample reads instead of full parsing");
  checkIncludes("functions/_lib/adm-sync.ts", "skipped_unreadable", "Processing skips unreadable newest ADM safely");
}

function auditDiscordQueues() {
  checkIncludes("functions/_lib/adm-sync.ts", "queueDiscordPostUpdatesForGuild", "ADM processing queues Discord updates");
  checkIncludes("functions/_lib/adm-sync.ts", "\"killfeed_embed\"", "Killfeed post can be queued from ADM data");
  checkIncludes("functions/_lib/adm-sync.ts", "\"leaderboard_embed\"", "Leaderboard post can be queued from ADM data");
  checkIncludes("functions/_lib/automation.ts", "hasAutoPost(planKey, postType)", "Discord queue respects plan-gated post types");
}

function auditDashboardWording() {
  checkIncludes("components/onboarding/dashboard.tsx", "ADM Discovery", "Dashboard shows ADM discovery section");
  checkIncludes("components/onboarding/dashboard.tsx", "ADM Processing", "Dashboard shows ADM processing section");
  checkIncludes("components/onboarding/dashboard.tsx", "Nitrado Log Settings", "Dashboard shows Nitrado settings checklist");
  checkIncludes("components/onboarding/dashboard.tsx", "Check Nitrado Log Settings", "Dashboard can verify Nitrado settings automatically");
  checkIncludes("functions/api/servers/[serverId]/nitrado-log-settings.ts", "fetchNitradoLogSettingsVerification", "Nitrado settings endpoint uses connected service verification");
  checkIncludes("functions/api/servers/[serverId]/nitrado-log-settings.ts", "manual_required", "Nitrado settings endpoint falls back to manual confirmation");
  checkIncludes("functions/api/servers/[serverId]/nitrado-log-settings.ts", "not_checked", "Nitrado settings endpoint distinguishes unchecked settings");
  checkIncludes("functions/api/servers/[serverId]/nitrado-log-settings.ts", "verified_wrong", "Nitrado settings endpoint reports confirmed wrong settings separately");
  checkIncludes("components/onboarding/dashboard.tsx", "Server restart detected. Waiting for Nitrado to publish the next ADM log.", "Dashboard waiting-after-restart wording");
  checkIncludes("components/onboarding/dashboard.tsx", "Latest ADM file found but not readable yet. DZN will retry on the next scheduled check.", "Dashboard latest-unreadable wording");
  checkIncludes("components/onboarding/dashboard.tsx", "Nitrado has not published a readable ADM log yet. This can take 5-45 minutes after restart.", "Dashboard delayed-after-restart wording");
  checkIncludes("components/onboarding/dashboard.tsx", "No new ADM lines.", "Dashboard no-new-log wording");
  checkIncludes("components/onboarding/dashboard.tsx", "Observed ADM Cadence", "Dashboard shows observed ADM cadence");
  checkIncludes("components/onboarding/dashboard.tsx", "Last PlayerList", "Dashboard shows last PlayerList time");
  checkIncludes("components/onboarding/dashboard.tsx", "Next Expected ADM Update", "Dashboard shows next expected ADM update");
}

function auditPackageCommand() {
  const packageJson = JSON.parse(readSource("package.json")) as { scripts?: Record<string, string> };
  if (packageJson.scripts?.["audit:adm-sync"] === "tsx scripts/audit-adm-sync.ts") {
    pass("Package command audit:adm-sync", packageJson.scripts["audit:adm-sync"]);
  } else {
    fail("Package command audit:adm-sync", "Package command is missing or points to the wrong script.");
  }
  if (packageJson.scripts?.["test:full-system"]?.includes("npm run audit:adm-sync")) {
    pass("test:full-system includes ADM audit", packageJson.scripts["test:full-system"]);
  } else {
    fail("test:full-system includes ADM audit", "test:full-system does not run audit:adm-sync.");
  }
}

function printReport() {
  const icons: Record<CheckStatus, string> = {
    pass: "PASS",
    warn: "WARN",
    fail: "FAIL",
  };
  console.log("\nDZN ADM Sync Audit");
  console.log("==================");
  for (const check of checks) {
    console.log(`${icons[check.status]} ${check.title}`);
    console.log(`   ${check.detail}`);
  }

  const passed = checks.filter((check) => check.status === "pass").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const failed = checks.filter((check) => check.status === "fail").length;

  console.log("\nSummary");
  console.log("-------");
  console.log(`Total checks: ${checks.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Warnings: ${warnings}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nRecommended fixes");
    console.log("-----------------");
    for (const check of checks.filter((item) => item.status === "fail")) {
      console.log(`- ${check.title}: ${check.detail}`);
    }
    process.exitCode = 1;
  } else if (warnings > 0) {
    console.log("\nRecommended fixes");
    console.log("-----------------");
    console.log("- Review warnings above.");
  } else {
    console.log("\nRecommended fixes");
    console.log("-----------------");
    console.log("- No ADM sync wiring gaps detected by this source audit.");
  }
}

checkFile("functions/_lib/adm-sync.ts", "ADM sync library");
checkFile("functions/_lib/nitrado.ts", "Nitrado ADM helper library");
checkFile("functions/api/sync/adm/run.ts", "Scheduled ADM endpoint");
checkPlanIntervals();
auditNewestFileSelection();
auditRestartStateMachine();
auditNoWipeAndUnreadableHandling();
auditDueServerSelection();
auditDiscordQueues();
auditDashboardWording();
auditPackageCommand();
printReport();
