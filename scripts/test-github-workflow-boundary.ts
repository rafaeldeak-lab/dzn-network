import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function extractInsertColumns(source: string, table: string) {
  const match = source.match(new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(([\\s\\S]*?)\\)\\s*VALUES`, "i"));
  assert.notEqual(match, null, `Expected lifecycle preview seed INSERT INTO ${table}.`);
  return match![1]
    .split(",")
    .map((column) => column.trim().replace(/^["'`]|["'`]$/g, ""))
    .filter(Boolean);
}

function assertInsertColumnsKnown(source: string, table: string, knownColumns: readonly string[]) {
  const known = new Set(knownColumns);
  const columns = extractInsertColumns(source, table);
  const missing = columns.filter((column) => !known.has(column));
  assert.deepEqual(missing, [], `${table} seed references missing columns.`);
}

type DiscordAnnouncementsPreviewInput = {
  workflowRefName: string;
  inputBranch: string;
  mode: string;
  confirmPreviewOnly?: string;
  previewProjectName?: string;
  previewDbName?: string;
  discordNotificationsEnabled?: string;
  discordServerAnnouncementsEnabled?: string;
};

function acceptsDiscordAnnouncementsPreviewInput(input: DiscordAnnouncementsPreviewInput) {
  const confirmPreviewOnly = input.confirmPreviewOnly ?? "PREVIEW_ONLY";
  const previewProjectName = input.previewProjectName ?? "dzn-network-discord-announcements-preview";
  const previewDbName = input.previewDbName ?? "dzn_network_db_discord_announcements_preview_alignment_test";
  const discordNotificationsEnabled = input.discordNotificationsEnabled ?? "false";
  const discordServerAnnouncementsEnabled = input.discordServerAnnouncementsEnabled ?? "false";
  if (confirmPreviewOnly !== "PREVIEW_ONLY") return false;
  if (!input.inputBranch) return false;
  if (input.workflowRefName === "release/main-runtime-alignment" && input.inputBranch !== "release/main-runtime-alignment") return false;
  if (input.inputBranch === "release/main-runtime-alignment" && input.workflowRefName !== "release/main-runtime-alignment") return false;
  if (["main", "master", "production"].includes(input.inputBranch)) return false;
  if (!["feature/discord-server-announcements", "release/main-runtime-alignment"].includes(input.inputBranch)) return false;
  if (/preview-project|production-project|production_pages_project|production_db|dzn-network|dzn_network_db/.test(input.inputBranch)) return false;
  if (!["validate", "phase1-flag-off", "phase2-migration", "verify-preview", "full-preview"].includes(input.mode)) return false;
  if (input.inputBranch === "release/main-runtime-alignment") {
    if (input.mode !== "full-preview") return false;
    if (previewProjectName !== "dzn-network-discord-announcements-preview") return false;
    if (!previewDbName.startsWith("dzn_network_db_discord_announcements_preview_alignment_")) return false;
  }
  if (previewProjectName === "dzn-network") return false;
  if (!previewProjectName.includes("discord") || !previewProjectName.includes("announcements") || !previewProjectName.includes("preview")) return false;
  if (previewDbName === "dzn_network_db") return false;
  if (!previewDbName.includes("discord_announcements_preview") && !previewDbName.includes("discord_server_announcements_preview")) return false;
  if (discordNotificationsEnabled !== "false") return false;
  if (discordServerAnnouncementsEnabled !== "false") return false;
  return true;
}

function legacyAdvertEnvScanFails(path: string, source: string) {
  const runtimePath =
    path === ".env.example" ||
    path === "cloudflare-env.d.ts" ||
    path === "package.json" ||
    path.startsWith("functions/") ||
    path.startsWith("components/");
  return runtimePath && source.includes("DZN_DISCORD_ADVERTISE_CHANNEL_ID");
}

function topLevelBlock(source: string, key: string) {
  const match = source.match(new RegExp(`^${key}:\\r?\\n`, "m"));
  assert.notEqual(match, null, `Expected top-level ${key} block.`);
  const rest = source.slice(match!.index! + match![0].length);
  const nextTopLevel = rest.search(/^\S/m);
  return nextTopLevel === -1 ? rest : rest.slice(0, nextTopLevel);
}

function hasWorkflowTrigger(source: string, trigger: string) {
  return new RegExp(`^  ${trigger}:`, "m").test(topLevelBlock(source, "on"));
}

type AutoUpdateEventContext = {
  eventName: string;
  confirmProductionUpdates?: string;
  taskSelection?: string;
};

const autoUpdateKnownTasks = ["metadata-player-count", "server-wars", "discord-posts"] as const;

function evaluateAutoUpdateSchedulerRequests(context: AutoUpdateEventContext) {
  const taskSelection = context.taskSelection ?? (context.eventName === "workflow_dispatch" ? "all" : "all");
  const validTasks = new Set(["all", ...autoUpdateKnownTasks]);
  if (!validTasks.has(taskSelection)) {
    return { accepted: false, reason: "invalid_task", requests: [] as string[] };
  }
  if (context.eventName === "workflow_dispatch") {
    if (context.confirmProductionUpdates !== "APPROVE_SCHEDULED_PRODUCTION_UPDATES") {
      return { accepted: false, reason: "bad_confirmation", requests: [] as string[] };
    }
    return {
      accepted: true,
      reason: "approved_dispatch",
      requests: taskSelection === "all" ? [...autoUpdateKnownTasks] : [taskSelection],
    };
  }
  return { accepted: false, reason: "unsupported_event", requests: [] as string[] };
}

const admWorkflow = read(".github/workflows/dzn-adm-sync.yml");
const diagnosticsWorkflow = read(".github/workflows/dzn-nitrado-diagnostics.yml");
const autoUpdateWorkflow = read(".github/workflows/dzn-auto-update-schedulers.yml");
const autoUpdateWorkerDeployWorkflow = read(".github/workflows/dzn-auto-update-worker-deploy.yml");
const admWorkerDeployWorkflow = read(".github/workflows/dzn-adm-worker-deploy.yml");
const dznPulsePreviewWorkflow = read(".github/workflows/dzn-pulse-preview.yml");
const dznPulseProductionRolloutWorkflow = read(".github/workflows/dzn-pulse-production-rollout.yml");
const dznServerLifecyclePreviewWorkflow = read(".github/workflows/dzn-server-lifecycle-preview.yml");
const dznServerLifecycleProductionRolloutWorkflow = read(".github/workflows/dzn-server-lifecycle-production-rollout.yml");
const dznPagesRuntimeProductionDeployWorkflow = read(".github/workflows/dzn-pages-runtime-production-deploy.yml");
const dznOwnerConsolePreviewWorkflow = read(".github/workflows/dzn-owner-console-preview.yml");
const dznOwnerConsoleProductionRolloutWorkflow = read(".github/workflows/dzn-owner-console-production-rollout.yml");
const dznDiscordControlPreviewWorkflow = read(".github/workflows/dzn-discord-control-preview.yml");
const dznDiscordControlProductionRolloutWorkflow = read(".github/workflows/dzn-discord-control-production-rollout.yml");
const dznDiscordControlPhase2aPreviewWorkflow = read(".github/workflows/dzn-discord-control-phase-2a-preview.yml");
const dznDiscordControlPhase2aProductionRolloutWorkflow = read(".github/workflows/dzn-discord-control-phase-2a-production-rollout.yml");
const dznDiscordServerAnnouncementsPreviewWorkflow = read(".github/workflows/dzn-discord-server-announcements-preview.yml");
const dznDiscordServerAnnouncementsProductionRolloutWorkflow = read(".github/workflows/dzn-discord-server-announcements-production-rollout.yml");
const dznProductionReadonlyDiagnosticsWorkflow = read(".github/workflows/dzn-production-readonly-diagnostics.yml");
const protectedRouteAuthRepairWorkflow = read(".github/workflows/dzn-protected-route-auth-repair.yml");
const productionDiscordAuthRepairWorkflow = read(".github/workflows/dzn-production-discord-auth-repair.yml");
const autoUpdateWorkerConfig = read("wrangler.auto-update.toml");
const admWorkerConfig = read("wrangler.adm-sync.toml");
const workflows = [
  [".github/workflows/dzn-adm-sync.yml", admWorkflow],
  [".github/workflows/dzn-nitrado-diagnostics.yml", diagnosticsWorkflow],
  [".github/workflows/dzn-auto-update-schedulers.yml", autoUpdateWorkflow],
  [".github/workflows/dzn-auto-update-worker-deploy.yml", autoUpdateWorkerDeployWorkflow],
  [".github/workflows/dzn-adm-worker-deploy.yml", admWorkerDeployWorkflow],
  [".github/workflows/dzn-protected-route-auth-repair.yml", protectedRouteAuthRepairWorkflow],
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

assert.equal(autoUpdateWorkflow.includes("name: DZN Auto Update Schedulers"), true);
assert.equal(autoUpdateWorkflow.includes("workflow_dispatch:"), true);
assert.equal(hasWorkflowTrigger(autoUpdateWorkflow, "workflow_dispatch"), true);
assert.equal(autoUpdateWorkflow.includes("schedule:"), false);
assert.equal(hasWorkflowTrigger(autoUpdateWorkflow, "schedule"), false);
assert.equal(autoUpdateWorkflow.includes("- cron:"), false);
assert.equal(autoUpdateWorkflow.includes('cron: "17 * * * *"'), false);
assert.equal(hasWorkflowTrigger(autoUpdateWorkflow, "push"), false);
assert.equal(hasWorkflowTrigger(autoUpdateWorkflow, "pull_request"), false);
assert.equal(hasWorkflowTrigger(autoUpdateWorkflow, "workflow_run"), false);
assert.equal(hasWorkflowTrigger(autoUpdateWorkflow, "repository_dispatch"), false);
assert.equal(hasWorkflowTrigger(autoUpdateWorkflow, "release"), false);
assert.equal(hasWorkflowTrigger(autoUpdateWorkflow, "issues"), false);
assert.equal(autoUpdateWorkflow.includes("confirm_production_updates:"), true);
assert.equal(autoUpdateWorkflow.includes("APPROVE_SCHEDULED_PRODUCTION_UPDATES"), true);
assert.equal(autoUpdateWorkflow.includes('confirm_production_updates must equal APPROVE_SCHEDULED_PRODUCTION_UPDATES'), true);
assert.equal(autoUpdateWorkflow.includes("type: choice"), true);
assert.equal(autoUpdateWorkflow.includes("- all"), true);
assert.equal(autoUpdateWorkflow.includes("- metadata-player-count"), true);
assert.equal(autoUpdateWorkflow.includes("- server-wars"), true);
assert.equal(autoUpdateWorkflow.includes("- discord-posts"), true);
assert.equal(autoUpdateWorkflow.includes("PRODUCTION_APP_URL: https://dzn-network.pages.dev"), true);
assert.equal(autoUpdateWorkflow.includes("DZN_APP_URL"), false);
assert.equal(autoUpdateWorkflow.includes("production_base_url"), false);
assert.equal(autoUpdateWorkflow.includes("inputs.production"), false);
assert.equal(autoUpdateWorkflow.includes("vars.DZN_APP_URL"), false);
assert.equal(autoUpdateWorkflow.includes('parsed.protocol !== "https:"'), true);
assert.equal(autoUpdateWorkflow.includes('parsed.hostname !== "dzn-network.pages.dev"'), true);
assert.equal(autoUpdateWorkflow.includes('parsed.origin !== "https://dzn-network.pages.dev"'), true);
assert.equal(autoUpdateWorkflow.includes("localhost"), true);
assert.equal(autoUpdateWorkflow.includes("127.0.0.1"), true);
assert.equal(autoUpdateWorkflow.includes("Production updates are not allowed for event"), true);
assert.equal(autoUpdateWorkflow.includes("Production POSTs are allowed only for approved workflow_dispatch."), true);
assert.equal(
  autoUpdateWorkflow.includes("github.event_name == 'workflow_dispatch' && inputs.confirm_production_updates == 'APPROVE_SCHEDULED_PRODUCTION_UPDATES'"),
  true,
);
assert.equal(autoUpdateWorkflow.includes("concurrency:"), true);
assert.equal(autoUpdateWorkflow.includes("group: dzn-auto-update-schedulers-production-updates"), true);
assert.equal(autoUpdateWorkflow.includes("cancel-in-progress: false"), true);
assert.equal(topLevelBlock(autoUpdateWorkflow, "permissions").includes("contents: read"), true);
assert.equal(topLevelBlock(autoUpdateWorkflow, "permissions").includes("contents: write"), false);
assert.equal(topLevelBlock(autoUpdateWorkflow, "permissions").includes("actions: write"), false);
assert.equal(topLevelBlock(autoUpdateWorkflow, "permissions").includes("deployments: write"), false);
assert.equal(topLevelBlock(autoUpdateWorkflow, "permissions").includes("pull-requests: write"), false);
assert.equal(topLevelBlock(autoUpdateWorkflow, "permissions").includes("packages: write"), false);
assert.equal(topLevelBlock(autoUpdateWorkflow, "permissions").includes("id-token: write"), false);
assert.equal(autoUpdateWorkflow.includes("DZN Auto Update Schedulers Backup"), true);
assert.equal(autoUpdateWorkflow.includes("/api/sync/metadata/run"), true);
assert.equal(autoUpdateWorkflow.includes("/api/cron/server-wars/refresh"), true);
assert.equal(autoUpdateWorkflow.includes("/api/sync/discord-posts/run"), true);
assert.equal(autoUpdateWorkflow.includes("/api/sync/adm/run"), false);
assert.equal(autoUpdateWorkflow.includes("-X POST"), true);
assert.equal(autoUpdateWorkflow.includes("--max-time 75"), true);
assert.equal(autoUpdateWorkflow.includes("Idempotency-Key: dzn-auto-update-"), true);
assert.equal(autoUpdateWorkflow.includes("echo \"$CRON_SECRET\""), false);
assert.equal(autoUpdateWorkflow.includes("echo \"${CRON_SECRET}\""), false);
assert.equal(autoUpdateWorkflow.includes("set -x"), false);
assert.equal(autoUpdateWorkflow.includes("::add-mask::$CRON_SECRET"), true);
assert.equal(autoUpdateWorkflow.includes("https://discord.com/api"), false);
assert.equal(autoUpdateWorkflow.includes("/channels/"), false);
assert.equal(autoUpdateWorkflow.includes("SEND_TEST_EMBED"), false);
assert.equal(autoUpdateWorkflow.includes('DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: "false"'), true);
assert.equal(autoUpdateWorkflow.includes('DZN_DISCORD_NOTIFICATIONS_ENABLED: "false"'), true);
assert.equal(autoUpdateWorkflow.includes('DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: "true"'), false);
assert.equal(autoUpdateWorkflow.includes('DZN_DISCORD_NOTIFICATIONS_ENABLED: "true"'), false);
assert.equal(autoUpdateWorkflow.includes("wrangler d1 migrations apply"), false);
assert.equal(autoUpdateWorkflow.includes("npx wrangler d1 migrations apply"), false);
assert.equal(/wrangler\s+d1\s+execute/i.test(autoUpdateWorkflow), false);
assert.equal(autoUpdateWorkflow.includes("wrangler pages deploy"), false);
assert.equal(autoUpdateWorkflow.includes("wrangler deploy"), false);

assert.deepEqual(evaluateAutoUpdateSchedulerRequests({ eventName: "push" }), {
  accepted: false,
  reason: "unsupported_event",
  requests: [],
});
assert.deepEqual(evaluateAutoUpdateSchedulerRequests({ eventName: "pull_request" }), {
  accepted: false,
  reason: "unsupported_event",
  requests: [],
});
assert.deepEqual(
  evaluateAutoUpdateSchedulerRequests({
    eventName: "workflow_dispatch",
    confirmProductionUpdates: "APPROVE_SCHEDULED_PRODUCTION_UPDATES ",
    taskSelection: "all",
  }),
  { accepted: false, reason: "bad_confirmation", requests: [] },
);
assert.deepEqual(
  evaluateAutoUpdateSchedulerRequests({
    eventName: "workflow_dispatch",
    confirmProductionUpdates: "approve_scheduled_production_updates",
    taskSelection: "all",
  }),
  { accepted: false, reason: "bad_confirmation", requests: [] },
);
assert.deepEqual(evaluateAutoUpdateSchedulerRequests({ eventName: "schedule" }), {
  accepted: false,
  reason: "unsupported_event",
  requests: [],
});
assert.deepEqual(
  evaluateAutoUpdateSchedulerRequests({
    eventName: "workflow_dispatch",
    confirmProductionUpdates: "APPROVE_SCHEDULED_PRODUCTION_UPDATES",
    taskSelection: "server-wars",
  }),
  { accepted: true, reason: "approved_dispatch", requests: ["server-wars"] },
);
assert.deepEqual(
  evaluateAutoUpdateSchedulerRequests({
    eventName: "workflow_dispatch",
    confirmProductionUpdates: "APPROVE_SCHEDULED_PRODUCTION_UPDATES",
    taskSelection: "/api/sync/metadata/run",
  }),
  { accepted: false, reason: "invalid_task", requests: [] },
);
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

assert.equal(dznServerLifecyclePreviewWorkflow.includes("name: DZN Server Lifecycle Preview"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("\n  push:"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("\n  schedule:"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("feature/server-lifecycle-resource-control"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("confirm_preview_only:"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("confirm_preview_only must equal PREVIEW_ONLY"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Preview branch must never be main."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("server_lifecycle_preview"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("lifecycle_preview"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Preview Pages project must not equal the production Pages project."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Preview Pages project name must contain lifecycle and preview."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing D1 command for non-preview lifecycle database name."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing migration for non-preview lifecycle database name."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing preview seed for non-preview lifecycle database name."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Resolve or create preview Pages project"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing to resolve lifecycle preview against production Pages project."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing non-preview lifecycle Pages project name."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Preview D1 database id equals production D1 database id"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing preview Pages project configuration because preview D1 id equals production D1 id."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Refusing preview deploy because preview D1 id equals production D1 id."), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("migrations/0054_server_lifecycle_resource_control.sql"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("npx wrangler d1 migrations apply DB --config wrangler.server-lifecycle-preview.toml --remote"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("lifecycle_status"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("next_adm_discovery_at"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("next_retry_after"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("archived_hidden"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("legacy_offline"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("active_degraded"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("nitrado_upstream_down"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("stale_monitoring"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("token_needs_resave"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("final_sync_pending"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("final_sync_complete"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_archived"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_legacy"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_token_needs_resave"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_backoff"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_no_due_work"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("skipped_final_sync_complete"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("lifecycle-nuketown-server"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("18765761"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("lifecycle-pandora-server"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("lifecycle-warlords-server"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("900002"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("discord_guild_id"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("nitrado_service_id"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("ip_address"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("player_slots"), true);
assertInsertColumnsKnown(dznServerLifecyclePreviewWorkflow, "users", [
  "id",
  "discord_id",
  "username",
  "avatar",
  "created_at",
  "updated_at",
]);
assertInsertColumnsKnown(dznServerLifecyclePreviewWorkflow, "discord_guilds", [
  "id",
  "guild_id",
  "owner_user_id",
  "name",
  "icon",
  "icon_url",
  "permissions",
  "is_owner",
  "created_at",
  "updated_at",
]);
assertInsertColumnsKnown(dznServerLifecyclePreviewWorkflow, "linked_servers", [
  "id",
  "user_id",
  "guild_id",
  "discord_guild_id",
  "nitrado_service_id",
  "nitrado_service_name",
  "server_name",
  "server_type",
  "server_category",
  "ip_address",
  "player_slots",
  "public_slug",
  "status",
  "listing_visibility",
  "lifecycle_status",
  "lifecycle_reason",
  "lifecycle_updated_at",
  "owner_action_required",
  "owner_action_reason",
  "created_at",
  "updated_at",
]);
assertInsertColumnsKnown(dznServerLifecyclePreviewWorkflow, "server_public_cache", [
  "id",
  "guild_id",
  "plan_key",
  "public_server_name",
  "current_player_count",
  "max_player_count",
  "server_online",
  "server_status",
  "last_status_update_at",
  "updated_at",
]);
assertInsertColumnsKnown(dznServerLifecyclePreviewWorkflow, "server_sync_state", [
  "id",
  "guild_id",
  "last_status_check_at",
  "last_adm_discovery_check_at",
  "last_adm_pull_at",
  "next_status_check_due_at",
  "next_adm_discovery_due_at",
  "next_adm_pull_due_at",
  "next_metadata_check_at",
  "next_player_count_check_at",
  "next_adm_discovery_at",
  "next_adm_processing_at",
  "next_retry_after",
  "last_skip_reason",
  "created_at",
  "updated_at",
]);
assert.equal(/INSERT INTO linked_servers \([\s\S]*\bserver_id\b/.test(dznServerLifecyclePreviewWorkflow), false);
assert.equal(/INSERT INTO linked_servers \([\s\S]*\bserver_ip\b/.test(dznServerLifecyclePreviewWorkflow), false);
assert.equal(/INSERT INTO linked_servers \([\s\S]*\bserver_port\b/.test(dznServerLifecyclePreviewWorkflow), false);
const lifecyclePublicCacheSeedColumns = extractInsertColumns(dznServerLifecyclePreviewWorkflow, "server_public_cache");
assert.equal(lifecyclePublicCacheSeedColumns.includes("server_name"), false);
assert.equal(lifecyclePublicCacheSeedColumns.includes("name"), false);
assert.equal(lifecyclePublicCacheSeedColumns.includes("current_players"), false);
assert.equal(lifecyclePublicCacheSeedColumns.includes("max_players"), false);
assert.equal(lifecyclePublicCacheSeedColumns.includes("last_seen_at"), false);
const lifecycleSyncStateSeedColumns = extractInsertColumns(dznServerLifecyclePreviewWorkflow, "server_sync_state");
assert.equal(lifecycleSyncStateSeedColumns.includes("linked_server_id"), false);
assert.equal(lifecycleSyncStateSeedColumns.includes("service_id"), false);
assert.equal(lifecycleSyncStateSeedColumns.includes("last_adm_discovery_at"), false);
assert.equal(lifecycleSyncStateSeedColumns.includes("last_adm_read_at"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes('DZN_DISCORD_NOTIFICATIONS_ENABLED: "false"'), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("MOCK_AUTH=true"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("MOCK_AUTH = \"true\""), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("--project-name \"${PREVIEW_PROJECT_NAME}\""), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("--project-name dzn-network"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("wrangler pages deploy out"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("api(`/pages/projects/${projectName}`)"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes('api("/pages/projects",'), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("method: \"POST\""), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("method: \"PATCH\""), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Created preview Pages project"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("Reusing preview Pages project"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("production_branch: branch"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("DB: { id: d1Id }"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("db:migrate:remote"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("dzn_network_db --remote"), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("echo \"$CLOUDFLARE_API_TOKEN\""), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("echo \"${CLOUDFLARE_API_TOKEN}\""), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("/api/public/servers"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes("/api/public/server-rail"), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes('fs.readFileSync("functions/api/autodev/adm-health.ts"'), true);
assert.equal(dznServerLifecyclePreviewWorkflow.includes('expectStatus("/api/autodev/adm-health'), false);
assert.equal(dznServerLifecyclePreviewWorkflow.includes('jsonRequest("/api/autodev/adm-health'), false);

assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("name: DZN Server Lifecycle Production Rollout"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("\n  push:"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("\n  schedule:"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("confirm_production_rollout"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("APPROVE_LIFECYCLE_ROLLOUT"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("approved_commit"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("approved_preview_run_url"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("production_db_name"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("production_pages_project_name"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("migration_name"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("feature/server-lifecycle-resource-control"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("743fbbd6aee2272d70aebd0179423fbf9f6567f3"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("ROLLOUT_COMMIT_SHA=\"$(git rev-parse HEAD)\""), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("--commit-hash \"${ROLLOUT_COMMIT_SHA}\""), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("actions: read"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("GITHUB_TOKEN: ${{ github.token }}"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Approved commit is not present on the selected branch; rerun preview for the current branch head."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Selected branch HEAD ${ROLLOUT_COMMIT_SHA} does not match preview-approved commit ${APPROVED_COMMIT}; rerun preview for the current branch head."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("DZN Server Lifecycle Preview"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("run.conclusion !== \"success\""), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("production_db_name must equal dzn_network_db"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("production_pages_project_name must equal dzn-network"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("migration_name must equal 0054_server_lifecycle_resource_control.sql"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Refusing preview D1 name for production rollout."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Refusing preview Pages project for production rollout."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("CLOUDFLARE_SERVER_LIFECYCLE_PRODUCTION_TOKEN"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("echo \"${ROLLOUT_CF_TOKEN}\""), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("echo \"$ROLLOUT_CF_TOKEN\""), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("echo \"${CRON_SECRET}\""), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("echo \"$CRON_SECRET\""), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npm run lint"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npm run build"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npm run test"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npm run test:server-lifecycle-resource-control"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("git diff --check"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Migration 0054 is additive-only."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("DROP|TRUNCATE"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("DELETE\\s+FROM"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("d1 time-travel info"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("D1_BACKUP_BOOKMARK"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("lifecycle-linked-columns-before.json"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("lifecycle-sync-columns-before.json"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Pre-migration linked_servers columns:"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Pre-migration server_sync_state columns:"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("LIFECYCLE_0054_COLUMNS_PRESENT"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("COALESCE(lifecycle_status, 'pre_0054')"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Unexpected pending production D1 migrations"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("0054_server_lifecycle_resource_control.sql"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npx wrangler d1 migrations apply \"${{ inputs.production_db_name }}\" --remote"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("PRAGMA table_info(linked_servers)"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("PRAGMA table_info(server_sync_state)"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("idx_linked_servers_lifecycle_status"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("idx_server_sync_state_lifecycle_retry"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("PRAGMA foreign_key_check"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("18765761"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("900002"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npx wrangler pages deploy out"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("--project-name \"${{ inputs.production_pages_project_name }}\""), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("dzn-network-server-lifecycle-preview"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npx wrangler deploy --config wrangler.adm-sync.toml"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("npx wrangler deploy --config wrangler.auto-update.toml"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("TOKEN_ENCRYPTION_KEY: ${{ secrets.TOKEN_ENCRYPTION_KEY }}"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("secrets.TOKEN_ENCRYPTION_KEY"), false);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/autodev/adm-health"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/sync/metadata/run"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/cron/server-wars/refresh"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/sync/discord-posts/run"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/public/server-rail"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/public/servers"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/public/home-stats"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/public/leaderboards/advanced"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/public/server-wars"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("discordNotificationsEnabled !== false"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Warlords appears in public active server surfaces."), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Minified React error #"), true);
assert.equal(dznServerLifecycleProductionRolloutWorkflow.includes("Error 1102"), true);

assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("name: DZN Pages Runtime Production Deploy"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("\n  push:"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("[run-dzn-pages-runtime-production-deploy]"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("APPROVE_PAGES_RUNTIME_DEPLOY"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("feature/discord-control-phase-2a-ux"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("a328aabe518590f3a8caa68be310e62fb2ff50e2"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: \"false\""), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false."), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("CLOUDFLARE_SERVER_LIFECYCLE_PRODUCTION_TOKEN"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("echo \"${ROLLOUT_CF_TOKEN}\""), false);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("echo \"$ROLLOUT_CF_TOKEN\""), false);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("npm run lint"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("npm run build"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("npx wrangler pages functions build functions"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("cp .pages-functions/index.js out/_worker.js"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("Pages Functions worker and owner API routes verified."), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("/api/owner/overview"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("/api/owner/discord/options"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("fetchProtectedOwnerApi"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("expected protected 401/403"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("Owner API protected route verification: passed"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("npm run test:server-lifecycle-resource-control"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("npm run test:public-access-gating"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("npm run test:metadata-sync-runner"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("npm run test:automation-schedulers"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("npm run test:server-advertising-packages"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("git diff --check"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("Pages production branch verified: main"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("production_branch"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("npx wrangler pages deploy out"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("--project-name \"${PRODUCTION_PAGES_PROJECT_NAME}\""), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("D1 migration: not run"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("D1 writes: not performed"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("wrangler d1"), false);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("d1 migrations"), false);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("d1 execute"), false);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("d1 time-travel"), false);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("npx wrangler deploy --config wrangler.adm-sync.toml"), false);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("npx wrangler deploy --config wrangler.auto-update.toml"), false);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("secrets.TOKEN_ENCRYPTION_KEY"), false);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("/api/public/server-rail"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("/api/public/servers"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("/api/public/home-stats"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("/api/public/leaderboards/advanced"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("/api/public/server-wars"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("Minified React error #"), true);
assert.equal(dznPagesRuntimeProductionDeployWorkflow.includes("Error 1102"), true);

assert.equal(dznOwnerConsolePreviewWorkflow.includes("name: DZN Owner Console Preview"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("\n  push:"), false);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("\n  schedule:"), false);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("feature/owner-console"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("feature/creator-only-event-governance"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Use workflow from feature/creator-only-event-governance requires branch=feature/creator-only-event-governance."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("branch=feature/creator-only-event-governance requires Use workflow from feature/creator-only-event-governance."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn_network_db_owner_console_preview_creator_governance_"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("confirm_preview_only must equal PREVIEW_ONLY"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Preview branch must never be main."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn-network-owner-console-preview"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn_network_db_owner_console_preview"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Preview Pages project must not equal the production Pages project."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Preview D1 database must not equal production D1 database."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Missing DZN_PLATFORM_OWNER_DISCORD_IDS for owner console preview."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes('DZN_PLATFORM_OWNER_DISCORD_IDS: "990000000000000101,990000000000000102"'), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes('DZN_PLATFORM_CREATOR_DISCORD_ID: "990000000000000102"'), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Missing fake DZN_PLATFORM_CREATOR_DISCORD_ID for creator-event-governance preview."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes('OWNER_PREVIEW_DISCORD_CLIENT_ID="990000000000000199"'), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("OWNER_PREVIEW_DISCORD_CLIENT_SECRET"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes('OWNER_PREVIEW_DISCORD_REDIRECT_URI="${PREVIEW_BASE_URL}/api/auth/discord/callback"'), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: \"false\""), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: \"false\""), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_PULSE_ENABLED: \"true\""), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Refusing D1 command for non-preview owner console database name."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Refusing migration for non-preview owner console database name."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Refusing preview seed for non-preview owner console database name."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Preview D1 database id equals production D1 database id"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("npx wrangler d1 migrations apply DB --config wrangler.owner-console-preview.toml --remote"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("PRAGMA table_info(server_build_stats)"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("npx wrangler pages secret put DZN_PLATFORM_OWNER_DISCORD_IDS"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("npx wrangler pages secret put DZN_PLATFORM_CREATOR_DISCORD_ID"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("npx wrangler pages secret put SESSION_SECRET"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("npx wrangler pages secret put DISCORD_CLIENT_SECRET"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("DISCORD_CLIENT_ID: { type: \"plain_text\", value: ownerPreviewDiscordClientId }"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("DISCORD_REDIRECT_URI: { type: \"plain_text\", value: previewRedirectUri }"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("DISCORD_CLIENT_ID = ${JSON.stringify(ownerPreviewDiscordClientId)}"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("DISCORD_REDIRECT_URI = ${JSON.stringify(previewRedirectUri)}"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("--project-name \"${PREVIEW_PROJECT_NAME}\""), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("--project-name dzn-network"), false);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("wrangler pages deploy out"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("owner-console-preview-immutable-url.txt"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("const retryablePreviewStatuses = new Set([522, 523, 524, 525, 526, 530])"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Waiting for owner console preview readiness"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Owner console preview readiness attempt"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Owner console preview did not become ready within 5 minutes."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("npm run test:owner-console"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("npm run test:creator-event-governance"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/owner/overview"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/owner/servers"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/owner/audit-log"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/owner/events"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("/owner/events/create"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("/events/suggest"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Creator Governance Preview Cup"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("owner-console-creator-event-count.json"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/auth/discord/start?returnTo=%2Fowner"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("/api/auth/discord/callback"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Discord auth start did not redirect to Discord."), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Discord OAuth start route: passed"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("/owner logged-out protection: passed"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("/owner non-owner 403: passed"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("/owner allowlisted owner access: passed"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Owner API secret redaction: passed"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("encrypted_token"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("TOKEN_ENCRYPTION_KEY"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_PLATFORM_OWNER_DISCORD_IDS"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_PLATFORM_CREATOR_DISCORD_ID"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: false"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: false"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Creator-only Event Control preview: passed"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Production D1 writes: none"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("Production Pages deploy: none"), true);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("db:migrate:remote"), false);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("dzn_network_db --remote"), false);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("INSERT INTO server_build_stats (id,"), false);
assert.equal(dznOwnerConsolePreviewWorkflow.includes("https://dzn-network.pages.dev/api/auth/discord/callback"), false);
assertInsertColumnsKnown(dznOwnerConsolePreviewWorkflow, "server_build_stats", [
  "linked_server_id",
  "nitrado_service_id",
  "structures_built",
  "build_items_placed",
  "storage_items_placed",
  "traps_placed",
  "build_score",
  "top_builder_name",
  "top_builder_count",
  "last_build_at",
  "updated_at",
]);

assert.equal(dznDiscordControlPreviewWorkflow.includes("name: DZN Discord Control Preview"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("\n  push:"), false);
assert.equal(dznDiscordControlPreviewWorkflow.includes("\n  schedule:"), false);
assert.equal(dznDiscordControlPreviewWorkflow.includes("feature/discord-control-centre"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("confirm_preview_only must equal PREVIEW_ONLY"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Preview branch must never be main."), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("dzn-network-discord-control-preview"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("dzn_network_db_discord_control_preview"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Preview Pages project must not equal production Pages project."), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Preview D1 database must not equal production D1 database."), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Missing DZN_PLATFORM_OWNER_DISCORD_IDS for Discord Control preview."), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("DZN_DISCORD_CONTROL_PREVIEW_DISCORD_CLIENT_ID: ${{ vars.DZN_DISCORD_CONTROL_PREVIEW_DISCORD_CLIENT_ID || vars.DZN_OWNER_CONSOLE_PREVIEW_DISCORD_CLIENT_ID || vars.DZN_PULSE_PREVIEW_DISCORD_CLIENT_ID }}"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("DZN_DISCORD_CONTROL_PREVIEW_DISCORD_CLIENT_SECRET: ${{ secrets.DZN_DISCORD_CONTROL_PREVIEW_DISCORD_CLIENT_SECRET || secrets.DZN_OWNER_CONSOLE_PREVIEW_DISCORD_CLIENT_SECRET || secrets.DZN_PULSE_PREVIEW_DISCORD_CLIENT_SECRET }}"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Missing DZN_DISCORD_CONTROL_PREVIEW_DISCORD_CLIENT_SECRET, DZN_OWNER_CONSOLE_PREVIEW_DISCORD_CLIENT_SECRET, or DZN_PULSE_PREVIEW_DISCORD_CLIENT_SECRET for Discord Control preview OAuth."), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes('DISCORD_CONTROL_PREVIEW_CLIENT_ID="${DZN_DISCORD_CONTROL_PREVIEW_DISCORD_CLIENT_ID:-1504270029795885178}"'), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes('DISCORD_CONTROL_PREVIEW_REDIRECT_URI="${PREVIEW_BASE_URL}/api/auth/discord/callback"'), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Discord Control preview must use DISCORD_CLIENT_ID=1504270029795885178."), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes('DZN_DISCORD_NOTIFICATIONS_ENABLED: "false"'), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes('DZN_PULSE_ENABLED: "true"'), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Refusing D1 command for non-preview Discord Control database name."), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Refusing migration for non-preview Discord Control database name."), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Refusing preview seed for non-preview Discord Control database name."), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Preview D1 database id equals production D1 database id"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("npx wrangler d1 migrations apply DB --config wrangler.discord-control-preview.toml --remote"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("server_posting_destinations"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("server_posting_state"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("npx wrangler pages secret put DZN_PLATFORM_OWNER_DISCORD_IDS"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("npx wrangler pages secret put SESSION_SECRET"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("npx wrangler pages secret put DISCORD_CLIENT_SECRET"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("DISCORD_CLIENT_ID: { type: \"plain_text\", value: previewDiscordClientId }"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("DISCORD_REDIRECT_URI: { type: \"plain_text\", value: previewDiscordRedirectUri }"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("DISCORD_CLIENT_ID = ${JSON.stringify(previewDiscordClientId)}"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("DISCORD_REDIRECT_URI = ${JSON.stringify(previewDiscordRedirectUri)}"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("wrangler pages deploy out"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("--project-name \"${PREVIEW_PROJECT_NAME}\""), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("--project-name dzn-network"), false);
assert.equal(dznDiscordControlPreviewWorkflow.includes("/api/owner/discord/overview"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("/api/owner/discord/post-types"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("/api/owner/discord/channels"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("/api/owner/discord/templates"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("/api/owner/discord/preview-embed"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("/api/auth/discord/start?returnTo=%2Fowner"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Discord auth start did not redirect to Discord."), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Discord auth start used the wrong preview callback URL."), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("preview?.sent === false"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Discord OAuth authorize start: passed"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: false"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Production D1 writes: none"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("Production Pages deploy: none"), true);
assert.equal(dznDiscordControlPreviewWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznDiscordControlPreviewWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznDiscordControlPreviewWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznDiscordControlPreviewWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznDiscordControlPreviewWorkflow.includes("db:migrate:remote"), false);
assert.equal(dznDiscordControlPreviewWorkflow.includes("dzn_network_db --remote"), false);
assert.equal(dznDiscordControlPreviewWorkflow.includes("https://dzn-network.pages.dev/api/auth/discord/callback"), false);

assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("name: DZN Discord Control Phase 2A Preview"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("\n  push:"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("\n  schedule:"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("feature/discord-control-phase-2a"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("feature/discord-control-phase-2a-ux"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("feature/discord-control-phase-2a|feature/discord-control-phase-2a-ux"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Unknown/random branches are refused."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("confirm_preview_only:"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("confirm_preview_only must equal PREVIEW_ONLY"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Preview branch must never be main."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Preview Pages project must not equal production Pages project."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Preview D1 database must not equal production D1 database."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("dzn-network-discord-phase-2a-preview"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("dzn_network_db_discord_phase_2a_preview"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("CLOUDFLARE_PULSE_PREVIEW_TOKEN: ${{ secrets.CLOUDFLARE_PULSE_PREVIEW_TOKEN }}"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("DZN_DISCORD_PHASE_2A_PREVIEW_DISCORD_CLIENT_SECRET: ${{ secrets.DZN_DISCORD_PHASE_2A_PREVIEW_DISCORD_CLIENT_SECRET || secrets.DZN_DISCORD_CONTROL_PREVIEW_DISCORD_CLIENT_SECRET || secrets.DZN_OWNER_CONSOLE_PREVIEW_DISCORD_CLIENT_SECRET || secrets.DZN_PULSE_PREVIEW_DISCORD_CLIENT_SECRET }}"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('DISCORD_PHASE_2A_PREVIEW_CLIENT_ID="${DZN_DISCORD_PHASE_2A_PREVIEW_DISCORD_CLIENT_ID:-1504270029795885178}"'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('DISCORD_PHASE_2A_PREVIEW_REDIRECT_URI="${PREVIEW_BASE_URL}/api/auth/discord/callback"'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Discord Control Phase 2A preview must use DISCORD_CLIENT_ID=1504270029795885178."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Missing DZN_DISCORD_PHASE_2A_PREVIEW_DISCORD_CLIENT_SECRET, DZN_DISCORD_CONTROL_PREVIEW_DISCORD_CLIENT_SECRET, DZN_OWNER_CONSOLE_PREVIEW_DISCORD_CLIENT_SECRET, or DZN_PULSE_PREVIEW_DISCORD_CLIENT_SECRET for Discord Control Phase 2A preview OAuth."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('CF_TOKEN="${CLOUDFLARE_PULSE_PREVIEW_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Missing CLOUDFLARE_PULSE_PREVIEW_TOKEN or CLOUDFLARE_API_TOKEN GitHub secret."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Cloudflare preview token is present but too short to be valid."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('printf "DISCORD_PHASE_2A_CF_TOKEN=%s\\n" "${CF_TOKEN}"'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('printf "CLOUDFLARE_API_TOKEN=%s\\n" "${CF_TOKEN}"'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("CLOUDFLARE_ACCOUNT_ID does not look like a 32-character Cloudflare account id."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Cloudflare token source: CLOUDFLARE_PULSE_PREVIEW_TOKEN"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Cloudflare token source: CLOUDFLARE_API_TOKEN fallback"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('DZN_DISCORD_NOTIFICATIONS_ENABLED: "false"'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Missing DZN_PLATFORM_OWNER_DISCORD_IDS for Discord Control Phase 2A preview."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("migrations/0055_discord_control_phase_2a.sql"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("DROP\\s+TABLE|DELETE\\s+FROM|TRUNCATE"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("npx wrangler d1 migrations apply DB --config wrangler.discord-phase-2a-preview.toml --remote"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("discord_channel_mappings"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("discord_owner_audit_log"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Resolve or create preview Pages project"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Configure preview owner auth secrets"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("npx wrangler pages secret put DZN_PLATFORM_OWNER_DISCORD_IDS"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("npx wrangler pages secret put SESSION_SECRET"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("npx wrangler pages secret put DISCORD_CLIENT_SECRET"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('DISCORD_CLIENT_ID: { type: "plain_text", value: previewDiscordClientId }'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('DISCORD_REDIRECT_URI: { type: "plain_text", value: previewDiscordRedirectUri }'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('MOCK_AUTH: { type: "plain_text", value: "false" }'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("DISCORD_CLIENT_ID = ${JSON.stringify(previewDiscordClientId)}"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("DISCORD_REDIRECT_URI = ${JSON.stringify(previewDiscordRedirectUri)}"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('MOCK_AUTH = "false"'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("MOCK_AUTH=false"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("MOCK_AUTH=true"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("deployment_configs"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("production: mergeConfig"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("preview: mergeConfig"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('pages_build_output_dir = "out"'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Preview non-owner Discord ID unexpectedly appears in the platform owner allowlist."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("out/_routes.json does not include /owner or /owner/*."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("out/_routes.json does not include /api/owner/*."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("discord-phase-2a-preview-immutable-url.txt"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("const retryablePreviewStatuses = new Set([404, 522, 523, 524, 525, 526, 530])"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Waiting for Discord Control Phase 2A preview readiness"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Preview readiness attempt"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Discord Control Phase 2A preview route"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("/api/auth/discord/start?returnTo=%2Fowner"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Discord auth start Location:"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('discordLocation.startsWith("https://discord.com/oauth2/authorize")'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('discordAuthorize.searchParams.get("client_id") === expectedDiscordClientId'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('discordAuthorize.searchParams.get("redirect_uri") === expectedDiscordRedirectUri'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Refusing production Pages project."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("--project-name \"${PREVIEW_PROJECT_NAME}\""), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("--project-name dzn-network"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("previewOnly: true"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Preview-only test embed must not send."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("autoPostingEnabled === false"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Publish preview approval manifest"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("out/.well-known/dzn/discord-phase-2a-preview-approval.json"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("/.well-known/dzn/discord-phase-2a-preview-approval.json"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('"feature": "discord-control-phase-2a"'), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('feature: "discord-control-phase-2a"'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('workflow: "DZN Discord Control Phase 2A Preview"'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("run_id: process.env.GITHUB_RUN_ID"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("run_url: process.env.PREVIEW_RUN_URL"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("branch: process.env.INPUT_BRANCH"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("commit: process.env.PREVIEW_COMMIT"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("dzn_discord_notifications_enabled: false"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("auto_posting_enabled: false"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("real_discord_send: false"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('status: "passed"'), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Preview approval manifest contains secret-like content."), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("Approval manifest attempt"), true);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes('DZN_DISCORD_NOTIFICATIONS_ENABLED = "true"'), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("db:migrate:remote"), false);
assert.equal(dznDiscordControlPhase2aPreviewWorkflow.includes("dzn_network_db --remote"), false);

assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("name: DZN Discord Control Phase 2A Production Rollout"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("\n  push:"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("\n  schedule:"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("confirm_production_rollout"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("APPROVE_DISCORD_PHASE_2A_ROLLOUT"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("feature/discord-control-phase-2a"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("feature/discord-control-phase-2a-ux"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("rerun preview for the approved UX branch before rollout"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("approved_commit"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("approved_preview_run_url"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("DZN Discord Control Phase 2A Preview"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Approved preview run is not green"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Preview approval manifest fetch attempt"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Preview approval manifest verified"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Approved preview verified by preview approval manifest."), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Preview approval manifest was not available"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Preview approval manifest contains secret-like content."), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes('manifest.feature === "discord-control-phase-2a"'), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("manifest.run_url === runUrl"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("manifest.branch === expectedBranch"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("manifest.commit === expectedSha"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("manifest.preview_project === expectedPreviewProject"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("manifest.preview_db === expectedPreviewDb"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("manifest.migration === expectedMigration"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("manifest.dzn_discord_notifications_enabled === false"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("manifest.auto_posting_enabled === false"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("manifest.real_discord_send === false"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes('manifest.status === "passed"'), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("APPROVED_PREVIEW_REPOSITORY=\"${GITHUB_REPOSITORY}\""), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("dzn-discord-control-phase-2a-preview.yml"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Optional GitHub API run lookup returned"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("continuing because the preview approval manifest matched all rollout inputs"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("checking repository-wide workflow run list for exact run id"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("actions/runs?per_page=100&page=${page}"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Repository workflow run list page"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("workflow run list page ${page} returned"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("actions/workflows/${workflowFile}/runs"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Found approved preview run id/workflow/event/head_branch/conclusion"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("run.repository?.full_name"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Approved preview run ${runId} was not found"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("actions/runs/${runId}/jobs"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("actions/jobs/${jobId}/logs"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("workflow_dispatch was launched with \"Use workflow from: main\""), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Detected preview input branch"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Detected preview tested commit"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("approved branch HEAD guard"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Could not verify approved preview run branch input"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Could not verify approved preview run tested commit"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Selected branch HEAD ${BRANCH_HEAD} does not match preview-approved commit ${APPROVED_COMMIT}; rerun preview for the current branch head."), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("production_pages_project_name must equal dzn-network"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("production_db_name must equal dzn_network_db"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("migration_name must equal 0055_discord_control_phase_2a.sql"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Refusing preview Pages project for Discord Phase 2A production rollout."), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Refusing preview D1 database name for Discord Phase 2A production rollout."), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false."), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("CLOUDFLARE_DISCORD_PHASE_2A_PRODUCTION_TOKEN"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("CLOUDFLARE_DISCORD_CONTROL_PRODUCTION_TOKEN"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("CLOUDFLARE_OWNER_CONSOLE_PRODUCTION_TOKEN"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("CLOUDFLARE_SERVER_LIFECYCLE_PRODUCTION_TOKEN"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("DZN_PLATFORM_OWNER_DISCORD_IDS: ${{ secrets."), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("DISCORD_CLIENT_SECRET: ${{ secrets."), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("DISCORD_BOT_TOKEN: ${{ secrets."), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("TOKEN_ENCRYPTION_KEY: ${{ secrets."), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("secrets.TOKEN_ENCRYPTION_KEY"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("functions/_lib/owner-discord-control.ts"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("functions/api/owner/discord/channel-mappings.ts"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("functions/api/owner/discord/channel-mappings/[slot]/disable.ts"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("functions/api/owner/discord/channel-mappings/[slot]/permission-check.ts"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("functions/api/owner/discord/test-embed.ts"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("functions/api/owner/discord/audit-log.ts"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("What do you want to post?"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Which DZN server is this about?"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Where should this post?"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Post destinations"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Discord Server"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("migrations/0055_discord_control_phase_2a.sql"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Migration 0055 is additive-only and scoped to Discord Control Phase 2A support tables."), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("DROP|TRUNCATE"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("DELETE\\s+FROM"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("ALTER\\s+TABLE"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Migration 0055 references protected gameplay, server, billing, or Nitrado tables."), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("discord_channel_mappings"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("discord_owner_audit_log"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("d1 time-travel info"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("D1_BACKUP_BOOKMARK"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Unexpected pending production D1 migrations"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npx wrangler d1 migrations apply \"${{ inputs.production_db_name }}\" --remote"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("PRAGMA table_info(discord_channel_mappings)"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("PRAGMA table_info(discord_owner_audit_log)"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("PRAGMA foreign_key_check"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("player_profiles"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("kill_events"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("player_events"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("build_events"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("18765761"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("900002"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("DZN_PLATFORM_OWNER_DISCORD_IDS listed in production Pages secrets: true"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED listed in production Pages secrets: true"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npm run lint"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npm run build"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npm run test"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npm run test:owner-console"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npm run test:github-workflows"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npm run test:public-access-gating"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npm run test:server-lifecycle-resource-control"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npm run test:server-advertising-packages"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("git diff --check"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npx wrangler pages deploy out"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("--project-name \"${{ inputs.production_pages_project_name }}\""), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("--commit-hash \"${ROLLOUT_COMMIT_SHA}\""), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npx wrangler deploy --config wrangler.adm-sync.toml"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npx wrangler deploy --config wrangler.auto-update.toml"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("npx wrangler pages secret put"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("confirmation: \"SEND_TEST_EMBED\""), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("confirmation: 'SEND_TEST_EMBED'"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("https://discord.com/api/v10/channels"), false);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("discord.com/api/webhooks/"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Production test embed: not sent"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Auto posting enabled: false"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("/api/owner/discord/channel-mappings"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("/api/owner/discord/test-embed"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("/api/owner/discord/audit-log"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("/api/owner/discord/preview-embed"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Preview embed endpoint unauthenticated protection: passed"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Test embed endpoint unauthenticated protection: passed"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("/api/public/server-rail"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("/api/public/servers"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("/api/public/home-stats"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("/api/public/leaderboards/advanced"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("/api/public/server-wars"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("/servers/profile?slug=pandora-dayz"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("NukeTown public visibility: passed"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("PANDORA public profile/history route: passed"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("Warlords archived_hidden active-public exclusion: passed"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(dznDiscordControlPhase2aProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: false"), true);

assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("name: DZN Discord Control Production Rollout"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("\n  push:"), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("\n  schedule:"), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("confirm_production_rollout"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("APPROVE_DISCORD_CONTROL_ROLLOUT"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("feature/discord-control-centre"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("production_pages_project_name must equal dzn-network"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("production_db_name must equal dzn_network_db"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("Refusing preview Pages project for Discord Control production rollout."), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("Refusing preview D1 database name for Discord Control production rollout."), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false."), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("Approved preview run is not green"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("DZN Discord Control Preview"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("Selected branch HEAD ${ROLLOUT_COMMIT_SHA} does not match preview-approved commit ${APPROVED_COMMIT}; rerun preview for the current branch head."), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("CLOUDFLARE_DISCORD_CONTROL_PRODUCTION_TOKEN"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("CLOUDFLARE_OWNER_CONSOLE_PRODUCTION_TOKEN"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("functions/api/owner/discord/overview.ts"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("functions/api/owner/discord/post-types.ts"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("functions/api/owner/discord/channels.ts"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("functions/api/owner/discord/templates.ts"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("functions/api/owner/discord/preview-embed.ts"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes('DISCORD_CONTROL_CHANGED_FILES="$(git diff-tree --no-commit-id --name-only -r "${APPROVED_COMMIT}")"'), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("Discord Control Phase 1 rollout must not include new or modified migration files in the approved Discord Control commit."), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("git diff --name-only origin/main...HEAD | grep -q '^migrations/'"), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("npm run lint"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("npm run build"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("npm run test"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("npm run test:owner-console"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("npm run test:github-workflows"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("npm run test:public-access-gating"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("npm run test:server-lifecycle-resource-control"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("npm run test:server-advertising-packages"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("git diff --check"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("npx wrangler pages secret list --project-name \"${{ inputs.production_pages_project_name }}\""), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("DZN_PLATFORM_OWNER_DISCORD_IDS listed in production Pages secrets: true"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("npx wrangler pages deploy out"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("--project-name \"${{ inputs.production_pages_project_name }}\""), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("--commit-hash \"${ROLLOUT_COMMIT_SHA}\""), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/api/owner/discord/overview"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/api/owner/discord/post-types"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/api/owner/discord/channels"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/api/owner/discord/templates"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/api/owner/discord/preview-embed"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("Preview embed endpoint unauthenticated protection: passed"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/api/public/server-rail"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/api/public/servers"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/api/public/home-stats"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/api/public/leaderboards/advanced"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/api/public/server-wars"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/servers/profile?slug=pandora-dayz"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("NukeTown public visibility: passed"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("PANDORA public profile/history route: passed"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("Warlords archived_hidden active-public exclusion: passed"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: false"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("D1 migration: not run"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("D1 writes: not performed"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("Worker deploy: not run"), true);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("wrangler d1"), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("d1 migrations"), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("d1 execute"), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("d1 time-travel"), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("npx wrangler pages secret put"), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("DISCORD_BOT_TOKEN: ${{ secrets."), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("DISCORD_CLIENT_SECRET: ${{ secrets."), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("TOKEN_ENCRYPTION_KEY: ${{ secrets."), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("secrets.TOKEN_ENCRYPTION_KEY"), false);
assert.equal(dznDiscordControlProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED=true"), false);

assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("name: DZN Owner Console Production Rollout"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("confirm_production_rollout"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("APPROVE_OWNER_CONSOLE_ROLLOUT"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("feature/owner-console"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("160c460648f9807b459f1c4a4a54d67b0b273f20"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("production_pages_project_name must equal dzn-network"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("Refusing preview Pages project for owner console production rollout."), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false."), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("Missing DZN_PLATFORM_OWNER_DISCORD_IDS for owner console production rollout."), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("DZN_PLATFORM_OWNER_DISCORD_IDS: ${{ secrets.DZN_PLATFORM_OWNER_DISCORD_IDS || vars.DZN_PLATFORM_OWNER_DISCORD_IDS }}"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("CLOUDFLARE_OWNER_CONSOLE_PRODUCTION_TOKEN"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("CLOUDFLARE_SERVER_LIFECYCLE_PRODUCTION_TOKEN"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npm run test:github-workflows"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npm run lint"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npm run build"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npm run test"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npm run test:owner-console"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npm run test:public-access-gating"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npm run test:server-lifecycle-resource-control"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npm run test:server-advertising-packages"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("git diff --check"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npx wrangler pages secret put DZN_PLATFORM_OWNER_DISCORD_IDS"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npx wrangler pages secret put DZN_DISCORD_NOTIFICATIONS_ENABLED"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npx wrangler pages deploy out"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("--project-name \"${PRODUCTION_PROJECT}\""), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("--commit-hash \"${ROLLOUT_COMMIT_SHA}\""), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("wrangler d1"), false);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("d1 migrations"), false);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("d1 execute"), false);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("d1 time-travel"), false);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npx wrangler deploy --config wrangler.adm-sync.toml"), false);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("npx wrangler deploy --config wrangler.auto-update.toml"), false);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("secrets.TOKEN_ENCRYPTION_KEY"), false);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("secrets.DISCORD_BOT_TOKEN"), false);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("/owner"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("/api/owner/overview"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("/api/owner/servers"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("/api/owner/audit-log"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("/api/public/server-rail"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("/api/public/servers"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("/api/public/home-stats"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("/api/public/leaderboards/advanced"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("/api/public/server-wars"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("Minified React error #"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("Error 1102"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("Production D1 migration: not run"), true);
assert.equal(dznOwnerConsoleProductionRolloutWorkflow.includes("Worker deploy: not run"), true);

assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("name: DZN Discord Server Announcements Preview"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("\n  push:"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("feature/discord-server-announcements|release/main-runtime-alignment"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Preview workflow must not run against ${INPUT_BRANCH}."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Preview branch input must not be empty."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Use workflow from release/main-runtime-alignment requires branch=release/main-runtime-alignment."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("branch=release/main-runtime-alignment requires Use workflow from release/main-runtime-alignment."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Discord server announcements preview may only run against feature/discord-server-announcements or release/main-runtime-alignment."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Preview branch name must not contain project or database names."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Alignment preview must be run with 'Use workflow from' release/main-runtime-alignment."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("release/main-runtime-alignment requires mode=full-preview."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("release/main-runtime-alignment requires preview_project_name=dzn-network-discord-announcements-preview."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("dzn_network_db_discord_announcements_preview_alignment_"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("LEGACY_RUNTIME_SCAN_TARGETS=(.env.example cloudflare-env.d.ts functions components package.json)"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("functions scripts components package.json"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("\"${LEGACY_RUNTIME_SCAN_TARGETS[@]}\""), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("git switch --force-create \"${INPUT_BRANCH}\" \"origin/${INPUT_BRANCH}\""), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("HEAD_SHA=\"$(git rev-parse HEAD)\""), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("REMOTE_SHA=\"$(git rev-parse \"origin/${INPUT_BRANCH}\")\""), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("TREE_SHA=\"$(git rev-parse \"HEAD^{tree}\")\""), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("CANDIDATE_COMMIT_SHA=${HEAD_SHA}"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("CANDIDATE_TREE_SHA=${TREE_SHA}"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("--commit-hash \"${CANDIDATE_COMMIT_SHA}\""), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Candidate commit SHA: ${CANDIDATE_COMMIT_SHA}"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Candidate tree SHA: ${CANDIDATE_TREE_SHA}"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: \"false\""), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("ownerDiscordOverviewPayload(parsed)"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Owner Discord overview safe summary"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("notificationsEnabled"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("recentFailuresCount"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("serverAnnouncements?.featureEnabled === false"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("diagnostics.ownerLoggedOut.status === 302"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("/login?returnTo=%2Fowner"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("GET /api/owner/servers no session"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("GET /api/owner/audit-log no session"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("GET /api/owner/overview seeded owner session"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("GET /api/owner/servers seeded owner session"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("GET /api/owner/audit-log seeded owner session"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("diagnostics.overviewOwner.status === 200"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("diagnostics.serversOwner.status === 200"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("diagnostics.auditLogOwner.status === 200"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("\"/leaderboards\", \"/events\", \"/seasons\""), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("\"/api/public/leaderboards\", \"/api/public/server-rail\", \"/api/dzn-pulse/config\""), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("idx_discord_announcement_posts_server_event_created"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("idx_discord_announcement_posts_event_status_created"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("idx_discord_announcement_posts_status_updated"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("SELECT COUNT(*) AS row_count FROM discord_announcement_posts;"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("discord_announcement_posts row count: 0"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Sample preview route performance"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("for (let attempt = 1; attempt <= 10; attempt += 1)"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Worker-limit markers"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Preview performance sampling failed"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED = \"true\""), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("wrangler pages secret put DISCORD_BOT_TOKEN"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("https://discord.com/api/v10/channels"), false);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("PRODUCTION_PAGES_PROJECT_NAME: dzn-network"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("PRODUCTION_D1_DATABASE_NAME: dzn_network_db"), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Refusing production Pages project."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("preview_db_name equals production database name."), true);
assert.equal(dznDiscordServerAnnouncementsPreviewWorkflow.includes("Private Discord test messages: not sent by this workflow"), true);
assert.equal(acceptsDiscordAnnouncementsPreviewInput({ workflowRefName: "release/main-runtime-alignment", inputBranch: "release/main-runtime-alignment", mode: "full-preview" }), true);
assert.equal(acceptsDiscordAnnouncementsPreviewInput({ workflowRefName: "release/main-runtime-alignment", inputBranch: "feature/discord-server-announcements", mode: "full-preview" }), false);
assert.equal(acceptsDiscordAnnouncementsPreviewInput({ workflowRefName: "main", inputBranch: "release/main-runtime-alignment", mode: "full-preview" }), false);
assert.equal(acceptsDiscordAnnouncementsPreviewInput({ workflowRefName: "feature/discord-server-announcements", inputBranch: "feature/discord-server-announcements", mode: "full-preview", previewDbName: "dzn_network_db_discord_announcements_preview" }), true);
for (const inputBranch of ["main", "master", "production", "", "feature/arbitrary", "release/arbitrary"]) {
  assert.equal(acceptsDiscordAnnouncementsPreviewInput({ workflowRefName: "main", inputBranch, mode: "full-preview" }), false);
}
assert.equal(acceptsDiscordAnnouncementsPreviewInput({ workflowRefName: "release/main-runtime-alignment", inputBranch: "release/main-runtime-alignment", mode: "full-preview", previewProjectName: "dzn-network" }), false);
assert.equal(acceptsDiscordAnnouncementsPreviewInput({ workflowRefName: "release/main-runtime-alignment", inputBranch: "release/main-runtime-alignment", mode: "full-preview", previewDbName: "dzn_network_db" }), false);
assert.equal(acceptsDiscordAnnouncementsPreviewInput({ workflowRefName: "release/main-runtime-alignment", inputBranch: "release/main-runtime-alignment", mode: "validate" }), false);
assert.equal(acceptsDiscordAnnouncementsPreviewInput({ workflowRefName: "release/main-runtime-alignment", inputBranch: "release/main-runtime-alignment", mode: "full-preview", previewDbName: "dzn_network_db_discord_announcements_preview" }), false);
assert.equal(acceptsDiscordAnnouncementsPreviewInput({ workflowRefName: "release/main-runtime-alignment", inputBranch: "release/main-runtime-alignment", mode: "full-preview", discordServerAnnouncementsEnabled: "true" }), false);
assert.equal(acceptsDiscordAnnouncementsPreviewInput({ workflowRefName: "release/main-runtime-alignment", inputBranch: "release/main-runtime-alignment", mode: "full-preview", discordNotificationsEnabled: "true" }), false);
assert.equal(legacyAdvertEnvScanFails("functions/_lib/discord-server-announcements.ts", "DZN_DISCORD_ADVERT_CHANNEL_ID"), false);
assert.equal(legacyAdvertEnvScanFails(".env.example", "DZN_DISCORD_ADVERTISE_CHANNEL_ID="), true);
assert.equal(legacyAdvertEnvScanFails("functions/_lib/discord-server-announcements.ts", "DZN_DISCORD_ADVERTISE_CHANNEL_ID"), true);
assert.equal(legacyAdvertEnvScanFails("scripts/test-github-workflow-boundary.ts", 'assert.equal(source.includes("DZN_DISCORD_ADVERTISE_CHANNEL_ID"), false);'), false);

assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("name: DZN Discord Server Announcements Production Rollout"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("\n  push:"), false);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("\n  schedule:"), false);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("feature/discord-server-announcements"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("37eff56e39c670160d5c16168509c2bbf93fecc0"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("https://github.com/rafaeldeak-lab/dzn-network/actions/runs/29190148323"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("APPROVE_DISCORD_SERVER_ANNOUNCEMENTS_DISABLED_ROLLOUT"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("git checkout --detach \"${APPROVED_COMMIT}\""), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("announcements_enabled=true is rejected for this disabled rollout."), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: \"false\""), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED: \"false\""), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("0056_discord_server_announcements.sql"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("Migration 0056 is schema-only, additive, and scoped to discord_announcement_posts."), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+discord_announcement_posts"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("idx_discord_announcement_posts_server_event_created"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("idx_discord_announcement_posts_event_status_created"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("idx_discord_announcement_posts_status_updated"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("Migration 0056 should not insert announcement rows"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("npx wrangler d1 time-travel info"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("npx wrangler d1 migrations apply \"${{ inputs.production_db_name }}\" --remote"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("printf \"false\" |"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("npx wrangler pages secret put DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("npx wrangler pages secret put DZN_DISCORD_NOTIFICATIONS_ENABLED"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED=false"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED=false"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("npx wrangler pages functions build functions"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("--outdir .pages-functions"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("--build-output-directory out"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("--output-routes-path out/_routes.json"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("--minify"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("node scripts/patch-pages-routes.mjs"), true);
assert.ok(
  dznDiscordServerAnnouncementsProductionRolloutWorkflow.indexOf("--output-routes-path out/_routes.json") <
    dznDiscordServerAnnouncementsProductionRolloutWorkflow.indexOf("node scripts/patch-pages-routes.mjs"),
  "Discord announcements production rollout must patch Pages routes after Wrangler writes out/_routes.json.",
);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("cp .pages-functions/index.js out/_worker.js"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("out/_routes.json missing"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("Final Pages routes summary"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("hasApiWildcard"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("hasOwnerWildcard"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("normalizeRoutes([...(routes.include ?? []), ...requiredIncludes])"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("assertNoSplatOverlap(finalRoutes.include, \"include\")"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("assertNoSplatOverlap(finalRoutes.exclude, \"exclude\")"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("removedOverlappedIncludeRoutes"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("removedOverlappedExcludeRoutes"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("includeSplatRoutes"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("Pages production branch verified: main"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("npx wrangler pages deploy out"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("--project-name \"${{ inputs.production_pages_project_name }}\""), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("--commit-hash \"${ROLLOUT_COMMIT_SHA}\""), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("2>&1 | tee discord-server-announcements-production-pages-deploy.txt"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("PIPESTATUS[0]"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("Wrangler Pages deploy failed with exit code"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("Sanitized Wrangler deploy log tail"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("--commit-dirty=true"), false);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("/api/owner/overview"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("/api/owner/discord/overview"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("/api/public/servers"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("/api/public/home-stats"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("Discord messages sent: none"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("Authenticated owner /owner validation must be completed manually"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("DISCORD_BOT_TOKEN"), false);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("DZN_DISCORD_ADVERTISE_CHANNEL_ID"), false);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes('LEGACY_ADVERT_CHANNEL_ENV="DZN_DISCORD_ADVERTISE""_CHANNEL_ID"'), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("DZN_DISCORD_ADVERT_CHANNEL_ID"), true);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("confirmation: \"SEND_TEST_EMBED\""), false);
assert.equal(dznDiscordServerAnnouncementsProductionRolloutWorkflow.includes("https://discord.com/api/v10/channels"), false);

assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("name: DZN Production Read-Only Diagnostics"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("\n  push:"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("\n  schedule:"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("confirm_read_only:"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("RUN_READ_ONLY_PRODUCTION_DIAGNOSTICS"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("production_pages_project_name:"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("default: dzn-network"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("production_db_name:"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("default: dzn_network_db"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("production_base_url:"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("default: https://dzn-network.pages.dev"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("approved_runtime_commit:"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("37eff56e39c670160d5c16168509c2bbf93fecc0"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("feature_branch:"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("feature/discord-server-announcements"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("cancel-in-progress: false"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("production_pages_project_name must equal dzn-network"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("production_db_name must equal dzn_network_db"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("Refusing preview Pages project."), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("Refusing preview D1 database."), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("Missing Cloudflare read credential."), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("Missing CLOUDFLARE_ACCOUNT_ID."), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("CLOUDFLARE_DISCORD_SERVER_ANNOUNCEMENTS_PRODUCTION_TOKEN"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("CLOUDFLARE_SERVER_ADVERTISING_PRODUCTION_TOKEN"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("CLOUDFLARE_PULSE_PRODUCTION_TOKEN"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("CLOUDFLARE_SERVER_LIFECYCLE_PRODUCTION_TOKEN"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("CLOUDFLARE_API_TOKEN_FALLBACK"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("echo \"${DIAGNOSTIC_CF_TOKEN}\""), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("echo \"$DIAGNOSTIC_CF_TOKEN\""), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("\"test:github-workflows\""), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("\"test:discord-server-announcements\""), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("\"test:owner-console\""), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("[\"npm\", [\"run\", \"test\"]]"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("[\"npm\", [\"run\", \"lint\"]]"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("[\"npm\", [\"run\", \"build\"]]"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("[\"git\", [\"diff\", \"--check\"]]"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/pages/projects/${encodeURIComponent(projectName)}"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/deployments?env=production&per_page=25"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("recentProductionDeployments"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("productionEnvPresence"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/owner/overview"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/owner/discord/overview"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/owner/servers"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/owner/audit-log"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/public/servers"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/public/home-stats"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/public/leaderboards"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/public/server-rail"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("attempts = route.important ? 5 : 1"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("cfRay"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("forbiddenMarkers"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("Worker exceeded resource limits"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("npx wrangler d1 list --json"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("SELECT name FROM d1_migrations ORDER BY id;"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("SELECT name FROM d1_migrations WHERE name = '0056_discord_server_announcements.sql';"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("PRAGMA table_info(discord_announcement_posts);"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_discord_announcement_posts_%' ORDER BY name;"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("SELECT COUNT(*) AS row_count FROM discord_announcement_posts;"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("d1MutationPerformedByDiagnostics: false"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("npx wrangler pages functions build functions"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("--outdir .pages-functions-diagnostics"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("apiWildcardMakesAllApiFunctionsUseWorker"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("normalizedRemovedRouteCount"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("currentBundleNearCloudflareLimit"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("actions/upload-artifact@v4"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("name: dzn-production-readonly-diagnostics"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("no production deploy"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("no production migration"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("no production D1 write"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("no Discord message"), true);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("wrangler pages deploy"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("wrangler pages secret put"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("wrangler d1 migrations apply"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("npx wrangler d1 migrations apply"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("wrangler deploy"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("wrangler d1 time-travel"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/sync/adm/run"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/sync/metadata/run"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/sync/discord-posts/run"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("/api/cron/server-wars/refresh"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("https://discord.com/api/v10/channels"), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("confirmation: \"SEND_TEST_EMBED\""), false);
assert.equal(dznProductionReadonlyDiagnosticsWorkflow.includes("DZN_DISCORD_ADVERTISE_CHANNEL_ID"), false);
assert.equal(/method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']/i.test(dznProductionReadonlyDiagnosticsWorkflow), false);
for (const match of dznProductionReadonlyDiagnosticsWorkflow.matchAll(/npx wrangler d1 execute[\s\S]*?--command "([^"]+)"/g)) {
  assert.equal(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE)\b/i.test(match[1]), false, `Read-only diagnostics D1 command must not mutate: ${match[1]}`);
}
assert.equal(/npx wrangler d1 execute[\s\S]*--file\b/i.test(dznProductionReadonlyDiagnosticsWorkflow), false);

assert.equal(dznPulseProductionRolloutWorkflow.includes("name: DZN Pulse Production Rollout"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("workflow_dispatch:"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("confirm_production_rollout"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("DZN_PULSE_ENABLED = \"true\""), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED = \"false\""), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("npx wrangler pages secret put DZN_PULSE_ENABLED"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("npx wrangler pages secret put DZN_DISCORD_NOTIFICATIONS_ENABLED"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("DZN_PULSE_ENABLED=true DZN_DISCORD_NOTIFICATIONS_ENABLED=false npm run build"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("npx wrangler d1 migrations list \"${PRODUCTION_D1_DATABASE_NAME}\" --remote"), true);
assert.equal(dznPulseProductionRolloutWorkflow.includes("npx wrangler d1 migrations apply \"${PRODUCTION_D1_DATABASE_NAME}\" --remote"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("PATCH"), false);
assert.equal(dznPulseProductionRolloutWorkflow.includes("/pages/projects/${projectName}"), false);
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

assert.equal(protectedRouteAuthRepairWorkflow.includes("name: DZN Protected Route Auth Repair"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("workflow_dispatch:"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("confirm_protected_auth_repair"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("run-dzn-protected-auth-repair"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("CRON_SECRET=\"${DZN_CRON_SECRET:-${SYNC_CRON_SECRET:-}}\""), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("DZN_CRON_SECRET present:"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("SYNC_CRON_SECRET present:"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("Selected secret source:"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("Headers sent: x-dzn-cron-secret, x-sync-cron-secret, x-cron-secret, Authorization"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_CRON_SECRET"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_PULSE_ENABLED"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_DISCORD_NOTIFICATIONS_ENABLED"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("--project-name \"${PRODUCTION_PAGES_PROJECT_NAME}\""), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("DZN_PULSE_ENABLED = \"true\""), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED = \"false\""), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED = \"true\""), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("/api/sync/metadata/run"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("/api/cron/server-wars/refresh"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("/api/sync/discord-posts/run"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("/api/autodev/adm-health"), true);
assert.equal(protectedRouteAuthRepairWorkflow.includes("/api/sync/adm/run"), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("wrangler d1 migrations apply"), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(protectedRouteAuthRepairWorkflow.includes("dzn-auto-update-worker"), false);

assert.equal(productionDiscordAuthRepairWorkflow.includes("name: DZN Production Discord Auth Repair"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("workflow_dispatch:"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("confirm_discord_auth_repair"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("run-dzn-production-discord-auth-repair"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("Production Discord auth repair may only run on main."), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("DZN_PRODUCTION_DISCORD_CLIENT_ID: ${{ vars.DZN_PRODUCTION_DISCORD_CLIENT_ID }}"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("PROTECTED_CALLBACK_DIAGNOSTIC_SECRET_SOURCE"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes('DZN_PRODUCTION_DISCORD_CLIENT_ID:-1504270029795885178'), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("https://dzn-network.pages.dev/api/auth/discord/callback"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("npx wrangler pages secret put DISCORD_CLIENT_ID"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("npx wrangler pages secret put DISCORD_REDIRECT_URI"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_APP_URL"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_PULSE_ENABLED"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("npx wrangler pages secret put DZN_DISCORD_NOTIFICATIONS_ENABLED"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("Ensure Pages production branch is main"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes('JSON.stringify({ production_branch: "main" })'), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("deployment_configs"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("env_vars"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("for name in DISCORD_CLIENT_SECRET SESSION_SECRET"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("$name listed before repair: true"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/auth/discord/start?returnTo=%2Fdashboard"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("Discord auth start redirects to Discord with the production callback."), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("synthetic-production-diagnostic-code"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("diagnostic=1"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes('"x-dzn-cron-secret": process.env.PROTECTED_CALLBACK_DIAGNOSTIC_SECRET'), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("client_secret_trimmed"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("invalid_client"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("invalid_grant"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("Production Discord client secret is missing, invalid, or no longer current."), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("DZN_PULSE_ENABLED=true DZN_DISCORD_NOTIFICATIONS_ENABLED=false npm run build"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/dzn-pulse/config"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/dzn-pulse/summary"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/public/servers"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/public/leaderboards/advanced"), true);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/sync/metadata/run"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/cron/server-wars/refresh"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/sync/discord-posts/run"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("/api/sync/adm/run"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("wrangler d1 migrations apply"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("wrangler.adm-sync.toml"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("wrangler.auto-update.toml"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("dzn-adm-sync-worker"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("dzn-auto-update-worker"), false);
assert.equal(productionDiscordAuthRepairWorkflow.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED = \"true\""), false);

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
