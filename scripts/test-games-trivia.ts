import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { handleGamesTrivia, triviaPresentation } from "../functions/_lib/games-trivia";
import { handleGamesHub } from "../functions/_lib/games-hub";
import { questionById } from "../functions/_lib/games-trivia-questions";
import type { Env } from "../functions/_lib/types";
import type { TriviaPayload } from "../lib/games-trivia";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof triviaFixture>>;
let passed = 0;
async function triviaFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0085_games_hub_trivia.sql", "utf8"));
  (fixture.env as Env).DZN_GAMES_TRIVIA_ENABLED = "true";
  return fixture;
}
async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await triviaFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}
function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesTrivia(new Request("https://local.test/api/games/trivia", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}
async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<TriviaPayload>;
}
function currentAnswer(fixture: Fixture) {
  const row = fixture.db.sqlite.prepare("SELECT id, question_ids_json, current_index FROM dzn_trivia_sessions WHERE user_id = 'local-player'").get()!;
  const id = (JSON.parse(String(row.question_ids_json)) as string[])[Number(row.current_index)];
  return triviaPresentation(questionById.get(id)!, String(row.id)).answer;
}
async function answerRound(fixture: Fixture, correctCount = 5) {
  let state = await payload(await call(fixture));
  for (let index = 0; index < 5; index++) {
    const answer = index < correctCount ? currentAnswer(fixture) : (currentAnswer(fixture) + 1) % 4;
    state = await payload(await call(fixture, { action: "answer", gameId: state.game!.id, version: state.game!.version, answer }));
  }
  return state;
}

async function run() {
  await test("authentication, origin, method and feature switches fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start", difficulty: "recruit" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_TRIVIA_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_trivia_sessions").get()?.count, 0);
  });
  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_trivia/i);
  }, false);
  await test("round exposes one shuffled question without answers or future prompts", async fixture => {
    const state = await payload(await call(fixture, { action: "start", difficulty: "operator" }));
    assert.equal(state.game?.question?.number, 1);
    assert.equal(state.game?.question?.choices.length, 4);
    assert.equal(state.game?.difficulty, "operator");
    const body = JSON.stringify(state);
    assert.doesNotMatch(body, /answer|question_ids|correct_count/i);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_trivia_sessions").get()?.count, 1);
  });
  await test("account isolation, invalid input, replay and rapid restart are rejected", async fixture => {
    const state = await payload(await call(fixture, { action: "start", difficulty: "recruit" }));
    assert.equal((await call(fixture, { action: "answer", gameId: state.game!.id, version: 0, answer: 0 }, { cookie: fixture.otherCookie })).status, 404);
    for (const body of [null, [], { action: "start", difficulty: "unknown" }, { action: "answer" },
      { action: "answer", gameId: state.game!.id, version: 0, answer: 4 }]) assert.equal((await call(fixture, body)).status, 400);
    const answer = currentAnswer(fixture);
    assert.equal((await call(fixture, { action: "answer", gameId: state.game!.id, version: 0, answer })).status, 200);
    assert.equal((await call(fixture, { action: "answer", gameId: state.game!.id, version: 0, answer })).status, 409);
    assert.equal((await call(fixture, { action: "start", difficulty: "operator" })).status, 429);
  });
  await test("four correct answers pass and award exact daily reward once", async fixture => {
    await payload(await call(fixture, { action: "start", difficulty: "specialist" }));
    const completed = await answerRound(fixture, 4);
    assert.equal(completed.game?.status, "passed");
    assert.equal(completed.game?.correct, 4);
    assert.deepEqual(completed.rewardedToday, ["specialist"]);
    const reward = fixture.db.sqlite.prepare("SELECT difficulty, xp, parts FROM dzn_trivia_reward_ledger").get()!;
    assert.equal(reward.difficulty, "specialist"); assert.equal(reward.xp, 120); assert.equal(reward.parts, 3);
    fixture.db.sqlite.exec("UPDATE dzn_trivia_sessions SET started_at = started_at - 6000");
    await payload(await call(fixture, { action: "start", difficulty: "specialist" }));
    await answerRound(fixture, 5);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_trivia_reward_ledger").get()?.count, 1);
  });
  await test("three correct answers fail without minting a reward", async fixture => {
    await payload(await call(fixture, { action: "start", difficulty: "recruit" }));
    const completed = await answerRound(fixture, 3);
    assert.equal(completed.game?.status, "failed");
    assert.equal(completed.game?.correct, 3);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_trivia_reward_ledger").get()?.count, 0);
  });
  await test("shared Hub totals and workshop spending keep earned Trivia rewards after play is disabled", async fixture => {
    for (const difficulty of ["specialist", "specialist", "specialist", "specialist"] as const) {
      await payload(await call(fixture, { action: "start", difficulty }));
      await answerRound(fixture, 5);
      fixture.db.sqlite.exec("UPDATE dzn_trivia_sessions SET started_at = started_at - 6000; UPDATE dzn_trivia_reward_ledger SET reward_key = reward_key || ':' || id");
    }
    const hubCall = (body?: unknown) => handleGamesHub(new Request("https://local.test/api/games/hub", { method: body ? "POST" : "GET",
      headers: { cookie: fixture.cookie, origin: "https://local.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), fixture.env);
    const before = await hubCall().then(response => response.json()) as { summary: { xp: number; parts: number } };
    assert.equal(before.summary.xp, 480); assert.equal(before.summary.parts, 12);
    const assembled = await hubCall({ action: "assemble", requestId: randomUUID() });
    assert.equal(assembled.status, 200, await assembled.clone().text());
    const after = await assembled.json() as { summary: { xp: number; parts: number; assemblies: number } };
    assert.equal(after.summary.parts, 0); assert.equal(after.summary.assemblies, 1);
    fixture.env.DZN_GAMES_TRIVIA_ENABLED = "false";
    const disabled = await hubCall().then(response => response.json()) as { summary: { xp: number; parts: number; history: Array<{ kind: string }> } };
    assert.equal(disabled.summary.xp, 480); assert.equal(disabled.summary.parts, 0);
    assert.ok(disabled.summary.history.some(entry => entry.kind === "trivia:specialist"));
    assert.equal((await hubCall({ action: "assemble", requestId: randomUUID() })).status, 409);
  });
  await test("stale transactions cannot advance or mint rewards", async fixture => {
    const state = await payload(await call(fixture, { action: "start", difficulty: "recruit" }));
    fixture.db.beforeBatch = () => { fixture.db.beforeBatch = null; fixture.db.sqlite.exec("UPDATE dzn_trivia_sessions SET version = version + 1"); };
    const response = await call(fixture, { action: "answer", gameId: state.game!.id, version: 0, answer: currentAnswer(fixture) });
    assert.equal(response.status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT current_index FROM dzn_trivia_sessions").get()?.current_index, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_trivia_reward_ledger").get()?.count, 0);
  });
  await test("migration constraints reject forged rewards and preserve foreign keys", async fixture => {
    assert.throws(() => fixture.db.sqlite.prepare("INSERT INTO dzn_trivia_reward_ledger VALUES (?, 'local-player', ?, 'recruit', ?, 999, 99, 0)").run(randomUUID(), randomUUID(), randomUUID()));
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });
  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const migration = readFileSync("migrations/0085_games_hub_trivia.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    await db.prepare(`INSERT INTO dzn_trivia_sessions
      (user_id, id, difficulty, question_ids_json, current_index, correct_count, status, version, started_at, updated_at)
      VALUES ('local-player', 'game', 'recruit', '["r01","r02","r03","r04","r05"]', 0, 0, 'playing', 0, 0, 0)`).run();
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_trivia_sessions").first<{ count: number }>())?.count, 1);
    passed++; console.log("PASS actual local D1 migration, JSON constraints and foreign keys");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} DZN Trivia checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
