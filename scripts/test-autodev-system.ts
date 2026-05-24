import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { classifyPath, detectDestructiveMigration, classifyRecoverableProductionStatus } from "./autodev/risk-classifier";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const config = JSON.parse(read(".autodev/config.json"));
assert.equal(config.mode, "pr_only");
assert.equal(config.allowDirectMainPush, false);
assert.equal(config.allowAutoMergeLowRisk, false);
assert.equal(config.maxFixAttemptsPerRun, 3);
assert.equal(config.maxChangedFilesPerRun <= 25, true);

assert.equal(classifyPath("functions/api/auth/me.ts").risk, "high");
assert.equal(classifyPath("functions/api/billing/checkout.ts").risk, "high");
assert.equal(classifyPath("functions/_lib/crypto.ts", "TOKEN_ENCRYPTION_KEY").risk, "high");
assert.equal(classifyPath("migrations/9999_test.sql", "DROP TABLE player_profiles;").risk, "high");
assert.equal(classifyPath("docs/CODEX_AUTODEV.md").risk, "low");

assert.deepEqual(detectDestructiveMigration("DROP TABLE player_profiles;", "migrations/9999.sql").length > 0, true);
assert.deepEqual(detectDestructiveMigration("DELETE FROM player_profiles;", "migrations/9999.sql").length > 0, true);
assert.deepEqual(detectDestructiveMigration("CREATE TABLE player_stats (id TEXT);", "migrations/9999.sql").length > 0, true);
assert.deepEqual(detectDestructiveMigration("CREATE TABLE IF NOT EXISTS safe_table (id TEXT);", "migrations/9999.sql"), []);

assert.equal(classifyRecoverableProductionStatus("nitrado_upstream_down"), true);
assert.equal(classifyRecoverableProductionStatus("waiting_for_nitrado"), true);
assert.equal(classifyRecoverableProductionStatus("latest_adm_unreadable"), true);
assert.equal(classifyRecoverableProductionStatus("401"), false);
assert.equal(classifyRecoverableProductionStatus("403"), false);

const workflows = readdirSync(".github/workflows").filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
const workflowText = workflows.map((name) => read(`.github/workflows/${name}`)).join("\n");
for (const secret of ["DISCORD_CLIENT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SESSION_SECRET", "TOKEN_ENCRYPTION_KEY"]) {
  assert.equal(workflowText.includes(`secrets.${secret}`), false, `${secret} must not be referenced by GitHub workflows`);
}
assert.equal(read(".github/workflows/dzn-adm-sync.yml").includes("schedule:"), false);
assert.equal(read(".github/workflows/dzn-adm-sync.yml").includes("workflow_dispatch:"), true);
assert.equal(read("README.md").includes("Automatic ADM sync runs from a separate Cloudflare Worker"), true);
assert.equal(read("wrangler.adm-sync.toml").includes('name = "dzn-adm-sync-worker"'), true);
assert.equal(read("wrangler.adm-sync.toml").includes("crons ="), true);

const productionSmoke = read("scripts/autodev/production-smoke.ts");
assert.equal(productionSmoke.includes("/api/debug/nitrado-file-read"), true);
assert.equal(productionSmoke.includes("result.status === 401"), true);
assert.equal(productionSmoke.includes("Protected endpoint must return 401"), true);

const admWatch = read("scripts/autodev/adm-cycle-watch.ts");
assert.equal(admWatch.includes("classifyRecoverableProductionStatus"), true);
assert.equal(admWatch.includes("result.status === 401 || result.status === 403"), true);

const proposeFix = read("scripts/autodev/propose-fix.ts");
assert.equal(proposeFix.includes("AUTODEV_ENABLE_PROPOSE_FIX"), true);
assert.equal(proposeFix.includes("disabled by default"), true);

const scripts = JSON.parse(read("package.json")).scripts;
for (const script of ["autodev:audit", "autodev:quality", "autodev:production-smoke", "autodev:adm-watch", "autodev:create-issue", "autodev:risk", "test:autodev"]) {
  assert.equal(typeof scripts[script], "string", `${script} must exist`);
}

assert.equal(read("scripts/test-auto-sync-dashboard-ui.ts").includes("Check ADM Files"), true);
assert.equal(read("functions/api/autodev/adm-health.ts").includes("requireCronSecret"), true);
assert.equal(read("functions/api/autodev/adm-health.ts").includes("SELECT access_token"), false);
assert.equal(read("functions/api/autodev/adm-health.ts").includes("raw signed"), false);
assert.equal(existsSync(".autodev/config.json"), true);
assert.equal(existsSync("docs/CODEX_AUTODEV.md"), true);
assert.equal(existsSync(".github/workflows/dzn-autodev-audit.yml"), true);
assert.equal(existsSync(".github/workflows/dzn-post-deploy-verify.yml"), true);
assert.equal(existsSync(".github/workflows/dzn-adm-cycle-watch.yml"), true);

console.log("AutoDev system tests passed.");
