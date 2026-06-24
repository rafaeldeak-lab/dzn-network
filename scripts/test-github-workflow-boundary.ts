import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const admWorkflow = read(".github/workflows/dzn-adm-sync.yml");
const diagnosticsWorkflow = read(".github/workflows/dzn-nitrado-diagnostics.yml");
const autoUpdateWorkflow = read(".github/workflows/dzn-auto-update-schedulers.yml");
const autoUpdateWorkerDeployWorkflow = read(".github/workflows/dzn-auto-update-worker-deploy.yml");
const admWorkerDeployWorkflow = read(".github/workflows/dzn-adm-worker-deploy.yml");
const autoUpdateWorkerConfig = read("wrangler.auto-update.toml");
const admWorkerConfig = read("wrangler.adm-sync.toml");
const workflows = [
  [".github/workflows/dzn-adm-sync.yml", admWorkflow],
  [".github/workflows/dzn-nitrado-diagnostics.yml", diagnosticsWorkflow],
  [".github/workflows/dzn-auto-update-schedulers.yml", autoUpdateWorkflow],
  [".github/workflows/dzn-auto-update-worker-deploy.yml", autoUpdateWorkerDeployWorkflow],
  [".github/workflows/dzn-adm-worker-deploy.yml", admWorkerDeployWorkflow],
] as const;

assert.equal(admWorkflow.includes("name: DZN ADM Worker Manual Trigger"), true);
assert.equal(admWorkflow.includes("workflow_dispatch:"), true);
assert.equal(admWorkflow.includes("schedule:"), false);
assert.equal(admWorkflow.includes("- cron:"), false);
assert.equal(admWorkflow.includes("/api/sync/adm/run"), true);
assert.equal(admWorkflow.includes("/api/sync/metadata/run"), false);
assert.equal(admWorkflow.includes("/api/sync/public-snapshots/run"), false);
assert.equal(admWorkflow.includes("/api/sync/discord-posts/run"), false);
assert.equal(admWorkflow.includes("/api/sync/ctf-scorecards/run"), false);

assert.equal(diagnosticsWorkflow.includes("workflow_dispatch:"), true);
assert.equal(diagnosticsWorkflow.includes("schedule:"), false);
assert.equal(diagnosticsWorkflow.includes("- cron:"), false);

assert.equal(autoUpdateWorkflow.includes("workflow_dispatch:"), true);
assert.equal(autoUpdateWorkflow.includes("schedule:"), true);
assert.equal(autoUpdateWorkflow.includes('cron: "17 * * * *"'), true);
assert.equal(autoUpdateWorkflow.includes("DZN Auto Update Schedulers Backup"), true);
assert.equal(autoUpdateWorkflow.includes("/api/sync/metadata/run"), true);
assert.equal(autoUpdateWorkflow.includes("/api/cron/server-wars/refresh"), true);
assert.equal(autoUpdateWorkflow.includes("/api/sync/discord-posts/run"), true);
assert.equal(autoUpdateWorkflow.includes("/api/sync/adm/run"), false);
assert.equal(autoUpdateWorkerConfig.includes('name = "dzn-auto-update-worker"'), true);
assert.equal(autoUpdateWorkerConfig.includes('crons = ["* * * * *"]'), true);

assert.equal(autoUpdateWorkerDeployWorkflow.includes("workflow_dispatch:"), true);
assert.equal(autoUpdateWorkerDeployWorkflow.includes("push:"), false);
assert.equal(autoUpdateWorkerDeployWorkflow.includes("CLOUDFLARE_API_TOKEN"), true);
assert.equal(autoUpdateWorkerDeployWorkflow.includes("CLOUDFLARE_ACCOUNT_ID"), true);
assert.equal(autoUpdateWorkerDeployWorkflow.includes("wrangler secret put DZN_CRON_SECRET"), true);
assert.equal(autoUpdateWorkerDeployWorkflow.includes("/workers/scripts/dzn-auto-update-worker/schedules"), true);

assert.equal(admWorkerDeployWorkflow.includes("name: DZN ADM Worker Deploy"), true);
assert.equal(admWorkerDeployWorkflow.includes("workflow_dispatch:"), true);
assert.equal(admWorkerDeployWorkflow.includes("\n  push:"), false);
assert.equal(admWorkerDeployWorkflow.includes("\n  schedule:"), false);
assert.equal(admWorkerDeployWorkflow.includes("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}"), true);
assert.equal(admWorkerDeployWorkflow.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}"), true);
assert.equal(admWorkerDeployWorkflow.includes("wrangler.adm-sync.toml"), true);
assert.equal(admWorkerDeployWorkflow.includes("dzn-adm-sync-worker"), true);
assert.equal(admWorkerDeployWorkflow.includes("npm run worker:adm-sync:dry-run"), true);
assert.equal(admWorkerDeployWorkflow.includes("adm-worker-secrets-before.json"), true);
assert.equal(admWorkerDeployWorkflow.includes('names.includes("TOKEN_ENCRYPTION_KEY")'), true);
assert.equal(admWorkerDeployWorkflow.includes("secrets.TOKEN_ENCRYPTION_KEY"), false);
assert.equal(admWorkerDeployWorkflow.includes("printf \"%s\" \"$CRON_SECRET\" |"), true);
assert.equal(admWorkerDeployWorkflow.includes("wrangler secret put DZN_CRON_SECRET"), true);
assert.equal(admWorkerDeployWorkflow.includes("echo \"$CRON_SECRET\""), false);
assert.equal(admWorkerDeployWorkflow.includes("echo \"${CRON_SECRET}\""), false);
assert.equal(admWorkerDeployWorkflow.includes("/workers/scripts/dzn-adm-sync-worker/schedules"), true);
assert.equal(admWorkerDeployWorkflow.includes("* * * * *"), true);
assert.equal(admWorkerDeployWorkflow.includes("schedule?.cron === \"* * * * *\""), true);
assert.equal(admWorkerDeployWorkflow.includes("schedule?.cron_trigger?.cron === \"* * * * *\""), true);
assert.equal(admWorkerDeployWorkflow.includes("schedule?.schedule === \"* * * * *\""), true);
assert.equal(admWorkerDeployWorkflow.includes("pages deploy"), false);
assert.equal(admWorkerDeployWorkflow.includes("wrangler pages"), false);
assert.equal(admWorkerDeployWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(admWorkerDeployWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(admWorkerDeployWorkflow.includes("wrangler d1"), false);
assert.equal(admWorkerDeployWorkflow.includes("npm run migrate"), false);
assert.equal(admWorkerConfig.includes('name = "dzn-adm-sync-worker"'), true);
assert.equal(admWorkerConfig.includes('crons = ["* * * * *"]'), true);

const runtimeOnlySecretPatterns = [
  /secrets\.DISCORD_BOT_TOKEN/,
  /secrets\.DISCORD_CLIENT_SECRET/,
  /secrets\.STRIPE_SECRET_KEY/,
  /secrets\.STRIPE_WEBHOOK_SECRET/,
  /secrets\.SESSION_SECRET/,
  /secrets\.TOKEN_ENCRYPTION_KEY/,
  /secrets\.MOCK_AUTH/,
  /secrets\.MOCK_NITRADO/,
  /secrets\.NEXT_PUBLIC_/,
];

for (const [path, source] of workflows) {
  assert.equal(source.includes("${{ secrets.DZN_CRON_SECRET }}"), true, `${path} should allow DZN_CRON_SECRET`);
  assert.equal(source.includes("${{ secrets.SYNC_CRON_SECRET }}"), true, `${path} should allow SYNC_CRON_SECRET fallback`);
  for (const pattern of runtimeOnlySecretPatterns) {
    assert.equal(pattern.test(source), false, `${path} must not reference runtime-only secret ${pattern}`);
  }
}

const secretsMatrix = read("docs/SECRETS_MATRIX.md");
assert.equal(secretsMatrix.includes("GitHub Actions is not the primary ADM auto-sync runner."), true);
assert.equal(secretsMatrix.includes("DZN_CRON_SECRET"), true);
assert.equal(secretsMatrix.includes("SYNC_CRON_SECRET"), true);
assert.equal(secretsMatrix.includes("Do not copy all Cloudflare runtime secrets into GitHub."), true);
assert.equal(secretsMatrix.includes("TOKEN_ENCRYPTION_KEY"), true);
assert.equal(secretsMatrix.includes("dzn-adm-sync-worker"), true);

console.log("GitHub workflow boundary tests passed.");
