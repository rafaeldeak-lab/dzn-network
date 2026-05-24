import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type AutoDevMode = "review_only" | "pr_only" | "auto_merge_low_risk" | "production_guarded";
export type RiskLevel = "low" | "medium" | "high";
export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export type AutoDevConfig = {
  mode: AutoDevMode;
  allowDirectMainPush: boolean;
  allowAutoMergeLowRisk: boolean;
  maxFixAttemptsPerRun: number;
  maxRuntimeMinutes: number;
  maxChangedFilesPerRun: number;
  maxTokensHint: string;
  productionUrl: string;
  deployPreviewRequired: boolean;
  watchAdmCycles: boolean;
  watchMinutesAfterDeploy: number;
  riskGates: Record<string, boolean>;
};

export type AutoDevCheck = {
  name: string;
  status: CheckStatus;
  message: string;
  evidence?: unknown;
  risk?: RiskLevel;
};

export type AutoDevReport = {
  ok: boolean;
  generatedAt: string;
  reportName: string;
  riskLevel: RiskLevel;
  summary: string;
  checks: AutoDevCheck[];
  failures: AutoDevCheck[];
  warnings: AutoDevCheck[];
  suggestedNextActions: string[];
};

export const REPORT_DIR = path.join(".autodev", "reports");

export function loadConfig(): AutoDevConfig {
  const raw = readFileSync(path.join(".autodev", "config.json"), "utf8");
  return JSON.parse(raw) as AutoDevConfig;
}

export function ensureReportDir() {
  mkdirSync(REPORT_DIR, { recursive: true });
}

export function writeReport(name: string, report: AutoDevReport | Record<string, unknown>) {
  ensureReportDir();
  const jsonPath = path.join(REPORT_DIR, `${name}.json`);
  const mdPath = path.join(REPORT_DIR, `${name}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, reportToMarkdown(name, report));
}

export function makeReport(name: string, checks: AutoDevCheck[], suggestedNextActions: string[] = []): AutoDevReport {
  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const riskLevel = maxRisk(checks.map((check) => check.risk ?? (check.status === "fail" ? "high" : check.status === "warn" ? "medium" : "low")));
  return {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    reportName: name,
    riskLevel,
    summary: failures.length ? `${failures.length} failure(s), ${warnings.length} warning(s).` : warnings.length ? `${warnings.length} warning(s).` : "All checks passed.",
    checks,
    failures,
    warnings,
    suggestedNextActions,
  };
}

export function pass(name: string, message: string, evidence?: unknown, risk: RiskLevel = "low"): AutoDevCheck {
  return { name, status: "pass", message, evidence, risk };
}

export function warn(name: string, message: string, evidence?: unknown, risk: RiskLevel = "medium"): AutoDevCheck {
  return { name, status: "warn", message, evidence, risk };
}

export function fail(name: string, message: string, evidence?: unknown, risk: RiskLevel = "high"): AutoDevCheck {
  return { name, status: "fail", message, evidence, risk };
}

export function skip(name: string, message: string, evidence?: unknown, risk: RiskLevel = "low"): AutoDevCheck {
  return { name, status: "skip", message, evidence, risk };
}

export function readText(filePath: string) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

export function fileExists(filePath: string) {
  return existsSync(filePath) && statSync(filePath).isFile();
}

export function dirExists(filePath: string) {
  return existsSync(filePath) && statSync(filePath).isDirectory();
}

export function listFiles(root: string, predicate: (filePath: string) => boolean = () => true): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === ".git" || entry === ".next" || entry === "out") continue;
      const next = path.join(current, entry);
      const stat = statSync(next);
      if (stat.isDirectory()) walk(next);
      else if (predicate(next)) out.push(next.replace(/\\/g, "/"));
    }
  };
  walk(root);
  return out;
}

export function runCommand(command: string, args: string[], timeoutMs = 120000) {
  const startedAt = Date.now();
  const useCmdWrapper = process.platform === "win32" && (command === "npm" || command === "npx");
  const executable = useCmdWrapper ? "cmd.exe" : command;
  const spawnArgs = useCmdWrapper
    ? ["/d", "/s", "/c", [command, ...args].map((part) => (/^[A-Za-z0-9:_./-]+$/.test(part) ? part : `"${part.replace(/"/g, '\\"')}"`)).join(" ")]
    : args;
  const result = spawnSync(executable, spawnArgs, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 10,
  });
  return {
    command: [command, ...args].join(" "),
    status: result.status ?? 1,
    signal: result.signal,
    durationMs: Date.now() - startedAt,
    stdout: redactSecrets(result.stdout ?? ""),
    stderr: redactSecrets(result.stderr ?? ""),
    error: result.error ? redactSecrets(String(result.error)) : undefined,
    ok: result.status === 0,
  };
}

export function gitChangedFiles() {
  try {
    const output = execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" });
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function maxRisk(levels: RiskLevel[]): RiskLevel {
  if (levels.includes("high")) return "high";
  if (levels.includes("medium")) return "medium";
  return "low";
}

export function redactSecrets(input: string) {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]")
    .replace(/(x-(?:dzn-)?cron-secret|x-sync-cron-secret|x-cron-secret|authorization):\s*[^\s]+/gi, "$1: [redacted]")
    .replace(/(token|access_token|signature|sig|secret|key)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[redacted.jwt]")
    .slice(0, 20000);
}

export function reportToMarkdown(name: string, report: AutoDevReport | Record<string, unknown>) {
  const typed = report as AutoDevReport;
  if (Array.isArray(typed.checks)) {
    const lines = [
      `# ${name}`,
      "",
      `Generated: ${typed.generatedAt}`,
      `Result: ${typed.ok ? "PASS" : "FAIL"}`,
      `Risk: ${typed.riskLevel}`,
      "",
      `## Summary`,
      "",
      typed.summary,
      "",
      "## Checks",
      "",
      ...typed.checks.map((check) => `- **${check.status.toUpperCase()}** ${check.name}: ${check.message}`),
      "",
      "## Suggested Next Actions",
      "",
      ...(typed.suggestedNextActions.length ? typed.suggestedNextActions.map((action) => `- ${action}`) : ["- No action required."]),
      "",
    ];
    return `${lines.join("\n")}\n`;
  }
  return `# ${name}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}
