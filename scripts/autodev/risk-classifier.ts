import { pathToFileURL } from "node:url";
import { fail, gitChangedFiles, listFiles, makeReport, maxRisk, pass, readText, warn, writeReport, type AutoDevCheck, type RiskLevel } from "./lib";

export type AutoDevScope = "adm_tracking_only";

export type RiskClassification = {
  scope: AutoDevScope;
  file: string;
  risk: RiskLevel;
  blockedReason?: string;
  changedFiles: string[];
  admRelated: boolean;
  reasons: string[];
};

const ADM_ALLOWED_PATHS = [
  /^functions\/_lib\/(?:adm-sync|nitrado|nitrado-diagnostics)\.ts$/,
  /^functions\/api\/sync\/adm(?:\/|$)/,
  /^functions\/api\/debug\/nitrado-file-read\.ts$/,
  /^functions\/api\/autodev\/adm-health\.ts$/,
  /^functions\/api\/servers\/\[serverId\]\/adm\//,
  /^functions\/api\/servers\/\[serverId\]\/dashboard\/health\.ts$/,
  /^workers\/adm-sync-worker\.ts$/,
  /^wrangler\.adm-sync\.toml$/,
  /^components\/onboarding\/(?:dashboard|types)\.tsx?$/,
  /^scripts\/autodev\//,
  /^scripts\/test-(?:nitrado-file-read-diagnostics|auto-sync-dashboard(?:-ui)?|autodev-system|autodev-codex-pipeline)\.ts$/,
  /^docs\/(?:ADM_SYNC_PLAN|AUTOMATION_SETUP|SYNC_SYSTEM_MAP|SECRETS_MATRIX|CODEX_AUTODEV)\.md$/,
  /^AGENTS\.md$/,
  /^\.autodev\/config\.json$/,
  /^\.github\/workflows\/(?:dzn-adm-cycle-watch|dzn-autodev-audit|dzn-post-deploy-verify|dzn-adm-sync|dzn-nitrado-diagnostics|dzn-codex-safe-fix)\.ya?ml$/,
  /^package\.json$/,
];

const HARD_BLOCKED_PATHS = [
  /^functions\/api\/auth\//,
  /^functions\/api\/billing\//,
  /^functions\/api\/create-checkout/,
  /^functions\/api\/my-plan/,
  /^functions\/api\/stripe/,
  /^functions\/api\/webhooks\/stripe/,
  /^functions\/api\/events\//,
  /^functions\/api\/servers\/\[serverId\]\/ctf\//,
  /^functions\/api\/onboarding\/save\.ts$/,
  /^functions\/_lib\/(?:billing|stripe|discord|auth|session)/,
  /^components\/billing\//,
  /^components\/events\//,
  /^app\/events\//,
  /^app\/pricing\//,
  /^app\/login\//,
  /^migrations\/.*(?:stripe|billing|subscription|auth|discord|player_stats).*\.sql$/i,
];

const OUT_OF_SCOPE_CONTENT = [
  /\bstripe\b/i,
  /\bbilling\b/i,
  /\bcheckout\b/i,
  /\bsubscription\b/i,
  /\binvoice\b/i,
  /discord\s*oauth/i,
  /\bsession\b/i,
  /\blogin\b/i,
  /\bevents?\/tournaments?\b/i,
  /event matchmaking/i,
];

const HIGH_RISK_ADM_CONTENT = [
  /TOKEN_ENCRYPTION_KEY/,
  /decryptToken|encryptToken/,
  /INSERT\s+INTO\s+player_profiles|UPDATE\s+player_profiles|DELETE\s+FROM\s+player_profiles/i,
  /parseAdm|processAdm|writeKill|kill_events|player_events/i,
  /lock|lease|cursor|dedupe/i,
];

const MEDIUM_RISK_ADM_CONTENT = [
  /retry|backoff|next_retry_at/i,
  /NITRADO_|FETCH_|WORKER_SUBREQUEST_LIMIT/i,
  /adm_sync_state|adm_sync_file_state|nitrado_file_read_attempts|adm_import_jobs/i,
  /crons\s*=/i,
];

const LOW_RISK_ADM_PATHS = [
  /^docs\//,
  /^AGENTS\.md$/,
  /^scripts\/test-/,
  /^scripts\/autodev\//,
  /^\.autodev\/config\.json$/,
  /^\.github\/workflows\//,
];

const ADM_MIGRATION_RE = /(?:\badm_|\bnitrado_file_read_|\bsync_runs\b|\bautomation_cron_runs\b)/i;

export function classifyPath(file: string, content = readText(file)): RiskClassification {
  const normalized = normalizePath(file);
  const reasons: string[] = [];
  const destructive = /^scripts\/test-/.test(normalized) ? [] : detectDestructiveMigration(content, normalized);
  if (destructive.length) {
    return blocked(normalized, `destructive or forbidden migration/content: ${destructive.join("; ")}`, destructive);
  }

  const migrationRisk = classifyMigrationScope(normalized, content);
  if (migrationRisk) return migrationRisk;

  if (HARD_BLOCKED_PATHS.some((pattern) => pattern.test(normalized))) {
    return blocked(normalized, "file is outside ADM tracking automation scope");
  }

  if (OUT_OF_SCOPE_CONTENT.some((pattern) => pattern.test(content)) && !isAdmAllowedPath(normalized)) {
    return blocked(normalized, "content appears to target billing/auth/accounts/events or another non-ADM system");
  }

  const admRelated = isAdmRelated(normalized, content);
  if (!admRelated || !isAdmAllowedPath(normalized)) {
    return blocked(normalized, "AutoDev scope is adm_tracking_only and this file is not in the ADM allowlist");
  }

  const isTestPath = /^scripts\/test-/.test(normalized);
  reasons.push("ADM tracking allowlist");
  if (LOW_RISK_ADM_PATHS.some((pattern) => pattern.test(normalized))) reasons.push("low-risk ADM docs/tests/workflow path");
  if (!isTestPath && HIGH_RISK_ADM_CONTENT.some((pattern) => pattern.test(content))) reasons.push("high-risk ADM content marker");
  if (!isTestPath && MEDIUM_RISK_ADM_CONTENT.some((pattern) => pattern.test(content))) reasons.push("medium-risk ADM automation marker");

  const risk: RiskLevel = reasons.some((reason) => reason.includes("high-risk")) ? "high"
    : reasons.some((reason) => reason.includes("low-risk ADM docs/tests/workflow path")) ? "low"
      : reasons.some((reason) => reason.includes("medium-risk")) ? "medium"
        : "low";

  return {
    scope: "adm_tracking_only",
    file: normalized,
    risk,
    changedFiles: [normalized],
    admRelated,
    reasons: reasons.length ? reasons : ["ADM-only default low-risk classification"],
  };
}

export function classifyChangedFiles(files: string[]) {
  return files.map((file) => classifyPath(file));
}

export function detectDestructiveMigration(content: string, file = "") {
  const findings: string[] = [];
  const text = content.replace(/--.*$/gm, "");
  const normalizedFile = normalizePath(file);
  const isMigration = normalizedFile.startsWith("migrations/") || /\.sql$/i.test(normalizedFile);
  if (!isMigration && !/CREATE\s+TABLE|DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|UPDATE\s+player_profiles/i.test(text)) return findings;
  if (/DROP\s+TABLE/i.test(text)) findings.push("destructive DROP TABLE detected");
  if (/TRUNCATE\b/i.test(text)) findings.push("destructive TRUNCATE detected");
  if (/DELETE\s+FROM\s+(player_profiles|kills|kill_events|player_events|events|sessions|subscriptions|server_subscriptions|servers|linked_servers)/i.test(text)) findings.push("destructive DELETE FROM protected table detected");
  if (/ALTER\s+TABLE[\s\S]{0,160}\bDROP\s+COLUMN\b/i.test(text)) findings.push("destructive ALTER TABLE DROP COLUMN detected");
  if (/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats\b/i.test(text)) findings.push("player_stats table creation detected");
  if (/UPDATE\s+player_profiles[\s\S]{0,220}\b(kills|deaths|joins|disconnects|score|longest_kill_distance|highest_killstreak)\s*=\s*0\b/i.test(text)) findings.push("destructive player_profiles stat reset logic detected");
  return findings;
}

export function classifyRecoverableProductionStatus(status: string | null | undefined) {
  return new Set([
    "no_new_adm",
    "waiting_for_nitrado",
    "latest_adm_unreadable",
    "nitrado_upstream_down",
    "nitrado_rate_limited",
    "partial_budget_reached",
    "file_missing_or_rotated",
    "completed_no_new_events",
    "duplicate_skipped",
  ]).has(String(status ?? "").toLowerCase());
}

export function isAdmOnlyAllowedFile(file: string, content = readText(file)) {
  const result = classifyPath(file, content);
  return result.risk !== "blocked";
}

function classifyMigrationScope(file: string, content: string): RiskClassification | null {
  if (!file.startsWith("migrations/") && !/\.sql$/i.test(file)) return null;
  if (!ADM_MIGRATION_RE.test(content)) return blocked(file, "migration is not ADM-related");
  return {
    scope: "adm_tracking_only",
    file,
    risk: "medium",
    changedFiles: [file],
    admRelated: true,
    reasons: ["additive ADM-only migration"],
  };
}

function blocked(file: string, blockedReason: string, reasons: string[] = [blockedReason]): RiskClassification {
  return {
    scope: "adm_tracking_only",
    file,
    risk: "blocked",
    blockedReason,
    changedFiles: [file],
    admRelated: isAdmRelated(file, readText(file)),
    reasons,
  };
}

function isAdmAllowedPath(file: string) {
  return ADM_ALLOWED_PATHS.some((pattern) => pattern.test(file));
}

function isAdmRelated(file: string, content: string) {
  return isAdmAllowedPath(file) || /\b(adm|nitrado|sync health|sync_state|sync-runs|worker heartbeat|auto sync|file read)\b/i.test(`${file}\n${content}`);
}

function normalizePath(file: string) {
  return file.replace(/\\/g, "/");
}

function runCli() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : gitChangedFiles();
  const targets = files.length ? files : listFiles(".", (file) => /\.(ts|tsx|js|jsx|sql|yml|yaml|json|md|toml)$/i.test(file));
  const classifications = classifyChangedFiles(targets);
  const checks: AutoDevCheck[] = classifications.map((item) => {
    const message = `${item.risk.toUpperCase()} risk: ${item.blockedReason ?? item.reasons.join(", ")}`;
    if (item.risk === "blocked") return fail(item.file, message, item, "blocked");
    if (item.risk === "high") return fail(item.file, message, item, "high");
    if (item.risk === "medium") return warn(item.file, message, item, "medium");
    return pass(item.file, message, item, "low");
  });
  const report = makeReport("risk-classifier", checks, [
    "AutoDev scope is ADM tracking only.",
    "Blocked and high-risk changes require human review and must not be auto-fixed.",
  ]);
  report.riskLevel = maxRisk(classifications.map((item) => item.risk));
  writeReport("risk-classifier", { ...report, scope: "adm_tracking_only", classifications });
  if (report.riskLevel === "blocked" || report.riskLevel === "high") process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli();
}
