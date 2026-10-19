import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { eraseOrRetainAccountUser } from "../functions/_lib/deletion";
import { handleGamesCircuitForge } from "../functions/_lib/games-circuit-forge";
import { CIRCUIT_FORGE_CANONICAL_MASKS, circuitMasks, isCompleteCircuit, poweredCircuitTiles } from "../functions/_lib/games-circuit-forge-layout";
import { handleGamesHub } from "../functions/_lib/games-hub";
import type { Env } from "../functions/_lib/types";
import { CIRCUIT_FORGE_MAX_ROTATIONS, CIRCUIT_FORGE_REWARD, CIRCUIT_FORGE_TTL_MS, type CircuitForgePayload } from "../lib/games-circuit-forge";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof circuitForgeFixture>>;
let passed = 0;

async function circuitForgeFixture(migrate = true, gridControlSchema = false, gridControlEnabled = gridControlSchema) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0101_games_hub_circuit_forge.sql", "utf8"));
  if (gridControlSchema) fixture.db.sqlite.exec(readFileSync("migrations/0111_games_hub_circuit_forge_grid_control.sql", "utf8"));
  (fixture.env as Env).DZN_GAMES_CIRCUIT_FORGE_ENABLED = "true";
  (fixture.env as Env).DZN_GAMES_CIRCUIT_FORGE_GRID_CONTROL_ENABLED = gridControlEnabled ? "true" : "false";
  return fixture;
}

async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await circuitForgeFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}

async function gridControlTest(name: string, action: (fixture: Fixture) => Promise<void>, enabled = true) {
  const fixture = await circuitForgeFixture(true, true, enabled);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}

function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesCircuitForge(new Request("https://local.test/api/games/circuit-forge", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}

async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<CircuitForgePayload>;
}

async function start(fixture: Fixture) { return payload(await call(fixture, { action: "start" })); }

function settle(fixture: Fixture) {
  fixture.db.sqlite.prepare("UPDATE dzn_circuit_forge_sessions SET updated_at = ? WHERE user_id = 'local-player'").run(Date.now() - 1_000);
}

function nearSolvedRotations() {
  return [3, ...Array(24).fill(0)] as number[];
}

function setBoard(fixture: Fixture, rotations = nearSolvedRotations(), count = 0, version = count) {
  fixture.db.sqlite.prepare("UPDATE dzn_circuit_forge_sessions SET rotations_json = ?, rotations = ?, version = ?, status = 'playing', updated_at = ? WHERE user_id = 'local-player'")
    .run(JSON.stringify(rotations), count, version, Date.now() - 1_000);
}

function command(state: CircuitForgePayload, index = 0) {
  assert.ok(state.game);
  return { action: "rotate", gameId: state.game.id, version: state.game.version, index };
}

async function winFromNearSolution(fixture: Fixture) {
  setBoard(fixture);
  const state = await payload(await call(fixture));
  return payload(await call(fixture, command(state)));
}

async function run() {
  await test("authentication, origin, method and feature switches fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_CIRCUIT_FORGE_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_circuit_forge_sessions").get()?.count, 0);
  });

  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_circuit_forge/i);
  }, false);

  await test("generated grids are private, non-complete and always have a valid server-side solution", async fixture => {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) fixture.db.sqlite.exec("UPDATE dzn_circuit_forge_sessions SET started_at = started_at - 6000");
      const state = await start(fixture);
      assert.ok(state.game);
      assert.equal(state.game.tiles.length, 25);
      assert.equal(state.game.tiles.filter(tile => tile.core).length, 1);
      assert.equal(state.game.poweredCount < 25, true);
      assert.equal(JSON.stringify(state).includes("rotations_json"), false);
      assert.equal((await call(fixture)).headers.get("cache-control"), "private, no-store");
      assert.equal((await call(fixture)).headers.get("vary"), "Cookie");
      const stored = fixture.db.sqlite.prepare("SELECT rotations_json FROM dzn_circuit_forge_sessions WHERE user_id = 'local-player'").get() as { rotations_json: string };
      const rotations = JSON.parse(stored.rotations_json) as number[];
      assert.equal(rotations.length, 25);
      assert.equal(rotations.filter(Boolean).length >= 12, true);
      assert.equal(isCompleteCircuit(circuitMasks(rotations)), false);
      assert.equal(poweredCircuitTiles(circuitMasks(Array(25).fill(0))).size, 25);
    }
    const other = await payload(await call(fixture, undefined, { cookie: fixture.otherCookie }));
    assert.equal(other.game, null);
  });

  await test("strict request validation rejects forged shapes, core changes and stale rotation attempts", async fixture => {
    const state = await start(fixture);
    for (const body of [null, [], { action: "start", reward: 999 }, { action: "rotate" },
      { ...command(state), version: 1.5 }, { ...command(state), index: 12 }, { ...command(state), index: 25 }, { ...command(state), reward: CIRCUIT_FORGE_REWARD.xp }]) {
      assert.equal((await call(fixture, body)).status, 400);
    }
    assert.equal((await call(fixture, command(state))).status, 429);
    settle(fixture);
    assert.equal((await call(fixture, command(state))).status, 200);
  });

  await gridControlTest("grid controls remain hidden and reject requests while their release flag is off", async fixture => {
    const state = await start(fixture);
    assert.equal(state.game?.gridControlAvailable, false);
    assert.equal((await call(fixture, { action: "diagnose", gameId: state.game?.id, version: state.game?.version })).status, 400);
    assert.equal((await call(fixture, { action: "phase", gameId: state.game?.id, version: state.game?.version, index: 0 })).status, 400);
    const stored = fixture.db.sqlite.prepare("SELECT diagnostic_used, phase_used, diagnostic_index FROM dzn_circuit_forge_sessions WHERE user_id = 'local-player'").get() as { diagnostic_used: number; phase_used: number; diagnostic_index: number | null };
    assert.equal(stored.diagnostic_used, 0);
    assert.equal(stored.phase_used, 0);
    assert.equal(stored.diagnostic_index, null);
  }, false);

  await gridControlTest("the server issues one diagnostic target and one authoritative phase alignment", async fixture => {
    await start(fixture);
    setBoard(fixture, [3, ...Array(24).fill(0)]);
    const state = await payload(await call(fixture));
    assert.equal(state.game?.gridControlAvailable, true);
    assert.equal(state.game?.diagnosticAvailable, true);
    const diagnosed = await payload(await call(fixture, { action: "diagnose", gameId: state.game?.id, version: state.game?.version }));
    assert.equal(diagnosed.game?.diagnosticUsed, true);
    assert.equal(diagnosed.game?.diagnosticIndex, 0);
    assert.equal(diagnosed.game?.phaseAvailable, true);
    assert.equal((await call(fixture, { action: "diagnose", gameId: state.game?.id, version: state.game?.version })).status, 409);
    settle(fixture);
    assert.equal((await call(fixture, { action: "phase", gameId: diagnosed.game?.id, version: diagnosed.game?.version, index: 1 })).status, 409);
    const phased = await payload(await call(fixture, { action: "phase", gameId: diagnosed.game?.id, version: diagnosed.game?.version, index: 0 }));
    assert.equal(phased.game?.phaseUsed, true);
    assert.equal(phased.game?.phaseAvailable, false);
    assert.equal(phased.game?.diagnosticIndex, null);
    assert.equal(phased.game?.rotations, 1);
    assert.equal(phased.game?.status, "won");
    assert.equal((await call(fixture, { action: "phase", gameId: phased.game?.id, version: phased.game?.version, index: 0 })).status, 409);
    assert.equal((await call(fixture, { action: "phase", gameId: phased.game?.id, version: phased.game?.version, index: 12 })).status, 400);
  });

  await gridControlTest("diagnostics skip symmetrically aligned straight relays", async fixture => {
    await start(fixture);
    const straightIndex = CIRCUIT_FORGE_CANONICAL_MASKS.findIndex(mask => mask === 5 || mask === 10);
    assert.notEqual(straightIndex, -1);
    const rotations = Array(25).fill(0);
    rotations[straightIndex] = 2;
    setBoard(fixture, rotations);
    const state = await payload(await call(fixture));
    assert.equal((await call(fixture, { action: "diagnose", gameId: state.game?.id, version: state.game?.version })).status, 409);
    const stored = fixture.db.sqlite.prepare("SELECT diagnostic_used, diagnostic_index FROM dzn_circuit_forge_sessions WHERE user_id = 'local-player'").get() as { diagnostic_used: number; diagnostic_index: number | null };
    assert.equal(stored.diagnostic_used, 0);
    assert.equal(stored.diagnostic_index, null);
  });

  await gridControlTest("a new board clears installed control state before a later re-enable", async fixture => {
    (fixture.env as Env).DZN_GAMES_CIRCUIT_FORGE_GRID_CONTROL_ENABLED = "false";
    await start(fixture);
    fixture.db.sqlite.prepare(`UPDATE dzn_circuit_forge_sessions
      SET diagnostic_used = 1, phase_used = 1, diagnostic_index = 0, started_at = started_at - 6000
      WHERE user_id = 'local-player'`).run();
    await start(fixture);
    (fixture.env as Env).DZN_GAMES_CIRCUIT_FORGE_GRID_CONTROL_ENABLED = "true";
    const refreshed = await payload(await call(fixture));
    assert.equal(refreshed.game?.diagnosticUsed, false);
    assert.equal(refreshed.game?.phaseUsed, false);
    assert.equal(refreshed.game?.diagnosticIndex, null);
  });

  await gridControlTest("a phase alignment can complete a board and uses the normal daily reward ledger", async fixture => {
    await start(fixture);
    setBoard(fixture, [2, ...Array(24).fill(0)]);
    const state = await payload(await call(fixture));
    const diagnosed = await payload(await call(fixture, { action: "diagnose", gameId: state.game?.id, version: state.game?.version }));
    settle(fixture);
    const completed = await payload(await call(fixture, { action: "phase", gameId: diagnosed.game?.id, version: diagnosed.game?.version, index: diagnosed.game?.diagnosticIndex }));
    assert.equal(completed.game?.status, "won");
    assert.equal(completed.game?.phaseUsed, true);
    assert.equal(completed.rewardGranted, true);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_circuit_forge_reward_ledger").get()?.count, 1);
  });

  await gridControlTest("diagnostics do not consume state-version capacity at the rotation cap", async fixture => {
    await start(fixture);
    setBoard(fixture, [2, ...Array(24).fill(0)], CIRCUIT_FORGE_MAX_ROTATIONS - 1);
    const state = await payload(await call(fixture));
    assert.equal(state.game?.version, CIRCUIT_FORGE_MAX_ROTATIONS - 1);
    const diagnosed = await payload(await call(fixture, { action: "diagnose", gameId: state.game?.id, version: state.game?.version }));
    assert.equal(diagnosed.game?.version, CIRCUIT_FORGE_MAX_ROTATIONS - 1);
    settle(fixture);
    const failed = await payload(await call(fixture, { action: "rotate", gameId: diagnosed.game?.id, version: diagnosed.game?.version, index: 0 }));
    assert.equal(failed.game?.status, "failed");
    assert.equal(failed.game?.version, CIRCUIT_FORGE_MAX_ROTATIONS);
    assert.equal((await call(fixture)).status, 200);
  });

  await test("server-validated rotations, complete state and daily reward cap apply exactly", async fixture => {
    await start(fixture);
    const won = await winFromNearSolution(fixture);
    assert.equal(won.game?.status, "won");
    assert.equal(won.game?.poweredCount, 25);
    assert.equal(won.rewardGranted, true);
    const reward = fixture.db.sqlite.prepare("SELECT xp, parts FROM dzn_circuit_forge_reward_ledger").get();
    assert.equal(reward?.xp, CIRCUIT_FORGE_REWARD.xp);
    assert.equal(reward?.parts, CIRCUIT_FORGE_REWARD.parts);
    fixture.db.sqlite.exec("UPDATE dzn_circuit_forge_sessions SET started_at = started_at - 6000");
    await start(fixture);
    const practice = await winFromNearSolution(fixture);
    assert.equal(practice.game?.status, "won");
    assert.equal(practice.rewardGranted, false);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_circuit_forge_reward_ledger").get()?.count, 1);
  });

  await test("rotation cap, expiry and a concurrent stale command cannot mint a reward", async fixture => {
    await start(fixture);
    setBoard(fixture, [2, ...Array(24).fill(0)], CIRCUIT_FORGE_MAX_ROTATIONS - 1);
    let state = await payload(await call(fixture));
    const final = await payload(await call(fixture, command(state)));
    assert.equal(final.game?.status, "failed");
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_circuit_forge_reward_ledger").get()?.count, 0);
    fixture.db.sqlite.exec("UPDATE dzn_circuit_forge_sessions SET started_at = started_at - 6000");
    state = await start(fixture);
    fixture.db.sqlite.prepare("UPDATE dzn_circuit_forge_sessions SET started_at = ?, updated_at = ? WHERE user_id = 'local-player'").run(Date.now() - CIRCUIT_FORGE_TTL_MS, Date.now() - 1_000);
    assert.equal((await call(fixture, command(state))).status, 409);
    fixture.db.sqlite.exec("UPDATE dzn_circuit_forge_sessions SET started_at = started_at - 6000");
    state = await start(fixture);
    settle(fixture);
    fixture.db.beforeBatch = () => { fixture.db.beforeBatch = null; fixture.db.sqlite.exec("UPDATE dzn_circuit_forge_sessions SET version = version + 1"); };
    assert.equal((await call(fixture, command(state))).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_circuit_forge_reward_ledger").get()?.count, 0);
  });

  await test("a reward failure rolls back the finishing rotation", async fixture => {
    await start(fixture);
    setBoard(fixture);
    const before = await payload(await call(fixture));
    fixture.db.sqlite.exec("CREATE TRIGGER fail_circuit_forge_reward BEFORE INSERT ON dzn_circuit_forge_reward_ledger BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    assert.equal((await call(fixture, command(before))).status, 503);
    const restored = await payload(await call(fixture));
    assert.equal(restored.game?.status, "playing");
    assert.equal(restored.game?.rotations, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_circuit_forge_reward_ledger").get()?.count, 0);
  });

  await test("the Hub retains Circuit Forge rewards after its play flag is disabled", async fixture => {
    await start(fixture);
    const state = await winFromNearSolution(fixture);
    assert.equal(state.rewardGranted, true);
    const yesterday = Date.now() - 86_400_000;
    fixture.db.sqlite.prepare(`INSERT INTO dzn_circuit_forge_reward_ledger
      (id, user_id, reward_key, game_id, xp, parts, created_at) VALUES (?, 'local-player', ?, ?, 140, 7, ?)`)
      .run(randomUUID(), new Date(yesterday).toISOString().slice(0, 10), randomUUID(), yesterday);
    fixture.env.DZN_GAMES_CIRCUIT_FORGE_ENABLED = "false";
    const response = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    const hub = await response.json() as { summary: { xp: number; parts: number; streak: number; history: Array<{ kind: string }> } };
    assert.equal(hub.summary.xp, 280);
    assert.equal(hub.summary.parts, 14);
    assert.equal(hub.summary.streak, 2);
    assert.ok(hub.summary.history.some(entry => entry.kind === "circuit-forge"));
  });

  await test("account deletion cascades private Circuit Forge sessions and rewards", async fixture => {
    await start(fixture);
    await winFromNearSolution(fixture);
    assert.equal(await eraseOrRetainAccountUser(fixture.env.DB, "local-player"), 1);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_circuit_forge_sessions WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_circuit_forge_reward_ledger WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });

  await test("migration constraints reject forged rewards and retain foreign keys", async fixture => {
    assert.throws(() => fixture.db.sqlite.prepare("INSERT INTO dzn_circuit_forge_reward_ledger VALUES (?, 'local-player', ?, ?, 999, 99, 0)")
      .run(randomUUID(), randomUUID(), randomUUID()));
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });

  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const migrations = ["migrations/0101_games_hub_circuit_forge.sql", "migrations/0111_games_hub_circuit_forge_grid_control.sql"];
    for (const path of migrations) {
      const migration = readFileSync(path, "utf8").replace(/^--.*$/gm, "");
      for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'dzn_circuit_forge_%' ORDER BY name").all<{ name: string }>();
    assert.deepEqual(tables.results.map((row: { name: string }) => row.name), ["dzn_circuit_forge_reward_ledger", "dzn_circuit_forge_sessions"]);
    const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dzn_circuit_forge_rewards_history'").all<{ name: string }>();
    assert.equal(indexes.results.length, 1);
    const controlIndex = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dzn_circuit_forge_grid_control'").all<{ name: string }>();
    assert.equal(controlIndex.results.length, 1);
    const columns = await db.prepare("PRAGMA table_info(dzn_circuit_forge_sessions)").all<{ name: string }>();
    const controlColumns = (columns.results as Array<{ name: string }>)
      .filter((row: { name: string }) => ["diagnostic_used", "phase_used", "diagnostic_index"].includes(row.name))
      .map((row: { name: string }) => row.name);
    assert.deepEqual(controlColumns, ["diagnostic_used", "phase_used", "diagnostic_index"]);
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_circuit_forge_sessions").first<{ count: number }>())?.count, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_circuit_forge_reward_ledger").first<{ count: number }>())?.count, 0);
    passed++; console.log("PASS actual local D1 migration, schema, index, foreign-key and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} DZN Circuit Forge checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
