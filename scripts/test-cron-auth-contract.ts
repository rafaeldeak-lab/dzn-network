import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { isCronSecretAuthorized, requireCronSecret } from "../functions/_lib/cron-auth";
import { onRequestPost as admHealthPost } from "../functions/api/autodev/adm-health";
import { onRequestPost as nitradoAdminLogsPost } from "../functions/api/debug/nitrado-admin-logs";
import { onRequestPost as nitradoFileReadPost } from "../functions/api/debug/nitrado-file-read";
import { handleAdmSyncRun } from "../functions/api/sync/adm/run";
import { onRequestPost as retryUnreadablePost } from "../functions/api/sync/adm/retry-unreadable";
import type { Env, PagesContext } from "../functions/_lib/types";

type SqliteRow = Record<string, unknown>;
type Sqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number };
    get(...args: unknown[]): SqliteRow | undefined;
    all(...args: unknown[]): SqliteRow[];
  };
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

const dznEnv = { DZN_CRON_SECRET: "unit-test-secret" } as Env;
const syncEnv = { SYNC_CRON_SECRET: "unit-test-secret" } as Env;

assert.equal(requireCronSecret(new Request("https://dzn.test"), dznEnv)?.status, 401);
assert.equal(requireCronSecret(new Request("https://dzn.test", {
  headers: { "x-dzn-cron-secret": "wrong" },
}), dznEnv)?.status, 401);

const acceptedHeaders: HeadersInit[] = [
  { "x-dzn-cron-secret": "unit-test-secret" },
  { "x-sync-cron-secret": "unit-test-secret" },
  { "x-cron-secret": "unit-test-secret" },
  { authorization: "Bearer unit-test-secret" },
];

for (const headers of acceptedHeaders) {
  assert.equal(isCronSecretAuthorized(new Request("https://dzn.test", { headers }), dznEnv), true);
  assert.equal(isCronSecretAuthorized(new Request("https://dzn.test", { headers }), syncEnv), true);
}

const cronAuthSource = readFileSync("functions/_lib/cron-auth.ts", "utf8");
assert.equal(cronAuthSource.includes("env.DZN_CRON_SECRET || env.SYNC_CRON_SECRET || null"), true);
assert.equal(cronAuthSource.includes("x-dzn-cron-secret"), true);
assert.equal(cronAuthSource.includes("x-sync-cron-secret"), true);
assert.equal(cronAuthSource.includes("x-cron-secret"), true);
assert.equal(cronAuthSource.includes("Bearer"), true);

for (const file of [
  "functions/api/sync/metadata/run.ts",
  "functions/api/sync/adm/run.ts",
  "functions/api/sync/public-snapshots/run.ts",
  "functions/api/sync/discord-posts/run.ts",
  "functions/api/sync/player-link-notifications/run.ts",
  "functions/api/sync/player-link-owner-notifications/run.ts",
  "functions/api/sync/ctf-scorecards/run.ts",
  "functions/api/debug/nitrado-admin-logs.ts",
  "functions/api/debug/nitrado-file-read.ts",
  "functions/api/sync/adm/retry-unreadable.ts",
  "functions/api/autodev/adm-health.ts",
]) {
  const source = readFileSync(file, "utf8");
  assert.equal(source.includes("requireCronSecret"), true, `${file} should use shared cron auth`);
}

for (const file of [
  "functions/api/debug/nitrado-admin-logs.ts",
  "functions/api/debug/nitrado-file-read.ts",
  "functions/api/sync/adm/retry-unreadable.ts",
  "functions/api/sync/adm/run.ts",
  "functions/api/autodev/adm-health.ts",
]) {
  const source = readFileSync(file, "utf8");
  const firstImportBlock = source.slice(0, source.indexOf("type ") > 0 ? source.indexOf("type ") : source.indexOf("export "));
  assert.equal(/from\s+["'][^"']*_lib\/(?:adm-sync|automation|db|nitrado|nitrado-diagnostics|mock)["']/.test(firstImportBlock), false, `${file} should not import heavy ADM/Nitrado/DB modules before auth`);
}

const workflowSource = readFileSync(".github/workflows/dzn-adm-sync.yml", "utf8");
assert.equal(workflowSource.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(workflowSource.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(workflowSource.includes('CRON_SECRET="${DZN_CRON_SECRET:-${SYNC_CRON_SECRET:-}}"'), true);
assert.equal(workflowSource.includes("Missing DZN_CRON_SECRET or SYNC_CRON_SECRET"), true);
assert.equal(workflowSource.includes("x-dzn-cron-secret: ${CRON_SECRET}"), true);
assert.equal(workflowSource.includes("x-sync-cron-secret: ${CRON_SECRET}"), true);
assert.equal(workflowSource.includes("x-cron-secret: ${CRON_SECRET}"), true);
assert.equal(workflowSource.includes("Authorization: Bearer ${CRON_SECRET}"), true);
assert.equal(workflowSource.includes("Cron auth failed. Check GitHub secret name/header against DZN endpoint auth helper."), true);
assert.equal(workflowSource.includes("code === 401 || code === 403"), true);
assert.equal(workflowSource.includes("Metadata sync: skipped; status=handled by dedicated metadata cadence outside ADM backup workflow"), true);
assert.equal(workflowSource.includes("Public snapshots: skipped; status=handled by public snapshot prewarm outside ADM backup workflow"), true);
assert.equal(workflowSource.includes("Discord posts: skipped; status=handled by Discord dispatcher cadence outside ADM backup workflow"), true);
assert.equal(workflowSource.includes("CTF scorecards: skipped; status=handled by CTF scorecard cadence outside ADM backup workflow"), true);
assert.equal(workflowSource.includes("/api/sync/metadata/run"), false);
assert.equal(workflowSource.includes("/api/sync/public-snapshots/run"), false);
assert.equal(workflowSource.includes("/api/sync/discord-posts/run"), false);
assert.equal(workflowSource.includes("/api/sync/ctf-scorecards/run"), false);
assert.equal(workflowSource.includes("partial_budget_reached"), true);
assert.equal(workflowSource.includes("latest_adm_unreadable"), true);
assert.equal(workflowSource.includes("nitrado_upstream_down"), true);
assert.equal(workflowSource.includes("nitrado_rate_limited"), true);
assert.equal(workflowSource.includes("file_missing_or_rotated"), true);
assert.equal(workflowSource.includes("?cron_secret="), false);
assert.equal(workflowSource.includes("echo \"$CRON_SECRET\""), false);
assert.equal(workflowSource.includes("echo \"${CRON_SECRET}\""), false);

const diagnosticsWorkflowSource = readFileSync(".github/workflows/dzn-nitrado-diagnostics.yml", "utf8");
assert.equal(diagnosticsWorkflowSource.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(diagnosticsWorkflowSource.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(diagnosticsWorkflowSource.includes('CRON_SECRET="${DZN_CRON_SECRET:-${SYNC_CRON_SECRET:-}}"'), true);
assert.equal(diagnosticsWorkflowSource.includes("x-dzn-cron-secret: ${CRON_SECRET}"), true);
assert.equal(diagnosticsWorkflowSource.includes("x-sync-cron-secret: ${CRON_SECRET}"), true);
assert.equal(diagnosticsWorkflowSource.includes("x-cron-secret: ${CRON_SECRET}"), true);
assert.equal(diagnosticsWorkflowSource.includes("Authorization: Bearer ${CRON_SECRET}"), true);
assert.equal(diagnosticsWorkflowSource.includes("?cron_secret="), false);
assert.equal(diagnosticsWorkflowSource.includes("echo \"$CRON_SECRET\""), false);

const playerLinkDeliveryWorkflow = readFileSync(".github/workflows/dzn-player-link-notification-delivery.yml", "utf8");
assert.equal(playerLinkDeliveryWorkflow.includes("workflow_dispatch:"), true);
assert.equal(playerLinkDeliveryWorkflow.includes("APPROVE_ONE_PLAYER_LINK_NOTIFICATION_TEST"), true);
assert.equal(playerLinkDeliveryWorkflow.includes("delivery_id:"), true);
assert.equal(playerLinkDeliveryWorkflow.includes("/api/sync/player-link-notifications/prove-one-v1"), true);
assert.equal(playerLinkDeliveryWorkflow.includes("/api/sync/player-link-notifications/run"), false);
assert.equal(playerLinkDeliveryWorkflow.includes("player_notification_targeted_single_delivery_v1"), true);
assert.equal(playerLinkDeliveryWorkflow.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(playerLinkDeliveryWorkflow.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(playerLinkDeliveryWorkflow.includes('CRON_SECRET="${DZN_CRON_SECRET:-${SYNC_CRON_SECRET:-}}"'), true);
assert.equal(playerLinkDeliveryWorkflow.includes("::add-mask::${CRON_SECRET}"), true);
assert.equal(playerLinkDeliveryWorkflow.includes('unauthenticated_status}" != "401"'), true);
assert.equal(playerLinkDeliveryWorkflow.includes("processed: 1"), true);
assert.equal(playerLinkDeliveryWorkflow.includes("delivered: 1"), true);
assert.equal(playerLinkDeliveryWorkflow.includes("retried: 0"), true);
assert.equal(playerLinkDeliveryWorkflow.includes("failed: 0"), true);
assert.equal(playerLinkDeliveryWorkflow.includes("skipped: 0"), true);
assert.equal(playerLinkDeliveryWorkflow.includes("echo \"$CRON_SECRET\""), false);
assert.equal(playerLinkDeliveryWorkflow.includes("echo \"${CRON_SECRET}\""), false);
assert.equal(playerLinkDeliveryWorkflow.includes("wrangler d1"), false);
assert.equal(playerLinkDeliveryWorkflow.includes("Nitrado"), false);

const ownerLinkDeliveryWorkflow = readFileSync(".github/workflows/dzn-player-link-owner-notification-delivery.yml", "utf8");
assert.equal(ownerLinkDeliveryWorkflow.includes("workflow_dispatch:"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("APPROVE_ONE_OWNER_PLAYER_LINK_NOTIFICATION_TEST"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes('CRON_SECRET="${DZN_CRON_SECRET:-${SYNC_CRON_SECRET:-}}"'), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("::add-mask::${CRON_SECRET}"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("/api/sync/player-link-owner-notifications/prove-one-v1"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes('unauthenticated_status}" != "401"'), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("owner_notification_single_delivery_v1"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("/api/sync/player-link-owner-notifications/run"), false);
assert.equal(ownerLinkDeliveryWorkflow.includes("max_jobs"), false);
assert.equal(ownerLinkDeliveryWorkflow.includes("processed: 1"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("delivered: 1"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("retried: 0"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("failed: 0"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("skipped: 0"), true);
assert.equal(ownerLinkDeliveryWorkflow.includes("echo \"$CRON_SECRET\""), false);
assert.equal(ownerLinkDeliveryWorkflow.includes("echo \"${CRON_SECRET}\""), false);
assert.equal(ownerLinkDeliveryWorkflow.includes("wrangler d1"), false);
assert.equal(ownerLinkDeliveryWorkflow.includes("Nitrado"), false);

runProtectedEndpointShortCircuitTests()
  .then(() => {
    console.log("Cron auth contract tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

async function runProtectedEndpointShortCircuitTests() {
  const env = {} as Env;
  const endpoints: Array<[string, (context: PagesContext) => Promise<Response> | Response]> = [
    ["/api/debug/nitrado-admin-logs", nitradoAdminLogsPost],
    ["/api/debug/nitrado-file-read", nitradoFileReadPost],
    ["/api/sync/adm/retry-unreadable", retryUnreadablePost],
    ["/api/autodev/adm-health", admHealthPost],
  ];
  for (const [path, handler] of endpoints) {
    const response = await handler(makeContext(new Request(`https://dzn.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }), env));
    assert.equal(response.status, 401, `${path} should return 401 before touching DB/Nitrado modules`);
  }

  const admRunResponse = await handleAdmSyncRun(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }), env));
  assert.equal(admRunResponse.status, 401, "/api/sync/adm/run should return 401 before touching DB/Nitrado modules");

  await testAdmHealthExcludesPendingServers();
}

class AdmHealthFixtureD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE linked_servers (
        id TEXT PRIMARY KEY, display_name TEXT, hostname TEXT, server_name TEXT,
        nitrado_service_name TEXT, nitrado_service_id TEXT, current_players INTEGER,
        max_players INTEGER, player_count_last_checked_at TEXT, metadata_last_checked_at TEXT,
        lifecycle_status TEXT, lifecycle_reason TEXT, owner_action_required INTEGER,
        owner_action_reason TEXT, status TEXT, listing_visibility TEXT, merged_into_server_id TEXT,
        guild_id TEXT, created_at TEXT
      );
      CREATE TABLE adm_sync_state (
        linked_server_id TEXT, latest_adm_file TEXT, last_processed_file TEXT,
        last_sync_status TEXT, last_sync_message TEXT, last_sync_at TEXT
      );
      CREATE TABLE server_sync_state (guild_id TEXT, next_retry_after TEXT, last_skip_reason TEXT);
      CREATE TABLE adm_worker_selection_state (
        linked_server_id TEXT, last_worker_selected_at TEXT, next_worker_due_at TEXT,
        selected_count INTEGER, last_selection_reason TEXT
      );
      CREATE TABLE adm_worker_heartbeat (
        worker_name TEXT, last_started_at TEXT, last_finished_at TEXT, last_status TEXT,
        last_error_code TEXT, last_error_message TEXT, last_selected_service_id TEXT,
        last_selected_server_id TEXT, last_action TEXT, last_recoverable INTEGER,
        run_count INTEGER, updated_at TEXT
      );
      CREATE TABLE adm_sync_file_state (
        linked_server_id TEXT, adm_file TEXT, status TEXT, line_count INTEGER,
        latest_known_line_count INTEGER, imported_line_count INTEGER, cursor_line INTEGER,
        last_read_at TEXT, last_growth_at TEXT, retry_count INTEGER, next_retry_at TEXT,
        last_http_status INTEGER, last_error TEXT, last_endpoint_kind TEXT, last_method TEXT,
        updated_at TEXT, ignored_at TEXT, file_timestamp TEXT, last_checked_at TEXT, first_seen_at TEXT
      );
      CREATE TABLE adm_import_jobs (
        server_id TEXT, filename TEXT, source TEXT, status TEXT, current_line INTEGER,
        total_lines INTEGER, chunks_processed INTEGER, total_chunks INTEGER, parsed_kills INTEGER,
        written_kills INTEGER, duplicate_skips INTEGER, joins INTEGER, disconnects INTEGER,
        playerlist_snapshots INTEGER, updated_at TEXT, completed_at TEXT, created_at TEXT
      );
      CREATE TABLE nitrado_file_read_attempts (
        server_id TEXT, service_id TEXT, file_name TEXT, status TEXT, http_status INTEGER,
        error_code TEXT, created_at TEXT
      );
      CREATE TABLE sync_runs (linked_server_id TEXT, finished_at TEXT, started_at TEXT, created_at TEXT, status TEXT);
      CREATE TABLE kill_events (linked_server_id TEXT);
      CREATE TABLE player_events (linked_server_id TEXT);
      CREATE TABLE adm_live_source_state (
        service_id TEXT, source_name TEXT, last_tested_at TEXT, last_status TEXT,
        last_http_status INTEGER, last_error_code TEXT, works INTEGER, preferred INTEGER,
        next_test_at TEXT, updated_at TEXT
      );
      INSERT INTO linked_servers (id, display_name, nitrado_service_id, status, listing_visibility, lifecycle_status, guild_id, created_at)
      VALUES
        ('live-server', 'Live fixture', 'live-service', 'live', 'public', 'active_live', 'live-guild', '2026-10-06T12:00:00.000Z'),
        ('pending-server', 'Pending fixture', 'pending-service', 'pending', 'public', 'active_live', 'pending-guild', '2026-10-06T12:00:00.000Z');
      INSERT INTO adm_worker_heartbeat (worker_name, last_started_at, last_finished_at, last_status, last_recoverable, run_count, updated_at)
      VALUES ('dzn-adm-sync-worker', '2026-10-06T12:00:00.000Z', '2026-10-06T12:00:01.000Z', 'healthy', 0, 1, '2026-10-06T12:00:01.000Z');
    `);
  }

  prepare(sql: string) {
    const statement = (values: unknown[] = []) => ({
      bind: (...args: unknown[]) => statement(args),
      first: async () => this.sqlite.prepare(sql).get(...values) ?? null,
      all: async () => ({ success: true, results: this.sqlite.prepare(sql).all(...values) }),
      run: async () => ({ success: true, meta: this.sqlite.prepare(sql).run(...values) }),
    });
    return statement();
  }
}

async function testAdmHealthExcludesPendingServers() {
  const db = new AdmHealthFixtureD1();
  const response = await admHealthPost(makeContext(new Request("https://dzn.test/api/autodev/adm-health", {
    method: "POST",
    headers: { "x-dzn-cron-secret": "unit-test-secret" },
  }), { DB: db as unknown as D1Database, DZN_CRON_SECRET: "unit-test-secret" } as Env));
  assert.equal(response.status, 200, "ADM health must respond for an authenticated fixture request.");
  const payload = await response.json() as { summary: { servicesChecked: number }; services: Array<{ serviceId: string }> };
  assert.equal(payload.summary.servicesChecked, 1, "ADM health must count only live linked servers.");
  assert.deepEqual(payload.services.map((service) => service.serviceId), ["live-service"], "Pending onboarding records must not enter active ADM health monitoring.");
  db.sqlite.close();
}

function makeContext(request: Request, testEnv: Env): PagesContext {
  return {
    request,
    env: testEnv,
    params: {},
    waitUntil: () => undefined,
    next: async () => new Response(null, { status: 404 }),
    data: {},
  };
}
