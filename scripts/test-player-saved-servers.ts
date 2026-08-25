import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequest as savedServersHandler } from "../functions/api/player/saved-servers";
import type { Env, PagesContext } from "../functions/_lib/types";

type FakeOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const apiSource = read("functions/api/player/saved-servers.ts");
  for (const snippet of [
    "getRequestSessionUser",
    "GET",
    "POST",
    "DELETE",
    "player_saved_servers",
    "resolvePublicServer",
    "linked_servers",
    "listing_visibility",
  ]) {
    assert.equal(apiSource.includes(snippet), true, `Saved servers API must include ${snippet}`);
  }
  assert.doesNotMatch(apiSource, /\brequireOwnerRequestAccess\b/);
  assert.doesNotMatch(apiSource, /\bownerAccessErrorResponse\b/);
  assert.doesNotMatch(apiSource, /\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(apiSource, /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bstripe\b|\bcreateCheckoutSession\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i);
  assert.doesNotMatch(apiSource, /\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bcanManageDiscordGuild\b|\bstoreGuilds\b/);
  assertNoForbiddenMutationTargets(apiSource);

  const publicNetworkSource = read("components/network/public-network.tsx");
  for (const snippet of [
    "/api/player/saved-servers",
    "SaveServerButton",
    "aria-pressed",
    "Bookmark",
    "CheckCircle2",
    "savedControls",
    "method: currentlySaved ? \"DELETE\" : \"POST\"",
    "/login?returnTo=",
  ]) {
    assert.equal(publicNetworkSource.includes(snippet), true, `Public server UI must include ${snippet}`);
  }
  assertSavedStateNotInFunction(publicNetworkSource, "discoveryValue");
  assertSavedStateNotInFunction(publicNetworkSource, "serverSortRank");
  assertSavedStateNotInFunction(publicNetworkSource, "advertisingRank");

  const publicServersApiSource = read("functions/api/public/servers.ts");
  assert.equal(publicServersApiSource.includes("player_saved_servers"), false, "Public server discovery API must not read saved preferences.");
  assertSavedStateNotInFunction(publicServersApiSource, "sortPublicServersForDiscovery");
  assertSavedStateNotInFunction(publicServersApiSource, "applyPublicServerAccess");

  const migration = stripSqlComments(read("migrations/0060_player_hub_foundation.sql"));
  assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS player_saved_servers"), true);
  assert.equal(migration.includes("UNIQUE(user_id, linked_server_id)"), true);
  assert.doesNotMatch(migration, /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bplayer_profiles\b|\bkill_events\b|\bplayer_events\b|\bcompetitive_events\b/i);

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  for (const snippet of [
    "Saved/Followed Server Interaction Slice",
    "`POST`/`DELETE /api/player/saved-servers`",
    "Clear green ticks",
    "clear red X marks",
    "subtle slow pan/zoom motion",
  ]) {
    assert.equal(platformSpec.includes(snippet), true, `Platform spec must include ${snippet}`);
  }

  const publicAccessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  assert.equal(publicAccessPolicy.includes("`/api/player/saved-servers`"), true);
  assert.equal(publicAccessPolicy.includes("Saving a server must not affect rankings"), true);

  const handoff = read("docs/PLAYER_SAVED_SERVERS_HANDOFF.md");
  assert.equal(handoff.includes("Saved/followed servers are private player preferences."), true);
  assert.equal(handoff.includes("Future Pricing Redesign Note"), true);

  const unauthenticated = await callSavedServers("GET", {} as Env);
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: "Unauthorized" });

  const noDbList = await callSavedServers("GET", { MOCK_AUTH: "true" } as Env);
  assert.equal(noDbList.status, 200);
  const noDbJson = await noDbList.json() as { source?: string; saved_servers?: unknown[] };
  assert.equal(noDbJson.source, "unavailable");
  assert.deepEqual(noDbJson.saved_servers, []);

  const listDb = createFakeDb();
  const listResponse = await callSavedServers("GET", { MOCK_AUTH: "true", DB: listDb.db } as Env);
  assert.equal(listResponse.status, 200);
  const listJson = await listResponse.json() as { saved_server_ids?: string[]; saved_server_slugs?: string[] };
  assert.deepEqual(listJson.saved_server_ids, ["linked-1"]);
  assert.deepEqual(listJson.saved_server_slugs, ["server-one"]);
  assert.equal(listDb.operations.some((op) => op.kind === "run"), false, "GET must not mutate saved preferences.");

  const postDb = createFakeDb();
  const postResponse = await callSavedServers("POST", { MOCK_AUTH: "true", DB: postDb.db } as Env, { public_slug: "server-one" });
  assert.equal(postResponse.status, 200);
  const postJson = await postResponse.json() as { saved?: boolean; linked_server_id?: string };
  assert.equal(postJson.saved, true);
  assert.equal(postJson.linked_server_id, "linked-1");
  assertMutationScope(postDb.operations, "INSERT INTO player_saved_servers");

  const deleteDb = createFakeDb();
  const deleteResponse = await callSavedServers("DELETE", { MOCK_AUTH: "true", DB: deleteDb.db } as Env, { linked_server_id: "linked-1" });
  assert.equal(deleteResponse.status, 200);
  const deleteJson = await deleteResponse.json() as { saved?: boolean; linked_server_id?: string };
  assert.equal(deleteJson.saved, false);
  assert.equal(deleteJson.linked_server_id, "linked-1");
  assertMutationScope(deleteDb.operations, "DELETE FROM player_saved_servers");

  const badTarget = await callSavedServers("POST", { MOCK_AUTH: "true", DB: createFakeDb().db } as Env, {});
  assert.equal(badTarget.status, 400);

  console.log("Player saved servers tests passed.");
}

async function callSavedServers(method: string, env: Env, body?: unknown) {
  return savedServersHandler({
    request: new Request("https://dzn.example/api/player/saved-servers", {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Promise<Response>;
}

function createFakeDb() {
  const operations: FakeOperation[] = [];
  const targetRow = {
    linked_server_id: "linked-1",
    public_slug: "server-one",
    server_name: "Server One",
    saved_at: null,
    updated_at: null,
    source: "manual",
  };

  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            async all<T>() {
              operations.push({ kind: "all", sql, bindings });
              return {
                results: sql.includes("FROM player_saved_servers") ? [targetRow] : [],
              } as { results: T[] };
            },
            async first<T>() {
              operations.push({ kind: "first", sql, bindings });
              return (sql.includes("FROM linked_servers") ? targetRow : null) as T | null;
            },
            async run() {
              operations.push({ kind: "run", sql, bindings });
              return { success: true };
            },
          };
        },
      };
    },
  };

  return { db: db as unknown as Env["DB"], operations };
}

function assertMutationScope(operations: FakeOperation[], expectedSql: string) {
  const runOperations = operations.filter((op) => op.kind === "run");
  assert.equal(runOperations.length, 1);
  assert.equal(normalizeSql(runOperations[0].sql).includes(expectedSql), true);
  for (const operation of runOperations) {
    assert.doesNotMatch(operation.sql, forbiddenMutationTargetPattern());
    assert.doesNotMatch(operation.sql, /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bserver_owners\b|\bserver_reviews\b|\bevents\b|\bcompetitive_events\b|\bkill_events\b|\bplayer_events\b/i);
  }
}

function assertNoForbiddenMutationTargets(source: string) {
  const sqlTemplates = source.match(/`[\s\S]*?`/g) ?? [];
  for (const template of sqlTemplates) {
    if (!/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i.test(template)) continue;
    assert.doesNotMatch(template, forbiddenMutationTargetPattern());
    assert.doesNotMatch(template, /\bDROP\b|\bALTER\b|\bTRUNCATE\b/i);
  }
}

function assertSavedStateNotInFunction(source: string, functionName: string) {
  const block = functionBlock(source, functionName);
  assert.notEqual(block, "", `${functionName} should exist.`);
  assert.doesNotMatch(block, /\bplayer_saved_servers\b|\bsavedServerIds\b|\bsaved_servers\b|\bsaved_by_viewer\b|\bsaveBusyIds\b/i);
}

function functionBlock(source: string, functionName: string) {
  const start = source.indexOf(`function ${functionName}`);
  if (start < 0) return "";
  const firstBrace = source.indexOf("{", start);
  if (firstBrace < 0) return "";
  let depth = 0;
  for (let index = firstBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

function stripSqlComments(source: string) {
  return source.replace(/--.*$/gm, "");
}

function normalizeSql(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

function forbiddenMutationTargetPattern() {
  return /\b(?:INSERT INTO|DELETE FROM)\s+(?!player_saved_servers\b)([a-zA-Z_][a-zA-Z0-9_]*)|\bUPDATE\s+(?!SET\b)(?!player_saved_servers\b)([a-zA-Z_][a-zA-Z0-9_]*)/i;
}

function read(path: string) {
  return readFileSync(path, "utf8");
}
