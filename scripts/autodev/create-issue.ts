import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeReport, pass, skip, fail, writeReport, redactSecrets, type AutoDevReport, type RiskLevel } from "./lib";
import type { RiskClassification, SystemCategory } from "./risk-classifier";

const token = process.env.GITHUB_TOKEN || "";
const repository = process.env.GITHUB_REPOSITORY || "";
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;

async function main() {
  const reports = loadReports();
  const failingReports = reports.filter((report) => report.ok === false || report.failures?.length);
  const checks = [];

  if (!failingReports.length) {
    checks.push(skip("create issue", "No failing AutoDev reports found."));
    const report = makeReport("create-issue", checks);
    writeReport("create-issue", report);
    process.exit(0);
  }

  if (!token || !repository) {
    checks.push(fail("github token", "GITHUB_TOKEN and GITHUB_REPOSITORY are required to create issues.", { repositoryConfigured: Boolean(repository), tokenConfigured: Boolean(token) }, "high"));
    const report = makeReport("create-issue", checks, ["Configure GITHUB_TOKEN permissions for issue creation in GitHub Actions."]);
    writeReport("create-issue", report);
    process.exit(1);
  }

  const [owner, repo] = repository.split("/");
  const context = buildIssueContext(failingReports);
  const primary = failingReports[0];
  const signature = makeSignature(failingReports);
  const title = `[AutoDev][${context.system.toUpperCase()}][${context.risk.toUpperCase()}] ${primary.reportName}: ${primary.summary}`.slice(0, 180);
  const labels = buildLabels(context);
  const body = redactSecrets([
    `Detected at: ${new Date().toISOString()}`,
    `Affected system: ${context.system}`,
    `Risk level: ${context.risk}`,
    `AutoDev scope: dzn_platform`,
    `Suggested validation profile: ${context.validationProfile}`,
    `Autonomous branch implementation allowed: ${context.policy.allowedToImplementInBranch ? "yes" : "no"}`,
    `Autonomous PR creation allowed: ${context.policy.allowedToOpenPR ? "yes" : "no"}`,
    `Human review required: ${context.policy.requiresHumanReview ? "yes" : "no"}`,
    `Production action prohibited: ${context.policy.allowedToDeployProduction ? "no" : "yes"}`,
    `Signature: \`${signature}\``,
    runUrl ? `Workflow run: ${runUrl}` : null,
    "",
    "## Evidence",
    "",
    ...failingReports.flatMap((report) => [
      `### ${report.reportName}`,
      `Summary: ${report.summary}`,
      ...report.failures.slice(0, 10).map((item) => `- ${item.name}: ${item.message}`),
      "",
    ]),
    "## Suggested Fix",
    "",
    ...Array.from(new Set(failingReports.flatMap((report) => report.suggestedNextActions))).map((action) => `- ${action}`),
    "",
    "## Automation Policy",
    "",
    `- Investigate: ${context.policy.allowedToInvestigate ? "allowed" : "not allowed"}`,
    `- Implement in branch: ${context.policy.allowedToImplementInBranch ? "allowed" : "not allowed"}`,
    `- Open PR: ${context.policy.allowedToOpenPR ? "allowed" : "not allowed"}`,
    `- Auto-merge: ${context.policy.allowedToAutoMerge ? "allowed" : "disabled"}`,
    `- Production deploy/mutation: ${context.policy.allowedToDeployProduction ? "allowed" : "disabled"}`,
    "",
    "ADM findings remain ADM-labelled and routed to ADM specialist checks. Non-ADM DZN systems are classified by system/risk instead of being treated as out-of-scope by default.",
  ].filter(Boolean).join("\n"));

  const existing = await findExistingIssue(owner, repo, signature);
  if (existing) {
    await github(`/repos/${owner}/${repo}/issues/${existing.number}`, { method: "PATCH", body: JSON.stringify({ title, body, labels }) });
    checks.push(pass("update issue", `Updated existing AutoDev issue #${existing.number}.`, { number: existing.number }));
  } else {
    const created = await github(`/repos/${owner}/${repo}/issues`, { method: "POST", body: JSON.stringify({ title, body, labels }) }) as { number?: number };
    checks.push(pass("create issue", `Created AutoDev issue #${created.number ?? "unknown"}.`, created));
  }

  const report = makeReport("create-issue", checks);
  writeReport("create-issue", report);
}

async function findExistingIssue(owner: string, repo: string, signature: string) {
  const query = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open label:autodev "${signature}"`);
  const result = await github(`/search/issues?q=${query}`) as { items?: Array<{ number: number; body?: string }> };
  return result.items?.[0] ?? null;
}

async function github(endpoint: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...init,
    headers: {
      "authorization": `Bearer ${token}`,
      "accept": "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

function loadReports(): AutoDevReport[] {
  const dir = path.join(".autodev", "reports");
  if (!existsSync(dir)) return [];
  return ["audit", "quality-gate", "production-smoke", "adm-cycle-watch", "risk-classifier", "pick-safe-issue"]
    .map((name) => path.join(dir, `${name}.json`))
    .filter(existsSync)
    .map((file) => JSON.parse(readFileSync(file, "utf8")) as AutoDevReport);
}

function makeSignature(reports: AutoDevReport[]) {
  return reports.map((report) => `${report.reportName}:${report.failures?.map((failure) => failure.name).join("|")}`).join(";").replace(/[^a-zA-Z0-9:|;._-]/g, "_").slice(0, 180);
}

type IssueContext = {
  system: SystemCategory;
  risk: RiskLevel;
  validationProfile: string;
  admScoped: boolean;
  policy: {
    allowedToInvestigate: boolean;
    allowedToImplementInBranch: boolean;
    allowedToOpenPR: boolean;
    allowedToAutoMerge: boolean;
    allowedToDeployProduction: boolean;
    requiresHumanReview: boolean;
  };
};

function buildIssueContext(reports: AutoDevReport[]): IssueContext {
  const classifications = reports.flatMap(extractClassifications);
  const risk = reports.some((report) => report.riskLevel === "blocked") || classifications.some((item) => item.risk === "blocked") ? "blocked"
    : reports.some((report) => report.riskLevel === "high") || classifications.some((item) => item.risk === "high") ? "high"
      : reports.some((report) => report.riskLevel === "medium") || classifications.some((item) => item.risk === "medium") ? "medium"
        : "low";
  const system = inferSystem(reports, classifications);
  const policy = classifications.find((item) => item.risk === risk)?.automationPolicy ?? defaultPolicy(risk);
  const validationProfile = classifications.find((item) => item.system === system)?.suggestedValidationProfile
    ?? (system === "adm" || system === "nitrado" ? "nitrado-adm" : system === "github-actions" ? "github-workflows" : system);
  return { system, risk, validationProfile, admScoped: classifications.some((item) => item.admRelated) || isAdmTrackingReportText(reports), policy };
}

function extractClassifications(report: AutoDevReport): RiskClassification[] {
  const maybe = report as AutoDevReport & { classifications?: RiskClassification[] };
  if (Array.isArray(maybe.classifications)) return maybe.classifications;
  return report.checks.flatMap((check) => {
    const evidence = check.evidence as { classifications?: RiskClassification[] } | RiskClassification | undefined;
    if (!evidence || typeof evidence !== "object") return [];
    if (evidence && "classifications" in evidence && Array.isArray(evidence.classifications)) return evidence.classifications;
    if (evidence && "system" in evidence && "risk" in evidence) return [evidence as RiskClassification];
    return [];
  });
}

function inferSystem(reports: AutoDevReport[], classifications: RiskClassification[]): SystemCategory {
  const priority: SystemCategory[] = ["auth", "stripe", "billing", "nitrado", "adm", "cloudflare-worker", "github-actions", "events", "owner-api", "public-api", "autodev", "database", "ui", "docs", "tests"];
  for (const system of priority) if (classifications.some((item) => item.system === system)) return system;
  const text = reports.map((report) => `${report.reportName}\n${report.summary}\n${report.failures?.map((failure) => `${failure.name} ${failure.message}`).join("\n")}`).join("\n");
  if (/\b(adm|nitrado|sync health|worker|file read|import job|cycle watch|protected endpoint)\b/i.test(text)) return "adm";
  if (/\bstripe\b/i.test(text)) return "stripe";
  if (/\bbilling|subscription|plan\b/i.test(text)) return "billing";
  if (/\bauth|oauth|session|401|403\b/i.test(text)) return "auth";
  if (/\bevent|tournament|matchmaking|season|server wars\b/i.test(text)) return "events";
  if (/\bworkflow|github actions\b/i.test(text)) return "github-actions";
  return "unknown";
}

function isAdmTrackingReportText(reports: AutoDevReport[]) {
  const text = reports.map((report) => `${report.reportName}\n${report.summary}\n${report.failures?.map((failure) => `${failure.name} ${failure.message}`).join("\n")}`).join("\n");
  return /\b(adm|nitrado|sync health|worker heartbeat|file read|import job|cycle watch|protected endpoint)\b/i.test(text);
}

function buildLabels(context: IssueContext) {
  const riskLabel = context.risk === "blocked" ? "blocked" : `${context.risk}-risk`;
  const labels = ["autodev", `system:${context.system}`, riskLabel];
  if (context.admScoped) labels.push("adm-tracking");
  if (context.policy.allowedToImplementInBranch && context.risk === "low") labels.push("autodev-safe-fix");
  if (context.policy.requiresHumanReview || context.risk !== "low") labels.push("needs-human-review");
  return Array.from(new Set(labels));
}

function defaultPolicy(risk: RiskLevel): IssueContext["policy"] {
  if (risk === "low") return { allowedToInvestigate: true, allowedToImplementInBranch: true, allowedToOpenPR: true, allowedToAutoMerge: false, allowedToDeployProduction: false, requiresHumanReview: false };
  if (risk === "blocked") return { allowedToInvestigate: true, allowedToImplementInBranch: false, allowedToOpenPR: false, allowedToAutoMerge: false, allowedToDeployProduction: false, requiresHumanReview: true };
  return { allowedToInvestigate: true, allowedToImplementInBranch: true, allowedToOpenPR: true, allowedToAutoMerge: false, allowedToDeployProduction: false, requiresHumanReview: true };
}

main().catch((error) => {
  const report = makeReport("create-issue", [fail("create issue exception", error instanceof Error ? error.message : String(error), undefined, "high")]);
  writeReport("create-issue", report);
  process.exit(1);
});
