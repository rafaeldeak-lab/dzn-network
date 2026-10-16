import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { eraseOrRetainAccountUser } from "../functions/_lib/deletion";
import { handleGamesHub } from "../functions/_lib/games-hub";
import { handleGamesRelayRush } from "../functions/_lib/games-relay-rush";
import type { Env } from "../functions/_lib/types";
import { RELAY_RUSH_LANES, RELAY_RUSH_PULSE_INTERVAL_MS, RELAY_RUSH_REWARD, RELAY_RUSH_START_DELAY_MS, relayRushPulseWindowMs, type RelayRushPayload } from "../lib/games-relay-rush";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof relayRushFixture>>;
let passed = 0;

async function relayRushFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0096_games_hub_relay_rush.sql", "utf8"));
  (fixture.env as Env).DZN_GAMES_RELAY_RUSH_ENABLED = "true";
  return fixture;
}
async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await relayRushFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}
function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesRelayRush(new Request("https://local.test/api/games/relay-rush", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}
async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<RelayRushPayload>;
}
async function start(fixture: Fixture) { return payload(await call(fixture, { action: "start" })); }
function readyForPulse(fixture: Fixture) {
  const row = fixture.db.sqlite.prepare("SELECT current_index FROM dzn_relay_rush_sessions").get();
  const now = Date.now();
  fixture.db.sqlite.prepare("UPDATE dzn_relay_rush_sessions SET started_at = ?, updated_at = ?")
    .run(now - RELAY_RUSH_START_DELAY_MS - Number(row?.current_index ?? 0) * RELAY_RUSH_PULSE_INTERVAL_MS, now - RELAY_RUSH_PULSE_INTERVAL_MS);
}
function pulse(state: RelayRushPayload, lane = state.game?.nextLane) {
  assert.ok(state.game && lane);
  return { action: "pulse", gameId: state.game.id, version: state.game.version, lane };
}
function wrongLane(state: RelayRushPayload) {
  const lane = RELAY_RUSH_LANES.find(candidate => candidate !== state.game?.nextLane);
  assert.ok(lane);
  return lane;
}

async function finishRun(fixture: Fixture, state: RelayRushPayload) {
  while (state.game?.status === "playing") {
    readyForPulse(fixture);
    state = await payload(await call(fixture, pulse(state)));
  }
  return state;
}

async function run() {
  await test("authentication, origin, method and feature switches fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_RELAY_RUSH_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_relay_rush_sessions").get()?.count, 0);
  });
  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture); assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_relay_rush/i);
  }, false);
  await test("reading is mutation-free and a run discloses only one next lane", async fixture => {
    assert.equal((await payload(await call(fixture))).game, null);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_relay_rush_sessions").get()?.count, 0);
    const state = await start(fixture);
    assert.equal(state.game?.totalPulses, 12); assert.equal(state.game?.pulsesCleared, 0);
    assert.ok(state.game?.nextLane && RELAY_RUSH_LANES.includes(state.game.nextLane));
    assert.equal(JSON.stringify(state).includes("route_json"), false);
  });
  await test("strict request validation rejects forged shapes, lanes and reward values", async fixture => {
    const state = await start(fixture);
    for (const body of [null, [], { action: "start", reward: 999 }, { action: "pulse" },
      { ...pulse(state), lane: "north" }, { ...pulse(state), reward: RELAY_RUSH_REWARD.xp }, { action: "pulse", gameId: state.game!.id, lane: state.game!.nextLane }]) {
      assert.equal((await call(fixture, body)).status, 400);
    }
  });
  await test("pulse timing is server-owned and early input is rejected without progress", async fixture => {
    const state = await start(fixture);
    assert.equal((await call(fixture, pulse(state))).status, 429);
    const row = fixture.db.sqlite.prepare("SELECT current_index, misses, version FROM dzn_relay_rush_sessions").get();
    assert.equal(row?.current_index, 0); assert.equal(row?.misses, 0); assert.equal(row?.version, 0);
  });
  await test("later relay phases have tighter server-issued deadlines", async fixture => {
    await start(fixture);
    const now = Date.now();
    fixture.db.sqlite.prepare("UPDATE dzn_relay_rush_sessions SET current_index = 5, started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
      .run(now - RELAY_RUSH_START_DELAY_MS - 5 * RELAY_RUSH_PULSE_INTERVAL_MS, now - RELAY_RUSH_PULSE_INTERVAL_MS);
    const overload = await payload(await call(fixture));
    assert.equal(overload.game?.intensity, "overload");
    assert.equal((overload.game?.nextAt ?? 0) + relayRushPulseWindowMs(5) - now, relayRushPulseWindowMs(5));
    fixture.db.sqlite.prepare("UPDATE dzn_relay_rush_sessions SET current_index = 9, started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
      .run(now - RELAY_RUSH_START_DELAY_MS - 9 * RELAY_RUSH_PULSE_INTERVAL_MS, now - RELAY_RUSH_PULSE_INTERVAL_MS);
    const storm = await payload(await call(fixture));
    assert.equal(storm.game?.intensity, "storm");
    assert.equal((storm.game?.nextAt ?? 0) + relayRushPulseWindowMs(9) - now, relayRushPulseWindowMs(9));
  });
  await test("late input cannot compress the server-owned pulse cadence", async fixture => {
    let state = await start(fixture);
    readyForPulse(fixture);
    state = await payload(await call(fixture, pulse(state)));
    assert.equal((await call(fixture, pulse(state))).status, 429);
    readyForPulse(fixture);
    state = await payload(await call(fixture, pulse(state)));
    assert.equal(state.game?.pulsesCleared, 2);
  });
  await test("a pulse after its server-owned window is rejected and cannot earn a reward", async fixture => {
    const state = await start(fixture);
    const now = Date.now();
    fixture.db.sqlite.prepare("UPDATE dzn_relay_rush_sessions SET started_at = ?, updated_at = ?")
      .run(now - RELAY_RUSH_START_DELAY_MS - RELAY_RUSH_PULSE_INTERVAL_MS - 100, now - 2 * RELAY_RUSH_PULSE_INTERVAL_MS - 100);
    assert.equal((await call(fixture, pulse(state))).status, 409);
    const refreshed = await payload(await call(fixture));
    assert.equal(refreshed.game?.status, "expired");
    assert.equal(refreshed.game?.pulsesCleared, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_relay_rush_reward_ledger").get()?.count, 0);
  });
  await test("twelve valid server-timed pulses award one bounded daily reward", async fixture => {
    const won = await finishRun(fixture, await start(fixture));
    assert.equal(won.game?.status, "won"); assert.equal(won.game?.pulsesCleared, 12);
    assert.equal(won.rewardGranted, true); assert.equal(won.rewardedToday, true);
    const reward = fixture.db.sqlite.prepare("SELECT xp, parts FROM dzn_relay_rush_reward_ledger").get();
    assert.equal(reward?.xp, RELAY_RUSH_REWARD.xp); assert.equal(reward?.parts, RELAY_RUSH_REWARD.parts);
    fixture.db.sqlite.exec("UPDATE dzn_relay_rush_sessions SET started_at = started_at - 6000");
    const practice = await finishRun(fixture, await start(fixture));
    assert.equal(practice.game?.status, "won"); assert.equal(practice.rewardGranted, false);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_relay_rush_reward_ledger").get()?.count, 1);
  });
  await test("three missed pulses fail the run without minting a reward", async fixture => {
    let state = await start(fixture);
    for (let index = 0; index < 3; index++) { readyForPulse(fixture); state = await payload(await call(fixture, pulse(state, wrongLane(state)))); }
    assert.equal(state.game?.status, "failed"); assert.equal(state.game?.misses, 3);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_relay_rush_reward_ledger").get()?.count, 0);
  });
  await test("a stale pulse cannot overwrite progress or mint a reward", async fixture => {
    const state = await start(fixture); readyForPulse(fixture);
    fixture.db.beforeBatch = () => { fixture.db.beforeBatch = null; fixture.db.sqlite.exec("UPDATE dzn_relay_rush_sessions SET version = version + 1"); };
    assert.equal((await call(fixture, pulse(state))).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT current_index FROM dzn_relay_rush_sessions").get()?.current_index, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_relay_rush_reward_ledger").get()?.count, 0);
  });
  await test("the Hub preserves Relay Rush rewards after its play flag is disabled", async fixture => {
    await finishRun(fixture, await start(fixture));
    const yesterday = Date.now() - 86_400_000;
    fixture.db.sqlite.prepare(`INSERT INTO dzn_relay_rush_reward_ledger
      (id, user_id, reward_key, game_id, xp, parts, created_at) VALUES (?, 'local-player', ?, ?, 90, 3, ?)`)
      .run(randomUUID(), new Date(yesterday).toISOString().slice(0, 10), randomUUID(), yesterday);
    fixture.env.DZN_GAMES_RELAY_RUSH_ENABLED = "false";
    const response = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    const hub = await response.json() as { summary: { xp: number; parts: number; streak: number; history: Array<{ kind: string }> } };
    assert.equal(hub.summary.xp, 180); assert.equal(hub.summary.parts, 6); assert.equal(hub.summary.streak, 2);
    assert.ok(hub.summary.history.some(entry => entry.kind === "relay-rush"));
  });
  await test("account deletion cascades private Relay Rush state and rewards", async fixture => {
    await finishRun(fixture, await start(fixture));
    assert.equal(await eraseOrRetainAccountUser(fixture.env.DB, "local-player"), 1);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM users WHERE id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_relay_rush_sessions WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_relay_rush_reward_ledger WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });
  await test("migration constraints reject forged rewards and retain foreign keys", async fixture => {
    assert.throws(() => fixture.db.sqlite.prepare("INSERT INTO dzn_relay_rush_reward_ledger VALUES (?, 'local-player', ?, ?, 999, 99, 0)")
      .run(randomUUID(), randomUUID(), randomUUID()));
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });
  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const migration = readFileSync("migrations/0096_games_hub_relay_rush.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'dzn_relay_rush_%' ORDER BY name").all<{ name: string }>();
    assert.deepEqual(tables.results.map((row: { name: string }) => row.name), ["dzn_relay_rush_reward_ledger", "dzn_relay_rush_sessions"]);
    const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dzn_relay_rush_rewards_history'").all<{ name: string }>();
    assert.equal(indexes.results.length, 1);
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_relay_rush_sessions").first<{ count: number }>())?.count, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_relay_rush_reward_ledger").first<{ count: number }>())?.count, 0);
    passed++; console.log("PASS actual local D1 migration, schema, index, foreign-key and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} DZN Relay Rush checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
