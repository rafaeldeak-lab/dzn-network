import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { classifyPath } from "./autodev/risk-classifier";
import { isSafePlatformIssue, REQUIRED_SAFE_LABELS } from "./autodev/pick-safe-issue";
import { profileNames, selectQualityGateProfile, selectValidationProfile } from "./autodev/validation-profiles";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function includesAll(source: string, values: string[]) {
  for (const value of values) assert.equal(source.includes(value), true, `Expected source to include ${value}`);
}

const rootAgents = read("AGENTS.md");
includesAll(rootAgents, [
  "DZN AutoDev is platform-wide autonomous engineering, not ADM-only.",
  "Do not commit secrets",
  "do not weaken tests",
  "Create a `player_stats` table. DZN uses `player_profiles`.",
  "Remove same-category matchmaking guarantees.",
  "Add `OPENAI_API_KEY`.",
  "Zero-Extra-AI-Spend Policy",
  "`aiSpendPolicy.mode` must stay `subscription_only`.",
  "`aiSpendPolicy.maxExtraMonthlySpendUsd` must stay `0`.",
  "Other metered AI providers, AI SDK credentials, and API-key-backed autonomous execution paths are forbidden by default.",
  "Never claim completion without validation evidence.",
]);

for (const file of ["functions/api/auth/AGENTS.md", "functions/api/stripe/AGENTS.md", "functions/api/nitrado/AGENTS.md", "functions/api/onboarding/AGENTS.md", "migrations/AGENTS.md", "workers/AGENTS.md", ".github/workflows/AGENTS.md"]) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

const requiredSkills = ["dzn-repository-investigation", "dzn-testing-validation", "dzn-browser-qa", "dzn-security-review", "dzn-cloudflare", "dzn-github-actions", "dzn-billing-integrity", "dzn-nitrado", "dzn-release-management"];
for (const skill of requiredSkills) {
  const path = `.agents/skills/${skill}/SKILL.md`;
  assert.equal(existsSync(path), true, `${path} must exist`);
  const source = read(path);
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.notEqual(frontmatter, null, `${skill} must have YAML frontmatter`);
  assert.match(frontmatter![1], new RegExp(`^name:\\s*${skill}\\s*$`, "m"), `${skill} name must match directory`);
  assert.match(frontmatter![1], /^description:\s*.+$/m, `${skill} must have a description`);
}

const config = JSON.parse(read(".autodev/config.json"));
assert.equal(config.scope, "dzn_platform");
assert.equal(config.mode, "pr_only");
assert.equal(config.allowDirectMainPush, false);
assert.equal(config.allowAutoMergeLowRisk, false);
assert.equal(config.allowAutomaticProductionDeploy, false);
assert.equal(config.allowProductionMutations, false);
assert.equal(config.codex.paidGitHubActionEnabled, false);
assert.equal(config.codex.requiresOpenAiApiKey, false);
assert.equal(config.codex.unattendedPaidExecutionEnabled, false);
assert.equal(config.codex.meteredAiProvidersEnabled, false);
assert.equal(config.codex.assumesAutomaticCreditsOrAutoTopUp, false);
assert.equal(config.aiSpendPolicy.mode, "subscription_only");
assert.equal(config.aiSpendPolicy.maxExtraMonthlySpendUsd, 0);
assert.equal(config.aiSpendPolicy.chatGptBillingSettingsManagedOutsideRepo, true);
assert.equal(config.aiSpendPolicy.forbidOpenAiApiKey, true);
assert.equal(config.aiSpendPolicy.forbidMeteredAiProvidersByDefault, true);
assert.equal(config.aiSpendPolicy.overrideRequires, "high_risk_human_approved_redesign");
assert.equal(config.systems.adm.primaryAutomaticRunner, "cloudflare-worker");
assert.equal(config.systems.adm.githubBackupRunner, "manual-only");

assert.deepEqual(REQUIRED_SAFE_LABELS, ["autodev", "autodev-safe-fix", "low-risk"]);
assert.equal(isSafePlatformIssue({ number: 1, title: "Docs typo", body: "Fix billing documentation wording without touching billing code.", labels: ["autodev", "autodev-safe-fix", "low-risk", "system:docs"] }).ok, true);
assert.equal(isSafePlatformIssue({ number: 2, title: "Event UI copy", body: "Update events page empty-state copy.", labels: ["autodev", "autodev-safe-fix", "low-risk", "system:events"] }).ok, true);
assert.equal(isSafePlatformIssue({ number: 3, title: "Billing checkout", body: "Fix checkout behavior.", labels: ["autodev", "autodev-safe-fix", "low-risk", "system:billing"] }).ok, false);
assert.equal(isSafePlatformIssue({ number: 4, title: "Drop old profiles", body: "DROP TABLE player_profiles;", labels: ["autodev", "autodev-safe-fix", "low-risk"] }).ok, false);
assert.equal(isSafePlatformIssue({ number: 5, title: "Add Anthropic key", body: "Wire ANTHROPIC_API_KEY for unattended AI fixes.", labels: ["autodev", "autodev-safe-fix", "low-risk"] }).ok, false);
assert.equal(isSafePlatformIssue({ number: 6, title: "Enable AI spend override", body: "Change AI spend policy and enable auto top-up.", labels: ["autodev", "autodev-safe-fix", "low-risk"] }).ok, false);

assert.equal(classifyPath("docs/README.md", "Fix typo").risk, "low");
assert.equal(classifyPath("AGENTS.md", read("AGENTS.md")).risk, "high");
assert.equal(classifyPath("components/home/Hero.tsx", "export function Hero() { return <div />; }").risk, "low");
assert.equal(classifyPath("app/events/page.tsx", "export default function EventsPage() { return <main />; }").risk, "low");
assert.equal(classifyPath("functions/api/events/create.ts", "export async function onRequestPost() {}").risk, "medium");
assert.equal(classifyPath("functions/api/billing/checkout.ts", "export async function onRequestPost() {}").risk, "high");
assert.equal(classifyPath("functions/api/stripe/webhook.ts", "constructEvent webhook signature").risk, "high");
assert.equal(classifyPath("functions/api/auth/discord/start.ts", "session cookie redirect").risk, "high");
assert.equal(classifyPath("functions/_lib/crypto.ts", "TOKEN_ENCRYPTION_KEY").risk, "high");
assert.equal(classifyPath("migrations/9999_events.sql", "ALTER TABLE competitive_events ADD COLUMN display_name TEXT;").risk, "medium");
assert.equal(classifyPath("migrations/9999_billing.sql", "ALTER TABLE subscriptions ADD COLUMN entitlement_snapshot TEXT;").risk, "high");
assert.equal(classifyPath("migrations/9999_drop.sql", "DROP TABLE player_profiles;").risk, "blocked");
assert.equal(classifyPath("migrations/9999_player_stats.sql", "CREATE TABLE player_stats (id TEXT);").risk, "blocked");
assert.equal(classifyPath("migrations/9999_reset.sql", "UPDATE player_profiles SET kills = 0;").risk, "blocked");
assert.equal(classifyPath("functions/_lib/events.ts", "remove same-category matchmaking enforcement").risk, "blocked");
assert.equal(classifyPath(".github/workflows/bad.yml", "env:\n  TOKEN_ENCRYPTION_KEY: ${{ secrets.TOKEN_ENCRYPTION_KEY }}").risk, "blocked");
assert.equal(classifyPath(".github/workflows/bad.yml", "uses: openai/codex-action@v1").risk, "blocked");
assert.equal(classifyPath(".github/workflows/paid-ai.yml", "env:\n  GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}").risk, "blocked");
assert.equal(classifyPath("scripts/ai-runner.ts", "const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });").risk, "blocked");
assert.equal(classifyPath("scripts/autodev/propose-fix.ts", "const key = process.env.OPENAI_API_KEY; runPaidAgent(key);").risk, "blocked");
assert.equal(classifyPath("package.json", "{\"dependencies\":{\"openai\":\"latest\"}}").risk, "blocked");
assert.equal(classifyPath(".autodev/config.json", read(".autodev/config.json")).risk, "high");
assert.equal(classifyPath("workers/adm-sync-worker.ts", "WORKER_SUBREQUEST_LIMIT crons retry backoff").risk, "high");
assert.equal(classifyPath("docs/ADM_SYNC_PLAN.md", "ADM docs update").risk, "low");
assert.equal(classifyPath("scripts/test-adm-parser.ts", "ADM parser tests").risk, "low");
assert.equal(classifyPath("functions/_lib/adm-sync.ts", "parseAdm processAdm writeKill UPDATE player_profiles SET kills = kills + 1").risk, "high");

const loginUi = classifyPath("app/login/page.tsx", "export default function LoginPage() { return <a href=\"/api/auth/discord/start\">Continue with Discord</a>; }");
assert.equal(loginUi.system, "auth");
assert.equal(loginUi.risk, "high");
assert.equal(loginUi.suggestedValidationProfile, "auth");

const onboardingUi = classifyPath("components/onboarding/dashboard.tsx", "reserveAllowance({ planId }); render linked server billing plan status");
assert.equal(onboardingUi.system, "onboarding");
assert.equal(onboardingUi.risk, "high");

const harmlessHeaderUi = classifyPath("components/site-header.tsx", "export function SiteHeader() { return <a href=\"/login\">Login</a>; }");
assert.equal(harmlessHeaderUi.system, "ui");
assert.equal(harmlessHeaderUi.risk, "low");

const eventHeroUi = classifyPath("components/events/EventHero.tsx", "export function EventHero() { return <section>Upcoming tournament schedule</section>; }");
assert.equal(eventHeroUi.system, "events");
assert.equal(eventHeroUi.risk, "low");

assert.equal(selectValidationProfile([classifyPath("docs/README.md", "Fix typo")]).name, "docs");
assert.equal(selectValidationProfile([classifyPath("functions/api/auth/me.ts", "session cookie")]).name, "auth");
assert.equal(selectValidationProfile([classifyPath("functions/api/billing/checkout.ts", "checkout")]).name, "billing");
assert.equal(selectValidationProfile([classifyPath("functions/_lib/adm-sync.ts", "parseAdm")]).name, "nitrado-adm");
assert.equal(selectValidationProfile([classifyPath(".github/workflows/dzn-codex-safe-fix.yml", read(".github/workflows/dzn-codex-safe-fix.yml"))]).name, "github-workflows");
assert.equal(selectValidationProfile([classifyPath("AGENTS.md", read("AGENTS.md"))]).name, "autodev");

const autoDevMedium = classifyPath("package.json", "{\"scripts\":{\"autodev:quality\":\"tsx scripts/autodev/quality-gate.ts\"},\"automation\":\"policy\"}");
const authHigh = classifyPath("functions/api/auth/session.ts", "session cookie");
const billingHigh = classifyPath("functions/api/billing/checkout.ts", "checkout session");
const ownerHigh = classifyPath("functions/api/owner/servers.ts", "export async function onRequestPost() {}");
const docsLow = classifyPath("docs/README.md", "Fix typo");
const workflowMedium = classifyPath(".github/workflows/dzn-autodev-audit.yml", "name: DZN ADM AutoDev Audit\non:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  audit:\n    runs-on: ubuntu-latest\n");
assert.equal(autoDevMedium.risk, "medium");
assert.equal(workflowMedium.risk, "medium");
assert.equal(selectValidationProfile([autoDevMedium, authHigh]).name, "auth");
assert.equal(selectValidationProfile([autoDevMedium, billingHigh]).name, "billing");
assert.equal(selectValidationProfile([harmlessHeaderUi, ownerHigh]).name, "release-high-risk");
assert.equal(selectValidationProfile([authHigh, billingHigh]).name, "release-high-risk");
assert.equal(selectValidationProfile([docsLow, harmlessHeaderUi]).name, "ui");
assert.equal(selectValidationProfile([autoDevMedium]).name, "autodev");
assert.equal(selectValidationProfile([workflowMedium]).name, "github-workflows");

assert.equal(selectQualityGateProfile({ classifications: [], inGithubActions: true }).name, "release-high-risk");
assert.equal(selectQualityGateProfile({ classifications: [], requestedProfile: "auth", inGithubActions: true }).name, "auth");
assert.equal(selectQualityGateProfile({ classifications: [], inGithubActions: false }).name, "general");
assert.deepEqual(profileNames().sort(), config.validation.profiles.slice().sort());

const workflowText = readdirSync(".github/workflows").filter((name) => name.endsWith(".yml") || name.endsWith(".yaml")).map((name) => read(`.github/workflows/${name}`)).join("\n");
assert.equal(/openai\/codex-action/i.test(workflowText), false);
assert.equal(/secrets\.OPENAI_API_KEY/i.test(workflowText), false);
assert.equal(/OPENAI_API_KEY/.test(workflowText), false);
assert.equal(read(".github/workflows/dzn-adm-sync.yml").includes("schedule:"), false);
assert.equal(read(".github/workflows/dzn-adm-sync.yml").includes("workflow_dispatch:"), true);
assert.equal(read("functions/api/autodev/adm-health.ts").includes('scope: "adm_tracking_only"'), true);
assert.equal(read("wrangler.adm-sync.toml").includes('name = "dzn-adm-sync-worker"'), true);
assert.equal(read("wrangler.adm-sync.toml").includes("crons ="), true);

console.log("Agent foundation tests passed.");
