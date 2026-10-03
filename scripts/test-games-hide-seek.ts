import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { handleGamesHideSeek } from "../functions/_lib/games-hide-seek";
import { handleGamesHub } from "../functions/_lib/games-hub";
import type { Env } from "../functions/_lib/types";
import type { HideSeekPayload } from "../lib/games-hide-seek";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof hideSeekFixture>>;
let passed = 0;

async function hideSeekFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0087_games_hub_hide_seek.sql", "utf8"));
  (fixture.env as Env).DZN_GAMES_HIDE_SEEK_ENABLED = "true";
  return fixture;
}
async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await hideSeekFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}
function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesHideSeek(new Request("https://local.test/api/games/hide-seek", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}
async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<HideSeekPayload>;
}
async function start(fixture: Fixture) { return payload(await call(fixture, { action: "start" })); }
function scan(state: HideSeekPayload, target: { x: number; y: number }) {
  assert.ok(state.game); return { action: "scan", gameId: state.game.id, version: state.game.version, x: target.x, y: target.y };
}
function emptyPoint(state: HideSeekPayload) {
  for (let x = 0; x <= 1000; x += 100) for (let y = 0; y <= 1000; y += 100) {
    if (state.game!.targets.every(target => Math.hypot(target.x - x, target.y - y) > 45)) return { x, y };
  }
  throw new Error("No empty scene point available");
}

async function run() {
  await test("authentication, origin, method and feature switches fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_HIDE_SEEK_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_sessions").get()?.count, 0);
  });
  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture); assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_hide_seek/i);
  }, false);
  await test("read is mutation-free and a new hunt uses four unique fair slots", async fixture => {
    assert.equal((await payload(await call(fixture))).game, null);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_sessions").get()?.count, 0);
    const state = await start(fixture); assert.equal(state.game?.targets.length, 4);
    assert.equal(new Set(state.game?.targets.map(target => target.id)).size, 4);
    assert.ok(state.game?.targets.every(target => target.x >= 0 && target.x <= 1000 && target.y >= 0 && target.y <= 1000));
  });
  await test("strict request validation rejects forged shapes and coordinates", async fixture => {
    const state = await start(fixture);
    for (const body of [null, [], { action: "start", reward: 999 }, { action: "scan" },
      { ...scan(state, state.game!.targets[0]), reward: 999 }, { ...scan(state, state.game!.targets[0]), x: 1001 }]) {
      assert.equal((await call(fixture, body)).status, 400);
    }
  });
  await test("four server-validated finds win and mint one bounded daily reward", async fixture => {
    let state = await start(fixture);
    for (const target of state.game!.targets) state = await payload(await call(fixture, scan(state, target)));
    assert.equal(state.game?.status, "won"); assert.equal(state.game?.foundCount, 4); assert.equal(state.rewardedToday, true);
    const reward = fixture.db.sqlite.prepare("SELECT xp, parts FROM dzn_hide_seek_reward_ledger").get();
    assert.equal(reward?.xp, 60); assert.equal(reward?.parts, 2);
    fixture.db.sqlite.exec("UPDATE dzn_hide_seek_sessions SET started_at = started_at - 6000");
    state = await start(fixture);
    for (const target of state.game!.targets) state = await payload(await call(fixture, scan(state, target)));
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_reward_ledger").get()?.count, 1);
  });
  await test("six empty scans fail without a reward", async fixture => {
    let state = await start(fixture); const empty = emptyPoint(state);
    for (let index = 0; index < 6; index++) state = await payload(await call(fixture, scan(state, empty)));
    assert.equal(state.game?.status, "failed"); assert.equal(state.game?.misses, 6);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_reward_ledger").get()?.count, 0);
  });
  await test("stale concurrent scans cannot overwrite progress or mint rewards", async fixture => {
    const state = await start(fixture); const target = state.game!.targets[0];
    fixture.db.beforeBatch = () => { fixture.db.beforeBatch = null; fixture.db.sqlite.exec("UPDATE dzn_hide_seek_sessions SET version = version + 1"); };
    assert.equal((await call(fixture, scan(state, target))).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT found_ids_json FROM dzn_hide_seek_sessions").get()?.found_ids_json, "[]");
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_reward_ledger").get()?.count, 0);
  });
  await test("Hub preserves Signal Hunt rewards after the play flag is disabled", async fixture => {
    let state = await start(fixture);
    for (const target of state.game!.targets) state = await payload(await call(fixture, scan(state, target)));
    fixture.env.DZN_GAMES_HIDE_SEEK_ENABLED = "false";
    const response = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    const hub = await response.json() as { summary: { xp: number; parts: number; history: Array<{ kind: string }> } };
    assert.equal(hub.summary.xp, 60); assert.equal(hub.summary.parts, 2);
    assert.ok(hub.summary.history.some(entry => entry.kind === "hide-seek"));
  });
  await test("migration constraints reject forged rewards and preserve foreign keys", async fixture => {
    assert.throws(() => fixture.db.sqlite.prepare("INSERT INTO dzn_hide_seek_reward_ledger VALUES (?, 'local-player', ?, ?, 999, 99, 0)").run(randomUUID(), randomUUID(), randomUUID()));
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });
  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const migration = readFileSync("migrations/0087_games_hub_hide_seek.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_sessions").first<{ count: number }>())?.count, 0);
    passed++; console.log("PASS actual local D1 migration, constraints, indexes and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} DZN Signal Hunt checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
