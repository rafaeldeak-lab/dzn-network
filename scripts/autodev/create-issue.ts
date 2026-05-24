import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeReport, pass, skip, fail, writeReport, type AutoDevReport } from "./lib";

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
  const primary = failingReports[0];
  const signature = makeSignature(failingReports);
  const title = `[AutoDev] ${primary.reportName}: ${primary.summary}`.slice(0, 180);
  const body = [
    `Detected at: ${new Date().toISOString()}`,
    `Affected system: ${primary.reportName}`,
    `Risk level: ${primary.riskLevel}`,
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
    "## Safety Classification",
    "",
    primary.riskLevel === "high" ? "High-risk. Human/Codex review required. Do not auto-merge." : primary.riskLevel === "medium" ? "Medium-risk. Create PR only." : "Low-risk if all gates pass.",
  ].filter(Boolean).join("\n");

  const existing = await findExistingIssue(owner, repo, signature);
  if (existing) {
    await github(`/repos/${owner}/${repo}/issues/${existing.number}`, {
      method: "PATCH",
      body: JSON.stringify({ title, body }),
    });
    checks.push(pass("update issue", `Updated existing AutoDev issue #${existing.number}.`, { number: existing.number }));
  } else {
    const labels = ["autodev", primary.riskLevel === "high" ? "high-risk" : primary.riskLevel === "medium" ? "needs-human-review" : "production"];
    const created = await github(`/repos/${owner}/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({ title, body, labels }),
    }) as { number?: number };
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
  return ["audit", "quality-gate", "production-smoke", "adm-cycle-watch", "risk-classifier"]
    .map((name) => path.join(dir, `${name}.json`))
    .filter(existsSync)
    .map((file) => JSON.parse(readFileSync(file, "utf8")) as AutoDevReport);
}

function makeSignature(reports: AutoDevReport[]) {
  return reports
    .map((report) => `${report.reportName}:${report.failures?.map((failure) => failure.name).join("|")}`)
    .join(";")
    .replace(/[^a-zA-Z0-9:|;._-]/g, "_")
    .slice(0, 180);
}

main().catch((error) => {
  const report = makeReport("create-issue", [fail("create issue exception", error instanceof Error ? error.message : String(error), undefined, "high")]);
  writeReport("create-issue", report);
  process.exit(1);
});
