import { makeReport, pass, skip, fail, writeReport, type AutoDevCheck } from "./lib";
import { pathToFileURL } from "node:url";

const token = process.env.GITHUB_TOKEN || "";
const repository = process.env.GITHUB_REPOSITORY || "";

export const REQUIRED_SAFE_LABELS = ["autodev", "adm-tracking", "autodev-safe-fix", "low-risk"];
export const BLOCKED_SAFE_LABELS = [
  "billing",
  "auth",
  "stripe",
  "discord-oauth",
  "account-management",
  "subscriptions",
  "server-settings",
  "events-unrelated",
  "high-risk",
  "needs-human-review",
  "database-destructive",
  "token-encryption",
];

export const BODY_KEYWORD_BLOCKLIST = [
  "stripe",
  "billing",
  "checkout",
  "subscription",
  "invoice",
  "discord oauth",
  "session",
  "login",
  "password",
  "token_encryption_key",
  "secret",
  "delete from",
  "drop table",
  "truncate",
  "player_stats",
  "reset stats",
  "event matchmaking",
  "ctf",
  "tournament",
];

export type CandidateIssue = {
  number: number;
  title: string;
  body?: string | null;
  labels: Array<string | { name?: string | null }>;
};

export function isSafeAdmIssue(issue: CandidateIssue) {
  const labels = normalizeLabels(issue.labels);
  const missing = REQUIRED_SAFE_LABELS.filter((label) => !labels.has(label));
  if (missing.length) return { ok: false, reason: `missing required labels: ${missing.join(", ")}` };

  const blockedLabel = BLOCKED_SAFE_LABELS.find((label) => labels.has(label));
  if (blockedLabel) return { ok: false, reason: `blocked label: ${blockedLabel}` };

  const searchable = `${issue.title}\n${issue.body ?? ""}`.toLowerCase();
  const blockedKeyword = BODY_KEYWORD_BLOCKLIST.find((keyword) => searchable.includes(keyword));
  if (blockedKeyword) return { ok: false, reason: `blocked body keyword: ${blockedKeyword}` };

  return { ok: true, reason: "safe ADM tracking issue" };
}

async function main() {
  const checks: AutoDevCheck[] = [];
  if (!token || !repository) {
    checks.push(skip("pick safe issue", "GITHUB_TOKEN and GITHUB_REPOSITORY are required to query issues. No issue was selected."));
    writeReport("pick-safe-issue", makeReport("pick-safe-issue", checks, ["Run inside GitHub Actions with issue read permissions."]));
    return;
  }

  const [owner, repo] = repository.split("/");
  const query = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open label:autodev label:adm-tracking label:autodev-safe-fix label:low-risk`);
  const result = await github(`/search/issues?q=${query}`) as { items?: CandidateIssue[] };
  const candidates = result.items ?? [];

  for (const issue of candidates) {
    const safe = isSafeAdmIssue(issue);
    if (safe.ok) {
      checks.push(pass("selected issue", `Selected ADM AutoDev issue #${issue.number}.`, { number: issue.number, title: issue.title }));
      writeReport("pick-safe-issue", makeReport("pick-safe-issue", checks));
      console.log(`AUTODEV_ISSUE_NUMBER=${issue.number}`);
      return;
    }
    checks.push(skip(`issue #${issue.number}`, safe.reason, { title: issue.title }));
  }

  checks.push(skip("selected issue", "No safe ADM-only issue matched the label and body gates."));
  writeReport("pick-safe-issue", makeReport("pick-safe-issue", checks));
}

function normalizeLabels(labels: CandidateIssue["labels"]) {
  return new Set(labels.map((label) => (typeof label === "string" ? label : label.name ?? "").toLowerCase()).filter(Boolean));
}

async function github(endpoint: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...init,
    headers: {
      "authorization": `Bearer ${token}`,
      "accept": "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const report = makeReport("pick-safe-issue", [fail("pick safe issue exception", error instanceof Error ? error.message : String(error), undefined, "high")]);
    writeReport("pick-safe-issue", report);
    process.exit(1);
  });
}
