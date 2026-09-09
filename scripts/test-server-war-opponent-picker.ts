import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { hmacSha256 } from "../functions/_lib/crypto";
import { onRequest } from "../functions/api/servers/[serverId]/wars/opponents";
import { explorationPreviewCells, publicMapLabel, showcasePlanLabel } from "../lib/showcase-labels";
import type { Env, PagesContext } from "../functions/_lib/types";

type Sqlite = { exec(sql: string): void; prepare(sql: string): { all(...values: unknown[]): Record<string, unknown>[]; get(...values: unknown[]): Record<string, unknown> | undefined }; close(): void };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

export async function testServerWarOpponentPicker() {
  assert.equal(publicMapLabel("dayzOffline.chernarusplus"), "Chernarus");
  assert.equal(publicMapLabel("ChernarusPlus"), "Chernarus");
  assert.equal(publicMapLabel("dayzOffline.enoch"), "Livonia");
  assert.equal(publicMapLabel("dayzOffline.sakhal"), "Sakhal");
  assert.equal(publicMapLabel(null), "Map not specified");
  for (const plan of ["pro", "premium", "network", "partner"]) assert.equal(showcasePlanLabel(plan), "Pro");
  assert.equal(showcasePlanLabel("starter"), "Starter");
  assert.equal(showcasePlanLabel("free"), "Standard");
  const cells = explorationPreviewCells([{ cellX: 0, cellY: 127, visits: 3 }, { cellX: 128, cellY: 4, visits: 3 }, { cellX: -1, cellY: 0, visits: 3 }], 128);
  assert.equal(cells.length, 1); assert.equal(cells[0].left, 0.390625); assert.equal(cells[0].top, 99.609375);
  assert.deepEqual(explorationPreviewCells([], NaN), []);
  const db = new DatabaseSync(":memory:");
  let writes = 0;
  try {
    db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT, username TEXT, avatar TEXT);
      CREATE TABLE sessions (user_id TEXT, session_token_hash TEXT, expires_at TEXT);
      CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT, guild_id TEXT, server_name TEXT, display_name TEXT, hostname TEXT, nitrado_service_name TEXT, public_slug TEXT, server_category TEXT, server_type TEXT, server_mode TEXT, status TEXT, listing_visibility TEXT, lifecycle_status TEXT, merged_into_server_id TEXT);
      CREATE TABLE server_subscriptions (guild_id TEXT, plan_key TEXT, status TEXT);
      INSERT INTO users VALUES ('owner', 'discord-owner', 'Owner', NULL), ('outsider', 'discord-other', 'Other', NULL);
      INSERT INTO server_subscriptions VALUES ('guild-owner', 'pro', 'active');
      INSERT INTO linked_servers (id,user_id,guild_id,server_name,server_category,status,listing_visibility,lifecycle_status) VALUES
      ('source','owner','guild-owner','Source','deathmatch','live','public','active_live'),
      ('good','another','guild-other','Good 100%_Server','deathmatch','live','public','active_live'),
      ('private','another','guild-other','Private Secret','deathmatch','live','private','active_live'),
      ('unlisted','another','guild-other','Unlisted Secret','deathmatch','live','unlisted','active_live'),
      ('other-category','another','guild-other','Other Category','pve','live','public','active_live'),
      ('pending','another','guild-other','Pending Secret','deathmatch','pending','public','pending'),
      ('paused','another','guild-other','Paused Secret','deathmatch','live','public','token_needs_resave'),
      ('merged','another','guild-other','Merged Secret','deathmatch','live','public','active_live');
      UPDATE linked_servers SET merged_into_server_id='good' WHERE id='merged';`);
    for (const user of ["owner", "outsider"]) db.exec(`INSERT INTO sessions VALUES ('${user}', '${await hmacSha256(user, "fixture-secret")}', '2999-01-01')`);
    const env = { SESSION_SECRET: "fixture-secret", MOCK_AUTH: "false", DB: { prepare(sql: string) {
      if (!/^\s*(SELECT|WITH)\b/i.test(sql)) { writes++; throw new Error("Read-only endpoint attempted a write"); }
      const statement = (values: unknown[]) => ({ bind: (...bindings: unknown[]) => statement(bindings), first: async () => db.prepare(sql).get(...values) ?? null, all: async () => ({ results: db.prepare(sql).all(...values), success: true }) });
      return statement([]);
    } } } as unknown as Env;
    const request = (query = "", user = "owner", method = "GET", serverId = "source", ruleset = "deathmatch_war") => onRequest({ request: new Request(`https://dzn.test/api/servers/source/wars/opponents?ruleset=${ruleset}${query}`, { method, headers: user ? { cookie: `dzn_session=${user}` } : {} }), env, params: { serverId }, data: {}, waitUntil() {}, next: async () => new Response(null) } as PagesContext) as Promise<Response>;
    assert.equal((await request("", "")).status, 401);
    assert.equal((await request("", "outsider")).status, 403);
    assert.equal((await request("", "owner", "POST")).status, 405);
    assert.equal((await request("", "owner", "GET", "unknown")).status, 404);
    assert.equal((await request("", "owner", "GET", "source", "invalid")).status, 400);
    assert.equal((await request("", "owner", "GET", "")).status, 400);
    const response = await request("&user_id=outsider");
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
    const payload = await response.json() as { servers: { id: string; name: string }[]; nextOffset: number | null };
    assert.deepEqual(payload.servers.map(server => server.id), ["good"]);
    assert.equal(payload.nextOffset, null);
    assert.doesNotMatch(JSON.stringify(payload), /discord-|guild-|user_id|plan_key|Private Secret|Pending Secret|Paused Secret/);
    const exact = await (await request("&search=100%25_")).json() as typeof payload;
    assert.deepEqual(exact.servers.map(server => server.id), ["good"], "SQL wildcards are literal search text");
    assert.deepEqual((await (await request("&search=%27%20OR%201%3D1--")).json() as typeof payload).servers, []);
    db.exec(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<101)
      INSERT INTO linked_servers (id,user_id,guild_id,server_name,server_category,status,listing_visibility,lifecycle_status)
      SELECT printf('page-%03d',n),'another','guild-other',printf('Paged server %03d',n),'deathmatch','live','public','active_live' FROM numbers;`);
    const firstPage = await (await request("&search=Paged&offset=-5")).json() as typeof payload;
    const secondPage = await (await request("&search=Paged&offset=100")).json() as typeof payload;
    assert.equal(firstPage.servers.length, 100); assert.equal(firstPage.nextOffset, 100);
    assert.equal(secondPage.servers.length, 1); assert.equal(secondPage.nextOffset, null);
    assert.equal(new Set([...firstPage.servers, ...secondPage.servers].map(server => server.id)).size, 101);
    assert.equal((await (await request("&offset=Infinity")).json() as typeof payload).nextOffset, null);
    db.exec("UPDATE server_subscriptions SET status='past_due'");
    assert.equal((await request()).status, 403);
    assert.equal(writes, 0);
    const source = readFileSync("functions/_lib/server-wars.ts", "utf8");
    const create = source.slice(source.indexOf("export async function createServerWarChallenge("), source.indexOf("export async function acceptServerWarChallenge"));
    assert.match(create, /assertSameCategoryChallenge/); assert.match(create, /isPublicServerWarsEligibleServer/); assert.match(create, /requireServerOwnerOrDznAdmin/);
    const ui = readFileSync("components/onboarding/dashboard.tsx", "utf8");
    assert.doesNotMatch(ui, /Opponent server id or slug/); assert.match(ui, /opponentSelection.scope === opponentScope/);
    console.log("Server-name picker auth/SQL/privacy/eligibility and map-label tests passed.");
  } finally { db.close(); }
}
