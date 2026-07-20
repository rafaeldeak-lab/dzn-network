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

function source(path: string) {
  return readFileSync(path, "utf8");
}

function assertIncludes(file: string, snippet: string, label = snippet) {
  assert.equal(file.includes(snippet), true, `Expected ${label}`);
}

function assertSourceGovernance() {
  assert.equal(existsSync("app/events/suggest/page.tsx"), true, "Public suggestion placeholder route should exist.");
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
  const createCompetitiveEventBody = eventsLib.slice(eventsLib.indexOf("export async function createCompetitiveEvent"));
  assert.equal(createCompetitiveEventBody.indexOf("creatorEventAdminDeniedPayload(env, viewer)") < createCompetitiveEventBody.indexOf("await ensureCompetitiveEventsSchema(env);"), true, "Event creation must check creator capability before schema helpers.");
  assertIncludes(createCompetitiveEventBody, "const server = await fetchServerById(env, input.hosting_server_id ?? input.server_id);");
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
  assertIncludes(source("app/events/suggest/page.tsx"), "Community competition suggestions are coming soon");

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
