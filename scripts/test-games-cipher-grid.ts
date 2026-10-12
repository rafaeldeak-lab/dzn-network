import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { eraseOrRetainAccountUser } from "../functions/_lib/deletion";
import { handleGamesCipherGrid, markCipherGridGuess } from "../functions/_lib/games-cipher-grid";
import { handleGamesHub } from "../functions/_lib/games-hub";
import type { Env } from "../functions/_lib/types";
import { CIPHER_GRID_REWARD, CIPHER_GRID_TTL_MS, type CipherGridPayload } from "../lib/games-cipher-grid";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof cipherGridFixture>>;
let passed = 0;

async function cipherGridFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0097_games_hub_cipher_grid.sql", "utf8"));
  (fixture.env as Env).DZN_GAMES_CIPHER_GRID_ENABLED = "true";
  return fixture;
}

async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await cipherGridFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}

function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesCipherGrid(new Request("https://local.test/api/games/cipher-grid", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}

async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<CipherGridPayload>;
}

async function start(fixture: Fixture) { return payload(await call(fixture, { action: "start" })); }

function answerFor(fixture: Fixture) {
  const answer = fixture.db.sqlite.prepare("SELECT answer FROM dzn_cipher_grid_sessions WHERE user_id = 'local-player'").get()?.answer;
  if (typeof answer !== "string") throw new Error("Expected a private Cipher Grid answer in the local fixture");
  return answer;
}

function guess(state: CipherGridPayload, word: string) {
  assert.ok(state.game);
  return { action: "guess", gameId: state.game.id, version: state.game.version, guess: word };
}

async function run() {
  await test("authentication, origin, method and feature switches fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_CIPHER_GRID_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_sessions").get()?.count, 0);
  });

  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_cipher_grid/i);
  }, false);

  await test("reading is mutation-free and never reveals the server-held answer", async fixture => {
    assert.equal((await payload(await call(fixture))).game, null);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_sessions").get()?.count, 0);
    const state = await start(fixture);
    assert.equal(state.game?.attempts.length, 0);
    assert.equal(state.game?.answerLength, 5);
    assert.equal(JSON.stringify(state).includes('"answer"'), false);
    assert.match((await call(fixture)).headers.get("cache-control")!, /private, no-store/);
    assert.equal((await call(fixture)).headers.get("vary"), "Cookie");
  });

  await test("strict request validation rejects forged shapes, values and reward fields", async fixture => {
    const state = await start(fixture);
    for (const body of [null, [], { action: "start", reward: 100 }, { action: "guess" },
      { ...guess(state, "CACHE"), guess: "cache" }, { ...guess(state, "CACHE"), guess: "AB12E" },
      { ...guess(state, "CACHE"), guess: "CACH" }, { ...guess(state, "CACHE"), version: 1.5 },
      { ...guess(state, "CACHE"), reward: CIPHER_GRID_REWARD.xp }]) {
      assert.equal((await call(fixture, body)).status, 400);
    }
  });

  await test("duplicate-aware letter scoring marks only the available copies", async () => {
    assert.deepEqual(markCipherGridGuess("SHELL", "LEECH"), ["present", "absent", "correct", "absent", "present"]);
  });

  await test("only the exact server answer wins and grants one bounded daily reward", async fixture => {
    let state = await start(fixture);
    const answer = answerFor(fixture);
    state = await payload(await call(fixture, guess(state, answer)));
    assert.equal(state.game?.status, "won");
    assert.equal(state.rewardGranted, true);
    assert.equal(state.rewardedToday, true);
    const reward = fixture.db.sqlite.prepare("SELECT xp, parts FROM dzn_cipher_grid_reward_ledger").get();
    assert.equal(reward?.xp, CIPHER_GRID_REWARD.xp);
    assert.equal(reward?.parts, CIPHER_GRID_REWARD.parts);
    fixture.db.sqlite.exec("UPDATE dzn_cipher_grid_sessions SET started_at = started_at - 6000");
    state = await start(fixture);
    state = await payload(await call(fixture, guess(state, answerFor(fixture))));
    assert.equal(state.game?.status, "won");
    assert.equal(state.rewardGranted, false);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_reward_ledger").get()?.count, 1);
  });

  await test("six wrong guesses fail without minting a reward", async fixture => {
    let state = await start(fixture);
    for (let attempt = 0; attempt < 6; attempt++) state = await payload(await call(fixture, guess(state, "AAAAA")));
    assert.equal(state.game?.status, "failed");
    assert.equal(state.game?.attempts.length, 6);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_reward_ledger").get()?.count, 0);
  });

  await test("another player cannot read or advance a private decode", async fixture => {
    const state = await start(fixture);
    assert.equal((await call(fixture, guess(state, "CACHE"), { cookie: fixture.otherCookie })).status, 404);
    const other = await payload(await call(fixture, undefined, { cookie: fixture.otherCookie }));
    assert.equal(other.game, null);
  });

  await test("expired and stale guesses cannot overwrite state or mint rewards", async fixture => {
    let state = await start(fixture);
    fixture.db.sqlite.prepare("UPDATE dzn_cipher_grid_sessions SET started_at = ?").run(Date.now() - CIPHER_GRID_TTL_MS);
    assert.equal((await call(fixture, guess(state, answerFor(fixture)))).status, 409);
    fixture.db.sqlite.exec("UPDATE dzn_cipher_grid_sessions SET started_at = started_at - 6000");
    state = await start(fixture);
    fixture.db.beforeBatch = () => { fixture.db.beforeBatch = null; fixture.db.sqlite.exec("UPDATE dzn_cipher_grid_sessions SET version = version + 1"); };
    assert.equal((await call(fixture, guess(state, answerFor(fixture)))).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_reward_ledger").get()?.count, 0);
  });

  await test("a reward write failure rolls back the otherwise winning guess", async fixture => {
    const state = await start(fixture);
    fixture.db.sqlite.exec("CREATE TRIGGER fail_cipher_reward BEFORE INSERT ON dzn_cipher_grid_reward_ledger BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    assert.equal((await call(fixture, guess(state, answerFor(fixture)))).status, 503);
    const restored = await payload(await call(fixture));
    assert.equal(restored.game?.version, 0);
    assert.equal(restored.game?.status, "playing");
    assert.equal(restored.game?.attempts.length, 0);
  });

  await test("the Hub retains Cipher Grid rewards after its play flag is disabled", async fixture => {
    let state = await start(fixture);
    state = await payload(await call(fixture, guess(state, answerFor(fixture))));
    assert.equal(state.rewardGranted, true);
    const yesterday = Date.now() - 86_400_000;
    fixture.db.sqlite.prepare(`INSERT INTO dzn_cipher_grid_reward_ledger
      (id, user_id, reward_key, game_id, xp, parts, created_at) VALUES (?, 'local-player', ?, ?, 100, 4, ?)`)
      .run(randomUUID(), new Date(yesterday).toISOString().slice(0, 10), randomUUID(), yesterday);
    fixture.env.DZN_GAMES_CIPHER_GRID_ENABLED = "false";
    const response = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    const hub = await response.json() as { summary: { xp: number; parts: number; streak: number; history: Array<{ kind: string }> } };
    assert.equal(hub.summary.xp, 200);
    assert.equal(hub.summary.parts, 8);
    assert.equal(hub.summary.streak, 2);
    assert.ok(hub.summary.history.some(entry => entry.kind === "cipher-grid"));
  });

  await test("account deletion cascades private Cipher Grid state and rewards", async fixture => {
    const state = await start(fixture);
    await payload(await call(fixture, guess(state, answerFor(fixture))));
    assert.equal(await eraseOrRetainAccountUser(fixture.env.DB, "local-player"), 1);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_sessions WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_reward_ledger WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });

  await test("migration constraints reject forged rewards and retain foreign keys", async fixture => {
    assert.throws(() => fixture.db.sqlite.prepare("INSERT INTO dzn_cipher_grid_reward_ledger VALUES (?, 'local-player', ?, ?, 999, 99, 0)")
      .run(randomUUID(), randomUUID(), randomUUID()));
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });

  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const migration = readFileSync("migrations/0097_games_hub_cipher_grid.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'dzn_cipher_grid_%' ORDER BY name").all<{ name: string }>();
    assert.deepEqual(tables.results.map((row: { name: string }) => row.name), ["dzn_cipher_grid_reward_ledger", "dzn_cipher_grid_sessions"]);
    const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dzn_cipher_grid_rewards_history'").all<{ name: string }>();
    assert.equal(indexes.results.length, 1);
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_sessions").first<{ count: number }>())?.count, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_reward_ledger").first<{ count: number }>())?.count, 0);
    passed++; console.log("PASS actual local D1 migration, schema, index, foreign-key and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} DZN Cipher Grid checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
