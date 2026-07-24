import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  authorizePlatformCreatorEventAdmin,
  creatorEventAdminDeniedPayload,
  isPlatformCreatorEventAdmin,
  parsePlatformCreatorDiscordId,
  PLATFORM_CREATOR_EVENT_ADMIN_CAPABILITY,
} from "../functions/_lib/platform-creator";
import { createCategorySafeMatchmaking, createCompetitiveEvent, type CreateCompetitiveEventInput } from "../functions/_lib/events";
import type { Env, SessionUser } from "../functions/_lib/types";

const creatorDiscordId = "111111111111111111";
const creator: SessionUser = { id: "creator-user", discord_id: creatorDiscordId, username: "Creator", avatar: null };
const identities: Array<{ label: string; user: SessionUser | null; expectedStatus: 401 | 403 }> = [
  { label: "logged-out visitor", user: null, expectedStatus: 401 },
  { label: "authenticated normal member", user: user("member-user", "222222222222222222"), expectedStatus: 403 },
  { label: "connected server owner", user: user("server-owner-user", "333333333333333333"), expectedStatus: 403 },
  { label: "team captain", user: user("captain-user", "444444444444444444"), expectedStatus: 403 },
  { label: "non-creator platform owner", user: user("owner-user", "555555555555555555"), expectedStatus: 403 },
  { label: "badge admin without creator capability", user: user("badge-admin-user", "666666666666666666"), expectedStatus: 403 },
];

assert.equal(PLATFORM_CREATOR_EVENT_ADMIN_CAPABILITY, "platform_creator_event_admin");

for (const value of [
  creatorDiscordId,
  "12345",
  "12345678901234567890123456789012",
]) {
  assert.equal(parsePlatformCreatorDiscordId(value), value);
}

for (const value of [
  undefined,
  null,
  "",
  " ",
  ` ${creatorDiscordId}`,
  `${creatorDiscordId} `,
  `${creatorDiscordId},222222222222222222`,
  "creator",
  "*",
  "true",
  "111 222",
]) {
  assert.equal(parsePlatformCreatorDiscordId(value), null, `${String(value)} must fail closed`);
}

assert.equal(isPlatformCreatorEventAdmin(creator, { DZN_PLATFORM_CREATOR_DISCORD_ID: creatorDiscordId }), true);
assert.equal(isPlatformCreatorEventAdmin({ discord_id: ` ${creatorDiscordId}` }, { DZN_PLATFORM_CREATOR_DISCORD_ID: creatorDiscordId }), false);
assert.equal(isPlatformCreatorEventAdmin(creator, { DZN_PLATFORM_CREATOR_DISCORD_ID: `${creatorDiscordId},222222222222222222` }), false);
assert.equal(isPlatformCreatorEventAdmin(creator, { DZN_PLATFORM_OWNER_DISCORD_IDS: creatorDiscordId }), false, "Platform-owner allowlist alone must not grant creator event capability.");
assert.deepEqual(authorizePlatformCreatorEventAdmin({ DZN_PLATFORM_CREATOR_DISCORD_ID: creatorDiscordId }, null), {
  ok: false,
  status: 401,
  reason: "unauthorized",
});
assert.deepEqual(authorizePlatformCreatorEventAdmin({}, creator), {
  ok: false,
  status: 403,
  reason: "creator_event_governance_not_configured",
});
assert.equal(authorizePlatformCreatorEventAdmin({ DZN_PLATFORM_CREATOR_DISCORD_ID: creatorDiscordId }, creator).ok, true);

async function main() {
  for (const identity of identities) {
    const env = noWriteEnv({ DZN_PLATFORM_CREATOR_DISCORD_ID: creatorDiscordId });
    const result = creatorEventAdminDeniedPayload(env, identity.user);
    assert.equal(result?.status, identity.expectedStatus, `${identity.label} should be denied with ${identity.expectedStatus}`);
    assert.equal(env.DB.prepareCount, 0, `${identity.label} authorization must not touch D1`);
  }

  for (const badConfig of [{}, { DZN_PLATFORM_CREATOR_DISCORD_ID: "" }, { DZN_PLATFORM_CREATOR_DISCORD_ID: "abc" }, { DZN_PLATFORM_CREATOR_DISCORD_ID: `${creatorDiscordId},222222222222222222` }, { DZN_PLATFORM_CREATOR_DISCORD_ID: "*" }, { DZN_PLATFORM_CREATOR_DISCORD_ID: ` ${creatorDiscordId} ` }]) {
    const env = noWriteEnv(badConfig);
    const result = await createCompetitiveEvent(env, creator, validCreateBody());
    assert.equal(result.status, 403, "Missing or malformed creator configuration must fail closed.");
    assert.equal(env.DB.prepareCount, 0, "Failed creator configuration must not run schema helpers or writes.");
  }

  for (const identity of identities.filter((entry) => entry.user)) {
    const env = noWriteEnv({ DZN_PLATFORM_CREATOR_DISCORD_ID: creatorDiscordId });
    const result = await createCompetitiveEvent(env, identity.user, {
      ...validCreateBody(),
      creator: true,
      role: "platform_creator_event_admin",
      headers: { "x-dzn-creator": "true" },
    } as unknown as CreateCompetitiveEventInput);
    assert.equal(result.status, 403, `${identity.label} must not create official events with forged client claims.`);
    assert.equal(env.DB.prepareCount, 0, `${identity.label} denied official create must have zero D1 side effects.`);
  }

  {
    const env = noWriteEnv({ DZN_PLATFORM_CREATOR_DISCORD_ID: creatorDiscordId });
    const result = await createCategorySafeMatchmaking(env, user("server-owner-user", "333333333333333333"), {
      server_id: "server-a",
      opponent_server_id: "server-b",
      event_slug: "official-event",
      preview: false,
    });
    assert.equal(result.status, 403, "Non-preview official match generation must require creator capability.");
    assert.equal(env.DB.prepareCount, 0, "Denied official match generation must not run schema helpers or writes.");
  }

  await assertSuccessfulCreatorEventCreate();
  await assertSafeCreatorEventFailure("event_insert");
  await assertSafeCreatorEventFailure("registration_insert");
  await assertSafeCreatorEventFailure("host_update");
  await assertSafeCreatorEventFailure("activity_insert");
  await assertSafeCreatorEventFailure("slug_lookup");
  await assertSafeCreatorEventFailure("host_lookup");
  await assertSafeCreatorEventFailure("schema_readiness");
  await assertSafeCreatorEventFailure("entitlement_lookup");
  await assertStructuredPreflightFailures();

  assertSourceGovernance();

  console.log("Creator-only event governance tests passed.");
}

function user(id: string, discordId: string): SessionUser {
  return { id, discord_id: discordId, username: id, avatar: null };
}

function validCreateBody(): CreateCompetitiveEventInput {
  return {
    name: "Creator Governance Cup",
    description: "Preview-safe event create payload.",
    event_type: "community_cup",
    hosting_server_id: "server-a",
    starts_at: "2026-08-01T18:00:00.000Z",
    ends_at: "2026-08-01T20:00:00.000Z",
    server_limit: 8,
    team_limit: 8,
    status: "registration_open",
    visibility: "public",
  };
}

function noWriteEnv(extra: Record<string, unknown>): Env & { DB: NoWriteD1 } {
  return { ...extra, DB: new NoWriteD1() } as Env & { DB: NoWriteD1 };
}

class NoWriteD1 {
  prepareCount = 0;
  prepare(query: string) {
    this.prepareCount += 1;
    throw new Error(`Unexpected D1 access in denied governance path: ${query.slice(0, 80)}`);
  }
  batch() {
    throw new Error("Unexpected D1 batch in denied governance path");
  }
  exec() {
    throw new Error("Unexpected D1 exec in denied governance path");
  }
}

async function assertSuccessfulCreatorEventCreate() {
  const env = memoryEnv();
  const result = await createCompetitiveEvent(env, creator, validCreateBody());
  assert.equal(result.status, 200, "Configured creator should be able to create a valid event.");
  assert.equal(result.ok, true, "Successful creator event response should be ok.");
  assert.equal(env.DB.createdEvents().length, 1, "Successful creator event create should insert one event.");
  assert.equal(env.DB.registrations.length, 1, "Successful creator event create should insert one host registration.");
  assert.equal(env.DB.activities.length, 1, "Successful creator event create should insert one activity row.");
  assert.equal(env.DB.activities[0]?.activity_type, "event_created", "Successful creator event create should write event_created activity.");
  assert.equal(env.DB.host.competitive_enabled, 1, "Successful creator event create should mark host competitive.");
  assert.equal(env.DB.host.server_category, "deathmatch", "Successful creator event create should keep the host category valid.");
  assert.equal(env.DB.existingEvents().length, 1, "Successful creator event create must not touch existing events.");
  assert.equal(env.DB.externalCalls, 0, "Creator event create must not call Discord, queues, schedulers, brackets, scores, or awards.");
}

async function assertSafeCreatorEventFailure(stage: CreatorEventFailureStage) {
  const env = memoryEnv({ failStage: stage });
  const result = await createCompetitiveEvent(env, creator, validCreateBody()) as Record<string, unknown>;
  assert.equal(result.status, 500, `${stage} should return a safe HTTP 500.`);
  assert.equal(result.errorCode, "EVENT_CREATE_FAILED", `${stage} should return the safe error code.`);
  assert.match(String(result.requestId), /^event-create-/, `${stage} should include a safe request id.`);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("injected"), false, `${stage} must not expose the raw injected exception.`);
  assert.equal(serialized.includes("SELECT"), false, `${stage} must not expose SQL.`);
  assertNoPartialEvent(env.DB, stage);
}

async function assertStructuredPreflightFailures() {
  {
    const env = memoryEnv({ missingSchemaTable: "competitive_event_activity" });
    const result = await createCompetitiveEvent(env, creator, validCreateBody()) as Record<string, unknown>;
    assert.equal(result.status, 500, "Missing schema should fail safely.");
    assert.equal(result.errorCode, "EVENT_SCHEMA_NOT_READY", "Missing schema should return EVENT_SCHEMA_NOT_READY.");
    assert.match(String(result.requestId), /^event-create-/);
    assertNoPartialEvent(env.DB, "schema_readiness");
  }
  {
    const env = memoryEnv({ hostMissing: true });
    const result = await createCompetitiveEvent(env, creator, validCreateBody());
    assert.equal(result.status, 404, "Missing host should be a structured 404.");
    assert.equal(result.error, "SERVER_NOT_FOUND");
    assertNoPartialEvent(env.DB, "host_lookup");
  }
  {
    const env = memoryEnv({ hostCategory: null });
    const result = await createCompetitiveEvent(env, creator, validCreateBody());
    assert.equal(result.status, 409, "Missing host category should be a structured 409.");
    assert.equal(result.error, "NO_CATEGORY");
    assertNoPartialEvent(env.DB, "category_resolution");
  }
  {
    const env = memoryEnv({ planKey: "starter", subscriptionStatus: "inactive" });
    const result = await createCompetitiveEvent(env, creator, validCreateBody());
    assert.equal(result.status, 403, "Plan-locked host should be a structured 403.");
    assert.equal(result.error, "PLAN_LOCKED");
    assertNoPartialEvent(env.DB, "entitlement_lookup");
  }
  {
    const env = memoryEnv({ hostStatus: "archived" });
    const result = await createCompetitiveEvent(env, creator, validCreateBody());
    assert.equal(result.status, 409, "Archived host should be invalid for official event creation.");
    assert.equal(result.error, "INVALID_HOST_STATE");
    assertNoPartialEvent(env.DB, "host_lookup");
  }
}

function assertNoPartialEvent(db: MemoryD1, label: string) {
  assert.equal(db.createdEvents().length, 0, `${label} must not leave an event row.`);
  assert.equal(db.registrations.length, 0, `${label} must not leave a host registration.`);
  assert.equal(db.activities.length, 0, `${label} must not leave activity rows.`);
  assert.equal(db.host.competitive_enabled, 0, `${label} must not leave host competitive_enabled changed.`);
  assert.equal(db.host.last_event_at, "2026-01-01T00:00:00.000Z", `${label} must restore host last_event_at.`);
  assert.equal(db.existingEvents().length, 1, `${label} must not touch existing events.`);
  assert.equal(db.deleteStatements, 0, `${label} must not issue compensating DELETE statements.`);
  assert.equal(db.externalCalls, 0, `${label} must not call Discord, queues, schedulers, brackets, scores, or awards.`);
}

type CreatorEventFailureStage =
  | "schema_readiness"
  | "host_lookup"
  | "entitlement_lookup"
  | "slug_lookup"
  | "event_insert"
  | "registration_insert"
  | "host_update"
  | "activity_insert";

type MemoryD1Options = {
  failStage?: CreatorEventFailureStage;
  missingSchemaTable?: string;
  hostMissing?: boolean;
  hostCategory?: string | null;
  hostStatus?: string;
  planKey?: string;
  subscriptionStatus?: string;
};

function memoryEnv(options: MemoryD1Options = {}): Env & { DB: MemoryD1 } {
  return {
    DZN_PLATFORM_CREATOR_DISCORD_ID: creatorDiscordId,
    DB: new MemoryD1(options),
  } as Env & { DB: MemoryD1 };
}

class InjectedStageError extends Error {
  code: string;
  constructor(stage: CreatorEventFailureStage) {
    super(`injected ${stage} SELECT secret_token_123456789012345678901234567890`);
    this.name = "InjectedStageError";
    this.code = `INJECTED_${stage}`;
  }
}

class MemoryD1 {
  events: Array<Record<string, unknown>> = [{ id: "existing-event-id", slug: "existing-event", preexisting: true }];
  registrations: Array<Record<string, unknown>> = [];
  activities: Array<Record<string, unknown>> = [];
  externalCalls = 0;
  deleteStatements = 0;
  readonly options: MemoryD1Options;
  host: Record<string, unknown>;

  constructor(options: MemoryD1Options) {
    this.options = options;
    this.host = {
      id: "server-a",
      user_id: "server-owner-user",
      guild_id: "guild-a",
      public_slug: "server-a",
      display_name: "NukeTown Test",
      hostname: "NukeTown Test",
      server_name: "NukeTown Test",
      nitrado_service_name: "NukeTown Test",
      server_type: options.hostCategory === null ? null : "DEATHMATCH",
      server_mode: null,
      server_category: options.hostCategory === undefined ? "deathmatch" : options.hostCategory,
      competitive_enabled: 0,
      verified_server: 1,
      event_mmr: 1000,
      season_points: 0,
      event_wins: 0,
      event_losses: 0,
      event_draws: 0,
      last_event_at: "2026-01-01T00:00:00.000Z",
      current_players: 1,
      max_players: 10,
      plan_key: options.planKey ?? "pro",
      subscription_status: options.subscriptionStatus ?? "active",
      status: options.hostStatus ?? "live",
      listing_visibility: "public",
      updated_at: "2026-01-02T00:00:00.000Z",
    };
    if (options.failStage === "entitlement_lookup") {
      Object.defineProperty(this.host, "subscription_status", {
        get() {
          throw new InjectedStageError("entitlement_lookup");
        },
      });
    }
  }

  prepare(query: string) {
    return new MemoryStatement(this, query);
  }

  async batch(statements: MemoryStatement[]) {
    const eventSnapshot = this.events.map((row) => ({ ...row }));
    const registrationSnapshot = this.registrations.map((row) => ({ ...row }));
    const activitySnapshot = this.activities.map((row) => ({ ...row }));
    const hostSnapshot = { ...this.host };
    try {
      for (const statement of statements) {
        await statement.run();
      }
      return statements.map(() => ({ success: true }));
    } catch (error) {
      this.events = eventSnapshot;
      this.registrations = registrationSnapshot;
      this.activities = activitySnapshot;
      this.host = hostSnapshot;
      throw error;
    }
  }

  exec() {
    throw new Error("Unexpected D1 exec in creator governance test");
  }

  createdEvents() {
    return this.events.filter((row) => row.preexisting !== true);
  }

  existingEvents() {
    return this.events.filter((row) => row.preexisting === true);
  }
}

class MemoryStatement {
  private bindings: unknown[] = [];
  constructor(private readonly db: MemoryD1, readonly query: string) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async all<T>() {
    if (this.query.includes("PRAGMA table_info(")) {
      if (this.db.options.failStage === "schema_readiness") throw new InjectedStageError("schema_readiness");
      const table = this.query.match(/PRAGMA table_info\(([^)]+)\)/)?.[1] ?? "";
      if (table === this.db.options.missingSchemaTable) return { results: [] as T[] };
      return { results: schemaColumns(table).map((name) => ({ name })) as T[] };
    }
    if (this.query.includes("FROM linked_servers") && this.query.includes("LEFT JOIN server_subscriptions")) {
      if (this.db.options.failStage === "host_lookup") throw new InjectedStageError("host_lookup");
      return { results: (this.db.options.hostMissing ? [] : [this.db.host]) as T[] };
    }
    throw new Error(`Unexpected all query: ${this.query.slice(0, 120)}`);
  }

  async first<T>() {
    if (this.query.includes("SELECT id FROM competitive_events WHERE slug")) {
      if (this.db.options.failStage === "slug_lookup") throw new InjectedStageError("slug_lookup");
      const slug = String(this.bindings[0] ?? "");
      return (this.db.events.find((event) => event.slug === slug) ?? null) as T | null;
    }
    throw new Error(`Unexpected first query: ${this.query.slice(0, 120)}`);
  }

  async run() {
    if (this.query.includes("INSERT INTO competitive_events")) {
      if (this.db.options.failStage === "event_insert") throw new InjectedStageError("event_insert");
      this.db.events.push({
        id: this.bindings[0],
        name: this.bindings[1],
        slug: this.bindings[2],
        category: this.bindings[4],
        event_type: this.bindings[5],
        status: this.bindings[6],
        visibility: this.bindings[7],
        starts_at: this.bindings[11],
        ends_at: this.bindings[12],
        created_by: this.bindings[13],
      });
      return { success: true };
    }
    if (this.query.includes("INSERT INTO competitive_event_servers")) {
      if (this.db.options.failStage === "registration_insert") throw new InjectedStageError("registration_insert");
      this.db.registrations.push({
        id: this.bindings[0],
        event_id: this.bindings[1],
        server_id: this.bindings[2],
        category: this.bindings[3],
        approved: 1,
        seed: 1,
      });
      return { success: true };
    }
    if (this.query.includes("UPDATE linked_servers") && this.query.includes("competitive_enabled = 1")) {
      if (this.db.options.failStage === "host_update") throw new InjectedStageError("host_update");
      this.db.host.competitive_enabled = 1;
      this.db.host.server_category = this.db.host.server_category ?? this.bindings[0];
      this.db.host.last_event_at = "2026-08-01T18:00:00.000Z";
      this.db.host.updated_at = "2026-08-01T18:00:00.000Z";
      return { success: true };
    }
    if (this.query.includes("INSERT INTO competitive_event_activity")) {
      if (this.db.options.failStage === "activity_insert") throw new InjectedStageError("activity_insert");
      this.db.activities.push({
        id: this.bindings[0],
        event_id: this.bindings[1],
        server_id: this.bindings[2],
        activity_type: "event_created",
        message: this.bindings[3],
      });
      return { success: true };
    }
    if (this.query.includes("DELETE FROM")) {
      this.db.deleteStatements += 1;
      throw new Error(`Unexpected destructive cleanup query: ${this.query.slice(0, 120)}`);
    }
    throw new Error(`Unexpected run query: ${this.query.slice(0, 120)}`);
  }
}

function schemaColumns(table: string) {
  const columns: Record<string, string[]> = {
    competitive_events: [
      "id",
      "name",
      "slug",
      "description",
      "category",
      "event_type",
      "status",
      "visibility",
      "premium_tier",
      "server_limit",
      "team_limit",
      "starts_at",
      "ends_at",
      "created_by",
      "rules",
      "rewards",
      "created_at",
      "updated_at",
    ],
    competitive_event_servers: ["id", "event_id", "server_id", "category", "approved", "seed", "registered_at"],
    competitive_event_matches: ["id", "event_id"],
    competitive_event_activity: ["id", "event_id", "server_id", "activity_type", "message", "metadata", "created_at"],
    linked_servers: ["id", "server_category", "competitive_enabled", "last_event_at", "updated_at", "status"],
    server_subscriptions: ["guild_id", "plan_key", "status"],
  };
  return columns[table] ?? [];
}

function source(path: string) {
  return readFileSync(path, "utf8");
}

function assertIncludes(file: string, snippet: string, label = snippet) {
  assert.equal(file.includes(snippet), true, `Expected ${label}`);
}

function assertSourceGovernance() {
  assert.equal(existsSync("app/events/suggest/page.tsx"), true, "Public suggestion route should exist.");
  assert.equal(existsSync("app/owner/events/page.tsx"), true, "Owner Event Control route should exist.");
  assert.equal(existsSync("app/owner/events/create/page.tsx"), true, "Creator create route should exist.");
  assert.equal(existsSync("functions/api/owner/events.ts"), true, "Owner events API should exist.");
  assert.equal(existsSync("functions/owner/events.ts"), true, "Owner Event Control page guard should exist.");
  assert.equal(existsSync("functions/owner/events/create.ts"), true, "Owner event create page guard should exist.");

  const envExample = source(".env.example");
  assertIncludes(envExample, "DZN_PLATFORM_CREATOR_DISCORD_ID=single-creator-discord-user-id");
  assert.doesNotMatch(envExample, /\b\d{17,22}\b/, "Repository env example must not contain a real creator Discord ID.");
  assertIncludes(source("cloudflare-env.d.ts"), "DZN_PLATFORM_CREATOR_DISCORD_ID?: string");

  const creatorHelper = source("functions/_lib/platform-creator.ts");
  assertIncludes(creatorHelper, "DZN_PLATFORM_CREATOR_DISCORD_ID");
  assertIncludes(creatorHelper, "value !== value.trim()");
  assertIncludes(creatorHelper, "^\\d{5,32}$");
  assertIncludes(creatorHelper, "Only the DZN platform creator can manage official DZN events.");
  assert.doesNotMatch(creatorHelper, /DZN_PLATFORM_OWNER_DISCORD_IDS|DZN_ADMIN_DISCORD_IDS|username|display_name|email|guild|role/i, "Creator capability must not depend on broader roles or display identity.");

  const eventCreateRoute = source("functions/api/events/create.ts");
  assertIncludes(eventCreateRoute, "requirePlatformCreatorEventAdmin");
  const eventCreateHandler = eventCreateRoute.slice(eventCreateRoute.indexOf("export const onRequest"));
  assert.equal(eventCreateHandler.indexOf("requirePlatformCreatorEventAdmin") < eventCreateHandler.indexOf("readJson"), true, "Legacy create API must authorize before reading request body.");
  assertIncludes(eventCreateRoute, "createCompetitiveEvent");

  const ownerEventsRoute = source("functions/api/owner/events.ts");
  assertIncludes(ownerEventsRoute, "requirePlatformOwner");
  assertIncludes(ownerEventsRoute, "requirePlatformCreatorEventAdmin");
  const ownerEventsPost = ownerEventsRoute.slice(ownerEventsRoute.indexOf("export const onRequestPost"));
  assert.equal(ownerEventsPost.indexOf("requirePlatformCreatorEventAdmin") < ownerEventsPost.indexOf("readJson"), true, "Owner create API must authorize before reading request body.");
  assert.doesNotMatch(ownerEventsRoute, /DISCORD_BOT_TOKEN|fetch\s*\(|queue|scheduled|awardBadge|finalizeServerWarEvent/i);

  const eventsLib = source("functions/_lib/events.ts");
  const createStart = eventsLib.indexOf("export async function createCompetitiveEvent");
  const createEnd = eventsLib.indexOf("export async function joinCompetitiveEvent");
  const createCompetitiveEventBody = eventsLib.slice(createStart, createEnd);
  assertIncludes(createCompetitiveEventBody, "creatorEventAdminDeniedPayload(env, viewer)");
  assert.equal(createCompetitiveEventBody.includes("await ensureCompetitiveEventsSchema(env);"), false, "Official event creation must not run broad request-time schema mutation.");
  assertIncludes(createCompetitiveEventBody, "validateCompetitiveEventCreationSchema(env, requestId)");
  assertIncludes(createCompetitiveEventBody, "fetchEventCreationHost(env, input.hosting_server_id ?? input.server_id, requestId)");
  assertIncludes(createCompetitiveEventBody, "await db.batch([");
  assertIncludes(createCompetitiveEventBody, "transactional_create");
  assertIncludes(createCompetitiveEventBody, "CASE WHEN changes() = 1 THEN 'event_created' ELSE NULL END", "Activity insert must fail the batch if the host update affects zero rows.");
  assert.doesNotMatch(createCompetitiveEventBody, /compensateFailedEventCreate|compensation_cleanup|DELETE\s+FROM\s+competitive_events|DELETE\s+FROM\s+competitive_event_/i, "Official event creation must not use destructive compensation cleanup.");
  assert.doesNotMatch(eventsLib, /function\s+compensateFailedEventCreate|EventCreateHostState/i, "Compensating event-create cleanup helpers must be removed.");
  assertIncludes(eventsLib, "EVENT_SCHEMA_NOT_READY");
  assertIncludes(eventsLib, "EVENT_CREATE_FAILED");
  assertIncludes(eventsLib, "input.preview === false && cleanSlug(input.event_slug ?? \"\")");

  for (const file of [
    "functions/api/admin/seasons.ts",
    "functions/api/admin/seasons/[seasonId].ts",
    "functions/api/admin/seasons/[seasonId]/refresh.ts",
    "functions/api/admin/seasons/[seasonId]/finalise.ts",
    "functions/api/admin/server-wars/[eventId]/refresh-score.ts",
    "functions/api/admin/server-wars/[eventId]/finalize.ts",
  ]) {
    assertIncludes(source(file), "requirePlatformCreatorEventAdmin", `${file} must require creator capability for official mutations.`);
  }

  for (const file of [
    "functions/api/events/[slug]/join.ts",
    "functions/api/servers/[serverId]/events/[eventId]/enter.ts",
    "functions/api/servers/[serverId]/events/[eventId]/leave.ts",
  ]) {
    const route = source(file);
    assert.doesNotMatch(route, /requirePlatformCreatorEventAdmin/, `${file} must preserve participation permissions separately.`);
  }

  const publicCreatePage = source("app/events/create/page.tsx");
  assert.doesNotMatch(publicCreatePage, /EventCreatePage|<form|api\/events\/create|Tournament Channel ID/i, "Public /events/create must not expose the official creation form.");
  assertIncludes(publicCreatePage, "Official DZN events are created and published by the DZN platform creator");
  assertIncludes(source("app/events/suggest/page.tsx"), "EventSuggestionsPage");

  const ownerConsole = source("components/owner/owner-console.tsx");
  assertIncludes(ownerConsole, "\"Event Control\"");
  assertIncludes(ownerConsole, "Creator event governance");
  assert.doesNotMatch(ownerConsole, /DZN_PLATFORM_CREATOR_DISCORD_ID/, "Owner console UI must not render raw creator env key as a value-bearing field.");

  const ownerEventsPage = source("components/owner/owner-events-page.tsx");
  assertIncludes(ownerEventsPage, "/api/owner/events");
  assertIncludes(ownerEventsPage, "creatorEventAdmin");
  const createPanel = ownerEventsPage.slice(ownerEventsPage.indexOf("function CreateOfficialEventPanel"));
  assert.equal(createPanel.indexOf("if (!payload.creatorEventAdmin)") < createPanel.indexOf("<form"), true, "Create controls must depend on server-confirmed capability data.");
  assert.doesNotMatch(ownerEventsPage, /DISCORD_BOT_TOKEN|DZN_PLATFORM_CREATOR_DISCORD_ID|channel_id|channelId|webhook|cookie/i, "Owner event page must not expose secret or Discord channel material.");

  const migrations = ["migrations/0032_events_competitive_ecosystem.sql", "migrations/0042_owner_event_hub.sql", "migrations/0051_server_wars_mvp.sql"];
  for (const migration of migrations) {
    assert.doesNotMatch(source(migration), /DZN_PLATFORM_CREATOR_DISCORD_ID|DROP TABLE|TRUNCATE|DELETE FROM|CREATE TABLE IF NOT EXISTS player_stats/i);
  }

  const autoUpdateWorkflow = source(".github/workflows/dzn-auto-update-schedulers.yml");
  assertIncludes(autoUpdateWorkflow, "workflow_dispatch:");
  assert.doesNotMatch(autoUpdateWorkflow, /^\s*push:|^\s*pull_request:|^\s*schedule:/m, "Auto Update Scheduler must remain manual backup only.");
  assert.doesNotMatch(autoUpdateWorkflow, /DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED:\s*["']true["']|DZN_DISCORD_NOTIFICATIONS_ENABLED:\s*["']true["']/);
}

void main();
