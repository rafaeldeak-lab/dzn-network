import { pathToFileURL } from "node:url";
import {
  fail,
  gitChangedFiles,
  listFiles,
  makeReport,
  maxRisk,
  pass,
  readText,
  warn,
  writeReport,
  type AutomationPolicy,
  type AutoDevCheck,
  type AutoDevScope,
  type RiskLevel,
  type ValidationProfileName,
} from "./lib";

export type SystemCategory =
  | "docs"
  | "tests"
  | "ui"
  | "public-api"
  | "owner-api"
  | "auth"
  | "billing"
  | "stripe"
  | "nitrado"
  | "adm"
  | "events"
  | "database"
  | "cloudflare-worker"
  | "github-actions"
  | "autodev"
  | "onboarding"
  | "release"
  | "unknown";

export type RiskClassification = {
  scope: AutoDevScope;
  system: SystemCategory;
  file: string;
  risk: RiskLevel;
  automationPolicy: AutomationPolicy;
  suggestedValidationProfile: ValidationProfileName;
  blockedReason?: string;
  changedFiles: string[];
  admRelated: boolean;
  reasons: string[];
};

const SCOPE: AutoDevScope = "dzn_platform";

const AUTOMATION_POLICY: Record<RiskLevel, AutomationPolicy> = {
  low: { allowedToInvestigate: true, allowedToImplementInBranch: true, allowedToOpenPR: true, allowedToAutoMerge: false, allowedToDeployProduction: false, requiresHumanReview: false },
  medium: { allowedToInvestigate: true, allowedToImplementInBranch: true, allowedToOpenPR: true, allowedToAutoMerge: false, allowedToDeployProduction: false, requiresHumanReview: true },
  high: { allowedToInvestigate: true, allowedToImplementInBranch: true, allowedToOpenPR: true, allowedToAutoMerge: false, allowedToDeployProduction: false, requiresHumanReview: true },
  blocked: { allowedToInvestigate: true, allowedToImplementInBranch: false, allowedToOpenPR: false, allowedToAutoMerge: false, allowedToDeployProduction: false, requiresHumanReview: true },
};

const PROTECTED_DELETE_TABLES = ["player_profiles", "kills", "kill_events", "deaths", "player_events", "events", "competitive_events", "sessions", "subscriptions", "server_subscriptions", "servers", "linked_servers"];
const RUNTIME_SECRETS_IN_GITHUB = ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "DZN_LIVE_CHECKOUT_ENABLED", "SESSION_SECRET", "TOKEN_ENCRYPTION_KEY", "MOCK_AUTH", "MOCK_NITRADO", "NEXT_PUBLIC_"];
const METERED_AI_CREDENTIALS = [
  "OPENAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "PERPLEXITY_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "XAI_API_KEY",
  "REPLICATE_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HF_TOKEN",
];
const METERED_AI_PROVIDER_SOURCE = String.raw`\b(?:openai|anthropic|claude|gemini|google\s+(?:generative\s+)?ai|vertex\s+ai|mistral|cohere|perplexity|openrouter|together(?:\s+ai)?|fireworks(?:\s+ai)?|groq|deepseek|xai|replicate|hugging\s*face|bedrock)\b`;
const METERED_AI_WIRING_SOURCE = String.raw`(?:api[_ -]?key|secret|token|credential|provider|sdk|client|runner|action|autonomous|unattended|execution)`;
const METERED_AI_PROVIDER_WIRING = [
  new RegExp(`${METERED_AI_PROVIDER_SOURCE}[\\s\\S]{0,140}${METERED_AI_WIRING_SOURCE}`, "i"),
  new RegExp(`${METERED_AI_WIRING_SOURCE}[\\s\\S]{0,140}${METERED_AI_PROVIDER_SOURCE}`, "i"),
];
const METERED_AI_PACKAGES = [
  "openai",
  "@openai/agents",
  "@anthropic-ai/sdk",
  "@google/genai",
  "@google/generative-ai",
  "@mistralai/mistralai",
  "cohere-ai",
  "openrouter",
  "groq-sdk",
  "together-ai",
  "replicate",
  "@huggingface/inference",
];
const PAID_AI_ACTION_PATTERNS: Array<[RegExp, string]> = [
  [/openai\/codex-action/i, "paid Codex GitHub Action detected"],
  [/anthropic(?:s)?\/claude(?:-code)?-action/i, "metered Claude GitHub Action detected"],
];
const LIVE_BILLING_MUTATION_PATTERNS: Array<[RegExp, string]> = [
  [/\bstripe\s+(?:products?|prices?|webhook(?:_endpoints)?|customers?|subscriptions?)\s+(?:create|update|delete)\b/i, "automated live Stripe billing mutation command detected"],
  [/\bstripe["'`]\s*,\s*\[[\s\S]{0,160}["'`](?:products?|prices?|webhook_endpoints|customers?|subscriptions?)["'`]\s*,\s*["'`](?:create|update|delete)["'`]/i, "automated live Stripe billing mutation command detected"],
  [/\b(?:curl|fetch|Invoke-RestMethod|Invoke-WebRequest)\b[\s\S]{0,180}\bapi\.stripe\.com\/v1\/(?:products|prices|webhook_endpoints|customers|subscriptions)\b[\s\S]{0,180}\b(?:POST|PUT|PATCH|DELETE)\b/i, "automated Stripe API mutation request detected"],
  [/\b(?:curl|fetch|Invoke-RestMethod|Invoke-WebRequest)\b[\s\S]{0,180}\b(?:POST|PUT|PATCH|DELETE)\b[\s\S]{0,180}\bapi\.stripe\.com\/v1\/(?:products|prices|webhook_endpoints|customers|subscriptions)\b/i, "automated Stripe API mutation request detected"],
  [/\b(?:npx\s+)?wrangler\s+pages\s+secret\s+put\s+(?:STRIPE_PRICE_STARTER|STRIPE_PRICE_PRO|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|DZN_LIVE_CHECKOUT_ENABLED)\b/i, "automated Stripe production secret mutation command detected"],
  [/\bDZN_LIVE_CHECKOUT_ENABLED\b\s*(?:=|:)\s*["'`]?(?:true|1|yes|on)["'`]?\b/i, "live checkout enablement flag assignment detected"],
  [/\b(?:enable|activate|turn\s+on|go\s+live)\b[\s\S]{0,100}\blive\s+billing\b[\s\S]{0,140}\b(?:script|workflow|automation|autodev|unattended)\b/i, "unattended live billing activation path detected"],
];
const DESTRUCTIVE_TRUNCATE_PATTERN = /\bTRUNCATE\s+TABLE\s+(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)|\bTRUNCATE\s+(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)\s*;/i;
const ADM_PATHS = [
  /^functions\/_lib\/adm-/,
  /^functions\/api\/sync\/adm(?:\/|$)/,
  /^functions\/api\/autodev\/adm-health\.ts$/,
  /^functions\/api\/debug\/nitrado-(?:admin-logs|file-read)\.ts$/,
  /^functions\/api\/servers\/\[serverId\]\/adm/,
  /^functions\/api\/servers\/\[serverId\]\/dashboard\/health\.ts$/,
  /^workers\/adm-sync-worker\.ts$/,
  /^wrangler\.adm-sync\.toml$/,
  /^scripts\/adm-/,
  /^scripts\/verify-production-adm-live\.ts$/,
  /^scripts\/test-(?:adm|latest-adm|nitrado-file-read|auto-sync-dashboard)/,
  /^docs\/ADM_/,
  /^\.github\/workflows\/dzn-(?:adm|nitrado|post-deploy|autodev)/,
];
const AUTH_UI_PATHS = [
  /^app\/(?:login|logout|auth|signin|sign-in|session|sessions)(?:\/|$)/,
  /^components\/(?:auth|login|logout|oauth|session|sessions|discord-auth)(?:\/|$)/,
];
const ONBOARDING_UI_PATHS = [
  /^app\/(?:setup|onboarding)(?:\/|$)/,
  /^components\/onboarding(?:\/|$)/,
];
const BILLING_UI_PATHS = [
  /^app\/(?:pricing|billing|subscribe|subscription|subscriptions|plans)(?:\/|$)/,
  /^components\/(?:billing|pricing|subscription|subscriptions|plans)(?:\/|$)/,
];
const NITRADO_UI_PATHS = [
  /^app\/(?:setup|onboarding|nitrado)(?:\/|$)/,
  /^components\/(?:onboarding|nitrado)(?:\/|$)/,
];

export function classifyPath(file: string, content = readText(file)): RiskClassification {
  const normalized = normalizePath(file);
  const system = inferSystem(normalized, content);
  const reasons: string[] = [];

  const hardBlocked = detectHardBlockedContent(content, normalized);
  if (hardBlocked.length) return result(normalized, system, "blocked", hardBlocked, hardBlocked.join("; "));

  if (isMigration(normalized)) return classifyMigration(normalized, content, system);

  const contentSystem = inferContentSystem(content);
  if (contentSystem && system === "unknown") reasons.push(`content references ${contentSystem}`);

  const risk = classifyRisk(normalized, content, system, reasons);
  return result(normalized, system, risk, reasons.length ? reasons : [`${system} default ${risk} classification`]);
}

export function classifyChangedFiles(files: string[]) {
  return files.map((file) => classifyPath(file));
}

export function detectDestructiveMigration(content: string, file = "") {
  const findings: string[] = [];
  const text = content.replace(/--.*$/gm, "");
  const normalizedFile = normalizePath(file);
  const isMigrationLike = isMigration(normalizedFile) || /\.sql$/i.test(normalizedFile);
  if (!isMigrationLike && !/CREATE\s+TABLE|DROP\s+TABLE|DELETE\s+FROM|ALTER\s+TABLE|UPDATE\s+player_profiles/i.test(text) && !DESTRUCTIVE_TRUNCATE_PATTERN.test(text)) return findings;
  if (/DROP\s+TABLE/i.test(text)) findings.push("destructive DROP TABLE detected");
  if (DESTRUCTIVE_TRUNCATE_PATTERN.test(text)) findings.push("destructive TRUNCATE detected");
  if (new RegExp(`DELETE\\s+FROM\\s+(${PROTECTED_DELETE_TABLES.join("|")})\\b`, "i").test(text)) findings.push("destructive DELETE FROM protected table detected");
  if (/ALTER\s+TABLE[\s\S]{0,200}\bDROP\s+COLUMN\b/i.test(text)) findings.push("destructive ALTER TABLE DROP COLUMN detected");
  if (/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats\b/i.test(text)) findings.push("player_stats table creation detected");
  if (/UPDATE\s+player_profiles[\s\S]{0,260}\b(kills|deaths|joins|disconnects|score|longest_kill_distance|highest_killstreak)\s*=\s*0\b/i.test(text)) findings.push("destructive player_profiles stat reset logic detected");
  return findings;
}

export function classifyRecoverableProductionStatus(status: string | null | undefined) {
  return new Set(["no_new_adm", "waiting_for_nitrado", "latest_adm_unreadable", "nitrado_upstream_down", "nitrado_rate_limited", "partial_budget_reached", "file_missing_or_rotated", "completed_no_new_events", "duplicate_skipped"]).has(String(status ?? "").toLowerCase());
}

export function isPlatformAutoDevAllowedFile(file: string, content = readText(file)) {
  return classifyPath(file, content).risk !== "blocked";
}

export function isAdmOnlyAllowedFile(file: string, content = readText(file)) {
  const classification = classifyPath(file, content);
  return classification.admRelated && classification.risk !== "blocked";
}

function classifyMigration(file: string, content: string, system: SystemCategory): RiskClassification {
  const migrationSystem = inferMigrationSystem(file, content, system);
  const reasons = [`additive/data-preserving ${migrationSystem} migration`, "production application is a separate release operation"];
  const highRiskMigrationSystems: SystemCategory[] = ["auth", "billing", "stripe", "nitrado", "onboarding", "cloudflare-worker"];
  return result(file, migrationSystem, highRiskMigrationSystems.includes(migrationSystem) ? "high" : "medium", reasons);
}

function classifyRisk(file: string, content: string, system: SystemCategory, reasons: string[]): RiskLevel {
  if (system !== "tests" && isAiSpendPolicyChange(file, content)) {
    reasons.push("AI spend policy changes require high-risk human approval");
    return "high";
  }
  if (system === "docs" || system === "tests") return "low";
  if (system === "autodev") {
    reasons.push("AutoDev policy or tooling change");
    return file.endsWith("config.json") || /risk|policy|automation|safe-fix/i.test(content) ? "medium" : "low";
  }
  if (system === "github-actions") {
    if (/wrangler\s+(?:deploy|pages\s+deploy|d1\s+migrations\s+apply|d1\s+execute)|pages\s+secret\s+put|workflow_run|pull_request_target/i.test(content)) {
      reasons.push("workflow touches production, deployment, secrets, or privileged trigger surface");
      return "high";
    }
    reasons.push("GitHub workflow automation boundary");
    return "medium";
  }
  if (system === "cloudflare-worker") {
    reasons.push("Cloudflare Worker runtime or cron behavior");
    return "high";
  }
  if (system === "auth") {
    reasons.push("auth/session/Discord OAuth protected system");
    return "high";
  }
  if (system === "stripe" || system === "billing") {
    reasons.push("Stripe/billing/subscription protected system");
    return "high";
  }
  if (system === "nitrado") {
    reasons.push("Nitrado token/service association protected system");
    return "high";
  }
  if (system === "adm") {
    if (/^docs\/|^scripts\/test-|^\.github\/workflows\/dzn-(?:autodev|post-deploy)/.test(file)) {
      reasons.push("ADM docs/tests/monitoring surface");
      return "low";
    }
    reasons.push("ADM ingestion, diagnostics, or Worker behavior");
    return "high";
  }
  if (system === "onboarding") {
    reasons.push("onboarding allowance, Nitrado association, or server lifecycle behavior");
    return "high";
  }
  if (system === "events") {
    if (/^(app|components)\/events\//.test(file)) {
      reasons.push("events UI surface");
      return "low";
    }
    reasons.push("events/tournament/matchmaking behavior");
    return "medium";
  }
  if (system === "owner-api") {
    reasons.push("owner-protected API behavior");
    return "high";
  }
  if (system === "public-api") {
    reasons.push("public API behavior");
    return "medium";
  }
  if (system === "ui") return "low";
  if (system === "release") return "high";
  return "medium";
}

function detectHardBlockedContent(content: string, file: string) {
  if (/^scripts\/test-/.test(file)) return [];
  const autoDevPolicyTool = /^scripts\/autodev\/(?:audit|pick-safe-issue|risk-classifier)\.ts$/.test(file);
  if (autoDevPolicyTool) return [];
  const findings = [...detectDestructiveMigration(content, file)];
  const text = content.replace(/--.*$/gm, "");
  findings.push(...detectLiveBillingProductionMutation(text, file));
  if (!isPolicyDocument(file) && !autoDevPolicyTool) findings.push(...detectMeteredAiSpendWiring(text, file));
  if (isGithubWorkflow(file)) {
    for (const secret of RUNTIME_SECRETS_IN_GITHUB) {
      const pattern = secret.endsWith("_") ? new RegExp(`secrets\\.${escapeRegExp(secret)}`, "i") : new RegExp(`secrets\\.${escapeRegExp(secret)}\\b`, "i");
      if (pattern.test(text)) findings.push(`GitHub workflow references runtime secret ${secret}`);
    }
  }
  if (!isPolicyDocument(file)) {
    if (/\b(disable|bypass|skip|remove|weaken)\b[\s\S]{0,120}\b(auth|authorization|requireCronSecret|isCronAuthorized|401|403|session)\b/i.test(text)) findings.push("auth or endpoint protection weakening detected");
    if (/\b(disable|bypass|skip|remove|weaken)\b[\s\S]{0,160}\b(same-category|same category|assertSameServerCategory|assertSameCategoryChallenge|matchmaking)\b/i.test(text) || /\bcross-category\b[\s\S]{0,120}\b(allow|allowed|match|matchmaking|compete)\b/i.test(text)) findings.push("same-category matchmaking enforcement removal detected");
    if (/\b(raw|plain(?:text)?)\b[\s\S]{0,80}\b(token|secret|STRIPE_SECRET_KEY|TOKEN_ENCRYPTION_KEY|SESSION_SECRET)\b/i.test(text) && /\b(log|console\.log|return|expose|artifact|summary)\b/i.test(text)) findings.push("secret or token exposure pattern detected");
  }
  return Array.from(new Set(findings));
}

function detectLiveBillingProductionMutation(content: string, file: string) {
  if (isPolicyDocument(file) || /^scripts\/test-/.test(file)) return [];
  const findings: string[] = [];
  for (const [pattern, message] of LIVE_BILLING_MUTATION_PATTERNS) {
    if (pattern.test(content)) findings.push(message);
  }
  return Array.from(new Set(findings));
}

function detectMeteredAiSpendWiring(content: string, file: string) {
  const findings: string[] = [];
  for (const credential of METERED_AI_CREDENTIALS) {
    if (new RegExp(`\\b${escapeRegExp(credential)}\\b`, "i").test(content)) {
      findings.push(`metered AI credential ${credential} detected`);
    }
  }
  for (const [pattern, message] of PAID_AI_ACTION_PATTERNS) {
    if (pattern.test(content)) findings.push(message);
  }
  if (/\bsk-proj-[A-Za-z0-9_-]{12,}\b|\bsk-[A-Za-z0-9]{20,}\b/i.test(content)) {
    findings.push("raw OpenAI-style API key detected");
  }
  if (isGithubWorkflow(file)) return Array.from(new Set(findings));
  if (file === "package.json") {
    for (const packageName of METERED_AI_PACKAGES) {
      if (new RegExp(`["']${escapeRegExp(packageName)}["']\\s*:`, "i").test(content)) {
        findings.push(`metered AI provider package ${packageName} detected`);
      }
    }
  }
  if (METERED_AI_PROVIDER_WIRING.some((pattern) => pattern.test(content))) {
    findings.push("metered AI provider wiring detected");
  }
  if (/\b(auto[-_\s]?top[-_\s]?up|automatic\s+(?:credit|credits|billing|charge|charges)|buy\s+credits?|purchase\s+credits?|prepaid\s+credits?)\b/i.test(content) && /\b(openai|codex|ai|api)\b/i.test(content)) {
    findings.push("automatic AI credit or auto-top-up assumption detected");
  }
  if (/\b(?:paid|metered|billable)\b[\s\S]{0,100}\b(?:codex|openai|ai)\b[\s\S]{0,100}\b(?:runner|action|automation|execution|agent)\b/i.test(content)) {
    findings.push("paid unattended AI execution path detected");
  }
  return Array.from(new Set(findings));
}

function inferSystem(file: string, content: string): SystemCategory {
  if (file === "package.json") return "autodev";
  if (file === ".autodev/config.json" || /^scripts\/autodev\//.test(file) || /^\.agents\/skills\//.test(file) || /^docs\/CODEX_AUTODEV\.md$/.test(file)) return "autodev";
  if (/^(AGENTS|CLAUDE|README)\.md$/.test(file) || /^docs\//.test(file)) return "docs";
  if (/^scripts\/test-/.test(file)) return "tests";
  if (isGithubWorkflow(file)) return "github-actions";
  if (/^workers\//.test(file) || /^wrangler\.(?:adm-sync|auto-update)\.toml$/.test(file)) return "cloudflare-worker";
  if (isMigration(file)) return "database";
  if (/^functions\/api\/auth\//.test(file) || /^functions\/_lib\/(?:oauth|public-auth|session|auth)\.ts$/.test(file) || /discord\s*oauth/i.test(content)) return "auth";
  if (/^functions\/api\/stripe\//.test(file) || /^functions\/api\/webhooks\/stripe/.test(file) || /^functions\/_lib\/stripe\.ts$/.test(file)) return "stripe";
  if (/^functions\/api\/billing\//.test(file) || /^functions\/api\/(?:create-checkout|my-plan)/.test(file) || /^functions\/_lib\/(?:plans|billing)\.ts$/.test(file)) return "billing";
  if (/^functions\/api\/nitrado\//.test(file) || /^functions\/_lib\/nitrado/.test(file) || /TOKEN_ENCRYPTION_KEY|encrypted_token|token_iv|token_auth_tag/i.test(content)) return "nitrado";
  if (ADM_PATHS.some((pattern) => pattern.test(file))) return "adm";
  if (/^functions\/api\/onboarding\//.test(file) || /^functions\/_lib\/onboarding\.ts$/.test(file)) return "onboarding";
  if (/^(app|components)\//.test(file)) {
    const protectedUiSystem = inferProtectedUiSystem(file, content);
    if (protectedUiSystem) return protectedUiSystem;
  }
  if (/^functions\/api\/events\//.test(file) || /^functions\/api\/servers\/\[serverId\]\/ctf\//.test(file) || /^functions\/api\/seasons\//.test(file) || /^functions\/_lib\/(?:events|event-|ctf-|dzn-seasons|server-war)/.test(file) || /^(app|components)\/events\//.test(file)) return "events";
  if (/^functions\/api\/owner\//.test(file) || /^functions\/api\/admin\//.test(file)) return "owner-api";
  if (/^functions\/api\/public\//.test(file)) return "public-api";
  if (/^\.github\/workflows\/.*(?:production|rollout|deploy|release)/.test(file)) return "release";
  if (/^(app|components)\//.test(file)) return "ui";
  return inferContentSystem(content) ?? "unknown";
}

function inferProtectedUiSystem(file: string, content: string): SystemCategory | null {
  if (AUTH_UI_PATHS.some((pattern) => pattern.test(file))) return "auth";
  if (hasNitradoProtectedUiMarker(file, content)) return "nitrado";
  if (ONBOARDING_UI_PATHS.some((pattern) => pattern.test(file))) return "onboarding";
  if (BILLING_UI_PATHS.some((pattern) => pattern.test(file))) return "billing";
  if (/\b(?:useAuth|useSession|requireSession|createSession|deleteSession|setSessionCookie|clearSessionCookie|signIn|signOut|oauthCallback|discordOAuth)\b|discord\s+oauth|session\s+cookie/i.test(content)) return "auth";
  if (/\b(?:reserveAllowance|releaseAllowance|nitradoServiceId|linkedServer|serverLifecycle|claimServer|onboardingStep)\b|allowance reservation|server lifecycle|service association/i.test(content)) return "onboarding";
  if (/\b(?:createCheckoutSession|billingPortal|manageSubscription|subscriptionStatus|planEntitlement|stripeCheckout)\b|checkout session|billing portal|manage subscription|plan entitlement/i.test(content)) return "billing";
  return null;
}

function hasNitradoProtectedUiMarker(file: string, content: string) {
  return NITRADO_UI_PATHS.some((pattern) => pattern.test(file)) && /\b(?:nitrado|serviceId|service_id|TOKEN_ENCRYPTION_KEY|encrypted_token|token_iv|token_auth_tag)\b/i.test(content);
}

function inferContentSystem(content: string): SystemCategory | null {
  if (/TOKEN_ENCRYPTION_KEY|\bnitrado\b|encrypted_token|token_iv|token_auth_tag/i.test(content)) return "nitrado";
  if (/\bstripe\b|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|checkout session|webhook signature/i.test(content)) return "stripe";
  if (/\bbilling\b|\bsubscriptions?\b|\bplan normalization\b|\bentitlement\b|\ballowance\b/i.test(content)) return "billing";
  if (/\bdiscord oauth\b|\bsession\b|\blogin\b|\bcookie\b|\b401\b|\b403\b/i.test(content)) return "auth";
  if (/\badm\b|admin log|sync health|adm_sync|adm import|file read/i.test(content)) return "adm";
  if (/\bevents?\b|\btournament\b|\bctf\b|server wars|matchmaking|same-category/i.test(content)) return "events";
  return null;
}

function inferMigrationSystem(file: string, content: string, currentSystem: SystemCategory): SystemCategory {
  const fromContent = inferContentSystem(`${file}\n${content}`);
  if (fromContent) return fromContent;
  return currentSystem === "database" ? "database" : currentSystem;
}

function isAiSpendPolicyChange(file: string, content: string) {
  if (file === ".autodev/config.json" && /aiSpendPolicy|paidGitHubActionEnabled|requiresOpenAiApiKey|meteredAiProvidersEnabled|unattendedPaidExecutionEnabled|assumesAutomaticCreditsOrAutoTopUp/i.test(content)) return true;
  return /\b(?:ai spend|subscription[-_\s]?only\s+(?:ai|codex|openai)|(?:ai|codex|openai)\s+subscription[-_\s]?only|maxExtraMonthlySpendUsd|metered\s+ai|unattended\s+paid\s+(?:ai|codex|openai)|OPENAI_API_KEY|openai\/codex-action|auto[-_\s]?top[-_\s]?up)\b/i.test(content);
}

function result(file: string, system: SystemCategory, risk: RiskLevel, reasons: string[], blockedReason?: string): RiskClassification {
  return { scope: SCOPE, system, file, risk, automationPolicy: AUTOMATION_POLICY[risk], suggestedValidationProfile: suggestedValidationProfile(system, risk), blockedReason, changedFiles: [file], admRelated: isAdmRelated(file, reasons.join("\n")), reasons };
}

function suggestedValidationProfile(system: SystemCategory, risk: RiskLevel): ValidationProfileName {
  if (risk === "blocked") return "release-high-risk";
  if (risk === "high" && (system === "docs" || system === "tests")) return "autodev";
  if (system === "autodev") return "autodev";
  if (system === "github-actions") return "github-workflows";
  if (system === "auth") return "auth";
  if (system === "billing" || system === "stripe" || system === "onboarding") return "billing";
  if (system === "nitrado" || system === "adm") return "nitrado-adm";
  if (system === "events") return "events";
  if (system === "ui") return "ui";
  if (system === "docs" || system === "tests") return "docs";
  if (risk === "high" || system === "release" || system === "cloudflare-worker") return "release-high-risk";
  return "general";
}

function isAdmRelated(file: string, content: string) {
  return ADM_PATHS.some((pattern) => pattern.test(file)) || /\b(adm|nitrado adm|sync health|adm_sync|sync-runs|worker heartbeat|auto sync|file read)\b/i.test(`${file}\n${content}`);
}

function isMigration(file: string) {
  return file.startsWith("migrations/") || /\.sql$/i.test(file);
}

function isGithubWorkflow(file: string) {
  return /^\.github\/workflows\/.*\.ya?ml$/i.test(file);
}

function isPolicyDocument(file: string) {
  return /^(AGENTS|CLAUDE|README)\.md$/.test(file) || /^docs\//.test(file) || /^\.agents\/skills\//.test(file);
}

function normalizePath(file: string) {
  return file.replace(/\\/g, "/");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runCli() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : gitChangedFiles();
  const targets = files.length ? files : listFiles(".", (file) => /\.(ts|tsx|js|jsx|sql|yml|yaml|json|md|toml)$/i.test(file));
  const classifications = classifyChangedFiles(targets);
  const checks: AutoDevCheck[] = classifications.map((item) => {
    const message = `${item.system} ${item.risk.toUpperCase()} risk: ${item.blockedReason ?? item.reasons.join(", ")}`;
    if (item.risk === "blocked") return fail(item.file, message, item, "blocked");
    if (item.risk === "high") return fail(item.file, message, item, "high");
    if (item.risk === "medium") return warn(item.file, message, item, "medium");
    return pass(item.file, message, item, "low");
  });
  const report = makeReport("risk-classifier", checks, [
    "AutoDev scope is platform-wide: DZN product systems are classified by system and risk.",
    "Blocked changes must not be automatically implemented.",
    "High-risk changes require specialist validation and human review.",
  ]);
  report.riskLevel = maxRisk(classifications.map((item) => item.risk));
  writeReport("risk-classifier", { ...report, scope: SCOPE, classifications });
  if (report.riskLevel === "blocked" || report.riskLevel === "high") process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli();
}
