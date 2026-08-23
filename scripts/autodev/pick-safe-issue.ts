import { makeReport, pass, skip, fail, writeReport, type AutoDevCheck } from "./lib";
import { pathToFileURL } from "node:url";

const token = process.env.GITHUB_TOKEN || "";
const repository = process.env.GITHUB_REPOSITORY || "";

export const REQUIRED_SAFE_LABELS = ["autodev", "autodev-safe-fix", "low-risk"];
export const BLOCKED_SAFE_LABELS = ["blocked", "high-risk", "medium-risk", "needs-human-review", "security", "billing", "auth", "stripe", "discord-oauth", "account-management", "subscriptions", "server-settings-sensitive", "database-destructive", "token-encryption", "worker-cron-high-risk", "production-mutation"];
export const HARD_BLOCK_PATTERNS: Array<[RegExp, string]> = [
  [/\bDROP\s+TABLE\b/i, "destructive DROP TABLE request"],
  [/\bTRUNCATE\b/i, "destructive TRUNCATE request"],
  [/\bDELETE\s+FROM\s+(player_profiles|kills|kill_events|deaths|player_events|events|competitive_events|sessions|subscriptions|server_subscriptions|servers|linked_servers)\b/i, "protected data delete request"],
  [/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats\b/i, "player_stats creation request"],
  [/\bcreate\b[\s\S]{0,40}\bplayer_stats\b/i, "player_stats creation request"],
  [/\b(player_profiles|kills|deaths|events|sessions|subscriptions)\b[\s\S]{0,80}\b(reset|delete|wipe|purge|truncate)\b/i, "protected data reset/delete request"],
  [/\bTOKEN_ENCRYPTION_KEY\b|encrypted_token|token_iv|token_auth_tag/i, "token encryption request"],
  [/\bsecrets\.(DISCORD_BOT_TOKEN|DISCORD_CLIENT_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|SESSION_SECRET|TOKEN_ENCRYPTION_KEY|MOCK_AUTH|MOCK_NITRADO|OPENAI_API_KEY)\b/i, "runtime secret workflow request"],
  [/\bOPENAI_API_KEY\b|openai\/codex-action|sk-proj-|sk-[A-Za-z0-9]/i, "paid OpenAI/Codex GitHub execution request"],
  [/\b(disable|bypass|skip|remove|weaken)\b[\s\S]{0,120}\b(auth|authorization|requireCronSecret|isCronAuthorized|401|403|session)\b/i, "auth weakening request"],
  [/\b(disable|bypass|skip|remove|weaken)\b[\s\S]{0,160}\b(same-category|same category|assertSameServerCategory|assertSameCategoryChallenge|matchmaking)\b/i, "same-category enforcement removal request"],
  [/\bcross-category\b[\s\S]{0,120}\b(allow|allowed|match|matchmaking|compete)\b/i, "cross-category matchmaking request"],
  [/\b(production|prod)\b[\s\S]{0,120}\b(deploy|migration|migrate|delete|refund|stripe|nitrado|discord message|secret)\b/i, "production mutation request"],
];

export type CandidateIssue = {
  number: number;
  title: string;
  body?: string | null;
  labels: Array<string | { name?: string | null }>;
};

export function isSafePlatformIssue(issue: CandidateIssue) {
  const labels = normalizeLabels(issue.labels);
  const missing = REQUIRED_SAFE_LABELS.filter((label) => !labels.has(label));
  if (missing.length) return { ok: false, reason: `missing required labels: ${missing.join(", ")}` };

  const blockedLabel = BLOCKED_SAFE_LABELS.find((label) => labels.has(label));
  if (blockedLabel) return { ok: false, reason: `blocked label: ${blockedLabel}` };

  const blockedSystem = ["system:auth", "system:billing", "system:stripe", "system:nitrado", "system:onboarding", "system:cloudflare-worker", "system:release"].find((label) => labels.has(label));
  if (blockedSystem) return { ok: false, reason: `blocked system label for safe-fix: ${blockedSystem}` };

  const searchable = `${issue.title}\n${issue.body ?? ""}`;
  const hardBlock = HARD_BLOCK_PATTERNS.find(([pattern]) => pattern.test(searchable));
  if (hardBlock) return { ok: false, reason: hardBlock[1] };

  return { ok: true, reason: "safe platform issue" };
}

async function main() {
  const checks: AutoDevCheck[] = [];
  if (!token || !repository) {
    checks.push(skip("pick safe issue", "GITHUB_TOKEN and GITHUB_REPOSITORY are required to query issues. No issue was selected."));
    writeReport("pick-safe-issue", makeReport("pick-safe-issue", checks, ["Run inside GitHub Actions with issue read permissions."]));
    return;
  }
  const [owner, repo] = repository.split("/");
  const query = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open label:autodev label:autodev-safe-fix label:low-risk`);
  const result = await github(`/search/issues?q=${query}`) as { items?: CandidateIssue[] };
  const candidates = result.items ?? [];
  for (const issue of candidates) {
    const safe = isSafePlatformIssue(issue);
    if (safe.ok) {
      checks.push(pass("selected issue", `Selected platform AutoDev issue #${issue.number}.`, { number: issue.number, title: issue.title }));
      writeReport("pick-safe-issue", makeReport("pick-safe-issue", checks));
      console.log(`AUTODEV_ISSUE_NUMBER=${issue.number}`);
      return;
    }
    checks.push(skip(`issue #${issue.number}`, safe.reason, { title: issue.title }));
  }
  checks.push(skip("selected issue", "No safe platform issue matched the label and hard-block gates."));
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
