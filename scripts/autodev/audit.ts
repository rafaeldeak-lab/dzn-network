import { detectDestructiveMigration } from "./risk-classifier";
import { dirExists, fail, fileExists, listFiles, loadConfig, makeReport, pass, readText, writeReport, type AutoDevCheck } from "./lib";

const config = loadConfig();
const checks: AutoDevCheck[] = [];
const packageJson = JSON.parse(readText("package.json") || "{}") as { scripts?: Record<string, string> };
const scripts = packageJson.scripts ?? {};

function check(condition: boolean, name: string, passMessage: string, failMessage: string, risk: "low" | "medium" | "high" = "medium") {
  checks.push(condition ? pass(name, passMessage) : fail(name, failMessage, undefined, risk));
}

for (const scriptName of ["test", "lint", "build", "worker:adm-sync:dry-run"]) {
  check(Boolean(scripts[scriptName]), `package script ${scriptName}`, `${scriptName} exists.`, `${scriptName} is missing.`, "high");
}

check(config.mode === "pr_only", "default mode", "AutoDev defaults to pr_only.", "AutoDev must default to pr_only.", "high");
check(config.scope === "adm_tracking_only", "ADM-only scope", "AutoDev scope is adm_tracking_only.", "AutoDev must be scoped to ADM tracking only.", "high");
check(config.admOnly?.enabled === true, "ADM-only enabled", "ADM-only guard is enabled.", "ADM-only guard must be enabled.", "high");
check(config.allowDirectMainPush === false, "direct main push disabled", "Direct main push disabled by default.", "Direct main push must be disabled.", "high");
check(config.allowAutoMergeLowRisk === false, "auto-merge disabled", "Auto-merge disabled by default.", "Auto-merge must be explicitly enabled.", "high");
check(config.allowCodexHighRiskFixes === false, "Codex high-risk disabled", "Codex high-risk fixes disabled.", "Codex high-risk fixes must be disabled.", "high");
check(fileExists("wrangler.adm-sync.toml"), "ADM Worker config", "wrangler.adm-sync.toml exists.", "ADM Worker config missing.", "high");
check(/crons\s*=/.test(readText("wrangler.adm-sync.toml")), "ADM Worker cron", "ADM Worker cron is configured.", "ADM Worker cron missing.", "high");
check(/name\s*=\s*"dzn-adm-sync-worker"/.test(readText("wrangler.adm-sync.toml")), "ADM Worker primary", "dzn-adm-sync-worker remains configured.", "ADM Worker name missing.", "high");
check(Boolean(scripts["autodev:pick-safe-issue"]), "safe issue picker script", "ADM safe issue picker script exists.", "autodev:pick-safe-issue is missing.", "medium");

const admWorkflow = readText(".github/workflows/dzn-adm-sync.yml");
check(/workflow_dispatch:/.test(admWorkflow), "ADM workflow manual dispatch", "ADM backup workflow is manually triggerable.", "ADM backup workflow must support workflow_dispatch.", "medium");
check(!/schedule:/.test(admWorkflow) && !/- cron:/.test(admWorkflow), "ADM workflow manual-only", "ADM backup workflow has no schedule.", "ADM backup workflow must remain manual-only.", "high");
check(/^name:\s*DZN ADM Worker Manual Trigger/m.test(admWorkflow), "ADM workflow name", "ADM manual workflow name is ADM-scoped.", "ADM manual workflow name must be ADM-scoped.", "medium");
check(/^name:\s*DZN Nitrado ADM Diagnostics/m.test(readText(".github/workflows/dzn-nitrado-diagnostics.yml")), "diagnostics workflow name", "Nitrado diagnostics workflow name is ADM-scoped.", "Diagnostics workflow name must be ADM-scoped.", "medium");
check(!/schedule:/.test(readText(".github/workflows/dzn-nitrado-diagnostics.yml")), "diagnostics workflow manual-only", "Nitrado ADM diagnostics workflow is manual-only.", "Nitrado ADM diagnostics workflow must not be scheduled.", "high");

const allWorkflowText = listFiles(".github/workflows", (file) => /\.ya?ml$/i.test(file)).map((file) => readText(file)).join("\n");
for (const secret of ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SESSION_SECRET", "TOKEN_ENCRYPTION_KEY", "MOCK_AUTH", "MOCK_NITRADO"]) {
  check(!allWorkflowText.includes(`secrets.${secret}`), `workflow runtime secret ${secret}`, `${secret} is not referenced by workflows.`, `${secret} must not be copied into GitHub workflows.`, "high");
}
for (const workflowName of ["DZN ADM AutoDev Audit", "DZN ADM Post Deploy Verify", "DZN ADM Cycle Watch"]) {
  check(allWorkflowText.includes(`name: ${workflowName}`), `workflow ${workflowName}`, `${workflowName} exists.`, `${workflowName} is missing or not ADM-scoped.`, "medium");
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
for (const endpoint of ["functions/api/debug/nitrado-file-read.ts", "functions/api/sync/adm/retry-unreadable.ts", "functions/api/sync/adm/run.ts", "functions/api/autodev/adm-health.ts"]) {
  check(readText(endpoint).includes("requireCronSecret") || readText(endpoint).includes("isCronAuthorized"), `${endpoint} protected`, `${endpoint} uses cron auth.`, `${endpoint} is missing cron auth.`, "high");
}

check(dirExists(".autodev/reports") || dirExists(".autodev"), "AutoDev reports directory", "AutoDev report path is available.", "AutoDev report path missing.", "low");

const report = makeReport("audit", checks, [
  "Review high-risk failures before making code changes.",
  "Keep GitHub ADM workflow manual-only; Cloudflare Worker remains primary auto-sync runner.",
]);
writeReport("audit", report);
if (!report.ok) process.exit(1);
