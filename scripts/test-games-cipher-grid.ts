import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { eraseOrRetainAccountUser } from "../functions/_lib/deletion";
import { handleGamesCipherGrid, markCipherGridGuess } from "../functions/_lib/games-cipher-grid";
import { handleGamesHub } from "../functions/_lib/games-hub";
import type { Env } from "../functions/_lib/types";
import { CIPHER_GRID_LEGACY_MAX_ATTEMPTS, CIPHER_GRID_MAX_ATTEMPTS, CIPHER_GRID_REWARD, CIPHER_GRID_SPECIALIST_MAX_ATTEMPTS, CIPHER_GRID_SPECIALIST_WORD_LENGTH, CIPHER_GRID_TTL_MS, CIPHER_GRID_WORD_LENGTH, type CipherGridPayload } from "../lib/games-cipher-grid";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof cipherGridFixture>>;
let passed = 0;

async function cipherGridFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) {
    fixture.db.sqlite.exec(readFileSync("migrations/0097_games_hub_cipher_grid.sql", "utf8"));
    fixture.db.sqlite.exec(readFileSync("migrations/0106_games_hub_cipher_grid_specialist.sql", "utf8"));
  }
  (fixture.env as Env).DZN_GAMES_CIPHER_GRID_ENABLED = "true";
  (fixture.env as Env).DZN_GAMES_CIPHER_GRID_SPECIALIST_ENABLED = "true";
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

function blankGuess(state: CipherGridPayload) {
  if (!state.game) throw new Error("Expected an active Cipher Grid game");
  return "A".repeat(state.game.answerLength);
}

function guess(state: CipherGridPayload, word: string) {
  assert.ok(state.game);
  return { action: "guess", gameId: state.game.id, version: state.game.version, guess: word };
}

async function run() {
  const commandDeckSource = readFileSync("components/games/cipher-grid-3d.tsx", "utf8");
  assert.match(commandDeckSource, /\(\(sample \* 13\) % 17\)/);
  assert.doesNotMatch(commandDeckSource, /\(\(sample \* 17\) % 17\)/);
  console.log("PASS Cipher Grid particle field cycles across the command deck");

  await test("authentication, origin, method and feature switches fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_CIPHER_GRID_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 404);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_sessions").get()?.count, 0);
  });

  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_cipher_grid/i);
  }, false);

  await test("reading is mutation-free and never reveals the server-held answer", async fixture => {
    const empty = await payload(await call(fixture));
    assert.equal(empty.game, null);
    assert.equal(empty.specialistAvailable, true);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_sessions").get()?.count, 0);
    const state = await start(fixture);
    assert.equal(state.game?.attempts.length, 0);
    assert.ok([CIPHER_GRID_WORD_LENGTH, CIPHER_GRID_SPECIALIST_WORD_LENGTH].includes(state.game?.answerLength ?? 0));
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
    assert.deepEqual(markCipherGridGuess("CIPHER", "REPEAT"), ["present", "present", "correct", "absent", "absent", "absent"]);
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

  await test("wrong guesses fail at the server-selected attempt limit without minting a reward", async fixture => {
    let state = await start(fixture);
    for (let attempt = 0; attempt < state.game!.maxAttempts; attempt++) state = await payload(await call(fixture, guess(state, blankGuess(state))));
    assert.equal(state.game?.status, "failed");
    assert.equal(state.game?.attempts.length, state.game?.maxAttempts);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_cipher_grid_reward_ledger").get()?.count, 0);
  });

  await test("six-letter specialist ciphers use the shorter verified attempt budget", async fixture => {
    await start(fixture);
    fixture.db.sqlite.prepare("UPDATE dzn_cipher_grid_sessions SET answer = ?, attempts_json = '[]', status = 'playing', version = 0 WHERE user_id = 'local-player'").run("CIPHER");
    let specialist = await payload(await call(fixture));
    assert.equal(specialist.game?.difficulty, "specialist");
    assert.equal(specialist.game?.answerLength, CIPHER_GRID_SPECIALIST_WORD_LENGTH);
    assert.equal(specialist.game?.maxAttempts, CIPHER_GRID_SPECIALIST_MAX_ATTEMPTS);
    assert.equal((await call(fixture, guess(specialist, "AAAAA"))).status, 400, "A specialist session must reject a five-letter guess.");
    for (let attempt = 0; attempt < CIPHER_GRID_SPECIALIST_MAX_ATTEMPTS; attempt++) specialist = await payload(await call(fixture, guess(specialist, "AAAAAA")));
    assert.equal(specialist.game?.status, "failed");
    assert.equal(specialist.game?.attempts.length, CIPHER_GRID_SPECIALIST_MAX_ATTEMPTS);
  });

  await test("specialist ciphers stay disabled until their separately controlled feature flag is enabled", async fixture => {
    (fixture.env as Env).DZN_GAMES_CIPHER_GRID_SPECIALIST_ENABLED = "false";
    assert.equal((await payload(await call(fixture))).specialistAvailable, false);
    for (let index = 0; index < 12; index++) {
      const state = await start(fixture);
      assert.equal(state.game?.difficulty, "field");
      assert.equal(state.game?.answerLength, CIPHER_GRID_WORD_LENGTH);
      fixture.db.sqlite.exec("UPDATE dzn_cipher_grid_sessions SET started_at = started_at - 6000");
    }
  });

  await test("the specialist migration accepts six-letter ciphers while retaining the five-letter constraint", async fixture => {
    await start(fixture);
    fixture.db.sqlite.prepare("UPDATE dzn_cipher_grid_sessions SET answer = ?, attempts_json = '[]' WHERE user_id = 'local-player'").run("CIPHER");
    assert.throws(() => fixture.db.sqlite.prepare("UPDATE dzn_cipher_grid_sessions SET answer = 'SEVENTH' WHERE user_id = 'local-player'").run());
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });

  await test("legacy sessions at the former sixth-guess threshold stay visible and restartable", async fixture => {
    await start(fixture);
    const attempts = Array.from({ length: 5 }, () => ({ guess: "AAAAA", marks: ["absent", "absent", "absent", "absent", "absent"] }));
    fixture.db.sqlite.prepare("UPDATE dzn_cipher_grid_sessions SET answer = 'CACHE', attempts_json = ? WHERE user_id = 'local-player'").run(JSON.stringify(attempts));
    const legacy = await payload(await call(fixture));
    assert.equal(legacy.game?.answerLength, CIPHER_GRID_WORD_LENGTH);
    assert.equal(legacy.game?.maxAttempts, CIPHER_GRID_MAX_ATTEMPTS);
    assert.equal(legacy.game?.status, "failed");
    assert.equal((await call(fixture, guess(legacy, "CACHE"))).status, 409);
    const sixAttempts = [...attempts, { guess: "CACHE", marks: ["absent", "absent", "absent", "absent", "absent"] }];
    fixture.db.sqlite.prepare("UPDATE dzn_cipher_grid_sessions SET attempts_json = ? WHERE user_id = 'local-player'").run(JSON.stringify(sixAttempts));
    const historic = await payload(await call(fixture));
    assert.equal(historic.game?.maxAttempts, CIPHER_GRID_LEGACY_MAX_ATTEMPTS);
    assert.equal(historic.game?.status, "failed");
    fixture.db.sqlite.exec("UPDATE dzn_cipher_grid_sessions SET started_at = started_at - 6000");
    const restarted = await start(fixture);
    assert.equal(restarted.game?.status, "playing");
    assert.ok([CIPHER_GRID_MAX_ATTEMPTS, CIPHER_GRID_SPECIALIST_MAX_ATTEMPTS].includes(restarted.game?.maxAttempts ?? 0));
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
