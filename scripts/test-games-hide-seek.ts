import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { eraseOrRetainAccountUser } from "../functions/_lib/deletion";
import { handleGamesHideSeek } from "../functions/_lib/games-hide-seek";
import { HIDE_SEEK_TARGET_BY_ID } from "../functions/_lib/games-hide-seek-targets";
import { handleGamesHub } from "../functions/_lib/games-hub";
import type { Env } from "../functions/_lib/types";
import type { HideSeekPayload } from "../lib/games-hide-seek";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof hideSeekFixture>>;
let passed = 0;

async function hideSeekFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0087_games_hub_hide_seek.sql", "utf8"));
  (fixture.env as Env).DZN_GAMES_HIDE_SEEK_ENABLED = "true";
  return fixture;
}
async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await hideSeekFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}
function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesHideSeek(new Request("https://local.test/api/games/hide-seek", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}
async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<HideSeekPayload>;
}
async function start(fixture: Fixture) { return payload(await call(fixture, { action: "start" })); }
function scan(state: HideSeekPayload, target: { x: number; y: number }) {
  assert.ok(state.game); return { action: "scan", gameId: state.game.id, version: state.game.version, x: target.x, y: target.y };
}
function selectedTargets(fixture: Fixture) {
  const row = fixture.db.sqlite.prepare("SELECT target_ids_json FROM dzn_hide_seek_sessions WHERE user_id = 'local-player'").get() as { target_ids_json?: string } | undefined;
  assert.ok(row?.target_ids_json, "The authoritative session must retain its selected target IDs.");
  return (JSON.parse(row.target_ids_json) as string[]).map(id => {
    const target = HIDE_SEEK_TARGET_BY_ID.get(id);
    assert.ok(target, `Missing authoritative Signal Hunt target ${id}.`);
    return target;
  });
}
function emptyPoint(fixture: Fixture) {
  const targets = selectedTargets(fixture);
  for (let x = 0; x <= 1000; x += 100) for (let y = 0; y <= 1000; y += 100) {
    if (targets.every(target => Math.hypot(target.x - x, target.y - y) > 45)) return { x, y };
  }
  throw new Error("No empty scene point available");
}

async function run() {
  await test("authentication, origin, method and feature switches fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_HIDE_SEEK_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_sessions").get()?.count, 0);
  });
  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture); assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_hide_seek/i);
  }, false);
  await test("read is mutation-free and a new hunt exposes a classified four-signal brief", async fixture => {
    assert.equal((await payload(await call(fixture))).game, null);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_sessions").get()?.count, 0);
    const state = await start(fixture); assert.equal(state.game?.targetCount, 4);
    assert.equal(state.game?.scene, "recon-v2");
    assert.equal(state.game?.clues.length, 4);
    assert.equal(state.game?.recoveredSignals.length, 0);
    assert.equal(state.game?.lastScan, null);
    assert.deepEqual(state.game?.clues.map(target => target.slot), [1, 2, 3, 4]);
    assert.ok(state.game?.clues.every(target => target.clue.length > 16 && !target.found));
    const selected = selectedTargets(fixture);
    assert.ok(state.game?.clues.every((brief, index) => brief.clue.includes(selected[index].clue)), "Each classified briefing clue must describe the target selected for this hunt.");
    assert.doesNotMatch(JSON.stringify(state.game), /"x"\s*:|"y"\s*:|"id"\s*:\s*"(?:recon|signal)-/, "Unrecovered target coordinates and canonical IDs must never reach the browser.");
    const firstBrief = state.game?.clues.map(target => target.clue);
    const replacementId = state.game?.id.startsWith("f")
      ? "00000000-0000-0000-0000-000000000000"
      : "ffffffff-ffff-ffff-ffff-ffffffffffff";
    fixture.db.sqlite.prepare("UPDATE dzn_hide_seek_sessions SET id = ? WHERE user_id = 'local-player'").run(replacementId);
    const rekeyed = await payload(await call(fixture));
    assert.notDeepEqual(rekeyed.game?.clues.map(target => target.clue), firstBrief, "A hunt-specific briefing tag must prevent a previous mission brief becoming a reusable coordinate key.");
  });
  await test("legacy in-progress hunts retain their original classified brief", async fixture => {
    await start(fixture);
    fixture.db.sqlite.prepare("UPDATE dzn_hide_seek_sessions SET target_ids_json = ? WHERE user_id = 'local-player'")
      .run(JSON.stringify(["signal-01", "signal-02", "signal-03", "signal-04"]));
    const legacy = await payload(await call(fixture));
    assert.equal(legacy.game?.scene, "legacy");
    assert.deepEqual(legacy.game?.clues.map(target => target.slot), [1, 2, 3, 4]);
    assert.doesNotMatch(JSON.stringify(legacy.game), /"x"\s*:|"y"\s*:|"id"\s*:\s*"(?:recon|signal)-/);
  });
  await test("strict request validation rejects forged shapes and coordinates", async fixture => {
    const state = await start(fixture);
    const target = selectedTargets(fixture)[0];
    for (const body of [null, [], { action: "start", reward: 999 }, { action: "scan" },
      { ...scan(state, target), reward: 999 }, { ...scan(state, target), x: 1001 }]) {
      assert.equal((await call(fixture, body)).status, 400);
    }
  });
  await test("only a confirmed find releases one recovered marker while other coordinates remain classified", async fixture => {
    let state = await start(fixture);
    const [recovered, hidden] = selectedTargets(fixture);
    state = await payload(await call(fixture, scan(state, recovered)));
    assert.equal(state.game?.lastScan, "signal-acquired");
    assert.equal(state.game?.recoveredSignals.length, 1);
    assert.deepEqual(state.game?.recoveredSignals[0], { slot: 1, x: recovered.x, y: recovered.y });
    assert.equal(state.game?.clues[0]?.found, true);
    assert.equal(state.game?.clues[1]?.found, false);
    assert.equal(state.game?.recoveredSignals.some(signal => signal.slot === 2), false);
    assert.doesNotMatch(JSON.stringify(state.game), new RegExp(`\\"x\\"\\s*:\\s*${hidden.x}`));
    assert.doesNotMatch(JSON.stringify(state.game), new RegExp(hidden.id), "An unrecovered canonical target ID must stay server-held.");
    assert.doesNotMatch(JSON.stringify(state.game), new RegExp(recovered.id), "Recovered markers must not expose canonical target IDs either.");
    state = await payload(await call(fixture, scan(state, emptyPoint(fixture))));
    assert.equal(state.game?.lastScan, "empty");
  });
  await test("four server-validated finds win and mint one bounded daily reward", async fixture => {
    let state = await start(fixture);
    for (const target of selectedTargets(fixture)) state = await payload(await call(fixture, scan(state, target)));
    assert.equal(state.game?.status, "won"); assert.equal(state.game?.foundCount, 4); assert.equal(state.rewardedToday, true);
    assert.equal(state.rewardGranted, true);
    const reward = fixture.db.sqlite.prepare("SELECT xp, parts FROM dzn_hide_seek_reward_ledger").get();
    assert.equal(reward?.xp, 60); assert.equal(reward?.parts, 2);
    fixture.db.sqlite.exec("UPDATE dzn_hide_seek_sessions SET started_at = started_at - 6000");
    state = await start(fixture);
    for (const target of selectedTargets(fixture)) state = await payload(await call(fixture, scan(state, target)));
    assert.equal(state.rewardedToday, true); assert.equal(state.rewardGranted, false);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_reward_ledger").get()?.count, 1);
  });
  await test("six empty scans fail without a reward", async fixture => {
    let state = await start(fixture); const empty = emptyPoint(fixture);
    for (let index = 0; index < 6; index++) state = await payload(await call(fixture, scan(state, empty)));
    assert.equal(state.game?.status, "failed"); assert.equal(state.game?.misses, 6);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_reward_ledger").get()?.count, 0);
  });
  await test("stale concurrent scans cannot overwrite progress or mint rewards", async fixture => {
    const state = await start(fixture); const target = selectedTargets(fixture)[0];
    fixture.db.beforeBatch = () => { fixture.db.beforeBatch = null; fixture.db.sqlite.exec("UPDATE dzn_hide_seek_sessions SET version = version + 1"); };
    assert.equal((await call(fixture, scan(state, target))).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT found_ids_json FROM dzn_hide_seek_sessions").get()?.found_ids_json, "[]");
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_reward_ledger").get()?.count, 0);
  });
  await test("the client scanner visualises only the player scan point and confirmed aggregate state", async () => {
    const hubSource = readFileSync("components/games/games-hub.tsx", "utf8");
    const visualSource = readFileSync("components/games/signal-hunt-3d.tsx", "utf8");
    assert.match(hubSource, /const SignalHunt3D = dynamic/);
    assert.match(hubSource, /scanPoint=\{reticlePoint\}/);
    assert.match(visualSource, /const unavailableRef = useRef\(onUnavailable\);/);
    assert.match(visualSource, /new THREE\.OrthographicCamera/);
    assert.match(visualSource, /state\.scanPoint\.x \/ 1000 \* 2 - 1/);
    assert.match(visualSource, /1 - state\.scanPoint\.y \/ 1000 \* 2/);
    assert.doesNotMatch(visualSource, /recoveredSignals|target_ids_json|HIDE_SEEK_TARGET_BY_ID/);
  });
  await test("Hub preserves Signal Hunt rewards after the play flag is disabled", async fixture => {
    let state = await start(fixture);
    for (const target of selectedTargets(fixture)) state = await payload(await call(fixture, scan(state, target)));
    const yesterday = Date.now() - 86400000;
    fixture.db.sqlite.prepare(`INSERT INTO dzn_hide_seek_reward_ledger
      (id, user_id, reward_key, game_id, xp, parts, created_at) VALUES (?, 'local-player', ?, ?, 60, 2, ?)`)
      .run(randomUUID(), new Date(yesterday).toISOString().slice(0, 10), randomUUID(), yesterday);
    fixture.env.DZN_GAMES_HIDE_SEEK_ENABLED = "false";
    const response = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    const hub = await response.json() as { summary: { xp: number; parts: number; streak: number; history: Array<{ kind: string }> } };
    assert.equal(hub.summary.xp, 120); assert.equal(hub.summary.parts, 4); assert.equal(hub.summary.streak, 2);
    assert.ok(hub.summary.history.some(entry => entry.kind === "hide-seek"));
  });
  await test("account deletion removes Signal Hunt sessions and rewards atomically", async fixture => {
    let state = await start(fixture);
    for (const target of selectedTargets(fixture)) state = await payload(await call(fixture, scan(state, target)));
    assert.equal(await eraseOrRetainAccountUser(fixture.env.DB, "local-player"), 1);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM users WHERE id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_sessions WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_reward_ledger WHERE user_id = 'local-player'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });
  await test("migration constraints reject forged rewards and preserve foreign keys", async fixture => {
    assert.throws(() => fixture.db.sqlite.prepare("INSERT INTO dzn_hide_seek_reward_ledger VALUES (?, 'local-player', ?, ?, 999, 99, 0)").run(randomUUID(), randomUUID(), randomUUID()));
    assert.equal(fixture.db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  });
  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const migration = readFileSync("migrations/0087_games_hub_hide_seek.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_hide_seek_sessions").first<{ count: number }>())?.count, 0);
    passed++; console.log("PASS actual local D1 migration, constraints, indexes and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} DZN Signal Hunt checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
