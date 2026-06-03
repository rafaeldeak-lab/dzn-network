import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  AUTO_POST_TYPES,
  BILLING_PLAN_CONFIG,
  MIN_ADM_DISCOVERY_INTERVAL_MINUTES,
  MIN_ADM_PULL_INTERVAL_MINUTES,
  MIN_SERVER_STATUS_INTERVAL_MINUTES,
  PAID_PLAN_KEYS,
  getAdmPullInterval,
  getAdmDiscoveryIntervalMinutes,
  getServerStatusInterval,
  hasAutoPost,
} from "../lib/billing/plans";

type CheckStatus = "pass" | "warn" | "fail";

type AuditCheck = {
  status: CheckStatus;
  title: string;
  detail: string;
};

const checks: AuditCheck[] = [];
const root = process.cwd();

const REQUIRED_ENV = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_REDIRECT_URI",
  "DISCORD_BOT_TOKEN",
  "DZN_CRON_SECRET",
  "DZN_APP_URL",
  "SESSION_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_PREMIUM",
  "TOKEN_ENCRYPTION_KEY",
] as const;

function add(status: CheckStatus, title: string, detail: string) {
  checks.push({ status, title, detail });
}

function pass(title: string, detail: string) {
  add("pass", title, detail);
}

function warn(title: string, detail: string) {
  add("warn", title, detail);
}

function fail(title: string, detail: string) {
  add("fail", title, detail);
}

function repoPath(relativePath: string) {
  return path.join(root, relativePath);
}

function fileExists(relativePath: string) {
  return existsSync(repoPath(relativePath));
}

function readSource(relativePath: string) {
  const fullPath = repoPath(relativePath);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

function checkFile(relativePath: string, label = relativePath) {
  if (fileExists(relativePath)) pass(label, `${relativePath} exists.`);
  else fail(label, `${relativePath} is missing.`);
}

function checkIncludes(relativePath: string, expected: string, title: string, detail?: string) {
  const source = readSource(relativePath);
  if (source.includes(expected)) pass(title, detail ?? `${relativePath} contains ${expected}.`);
  else fail(title, `${relativePath} does not contain ${expected}.`);
}

function likelyFormatWarning(key: string, value: string) {
  if (key === "DZN_APP_URL" || key === "DISCORD_REDIRECT_URI") {
    try {
      new URL(value);
    } catch {
      return "Value is not a valid URL.";
    }
  }
  if (key === "STRIPE_SECRET_KEY" && !value.startsWith("sk_")) return "Stripe secret key should usually start with sk_.";
  if (key === "STRIPE_WEBHOOK_SECRET" && !value.startsWith("whsec_")) return "Stripe webhook secret should usually start with whsec_.";
  if (key === "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" && !value.startsWith("pk_")) return "Stripe publishable key should usually start with pk_.";
  if (key.startsWith("STRIPE_PRICE_") && !value.startsWith("price_")) return "Stripe price IDs should usually start with price_.";
  if (key === "SESSION_SECRET" && value.length < 24) return "Session secret looks short.";
  if (key === "DZN_CRON_SECRET" && value.length < 24) return "Cron secret looks short.";
  if (key === "TOKEN_ENCRYPTION_KEY" && value.length < 32) return "Token encryption key looks short.";
  return null;
}

function auditEnvironment() {
  for (const key of REQUIRED_ENV) {
    const value = process.env[key]?.trim();
    if (!value) {
      warn(`Env ${key}`, "Missing in this local shell. Set it in Cloudflare Pages/Worker if required for production.");
      continue;
    }
    const formatWarning = likelyFormatWarning(key, value);
    if (formatWarning) warn(`Env ${key}`, `Present, but ${formatWarning}`);
    else pass(`Env ${key}`, "Present. Value hidden.");
  }
}

function auditBillingPlans() {
  for (const key of PAID_PLAN_KEYS) {
    const plan = BILLING_PLAN_CONFIG[key];
    if (plan) pass(`Plan ${key}`, `${plan.name} exists.`);
    else {
      fail(`Plan ${key}`, "Plan is missing.");
      continue;
    }

    if (plan.stripe_price_env_key) pass(`Plan ${key} Stripe env`, `Uses ${plan.stripe_price_env_key}.`);
    else fail(`Plan ${key} Stripe env`, "Paid plan is missing a Stripe price env key.");

    if (plan.server_status_interval_minutes >= MIN_SERVER_STATUS_INTERVAL_MINUTES) pass(`Plan ${key} status interval`, `${plan.server_status_interval_minutes} minutes.`);
    else fail(`Plan ${key} status interval`, "Below hard floor.");

    if (plan.adm_pull_interval_minutes >= MIN_ADM_PULL_INTERVAL_MINUTES) pass(`Plan ${key} ADM interval`, `${plan.adm_pull_interval_minutes} minutes.`);
    else fail(`Plan ${key} ADM interval`, "Below hard floor.");

    if (plan.adm_discovery_interval_minutes >= MIN_ADM_DISCOVERY_INTERVAL_MINUTES) pass(`Plan ${key} ADM discovery interval`, `${plan.adm_discovery_interval_minutes} minutes.`);
    else fail(`Plan ${key} ADM discovery interval`, "Below discovery hard floor.");

    if (plan.manual_adm_refresh_cooldown_minutes >= MIN_ADM_PULL_INTERVAL_MINUTES) pass(`Plan ${key} manual cooldown`, `${plan.manual_adm_refresh_cooldown_minutes} minutes.`);
    else fail(`Plan ${key} manual cooldown`, "Below ADM hard floor.");

    if (plan.allowed_features.length > 0) pass(`Plan ${key} features`, `${plan.allowed_features.length} features configured.`);
    else fail(`Plan ${key} features`, "No allowed features configured.");

    if (key === "starter" && plan.allowed_auto_posts.length === 1 && plan.allowed_auto_posts[0] === "basic_status_embed") {
      pass("Starter auto-post limit", "Starter only allows Basic Server Status.");
    }
    if (key === "premium" && AUTO_POST_TYPES.every((postType) => hasAutoPost("premium", postType))) {
      pass("Premium auto-post limit", "Premium allows every configured auto-post type.");
    }
  }

  const expectedIntervals = [
    ["starter", 7, 15, 60],
    ["pro", 5, 10, 30],
    ["premium", 1, 3, 10],
  ] as const;
  for (const [planKey, statusInterval, discoveryInterval, admInterval] of expectedIntervals) {
    if (getServerStatusInterval(planKey) === statusInterval) pass(`${planKey} status cadence`, `Status sync every ${statusInterval} minutes.`);
    else fail(`${planKey} status cadence`, `Expected ${statusInterval}, got ${getServerStatusInterval(planKey)}.`);
    if (getAdmDiscoveryIntervalMinutes(planKey) === discoveryInterval) pass(`${planKey} ADM discovery cadence`, `ADM discovery every ${discoveryInterval} minutes.`);
    else fail(`${planKey} ADM discovery cadence`, `Expected ${discoveryInterval}, got ${getAdmDiscoveryIntervalMinutes(planKey)}.`);
    if (getAdmPullInterval(planKey) === admInterval) pass(`${planKey} ADM cadence`, `ADM sync every ${admInterval} minutes.`);
    else fail(`${planKey} ADM cadence`, `Expected ${admInterval}, got ${getAdmPullInterval(planKey)}.`);
  }
}

function auditDiscordConfig() {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  if (clientId) {
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=8&scope=bot%20applications.commands`;
    pass("Discord bot invite URL", `Can be generated: ${inviteUrl.replace(clientId, "[client_id]")}`);
  } else {
    warn("Discord bot invite URL", "DISCORD_CLIENT_ID missing locally, so invite URL cannot be generated here.");
  }
  checkFile("functions/api/discord/bot-status.ts", "Bot status endpoint");
  checkFile("functions/api/servers/[serverId]/discord-channels.ts", "Discord channel endpoint");
  checkIncludes("components/onboarding/setup-wizard.tsx", "Add DZN Bot", "Onboarding bot install step");
  checkIncludes("components/onboarding/setup-wizard.tsx", "Verify Bot Connection", "Onboarding bot verification step");
  checkIncludes("functions/_lib/discord-posting.ts", "DISCORD_ADMINISTRATOR_PERMISSION", "Discord Administrator resolver");
  checkIncludes("functions/_lib/discord-posting.ts", "sendOrEditWithBot", "Discord bot posting");
  checkIncludes("functions/_lib/discord-posting.ts", "sendOrEditWithWebhook", "Discord webhook fallback");
}

function auditCronConfig() {
  checkFile("workers/adm-sync-worker.ts", "Cloudflare Worker cron");
  checkFile("wrangler.adm-sync.toml", "Worker Wrangler config");
  checkIncludes("wrangler.adm-sync.toml", "crons = [\"* * * * *\"]", "Worker 1-minute schedule");
  checkIncludes("workers/adm-sync-worker.ts", "runAdmWorkerSyncTick", "Worker runs ADM sync directly");
  checkIncludes("workers/adm-sync-worker.ts", "runDirectAdmSync", "Worker uses direct ADM sync path");
  checkIncludes("workers/adm-sync-worker.ts", "x-dzn-cron-secret", "Worker sends cron secret header");
  checkIncludes("workers/adm-sync-worker.ts", "DZN_CRON_SECRET", "Worker reads DZN_CRON_SECRET");
  checkIncludes(".github/workflows/dzn-adm-sync.yml", "name: DZN ADM Worker Manual Trigger", "GitHub ADM workflow is clearly manual");
  checkIncludes(".github/workflows/dzn-adm-sync.yml", "workflow_dispatch:", "GitHub ADM workflow manual trigger");
  checkIncludes(".github/workflows/dzn-adm-sync.yml", "x-dzn-cron-secret", "GitHub sends cron secret header");
}

function auditSyncEndpoints() {
  const endpoints = [
    "functions/api/sync/metadata/run.ts",
    "functions/api/sync/adm/run.ts",
    "functions/api/sync/discord-posts/run.ts",
  ];
  for (const endpoint of endpoints) {
    checkFile(endpoint, endpoint);
    checkIncludes(endpoint, "requireCronSecret", `${endpoint} uses shared cron auth`);
  }
  checkFile("functions/_lib/cron-auth.ts", "Shared cron auth helper");
  checkIncludes("functions/_lib/cron-auth.ts", "env.DZN_CRON_SECRET || env.SYNC_CRON_SECRET || null", "Cron auth accepts DZN_CRON_SECRET and SYNC_CRON_SECRET");
  checkFile("functions/api/automation/health.ts", "Automation health endpoint");
  checkIncludes("functions/api/automation/health.ts", "requireDznAdmin", "Automation health is Owner/Admin only");
  checkFile("functions/api/servers/[serverId]/auto-posts/run-now.ts", "Server Run Now endpoint");
  checkFile("functions/api/servers/[serverId]/adm-file-discovery/debug.ts", "ADM file discovery debug endpoint");
  checkFile("functions/api/servers/[serverId]/public-cache/debug.ts", "Public cache debug endpoint");
  checkFile("functions/api/servers/[serverId]/public-cache/rebuild.ts", "Public cache rebuild endpoint");
  checkFile("functions/api/servers/[serverId]/sync/recover-locks.ts", "Stuck sync lock recovery endpoint");
  checkIncludes("functions/api/servers/[serverId]/sync/recover-locks.ts", "requireServerOwnerOrDznAdmin", "Stuck sync lock recovery is Owner/Admin only");
  checkIncludes("functions/_lib/public-cache.ts", "metadata_newer_than_public_cache", "Public cache debug flags metadata/cache mismatch");
  checkIncludes("functions/_lib/public-cache.ts", "adm_newer_than_public_cache", "Public cache debug flags ADM/cache mismatch");
  checkIncludes("functions/api/public/servers.ts", "latestPublicTimestamp", "Public profile last sync uses freshest timestamp");
  checkIncludes("functions/api/public/servers.ts", "server_public_cache.updated_at AS public_cache_updated_at", "Public profile reads public cache update time");
}

function auditDatabaseMigrations() {
  const migrationSource = readSource("migrations/0015_automation_pipeline.sql") + "\n" + readSource("functions/_lib/automation.ts");
  for (const table of [
    "server_subscriptions",
    "server_sync_state",
    "server_posting_destinations",
    "server_posting_state",
    "server_public_cache",
    "automation_jobs",
    "automation_cron_runs",
  ]) {
    if (migrationSource.includes(table)) pass(`Database table ${table}`, "Defined in migration or runtime schema.");
    else fail(`Database table ${table}`, "Missing from migration/runtime schema.");
  }
  checkFile("migrations/0016_automation_cron_runs.sql", "Migration 0016 automation cron runs");
  checkFile("migrations/0017_discord_post_dispatch_state.sql", "Migration 0017 Discord dispatch state");
  checkFile("migrations/0018_adm_reset_state_tracking.sql", "Migration 0018 ADM reset state tracking");
  checkFile("migrations/0019_adm_discovery_and_nitrado_settings.sql", "Migration 0019 ADM discovery and Nitrado settings");
  checkFile("migrations/0020_adm_observed_cadence.sql", "Migration 0020 ADM observed cadence");
  checkFile("migrations/0021_nitrado_log_settings_verification.sql", "Migration 0021 Nitrado log settings verification");
  checkFile("migrations/0022_adm_import_report.sql", "Migration 0022 ADM import report");
  checkFile("migrations/0023_adm_cursor_hash_validation.sql", "Migration 0023 ADM cursor hash validation");
  checkFile("migrations/0024_cron_run_metrics.sql", "Migration 0024 cron run metrics");
  checkFile("migrations/0025_sync_lock_started_at.sql", "Migration 0025 sync lock started timestamps");
  checkFile("migrations/0026_adm_import_jobs.sql", "Migration 0026 ADM import jobs");
  checkFile("migrations/0027_adm_import_jobs_chunk_protocol.sql", "Migration 0027 ADM import job chunk protocol");
  checkIncludes("migrations/0017_discord_post_dispatch_state.sql", "last_dispatch_status", "Discord dispatch state migration columns");
  checkIncludes("migrations/0018_adm_reset_state_tracking.sql", "newest_available_adm_filename", "ADM reset state migration columns");
  checkIncludes("migrations/0019_adm_discovery_and_nitrado_settings.sql", "next_adm_discovery_due_at", "ADM discovery due migration columns");
  checkIncludes("migrations/0019_adm_discovery_and_nitrado_settings.sql", "nitrado_log_playerlist_confirmed", "Nitrado log settings migration columns");
  checkIncludes("migrations/0020_adm_observed_cadence.sql", "observed_adm_cadence_minutes", "ADM observed cadence migration columns");
  checkIncludes("migrations/0021_nitrado_log_settings_verification.sql", "nitrado_log_settings_verification_source", "Nitrado settings verification migration columns");
  checkIncludes("migrations/0022_adm_import_report.sql", "last_import_report_json", "ADM import report migration columns");
  checkIncludes("migrations/0023_adm_cursor_hash_validation.sql", "last_processed_adm_line_hash", "ADM cursor hash migration columns");
  checkIncludes("migrations/0024_cron_run_metrics.sql", "processed_count", "Cron metrics migration columns");
  checkIncludes("migrations/0025_sync_lock_started_at.sql", "adm_sync_started_at", "Sync lock started timestamp migration columns");
  checkIncludes("migrations/0026_adm_import_jobs.sql", "adm_import_jobs", "ADM import jobs migration table");
  checkIncludes("migrations/0026_adm_import_jobs.sql", "current_line", "ADM import jobs track chunk progress");
  checkIncludes("migrations/0027_adm_import_jobs_chunk_protocol.sql", "import_hit_lines", "ADM import jobs can opt into hit-line import");
  checkIncludes("functions/_lib/automation.ts", "last_seen_adm_timestamp", "ADM timestamp tracking columns");
  checkIncludes("functions/_lib/automation.ts", "last_adm_discovery_check_at", "ADM discovery check tracking");
  checkIncludes("functions/_lib/automation.ts", "newest_available_adm_filename", "Newest available ADM tracking");
  checkIncludes("functions/_lib/automation.ts", "newest_readable_adm_filename", "Newest readable ADM tracking");
  checkIncludes("functions/_lib/automation.ts", "last_restart_detected_source", "Restart detection source tracking");
  checkIncludes("functions/_lib/automation.ts", "recordAdmCadenceObservation", "Observed ADM cadence tracking");
}

function auditDashboardStructure() {
  const dashboard = "components/onboarding/dashboard.tsx";
  for (const label of ["Overview", "Sync Health", "Public Listing", "Billing & Boosts", "Discord Posts", "Settings & Danger"]) {
    checkIncludes(dashboard, label, `Dashboard tab ${label}`);
  }
  for (const action of [
    "refreshServerInfo",
    "runSync",
    "runDiagnostics",
    "rerunLogCheck",
    "clearTestData",
    "confirmDangerAction",
    "openBillingPortal",
    "runDispatcherNow",
    "runSetupAction",
    "saveSetup",
  ]) {
    checkIncludes(dashboard, action, `Dashboard handler ${action}`);
  }
  checkIncludes(dashboard, "Last Sync Details", "Sync details are expandable");
  checkIncludes(dashboard, "ADM API Diagnostics", "ADM diagnostics are expandable");
  checkIncludes(dashboard, "ADM File Discovery Diagnostics", "ADM file discovery diagnostics are expandable");
  checkIncludes(dashboard, "Check ADM Files", "ADM file discovery can be checked from Sync Health");
  checkIncludes(dashboard, "Nitrado Log Settings", "Nitrado log settings checklist is visible");
  checkIncludes(dashboard, "Check Nitrado Log Settings", "Nitrado log settings can be checked automatically");
  checkIncludes(dashboard, "Checks for new ADM files every", "ADM discovery timing is visible");
  checkIncludes(dashboard, "Processes readable ADM data every", "ADM processing timing is visible");
  checkIncludes(dashboard, "Last ADM Import Report", "ADM import report diagnostics are visible when expanded");
  checkIncludes(dashboard, "Cursor Validation", "ADM import report shows cursor validation status");
  checkIncludes(dashboard, "ADM cursor verified.", "ADM cursor hash validation wording is present");
  checkIncludes(dashboard, "Rebuild Public Cache Now", "Public profile cache can be rebuilt from Sync Health");
  checkIncludes(dashboard, "Public profile cache is stale. Rebuild recommended.", "Stale public profile cache warning is visible");
  checkIncludes(dashboard, "Recover Stuck Sync Locks", "Stale sync locks can be recovered from Sync Health");
  checkIncludes(dashboard, "Cron Status", "Automation health shows cron status summary");
}

function auditDiscordAutoPosts() {
  checkIncludes("functions/api/servers/[serverId]/discord-channels.ts", "fetchDiscordPostingChannels", "Channel discovery route uses Discord posting channel resolver");
  checkIncludes("functions/_lib/discord-posting.ts", "source: \"administrator\"", "Permission resolver detects Administrator");
  checkIncludes("functions/_lib/discord-posting.ts", "deliverDiscordPayload", "Dispatcher delivery helper exists");
  checkIncludes("functions/_lib/discord-posting.ts", "state?.last_payload_hash === payloadHash", "Dispatcher avoids unchanged edits in scheduled mode");
  checkIncludes("functions/_lib/discord-posting.ts", "recordDiscordPostingDeliveryState", "Test and dispatcher record message state");
  checkIncludes("functions/api/servers/[serverId]/auto-posts/run-now.ts", "force: true", "Run Now force dispatches");
  checkIncludes("components/onboarding/dashboard.tsx", "Run Auto Post Dispatcher Now", "Run Now button exists");
  checkIncludes("components/onboarding/dashboard.tsx", "Run Now Result", "Run Now result panel exists");
  checkIncludes("components/onboarding/dashboard.tsx", "loadDiscordChannelCache", "Channel cache exists for temporary fetch failures");
  checkIncludes("components/onboarding/dashboard.tsx", "Saved auto-post setups continue running even if channel refresh temporarily fails.", "503 channel fetch warning preserves saved setup status");
}

function auditPackageCommands() {
  const packageJson = JSON.parse(readSource("package.json")) as { scripts?: Record<string, string> };
  for (const command of ["audit:system", "audit:adm-sync", "check:automation-live", "check:cron-production", "check:server-due-state", "debug:adm-discovery", "test:adm-import-pipeline", "test:public-profile-sync", "test:full-system"]) {
    if (packageJson.scripts?.[command]) pass(`Package command ${command}`, packageJson.scripts[command]);
    else fail(`Package command ${command}`, "Package command is missing.");
  }
}

function auditAdmSyncWiring() {
  checkIncludes("functions/_lib/nitrado.ts", "timestampScore(entry)", "Nitrado ADM sorting parses filename timestamp and modified fallback");
  checkIncludes("functions/_lib/nitrado.ts", "pickNewestAdmFile", "Nitrado newest ADM file selection helper exists");
  checkIncludes("functions/_lib/nitrado.ts", "debugNitradoAdmFileDiscovery", "Detailed ADM discovery diagnostics helper exists");
  checkIncludes("functions/_lib/nitrado.ts", "nitrado_api_log_files_stale_or_missing", "Nitrado stale log_files diagnosis exists");
  checkIncludes("functions/_lib/nitrado.ts", "fullDownloadFallback", "Nitrado seek/sample read falls back to full download");
  checkIncludes("functions/_lib/nitrado.ts", "download_fallback_attempted", "ADM discovery diagnostics expose download fallback status");
  checkIncludes("functions/_lib/adm-sync.ts", "compareAdmCandidatesChronological", "ADM candidate sorting uses parsed timestamp fallback");
  checkIncludes("functions/_lib/adm-sync.ts", "selectNewestDiscoveredAdmFile", "Newest discovered ADM evidence is tracked");
  checkIncludes("functions/_lib/adm-sync.ts", "latest_adm_unreadable", "Latest unreadable ADM state exists");
  checkIncludes("functions/_lib/adm-sync.ts", "delayed_after_restart", "Delayed-after-restart state exists");
  checkIncludes("functions/_lib/adm-sync.ts", "detectAdmRestartFromFiles", "ADM filename restart detection helper exists");
  checkIncludes("functions/_lib/automation.ts", "getDueAdmAutomationServers", "Scheduled ADM sync selects all due connected servers");
  checkIncludes("functions/_lib/automation.ts", "lower(server_subscriptions.status) IN ('active', 'trialing')", "ADM automation filters active/trialing subscriptions");
  checkIncludes("functions/_lib/automation.ts", "currently_syncing_adm", "ADM automation lock is enforced");
  checkIncludes("functions/_lib/adm-sync.ts", "queueDiscordPostUpdatesForGuild", "ADM data changes queue Discord post updates");
  checkIncludes("functions/_lib/adm-sync.ts", "importReadableAdmLinesIntoDatabase", "ADM fixture import uses database write path");
  checkIncludes("functions/_lib/adm-sync.ts", "last_import_report_json", "ADM import report is stored with sync state");
  checkIncludes("functions/_lib/adm-sync.ts", "processPendingAdmImportJobs", "Scheduled ADM import jobs continue in chunks");
  checkIncludes("functions/_lib/adm-sync.ts", "createScheduledAdmImportJobForServer", "Scheduled ADM processing uses chunked import jobs");
  checkIncludes("functions/_lib/adm-sync.ts", "scheduled_nitrado", "Automatic Nitrado imports are tagged separately from manual uploads");
  checkIncludes("functions/_lib/adm-sync.ts", "skipFailedAdmImportLine", "ADM chunk import can skip one bad line without failing the file");
  checkIncludes("functions/_lib/adm-sync.ts", "completed_with_warnings", "ADM finish warnings do not erase completed chunk counters");
  checkIncludes("functions/api/servers/[serverId]/adm/import-job/chunk.ts", "requestDetails", "ADM chunk endpoint returns structured diagnostics");
  checkIncludes("functions/api/servers/[serverId]/adm/import-job/chunk.ts", "firstLinePreview", "ADM chunk endpoint includes failed line preview context");
  checkIncludes("functions/api/servers/[serverId]/adm/import-job/status.ts", "getAdmImportJobProgressForServer", "ADM import job status endpoint exists");
  checkIncludes("functions/api/servers/[serverId]/adm/import-job/latest.ts", "getLatestAdmImportJobProgressForFilename", "ADM import job latest-by-filename endpoint exists");
  checkIncludes("functions/api/servers/[serverId]/adm/import-job/continue.ts", "processNextAdmImportJobChunk", "ADM import job continue endpoint exists");
  checkIncludes("components/onboarding/dashboard.tsx", "ADM_IMPORT_RETRY_CHUNK_SIZES = [5, 1]", "Dashboard retries failed ADM chunks at 5-line and 1-line sizes");
  checkIncludes("components/onboarding/dashboard.tsx", "sendAdmImportChunkWithFallback", "Dashboard import UI avoids failing the whole file on one failed chunk");
  checkIncludes("components/onboarding/dashboard.tsx", "makeWarningBulkAdmFileResultFromProgress", "Dashboard preserves ADM import counters if finish returns a warning");
  checkIncludes("components/onboarding/dashboard.tsx", "mergeActiveAdmImportJobIntoBulkResult", "Dashboard reattaches active backend ADM jobs to the import result panel");
  checkIncludes("components/onboarding/dashboard.tsx", "syncStatusActiveAdmImportJob", "Dashboard prefers active backend ADM jobs over stale failed import attempts");
  checkIncludes("components/onboarding/dashboard.tsx", "Files Processing", "Dashboard separates processing ADM jobs from failed imports");
  checkIncludes("components/onboarding/dashboard.tsx", "Continue Import", "Dashboard can resume existing ADM import jobs");
  checkIncludes("functions/_lib/adm-sync.ts", "validateAdmCursorForLines", "ADM cursor hash validation is implemented");
}

function printReport() {
  const icons: Record<CheckStatus, string> = {
    pass: "✅ PASS",
    warn: "⚠️ WARN",
    fail: "❌ FAIL",
  };
  console.log("\nDZN Network System Audit");
  console.log("========================");
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

  console.log("\nRecommended next fixes");
  console.log("----------------------");
  if (failed > 0) {
    for (const check of checks.filter((item) => item.status === "fail")) {
      console.log(`- Fix: ${check.title} - ${check.detail}`);
    }
  } else if (warnings > 0) {
    console.log("- Review warnings above, especially missing local env vars or Cloudflare-only secrets.");
  } else {
    console.log("- No immediate wiring fixes detected by the source audit.");
  }

  if (failed > 0) process.exitCode = 1;
}

auditEnvironment();
auditBillingPlans();
auditDiscordConfig();
auditCronConfig();
auditSyncEndpoints();
auditDatabaseMigrations();
auditDashboardStructure();
auditDiscordAutoPosts();
auditAdmSyncWiring();
auditPackageCommands();
printReport();
