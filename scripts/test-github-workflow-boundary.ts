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
const dznPulsePreviewWorkflow = read(".github/workflows/dzn-pulse-preview.yml");
const dznPulseProductionRolloutWorkflow = read(".github/workflows/dzn-pulse-production-rollout.yml");
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

assert.equal(dznPulsePreviewWorkflow.includes("name: DZN Pulse Preview"), true);
assert.equal(dznPulsePreviewWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznPulsePreviewWorkflow.includes("\n  push:"), false);
assert.equal(dznPulsePreviewWorkflow.includes("\n  schedule:"), false);
assert.equal(dznPulsePreviewWorkflow.includes("CLOUDFLARE_PULSE_PREVIEW_TOKEN: ${{ secrets.CLOUDFLARE_PULSE_PREVIEW_TOKEN }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes('PULSE_CF_TOKEN="${CLOUDFLARE_PULSE_PREVIEW_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"'), true);
assert.equal(dznPulsePreviewWorkflow.includes("Missing CLOUDFLARE_PULSE_PREVIEW_TOKEN or CLOUDFLARE_API_TOKEN GitHub secret"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Cloudflare preview token is present but too short to be valid"), true);
assert.equal(dznPulsePreviewWorkflow.includes('printf "PULSE_CF_TOKEN=%s\\n" "$PULSE_CF_TOKEN"'), true);
assert.equal(dznPulsePreviewWorkflow.includes('printf "CLOUDFLARE_API_TOKEN=%s\\n" "$PULSE_CF_TOKEN"'), true);
assert.equal(dznPulsePreviewWorkflow.includes('echo "PULSE_CF_TOKEN=${PULSE_CF_TOKEN}"'), false);
assert.equal(dznPulsePreviewWorkflow.includes('echo "CLOUDFLARE_API_TOKEN=${PULSE_CF_TOKEN}"'), false);
assert.equal(dznPulsePreviewWorkflow.includes("Cloudflare token verify success=true"), true);
assert.equal(dznPulsePreviewWorkflow.includes("/user/tokens/verify"), true);
assert.equal(dznPulsePreviewWorkflow.indexOf("/user/tokens/verify") < dznPulsePreviewWorkflow.indexOf("/d1/database?per_page=100"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Cloudflare token invalid or expired."), true);
assert.equal(dznPulsePreviewWorkflow.includes("Cloudflare token lacks D1/account permission."), true);
assert.equal(dznPulsePreviewWorkflow.includes("confirm_preview_only:"), true);
assert.equal(dznPulsePreviewWorkflow.includes('confirm_preview_only must equal PREVIEW_ONLY'), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN Pulse preview may only run against feature/dzn-pulse / PR #11"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN Pulse preview input branch must never be main"), true);
assert.equal(dznPulsePreviewWorkflow.includes("pulse_preview"), true);
assert.equal(dznPulsePreviewWorkflow.includes("dzn_pulse_preview"), true);
assert.equal(dznPulsePreviewWorkflow.includes("preview_db_name must not equal the production D1 database name"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Preview D1 database id equals production D1 database id"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Refusing D1 command for non-preview database name"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Refusing migration for non-preview database name"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Refusing seed for non-preview database name"), true);
assert.equal(dznPulsePreviewWorkflow.includes("test -f migrations/0052_dzn_pulse.sql"), true);
assert.equal(dznPulsePreviewWorkflow.includes("wrangler.dzn-pulse-preview.toml"), true);
assert.equal(dznPulsePreviewWorkflow.includes('database_name = "${previewName}"'), true);
assert.equal(dznPulsePreviewWorkflow.includes('database_id = "${previewId}"'), true);
assert.equal(dznPulsePreviewWorkflow.includes("npx wrangler d1 migrations apply DB --config wrangler.dzn-pulse-preview.toml --remote"), true);
assert.equal(dznPulsePreviewWorkflow.includes("notification_campaigns"), true);
assert.equal(dznPulsePreviewWorkflow.includes("user_notifications"), true);
assert.equal(dznPulsePreviewWorkflow.includes("event_popup_dismissals"), true);
assert.equal(dznPulsePreviewWorkflow.includes("notification_preferences"), true);
assert.equal(dznPulsePreviewWorkflow.includes('DZN_DISCORD_NOTIFICATIONS_ENABLED: "false"'), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_PREVIEW_AUTH_DIAGNOSTICS"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_PREVIEW_DISCORD_CLIENT_ID: ${{ vars.DZN_PULSE_PREVIEW_DISCORD_CLIENT_ID }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_PREVIEW_DISCORD_CLIENT_SECRET: ${{ secrets.DZN_PULSE_PREVIEW_DISCORD_CLIENT_SECRET }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_PREVIEW_SESSION_SECRET: ${{ secrets.DZN_PULSE_PREVIEW_SESSION_SECRET }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes("npx wrangler pages secret put DISCORD_CLIENT_SECRET"), true);
assert.equal(dznPulsePreviewWorkflow.includes("npx wrangler pages secret put SESSION_SECRET"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Preview auth secrets are not runtime-readable"), true);
assert.equal(dznPulsePreviewWorkflow.includes("invalid_client"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_ENABLED=true DZN_DISCORD_NOTIFICATIONS_ENABLED=false npm run build"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Refusing to set DZN_PULSE_ENABLED on production Pages project"), true);
assert.equal(dznPulsePreviewWorkflow.includes('PRODUCTION_PAGES_PROJECT_NAME: dzn-network'), true);
assert.equal(dznPulsePreviewWorkflow.includes('fs.writeFileSync("wrangler.toml", wranglerToml)'), true);
assert.equal(dznPulsePreviewWorkflow.includes("previewRedirectUri = `${previewBaseUrl}/api/auth/discord/callback`"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DISCORD_REDIRECT_URI: { type: \"plain_text\", value: previewRedirectUri }"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_APP_URL: { type: \"plain_text\", value: previewBaseUrl }"), true);
assert.equal(dznPulsePreviewWorkflow.includes("deriveDiscordClientIdFromProductionAuthorize"), false);
assert.equal(dznPulsePreviewWorkflow.includes("https://dzn-network.pages.dev/api/auth/discord/start"), false);
assert.equal(dznPulsePreviewWorkflow.includes('process.env.DZN_PULSE_PREVIEW_DISCORD_CLIENT_ID || "1504270029795885178"'), true);
assert.equal(dznPulsePreviewWorkflow.includes("DISCORD_CLIENT_ID: { type: \"plain_text\", value: previewDiscordClientId }"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DISCORD_CLIENT_ID: previewDiscordClientId"), true);
assert.equal(dznPulsePreviewWorkflow.includes('[vars]'), true);
assert.equal(dznPulsePreviewWorkflow.includes("discordClientIdPresent"), true);
assert.equal(dznPulsePreviewWorkflow.includes("discordClientIdRuntimeProvided"), true);
assert.equal(dznPulsePreviewWorkflow.includes("discordClientSecretPresent"), true);
assert.equal(dznPulsePreviewWorkflow.includes("discordClientSecretRuntimeReadable"), true);
assert.equal(dznPulsePreviewWorkflow.includes("discordRedirectUriPresent"), true);
assert.equal(dznPulsePreviewWorkflow.includes("dznAppUrlPresent"), true);
assert.equal(dznPulsePreviewWorkflow.includes("sessionSecretPresent"), true);
assert.equal(dznPulsePreviewWorkflow.includes("sessionSecretRuntimeReadable"), true);
assert.equal(dznPulsePreviewWorkflow.includes("redirectUriHost"), true);
assert.equal(dznPulsePreviewWorkflow.includes("appUrlHost"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Discord auth start redirects to Discord."), true);
assert.equal(dznPulsePreviewWorkflow.includes("/api/auth/discord/start?returnTo=%2Fdzn-pulse"), true);
assert.equal(dznPulsePreviewWorkflow.includes("const timeout = setTimeout(() => controller.abort(), 45000);"), true);
assert.equal(dznPulsePreviewWorkflow.includes("retrying after"), true);
assert.equal(dznPulsePreviewWorkflow.includes("--project-name \"${PREVIEW_PROJECT_NAME}\""), true);
assert.equal(dznPulsePreviewWorkflow.includes("--project-name dzn-network"), false);
assert.equal(dznPulsePreviewWorkflow.includes("wrangler pages deploy out"), true);
assert.equal(dznPulsePreviewWorkflow.includes("const stableUrl = `https://${process.env.PREVIEW_PROJECT_NAME}.pages.dev`;"), true);
assert.equal(dznPulsePreviewWorkflow.includes("pulse-feature-on-immutable-url.txt"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Feature-on immutable preview URL"), true);
assert.equal(dznPulsePreviewWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznPulsePreviewWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznPulsePreviewWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznPulsePreviewWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznPulsePreviewWorkflow.includes("db:migrate:remote"), false);
assert.equal(dznPulsePreviewWorkflow.includes("dzn_network_db --remote"), false);
assert.equal(dznPulsePreviewWorkflow.includes("echo \"$CLOUDFLARE_API_TOKEN\""), false);
assert.equal(dznPulsePreviewWorkflow.includes("echo \"${CLOUDFLARE_API_TOKEN}\""), false);
assert.equal(dznPulsePreviewWorkflow.includes("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}"), true);
assert.equal(dznPulsePreviewWorkflow.includes("DZN_PULSE_SEED_LOCAL=1 npm run seed:dzn-pulse-demo"), true);
assert.equal(dznPulsePreviewWorkflow.includes("git check-ignore --quiet tmp/dzn-pulse-demo-seed.sql"), true);
assert.equal(dznPulsePreviewWorkflow.includes("npx wrangler d1 execute DB --config wrangler.dzn-pulse-preview.toml --remote --file tmp/dzn-pulse-demo-seed.sql"), true);
assert.equal(dznPulsePreviewWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(dznPulsePreviewWorkflow.includes("/api/public/servers"), true);
assert.equal(dznPulsePreviewWorkflow.includes("Worker exceeded resource limits"), true);

assert.equal(dznPulseProductionRolloutWorkflow.includes("name: DZN Pulse Production Rollout"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("confirm_production_rollout"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("DZN_PULSE_ENABLED: { type: \"plain_text\", value: \"true\" }"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: { type: \"plain_text\", value: \"false\" }"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("DZN_PULSE_ENABLED=true DZN_DISCORD_NOTIFICATIONS_ENABLED=false npm run build"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("npx wrangler d1 migrations list \"${PRODUCTION_D1_DATABASE_NAME}\" --remote"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("npx wrangler d1 migrations apply \"${PRODUCTION_D1_DATABASE_NAME}\" --remote"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("Migration 0052_dzn_pulse.sql is pending; stopping before enabling DZN Pulse."), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("Production D1 Pulse schema already exists; no migration was run."), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("notification_campaigns"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("user_notifications"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("event_popup_dismissals"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("notification_preferences"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("idx_notification_campaigns_active_priority"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("idx_user_notifications_user_read_created"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("idx_event_popup_dismissals_user_campaign_scope"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED = \"true\""), false);

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
