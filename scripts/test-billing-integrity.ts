import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { createSession } from "../functions/_lib/db";
import {
  LINKED_SERVER_ALLOWANCE_RESERVATIONS_INDEX_SQL,
  LINKED_SERVER_ALLOWANCE_RESERVATIONS_TABLE_SQL,
  completeLinkedServerAllowanceReservation,
  countLinkedServersForUser,
  ensureDraftLinkedServer,
  ensureLinkedServerAllowanceReservationSchema,
  expireLinkedServerAllowanceReservations,
  getLinkedServerAllowanceUsageForUser,
  linkedServerAllowanceLimitMessage,
  releaseLinkedServerAllowanceReservation,
  reserveLinkedServerAllowance,
  saveLinkedServerNitradoService,
  storePendingNitradoToken,
} from "../functions/_lib/onboarding";
import { getOwnerBillingStatus, upsertBillingAccount, upsertOwnerEntitlements, type PlanKey } from "../functions/_lib/plans";
import { onRequest as billingStatusHandler } from "../functions/api/billing/status";
import { onRequest as validateNitradoTokenHandler } from "../functions/api/nitrado/validate-token";
import { onRequest as saveOnboardingHandler } from "../functions/api/onboarding/save";
import { summarizeAdmBackfillForSetup } from "../functions/api/onboarding/test";
import type { AdmBackfillPlanResult, AdmImportJobProgressResult } from "../functions/_lib/adm-sync";
import type { Env, PagesFunction } from "../functions/_lib/types";

type SqliteRunResult = { changes: number; lastInsertRowid: number | bigint };
type SqliteStatement = {
  run(...values: unknown[]): SqliteRunResult;
  get(...values: unknown[]): Record<string, unknown> | undefined;
  all(...values: unknown[]): Array<Record<string, unknown>>;
};
type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
};

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => SqliteDatabase };

class SqliteD1Database {
  readonly sqlite: SqliteDatabase;

  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
  }

  prepare(query: string) {
    return new SqliteD1PreparedStatement(this.sqlite, query);
  }

  async batch(statements: SqliteD1PreparedStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  async exec(query: string) {
    this.sqlite.exec(query);
    return { count: 0, duration: 0 };
  }
}

class SqliteD1PreparedStatement {
  constructor(
    private readonly sqlite: SqliteDatabase,
    private readonly query: string,
    private readonly bindings: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new SqliteD1PreparedStatement(this.sqlite, this.query, values);
  }

  async run() {
    const result = this.sqlite.prepare(this.query).run(...this.bindings);
    return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }

  async first<T = Record<string, unknown>>() {
    return (this.sqlite.prepare(this.query).get(...this.bindings) ?? null) as T | null;
  }

  async all<T = Record<string, unknown>>() {
    return {
      success: true,
      meta: {},
      results: this.sqlite.prepare(this.query).all(...this.bindings) as T[],
    };
  }

  async raw() {
    return this.sqlite.prepare(this.query).all(...this.bindings).map((row) => Object.values(row));
  }
}

function createSqliteEnv(options: Partial<Env> = {}) {
  const db = new SqliteD1Database();
  db.sqlite.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL UNIQUE,
      username TEXT,
      avatar TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE discord_guilds (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL UNIQUE,
      owner_user_id TEXT NOT NULL,
      name TEXT,
      icon TEXT,
      icon_url TEXT,
      permissions TEXT,
      is_owner INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE linked_servers (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      guild_id TEXT,
      discord_guild_id TEXT,
      nitrado_service_id TEXT,
      nitrado_service_name TEXT,
      server_name TEXT,
      server_type TEXT,
      server_category TEXT,
      tags_json TEXT,
      region TEXT,
      status TEXT DEFAULT 'pending',
      public_slug TEXT,
      merged_into_server_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE nitrado_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      linked_server_id TEXT,
      encrypted_token TEXT,
      token_iv TEXT,
      token_auth_tag TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE onboarding_checks (
      id TEXT PRIMARY KEY,
      linked_server_id TEXT,
      token_valid INTEGER,
      service_access INTEGER,
      dayz_service_detected INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const env = {
    DB: db as unknown as D1Database,
    SESSION_SECRET: "billing-integrity-test-secret",
    TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    MOCK_NITRADO: "true",
    ...options,
  } as Env;
  return { db, env };
}

async function seedOwner(env: Env, db: SqliteD1Database, input: {
  userId: string;
  discordUserId: string;
  planKey?: PlanKey;
  status?: string;
}) {
  db.sqlite
    .prepare("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, NULL)")
    .run(input.userId, input.discordUserId, input.userId);
  db.sqlite
    .prepare("INSERT INTO discord_guilds (id, guild_id, owner_user_id, name, permissions, is_owner) VALUES (?, ?, ?, ?, '8', 1)")
    .run(`${input.userId}-guild-row`, `${input.userId}-guild`, input.userId, `${input.userId} Guild`);
  await upsertOwnerEntitlements(env, input.discordUserId, input.planKey ?? "free", input.status ?? "free");
}

function insertLinkedServer(db: SqliteD1Database, input: {
  id: string;
  userId: string;
  serviceId?: string | null;
  status?: string;
  mergedInto?: string | null;
}) {
  db.sqlite
    .prepare(
      `INSERT INTO linked_servers (
        id, user_id, guild_id, discord_guild_id, nitrado_service_id, nitrado_service_name,
        server_name, server_type, server_category, tags_json, region, status, public_slug,
        merged_into_server_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PVP', 'pvp', '[]', 'EU', ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.userId,
      `${input.userId}-guild`,
      `${input.userId}-guild-row`,
      input.serviceId ?? null,
      input.serviceId ? `${input.id} Service` : null,
      input.id,
      input.status ?? "pending",
      input.id,
      input.mergedInto ?? null,
      "2026-08-20T00:00:00.000Z",
      "2026-08-20T00:00:00.000Z",
    );
}

function reservationStatus(db: SqliteD1Database, reservationId: string) {
  return db.sqlite
    .prepare("SELECT status FROM linked_server_allowance_reservations WHERE id = ?")
    .get(reservationId)?.status;
}

function reservationCount(db: SqliteD1Database, where = "1 = 1") {
  return Number(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM linked_server_allowance_reservations WHERE ${where}`).get()?.count ?? 0);
}

function normalizeSql(value: string) {
  return value
    .replace(/--.*$/gm, "")
    .replace(/;\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const EVENT_SUGGESTIONS_MIGRATION = "0057_event_suggestions_phase_2a.sql";
const BILLING_INTEGRITY_MIGRATION = "0058_billing_phase_1_integrity.sql";
const STALE_BILLING_MIGRATION = ["0057", "billing_phase_1_integrity.sql"].join("_");

function migrationFiles() {
  return readdirSync("migrations")
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));
}

function applyMigration(db: SqliteDatabase, migrationFile: string) {
  db.exec(readFileSync(join("migrations", migrationFile), "utf8"));
}

function sqliteObjectExists(db: SqliteDatabase, name: string) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE name = ? LIMIT 1").get(name));
}

function walkTextFiles(root = ".") {
  const ignoredDirectories = new Set([
    ".git",
    ".next",
    ".wrangler",
    "coverage",
    "node_modules",
    "out",
  ]);
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    if (ignoredDirectories.has(entry)) continue;
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkTextFiles(path));
    } else if (stat.isFile() && stat.size < 1_000_000) {
      files.push(path);
    }
  }
  return files;
}

async function assertMigrationNumberingAndApplication() {
  const files = migrationFiles();
  assert.equal(files.includes(EVENT_SUGGESTIONS_MIGRATION), true, "Event Suggestions must remain migration 0057.");
  assert.equal(files.includes(BILLING_INTEGRITY_MIGRATION), true, "Billing Integrity must be migration 0058.");
  assert.equal(files.includes(STALE_BILLING_MIGRATION), false, "Old duplicate Billing Integrity migration filename must not exist.");

  const prefixes = new Map<string, string[]>();
  for (const file of files) {
    const prefix = file.slice(0, 4);
    prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), file]);
  }
  const duplicatePrefixes = [...prefixes.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([prefix, names]) => `${prefix}: ${names.join(", ")}`);
  assert.deepEqual(duplicatePrefixes, [], "Migration four-digit prefixes must be unique.");

  const deterministicOrder = [...files].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(files, deterministicOrder, "Migration application order must be deterministic by filename.");
  assert.equal(
    deterministicOrder.indexOf(BILLING_INTEGRITY_MIGRATION) > deterministicOrder.indexOf(EVENT_SUGGESTIONS_MIGRATION),
    true,
    "Billing Integrity migration 0058 must apply after Event Suggestions 0057.",
  );

  const staleReferences = walkTextFiles()
    .filter((path) => readFileSync(path, "utf8").includes(STALE_BILLING_MIGRATION));
  assert.deepEqual(staleReferences, [], "No stale exact reference to the old Billing Integrity migration filename may remain.");

  const freshDb = new SqliteD1Database();
  applyMigration(freshDb.sqlite, EVENT_SUGGESTIONS_MIGRATION);
  applyMigration(freshDb.sqlite, BILLING_INTEGRITY_MIGRATION);
  assert.equal(sqliteObjectExists(freshDb.sqlite, "event_suggestions"), true, "Fresh local migration application must include Event Suggestions 0057.");
  assert.equal(sqliteObjectExists(freshDb.sqlite, "linked_server_allowance_reservations"), true, "Fresh local migration application must include Billing Integrity 0058.");
  freshDb.sqlite.close();

  const upgradeDb = new SqliteD1Database();
  applyMigration(upgradeDb.sqlite, EVENT_SUGGESTIONS_MIGRATION);
  assert.equal(sqliteObjectExists(upgradeDb.sqlite, "event_suggestions"), true, "Pre-billing state should include Event Suggestions 0057.");
  assert.equal(sqliteObjectExists(upgradeDb.sqlite, "linked_server_allowance_reservations"), false, "Pre-billing state should not include Billing Integrity.");
  applyMigration(upgradeDb.sqlite, BILLING_INTEGRITY_MIGRATION);
  assert.equal(sqliteObjectExists(upgradeDb.sqlite, "linked_server_allowance_reservations"), true, "Upgrade from pre-billing state must apply Billing Integrity 0058.");
  assert.equal(sqliteObjectExists(upgradeDb.sqlite, "idx_lsar_active_linked_server"), true, "Billing Integrity 0058 indexes must apply on upgrade.");
  upgradeDb.sqlite.close();
}

async function assertMigrationMatchesRuntimeSchema() {
  const migration = readFileSync(join("migrations", BILLING_INTEGRITY_MIGRATION), "utf8");
  const normalizedMigration = normalizeSql(migration);
  assert.equal(
    normalizedMigration.includes(normalizeSql(LINKED_SERVER_ALLOWANCE_RESERVATIONS_TABLE_SQL)),
    true,
    "Runtime reservation table SQL must match the additive migration.",
  );
  for (const statement of LINKED_SERVER_ALLOWANCE_RESERVATIONS_INDEX_SQL) {
    assert.equal(
      normalizedMigration.includes(normalizeSql(statement)),
      true,
      `Runtime reservation index SQL must appear in the additive migration: ${statement}`,
    );
  }
}

function makeAdmFileResult(input: {
  filename: string;
  status: NonNullable<AdmImportJobProgressResult["file_result"]>["status"];
  jobId: string;
}): NonNullable<AdmImportJobProgressResult["file_result"]> {
  return {
    ok: true,
    filename: input.filename,
    source: "scheduled_nitrado",
    status: input.status,
    job_id: input.jobId,
    job_status: "completed",
    chunks_processed: 4,
    total_chunks: 4,
    raw_lines: 100,
    raw_kill_lines_found: 0,
    parsed_kills: 0,
    written_kills: 0,
    deaths: 0,
    joins: 0,
    disconnects: 0,
    playerlist_snapshots: 0,
    suicides: 0,
    uncredited_deaths: 0,
    hit_lines: 0,
    raw_events_stored: 0,
    player_events_stored: 0,
    duplicate_skips: 0,
    failed_writes: 0,
    public_cache_updated: false,
    discord_jobs_queued: 0,
    parser_warnings: [],
    kill_previews: [],
    import_report_id: null,
    imported_at: "2026-08-20T00:00:00.000Z",
  };
}

function makeAdmJob(overrides: Partial<AdmImportJobProgressResult> = {}): AdmImportJobProgressResult {
  return {
    ok: true,
    job_id: "job-default",
    filename: "default.ADM",
    source: "scheduled_nitrado",
    status: "queued",
    total_lines: 100,
    current_line: 0,
    chunk_size: 25,
    total_chunks: 4,
    chunks_processed: 0,
    display_current_chunk: 1,
    progress: 0,
    parsed_kills: 0,
    written_kills: 0,
    duplicate_skips: 0,
    joins: 0,
    disconnects: 0,
    playerlist_snapshots: 0,
    hit_lines: 0,
    raw_events_stored: 0,
    player_events_stored: 0,
    public_cache_updated: false,
    discord_jobs_queued: 0,
    warnings: [],
    file_result: null,
    error_message: null,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

function makeBackfillPlan(overrides: Partial<AdmBackfillPlanResult> = {}): AdmBackfillPlanResult {
  return {
    ok: true,
    status: "adm_backfill_created",
    message: "ADM backfill planned.",
    plan_key: "free",
    files_found: 0,
    window_files: [],
    missing_files: [],
    queued_files: [],
    created_jobs: [],
    active_job: null,
    completed_files: [],
    skipped_already_imported: [],
    unreadable_files: [],
    oldest_missing_file: null,
    newest_missing_file: null,
    newest_available_adm_file: null,
    newest_available_adm_timestamp: null,
    newest_readable_adm_file: null,
    newest_readable_adm_timestamp: null,
    next_action: "none",
    ...overrides,
  };
}

function assertSetupAdmBackfillMapper() {
  const completedJob = makeAdmJob({
    job_id: "job-completed",
    filename: "completed.ADM",
    status: "completed",
    current_line: 100,
    chunks_processed: 4,
    display_current_chunk: 4,
    progress: 1,
    completed_at: "2026-08-20T00:01:00.000Z",
  });
  const completedSummary = summarizeAdmBackfillForSetup(makeBackfillPlan({
    files_found: 1,
    newest_available_adm_file: "completed.ADM",
    newest_readable_adm_file: "completed.ADM",
    created_jobs: [completedJob],
  }));
  assert.equal(completedSummary.latest_processed_adm_file, "completed.ADM", "Completed setup job should report the processed filename.");
  assert.equal(completedSummary.created_jobs[0]?.id, "job-completed", "Setup response should map job_id to legacy id.");
  assert.equal(completedSummary.created_jobs[0]?.adm_file, "completed.ADM", "Setup response should map filename to legacy adm_file.");
  assert.equal(completedSummary.created_jobs[0]?.line_start, null, "Unrepresentable legacy line_start should be null.");
  assert.equal(completedSummary.created_jobs[0]?.line_end, null, "Unrepresentable legacy line_end should be null.");
  assert.equal(completedSummary.created_jobs[0]?.current_line, 100);
  assert.equal(completedSummary.created_jobs[0]?.total_lines, 100);
  assert.equal(completedSummary.created_jobs[0]?.display_current_chunk, 4);
  assert.equal(completedSummary.created_jobs[0]?.progress, 1);

  const warningJob = makeAdmJob({
    job_id: "job-warning",
    filename: "warning.ADM",
    status: "completed_with_warnings",
    current_line: 80,
    chunks_processed: 4,
    display_current_chunk: 4,
    progress: 0.8,
  });
  const warningSummary = summarizeAdmBackfillForSetup(makeBackfillPlan({ created_jobs: [warningJob] }));
  assert.equal(warningSummary.latest_processed_adm_file, "warning.ADM", "Completed-with-warnings setup job should count as processed.");

  const fileResultJob = makeAdmJob({
    job_id: "job-file-result",
    filename: "file-result.ADM",
    status: "processing",
    file_result: makeAdmFileResult({ filename: "file-result.ADM", status: "imported", jobId: "job-file-result" }),
  });
  const fileResultSummary = summarizeAdmBackfillForSetup(makeBackfillPlan({ created_jobs: [fileResultJob] }));
  assert.equal(fileResultSummary.latest_processed_adm_file, "file-result.ADM", "File result completion should support processed-file reporting.");

  const activeJob = makeAdmJob({
    job_id: "job-active",
    filename: "active.ADM",
    status: "processing",
    current_line: 50,
    chunks_processed: 2,
    display_current_chunk: 3,
    progress: 0.5,
  });
  const activeSummary = summarizeAdmBackfillForSetup(makeBackfillPlan({ active_job: activeJob }));
  assert.equal(activeSummary.latest_processed_adm_file, null, "Active processing job must not be claimed as completed.");
  assert.equal(activeSummary.active_job?.id, "job-active");
  assert.equal(activeSummary.active_job?.adm_file, "active.ADM");
  assert.equal(activeSummary.active_job?.current_line, 50);
  assert.equal(activeSummary.active_job?.chunks_processed, 2);

  const queuedJob = makeAdmJob({
    job_id: "job-queued",
    filename: "queued.ADM",
    status: "queued",
  });
  const queuedSummary = summarizeAdmBackfillForSetup(makeBackfillPlan({
    queued_files: ["queued.ADM"],
    created_jobs: [queuedJob],
  }));
  assert.equal(queuedSummary.latest_processed_adm_file, null, "Queued job must not be claimed as completed.");
  assert.deepEqual(queuedSummary.queued_files, ["queued.ADM"]);
  assert.equal(queuedSummary.created_jobs[0]?.id, "job-queued");
  assert.equal(queuedSummary.created_jobs[0]?.adm_file, "queued.ADM");

  const missingActiveSummary = summarizeAdmBackfillForSetup(makeBackfillPlan({
    created_jobs: [makeAdmJob({ job_id: "job-created", filename: "created-only.ADM", status: "queued" })],
    active_job: null,
  }));
  assert.equal(missingActiveSummary.active_job, null, "Missing active job should remain null.");

  const emptySummary = summarizeAdmBackfillForSetup(makeBackfillPlan());
  assert.deepEqual(emptySummary.created_jobs, [], "Empty created_jobs should stay empty.");
  assert.deepEqual(emptySummary.queued_files, [], "Empty queued_files should stay empty.");
  assert.equal(emptySummary.active_job, null);
  assert.equal(emptySummary.latest_processed_adm_file, null);

  const mapperSource = readFileSync("functions/api/onboarding/test.ts", "utf8");
  assert.equal(mapperSource.includes("job.id"), false, "Setup mapper must not read nonexistent job.id.");
  assert.equal(mapperSource.includes("job.adm_file"), false, "Setup mapper must not read nonexistent job.adm_file.");
  assert.equal(mapperSource.includes(".line_start"), false, "Setup mapper must not read nonexistent line_start.");
  assert.equal(mapperSource.includes(".line_end"), false, "Setup mapper must not read nonexistent line_end.");
}

async function assertReservationCounting() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "count-user", discordUserId: "count-discord", planKey: "pro", status: "active" });
  await ensureLinkedServerAllowanceReservationSchema(env);
  insertLinkedServer(db, { id: "committed-live", userId: "count-user", serviceId: "svc-live", status: "live" });
  insertLinkedServer(db, { id: "draft-no-service", userId: "count-user", serviceId: null, status: "pending" });
  insertLinkedServer(db, { id: "deleted-service", userId: "count-user", serviceId: "svc-deleted", status: "deleted" });
  insertLinkedServer(db, { id: "merged-service", userId: "count-user", serviceId: "svc-merged", status: "pending", mergedInto: "committed-live" });

  const activeReservation = await reserveLinkedServerAllowance(env, {
    userId: "count-user",
    discordUserId: "count-discord",
    linkedServerId: "draft-no-service",
    now: "2026-08-20T00:00:00.000Z",
  });
  assert.equal(activeReservation.ok, true);

  db.sqlite
    .prepare(
      `INSERT INTO linked_server_allowance_reservations (
        id, user_id, discord_user_id, linked_server_id, purpose, status, expires_at, created_at, updated_at
      ) VALUES
        ('active-unlinked', 'count-user', 'count-discord', NULL, 'onboarding', 'active', '2026-08-20T00:30:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
        ('active-linked-committed', 'count-user', 'count-discord', 'committed-live', 'onboarding', 'active', '2026-08-20T00:30:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
        ('active-expired', 'count-user', 'count-discord', NULL, 'onboarding', 'active', '2026-08-19T23:59:59.000Z', '2026-08-19T23:00:00.000Z', '2026-08-19T23:00:00.000Z'),
        ('completed-future', 'count-user', 'count-discord', NULL, 'onboarding', 'completed', '2026-08-20T00:30:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
        ('released-future', 'count-user', 'count-discord', NULL, 'onboarding', 'released', '2026-08-20T00:30:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')`,
    )
    .run();

  assert.equal(await countLinkedServersForUser(env, "count-user", { now: "2026-08-20T00:00:00.000Z" }), 3);
  assert.equal(reservationStatus(db, "active-expired"), "expired");
}

async function assertPlanLimits() {
  const cases: Array<{
    label: string;
    planKey: PlanKey;
    status: string;
    committedCount: number;
    shouldAllow: boolean;
    expectedLimit: number;
  }> = [
    { label: "free", planKey: "free", status: "free", committedCount: 1, shouldAllow: false, expectedLimit: 1 },
    { label: "starter", planKey: "starter", status: "active", committedCount: 1, shouldAllow: false, expectedLimit: 1 },
    { label: "pro", planKey: "pro", status: "active", committedCount: 2, shouldAllow: true, expectedLimit: 3 },
    { label: "premium", planKey: "premium", status: "active", committedCount: 9, shouldAllow: true, expectedLimit: 10 },
    { label: "legacy-network", planKey: "network", status: "active", committedCount: 9, shouldAllow: true, expectedLimit: 10 },
    { label: "legacy-partner", planKey: "partner", status: "trialing", committedCount: 9, shouldAllow: true, expectedLimit: 10 },
    { label: "inactive-pro", planKey: "pro", status: "canceled", committedCount: 1, shouldAllow: false, expectedLimit: 1 },
  ];

  for (const testCase of cases) {
    const { db, env } = createSqliteEnv();
    await seedOwner(env, db, {
      userId: `${testCase.label}-user`,
      discordUserId: `${testCase.label}-discord`,
      planKey: testCase.planKey,
      status: testCase.status,
    });
    for (let index = 0; index < testCase.committedCount; index += 1) {
      insertLinkedServer(db, {
        id: `${testCase.label}-server-${index}`,
        userId: `${testCase.label}-user`,
        serviceId: `${testCase.label}-svc-${index}`,
        status: "live",
      });
    }
    const reservation = await reserveLinkedServerAllowance(env, {
      userId: `${testCase.label}-user`,
      discordUserId: `${testCase.label}-discord`,
      linkedServerId: `${testCase.label}-draft`,
      now: "2026-08-20T00:00:00.000Z",
    });
    assert.equal(reservation.ok, testCase.shouldAllow, `${testCase.label} allowance result`);
    if (!reservation.ok) {
      assert.equal(reservation.limit, testCase.expectedLimit, `${testCase.label} allowance limit`);
      assert.equal(linkedServerAllowanceLimitMessage(reservation.limit).includes(String(testCase.expectedLimit)), true);
    }
  }
}

async function assertBillingStatusUsesReservationAwareAllowance() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "status-user", discordUserId: "status-discord", planKey: "pro", status: "active" });
  await upsertBillingAccount(env, {
    discordUserId: "status-discord",
    stripeCustomerId: "cus_status",
    planKey: "pro",
    planStatus: "active",
    currentPeriodStart: "2026-08-01T00:00:00.000Z",
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
  });
  await ensureLinkedServerAllowanceReservationSchema(env);

  insertLinkedServer(db, { id: "status-committed-a", userId: "status-user", serviceId: "status-svc-a", status: "live" });
  insertLinkedServer(db, { id: "status-committed-b", userId: "status-user", serviceId: "status-svc-b", status: "pending" });
  db.sqlite
    .prepare(
      `INSERT INTO linked_server_allowance_reservations (
        id, user_id, discord_user_id, linked_server_id, purpose, status, expires_at, created_at, updated_at
      ) VALUES
        ('status-active', 'status-user', 'status-discord', 'status-draft', 'onboarding', 'active', '2999-01-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
        ('status-expired', 'status-user', 'status-discord', 'status-expired-draft', 'onboarding', 'active', '2000-01-01T00:00:00.000Z', '1999-12-31T00:00:00.000Z', '1999-12-31T00:00:00.000Z'),
        ('status-released', 'status-user', 'status-discord', 'status-released-draft', 'onboarding', 'released', '2999-01-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
        ('status-completed', 'status-user', 'status-discord', 'status-committed-a', 'onboarding', 'completed', '2999-01-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')`,
    )
    .run();

  const status = await getOwnerBillingStatus(env, {
    id: "status-user",
    discord_id: "status-discord",
    username: "Status",
    avatar: null,
  });
  assert.equal(status.linked_server_count, 3, "Billing status should count committed linked servers plus one active reservation.");
  assert.equal(status.entitlements.max_linked_servers, 3);
  assert.equal(status.can_link_more_servers, false, "A fully consumed Pro allowance should report no remaining capacity.");
  assert.equal(reservationStatus(db, "status-expired"), "expired", "Billing status should expire stale active reservations before reporting.");

  const session = await createSession(env, "status-user");
  const response = await billingStatusHandler(makeContext(
    billingStatusHandler,
    new Request("https://local.test/api/billing/status", {
      headers: { cookie: `dzn_session=${session.token}` },
    }),
    env,
  ));
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), [
    "can_link_more_servers",
    "cancel_at_period_end",
    "checkout_configured",
    "current_period_end",
    "current_period_end_label",
    "current_period_start",
    "entitlements",
    "linked_server_count",
    "plan_key",
    "plan_status",
    "stripe_customer_exists",
  ].sort(), "Billing status API response shape should remain compatible.");
  assert.equal(body.linked_server_count, 3);
  assert.equal(JSON.stringify(body).includes("reservation"), false, "Billing status must not expose reservation internals.");
}

async function assertAllowanceUsageReportingEdges() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "usage-user", discordUserId: "usage-discord", planKey: "pro", status: "active" });

  insertLinkedServer(db, { id: "usage-no-reservation", userId: "usage-user", serviceId: "usage-svc-a", status: "live" });
  assert.deepEqual(await getLinkedServerAllowanceUsageForUser(env, {
    userId: "usage-user",
    discordUserId: "usage-discord",
    limit: 3,
    now: "2026-08-20T00:00:00.000Z",
  }), {
    limit: 3,
    used: 1,
    remaining: 2,
    canLinkMore: true,
  }, "A linked server with no reservation should report normal committed usage.");

  const activeReservation = await reserveLinkedServerAllowance(env, {
    userId: "usage-user",
    discordUserId: "usage-discord",
    linkedServerId: "usage-active-draft",
    now: "2026-08-20T00:00:00.000Z",
  });
  assert.equal(activeReservation.ok, true);
  const activeUsage = await getLinkedServerAllowanceUsageForUser(env, {
    userId: "usage-user",
    discordUserId: "usage-discord",
    limit: 3,
    now: "2026-08-20T00:00:00.000Z",
  });
  assert.equal(activeUsage.used, 2, "An active unexpired reservation should consume reporting allowance.");
  assert.equal(activeUsage.remaining, 1);

  if (activeReservation.ok) {
    await releaseLinkedServerAllowanceReservation(env, {
      reservationId: activeReservation.reservationId,
      reason: "reporting_edge_release",
      now: "2026-08-20T00:05:00.000Z",
    });
  }
  const releasedUsage = await getLinkedServerAllowanceUsageForUser(env, {
    userId: "usage-user",
    discordUserId: "usage-discord",
    limit: 3,
    now: "2026-08-20T00:05:00.000Z",
  });
  assert.equal(releasedUsage.used, 1, "Released reservations should not consume reporting allowance.");

  const completedReservation = await reserveLinkedServerAllowance(env, {
    userId: "usage-user",
    discordUserId: "usage-discord",
    linkedServerId: "usage-completed-row",
    now: "2026-08-20T00:10:00.000Z",
  });
  assert.equal(completedReservation.ok, true);
  insertLinkedServer(db, { id: "usage-completed-row", userId: "usage-user", serviceId: "usage-svc-completed", status: "live" });
  if (completedReservation.ok) {
    await completeLinkedServerAllowanceReservation(env, completedReservation.reservationId, "usage-completed-row", "2026-08-20T00:11:00.000Z");
  }
  const completedUsage = await getLinkedServerAllowanceUsageForUser(env, {
    userId: "usage-user",
    discordUserId: "usage-discord",
    limit: 3,
    now: "2026-08-20T00:12:00.000Z",
  });
  assert.equal(completedUsage.used, 2, "Completed reservations should not double-count beside their linked-server row.");

  db.sqlite
    .prepare(
      `INSERT INTO linked_server_allowance_reservations (
        id, user_id, discord_user_id, linked_server_id, purpose, status, expires_at, created_at, updated_at
      ) VALUES ('usage-expired-active', 'usage-user', 'usage-discord', 'usage-expired-draft', 'onboarding', 'active', '2026-08-20T00:00:00.000Z', '2026-08-19T23:00:00.000Z', '2026-08-19T23:00:00.000Z')`,
    )
    .run();
  const expiredUsage = await getLinkedServerAllowanceUsageForUser(env, {
    userId: "usage-user",
    discordUserId: "usage-discord",
    limit: 3,
    now: "2026-08-20T00:12:00.000Z",
  });
  assert.equal(expiredUsage.used, 2, "Expired reservations should not consume reporting allowance.");
  assert.equal(reservationStatus(db, "usage-expired-active"), "expired");

  insertLinkedServer(db, { id: "usage-overage", userId: "usage-user", serviceId: "usage-svc-overage", status: "live" });
  const overageUsage = await getLinkedServerAllowanceUsageForUser(env, {
    userId: "usage-user",
    discordUserId: "usage-discord",
    limit: 1,
    now: "2026-08-20T00:13:00.000Z",
  });
  assert.equal(overageUsage.used, 3);
  assert.equal(overageUsage.remaining, 0, "Remaining capacity must clamp to zero when usage exceeds the limit.");
  assert.equal(overageUsage.canLinkMore, false);
}

async function assertBillingStatusPlanNormalization() {
  const cases: Array<{
    label: string;
    accountPlanKey: PlanKey;
    accountStatus: string;
    legacyRawAccount?: boolean;
    expectedPlanKey: PlanKey;
    expectedLimit: number;
  }> = [
    { label: "free", accountPlanKey: "free", accountStatus: "free", expectedPlanKey: "free", expectedLimit: 1 },
    { label: "starter-active", accountPlanKey: "starter", accountStatus: "active", expectedPlanKey: "starter", expectedLimit: 1 },
    { label: "pro-trialing", accountPlanKey: "pro", accountStatus: "trialing", expectedPlanKey: "pro", expectedLimit: 3 },
    { label: "premium-active", accountPlanKey: "premium", accountStatus: "active", expectedPlanKey: "premium", expectedLimit: 10 },
    { label: "network-legacy", accountPlanKey: "network", accountStatus: "active", legacyRawAccount: true, expectedPlanKey: "premium", expectedLimit: 10 },
    { label: "partner-legacy", accountPlanKey: "partner", accountStatus: "trialing", legacyRawAccount: true, expectedPlanKey: "premium", expectedLimit: 10 },
    { label: "inactive-pro", accountPlanKey: "pro", accountStatus: "canceled", expectedPlanKey: "free", expectedLimit: 1 },
  ];

  for (const testCase of cases) {
    const { db, env } = createSqliteEnv();
    await seedOwner(env, db, {
      userId: `${testCase.label}-user`,
      discordUserId: `${testCase.label}-discord`,
      planKey: "free",
      status: "free",
    });
    if (testCase.legacyRawAccount) {
      db.sqlite
        .prepare(
          `INSERT INTO owner_billing_accounts (
            id, discord_user_id, stripe_customer_id, stripe_subscription_id, plan_key, plan_status,
            current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, 0, ?, ?)`,
        )
        .run(
          `${testCase.label}-billing`,
          `${testCase.label}-discord`,
          `cus-${testCase.label}`,
          testCase.accountPlanKey,
          testCase.accountStatus,
          "2026-08-20T00:00:00.000Z",
          "2026-08-20T00:00:00.000Z",
        );
    } else {
      await upsertBillingAccount(env, {
        discordUserId: `${testCase.label}-discord`,
        stripeCustomerId: `cus-${testCase.label}`,
        planKey: testCase.accountPlanKey,
        planStatus: testCase.accountStatus,
      });
    }
    const status = await getOwnerBillingStatus(env, {
      id: `${testCase.label}-user`,
      discord_id: `${testCase.label}-discord`,
      username: testCase.label,
      avatar: null,
    });
    assert.equal(status.plan_key, testCase.expectedPlanKey, `${testCase.label} normalized plan`);
    assert.equal(status.entitlements.max_linked_servers, testCase.expectedLimit, `${testCase.label} allowance limit`);
    assert.equal(status.linked_server_count, 0, `${testCase.label} empty usage`);
    assert.equal(status.can_link_more_servers, testCase.expectedLimit > 0, `${testCase.label} can link more`);
  }
}

async function assertDraftAndServiceAttachmentLifecycle() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "attach-user", discordUserId: "attach-discord", planKey: "pro", status: "active" });
  const linkedServerId = await ensureDraftLinkedServer(env, "attach-user", "attach-user-guild", "PVP", ["KOS"], "pvp");
  assert.equal(reservationCount(db, "status = 'active'"), 1, "Draft creation should hold one active reservation.");
  assert.equal(await countLinkedServersForUser(env, "attach-user", { now: "2026-08-20T00:00:00.000Z" }), 1);

  const reusedLinkedServerId = await ensureDraftLinkedServer(env, "attach-user", "attach-user-guild", "PVP", ["KOS"], "pvp");
  assert.equal(reusedLinkedServerId, linkedServerId, "Repeated validation should reuse the draft linked server.");
  assert.equal(reservationCount(db, "status = 'active'"), 1, "Repeated validation must not double-reserve.");

  const savedLinkedServerId = await saveLinkedServerNitradoService(env, linkedServerId, {
    id: "service-attach",
    name: "Attached DayZ",
    game: "DayZ",
    region: "EU",
    platform: "PlayStation",
    ipAddress: "203.0.113.99",
    playerSlots: 60,
  }, "PVP", ["KOS"], "pvp");
  assert.equal(savedLinkedServerId, linkedServerId);
  assert.equal(reservationCount(db, "status = 'active'"), 0, "Service attachment should complete the active reservation.");
  assert.equal(reservationCount(db, "status = 'completed'"), 1);
  assert.equal(await countLinkedServersForUser(env, "attach-user", { now: "2026-08-20T00:00:00.000Z" }), 1);

  const completedReservationId = String(db.sqlite.prepare("SELECT id FROM linked_server_allowance_reservations WHERE status = 'completed'").get()?.id);
  await completeLinkedServerAllowanceReservation(env, completedReservationId, linkedServerId, "2026-08-20T01:00:00.000Z");
  await releaseLinkedServerAllowanceReservation(env, {
    reservationId: completedReservationId,
    reason: "idempotent-release-after-complete",
    now: "2026-08-20T01:00:00.000Z",
  });
  assert.equal(reservationStatus(db, completedReservationId), "completed", "Completed reservations must not be double-released.");
}

async function assertFailedServiceAttachmentReleasesReservation() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "fail-attach-user", discordUserId: "fail-attach-discord", planKey: "pro", status: "active" });
  const linkedServerId = await ensureDraftLinkedServer(env, "fail-attach-user", "fail-attach-user-guild", "PVP", [], "pvp");
  db.sqlite.exec(`
    CREATE TRIGGER fail_service_attachment
    BEFORE UPDATE OF nitrado_service_id ON linked_servers
    BEGIN
      SELECT RAISE(ABORT, 'forced service attachment failure');
    END;
  `);
  await assert.rejects(
    () => saveLinkedServerNitradoService(env, linkedServerId, {
      id: "service-fail",
      name: "Failing DayZ",
      game: "DayZ",
    }, "PVP", [], "pvp"),
    /forced service attachment failure/i,
  );
  assert.equal(reservationCount(db, "status = 'active'"), 0, "Failed attachment path should not leave active reservations.");
  assert.equal(reservationCount(db, "status = 'released' AND release_reason = 'service_attachment_failed'"), 1);
}

async function assertExpiredReservationLifecycle() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "expire-user", discordUserId: "expire-discord", planKey: "pro", status: "active" });
  const reservation = await reserveLinkedServerAllowance(env, {
    userId: "expire-user",
    discordUserId: "expire-discord",
    linkedServerId: "expire-draft",
    now: "2026-08-20T00:00:00.000Z",
    ttlMs: 1000,
  });
  assert.equal(reservation.ok, true);
  if (reservation.ok) {
    await expireLinkedServerAllowanceReservations(env, { userId: "expire-user", now: "2026-08-20T00:00:01.001Z" });
    assert.equal(reservationStatus(db, reservation.reservationId), "expired");
    await releaseLinkedServerAllowanceReservation(env, {
      reservationId: reservation.reservationId,
      reason: "idempotent-release-after-expiry",
      now: "2026-08-20T00:00:02.000Z",
    });
    assert.equal(reservationStatus(db, reservation.reservationId), "expired", "Expired reservations must not be double-released.");
    assert.equal(await countLinkedServersForUser(env, "expire-user", { now: "2026-08-20T00:00:02.000Z" }), 0);
  }
}

async function assertTokenWriteFailureReleasesReservation() {
  const { db, env } = createSqliteEnv({ TOKEN_ENCRYPTION_KEY: undefined });
  await seedOwner(env, db, { userId: "token-user", discordUserId: "token-discord", planKey: "pro", status: "active" });
  const linkedServerId = await ensureDraftLinkedServer(env, "token-user", "token-user-guild", "PVP", [], "pvp");

  await assert.rejects(
    () => storePendingNitradoToken(env, "token-user", linkedServerId, "long-enough-token"),
    /TOKEN_ENCRYPTION_KEY is not configured/i,
  );
  assert.equal(reservationCount(db, "status = 'active'"), 0, "Token setup failure should release active reservations.");
  assert.equal(reservationCount(db, "status = 'released' AND release_reason = 'missing_token_encryption_key'"), 1);
}

async function assertOnboardingSaveFailureReleasesReservationWithoutDeletingServer() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "save-user", discordUserId: "save-discord", planKey: "pro", status: "active" });
  const session = await createSession(env, "save-user");
  const request = new Request("https://local.test/api/onboarding/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `dzn_session=${session.token}`,
    },
    body: JSON.stringify({
      discordGuildId: "save-user-guild",
      serverType: "PVP",
      server_category: "pvp",
      tags: ["KOS"],
      nitradoServiceId: "900001",
    }),
  });

  await assert.rejects(
    async () => {
      await saveOnboardingHandler(makeContext(saveOnboardingHandler, request, env));
    },
    /no such table: kill_events/i,
  );

  assert.equal(reservationCount(db, "status = 'active'"), 0, "Failed onboarding save should release active reservations.");
  assert.equal(reservationCount(db, "status = 'released' AND release_reason = 'onboarding_save_failed'"), 1);
  assert.equal(
    Number(db.sqlite.prepare("SELECT COUNT(*) AS count FROM linked_servers WHERE user_id = 'save-user' AND nitrado_service_id = '900001'").get()?.count ?? 0),
    1,
    "The failed post-write path must not delete the linked-server row it wrote.",
  );
}

async function assertNitradoValidationLimitFailure() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "validate-user", discordUserId: "validate-discord", planKey: "free", status: "free" });
  insertLinkedServer(db, { id: "validate-existing", userId: "validate-user", serviceId: "validate-service", status: "live" });
  const session = await createSession(env, "validate-user");
  const request = new Request("https://local.test/api/nitrado/validate-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `dzn_session=${session.token}`,
    },
    body: JSON.stringify({
      token: "long-enough-token",
      discordGuildId: "validate-user-guild",
      serverType: "PVP",
      server_category: "pvp",
      tags: [],
    }),
  });

  const response = await validateNitradoTokenHandler(makeContext(validateNitradoTokenHandler, request, env));
  assert.equal(response.status, 402);
  assert.match(await response.text(), /allows 1 linked server/i);
  assert.equal(reservationCount(db, "status = 'active'"), 0, "Rejected Nitrado validation must not leave an active reservation.");
}

function makeContext(handler: PagesFunction, request: Request, env: Env): Parameters<typeof handler>[0] {
  return {
    request,
    env,
    params: {},
    waitUntil() {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
  };
}

async function run() {
  await assertMigrationNumberingAndApplication();
  await assertMigrationMatchesRuntimeSchema();
  assertSetupAdmBackfillMapper();
  await assertReservationCounting();
  await assertPlanLimits();
  await assertBillingStatusUsesReservationAwareAllowance();
  await assertAllowanceUsageReportingEdges();
  await assertBillingStatusPlanNormalization();
  await assertDraftAndServiceAttachmentLifecycle();
  await assertFailedServiceAttachmentReleasesReservation();
  await assertExpiredReservationLifecycle();
  await assertTokenWriteFailureReleasesReservation();
  await assertOnboardingSaveFailureReleasesReservationWithoutDeletingServer();
  await assertNitradoValidationLimitFailure();
  console.log("Billing integrity reservation tests passed.");
}

void run();
