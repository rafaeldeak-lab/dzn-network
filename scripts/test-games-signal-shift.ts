import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { eraseOrRetainAccountUser } from "../functions/_lib/deletion";
import { handleGamesHub } from "../functions/_lib/games-hub";
import { handleGamesSignalShift } from "../functions/_lib/games-signal-shift";
import type { Env } from "../functions/_lib/types";
import { SIGNAL_SHIFT_MAX_MOVES, SIGNAL_SHIFT_REWARD, SIGNAL_SHIFT_TTL_MS, signalShiftIntensity, type SignalShiftPayload } from "../lib/games-signal-shift";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof signalShiftFixture>>;
let passed = 0;

async function signalShiftFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0100_games_hub_signal_shift.sql", "utf8"));
  (fixture.env as Env).DZN_GAMES_SIGNAL_SHIFT_ENABLED = "true";
  return fixture;
}

async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await signalShiftFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}

function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesSignalShift(new Request("https://local.test/api/games/signal-shift", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}

async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<SignalShiftPayload>;
}

async function start(fixture: Fixture) { return payload(await call(fixture, { action: "start" })); }

function neighbors(index: number) {
  const row = Math.floor(index / 4); const column = index % 4;
  return [row > 0 ? index - 4 : null, column < 3 ? index + 1 : null, row < 3 ? index + 4 : null, column > 0 ? index - 1 : null]
    .filter((value): value is number => value !== null);
}

function firstLegalTile(state: SignalShiftPayload) {
  const game = state.game;
  assert.ok(game);
  const blank = game.tiles.indexOf(0);
  const index = neighbors(blank)[0];
  return game.tiles[index];
}

function command(state: SignalShiftPayload, tile = firstLegalTile(state)) {
  assert.ok(state.game);
  return { action: "move", gameId: state.game.id, version: state.game.version, tile };
}

function settle(fixture: Fixture) {
  fixture.db.sqlite.prepare("UPDATE dzn_signal_shift_sessions SET updated_at = ? WHERE user_id = 'local-player'").run(Date.now() - 1_000);
}

function setBoard(fixture: Fixture, tiles: number[], moves = 0) {
  fixture.db.sqlite.prepare("UPDATE dzn_signal_shift_sessions SET tiles_json = ?, moves = ?, status = 'playing', updated_at = ? WHERE user_id = 'local-player'")
    .run(JSON.stringify(tiles), moves, Date.now() - 1_000);
}

function nearSolvedBoard() {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15];
}

function inversionParity(tiles: number[]) {
  const values = tiles.filter(Boolean); let inversions = 0;
  for (let left = 0; left < values.length; left++) for (let right = left + 1; right < values.length; right++) if (values[left] > values[right]) inversions++;
  const blankRowFromBottom = 4 - Math.floor(tiles.indexOf(0) / 4);
  return (inversions + blankRowFromBottom) % 2;
}

async function winFromNearSolution(fixture: Fixture) {
  setBoard(fixture, nearSolvedBoard());
  const state = await payload(await call(fixture));
  return payload(await call(fixture, command(state, 15)));
}

async function run() {
  await test("authentication, origin, method and feature switches fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_SIGNAL_SHIFT_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_signal_shift_sessions").get()?.count, 0);
  });

  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_signal_shift/i);
  }, false);

  await test("generated grids are unique, non-solved, solvable and private to their authenticated owner", async fixture => {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) fixture.db.sqlite.exec("UPDATE dzn_signal_shift_sessions SET started_at = started_at - 6000");
      const state = await start(fixture);
      assert.ok(state.game);
      assert.equal(state.game.tiles.length, 16);
      assert.equal(state.game.maxMoves, SIGNAL_SHIFT_MAX_MOVES);
      assert.equal(state.game.intensity, "calibration");
      assert.equal(new Set(state.game.tiles).size, 16);
      assert.notDeepEqual(state.game.tiles, Array.from({ length: 16 }, (_, index) => (index + 1) % 16));
      assert.equal(inversionParity(state.game.tiles), 1, "Every generated 4x4 board must be reachable from the solved arrangement.");
      assert.equal(JSON.stringify(state).includes("tiles_json"), false);
      assert.equal((await call(fixture)).headers.get("cache-control"), "private, no-store");
      assert.equal((await call(fixture)).headers.get("vary"), "Cookie");
    }
    const other = await payload(await call(fixture, undefined, { cookie: fixture.otherCookie }));
    assert.equal(other.game, null);
  });

  await test("strict request validation rejects forged shapes, forged rewards and non-adjacent shifts", async fixture => {
    const state = await start(fixture);
    const blank = state.game!.tiles.indexOf(0);
    const distant = state.game!.tiles.find((tile, index) => tile !== 0 && !neighbors(blank).includes(index))!;
    for (const body of [null, [], { action: "start", reward: 100 }, { action: "move" },
      { ...command(state), version: 1.5 }, { ...command(state), tile: 0 }, { ...command(state), reward: SIGNAL_SHIFT_REWARD.xp }]) {
      assert.equal((await call(fixture, body)).status, 400);
    }
    assert.equal((await call(fixture, command(state))).status, 429);
    settle(fixture);
    assert.equal((await call(fixture, command(state, distant))).status, 400);
    assert.equal((await call(fixture, command(state))).status, 200);
  });

  await test("later routing phases are derived server-side from the bounded move count", async () => {
    assert.equal(signalShiftIntensity(0), "calibration");
    assert.equal(signalShiftIntensity(21), "calibration");
    assert.equal(signalShiftIntensity(22), "pressure");
    assert.equal(signalShiftIntensity(43), "pressure");
    assert.equal(signalShiftIntensity(44), "blackout");
    assert.equal(signalShiftIntensity(SIGNAL_SHIFT_MAX_MOVES), "blackout");
  });

  await test("legal server-validated shifts, win state and daily reward cap apply exactly", async fixture => {
    const state = await start(fixture);
    settle(fixture);
    const advanced = await payload(await call(fixture, command(state)));
    assert.equal(advanced.game?.moves, 1);
    fixture.db.sqlite.exec("UPDATE dzn_signal_shift_sessions SET started_at = started_at - 6000");
    const won = await winFromNearSolution(fixture);
    assert.equal(won.game?.status, "won");
    assert.equal(won.rewardGranted, true);
    const reward = fixture.db.sqlite.prepare("SELECT xp, parts FROM dzn_signal_shift_reward_ledger").get();
    assert.equal(reward?.xp, SIGNAL_SHIFT_REWARD.xp);
    assert.equal(reward?.parts, SIGNAL_SHIFT_REWARD.parts);
    fixture.db.sqlite.exec("UPDATE dzn_signal_shift_sessions SET started_at = started_at - 6000");
    await start(fixture);
    const practice = await winFromNearSolution(fixture);
    assert.equal(practice.game?.status, "won");
    assert.equal(practice.rewardGranted, false);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_signal_shift_reward_ledger").get()?.count, 1);
  });

  await test("the shift cap, stale commands and expiry cannot mint a reward", async fixture => {
    await start(fixture);
    setBoard(fixture, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 14, 15], SIGNAL_SHIFT_MAX_MOVES - 1);
    let state = await payload(await call(fixture));
    const final = await payload(await call(fixture, command(state, 14)));
    assert.equal(final.game?.status, "failed");
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_signal_shift_reward_ledger").get()?.count, 0);
    fixture.db.sqlite.exec("UPDATE dzn_signal_shift_sessions SET started_at = started_at - 6000");
    state = await start(fixture);
    fixture.db.sqlite.prepare("UPDATE dzn_signal_shift_sessions SET started_at = ?, updated_at = ? WHERE user_id = 'local-player'").run(Date.now() - SIGNAL_SHIFT_TTL_MS, Date.now() - 1_000);
    assert.equal((await call(fixture, command(state))).status, 409);
    fixture.db.sqlite.exec("UPDATE dzn_signal_shift_sessions SET started_at = started_at - 6000");
    state = await start(fixture);
    settle(fixture);
    fixture.db.beforeBatch = () => { fixture.db.beforeBatch = null; fixture.db.sqlite.exec("UPDATE dzn_signal_shift_sessions SET version = version + 1"); };
    assert.equal((await call(fixture, command(state))).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_signal_shift_reward_ledger").get()?.count, 0);
  });

  await test("a reward failure rolls back the finishing shift", async fixture => {
    await start(fixture);
    setBoard(fixture, nearSolvedBoard());
    const before = await payload(await call(fixture));
    fixture.db.sqlite.exec("CREATE TRIGGER fail_signal_shift_reward BEFORE INSERT ON dzn_signal_shift_reward_ledger BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    assert.equal((await call(fixture, command(before, 15))).status, 503);
    const restored = await payload(await call(fixture));
    assert.equal(restored.game?.status, "playing");
    assert.deepEqual(restored.game?.tiles, nearSolvedBoard());
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_signal_shift_reward_ledger").get()?.count, 0);
  });

  await test("the Hub retains Signal Shift rewards after its play flag is disabled", async fixture => {
    await start(fixture);
    const state = await winFromNearSolution(fixture);
    assert.equal(state.rewardGranted, true);
    const yesterday = Date.now() - 86_400_000;
    fixture.db.sqlite.prepare(`INSERT INTO dzn_signal_shift_reward_ledger
      (id, user_id, reward_key, game_id, xp, parts, created_at) VALUES (?, 'local-player', ?, ?, 130, 6, ?)`)
      .run(randomUUID(), new Date(yesterday).toISOString().slice(0, 10), randomUUID(), yesterday);
    fixture.env.DZN_GAMES_SIGNAL_SHIFT_ENABLED = "false";
    const response = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    const hub = await response.json() as { summary: { xp: number; parts: number; streak: number; history: Array<{ kind: string }> } };
    assert.equal(hub.summary.xp, 260);
    assert.equal(hub.summary.parts, 12);
    assert.equal(hub.summary.streak, 2);
    assert.ok(hub.summary.history.some(entry => entry.kind === "signal-shift"));
  });

  await test("account deletion cascades private Signal Shift sessions and rewards", async fixture => {
    await start(fixture);
    await winFromNearSolution(fixture);
    assert.equal(await eraseOrRetainAccountUser(fixture.env.DB, "local-player"), 1);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_signal_shift_sessions WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_signal_shift_reward_ledger WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });

  await test("migration constraints reject forged rewards and retain foreign keys", async fixture => {
    assert.throws(() => fixture.db.sqlite.prepare("INSERT INTO dzn_signal_shift_reward_ledger VALUES (?, 'local-player', ?, ?, 999, 99, 0)")
      .run(randomUUID(), randomUUID(), randomUUID()));
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });

  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const migration = readFileSync("migrations/0100_games_hub_signal_shift.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'dzn_signal_shift_%' ORDER BY name").all<{ name: string }>();
    assert.deepEqual(tables.results.map((row: { name: string }) => row.name), ["dzn_signal_shift_reward_ledger", "dzn_signal_shift_sessions"]);
    const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dzn_signal_shift_rewards_history'").all<{ name: string }>();
    assert.equal(indexes.results.length, 1);
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_signal_shift_sessions").first<{ count: number }>())?.count, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_signal_shift_reward_ledger").first<{ count: number }>())?.count, 0);
    passed++; console.log("PASS actual local D1 migration, schema, index, foreign-key and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} DZN Signal Shift checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
