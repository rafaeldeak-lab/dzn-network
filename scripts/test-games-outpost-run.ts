import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { eraseOrRetainAccountUser } from "../functions/_lib/deletion";
import { handleGamesHub } from "../functions/_lib/games-hub";
import { handleGamesOutpostRun } from "../functions/_lib/games-outpost-run";
import type { Env } from "../functions/_lib/types";
import { OUTPOST_RUN_MAX_ENERGY, OUTPOST_RUN_MAX_MOVES, OUTPOST_RUN_REWARD, OUTPOST_RUN_TTL_MS, type OutpostRunDirection, type OutpostRunPayload } from "../lib/games-outpost-run";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof outpostFixture>>;
type Coordinate = { row: number; column: number };
type Layout = { target: Coordinate; hazards: Coordinate[]; beacon?: Coordinate; beaconSecured?: boolean };
let passed = 0;

async function outpostFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0099_games_hub_outpost_run.sql", "utf8"));
  (fixture.env as Env).DZN_GAMES_OUTPOST_RUN_ENABLED = "true";
  return fixture;
}

async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await outpostFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}

function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesOutpostRun(new Request("https://local.test/api/games/outpost-run", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}

async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<OutpostRunPayload>;
}

async function start(fixture: Fixture) { return payload(await call(fixture, { action: "start" })); }

function layoutFor(fixture: Fixture): Layout {
  const row = fixture.db.sqlite.prepare("SELECT layout_json FROM dzn_outpost_run_sessions WHERE user_id = 'local-player'").get();
  if (typeof row?.layout_json !== "string") throw new Error("Expected a private Outpost Run layout in the local fixture");
  return JSON.parse(row.layout_json) as Layout;
}

function settle(fixture: Fixture) {
  fixture.db.sqlite.prepare("UPDATE dzn_outpost_run_sessions SET updated_at = ? WHERE user_id = 'local-player'").run(Date.now() - 1_000);
}

function command(state: OutpostRunPayload, action: "scan" | "move", direction?: OutpostRunDirection) {
  assert.ok(state.game);
  return action === "scan" ? { action, gameId: state.game.id, version: state.game.version }
    : { action, gameId: state.game.id, version: state.game.version, direction };
}

function same(left: Coordinate, right: Coordinate) { return left.row === right.row && left.column === right.column; }

function safePath(start: Coordinate, target: Coordinate, hazards: Coordinate[]): OutpostRunDirection[] {
  const directions: Array<[OutpostRunDirection, number, number]> = [["north", -1, 0], ["east", 0, 1], ["south", 1, 0], ["west", 0, -1]];
  const queue: Array<{ cell: Coordinate; path: OutpostRunDirection[] }> = [{ cell: start, path: [] }];
  const seen = new Set([`${start.row}:${start.column}`]);
  while (queue.length) {
    const next = queue.shift()!;
    if (same(next.cell, target)) return next.path;
    for (const [direction, deltaRow, deltaColumn] of directions) {
      const cell = { row: next.cell.row + deltaRow, column: next.cell.column + deltaColumn };
      const key = `${cell.row}:${cell.column}`;
      if (cell.row < 0 || cell.row > 4 || cell.column < 0 || cell.column > 4 || seen.has(key) || hazards.some(hazard => same(hazard, cell))) continue;
      seen.add(key); queue.push({ cell, path: [...next.path, direction] });
    }
  }
  throw new Error("Expected a safe path to the relay");
}

async function completeRun(fixture: Fixture, initial: OutpostRunPayload, stopBeforeFinal = false) {
  let state = initial;
  const layout = layoutFor(fixture);
  const beaconPath = layout.beacon ? safePath({ row: 2, column: 2 }, layout.beacon, layout.hazards) : [];
  const relayPath = safePath(layout.beacon ?? { row: 2, column: 2 }, layout.target, layout.hazards);
  const moves = [...beaconPath, ...relayPath];
  const count = stopBeforeFinal ? moves.length - 1 : moves.length;
  for (let index = 0; index < count; index++) {
    settle(fixture);
    state = await payload(await call(fixture, command(state, "move", moves[index])));
  }
  return { state, finalDirection: moves.at(-1)! };
}

async function run() {
  await test("authentication, origin, method and feature switches fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_OUTPOST_RUN_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_outpost_run_sessions").get()?.count, 0);
  });

  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_outpost/i);
  }, false);

  await test("fog view is private, bounded and does not reveal the stored layout", async fixture => {
    assert.equal((await payload(await call(fixture))).game, null);
    let state = await start(fixture);
    assert.equal(state.game?.visibleCells.length, 1);
    assert.equal(JSON.stringify(state).includes("layout_json"), false);
    assert.equal(state.game?.scanHint, null);
    settle(fixture);
    state = await payload(await call(fixture, command(state, "scan")));
    const hint = state.game?.scanHint;
    assert.match(hint ?? "", /north|south|east|west/);
    settle(fixture);
    state = await payload(await call(fixture, command(state, "move", "north")));
    assert.equal(state.game?.scanHint, hint);
    assert.equal(state.game?.scanAvailable, false);
    assert.equal((await call(fixture)).headers.get("cache-control"), "private, no-store");
    assert.equal((await call(fixture)).headers.get("vary"), "Cookie");
  });

  await test("each fresh run generates a bounded private route with a safe extraction path", async fixture => {
    const gameIds = new Set<string>();
    for (let index = 0; index < 12; index++) {
      const state = await start(fixture);
      assert.ok(state.game);
      const layout = layoutFor(fixture);
      assert.equal(state.game.maxEnergy, OUTPOST_RUN_MAX_ENERGY);
      assert.equal(state.game.maxMoves, OUTPOST_RUN_MAX_MOVES);
      assert.equal(layout.hazards.length, 5);
      assert.equal(new Set(layout.hazards.map(hazard => `${hazard.row}:${hazard.column}`)).size, layout.hazards.length);
      assert.ok(Math.abs(layout.target.row - 2) + Math.abs(layout.target.column - 2) >= 4);
      assert.ok(layout.beacon, "Every newly generated tactical run must have a field beacon.");
      const beaconPath = safePath({ row: 2, column: 2 }, layout.beacon!, layout.hazards);
      const relayPath = safePath(layout.beacon!, layout.target, layout.hazards);
      assert.ok(beaconPath.length + relayPath.length >= 6, "The beacon objective must make a fresh run meaningfully longer than a direct relay sprint.");
      assert.ok(beaconPath.length + relayPath.length <= OUTPOST_RUN_MAX_MOVES - 2, "The server must leave a small recovery budget around the protected two-stage route.");
      gameIds.add(state.game.id);
      fixture.db.sqlite.prepare("UPDATE dzn_outpost_run_sessions SET started_at = started_at - 6000 WHERE user_id = 'local-player'").run();
    }
    assert.equal(gameIds.size, 12);
  });

  await test("strict request validation rejects forged shapes, rewards, early movement and repeat scans", async fixture => {
    const state = await start(fixture);
    for (const body of [null, [], { action: "start", reward: 100 }, { action: "move" },
      { ...command(state, "move", "north"), direction: "up" }, { ...command(state, "move", "north"), version: 1.5 },
      { ...command(state, "move", "north"), reward: OUTPOST_RUN_REWARD.xp }]) {
      assert.equal((await call(fixture, body)).status, 400);
    }
    assert.equal((await call(fixture, command(state, "move", "north"))).status, 429);
    settle(fixture);
    const scanned = await payload(await call(fixture, command(state, "scan")));
    settle(fixture);
    assert.equal((await call(fixture, command(scanned, "scan"))).status, 409);
  });

  await test("new tactical runs require the field beacon before the relay and preserve legacy sessions", async fixture => {
    let state = await start(fixture);
    const layout = layoutFor(fixture);
    assert.equal(state.game?.objective, "beacon");
    assert.equal(state.game?.beaconSecured, false);
    assert.ok(layout.beacon);
    for (const direction of safePath({ row: 2, column: 2 }, layout.beacon!, layout.hazards)) {
      settle(fixture);
      state = await payload(await call(fixture, command(state, "move", direction)));
    }
    assert.equal(state.game?.objective, "relay");
    assert.equal(state.game?.beaconSecured, true);
    assert.equal(state.game?.scanAvailable, true, "Reaching the beacon without scanning must preserve the one relay scan.");
    assert.ok(state.game?.visibleCells.some(cell => cell.kind === "beacon"), "Only the entered beacon cell may become visible to the browser.");

    settle(fixture);
    state = await payload(await call(fixture, command(state, "scan")));
    assert.match(state.game?.scanHint ?? "", /north|south|east|west|relay acquired/, "An unused scanner spent after the beacon must return a relay bearing.");
    assert.equal(state.game?.scanAvailable, false);

    fixture.db.sqlite.prepare("UPDATE dzn_outpost_run_sessions SET layout_json = ? WHERE user_id = 'local-player'")
      .run(JSON.stringify({ target: layout.target, hazards: layout.hazards }));
    const legacy = await payload(await call(fixture));
    assert.equal(legacy.game?.objective, "relay", "Existing sessions without a beacon must remain playable as direct relay runs.");
    assert.equal(legacy.game?.beaconSecured, false);
  });

  await test("server-owned layout, hazards, extraction and daily reward cap apply exactly", async fixture => {
    let state = await start(fixture);
    const first = await completeRun(fixture, state);
    state = first.state;
    assert.equal(state.game?.status, "won");
    assert.equal(state.rewardGranted, true);
    const reward = fixture.db.sqlite.prepare("SELECT xp, parts FROM dzn_outpost_run_reward_ledger").get();
    assert.equal(reward?.xp, OUTPOST_RUN_REWARD.xp);
    assert.equal(reward?.parts, OUTPOST_RUN_REWARD.parts);
    fixture.db.sqlite.exec("UPDATE dzn_outpost_run_sessions SET started_at = started_at - 6000");
    state = await start(fixture);
    state = (await completeRun(fixture, state)).state;
    assert.equal(state.game?.status, "won");
    assert.equal(state.rewardGranted, false);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_outpost_run_reward_ledger").get()?.count, 1);
  });

  await test("hazard depletion fails a run without minting a reward", async fixture => {
    let state = await start(fixture);
    const layout = layoutFor(fixture);
    const hazard = layout.hazards[0];
    const path = safePath({ row: 2, column: 2 }, hazard, layout.hazards.filter(item => !same(item, hazard)));
    fixture.db.sqlite.prepare("UPDATE dzn_outpost_run_sessions SET energy = 1 WHERE user_id = 'local-player'").run();
    for (const direction of path) {
      settle(fixture);
      state = await payload(await call(fixture, command(state, "move", direction)));
    }
    assert.equal(state.game?.status, "failed");
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_outpost_run_reward_ledger").get()?.count, 0);
  });

  await test("another player cannot inspect or move a private expedition", async fixture => {
    const state = await start(fixture);
    settle(fixture);
    assert.equal((await call(fixture, command(state, "move", "north"), { cookie: fixture.otherCookie })).status, 404);
    const other = await payload(await call(fixture, undefined, { cookie: fixture.otherCookie }));
    assert.equal(other.game, null);
  });

  await test("expired and stale commands cannot overwrite progress or mint rewards", async fixture => {
    let state = await start(fixture);
    fixture.db.sqlite.prepare("UPDATE dzn_outpost_run_sessions SET started_at = ?, updated_at = ?").run(Date.now() - OUTPOST_RUN_TTL_MS, Date.now() - 1_000);
    assert.equal((await call(fixture, command(state, "move", "north"))).status, 409);
    fixture.db.sqlite.exec("UPDATE dzn_outpost_run_sessions SET started_at = started_at - 6000");
    state = await start(fixture);
    settle(fixture);
    fixture.db.beforeBatch = () => { fixture.db.beforeBatch = null; fixture.db.sqlite.exec("UPDATE dzn_outpost_run_sessions SET version = version + 1"); };
    assert.equal((await call(fixture, command(state, "move", "north"))).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_outpost_run_reward_ledger").get()?.count, 0);
  });

  await test("a reward write failure rolls back the final extraction movement", async fixture => {
    const initial = await start(fixture);
    const beforeFinal = await completeRun(fixture, initial, true);
    fixture.db.sqlite.exec("CREATE TRIGGER fail_outpost_reward BEFORE INSERT ON dzn_outpost_run_reward_ledger BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    settle(fixture);
    assert.equal((await call(fixture, command(beforeFinal.state, "move", beforeFinal.finalDirection))).status, 503);
    const restored = await payload(await call(fixture));
    assert.equal(restored.game?.status, "playing");
    assert.equal(restored.game?.moves, beforeFinal.state.game?.moves);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_outpost_run_reward_ledger").get()?.count, 0);
  });

  await test("the Hub retains Outpost Run rewards after its play flag is disabled", async fixture => {
    const state = (await completeRun(fixture, await start(fixture))).state;
    assert.equal(state.rewardGranted, true);
    const yesterday = Date.now() - 86_400_000;
    fixture.db.sqlite.prepare(`INSERT INTO dzn_outpost_run_reward_ledger
      (id, user_id, reward_key, game_id, xp, parts, created_at) VALUES (?, 'local-player', ?, ?, 125, 6, ?)`)
      .run(randomUUID(), new Date(yesterday).toISOString().slice(0, 10), randomUUID(), yesterday);
    fixture.env.DZN_GAMES_OUTPOST_RUN_ENABLED = "false";
    const response = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    const hub = await response.json() as { summary: { xp: number; parts: number; streak: number; history: Array<{ kind: string }> } };
    assert.equal(hub.summary.xp, 250);
    assert.equal(hub.summary.parts, 12);
    assert.equal(hub.summary.streak, 2);
    assert.ok(hub.summary.history.some(entry => entry.kind === "outpost-run"));
  });

  await test("account deletion cascades private expeditions and rewards", async fixture => {
    await completeRun(fixture, await start(fixture));
    assert.equal(await eraseOrRetainAccountUser(fixture.env.DB, "local-player"), 1);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_outpost_run_sessions WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_outpost_run_reward_ledger WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });

  await test("migration constraints reject forged rewards and retain foreign keys", async fixture => {
    assert.throws(() => fixture.db.sqlite.prepare("INSERT INTO dzn_outpost_run_reward_ledger VALUES (?, 'local-player', ?, ?, 999, 99, 0)")
      .run(randomUUID(), randomUUID(), randomUUID()));
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });

  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const migration = readFileSync("migrations/0099_games_hub_outpost_run.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'dzn_outpost_run_%' ORDER BY name").all<{ name: string }>();
    assert.deepEqual(tables.results.map((row: { name: string }) => row.name), ["dzn_outpost_run_reward_ledger", "dzn_outpost_run_sessions"]);
    const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dzn_outpost_run_rewards_history'").all<{ name: string }>();
    assert.equal(indexes.results.length, 1);
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_outpost_run_sessions").first<{ count: number }>())?.count, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_outpost_run_reward_ledger").first<{ count: number }>())?.count, 0);
    passed++; console.log("PASS actual local D1 migration, schema, index, foreign-key and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} DZN Outpost Run checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
