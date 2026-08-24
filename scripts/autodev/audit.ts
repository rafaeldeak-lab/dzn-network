import { classifyPath, detectDestructiveMigration } from "./risk-classifier";
import { dirExists, fail, fileExists, listFiles, loadConfig, makeReport, pass, readText, writeReport, type AutoDevCheck, type ValidationProfileName } from "./lib";
import { profileNames } from "./validation-profiles";

const config = loadConfig();
const checks: AutoDevCheck[] = [];
const packageJson = JSON.parse(readText("package.json") || "{}") as { scripts?: Record<string, string> };
const scripts = packageJson.scripts ?? {};

function check(condition: boolean, name: string, passMessage: string, failMessage: string, risk: "low" | "medium" | "high" = "medium") {
  checks.push(condition ? pass(name, passMessage) : fail(name, failMessage, undefined, risk));
}

for (const scriptName of ["test", "lint", "build", "worker:adm-sync:dry-run", "test:agent-foundation", "test:autodev", "test:autodev-codex", "test:github-workflows"]) {
  check(Boolean(scripts[scriptName]), `package script ${scriptName}`, `${scriptName} exists.`, `${scriptName} is missing.`, "high");
}

check(config.mode === "pr_only", "default mode", "AutoDev defaults to pr_only.", "AutoDev must default to pr_only.", "high");
check(config.scope === "dzn_platform", "platform scope", "AutoDev scope is dzn_platform.", "AutoDev must use the platform-wide dzn_platform scope.", "high");
check(config.allowDirectMainPush === false, "direct main push disabled", "Direct main push disabled by default.", "Direct main push must be disabled.", "high");
check(config.allowAutoMergeLowRisk === false, "auto-merge disabled", "Auto-merge disabled by default.", "Auto-merge must be explicitly enabled.", "high");
check(config.allowCodexHighRiskFixes === false, "Codex high-risk disabled", "Codex high-risk fixes disabled.", "Codex high-risk fixes must be disabled.", "high");
check(config.allowAutomaticProductionDeploy === false, "production auto-deploy disabled", "Automatic production deploy disabled.", "Automatic production deploy must be disabled.", "high");
check(config.allowProductionMutations === false, "production mutation disabled", "Automatic production mutation disabled.", "Automatic production mutation must be disabled.", "high");
check(config.aiSpendPolicy?.mode === "subscription_only", "AI spend subscription-only mode", "AI spend policy is subscription_only.", "AI spend policy must stay subscription_only by default.", "high");
check(config.aiSpendPolicy?.maxExtraMonthlySpendUsd === 0, "AI spend zero extra monthly cap", "AI spend policy caps extra monthly spend at $0.", "AI spend policy must cap extra monthly spend at $0.", "high");
check(config.aiSpendPolicy?.chatGptBillingSettingsManagedOutsideRepo === true, "ChatGPT billing external", "Config records that ChatGPT billing settings are managed outside this repo.", "Config must not imply repo code can control ChatGPT billing settings.", "high");
check(config.aiSpendPolicy?.forbidOpenAiApiKey === true, "OpenAI API key forbidden", "OPENAI_API_KEY is forbidden by default.", "OPENAI_API_KEY must remain forbidden by default.", "high");
check(config.aiSpendPolicy?.forbidPaidCodexGitHubAction === true, "paid Codex action forbidden", "Paid Codex GitHub Action is forbidden by default.", "Paid Codex GitHub Action must remain forbidden by default.", "high");
check(config.aiSpendPolicy?.forbidUnattendedPaidCodexExecution === true, "paid unattended Codex forbidden", "Unattended paid Codex execution is forbidden by default.", "Unattended paid Codex execution must remain forbidden by default.", "high");
check(config.aiSpendPolicy?.forbidAutomaticCreditsOrAutoTopUp === true, "AI auto top-up forbidden", "Automatic AI credit/auto-top-up assumptions are forbidden.", "Automatic AI credit/auto-top-up assumptions must be forbidden.", "high");
check(config.aiSpendPolicy?.forbidMeteredAiProvidersByDefault === true, "metered AI providers forbidden", "Metered AI providers are forbidden by default.", "Metered AI providers must be forbidden by default.", "high");
check(config.aiSpendPolicy?.overrideRequires === "high_risk_human_approved_redesign", "AI spend override gate", "AI spend override requires high-risk human-approved redesign.", "AI spend override must require high-risk human-approved redesign.", "high");
check(config.automationPolicy?.low?.allowedToInvestigate === true, "low-risk investigate", "Low-risk investigation is allowed.", "Low-risk investigation policy missing.", "medium");
check(config.automationPolicy?.low?.allowedToImplementInBranch === true, "low-risk branch implementation", "Low-risk branch implementation is allowed.", "Low-risk branch implementation policy missing.", "medium");
check(config.automationPolicy?.low?.allowedToOpenPR === true, "low-risk PR allowed", "Low-risk PR creation is allowed.", "Low-risk PR policy missing.", "medium");
check(config.automationPolicy?.medium?.allowedToAutoMerge === false, "medium auto-merge disabled", "Medium-risk auto-merge disabled.", "Medium-risk auto-merge must be disabled.", "high");
check(config.automationPolicy?.high?.allowedToAutoMerge === false, "high auto-merge disabled", "High-risk auto-merge disabled.", "High-risk auto-merge must be disabled.", "high");
check(config.automationPolicy?.high?.allowedToDeployProduction === false, "high production deploy disabled", "High-risk production deployment disabled.", "High-risk production deployment must be disabled.", "high");
check(config.automationPolicy?.blocked?.allowedToImplementInBranch === false, "blocked implementation disabled", "Blocked changes cannot be branch-implemented automatically.", "Blocked changes must not be implemented automatically.", "high");
check(config.codex?.openPullRequestOnly === true, "Codex PR-only", "Codex safe-fix is PR-only.", "Codex safe-fix must be PR-only.", "high");
check(config.codex?.directPushToMain === false, "Codex direct main disabled", "Codex direct main push disabled.", "Codex direct main push must be disabled.", "high");
check(config.codex?.autoMerge === false, "Codex auto-merge disabled", "Codex auto-merge disabled.", "Codex auto-merge must be disabled.", "high");
check(config.codex?.paidGitHubActionEnabled === false, "paid Codex action disabled", "Paid Codex GitHub Action disabled.", "Paid Codex GitHub Action must not be enabled.", "high");
check(config.codex?.requiresOpenAiApiKey === false, "OpenAI API key not required", "OpenAI API key is not required by AutoDev.", "AutoDev must not require OPENAI_API_KEY.", "high");
check(config.codex?.unattendedPaidExecutionEnabled === false, "paid unattended Codex disabled", "Paid unattended Codex execution disabled.", "Paid unattended Codex execution must not be enabled.", "high");
check(config.codex?.meteredAiProvidersEnabled === false, "metered AI providers disabled", "Metered AI provider wiring disabled.", "Metered AI provider wiring must not be enabled.", "high");
check(config.codex?.assumesAutomaticCreditsOrAutoTopUp === false, "AI auto top-up assumptions disabled", "AutoDev does not assume automatic credits or auto top-up.", "AutoDev must not assume automatic credits or auto top-up.", "high");
check(config.systems?.adm?.specialistSubsystem === true, "ADM specialist subsystem", "ADM remains represented as a specialist subsystem.", "ADM specialist subsystem policy missing.", "high");
check(config.systems?.adm?.primaryAutomaticRunner === "cloudflare-worker", "ADM primary runner", "Cloudflare Worker remains primary ADM runner.", "ADM primary runner must remain Cloudflare Worker.", "high");
check(config.systems?.adm?.githubBackupRunner === "manual-only", "ADM GitHub backup runner", "GitHub ADM backup runner remains manual-only.", "GitHub ADM backup runner must be manual-only.", "high");
for (const gate of ["blockPaidCodexGitHubAction", "blockOpenAiApiKey", "blockUnattendedPaidAiExecution", "blockMeteredAiProviders", "blockAutomaticCreditsOrAutoTopUpAssumptions"]) {
  check(config.riskGates?.[gate] === true, `risk gate ${gate}`, `${gate} is enabled.`, `${gate} must remain enabled.`, "high");
}
check(
  classifyPath("scripts/stripe-live-activation.ts", "stripe products create --name 'DZN Starter'").risk === "blocked",
  "live Stripe product automation blocked",
  "AutoDev blocks automated live Stripe product/price setup.",
  "AutoDev must block automated live Stripe product/price setup.",
  "high",
);
check(
  classifyPath(".github/workflows/stripe-live-secret.yml", "run: npx wrangler pages secret put STRIPE_SECRET_KEY --project-name dzn-network").risk === "blocked",
  "live Stripe secret automation blocked",
  "AutoDev blocks automated Stripe production secret setup.",
  "AutoDev must block automated Stripe production secret setup.",
  "high",
);
check(
  classifyPath(".github/workflows/stripe-live-checkout.yml", "run: npx wrangler pages secret put DZN_LIVE_CHECKOUT_ENABLED --project-name dzn-network").risk === "blocked",
  "live Stripe checkout flag automation blocked",
  "AutoDev blocks automated live checkout enablement.",
  "AutoDev must block automated live checkout enablement.",
  "high",
);

for (const profile of ["docs", "ui", "general", "auth", "billing", "nitrado-adm", "events", "github-workflows", "autodev", "release-high-risk"] as ValidationProfileName[]) {
  check(profileNames().includes(profile), `validation profile ${profile}`, `${profile} validation profile exists.`, `${profile} validation profile missing.`, "high");
  check(config.validation?.profiles?.includes(profile) === true, `config validation profile ${profile}`, `${profile} is listed in config validation profiles.`, `${profile} missing from config validation profiles.`, "medium");
}

for (const file of ["functions/api/auth/AGENTS.md", "functions/api/stripe/AGENTS.md", "functions/api/nitrado/AGENTS.md", "functions/api/onboarding/AGENTS.md", "migrations/AGENTS.md", "workers/AGENTS.md", ".github/workflows/AGENTS.md"]) {
  check(fileExists(file), `nested instructions ${file}`, `${file} exists.`, `${file} is missing.`, "high");
}

for (const skill of ["dzn-repository-investigation", "dzn-testing-validation", "dzn-browser-qa", "dzn-security-review", "dzn-cloudflare", "dzn-github-actions", "dzn-billing-integrity", "dzn-nitrado", "dzn-release-management"]) {
  const skillPath = `.agents/skills/${skill}/SKILL.md`;
  const source = readText(skillPath);
  check(fileExists(skillPath), `skill ${skill}`, `${skill} skill exists.`, `${skill} skill is missing.`, "high");
  check(new RegExp(`---[\\s\\S]*name:\\s*${skill}\\b[\\s\\S]*description:\\s*.+[\\s\\S]*---`).test(source), `skill frontmatter ${skill}`, `${skill} has valid basic frontmatter.`, `${skill} frontmatter missing name/description.`, "high");
}

check(fileExists("wrangler.adm-sync.toml"), "ADM Worker config", "wrangler.adm-sync.toml exists.", "ADM Worker config missing.", "high");
check(/crons\s*=/.test(readText("wrangler.adm-sync.toml")), "ADM Worker cron", "ADM Worker cron is configured.", "ADM Worker cron missing.", "high");
check(/name\s*=\s*"dzn-adm-sync-worker"/.test(readText("wrangler.adm-sync.toml")), "ADM Worker primary", "dzn-adm-sync-worker remains configured.", "ADM Worker name missing.", "high");
check(Boolean(scripts["autodev:pick-safe-issue"]), "safe issue picker script", "Platform safe issue picker script exists.", "autodev:pick-safe-issue is missing.", "medium");

const admWorkflow = readText(".github/workflows/dzn-adm-sync.yml");
check(/workflow_dispatch:/.test(admWorkflow), "ADM workflow manual dispatch", "ADM backup workflow is manually triggerable.", "ADM backup workflow must support workflow_dispatch.", "medium");
check(!/schedule:/.test(admWorkflow) && !/- cron:/.test(admWorkflow), "ADM workflow manual-only", "ADM backup workflow has no schedule.", "ADM backup workflow must remain manual-only.", "high");
check(/^name:\s*DZN ADM Worker Manual Trigger/m.test(admWorkflow), "ADM workflow name", "ADM manual workflow name is ADM-scoped.", "ADM manual workflow name must be ADM-scoped.", "medium");
check(/^name:\s*DZN Nitrado ADM Diagnostics/m.test(readText(".github/workflows/dzn-nitrado-diagnostics.yml")), "diagnostics workflow name", "Nitrado diagnostics workflow name is ADM-scoped.", "Diagnostics workflow name must be ADM-scoped.", "medium");
check(!/schedule:/.test(readText(".github/workflows/dzn-nitrado-diagnostics.yml")), "diagnostics workflow manual-only", "Nitrado ADM diagnostics workflow is manual-only.", "Nitrado ADM diagnostics workflow must not be scheduled.", "high");

const allWorkflowText = listFiles(".github/workflows", (file) => /\.ya?ml$/i.test(file)).map((file) => readText(file)).join("\n");
for (const secret of ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "DZN_LIVE_CHECKOUT_ENABLED", "SESSION_SECRET", "TOKEN_ENCRYPTION_KEY", "MOCK_AUTH", "MOCK_NITRADO", "OPENAI_API_KEY"]) {
  check(!allWorkflowText.includes(`secrets.${secret}`), `workflow runtime secret ${secret}`, `${secret} is not referenced by workflows.`, `${secret} must not be copied into GitHub workflows.`, "high");
}
check(!/openai\/codex-action|OPENAI_API_KEY|sk-proj-|sk-[A-Za-z0-9]/i.test(allWorkflowText), "paid Codex/OpenAI action absent", "No paid OpenAI/Codex GitHub execution is enabled.", "Paid OpenAI/Codex GitHub execution must not be enabled.", "high");
for (const workflowName of ["DZN ADM AutoDev Audit", "DZN ADM Post Deploy Verify", "DZN ADM Cycle Watch", "DZN Codex Safe Fix"]) {
  check(allWorkflowText.includes(`name: ${workflowName}`), `workflow ${workflowName}`, `${workflowName} exists.`, `${workflowName} is missing.`, "medium");
}

const migrations = listFiles("migrations", (file) => file.endsWith(".sql"));
const destructiveFindings = migrations.flatMap((file) => detectDestructiveMigration(readText(file), file).map((finding) => `${file}: ${finding}`));
check(destructiveFindings.length === 0, "non-destructive migrations", "No destructive migration patterns found.", "Destructive migration pattern found.", "high");
checks.push(...destructiveFindings.map((finding) => fail("destructive migration detail", finding, undefined, "high")));
const allSql = migrations.map((file) => readText(file)).join("\n");
check(!/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats\b/i.test(allSql), "no player_stats table", "No player_stats table creation found.", "DZN uses player_profiles; player_stats must not be created.", "high");
check(/player_profiles/.test(readText("functions/api/public/leaderboards.ts") + readText("functions/api/public/server-leaderboard.ts") + readText("functions/api/public/home-stats.ts") + readText("functions/_lib/public-leaderboards.ts")), "player_profiles stats source", "player_profiles remains referenced by leaderboard/stat logic.", "player_profiles stats source was not found.", "high");

const dashboard = readText("components/onboarding/dashboard.tsx");
const autoStart = dashboard.indexOf("function AutoSyncDashboard");
const autoEnd = dashboard.indexOf("function LastSyncDetails");
const autoSurface = autoStart >= 0 && autoEnd > autoStart ? dashboard.slice(autoStart, autoEnd) : "";
for (const manualLabel of ["Check ADM Files", "Verify ADM Automation", "Backfill Missing ADM Now", "Recover Stuck Sync Locks", "Upload ADM Files", "Paste ADM Log Text", "Optional exact ADM filename", "Show ADM Technical Diagnostics"]) {
  check(!autoSurface.includes(manualLabel), `Sync Health hides ${manualLabel}`, `${manualLabel} is not in the owner Auto Sync surface.`, `${manualLabel} is exposed in owner Sync Health.`, "medium");
}

check(fileExists("functions/_lib/nitrado-diagnostics.ts"), "ADM diagnostics helper", "Nitrado diagnostics helper exists.", "Nitrado diagnostics helper missing.", "high");
check(fileExists("functions/api/autodev/adm-health.ts"), "ADM health endpoint", "ADM health endpoint exists.", "ADM health endpoint missing.", "high");
check(/latestClassifiedError|latestHttpStatus|importJobStatus/.test(readText("functions/api/autodev/adm-health.ts")), "ADM health summary shape", "ADM health endpoint exposes sanitized AutoDev summary fields.", "ADM health endpoint must expose ADM sync summary fields.", "medium");
for (const endpoint of ["functions/api/debug/nitrado-admin-logs.ts", "functions/api/debug/nitrado-file-read.ts", "functions/api/sync/adm/retry-unreadable.ts", "functions/api/sync/adm/run.ts", "functions/api/autodev/adm-health.ts"]) {
  check(readText(endpoint).includes("requireCronSecret") || readText(endpoint).includes("isCronAuthorized"), `${endpoint} protected`, `${endpoint} uses cron auth.`, `${endpoint} is missing cron auth.`, "high");
}
check(dirExists(".autodev/reports") || dirExists(".autodev"), "AutoDev reports directory", "AutoDev report path is available.", "AutoDev report path missing.", "low");

const report = makeReport("audit", checks, [
  "Review high-risk failures before making code changes.",
  "Keep GitHub ADM workflow manual-only; Cloudflare Worker remains primary auto-sync runner.",
  "Keep subscription-only AI spend policy in force unless a high-risk human-approved redesign explicitly changes it.",
]);
writeReport("audit", report);
if (!report.ok) process.exit(1);
