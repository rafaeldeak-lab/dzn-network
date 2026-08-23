import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

import { createSession, ensureLinkedServerMetadataColumns } from "../functions/_lib/db";
import {
  LINKED_SERVER_ALLOWANCE_RESERVATIONS_INDEX_SQL,
  LINKED_SERVER_ALLOWANCE_RESERVATIONS_TABLE_SQL,
  completeLinkedServerAllowanceReservation,
  countLinkedServersForUser,
  ensureDraftLinkedServer,
  ensureLinkedServerAllowanceReservationSchema,
  expireLinkedServerAllowanceReservations,
  findActiveLinkedServerByNitradoService,
  getLinkedServerAllowanceUsageForUser,
  getNitradoTokenForLinkedServer,
  linkNitradoConnectionToLinkedServer,
  linkedServerAllowanceLimitMessage,
  LinkedServerOwnershipConflictError,
  releaseLinkedServerAllowanceReservation,
  reserveLinkedServerAllowance,
  saveLinkedServerNitradoService,
  storePendingNitradoToken,
} from "../functions/_lib/onboarding";
import { getOwnerBillingStatus, upsertBillingAccount, upsertOwnerEntitlements, type PlanKey } from "../functions/_lib/plans";
import { onRequest as billingStatusHandler } from "../functions/api/billing/status";
import { onRequest as validateNitradoTokenHandler } from "../functions/api/nitrado/validate-token";
import { onRequest as saveOnboardingHandler } from "../functions/api/onboarding/save";
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

    CREATE UNIQUE INDEX idx_linked_servers_active_service_id
    ON linked_servers(nitrado_service_id)
    WHERE nitrado_service_id IS NOT NULL
      AND lower(COALESCE(status, 'pending')) NOT IN ('merged', 'deleted');
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

type MigrationFile = {
  name: string;
  prefix: number;
  path: string;
};

const BILLING_MIGRATION = "0058_billing_phase_1_integrity.sql";
const EVENT_SUGGESTIONS_MIGRATION = "0057_event_suggestions_phase_2a.sql";
const STALE_BILLING_MIGRATION = ["0057", "billing_phase_1_integrity.sql"].join("_");

function listMigrationFiles() {
  return readdirSync("migrations")
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({
      name,
      prefix: Number(name.slice(0, 4)),
      path: join("migrations", name),
    }));
}

function assertMigrationNumbering() {
  const migrations = listMigrationFiles();
  const seen = new Map<number, string>();
  for (const migration of migrations) {
    const existing = seen.get(migration.prefix);
    assert.equal(existing, undefined, `Duplicate migration prefix ${String(migration.prefix).padStart(4, "0")} used by ${existing} and ${migration.name}.`);
    seen.set(migration.prefix, migration.name);
  }

  const staleBillingMigrationPath = `migrations/0057_${"billing_phase_1_integrity"}.sql`;
  assert.equal(existsSync(staleBillingMigrationPath), false, "Stale billing migration filename must not exist.");
  assert.equal(existsSync(`migrations/${EVENT_SUGGESTIONS_MIGRATION}`), true, "Event suggestions must remain migration 0057.");
  assert.equal(existsSync(`migrations/${BILLING_MIGRATION}`), true, "Billing integrity must use migration 0058.");
  assert.equal(seen.get(57), EVENT_SUGGESTIONS_MIGRATION);
  assert.equal(seen.get(58), BILLING_MIGRATION);

  const expected = Array.from({ length: migrations.length }, (_value, index) => index + 1);
  assert.deepEqual(migrations.map((migration) => migration.prefix), expected, "Migrations must remain sequential with no gaps.");
  assert.equal(
    migrations.map((migration) => migration.name).join("\n"),
    [...migrations].sort((left, right) => left.name.localeCompare(right.name)).map((migration) => migration.name).join("\n"),
    "Migration application order must be deterministic by filename.",
  );
  assertNoStaleBillingMigrationReferences();
}

function assertNoStaleBillingMigrationReferences() {
  const staleReferences = findRepositoryTextMatches(STALE_BILLING_MIGRATION)
    .filter(isForbiddenStaleBillingMigrationReference)
    .map((match) => `${match.path}:${match.lineNumber}: ${match.line.trim()}`);
  assert.deepEqual(staleReferences, [], "No executable stale 0057 billing migration references may remain.");
}

type RepositoryTextMatch = {
  path: string;
  lineNumber: number;
  line: string;
  context: string;
};

function isForbiddenStaleBillingMigrationReference(match: RepositoryTextMatch) {
  const normalizedPath = match.path.replace(/\\/g, "/");
  if (normalizedPath === `migrations/${STALE_BILLING_MIGRATION}`) return true;
  if (normalizedPath.endsWith("/32-verify-billing-integrity-preview.sh")) {
    return !/ledger\.includes\("0057_billing_phase_1_integrity\.sql"\)[\s\S]*Preview migration ledger contains stale 0057_billing_phase_1_integrity\.sql/.test(match.context);
  }
  if (normalizedPath.endsWith("/owner-console-preview.ts") || normalizedPath.endsWith("/test-github-workflow-boundary.ts")) {
    return !/must reject stale 0057 billing ledger entries|negative assertion|reject.*0057_billing_phase_1_integrity\.sql/i.test(match.context);
  }
  return true;
}

function findRepositoryTextMatches(needle: string) {
  const matches: RepositoryTextMatch[] = [];
  const ignored = new Set([".git", "node_modules", ".next", "out"]);
  function visit(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (ignored.has(entry)) continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        visit(path);
        continue;
      }
      if (!/\.(?:ts|tsx|js|jsx|json|md|yml|yaml|sql|sh|toml)$/.test(path)) continue;
      const lines = readFileSync(path, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!line.includes(needle)) return;
        matches.push({
          path,
          lineNumber: index + 1,
          line,
          context: lines.slice(Math.max(0, index - 2), index + 3).join("\n"),
        });
      });
    }
  }
  visit(".");
  return matches.sort((left, right) => left.path.localeCompare(right.path) || left.lineNumber - right.lineNumber);
}

function applyMigrationFiles(db: SqliteD1Database, migrations: MigrationFile[]) {
  db.sqlite.exec("PRAGMA foreign_keys = OFF;");
  for (const migration of migrations) {
    db.sqlite.exec(readFileSync(migration.path, "utf8"));
  }
}

function assertFreshAndUpgradeMigrationApplication() {
  const migrations = listMigrationFiles();

  const fresh = new SqliteD1Database();
  applyMigrationFiles(fresh, migrations);
  assertBillingIntegritySchema(fresh);
  fresh.sqlite.close();

  const upgrade = new SqliteD1Database();
  applyMigrationFiles(upgrade, migrations.filter((migration) => migration.prefix <= 57));
  upgrade.sqlite.exec(`
    INSERT INTO users (id, discord_id, username, avatar) VALUES ('legacy-owner', 'legacy-discord', 'Legacy', NULL);
    INSERT INTO discord_guilds (id, guild_id, owner_user_id, name, permissions, is_owner) VALUES ('legacy-guild-row', 'legacy-guild', 'legacy-owner', 'Legacy Guild', '8', 1);
    INSERT INTO linked_servers (id, user_id, guild_id, discord_guild_id, nitrado_service_id, nitrado_service_name, server_name, server_type, tags_json, region, status, public_slug)
    VALUES ('legacy-live', 'legacy-owner', 'legacy-guild', 'legacy-guild-row', 'legacy-service', 'Legacy Service', 'Legacy Service', 'PVP', '[]', 'EU', 'live', 'legacy-live');
    INSERT INTO nitrado_connections (id, user_id, linked_server_id, encrypted_token, token_iv, token_auth_tag)
    VALUES ('legacy-token', 'legacy-owner', 'legacy-live', 'encrypted', 'iv', 'tag');
  `);
  applyMigrationFiles(upgrade, migrations.filter((migration) => migration.prefix === 58));
  assertBillingIntegritySchema(upgrade);
  assert.equal(
    Number(upgrade.sqlite.prepare("SELECT COUNT(*) AS count FROM linked_servers WHERE id = 'legacy-live'").get()?.count ?? 0),
    1,
    "Legitimate linked server rows must survive the billing migration.",
  );
  assert.equal(
    Number(upgrade.sqlite.prepare("SELECT COUNT(*) AS count FROM nitrado_connections WHERE id = 'legacy-token'").get()?.count ?? 0),
    1,
    "Legitimate Nitrado token rows must survive the billing migration.",
  );
  upgrade.sqlite.close();
}

function assertBillingIntegritySchema(db: SqliteD1Database) {
  const reservationColumns = new Set(
    db.sqlite.prepare("PRAGMA table_info(linked_server_allowance_reservations)").all().map((row) => row.name),
  );
  for (const column of ["id", "user_id", "discord_user_id", "linked_server_id", "status", "expires_at", "completed_at", "released_at", "expired_at", "release_reason"]) {
    assert.equal(reservationColumns.has(column), true, `Reservation table should include ${column}.`);
  }
  const indexes = new Set(
    db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name),
  );
  for (const index of [
    "idx_lsar_user_status_expires",
    "idx_lsar_linked_server_status",
    "idx_lsar_discord_user_status",
    "idx_lsar_active_linked_server",
    "idx_nitrado_connections_user_linked_server_updated",
    "idx_linked_servers_user_service_active",
    "idx_linked_servers_active_service_id",
  ]) {
    assert.equal(indexes.has(index), true, `Expected integrity index ${index}.`);
  }
}

async function assertMigrationMatchesRuntimeSchema() {
  const migration = readFileSync(`migrations/${BILLING_MIGRATION}`, "utf8");
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

function assertReservationCreationUsesAtomicCapacityGuard() {
  const source = readFileSync("functions/_lib/onboarding.ts", "utf8");
  const start = source.indexOf("export async function reserveLinkedServerAllowance");
  const end = source.indexOf("export async function completeLinkedServerAllowanceReservation", start);
  assert.notEqual(start, -1, "reserveLinkedServerAllowance must exist.");
  assert.notEqual(end, -1, "reserveLinkedServerAllowance body must be bounded by the completion helper.");
  const reserveSource = source.slice(start, end);
  assert.match(
    reserveSource,
    /INSERT INTO linked_server_allowance_reservations[\s\S]*SELECT \?, \?, \?, \?, 'onboarding', 'active'/,
    "Allowance reservations must be inserted with a conditional INSERT SELECT.",
  );
  assert.match(
    reserveSource,
    /WHERE \? > \([\s\S]*FROM linked_servers[\s\S]*FROM linked_server_allowance_reservations/,
    "Allowance reservations must check committed and active reservation usage inside the insert statement.",
  );
  assert.equal(
    /const usage = await getLinkedServerAllowanceUsageForUser/.test(reserveSource),
    false,
    "Reservation creation must not use a separate capacity read immediately before insert.",
  );
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

async function assertServiceSpecificTokenFailureCanRecoverOnFullPlan() {
  const { db, env } = createSqliteEnv({ TOKEN_ENCRYPTION_KEY: undefined });
  await seedOwner(env, db, { userId: "recover-token-user", discordUserId: "recover-token-discord", planKey: "free", status: "free" });
  const session = await createSession(env, "recover-token-user");
  const requestBody = {
    token: "long-enough-token",
    discordGuildId: "recover-token-user-guild",
    serverType: "PVP",
    server_category: "pvp",
    tags: [],
    serviceId: "900001",
  };

  const firstResponse = await validateNitradoTokenHandler(makeContext(
    validateNitradoTokenHandler,
    new Request("https://local.test/api/nitrado/validate-token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `dzn_session=${session.token}`,
      },
      body: JSON.stringify(requestBody),
    }),
    env,
  ));
  assert.equal(firstResponse.status, 500);
  assert.match(await firstResponse.text(), /missing_token_encryption_key/);
  const existingLinkedServerId = db.sqlite
    .prepare("SELECT id FROM linked_servers WHERE user_id = 'recover-token-user' AND nitrado_service_id = '900001' LIMIT 1")
    .get()?.id;
  assert.equal(typeof existingLinkedServerId, "string", "The first service validation should attach the linked-server row before token persistence fails.");
  assert.equal(reservationCount(db, "status = 'active'"), 0, "The failed token write must not leave an active reservation.");

  env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  const secondResponse = await validateNitradoTokenHandler(makeContext(
    validateNitradoTokenHandler,
    new Request("https://local.test/api/nitrado/validate-token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `dzn_session=${session.token}`,
      },
      body: JSON.stringify(requestBody),
    }),
    env,
  ));
  const secondText = await secondResponse.text();
  assert.equal(secondResponse.status, 200, secondText);
  const payload = JSON.parse(secondText) as { linkedServerId: string };
  assert.equal(payload.linkedServerId, existingLinkedServerId);
  assert.equal(await getNitradoTokenForLinkedServer(env, "recover-token-user", payload.linkedServerId), "long-enough-token");
  assert.equal(
    Number(db.sqlite.prepare("SELECT COUNT(*) AS count FROM linked_servers WHERE user_id = 'recover-token-user' AND nitrado_service_id = '900001'").get()?.count ?? 0),
    1,
    "Recovery must update the canonical service row instead of creating a second linked server.",
  );
}

async function assertExactTokenConnectionAssociation() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "exact-user", discordUserId: "exact-discord", planKey: "pro", status: "active" });
  insertLinkedServer(db, { id: "exact-draft-a", userId: "exact-user", serviceId: null, status: "pending" });
  insertLinkedServer(db, { id: "exact-draft-b", userId: "exact-user", serviceId: null, status: "pending" });

  await storePendingNitradoToken(env, "exact-user", "exact-draft-a", "token-for-draft-a");
  await storePendingNitradoToken(env, "exact-user", "exact-draft-b", "token-for-draft-b");
  await storePendingNitradoToken(env, "exact-user", "exact-draft-a", "updated-token-for-draft-a");

  assert.equal(await getNitradoTokenForLinkedServer(env, "exact-user", "exact-draft-a"), "updated-token-for-draft-a");
  assert.equal(await getNitradoTokenForLinkedServer(env, "exact-user", "exact-draft-b"), "token-for-draft-b");
  assert.equal(
    Number(db.sqlite.prepare("SELECT COUNT(*) AS count FROM nitrado_connections WHERE user_id = 'exact-user' AND linked_server_id = 'exact-draft-a'").get()?.count ?? 0),
    1,
    "Repeated token validation for the same draft should update the exact connection instead of creating duplicates.",
  );

  await linkNitradoConnectionToLinkedServer(env, "exact-user", "exact-draft-a", "exact-canonical-a");
  assert.equal(await getNitradoTokenForLinkedServer(env, "exact-user", "exact-canonical-a"), "updated-token-for-draft-a");
  assert.equal(await getNitradoTokenForLinkedServer(env, "exact-user", "exact-draft-b"), "token-for-draft-b");
}

async function assertCrossOwnerServiceProtection() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "owner-a", discordUserId: "owner-a-discord", planKey: "pro", status: "active" });
  await seedOwner(env, db, { userId: "owner-b", discordUserId: "owner-b-discord", planKey: "pro", status: "active" });
  insertLinkedServer(db, { id: "owner-a-live", userId: "owner-a", serviceId: "shared-service", status: "live" });
  const ownerBDraft = await ensureDraftLinkedServer(env, "owner-b", "owner-b-guild", "PVP", [], "pvp");

  await assert.rejects(
    () => saveLinkedServerNitradoService(env, ownerBDraft, {
      id: "shared-service",
      name: "Shared Service",
      game: "DayZ",
    }, "PVP", [], "pvp"),
    LinkedServerOwnershipConflictError,
  );
  assert.equal(
    String(db.sqlite.prepare("SELECT user_id FROM linked_servers WHERE id = 'owner-a-live'").get()?.user_id),
    "owner-a",
    "Cross-owner validation must not transfer the canonical linked server.",
  );
  assert.equal(reservationCount(db, "user_id = 'owner-b' AND status = 'active'"), 0, "Cross-owner conflict should release the request reservation.");
  assert.equal(reservationCount(db, "user_id = 'owner-b' AND status = 'released' AND release_reason = 'cross_owner_service_conflict'"), 1);
}

async function assertSameOwnerRepeatedLinkingIsIdempotent() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "same-owner", discordUserId: "same-owner-discord", planKey: "pro", status: "active" });
  const firstDraft = await ensureDraftLinkedServer(env, "same-owner", "same-owner-guild", "PVP", ["KOS"], "pvp");
  const canonical = await saveLinkedServerNitradoService(env, firstDraft, {
    id: "same-owner-service",
    name: "Same Owner Service",
    game: "DayZ",
  }, "PVP", ["KOS"], "pvp");
  const secondDraft = await ensureDraftLinkedServer(env, "same-owner", "same-owner-guild", "PVP", ["KOS"], "pvp");
  const repeated = await saveLinkedServerNitradoService(env, secondDraft, {
    id: "same-owner-service",
    name: "Same Owner Service",
    game: "DayZ",
  }, "PVP", ["KOS"], "pvp");

  assert.equal(repeated, canonical);
  assert.equal((await findActiveLinkedServerByNitradoService(env, "same-owner-service"))?.id, canonical);
  assert.equal(
    Number(db.sqlite.prepare("SELECT COUNT(*) AS count FROM linked_servers WHERE user_id = 'same-owner' AND nitrado_service_id = 'same-owner-service'").get()?.count ?? 0),
    1,
    "Same-owner repeated linking must reuse the canonical service row.",
  );
  assert.equal(
    Number(db.sqlite.prepare("SELECT COUNT(*) AS count FROM linked_servers WHERE user_id = 'same-owner' AND status = 'pending' AND nitrado_service_id IS NULL").get()?.count ?? 0),
    0,
    "Same-owner repeated linking must not leave duplicate active drafts.",
  );
  assert.equal(await countLinkedServersForUser(env, "same-owner", { now: "2026-08-20T00:00:00.000Z" }), 1);
  assert.equal(reservationCount(db, "user_id = 'same-owner' AND status = 'active'"), 0);
}

async function assertValidateTokenApiCrossOwnerConflictIsSafe() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "api-owner-a", discordUserId: "api-owner-a-discord", planKey: "pro", status: "active" });
  await seedOwner(env, db, { userId: "api-owner-b", discordUserId: "api-owner-b-discord", planKey: "pro", status: "active" });
  insertLinkedServer(db, { id: "api-owner-a-live", userId: "api-owner-a", serviceId: "900001", status: "live" });
  const session = await createSession(env, "api-owner-b");
  const response = await validateNitradoTokenHandler(makeContext(
    validateNitradoTokenHandler,
    new Request("https://local.test/api/nitrado/validate-token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `dzn_session=${session.token}`,
      },
      body: JSON.stringify({
        token: "long-enough-token",
        discordGuildId: "api-owner-b-guild",
        serverType: "PVP",
        server_category: "pvp",
        tags: [],
        serviceId: "900001",
      }),
    }),
    env,
  ));
  assert.equal(response.status, 409);
  const text = await response.text();
  assert.match(text, /nitrado_service_already_linked/);
  assert.equal(/long-enough-token|encrypted_token|token_iv|token_auth_tag/i.test(text), false, "Conflict response must not expose token material.");
  assert.equal(
    String(db.sqlite.prepare("SELECT user_id FROM linked_servers WHERE id = 'api-owner-a-live'").get()?.user_id),
    "api-owner-a",
    "API conflict must not reassign the other owner's linked server.",
  );
}

async function assertConcurrentDuplicateServiceLinkingConverges() {
  const { db, env } = createSqliteEnv();
  await seedOwner(env, db, { userId: "race-user", discordUserId: "race-discord", planKey: "pro", status: "active" });
  await ensureLinkedServerMetadataColumns(env);
  insertLinkedServer(db, { id: "race-draft-a", userId: "race-user", serviceId: null, status: "pending" });
  insertLinkedServer(db, { id: "race-draft-b", userId: "race-user", serviceId: null, status: "pending" });

  const service = {
    id: "race-service",
    name: "Race Service",
    game: "DayZ",
  };
  const results = await Promise.all([
    saveLinkedServerNitradoService(env, "race-draft-a", service, "PVP", [], "pvp"),
    saveLinkedServerNitradoService(env, "race-draft-b", service, "PVP", [], "pvp"),
  ]);
  assert.equal(new Set(results).size, 1, "Concurrent same-owner duplicate requests should converge on one canonical linked server.");
  assert.equal(
    Number(db.sqlite.prepare("SELECT COUNT(*) AS count FROM linked_servers WHERE nitrado_service_id = 'race-service'").get()?.count ?? 0),
    1,
    "Concurrent duplicate requests must not create duplicate canonical active services.",
  );
  assert.equal(await countLinkedServersForUser(env, "race-user", { now: "2026-08-20T00:00:00.000Z" }), 1);
  assert.equal(reservationCount(db, "user_id = 'race-user' AND status = 'active'"), 0);
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
  assertMigrationNumbering();
  assertFreshAndUpgradeMigrationApplication();
  await assertMigrationMatchesRuntimeSchema();
  assertReservationCreationUsesAtomicCapacityGuard();
  await assertReservationCounting();
  await assertPlanLimits();
  await assertBillingStatusUsesReservationAwareAllowance();
  await assertAllowanceUsageReportingEdges();
  await assertBillingStatusPlanNormalization();
  await assertDraftAndServiceAttachmentLifecycle();
  await assertFailedServiceAttachmentReleasesReservation();
  await assertExpiredReservationLifecycle();
  await assertTokenWriteFailureReleasesReservation();
  await assertServiceSpecificTokenFailureCanRecoverOnFullPlan();
  await assertExactTokenConnectionAssociation();
  await assertCrossOwnerServiceProtection();
  await assertSameOwnerRepeatedLinkingIsIdempotent();
  await assertValidateTokenApiCrossOwnerConflictIsSafe();
  await assertConcurrentDuplicateServiceLinkingConverges();
  await assertOnboardingSaveFailureReleasesReservationWithoutDeletingServer();
  await assertNitradoValidationLimitFailure();
  console.log("Billing integrity reservation tests passed.");
}

void run();
