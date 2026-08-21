import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { createSession } from "../functions/_lib/db";
import { storePendingNitradoToken } from "../functions/_lib/onboarding";
import { onRequest as saveOnboardingHandler } from "../functions/api/onboarding/save";
import { onRequest as testOnboardingHandler } from "../functions/api/onboarding/test";
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
type ApiJson = Record<string, unknown> & {
  error_code?: unknown;
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
  "Error:",
  " at ",
  "stack",
  "Traceback",
];
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

  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
  }

  prepare(query: string) {
    this.record("prepare", query);
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

  snapshotOperationCounts() {
    return { ...this.counts };
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
    const result = this.db.sqlite.prepare(this.query).run(...this.bindings);
    return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }

  async first<T = Record<string, unknown>>(colName?: string) {
    this.db.record("first", this.query);
    const row = this.db.sqlite.prepare(this.query).get(...this.bindings) ?? null;
    if (colName) return (row ? row[colName] ?? null : null) as T | null;
    return row as T | null;
  }

  async all<T = Record<string, unknown>>() {
    this.db.record("all", this.query);
    return {
      success: true,
      meta: {},
      results: this.db.sqlite.prepare(this.query).all(...this.bindings) as T[],
    };
  }

  async raw() {
    this.db.record("raw", this.query);
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
    status: "live" | "pending";
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

async function postJson(handler: PagesFunction, env: Env, sessionToken: string, path: string, payload: unknown) {
  const request = new Request(`https://local.test${path}`, {
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

function assertNoForbiddenSqlSideEffects(queries: string[]) {
  const touched = queries.join("\n").toLowerCase();
  for (const table of forbiddenSideEffectTables) {
    assert.equal(touched.includes(table), false, `Setup verification must not invoke SQL against ${table}.`);
  }
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
  const externalFetches: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    externalFetches.push(url);
    throw new Error(`Unexpected external fetch during onboarding verification test: ${url}`);
  }) as typeof fetch;

  try {
    const { db, env } = await createMigratedEnv();
    await seedBillingPreviewFixture(env, db);
    const ownerASession = (await createSession(env, ownerA)).token;
    const ownerBSession = (await createSession(env, ownerB)).token;
    await runPreviewSaveSequence(env, db, ownerASession, ownerBSession);
    const exactCounts = await assertExactSetupVerification(env, db, ownerASession);
    await assertForeignAndFallbackContracts(env, db, ownerASession);
    assert.deepEqual(externalFetches.filter((url) => /nitrado|discord\.com/i.test(url)), [], "Setup verification must not make real Nitrado or Discord requests in mock mode.");
    console.log(`Onboarding verification tests passed. Exact operation count: ${JSON.stringify(exactCounts)}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run();
