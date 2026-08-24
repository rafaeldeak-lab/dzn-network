import { makeReport, pass, skip, fail, writeReport, type AutoDevCheck } from "./lib";
import { pathToFileURL } from "node:url";

const token = process.env.GITHUB_TOKEN || "";
const repository = process.env.GITHUB_REPOSITORY || "";

export const REQUIRED_SAFE_LABELS = ["autodev", "autodev-safe-fix", "low-risk"];
export const BLOCKED_SAFE_LABELS = ["blocked", "high-risk", "medium-risk", "needs-human-review", "security", "billing", "auth", "stripe", "discord-oauth", "account-management", "subscriptions", "server-settings-sensitive", "database-destructive", "token-encryption", "worker-cron-high-risk", "production-mutation", "ai-spend", "metered-ai", "paid-ai", "openai-api", "codex-paid"];
const METERED_AI_PROVIDER_SOURCE = String.raw`\b(?:openai|anthropic|claude|gemini|google\s+(?:generative\s+)?ai|vertex\s+ai|mistral|cohere|perplexity|openrouter|together(?:\s+ai)?|fireworks(?:\s+ai)?|groq|deepseek|xai|replicate|hugging\s*face|bedrock)\b`;
const METERED_AI_WIRING_SOURCE = String.raw`(?:api[_ -]?key|secret|token|credential|provider|sdk|client|runner|action|autonomous|unattended|execution)`;
export const HARD_BLOCK_PATTERNS: Array<[RegExp, string]> = [
  [/\bDROP\s+TABLE\b/i, "destructive DROP TABLE request"],
  [/\bTRUNCATE\b/i, "destructive TRUNCATE request"],
  [/\bDELETE\s+FROM\s+(player_profiles|kills|kill_events|deaths|player_events|events|competitive_events|sessions|subscriptions|server_subscriptions|servers|linked_servers)\b/i, "protected data delete request"],
  [/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats\b/i, "player_stats creation request"],
  [/\bcreate\b[\s\S]{0,40}\bplayer_stats\b/i, "player_stats creation request"],
  [/\b(player_profiles|kills|deaths|events|sessions|subscriptions)\b[\s\S]{0,80}\b(reset|delete|wipe|purge|truncate)\b/i, "protected data reset/delete request"],
  [/\bTOKEN_ENCRYPTION_KEY\b|encrypted_token|token_iv|token_auth_tag/i, "token encryption request"],
  [/\bsecrets\.(DISCORD_BOT_TOKEN|DISCORD_CLIENT_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|SESSION_SECRET|TOKEN_ENCRYPTION_KEY|MOCK_AUTH|MOCK_NITRADO|OPENAI_API_KEY)\b/i, "runtime secret workflow request"],
  [/\bstripe\s+(?:products?|prices?|webhook(?:_endpoints)?|customers?|subscriptions?)\s+(?:create|update|delete)\b/i, "live Stripe billing mutation request"],
  [/\b(?:curl|fetch|Invoke-RestMethod|Invoke-WebRequest)\b[\s\S]{0,180}\b(?:api\.stripe\.com\/v1\/(?:products|prices|webhook_endpoints|customers|subscriptions)[\s\S]{0,180}\b(?:POST|PUT|PATCH|DELETE)|(?:POST|PUT|PATCH|DELETE)[\s\S]{0,180}\bapi\.stripe\.com\/v1\/(?:products|prices|webhook_endpoints|customers|subscriptions))\b/i, "direct Stripe API mutation request"],
  [/\b(?:npx\s+)?wrangler\s+pages\s+secret\s+put\s+(?:STRIPE_PRICE_STARTER|STRIPE_PRICE_PRO|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET)\b/i, "Stripe production secret mutation request"],
  [/\b(?:enable|activate|turn\s+on|go\s+live)\b[\s\S]{0,100}\blive\s+billing\b[\s\S]{0,140}\b(?:script|workflow|automation|autodev|unattended)\b/i, "unattended live billing activation request"],
  [/\bOPENAI_API_KEY\b|openai\/codex-action|sk-proj-|sk-[A-Za-z0-9]/i, "paid OpenAI/Codex GitHub execution request"],
  [/\b(AZURE_OPENAI_API_KEY|ANTHROPIC_API_KEY|CLAUDE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|GEMINI_API_KEY|MISTRAL_API_KEY|COHERE_API_KEY|PERPLEXITY_API_KEY|OPENROUTER_API_KEY|TOGETHER_API_KEY|FIREWORKS_API_KEY|GROQ_API_KEY|DEEPSEEK_API_KEY|XAI_API_KEY|REPLICATE_API_TOKEN|HUGGINGFACE_API_KEY|HF_TOKEN)\b/i, "metered AI provider credential request"],
  [/anthropic(?:s)?\/claude(?:-code)?-action/i, "metered AI GitHub Action request"],
  [new RegExp(`${METERED_AI_PROVIDER_SOURCE}[\\s\\S]{0,140}${METERED_AI_WIRING_SOURCE}|${METERED_AI_WIRING_SOURCE}[\\s\\S]{0,140}${METERED_AI_PROVIDER_SOURCE}`, "i"), "metered AI provider wiring request"],
  [/\b(auto[-_\s]?top[-_\s]?up|automatic\s+(?:credit|credits|billing|charge|charges)|buy\s+credits?|purchase\s+credits?|prepaid\s+credits?)\b[\s\S]{0,140}\b(openai|codex|ai|api)\b|\b(openai|codex|ai|api)\b[\s\S]{0,140}\b(auto[-_\s]?top[-_\s]?up|automatic\s+(?:credit|credits|billing|charge|charges)|buy\s+credits?|purchase\s+credits?|prepaid\s+credits?)\b/i, "automatic AI credit or auto-top-up request"],
  [/\b(?:ai spend policy|subscription[-_\s]?only\s+(?:ai|codex|openai)|(?:ai|codex|openai)\s+subscription[-_\s]?only|maxExtraMonthlySpendUsd|zero[-_\s]?extra[-_\s]?ai[-_\s]?spend)\b/i, "AI spend policy change requires high-risk human approval"],
  [/\b(?:paid|metered|billable)\b[\s\S]{0,100}\b(?:codex|openai|ai)\b[\s\S]{0,100}\b(?:runner|action|automation|execution|agent)\b/i, "paid unattended AI execution request"],
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
