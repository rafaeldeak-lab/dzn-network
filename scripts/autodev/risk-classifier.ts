import { pathToFileURL } from "node:url";
import { fail, gitChangedFiles, listFiles, makeReport, maxRisk, pass, readText, warn, writeReport, type AutoDevCheck, type RiskLevel } from "./lib";

export type RiskClassification = {
  file: string;
  risk: RiskLevel;
  reasons: string[];
};

const HIGH_RISK_PATHS = [
  /^functions\/api\/auth\//,
  /^functions\/_lib\/(?:auth|db|discord|stripe|billing|crypto|nitrado|adm-parser|adm-import|server-categories)/,
  /^functions\/api\/billing\//,
  /^functions\/api\/stripe\//,
  /^functions\/api\/events\/.*join/,
  /^workers\/adm-sync-worker\.ts$/,
  /^wrangler(?:\.adm-sync)?\.toml$/,
  /^migrations\//,
  /^\.github\/workflows\//,
];

const MEDIUM_RISK_PATHS = [
  /^functions\/api\//,
  /^components\/onboarding\//,
  /^components\/events\//,
  /^app\/events\//,
  /^scripts\//,
];

const LOW_RISK_PATHS = [
  /^docs\//,
  /^README\.md$/,
  /^AGENTS\.md$/,
  /\.(md|mdx|txt)$/,
  /^components\/.*\.(css|scss)$/,
  /^scripts\/test-/,
];

const HIGH_RISK_CONTENT_PATTERNS = [
  /TOKEN_ENCRYPTION_KEY/,
  /stripe/i,
  /subscription/i,
  /session/i,
  /Discord OAuth/i,
  /requireServerOwnerOrDznAdmin/,
  /same-category|CATEGORY_MISMATCH|assertSameServerCategory/i,
  /parseAdm|processAdm|writeKill|player_profiles/i,
];

export function classifyPath(file: string, content = readText(file)): RiskClassification {
  const normalized = file.replace(/\\/g, "/");
  const reasons: string[] = [];

  if (LOW_RISK_PATHS.some((pattern) => pattern.test(normalized))) reasons.push("low-risk path");
  if (MEDIUM_RISK_PATHS.some((pattern) => pattern.test(normalized))) reasons.push("medium-risk path");
  if (HIGH_RISK_PATHS.some((pattern) => pattern.test(normalized))) reasons.push("high-risk path");
  if (HIGH_RISK_CONTENT_PATTERNS.some((pattern) => pattern.test(content))) reasons.push("high-risk content marker");

  const destructive = detectDestructiveMigration(content, normalized);
  if (destructive.length) reasons.push(...destructive);

  const risk: RiskLevel = reasons.some((reason) => reason.includes("destructive") || reason.includes("player_stats") || reason.includes("high-risk")) ? "high"
    : reasons.some((reason) => reason.includes("medium-risk")) ? "medium"
      : "low";

  return { file: normalized, risk, reasons: reasons.length ? reasons : ["default low-risk classification"] };
}

export function classifyChangedFiles(files: string[]) {
  return files.map((file) => classifyPath(file));
}

export function detectDestructiveMigration(content: string, file = "") {
  const findings: string[] = [];
  const text = content.replace(/--.*$/gm, "");
  const normalizedFile = file.replace(/\\/g, "/");
  const isMigration = normalizedFile.startsWith("migrations/") || /\.sql$/i.test(normalizedFile);
  if (!isMigration && !/CREATE\s+TABLE|DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE/i.test(text)) return findings;
  if (/DROP\s+TABLE/i.test(text)) findings.push("destructive DROP TABLE detected");
  if (/TRUNCATE\b/i.test(text)) findings.push("destructive TRUNCATE detected");
  if (/DELETE\s+FROM\s+(player_profiles|kills|kill_events|player_events|subscriptions|server_subscriptions|servers|linked_servers|sessions)/i.test(text)) findings.push("destructive DELETE FROM protected table detected");
  if (/ALTER\s+TABLE[\s\S]{0,160}\bDROP\s+COLUMN\b/i.test(text)) findings.push("destructive ALTER TABLE DROP COLUMN detected");
  if (/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats\b/i.test(text)) findings.push("player_stats table creation detected");
  if (/UPDATE\s+player_profiles[\s\S]{0,180}\b(kills|deaths|joins|disconnects|score)\s*=\s*0\b/i.test(text)) findings.push("destructive stat reset logic detected");
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

function runCli() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : gitChangedFiles();
  const targets = files.length ? files : listFiles(".", (file) => /\.(ts|tsx|js|jsx|sql|yml|yaml|json|md|toml)$/i.test(file));
  const classifications = classifyChangedFiles(targets);
  const checks: AutoDevCheck[] = classifications.map((item) => {
    const message = `${item.risk.toUpperCase()} risk: ${item.reasons.join(", ")}`;
    if (item.risk === "high") return fail(item.file, message, item, "high");
    if (item.risk === "medium") return warn(item.file, message, item, "medium");
    return pass(item.file, message, item, "low");
  });
  const report = makeReport("risk-classifier", checks, [
    "Low-risk changes may be eligible for auto-merge only when explicitly enabled.",
    "Medium and high-risk changes require human/Codex review.",
  ]);
  report.riskLevel = maxRisk(classifications.map((item) => item.risk));
  writeReport("risk-classifier", { ...report, classifications });
  if (report.riskLevel === "high") process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli();
}
