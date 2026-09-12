import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { hasMine, hasFlag, isRevealed, setIsRevealed, setHasFlag } from "@taros-minesweeper/lib";
import { handleGamesHub } from "../functions/_lib/games-hub";
import { createGameBoard, gameView, moveGame, type GameRow } from "../functions/_lib/games-hub-engine";
import { GAME_MODES, type GameMode, type HubPayload } from "../lib/games-hub";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof gamesFixture>>;
let passed = 0;
async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await gamesFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}
function call(f: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesHub(new Request("https://local.test/api/games/hub", { method, headers: {
    cookie: options.cookie ?? f.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), f.env);
}
const payload = async (response: Response) => { assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<HubPayload>; };
function almostWon(f: Fixture, mode: GameMode = "recon", timestamp = Date.now()) {
  let board = createGameBoard(mode);
  const index = board.flat().findIndex(cell => !hasMine(cell));
  const x = index % board.length, y = Math.floor(index / board.length);
  board = board.map((line, yy) => line.map((cell, xx) => !hasMine(cell) && !(xx === x && yy === y) ? setIsRevealed(cell, true) : cell));
  const id = randomUUID();
  f.db.sqlite.prepare(`INSERT OR REPLACE INTO dzn_game_sessions VALUES ('local-player', ?, ?, ?, 'playing', 7, ?, ?)`)
    .run(id, mode, JSON.stringify(board), timestamp, timestamp);
  return { action: "move", gameId: id, version: 7, x, y, tool: "reveal" };
}
function seedParts(f: Fixture, count = 12) {
  const start = Date.now() - 86400000 * count;
  for (let i = 0; i < count; i++) f.db.sqlite.prepare("INSERT INTO dzn_game_reward_ledger VALUES (?, 'local-player', ?, 'recon', ?, 50, 1, ?)")
    .run(randomUUID(), `synthetic:${i}`, randomUUID(), start + i * 86400000);
}

async function run() {
  await test("anonymous access and cross-origin mutations are rejected", async f => {
    assert.equal((await call(f, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(f, { action: "start", mode: "recon" }, { cookie: "" })).status, 401);
    assert.equal((await call(f, { action: "start", mode: "recon" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(f, { action: "start", mode: "recon" }, { origin: "" })).status, 403);
    assert.equal((await call(f, {}, { method: "DELETE" })).status, 405);
  });
  await test("disabled environment fails closed without writes", async f => {
    f.env.DZN_GAMES_HUB_ENABLED = "false";
    assert.equal((await call(f)).status, 503);
    assert.equal((await call(f, { action: "start", mode: "recon" })).status, 503);
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM dzn_game_sessions").get()?.n, 0);
  });
  await test("unapplied migration returns a sanitized unavailable state", async f => {
    const response = await call(f); assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_game_sessions/i);
  }, false);
  await test("Free Discord user starts and resumes without a server, subscription or mine leakage", async f => {
    const data = await payload(await call(f, { action: "start", mode: "recon" }));
    assert.equal(data.game?.cells.flat().length, 100);
    assert.ok(data.game?.cells.flat().every(cell => cell === "hidden"));
    assert.equal(data.summary.xp, 0); assert.equal(data.summary.parts, 0);
    assert.deepEqual((await payload(await call(f))).game, data.game);
    assert.match((await call(f)).headers.get("cache-control")!, /private, no-store/);
    assert.equal((await call(f)).headers.get("vary"), "Cookie");
  });
  await test("another player cannot see or move a board", async f => {
    const move = almostWon(f);
    assert.equal((await call(f, move, { cookie: f.otherCookie })).status, 404);
    const other = await payload(await call(f, undefined, { cookie: f.otherCookie }));
    assert.equal(other.game, null); assert.equal(other.summary.xp, 0); assert.deepEqual(other.summary.history, []);
  });
  await test("invalid shapes, coordinates, forged scores and oversized requests fail", async f => {
    const move = almostWon(f);
    for (const body of [null, [], "start", { action: "award", xp: 100000 }, { action: "start", mode: "__proto__" },
      { ...move, x: -1 }, { ...move, x: 10 }, { ...move, x: 1.5 }, { ...move, tool: "win" }]) assert.equal((await call(f, body)).status, 400);
    assert.equal((await call(f, { long: "x".repeat(2100) })).status, 413);
    assert.equal((await payload(await call(f))).summary.xp, 0);
  });
  await test("board engine preserves mine counts, flags, bounded flood-fill and safe first reveal", async f => {
    for (const mode of Object.keys(GAME_MODES) as GameMode[]) for (let attempt = 0; attempt < 15; attempt++) {
      const board = createGameBoard(mode), size = board.length;
      assert.equal(board.flat().filter(hasMine).length, GAME_MODES[mode].mines);
      const mine = board.flat().findIndex(hasMine);
      const row = { id: randomUUID(), user_id: "local-player", mode, board_json: JSON.stringify(board), status: "playing", version: 0, started_at: Date.now(), updated_at: Date.now() } as GameRow;
      const result = moveGame(row, mine % size, Math.floor(mine / size), "reveal")!;
      assert.notEqual(result.status, "lost"); assert.equal(result.board.flat().filter(hasMine).length, GAME_MODES[mode].mines);
      assert.ok(result.board.flat().filter(hasMine).every(cell => !isRevealed(cell)));
      const hiddenView = gameView({ ...row, board_json: JSON.stringify(result.board), status: result.status }, Date.now());
      assert.ok(hiddenView.cells.flat().every(cell => cell !== "mine"));
      assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM dzn_game_reward_ledger").get()?.n, 0);
    }
    const board = createGameBoard("recon"); board[0][0] = setHasFlag(board[0][0], true);
    const row = { mode: "recon", status: "playing", board_json: JSON.stringify(board) } as GameRow;
    assert.equal(moveGame(row, 0, 0, "reveal"), null);
    assert.equal(hasFlag(moveGame(row, 0, 0, "flag")!.board[0][0]), false);
  });
  await test("verified victory grants once; duplicate, replay and second daily win grant nothing extra", async f => {
    const move = almostWon(f);
    const won = await payload(await call(f, move));
    assert.equal(won.game?.status, "won"); assert.equal(won.summary.xp, 50); assert.equal(won.summary.parts, 1);
    assert.deepEqual(won.summary.today, ["recon"]);
    assert.equal((await call(f, move)).status, 409);
    const second = await payload(await call(f, almostWon(f)));
    assert.equal(second.summary.xp, 50); assert.equal(second.summary.history.length, 1);
  });
  await test("all daily difficulties award the exact cap", async f => {
    for (const mode of Object.keys(GAME_MODES) as GameMode[]) await payload(await call(f, almostWon(f, mode)));
    const result = await payload(await call(f));
    assert.equal(result.summary.xp, 300); assert.equal(result.summary.parts, 6); assert.equal(result.summary.today.length, 3);
  });
  await test("lost, expired, stale and excessive-version games cannot earn", async f => {
    const move = almostWon(f);
    assert.equal((await call(f, { ...move, version: 2 })).status, 409);
    const row = f.db.sqlite.prepare("SELECT * FROM dzn_game_sessions").get()!;
    const board = JSON.parse(row.board_json as string) as number[][];
    const mine = board.flat().findIndex(hasMine);
    const lost = await payload(await call(f, { ...move, x: mine % 10, y: Math.floor(mine / 10) }));
    assert.equal(lost.game?.status, "lost"); assert.equal(lost.summary.xp, 0);
    const expired = almostWon(f, "recon", Date.now() - 1800001);
    assert.equal((await payload(await call(f))).game?.status, "expired");
    assert.equal((await call(f, expired)).status, 409);
    f.db.sqlite.exec(`UPDATE dzn_game_sessions SET started_at = ${Date.now()}, version = 2000`);
    assert.equal((await call(f, { ...expired, version: 2000 })).status, 409);
  });
  await test("stale transaction cannot overwrite a newer move or mint a reward", async f => {
    const move = almostWon(f);
    f.db.beforeBatch = () => { f.db.beforeBatch = null; f.db.sqlite.exec("UPDATE dzn_game_sessions SET version = version + 1"); };
    assert.equal((await call(f, move)).status, 409);
    assert.equal((await payload(await call(f))).summary.xp, 0);
  });
  await test("reward failure rolls back the winning board too", async f => {
    const move = almostWon(f);
    f.db.sqlite.exec("CREATE TRIGGER fail_reward BEFORE INSERT ON dzn_game_reward_ledger BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    assert.equal((await call(f, move)).status, 503);
    const state = await payload(await call(f)); assert.equal(state.game?.version, 7); assert.equal(state.game?.status, "playing");
  });
  await test("a concurrent completed board cannot award a second day from a rejected move", async f => {
    const move = almostWon(f);
    f.db.beforeBatch = () => {
      f.db.beforeBatch = null;
      f.db.sqlite.exec("UPDATE dzn_game_sessions SET status = 'won', version = 8");
      f.db.sqlite.prepare("INSERT INTO dzn_game_reward_ledger VALUES (?, 'local-player', 'previous-day:recon', 'recon', ?, 50, 1, ?)")
        .run(randomUUID(), move.gameId, Date.now() - 86400000);
    };
    assert.equal((await call(f, move)).status, 409);
    const state = await payload(await call(f));
    assert.equal(state.summary.xp, 50); assert.equal(state.summary.parts, 1); assert.equal(state.summary.history.length, 1);
    assert.deepEqual(state.summary.today, []);
  });
  await test("workshop has no debt, retries are idempotent, and prestige preserves XP", async f => {
    const requestId = randomUUID();
    assert.equal((await call(f, { action: "assemble", requestId })).status, 409);
    seedParts(f, 36);
    const first = await payload(await call(f, { action: "assemble", requestId }));
    assert.equal(first.summary.parts, 24); assert.equal(first.summary.assemblies, 1);
    assert.equal((await payload(await call(f, { action: "assemble", requestId }))).summary.parts, 24);
    for (let i = 0; i < 2; i++) await payload(await call(f, { action: "assemble", requestId: randomUUID() }));
    const final = await payload(await call(f)); assert.equal(final.summary.parts, 0); assert.equal(final.summary.assemblies, 3); assert.equal(final.summary.xp, 1800);
    assert.equal((await call(f, { action: "assemble", requestId: randomUUID() })).status, 409);
  });
  await test("streak spans days, expires after a gap, and never deletes progress", async f => {
    seedParts(f, 4);
    assert.equal((await payload(await call(f))).summary.streak, 4);
    f.db.sqlite.exec("UPDATE dzn_game_reward_ledger SET created_at = created_at - 86400000");
    const state = await payload(await call(f)); assert.equal(state.summary.streak, 0); assert.equal(state.summary.parts, 4);
  });
  await test("rapid board creation is limited and only one current board is kept", async f => {
    await payload(await call(f, { action: "start", mode: "recon" }));
    assert.equal((await call(f, { action: "start", mode: "survival" })).status, 429);
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM dzn_game_sessions").get()?.n, 1);
  });

  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const sql = readFileSync("migrations/0070_games_hub.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of sql.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    await db.prepare("INSERT INTO dzn_game_sessions VALUES ('local-player', 'game', 'recon', '[]', 'playing', 0, 0, 0)").run();
    const results = await db.batch([
      db.prepare("UPDATE dzn_game_sessions SET status = 'won', version = 1 WHERE user_id = 'local-player' AND version = 0"),
      db.prepare(`INSERT INTO dzn_game_reward_ledger SELECT 'reward', 'local-player', 'day:recon', 'recon', 'game', 50, 1, 0
        WHERE changes() = 1 AND EXISTS (SELECT 1 FROM dzn_game_sessions WHERE user_id = 'local-player' AND version = 1 AND status = 'won') ON CONFLICT(user_id, reward_key) DO NOTHING`),
    ]);
    assert.equal(results[0].meta.changes, 1); assert.equal(results[1].meta.changes, 1);
    const rejected = await db.batch([
      db.prepare("UPDATE dzn_game_sessions SET status = 'won', version = 1 WHERE user_id = 'local-player' AND version = 0"),
      db.prepare(`INSERT INTO dzn_game_reward_ledger SELECT 'rejected', 'local-player', 'next-day:recon', 'recon', 'game', 50, 1, 1
        WHERE changes() = 1 AND EXISTS (SELECT 1 FROM dzn_game_sessions WHERE user_id = 'local-player' AND version = 1 AND status = 'won') ON CONFLICT(user_id, reward_key) DO NOTHING`),
    ]);
    assert.equal(rejected[0].meta.changes, 0); assert.equal(rejected[1].meta.changes, 0);
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    passed++; console.log("PASS actual local D1 migration and atomic verified-reward batch");
  } finally { await mf.dispose(); }
  console.log(`${passed} Games Hub checks passed.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
