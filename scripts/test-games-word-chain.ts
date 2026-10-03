import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { handleGamesHub } from "../functions/_lib/games-hub";
import { handleGamesWordChain } from "../functions/_lib/games-word-chain";
import { WORD_CHAIN_DICTIONARY, WORD_CHAIN_SEEDS } from "../functions/_lib/games-word-chain-dictionary";
import type { Env } from "../functions/_lib/types";
import type { WordChainPayload } from "../lib/games-word-chain";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof wordChainFixture>>;
let passed = 0;

async function wordChainFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0086_games_hub_word_chain.sql", "utf8"));
  (fixture.env as Env).DZN_GAMES_WORD_CHAIN_ENABLED = "true";
  return fixture;
}
async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await wordChainFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}
function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesWordChain(new Request("https://local.test/api/games/word-chain", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}
async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<WordChainPayload>;
}
function candidate(letter: string, excluded = new Set<string>()) {
  const value = [...WORD_CHAIN_DICTIONARY].find(word => word.startsWith(letter) && !excluded.has(word));
  assert.ok(value, `No dictionary candidate for ${letter}`); return value;
}

async function run() {
  await test("authentication, origin, method and feature switches fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "play", roundId: "x", version: 0, word: "test" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_WORD_CHAIN_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_word_chain_rounds").get()?.count, 0);
  });
  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture); assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_word_chain/i);
  }, false);
  await test("read is mutation-free and exposes only the current shared turn", async fixture => {
    const state = await payload(await call(fixture));
    assert.equal(state.round.version, 0); assert.equal(state.round.entries.length, 0); assert.equal(state.round.canPlay, true);
    assert.match(state.round.id, /^\d{4}-\d{2}-\d{2}$/); assert.equal(state.round.requiredLetter, state.round.currentWord.at(-1));
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_word_chain_rounds").get()?.count, 0);
  });
  await test("dictionary, shape and required-letter validation reject invalid turns", async fixture => {
    const state = await payload(await call(fixture));
    for (const body of [null, [], { action: "play" }, { action: "play", roundId: state.round.id, version: 0, word: "12" },
      { action: "play", roundId: state.round.id, version: 0, word: "radio", reward: 999 }]) {
      assert.equal((await call(fixture, body)).status, 400);
    }
    assert.equal((await call(fixture, { action: "play", roundId: state.round.id, version: 0, word: `${state.round.requiredLetter}zzzz` })).status, 422);
    const wrong = [...WORD_CHAIN_DICTIONARY].find(word => !word.startsWith(state.round.requiredLetter))!;
    assert.equal((await call(fixture, { action: "play", roundId: state.round.id, version: 0, word: wrong })).status, 422);
  });
  await test("the daily opening seed cannot be replayed later in the chain", async fixture => {
    const originalNow = Date.now;
    let selected = originalNow();
    while (true) {
      const id = new Date(selected).toISOString().slice(0, 10);
      const score = [...id].reduce((total, value) => total + value.charCodeAt(0), 0);
      if (WORD_CHAIN_SEEDS[score % WORD_CHAIN_SEEDS.length] === "radio") break;
      selected += 86400000;
    }
    Date.now = () => selected;
    try {
      const state = await payload(await call(fixture));
      assert.equal(state.round.currentWord, "radio");
      fixture.db.sqlite.prepare(`INSERT INTO dzn_word_chain_rounds
        (id, current_word, current_user_id, version, created_at, updated_at) VALUES (?, 'radar', NULL, 0, 0, 0)`)
        .run(state.round.id);
      const response = await call(fixture, { action: "play", roundId: state.round.id, version: 0, word: "radio" });
      assert.equal(response.status, 409);
      assert.match(await response.text(), /already been used/i);
      assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_word_chain_entries").get()?.count, 0);
    } finally { Date.now = originalNow; }
  });
  await test("shared turns alternate players and mint one bounded daily reward", async fixture => {
    let state = await payload(await call(fixture));
    const first = candidate(state.round.requiredLetter);
    state = await payload(await call(fixture, { action: "play", roundId: state.round.id, version: state.round.version, word: first }));
    assert.equal(state.round.currentWord, first); assert.equal(state.round.version, 1); assert.equal(state.rewardedToday, true); assert.equal(state.round.canPlay, false);
    assert.equal((await call(fixture, { action: "play", roundId: state.round.id, version: 1, word: candidate(first.at(-1)!, new Set([first])) })).status, 409);
    const second = candidate(first.at(-1)!, new Set([first]));
    state = await payload(await call(fixture, { action: "play", roundId: state.round.id, version: 1, word: second }, { cookie: fixture.otherCookie }));
    assert.equal(state.round.version, 2); assert.equal(state.round.entries[0].player, "Other test player");
    fixture.db.sqlite.exec("UPDATE dzn_word_chain_entries SET created_at = created_at - 6000 WHERE user_id = 'local-player'");
    const third = candidate(second.at(-1)!, new Set([first, second]));
    await payload(await call(fixture, { action: "play", roundId: state.round.id, version: 2, word: third }));
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_word_chain_reward_ledger WHERE user_id = 'local-player'").get()?.count, 1);
  });
  await test("duplicate, replay, rapid retry and stale races fail without extra rewards", async fixture => {
    let state = await payload(await call(fixture)); const first = candidate(state.round.requiredLetter);
    state = await payload(await call(fixture, { action: "play", roundId: state.round.id, version: 0, word: first }));
    assert.equal((await call(fixture, { action: "play", roundId: state.round.id, version: 0, word: first }, { cookie: fixture.otherCookie })).status, 409);
    const second = candidate(first.at(-1)!, new Set([first]));
    fixture.db.beforeBatch = () => { fixture.db.beforeBatch = null; fixture.db.sqlite.exec("UPDATE dzn_word_chain_rounds SET version = version + 1"); };
    assert.equal((await call(fixture, { action: "play", roundId: state.round.id, version: 1, word: second }, { cookie: fixture.otherCookie })).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_word_chain_entries").get()?.count, 1);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_word_chain_reward_ledger").get()?.count, 1);
  });
  await test("Hub keeps earned Word Chain progress after the play flag is disabled", async fixture => {
    const state = await payload(await call(fixture)); const word = candidate(state.round.requiredLetter);
    await payload(await call(fixture, { action: "play", roundId: state.round.id, version: 0, word }));
    fixture.env.DZN_GAMES_WORD_CHAIN_ENABLED = "false";
    const response = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    const hub = await response.json() as { summary: { xp: number; parts: number; history: Array<{ kind: string }> } };
    assert.equal(hub.summary.xp, 25); assert.equal(hub.summary.parts, 1);
    assert.ok(hub.summary.history.some(entry => entry.kind === "word-chain"));
  });
  await test("migration constraints reject forged rewards and preserve foreign keys", async fixture => {
    assert.throws(() => fixture.db.sqlite.prepare("INSERT INTO dzn_word_chain_reward_ledger VALUES (?, 'local-player', ?, ?, ?, 999, 99, 0)").run(randomUUID(), randomUUID(), randomUUID(), randomUUID()));
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });
  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const migration = readFileSync("migrations/0086_games_hub_word_chain.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_word_chain_rounds").first<{ count: number }>())?.count, 0);
    passed++; console.log("PASS actual local D1 migration, constraints, indexes and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} DZN Word Chain checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
