import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { eraseOrRetainAccountUser } from "../functions/_lib/deletion";
import { handleGamesEchoArray } from "../functions/_lib/games-echo-array";
import { handleGamesHub } from "../functions/_lib/games-hub";
import type { Env } from "../functions/_lib/types";
import { ECHO_ARRAY_REWARD, ECHO_ARRAY_TTL_MS, echoArrayCueIntervalMs, type EchoArrayNode, type EchoArrayPayload } from "../lib/games-echo-array";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof echoArrayFixture>>;
let passed = 0;

async function echoArrayFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0098_games_hub_echo_array.sql", "utf8"));
  (fixture.env as Env).DZN_GAMES_ECHO_ARRAY_ENABLED = "true";
  return fixture;
}

async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await echoArrayFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}

function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesEchoArray(new Request("https://local.test/api/games/echo-array", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}

async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<EchoArrayPayload>;
}

async function start(fixture: Fixture) { return payload(await call(fixture, { action: "start" })); }

function sequenceFor(fixture: Fixture) {
  const row = fixture.db.sqlite.prepare("SELECT sequence_json FROM dzn_echo_array_sessions WHERE user_id = 'local-player'").get();
  if (typeof row?.sequence_json !== "string") throw new Error("Expected a private Echo Array sequence in the local fixture");
  return JSON.parse(row.sequence_json) as EchoArrayNode[];
}

function revealFinished(fixture: Fixture) {
  const past = Date.now() - 20_000;
  fixture.db.sqlite.prepare("UPDATE dzn_echo_array_sessions SET cue_started_at = ?, updated_at = ? WHERE user_id = 'local-player'").run(past, past);
}

function tap(state: EchoArrayPayload, node: EchoArrayNode) {
  assert.ok(state.game);
  return { action: "tap", gameId: state.game.id, version: state.game.version, node };
}

async function completeRun(fixture: Fixture, initial: EchoArrayPayload) {
  let state = initial;
  while (state.game?.status === "playing") {
    revealFinished(fixture);
    state = await payload(await call(fixture));
    const game = state.game;
    assert.ok(game);
    const stage = game.stage;
    const sequence = sequenceFor(fixture);
    while (state.game?.status === "playing" && state.game.stage === stage) {
      const current = state.game;
      assert.ok(current);
      const nextNode = sequence[current.inputIndex];
      assert.ok(nextNode);
      fixture.db.sqlite.prepare("UPDATE dzn_echo_array_sessions SET updated_at = ? WHERE user_id = 'local-player'").run(Date.now() - 1_000);
      state = await payload(await call(fixture, tap(state, nextNode)));
    }
  }
  return state;
}

function wrongNode(expected: EchoArrayNode) {
  return (expected === "north" ? "east" : "north") as EchoArrayNode;
}

async function run() {
  await test("authentication, origin, method and feature switches fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_ECHO_ARRAY_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_echo_array_sessions").get()?.count, 0);
  });

  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_echo_array/i);
  }, false);

  await test("cue data is private, time-bounded and reads do not mutate the session", async fixture => {
    assert.equal((await payload(await call(fixture))).game, null);
    const state = await start(fixture);
    assert.equal(state.game?.stage, 1);
    assert.equal(state.game?.cue?.length, 4);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_echo_array_sessions").get()?.count, 1);
    revealFinished(fixture);
    const hidden = await payload(await call(fixture));
    assert.equal(hidden.game?.phase, "input");
    assert.equal(hidden.game?.cue, null);
    assert.equal(JSON.stringify(hidden).includes("sequence_json"), false);
    assert.match((await call(fixture)).headers.get("cache-control")!, /private, no-store/);
    assert.equal((await call(fixture)).headers.get("vary"), "Cookie");
  });
  await test("later echo stages reveal on tighter server-owned tempos", async fixture => {
    await start(fixture);
    const now = Date.now();
    fixture.db.sqlite.prepare("UPDATE dzn_echo_array_sessions SET stage = 2, cue_started_at = ?, updated_at = ? WHERE user_id = 'local-player'").run(now, now - 1_000);
    const echo = await payload(await call(fixture));
    assert.equal(echo.game?.intensity, "echo");
    assert.equal(echo.game?.cueIntervalMs, echoArrayCueIntervalMs(2));
    fixture.db.sqlite.prepare("UPDATE dzn_echo_array_sessions SET stage = 3, cue_started_at = ?, updated_at = ? WHERE user_id = 'local-player'").run(now, now - 1_000);
    const blackout = await payload(await call(fixture));
    assert.equal(blackout.game?.intensity, "blackout");
    assert.equal(blackout.game?.cueIntervalMs, echoArrayCueIntervalMs(3));
  });

  await test("strict request validation rejects forged shapes, reward fields and early inputs", async fixture => {
    const state = await start(fixture);
    const node = state.game?.cue?.[0] ?? "north";
    for (const body of [null, [], { action: "start", reward: 100 }, { action: "tap" },
      { ...tap(state, node), node: "up" }, { ...tap(state, node), version: 1.5 }, { ...tap(state, node), reward: ECHO_ARRAY_REWARD.xp }]) {
      assert.equal((await call(fixture, body)).status, 400);
    }
    assert.equal((await call(fixture, tap(state, node))).status, 429);
  });

  await test("the exact server-recorded pattern wins and grants one bounded daily reward", async fixture => {
    let state = await completeRun(fixture, await start(fixture));
    assert.equal(state.game?.status, "won");
    assert.equal(state.rewardGranted, true);
    assert.equal(state.rewardedToday, true);
    const reward = fixture.db.sqlite.prepare("SELECT xp, parts FROM dzn_echo_array_reward_ledger").get();
    assert.equal(reward?.xp, ECHO_ARRAY_REWARD.xp);
    assert.equal(reward?.parts, ECHO_ARRAY_REWARD.parts);
    fixture.db.sqlite.exec("UPDATE dzn_echo_array_sessions SET started_at = started_at - 6000");
    state = await completeRun(fixture, await start(fixture));
    assert.equal(state.game?.status, "won");
    assert.equal(state.rewardGranted, false);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_echo_array_reward_ledger").get()?.count, 1);
  });

  await test("two wrong replays fail without minting a reward", async fixture => {
    let state = await start(fixture);
    for (let attempt = 0; attempt < 2; attempt++) {
      revealFinished(fixture);
      state = await payload(await call(fixture));
      const expected = sequenceFor(fixture)[state.game!.inputIndex];
      fixture.db.sqlite.prepare("UPDATE dzn_echo_array_sessions SET updated_at = ? WHERE user_id = 'local-player'").run(Date.now() - 1_000);
      state = await payload(await call(fixture, tap(state, wrongNode(expected))));
    }
    assert.equal(state.game?.status, "failed");
    assert.equal(state.game?.errors, 2);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_echo_array_reward_ledger").get()?.count, 0);
  });

  await test("another player cannot read or advance a private echo", async fixture => {
    const state = await start(fixture);
    revealFinished(fixture);
    const own = await payload(await call(fixture));
    assert.equal((await call(fixture, tap(own, sequenceFor(fixture)[0]), { cookie: fixture.otherCookie })).status, 404);
    const other = await payload(await call(fixture, undefined, { cookie: fixture.otherCookie }));
    assert.equal(other.game, null);
    assert.ok(state.game?.id);
  });

  await test("expired and stale replays cannot overwrite state or mint rewards", async fixture => {
    let state = await start(fixture);
    fixture.db.sqlite.prepare("UPDATE dzn_echo_array_sessions SET started_at = ?, cue_started_at = ?, updated_at = ?").run(Date.now() - ECHO_ARRAY_TTL_MS, Date.now() - 20_000, Date.now() - 20_000);
    assert.equal((await call(fixture, tap(state, sequenceFor(fixture)[0]))).status, 409);
    fixture.db.sqlite.exec("UPDATE dzn_echo_array_sessions SET started_at = started_at - 6000");
    state = await start(fixture);
    revealFinished(fixture);
    state = await payload(await call(fixture));
    fixture.db.beforeBatch = () => { fixture.db.beforeBatch = null; fixture.db.sqlite.exec("UPDATE dzn_echo_array_sessions SET version = version + 1"); };
    assert.equal((await call(fixture, tap(state, sequenceFor(fixture)[0]))).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_echo_array_reward_ledger").get()?.count, 0);
  });

  await test("a reward write failure rolls back the winning input", async fixture => {
    let state = await start(fixture);
    while (state.game?.status === "playing" && state.game.stage < state.game.totalStages) {
      revealFinished(fixture);
      state = await payload(await call(fixture));
      const game = state.game;
      assert.ok(game);
      const stage = game.stage;
      while (state.game?.status === "playing" && state.game.stage === stage) {
        const current = state.game;
        assert.ok(current);
        const node = sequenceFor(fixture)[current.inputIndex];
        fixture.db.sqlite.prepare("UPDATE dzn_echo_array_sessions SET updated_at = ? WHERE user_id = 'local-player'").run(Date.now() - 1_000);
        state = await payload(await call(fixture, tap(state, node)));
      }
    }
    revealFinished(fixture);
    state = await payload(await call(fixture));
    while (state.game && state.game.inputIndex < state.game.sequenceLength - 1) {
      const node = sequenceFor(fixture)[state.game.inputIndex];
      fixture.db.sqlite.prepare("UPDATE dzn_echo_array_sessions SET updated_at = ? WHERE user_id = 'local-player'").run(Date.now() - 1_000);
      state = await payload(await call(fixture, tap(state, node)));
    }
    fixture.db.sqlite.exec("CREATE TRIGGER fail_echo_reward BEFORE INSERT ON dzn_echo_array_reward_ledger BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    fixture.db.sqlite.prepare("UPDATE dzn_echo_array_sessions SET updated_at = ? WHERE user_id = 'local-player'").run(Date.now() - 1_000);
    const finalNode = sequenceFor(fixture)[state.game!.inputIndex];
    assert.equal((await call(fixture, tap(state, finalNode))).status, 503);
    const restored = await payload(await call(fixture));
    assert.equal(restored.game?.status, "playing");
    assert.equal(restored.game?.inputIndex, state.game?.inputIndex);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_echo_array_reward_ledger").get()?.count, 0);
  });

  await test("the Hub retains Echo Array rewards after its play flag is disabled", async fixture => {
    const state = await completeRun(fixture, await start(fixture));
    assert.equal(state.rewardGranted, true);
    const yesterday = Date.now() - 86_400_000;
    fixture.db.sqlite.prepare(`INSERT INTO dzn_echo_array_reward_ledger
      (id, user_id, reward_key, game_id, xp, parts, created_at) VALUES (?, 'local-player', ?, ?, 110, 5, ?)`)
      .run(randomUUID(), new Date(yesterday).toISOString().slice(0, 10), randomUUID(), yesterday);
    fixture.env.DZN_GAMES_ECHO_ARRAY_ENABLED = "false";
    const response = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    const hub = await response.json() as { summary: { xp: number; parts: number; streak: number; history: Array<{ kind: string }> } };
    assert.equal(hub.summary.xp, 220);
    assert.equal(hub.summary.parts, 10);
    assert.equal(hub.summary.streak, 2);
    assert.ok(hub.summary.history.some(entry => entry.kind === "echo-array"));
  });

  await test("the Echo Array command surface uses the server cue cadence without embedding private sequence storage", async () => {
    const source = readFileSync("components/games/games-hub.tsx", "utf8");
    assert.match(source, /const cueIntervalMs = game\?\.cueIntervalMs/);
    assert.match(source, /echoArrayCueBuffer/);
    assert.match(source, /revealing && index <= cuePulseIndex \? game\.cue\?\.\[index\] : null/);
    assert.match(source, /Cue buffer is locked/);
    assert.doesNotMatch(source, /sequence_json/);
  });

  await test("account deletion cascades private Echo Array state and rewards", async fixture => {
    await completeRun(fixture, await start(fixture));
    assert.equal(await eraseOrRetainAccountUser(fixture.env.DB, "local-player"), 1);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_echo_array_sessions WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_echo_array_reward_ledger WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });

  await test("migration constraints reject forged rewards and retain foreign keys", async fixture => {
    assert.throws(() => fixture.db.sqlite.prepare("INSERT INTO dzn_echo_array_reward_ledger VALUES (?, 'local-player', ?, ?, 999, 99, 0)")
      .run(randomUUID(), randomUUID(), randomUUID()));
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });

  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const migration = readFileSync("migrations/0098_games_hub_echo_array.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'dzn_echo_array_%' ORDER BY name").all<{ name: string }>();
    assert.deepEqual(tables.results.map((row: { name: string }) => row.name), ["dzn_echo_array_reward_ledger", "dzn_echo_array_sessions"]);
    const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dzn_echo_array_rewards_history'").all<{ name: string }>();
    assert.equal(indexes.results.length, 1);
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_echo_array_sessions").first<{ count: number }>())?.count, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_echo_array_reward_ledger").first<{ count: number }>())?.count, 0);
    passed++; console.log("PASS actual local D1 migration, schema, index, foreign-key and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} DZN Echo Array checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
