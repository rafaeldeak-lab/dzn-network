import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { createSession, getLinkedServerForUserById } from "../functions/_lib/db";
import { storePendingNitradoToken } from "../functions/_lib/onboarding";
import { onRequest as saveOnboardingHandler } from "../functions/api/onboarding/save";
import {
  ONBOARDING_VERIFICATION_STAGES,
  onRequest as testOnboardingHandler,
} from "../functions/api/onboarding/test";
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
type OperationCounts = {
  prepare: number;
  first: number;
  all: number;
  run: number;
  raw: number;
  exec: number;
  batch: number;
};
type D1FailureOperation = Exclude<keyof OperationCounts, "prepare" | "batch">;
type D1FailureRule = {
  operation: D1FailureOperation;
  pattern: RegExp;
  error: Error;
};
type ApiJson = Record<string, unknown> & {
  error_code?: unknown;
  failure_stage?: unknown;
  linkedServerId?: unknown;
  ok?: unknown;
  checks?: unknown;
};

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => SqliteDatabase };

const prefix = "billing-phase1-preview-";
const ownerA = id("owner-a");
const ownerB = id("owner-b");
const target900003 = id("owner-a-source-new-900003");
const forbiddenResponseMarkers = [
  "preview-only-nitrado-token",
  "not-valid-ciphertext",
  "not-valid-iv",
  "not-valid-tag",
  "encrypted_token",
  "token_iv",
  "token_auth_tag",
  "TOKEN_ENCRYPTION_KEY",
  "SESSION_SECRET",
  "Authorization",
  "Bearer ",
  "SELECT ",
  "INSERT INTO",
  "UPDATE ",
  "DELETE ",
  "ALTER TABLE",
  "CREATE TABLE",
  "Error:",
  " at ",
  "stack",
  "Traceback",
];
const readOnlyOperationClasses = new Set(["PRAGMA", "SELECT"]);
const forbiddenExactLookupOperationClasses = new Set(["ALTER", "CREATE", "DROP", "DELETE", "UPDATE", "INSERT", "REPLACE"]);
const forbiddenSideEffectTables = [
  "server_public_cache",
  "public_home_stats_cache",
  "server_advertising_state",
  "server_promotions",
  "promotion_credits",
  "promotion_impressions",
  "promotion_clicks",
  "promotion_audit_log",
];
const diagnosticPreviewBaseUrl = "https://443351c7.dzn-network-owner-console-preview-billing-phase-1.pages.dev";
const diagnosticInternalErrorMessage = "forced internal setup verification failure with SQL stack credential marker";
const diagnosticForbiddenResponseMarkers = [
  ...forbiddenResponseMarkers,
  diagnosticInternalErrorMessage,
  "SELECT ",
  "INSERT INTO",
  "UPDATE onboarding_checks",
  "server_log_config",
  "/games/",
  "mock.ADM",
  "d1-diagnostic-id",
];

class InstrumentedSqliteD1Database {
  readonly sqlite: SqliteDatabase;
  readonly counts: OperationCounts = {
    prepare: 0,
    first: 0,
    all: 0,
    run: 0,
    raw: 0,
    exec: 0,
    batch: 0,
  };
  readonly touchedSql: string[] = [];
  private readonly failureRules: D1FailureRule[] = [];
  private blockMutatingPreparedStatements = false;

  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
  }

  prepare(query: string) {
    this.record("prepare", query);
    if (this.blockMutatingPreparedStatements) {
      const operationClass = sqlOperationClass(query);
      if (forbiddenExactLookupOperationClasses.has(operationClass)) {
        throw new Error(`Read-only D1 adapter blocked ${operationClass} statement during exact linked-server lookup test; observed_classes=${sqlOperationClasses(this.touchedSql).join(",")}`);
      }
    }
    return new InstrumentedSqliteD1PreparedStatement(this, query);
  }

  async batch(statements: InstrumentedSqliteD1PreparedStatement[]) {
    this.counts.batch += 1;
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  async exec(query: string) {
    this.record("exec", query);
    this.maybeFail("exec", query);
    this.sqlite.exec(query);
    return { success: true, meta: { count: 0, duration: 0 } };
  }

  record(operation: keyof OperationCounts, query: string) {
    if (operation !== "batch") this.counts[operation] += 1;
    this.touchedSql.push(query);
  }

  resetOperationTracking() {
    for (const key of Object.keys(this.counts) as Array<keyof OperationCounts>) {
      this.counts[key] = 0;
    }
    this.touchedSql.length = 0;
  }

  setReadOnlyPreparedStatements(enabled: boolean) {
    this.blockMutatingPreparedStatements = enabled;
  }

  snapshotOperationCounts() {
    return { ...this.counts };
  }

  failOnce(operation: D1FailureOperation, pattern: RegExp, message = diagnosticInternalErrorMessage) {
    const error = new Error(message);
    this.failureRules.push({ operation, pattern, error });
    return error;
  }

  maybeFail(operation: D1FailureOperation, query: string) {
    const index = this.failureRules.findIndex((rule) => rule.operation === operation && rule.pattern.test(query));
    if (index < 0) return;
    const [rule] = this.failureRules.splice(index, 1);
    throw rule.error;
  }
}

class InstrumentedSqliteD1PreparedStatement {
  constructor(
    private readonly db: InstrumentedSqliteD1Database,
    private readonly query: string,
    private readonly bindings: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new InstrumentedSqliteD1PreparedStatement(this.db, this.query, values);
  }

  async run() {
    this.db.record("run", this.query);
    this.db.maybeFail("run", this.query);
    const result = this.db.sqlite.prepare(this.query).run(...this.bindings);
    return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }

  async first<T = Record<string, unknown>>(colName?: string) {
    this.db.record("first", this.query);
    this.db.maybeFail("first", this.query);
    const row = this.db.sqlite.prepare(this.query).get(...this.bindings) ?? null;
    if (colName) return (row ? row[colName] ?? null : null) as T | null;
    return row as T | null;
  }

  async all<T = Record<string, unknown>>() {
    this.db.record("all", this.query);
    this.db.maybeFail("all", this.query);
    return {
      success: true,
      meta: {},
      results: this.db.sqlite.prepare(this.query).all(...this.bindings) as T[],
    };
  }

  async raw() {
    this.db.record("raw", this.query);
    this.db.maybeFail("raw", this.query);
    return this.db.sqlite.prepare(this.query).all(...this.bindings).map((row) => Object.values(row));
  }
}

async function createMigratedEnv() {
  const db = new InstrumentedSqliteD1Database();
  await db.exec("PRAGMA foreign_keys = OFF;");
  const migrations = readdirSync("migrations")
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const prefixNumber = Number(migration.slice(0, 4));
    if (prefixNumber > 59) continue;
    await db.exec(readFileSync(join("migrations", migration), "utf8"));
  }
  assert.equal(migrations.some((file) => file.startsWith("0059_")), true, "Expected migrations through 0059.");
  await db.exec("PRAGMA foreign_keys = ON;");
  const env = {
    DB: db as unknown as D1Database,
    SESSION_SECRET: "billing-preview-local-session-secret",
    TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    MOCK_AUTH: "true",
    MOCK_NITRADO: "true",
    DZN_DISCORD_NOTIFICATIONS_ENABLED: "false",
    DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: "false",
    DZN_APP_URL: "https://local.test",
  } as Env;
  return { db, env };
}

function assertExactLookupMigrationSchema(db: InstrumentedSqliteD1Database) {
  assertTableColumns(db, "linked_servers", [
    "id",
    "user_id",
    "guild_id",
    "discord_guild_id",
    "nitrado_service_id",
    "status",
    "merged_into_server_id",
  ]);
  assertTableColumns(db, "discord_guilds", [
    "id",
    "name",
    "icon_url",
  ]);
  assertTableColumns(db, "server_log_config", [
    "linked_server_id",
    "adm_path",
  ]);
  assertTableColumns(db, "onboarding_checks", [
    "linked_server_id",
    "adm_logs_found",
    "last_tested_at",
  ]);
  assertSqliteObjectExists(db, "idx_server_log_config_linked_server_id", "index");
  assertSqliteObjectExists(db, "idx_linked_servers_merged_into_server_id", "index");
  const foreignKeyRows = db.sqlite.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(foreignKeyRows, [], "Fresh migrations through 0059 must pass foreign key checks.");
}

function assertTableColumns(db: InstrumentedSqliteD1Database, table: string, required: string[]) {
  const columns = new Set(db.sqlite.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name || "")));
  for (const column of required) {
    assert.equal(columns.has(column), true, `Fresh migrations through 0059 must include ${table}.${column}.`);
  }
}

function assertSqliteObjectExists(db: InstrumentedSqliteD1Database, name: string, type: "index" | "table") {
  const row = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1").get(type, name);
  assert.equal(row?.name, name, `Fresh migrations through 0059 must include ${type} ${name}.`);
}

async function seedBillingPreviewFixture(env: Env, db: InstrumentedSqliteD1Database) {
  await insertUser(db, ownerA, "owner-a-discord", "BillingPreviewOwnerA");
  await insertUser(db, ownerB, "owner-b-discord", "BillingPreviewOwnerB");
  await insertGuild(db, "owner-a-900001", ownerA, "Billing Preview Owner A Canonical 900001");
  await insertGuild(db, "owner-a-900002", ownerA, "Billing Preview Owner A Canonical 900002");
  await insertGuild(db, "owner-a-draft", ownerA, "Billing Preview Owner A Drafts");
  await insertGuild(db, "owner-b-draft", ownerB, "Billing Preview Owner B Drafts");
  await insertBillingRows(db, "owner-a");
  await insertBillingRows(db, "owner-b");
  await insertServerSubscription(db, "owner-a-900001", "owner-a-discord");
  await insertServerSubscription(db, "owner-a-900002", "owner-a-discord");
  await insertLinkedServer(db, { alias: "owner-a-canonical-900001", ownerAlias: "owner-a", guildAlias: "owner-a-900001", serviceId: "900001", serviceName: "Pandora DayZ", status: "live" });
  await insertLinkedServer(db, { alias: "owner-a-canonical-900002", ownerAlias: "owner-a", guildAlias: "owner-a-900002", serviceId: "900002", serviceName: "Warlords PvP", status: "live" });
  await insertLinkedServer(db, { alias: "owner-a-source-no-credential", ownerAlias: "owner-a", guildAlias: "owner-a-draft", serviceId: null, serviceName: "Owner A source no credential", status: "pending" });
  await insertLinkedServer(db, { alias: "owner-a-source-corrupted-credential", ownerAlias: "owner-a", guildAlias: "owner-a-draft", serviceId: null, serviceName: "Owner A source corrupted credential", status: "pending" });
  await insertLinkedServer(db, { alias: "owner-a-source-duplicate-900002", ownerAlias: "owner-a", guildAlias: "owner-a-draft", serviceId: null, serviceName: "Owner A duplicate source for 900002", status: "pending" });
  await insertLinkedServer(db, { alias: "owner-a-source-new-900003", ownerAlias: "owner-a", guildAlias: "owner-a-draft", serviceId: null, serviceName: "Owner A source new 900003", status: "pending" });
  await insertLinkedServer(db, { alias: "owner-b-source-cross-900001", ownerAlias: "owner-b", guildAlias: "owner-b-draft", serviceId: null, serviceName: "Owner B cross-owner source 900001", status: "pending" });
  for (const [alias, ownerAlias] of [
    ["owner-a-source-no-credential", "owner-a"],
    ["owner-a-source-corrupted-credential", "owner-a"],
    ["owner-a-source-duplicate-900002", "owner-a"],
    ["owner-a-source-new-900003", "owner-a"],
    ["owner-b-source-cross-900001", "owner-b"],
  ] as const) {
    await insertReservation(db, alias, ownerAlias);
  }
  await storePendingNitradoToken(env, ownerA, id("owner-a-canonical-900001"), "preview-only-nitrado-token-owner-a-canonical-900001");
  await storePendingNitradoToken(env, ownerA, id("owner-a-canonical-900002"), "preview-only-nitrado-token-owner-a-canonical-900002");
  await storePendingNitradoToken(env, ownerA, id("owner-a-source-duplicate-900002"), "preview-only-nitrado-token-owner-a-source-duplicate-900002");
  await storePendingNitradoToken(env, ownerA, target900003, "preview-only-nitrado-token-owner-a-source-new-900003");
  await storePendingNitradoToken(env, ownerB, id("owner-b-source-cross-900001"), "preview-only-nitrado-token-owner-b-source-cross-900001");
  await insertCorruptedConnection(db);
}

async function insertUser(db: InstrumentedSqliteD1Database, userId: string, discordId: string, username: string) {
  await db.prepare("INSERT INTO users (id, discord_id, username, avatar, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)").bind(userId, discordId, username, fixtureTime(), fixtureTime()).run();
}

async function insertGuild(db: InstrumentedSqliteD1Database, alias: string, ownerUserId: string, name: string) {
  await db
    .prepare("INSERT INTO discord_guilds (id, guild_id, owner_user_id, name, icon, icon_url, permissions, is_owner, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, '8', 1, ?, ?)")
    .bind(guildRow(alias), guildId(alias), ownerUserId, name, fixtureTime(), fixtureTime())
    .run();
}

async function insertBillingRows(db: InstrumentedSqliteD1Database, ownerAlias: "owner-a" | "owner-b") {
  await db
    .prepare(
      `INSERT INTO owner_billing_accounts (
        id, discord_user_id, stripe_customer_id, stripe_subscription_id, plan_key, plan_status,
        current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, 'pro', 'active', '2026-08-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 0, ?, ?)`,
    )
    .bind(id(`${ownerAlias}-billing`), `${ownerAlias}-discord`, fixtureTime(), fixtureTime())
    .run();
  await db
    .prepare(
      `INSERT INTO owner_plan_entitlements (
        discord_user_id, plan_key, max_linked_servers, can_use_reviews, can_use_public_listing,
        can_use_advanced_analytics, can_join_events, can_use_ad_bumps, included_bumps_per_month,
        bump_cooldown_hours, can_use_featured_slots, stat_history_days, updated_at
      ) VALUES (?, 'pro', 3, 1, 1, 1, 1, 1, 2, 168, 0, 30, ?)`,
    )
    .bind(`${ownerAlias}-discord`, fixtureTime())
    .run();
}

async function insertServerSubscription(db: InstrumentedSqliteD1Database, guildAlias: string, ownerDiscordId: string) {
  await db
    .prepare(
      `INSERT INTO server_subscriptions (
        id, guild_id, owner_discord_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan_key, status,
        current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, NULL, NULL, 'pro', 'active', '2026-08-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 0, ?, ?)`,
    )
    .bind(id(`${guildAlias}-sub`), guildId(guildAlias), ownerDiscordId, fixtureTime(), fixtureTime())
    .run();
}

async function insertLinkedServer(
  db: InstrumentedSqliteD1Database,
  input: {
    alias: string;
    ownerAlias: "owner-a" | "owner-b";
    guildAlias: string;
    serviceId: string | null;
    serviceName: string;
    status: "live" | "pending" | "deleted";
  },
) {
  await db
    .prepare(
      `INSERT INTO linked_servers (
        id, user_id, guild_id, discord_guild_id, nitrado_service_id, nitrado_service_name, server_name,
        server_type, server_category, tags_json, region, status, public_slug, listing_visibility,
        lifecycle_status, lifecycle_reason, lifecycle_updated_at, owner_action_required,
        latest_imported_event_at, game, platform, ip_address, player_slots, merged_into_server_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PVP', 'pvp', ?, 'EU', ?, ?, 'hidden',
        'active_live', 'billing_phase_1_preview_fixture', ?, 0,
        ?, 'DayZ', 'PlayStation', '203.0.113.21', 60, NULL,
        ?, ?)`,
    )
    .bind(
      id(input.alias),
      id(input.ownerAlias),
      guildId(input.guildAlias),
      guildRow(input.guildAlias),
      input.serviceId,
      input.serviceName,
      input.serviceName,
      JSON.stringify(["billing-preview"]),
      input.status,
      id(input.alias),
      fixtureTime(),
      fixtureTime(),
      fixtureTime(),
      fixtureTime(),
    )
    .run();
}

async function insertServerLogConfig(db: InstrumentedSqliteD1Database, linkedServerId: string, admPath: string) {
  await db
    .prepare("INSERT INTO server_log_config (id, linked_server_id, adm_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(`${linkedServerId}-log-config`, linkedServerId, admPath, fixtureTime(), fixtureTime())
    .run();
}

async function insertOnboardingCheck(db: InstrumentedSqliteD1Database, linkedServerId: string) {
  await db
    .prepare(
      `INSERT INTO onboarding_checks (
        id, linked_server_id, token_valid, service_access, adm_logs_found, dayz_service_detected, last_tested_at
      ) VALUES (?, ?, 1, 1, 1, 1, ?)`,
    )
    .bind(`${linkedServerId}-onboarding-check`, linkedServerId, fixtureTime())
    .run();
}

async function insertReservation(db: InstrumentedSqliteD1Database, alias: string, ownerAlias: "owner-a" | "owner-b") {
  await db
    .prepare(
      `INSERT INTO linked_server_allowance_reservations (
        id, user_id, discord_user_id, linked_server_id, purpose, status, expires_at,
        completed_at, released_at, expired_at, release_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'onboarding', 'active', '2099-01-01T00:00:00.000Z', NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .bind(id(`${alias}-reservation`), id(ownerAlias), `${ownerAlias}-discord`, id(alias), fixtureTime(), fixtureTime())
    .run();
}

async function insertCorruptedConnection(db: InstrumentedSqliteD1Database) {
  await db
    .prepare(
      `INSERT INTO nitrado_connections (
        id, user_id, linked_server_id, encrypted_token, token_iv, token_auth_tag, created_at, updated_at
      ) VALUES (?, ?, ?, 'not-valid-ciphertext', 'not-valid-iv', 'not-valid-tag', ?, ?)`,
    )
    .bind(id("owner-a-source-corrupted-credential-connection"), ownerA, id("owner-a-source-corrupted-credential"), fixtureTime(), fixtureTime())
    .run();
}

async function runPreviewSaveSequence(env: Env, db: InstrumentedSqliteD1Database, ownerASession: string, ownerBSession: string) {
  const crossOwner = await postJson(saveOnboardingHandler, env, ownerBSession, "/api/onboarding/save", savePayload("owner-b-source-cross-900001", "900001", "owner-b-draft"));
  assert.equal(crossOwner.status, 409, "Cross-owner 900001 claim should return safe 409.");
  assert.equal(crossOwner.json.error_code, "nitrado_service_already_linked");
  assert.equal(countRows(db, "linked_servers", `id = '${id("owner-a-canonical-900001")}' AND user_id = '${ownerA}'`), 1);

  const sameOwner = await postJson(saveOnboardingHandler, env, ownerASession, "/api/onboarding/save", savePayload("owner-a-source-duplicate-900002", "900002"));
  assert.equal(sameOwner.status, 200, "Same-owner duplicate 900002 save should succeed.");
  assert.equal(sameOwner.json.linkedServerId, id("owner-a-canonical-900002"));
  assert.equal(countRows(db, "linked_servers", `id = '${id("owner-a-source-duplicate-900002")}' AND status = 'merged' AND merged_into_server_id = '${id("owner-a-canonical-900002")}'`), 1);
  assert.equal(countRows(db, "linked_server_allowance_reservations", `id = '${id("owner-a-source-duplicate-900002-reservation")}' AND status = 'released' AND release_reason = 'same_owner_canonical_reuse'`), 1);
  assert.equal(countRows(db, "nitrado_connections", `user_id = '${ownerA}' AND linked_server_id = '${id("owner-a-canonical-900002")}'`), 2);

  const firstClaim = await postJson(saveOnboardingHandler, env, ownerASession, "/api/onboarding/save", savePayload("owner-a-source-new-900003", "900003"));
  assert.equal(firstClaim.status, 200, "First-time 900003 claim should succeed.");
  assert.equal(firstClaim.json.linkedServerId, target900003);
  assert.equal(countRows(db, "linked_server_allowance_reservations", `id = '${id("owner-a-source-new-900003-reservation")}' AND status = 'completed' AND linked_server_id = '${target900003}'`), 1);

  const repeatedClaim = await postJson(saveOnboardingHandler, env, ownerASession, "/api/onboarding/save", savePayload("owner-a-source-new-900003", "900003"));
  assert.equal(repeatedClaim.status, 200, "Repeated 900003 save should remain idempotent.");
  assert.equal(repeatedClaim.json.linkedServerId, target900003);
  assert.equal(countRows(db, "linked_servers", "nitrado_service_id = '900003' AND lower(COALESCE(status, 'pending')) NOT IN ('merged', 'deleted') AND (merged_into_server_id IS NULL OR merged_into_server_id = '')"), 1);
}

async function assertExactSetupVerification(env: Env, db: InstrumentedSqliteD1Database, ownerASession: string) {
  assert.equal(countRows(db, "onboarding_checks", `linked_server_id IN ('${id("owner-a-canonical-900001")}', '${id("owner-a-canonical-900002")}')`), 0);
  db.resetOperationTracking();
  const exact = await postJson(testOnboardingHandler, env, ownerASession, "/api/onboarding/test", { linkedServerId: target900003 });
  const exactCounts = db.snapshotOperationCounts();
  assert.equal(exact.status, 200, "Exact 900003 setup verification should return HTTP 200.");
  assert.equal(exact.json.ok, true);
  assert.equal(typeof exact.json.checks, "object");
  assert.notEqual(exact.json.checks, null);
  const checks = exact.json.checks as Record<string, unknown>;
  assert.equal(checks.tokenValid, true);
  assert.equal(checks.serviceAccess, true);
  assert.equal(checks.admLogsFound, true);
  assert.equal(checks.dayzServiceDetected, true);
  assertNoSensitiveBody(exact.text, "exact setup verification");
  assertNoForbiddenSqlSideEffects(db.touchedSql);
  assert.equal(countRows(db, "onboarding_checks", `linked_server_id = '${target900003}' AND token_valid = 1 AND service_access = 1 AND adm_logs_found = 1 AND dayz_service_detected = 1`), 1);
  assert.equal(countRows(db, "server_log_config", `linked_server_id = '${target900003}' AND adm_path IS NOT NULL AND adm_path != ''`), 1);
  assert.equal(countRows(db, "onboarding_checks", `linked_server_id IN ('${id("owner-a-canonical-900001")}', '${id("owner-a-canonical-900002")}')`), 0);

  const repeated = await postJson(testOnboardingHandler, env, ownerASession, "/api/onboarding/test", { linkedServerId: target900003 });
  assert.equal(repeated.status, 200, "Repeated exact setup verification should return HTTP 200.");
  assert.equal(countRows(db, "onboarding_checks", `linked_server_id = '${target900003}'`), 1, "Repeated setup verification must update, not duplicate, onboarding_checks.");
  assert.equal(countRows(db, "server_log_config", `linked_server_id = '${target900003}'`), 1, "Repeated setup verification must update, not duplicate, server_log_config.");
  assertNoSensitiveBody(repeated.text, "repeated setup verification");

  console.log(`Exact 900003 setup verification D1 operations: prepare=${exactCounts.prepare}, first=${exactCounts.first}, all=${exactCounts.all}, run=${exactCounts.run}, raw=${exactCounts.raw}, exec=${exactCounts.exec}, batch=${exactCounts.batch}`);
  return exactCounts;
}

async function assertExactLinkedServerLookupMigrationBackedAndReadOnly() {
  const { db, env } = await createMigratedEnv();
  assertExactLookupMigrationSchema(db);
  await seedBillingPreviewFixture(env, db);
  const ownerASession = (await createSession(env, ownerA)).token;
  const ownerBSession = (await createSession(env, ownerB)).token;
  await runPreviewSaveSequence(env, db, ownerASession, ownerBSession);
  await insertServerLogConfig(db, target900003, "games/preview-private-server/noftp/adm/mock.ADM");
  await insertOnboardingCheck(db, target900003);
  await insertLinkedServer(db, {
    alias: "owner-a-deleted-900004",
    ownerAlias: "owner-a",
    guildAlias: "owner-a-draft",
    serviceId: "900004",
    serviceName: "Owner A deleted 900004",
    status: "deleted",
  });

  db.resetOperationTracking();
  db.setReadOnlyPreparedStatements(true);
  const privateServer = await getLinkedServerForUserById(env, ownerA, target900003, { includePrivateAdmPath: true });
  const privateLookupClasses = assertExactLookupReadOnlySql(db.touchedSql, "private exact linked-server lookup");
  assert.equal(privateServer?.id, target900003, "Exact Owner A 900003 lookup should return the requested linked server.");
  assert.equal(privateServer?.user_id, ownerA, "Private exact lookup may retain owner identity for server-side callers.");
  assert.equal(privateServer?.adm_path, "games/preview-private-server/noftp/adm/mock.ADM", "Private ADM path should be available only when explicitly requested.");
  assert.equal(privateServer?.adm_latest_file, "mock.ADM");

  db.resetOperationTracking();
  const publicServer = await getLinkedServerForUserById(env, ownerA, target900003);
  assertExactLookupReadOnlySql(db.touchedSql, "non-private exact linked-server lookup");
  assert.equal(publicServer?.id, target900003, "Non-private exact lookup should still return the requested linked server.");
  assert.equal(Object.prototype.hasOwnProperty.call(publicServer ?? {}, "user_id"), false, "Non-private exact lookup must not expose user_id.");
  assert.equal(publicServer?.adm_path, "games/{gameserver-username}/noftp/adm/mock.ADM", "Non-private exact lookup should mask the ADM path.");

  for (const [label, userId, linkedServerId] of [
    ["foreign owner", ownerA, id("owner-b-source-cross-900001")],
    ["nonexistent id", ownerA, id("does-not-exist")],
    ["deleted row", ownerA, id("owner-a-deleted-900004")],
    ["merged row", ownerA, id("owner-a-source-duplicate-900002")],
  ] as const) {
    db.resetOperationTracking();
    const result = await getLinkedServerForUserById(env, userId, linkedServerId, { includePrivateAdmPath: true });
    assert.equal(result, null, `Exact lookup should return null for ${label}.`);
    assertExactLookupReadOnlySql(db.touchedSql, `${label} exact linked-server lookup`);
  }
  db.setReadOnlyPreparedStatements(false);

  const foreignKeyRows = db.sqlite.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(foreignKeyRows, [], "Seeded exact lookup fixture must pass foreign key checks.");
  console.log(`Exact linked-server lookup migration contract: tables=true columns=true indexes=true foreignKeys=true`);
  console.log(`Exact linked-server lookup operation classes: ${privateLookupClasses.join(",")}`);
}

async function assertForeignAndFallbackContracts(env: Env, db: InstrumentedSqliteD1Database, ownerASession: string) {
  const foreign = await postJson(testOnboardingHandler, env, ownerASession, "/api/onboarding/test", { linkedServerId: id("owner-b-source-cross-900001") });
  assert.equal(foreign.status, 404, "Foreign linkedServerId should return safe 404.");
  assert.equal(foreign.json.error_code, "linked_server_not_found");
  assert.doesNotMatch(foreign.text, /owner-b-source-cross-900001|owner-b-discord|BillingPreviewOwnerB/i);
  assertNoSensitiveBody(foreign.text, "foreign setup verification");

  const invalid = await postJson(testOnboardingHandler, env, ownerASession, "/api/onboarding/test", { linkedServerId: "   " });
  assert.equal(invalid.status, 404, "Invalid supplied linkedServerId must not fall back to current server.");
  assert.equal(invalid.json.error_code, "linked_server_not_found");

  const beforeForeignFallbackRows = countRows(db, "onboarding_checks", `linked_server_id = '${id("owner-b-source-cross-900001")}'`);
  const fallback = await postJson(testOnboardingHandler, env, ownerASession, "/api/onboarding/test", {});
  assert.equal(fallback.status, 200, "No linkedServerId should retain the existing owned current-server fallback.");
  assert.equal(fallback.json.ok, true);
  assert.equal(countRows(db, "onboarding_checks", `linked_server_id = '${id("owner-b-source-cross-900001")}'`), beforeForeignFallbackRows, "Fallback must not select a foreign linked server.");
  assert.equal(countRows(db, "onboarding_checks", `linked_server_id IN (SELECT id FROM linked_servers WHERE user_id = '${ownerA}')`), countRows(db, "onboarding_checks"), "Fallback-created onboarding checks must remain owned by the session user.");
  assertNoSensitiveBody(fallback.text, "fallback setup verification");
}

async function createReadyBillingPreviewState(options: { diagnostics?: boolean } = {}) {
  const { db, env } = await createMigratedEnv();
  if (options.diagnostics) {
    (env as unknown as Record<string, string>).DZN_BILLING_PREVIEW_DIAGNOSTICS = "true";
  }
  await seedBillingPreviewFixture(env, db);
  const ownerASession = (await createSession(env, ownerA)).token;
  const ownerBSession = (await createSession(env, ownerB)).token;
  await runPreviewSaveSequence(env, db, ownerASession, ownerBSession);
  return { db, env, ownerASession, ownerBSession };
}

async function assertDiagnosticFailureStage(input: {
  label: string;
  operation: D1FailureOperation;
  pattern: RegExp;
  expectedStage: typeof ONBOARDING_VERIFICATION_STAGES[number];
  prepare?: (state: Awaited<ReturnType<typeof createReadyBillingPreviewState>>) => Promise<void>;
}) {
  const state = await createReadyBillingPreviewState({ diagnostics: true });
  await input.prepare?.(state);
  state.db.failOnce(input.operation, input.pattern);
  const result = await postJson(
    testOnboardingHandler,
    state.env,
    state.ownerASession,
    "/api/onboarding/test",
    { linkedServerId: target900003 },
    diagnosticPreviewBaseUrl,
  );
  assert.equal(result.status, 500, `${input.label} should return diagnostic HTTP 500.`);
  assert.equal(result.json.error_code, "onboarding_verification_failed");
  assert.equal(result.json.failure_stage, input.expectedStage);
  assert.equal(ONBOARDING_VERIFICATION_STAGES.includes(result.json.failure_stage as typeof ONBOARDING_VERIFICATION_STAGES[number]), true);
  assertDiagnosticResponseSafe(result.text, input.label);
}

async function assertDiagnosticsDisabledRethrows() {
  const state = await createReadyBillingPreviewState({ diagnostics: false });
  const originalError = state.db.failOnce("run", /INSERT INTO server_log_config/i);
  await assert.rejects(
    () => postJson(
      testOnboardingHandler,
      state.env,
      state.ownerASession,
      "/api/onboarding/test",
      { linkedServerId: target900003 },
      diagnosticPreviewBaseUrl,
    ),
    (error) => error === originalError,
    "Diagnostic flag off must rethrow the original setup verification exception.",
  );
}

async function assertDiagnosticsHostGateRethrows() {
  const state = await createReadyBillingPreviewState({ diagnostics: true });
  const originalError = state.db.failOnce("run", /INSERT INTO server_log_config/i);
  await assert.rejects(
    () => postJson(
      testOnboardingHandler,
      state.env,
      state.ownerASession,
      "/api/onboarding/test",
      { linkedServerId: target900003 },
      "https://local.test",
    ),
    (error) => error === originalError,
    "Diagnostic flag must not expose stages outside the dedicated Billing preview host.",
  );
}

async function assertDiagnosticsDiscordFlagGateRethrows() {
  const state = await createReadyBillingPreviewState({ diagnostics: true });
  state.env.DZN_DISCORD_NOTIFICATIONS_ENABLED = "true";
  const originalError = state.db.failOnce("run", /INSERT INTO server_log_config/i);
  await assert.rejects(
    () => postJson(
      testOnboardingHandler,
      state.env,
      state.ownerASession,
      "/api/onboarding/test",
      { linkedServerId: target900003 },
      diagnosticPreviewBaseUrl,
    ),
    (error) => error === originalError,
    "Diagnostic flag must not expose stages when Discord notifications are enabled.",
  );
  state.env.DZN_DISCORD_NOTIFICATIONS_ENABLED = "false";
}

function savePayload(sourceAlias: string, serviceId: string, guildAlias = "owner-a-draft") {
  return {
    linkedServerId: id(sourceAlias),
    discordGuildId: guildId(guildAlias),
    serverType: "PVP",
    server_category: "pvp",
    tags: ["Events"],
    nitradoServiceId: serviceId,
    public_short_description: "Billing preview fixture",
  };
}

async function postJson(handler: PagesFunction, env: Env, sessionToken: string, path: string, payload: unknown, baseUrl = "https://local.test") {
  const request = new Request(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `dzn_session=${sessionToken}`,
    },
    body: JSON.stringify(payload),
  });
  const waitUntilPromises: Promise<unknown>[] = [];
  const response = await handler({
    request,
    env,
    params: {},
    waitUntil(promise) {
      waitUntilPromises.push(promise);
    },
    next: async () => new Response(null, { status: 404 }),
    data: {},
  });
  await Promise.allSettled(waitUntilPromises);
  const text = await response.text();
  let json: ApiJson = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    assert.fail(`${path} returned invalid JSON: ${text.slice(0, 200)}`);
  }
  return { response, status: response.status, text, json };
}

function countRows(db: InstrumentedSqliteD1Database, table: string, where = "1 = 1") {
  return Number(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get()?.count ?? 0);
}

function assertNoSensitiveBody(text: string, label: string) {
  for (const marker of forbiddenResponseMarkers) {
    assert.equal(text.includes(marker), false, `${label} response must not expose ${marker}.`);
  }
}

function assertDiagnosticResponseSafe(text: string, label: string) {
  for (const marker of diagnosticForbiddenResponseMarkers) {
    assert.equal(text.includes(marker), false, `${label} diagnostic response must not expose ${marker}.`);
  }
}

function assertNoForbiddenSqlSideEffects(queries: string[]) {
  const touched = queries.join("\n").toLowerCase();
  for (const table of forbiddenSideEffectTables) {
    assert.equal(touched.includes(table), false, `Setup verification must not invoke SQL against ${table}.`);
  }
}

function assertExactLookupReadOnlySql(queries: string[], label: string) {
  const operationClasses = sqlOperationClasses(queries);
  const nonReadOperations = operationClasses.filter((operation) => !readOnlyOperationClasses.has(operation));
  assert.deepEqual(nonReadOperations, [], `${label} must perform SELECT/PRAGMA operations only; observed classes=${operationClasses.join(",")}`);
  const forbiddenOperations = operationClasses.filter((operation) => forbiddenExactLookupOperationClasses.has(operation));
  assert.deepEqual(forbiddenOperations, [], `${label} must perform zero schema/write operations; observed classes=${operationClasses.join(",")}`);
  return operationClasses;
}

function sqlOperationClasses(queries: string[]) {
  return [...new Set(queries.map(sqlOperationClass))].filter(Boolean).sort();
}

function sqlOperationClass(query: string) {
  const normalized = query
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trim();
  return normalized.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase() ?? "UNKNOWN";
}

function id(alias: string) {
  return `${prefix}${alias}`;
}

function guildId(alias: string) {
  return id(`${alias}-guild`);
}

function guildRow(alias: string) {
  return id(`${alias}-guild-row`);
}

function fixtureTime() {
  return "2026-08-20T00:00:00.000Z";
}

async function run() {
  const originalFetch = globalThis.fetch;
  const originalConsoleLog = console.log;
  const externalFetches: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    externalFetches.push(url);
    throw new Error(`Unexpected external fetch during onboarding verification test: ${url}`);
  }) as typeof fetch;
  console.log = ((...values: unknown[]) => {
    const first = values[0];
    if (typeof first === "string" && (
      first.startsWith("Exact linked-server lookup")
      || first.startsWith("Exact 900003 setup verification")
      || first.startsWith("Onboarding verification tests passed")
    )) {
      originalConsoleLog(...values);
      return;
    }
    if (
      typeof first === "object"
      && first !== null
      && (first as { event?: unknown }).event === "billing_preview_onboarding_verification_failed"
    ) {
      originalConsoleLog({
        event: "billing_preview_onboarding_verification_failed",
        stage: (first as { stage?: unknown }).stage,
      });
    }
  }) as typeof console.log;

  try {
    await assertExactLinkedServerLookupMigrationBackedAndReadOnly();
    const { db, env, ownerASession } = await createReadyBillingPreviewState();
    const exactCounts = await assertExactSetupVerification(env, db, ownerASession);
    await assertForeignAndFallbackContracts(env, db, ownerASession);
    await assertDiagnosticFailureStage({
      label: "server_log_config persistence failure",
      operation: "run",
      pattern: /INSERT INTO server_log_config/i,
      expectedStage: "adm_path_persist",
    });
    await assertDiagnosticFailureStage({
      label: "onboarding_checks read failure",
      operation: "first",
      pattern: /FROM onboarding_checks WHERE linked_server_id = \? LIMIT 1/i,
      expectedStage: "checks_read",
    });
    await assertDiagnosticFailureStage({
      label: "onboarding_checks insert failure",
      operation: "run",
      pattern: /INSERT INTO onboarding_checks/i,
      expectedStage: "checks_write",
    });
    await assertDiagnosticFailureStage({
      label: "onboarding_checks update failure",
      operation: "run",
      pattern: /UPDATE onboarding_checks SET/i,
      expectedStage: "checks_write",
      prepare: async ({ env: preparedEnv, ownerASession: preparedOwnerASession }) => {
        const first = await postJson(
          testOnboardingHandler,
          preparedEnv,
          preparedOwnerASession,
          "/api/onboarding/test",
          { linkedServerId: target900003 },
        );
        assert.equal(first.status, 200, "Precondition setup verification should create onboarding_checks before update-failure test.");
      },
    });
    await assertDiagnosticsDisabledRethrows();
    await assertDiagnosticsHostGateRethrows();
    await assertDiagnosticsDiscordFlagGateRethrows();
    assert.deepEqual(externalFetches.filter((url) => /nitrado|discord\.com/i.test(url)), [], "Setup verification must not make real Nitrado or Discord requests in mock mode.");
    console.log(`Onboarding verification tests passed. Exact operation count: ${JSON.stringify(exactCounts)}`);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalConsoleLog;
  }
}

void run();
