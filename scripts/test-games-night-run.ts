import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { handleGamesHub } from "../functions/_lib/games-hub";
import { handleGamesNightRun } from "../functions/_lib/games-night-run";
import type { Env } from "../functions/_lib/types";
import {
  NIGHT_RUN_MAX_COLLISIONS,
  NIGHT_RUN_MIN_REACTION_MS,
  NIGHT_RUN_RECON_SCAN_GRACE_MS,
  NIGHT_RUN_REWARD,
  NIGHT_RUN_TOTAL_GATES,
  NIGHT_RUN_TTL_MS,
  nightRunGateWindowMs,
  type NightRunLane,
  type NightRunPayload,
} from "../lib/games-night-run";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof nightRunFixture>>;
let passed = 0;

async function nightRunFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) {
    fixture.db.sqlite.exec(readFileSync("migrations/0104_games_hub_night_run.sql", "utf8"));
    fixture.db.sqlite.exec(readFileSync("migrations/0105_games_hub_night_run_recon.sql", "utf8"));
  }
  (fixture.env as Env).DZN_GAMES_NIGHT_RUN_ENABLED = "true";
  (fixture.env as Env).DZN_GAMES_NIGHT_RUN_RECON_ENABLED = "true";
  return fixture;
}

async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await nightRunFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}

function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesNightRun(new Request("https://local.test/api/games/night-run", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}

async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<NightRunPayload>;
}

async function start(fixture: Fixture) { return payload(await call(fixture, { action: "start" })); }

function openGate(fixture: Fixture) {
  const past = Date.now() - Math.max(NIGHT_RUN_MIN_REACTION_MS + 80, 600);
  fixture.db.sqlite.prepare("UPDATE dzn_night_run_sessions SET gate_started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
    .run(past, past);
}

async function visibleGate(fixture: Fixture) {
  const state = await payload(await call(fixture));
  assert.equal(state.game?.status, "playing");
  assert.ok((state.game?.gateEndsAt ?? 0) > state.serverTime, "Expected an open gate.");
  return state;
}

function drive(state: NightRunPayload, lane: NightRunLane) {
  assert.ok(state.game);
  return { action: "drive", gameId: state.game.id, version: state.game.version, lane };
}

function scan(state: NightRunPayload) {
  assert.ok(state.game);
  return { action: "scan", gameId: state.game.id, version: state.game.version };
}

function wrongLane(lane: NightRunLane): NightRunLane { return lane === "left" ? "right" : "left"; }

async function completeRun(fixture: Fixture, initial?: NightRunPayload) {
  let current = initial ?? await start(fixture);
  while (current.game?.status === "playing") {
    openGate(fixture);
    current = await visibleGate(fixture);
    if (current.game?.scannerAvailable) current = await payload(await call(fixture, scan(current)));
    current = await payload(await call(fixture, drive(current, current.game!.safeLane!)));
  }
  return current;
}

async function run() {
  await test("authentication, origin, method, feature switches and invalid shapes fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_NIGHT_RUN_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    fixture.env.DZN_GAMES_NIGHT_RUN_ENABLED = "true";
    for (const body of [null, [], { action: "start", reward: 180 }, { action: "scan" }, { action: "scan", gameId: "x", version: 0, lane: "left" }, { action: "drive" }, { action: "drive", gameId: "x", version: 0, lane: "left" }]) {
      assert.equal((await call(fixture, body)).status, 400);
    }
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_night_run_sessions").get()?.count, 0);
  });

  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_night_run/i);
  }, false);

  await test("the server withholds the safe lane until its issued gate window", async fixture => {
    const started = await start(fixture);
    assert.equal(started.game?.totalGates, NIGHT_RUN_TOTAL_GATES);
    assert.equal(started.game?.safeLane, null);
    assert.ok((started.game?.gateStartsAt ?? 0) > started.serverTime);
    assert.equal(JSON.stringify(started).includes("lane_sequence_json"), false);
    openGate(fixture);
    const visible = await visibleGate(fixture);
    assert.ok(visible.game?.safeLane);
    assert.match((await call(fixture)).headers.get("cache-control")!, /private, no-store/);
    assert.equal((await call(fixture)).headers.get("vary"), "Cookie");
  });

  await test("convoy sessions tighten their server-issued gate window during later phases", async fixture => {
    await start(fixture);
    const now = Date.now();
    const route = JSON.parse(fixture.db.sqlite.prepare("SELECT lane_sequence_json FROM dzn_night_run_sessions WHERE user_id = 'local-player'").get()?.lane_sequence_json as string) as NightRunLane[];
    route[4] = "left";
    route[6] = "right";
    fixture.db.sqlite.prepare("UPDATE dzn_night_run_sessions SET lane_sequence_json = ?, gate_index = 4, gate_started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
      .run(JSON.stringify(route), now, now - 1_000);
    const pursuit = await payload(await call(fixture));
    assert.equal(pursuit.game?.intensity, "pursuit");
    assert.equal((pursuit.game?.gateEndsAt ?? 0) - (pursuit.game?.gateStartsAt ?? 0), nightRunGateWindowMs(4, NIGHT_RUN_TOTAL_GATES));
    fixture.db.sqlite.prepare("UPDATE dzn_night_run_sessions SET gate_index = 6, gate_started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
      .run(now, now - 1_000);
    const lockdown = await payload(await call(fixture));
    assert.equal(lockdown.game?.intensity, "lockdown");
    assert.equal((lockdown.game?.gateEndsAt ?? 0) - (lockdown.game?.gateStartsAt ?? 0), nightRunGateWindowMs(6, NIGHT_RUN_TOTAL_GATES));
  });

  await test("jammer gates hide the safe lane until one atomic server-recorded scan succeeds", async fixture => {
    const initial = await start(fixture);
    assert.ok(initial.game);
    const route = JSON.parse(fixture.db.sqlite.prepare("SELECT lane_sequence_json FROM dzn_night_run_sessions WHERE user_id = 'local-player'").get()?.lane_sequence_json as string) as NightRunLane[];
    route[2] = "right";
    const past = Date.now() - Math.max(NIGHT_RUN_MIN_REACTION_MS + 80, 600);
    fixture.db.sqlite.prepare("UPDATE dzn_night_run_sessions SET lane_sequence_json = ?, gate_index = 2, gate_started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
      .run(JSON.stringify(route), past, past - 800);
    const jammed = await visibleGate(fixture);
    assert.equal(jammed.game?.requiresRecon, true);
    assert.equal(jammed.game?.scannerAvailable, true);
    assert.equal(jammed.game?.safeLane, null);
    assert.equal((jammed.game?.gateEndsAt ?? 0) - (jammed.game?.gateStartsAt ?? 0), nightRunGateWindowMs(2, NIGHT_RUN_TOTAL_GATES) + NIGHT_RUN_RECON_SCAN_GRACE_MS);
    assert.equal((await call(fixture, drive(jammed, "right"))).status, 409);
    const scanned = await payload(await call(fixture, scan(jammed)));
    assert.equal(scanned.game?.scannerAvailable, false);
    assert.equal(scanned.game?.safeLane, "right");
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_night_run_gate_scans WHERE user_id = 'local-player'").get()?.count, 1);
    assert.equal((await call(fixture, scan(jammed))).status, 409);
  });

  await test("every fresh convoy includes at least two unpredictable jammer gates without exposing their routes", async fixture => {
    const initial = await start(fixture);
    assert.ok(initial.game);
    const route = JSON.parse(fixture.db.sqlite.prepare("SELECT lane_sequence_json FROM dzn_night_run_sessions WHERE user_id = 'local-player'").get()?.lane_sequence_json as string) as NightRunLane[];
    const jammerCount = route.reduce((count, lane, index) => {
      const isJammer = index >= 2 && ((["left", "centre", "right"] as const).indexOf(lane) + index * 2) % 3 === 0;
      return count + (isJammer ? 1 : 0);
    }, 0);
    assert.ok(jammerCount >= 2);
    assert.equal(JSON.stringify(initial).includes("lane_sequence_json"), false);
  });

  await test("pre-emptive and rapid steering fail without ending a run", async fixture => {
    await start(fixture);
    const tooEarly = Date.now() - Math.max(1, NIGHT_RUN_MIN_REACTION_MS - 30);
    fixture.db.sqlite.prepare("UPDATE dzn_night_run_sessions SET gate_started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
      .run(tooEarly, tooEarly - 500);
    const early = await visibleGate(fixture);
    assert.equal((await call(fixture, drive(early, early.game!.safeLane!))).status, 429);
    openGate(fixture);
    let live = await visibleGate(fixture);
    if (live.game?.scannerAvailable) live = await payload(await call(fixture, scan(live)));
    fixture.db.sqlite.prepare("UPDATE dzn_night_run_sessions SET updated_at = ? WHERE user_id = 'local-player'").run(Date.now());
    assert.equal((await call(fixture, drive(live, live.game!.safeLane!))).status, 429);
    assert.equal((await visibleGate(fixture)).game?.status, "playing");
  });

  await test("a complete server-owned convoy awards one bounded daily reward", async fixture => {
    let state = await completeRun(fixture);
    assert.equal(state.game?.status, "won");
    assert.equal(state.rewardGranted, true);
    assert.equal(state.rewardedToday, true);
    const reward = fixture.db.sqlite.prepare("SELECT xp, parts FROM dzn_night_run_reward_ledger").get();
    assert.equal(reward?.xp, NIGHT_RUN_REWARD.xp);
    assert.equal(reward?.parts, NIGHT_RUN_REWARD.parts);
    fixture.db.sqlite.exec("UPDATE dzn_night_run_sessions SET started_at = started_at - 6000");
    state = await completeRun(fixture);
    assert.equal(state.game?.status, "won");
    assert.equal(state.rewardGranted, false);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_night_run_reward_ledger").get()?.count, 1);
  });

  await test("wrong lanes use bounded collisions and cannot mint a reward", async fixture => {
    let state = await start(fixture);
    for (let collision = 0; collision < NIGHT_RUN_MAX_COLLISIONS; collision++) {
      openGate(fixture);
      state = await visibleGate(fixture);
      if (state.game?.scannerAvailable) state = await payload(await call(fixture, scan(state)));
      state = await payload(await call(fixture, drive(state, wrongLane(state.game!.safeLane!))));
    }
    assert.equal(state.game?.status, "failed");
    assert.equal(state.game?.collisions, NIGHT_RUN_MAX_COLLISIONS);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_night_run_reward_ledger").get()?.count, 0);
  });

  await test("other players cannot read, drive, replay or overwrite a private convoy", async fixture => {
    await start(fixture);
    openGate(fixture);
    let own = await visibleGate(fixture);
    if (own.game?.scannerAvailable) own = await payload(await call(fixture, scan(own)));
    assert.equal((await call(fixture, drive(own, own.game!.safeLane!), { cookie: fixture.otherCookie })).status, 404);
    assert.equal((await payload(await call(fixture, undefined, { cookie: fixture.otherCookie }))).game, null);
    fixture.db.sqlite.prepare("UPDATE dzn_night_run_sessions SET started_at = ?, gate_started_at = ? WHERE user_id = 'local-player'")
      .run(Date.now() - NIGHT_RUN_TTL_MS, Date.now() - 1_000);
    assert.equal((await call(fixture, drive(own, own.game!.safeLane!))).status, 409);
  });

  await test("a stale final steering input cannot write a reward after its version changes", async fixture => {
    let state = await start(fixture);
    while ((state.game?.gatesCleared ?? 0) < (state.game?.totalGates ?? 0) - 1) {
      openGate(fixture);
      state = await visibleGate(fixture);
      if (state.game?.scannerAvailable) state = await payload(await call(fixture, scan(state)));
      state = await payload(await call(fixture, drive(state, state.game!.safeLane!)));
    }
    openGate(fixture);
    state = await visibleGate(fixture);
    if (state.game?.scannerAvailable) state = await payload(await call(fixture, scan(state)));
    fixture.db.beforeBatch = () => {
      fixture.db.beforeBatch = null;
      fixture.db.sqlite.exec("UPDATE dzn_night_run_sessions SET version = version + 1 WHERE user_id = 'local-player'");
    };
    assert.equal((await call(fixture, drive(state, state.game!.safeLane!))).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_night_run_reward_ledger").get()?.count, 0);
  });

  await test("the Hub includes verified Night Run rewards only after both schema and flag are present", async fixture => {
    fixture.env.DZN_GAMES_NIGHT_RUN_ENABLED = "false";
    const hidden = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    assert.equal((await hidden.json() as { availableGames: { "night-run": boolean } }).availableGames["night-run"], false);
    fixture.env.DZN_GAMES_NIGHT_RUN_ENABLED = "true";
    const won = await completeRun(fixture);
    assert.equal(won.rewardGranted, true);
    const hub = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    const data = await hub.json() as { availableGames: { "night-run": boolean }; summary: { xp: number; parts: number; history: { kind: string }[] } };
    assert.equal(data.availableGames["night-run"], true);
    assert.equal(data.summary.xp, NIGHT_RUN_REWARD.xp);
    assert.equal(data.summary.parts, NIGHT_RUN_REWARD.parts);
    assert.ok(data.summary.history.some(entry => entry.kind === "night-run"));
  });

  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    for (const file of ["migrations/0104_games_hub_night_run.sql", "migrations/0105_games_hub_night_run_recon.sql"]) {
      const migration = readFileSync(file, "utf8").replace(/^--.*$/gm, "");
      for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    const table = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dzn_night_run_gate_scans'").all<{ name: string }>();
    const index = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dzn_night_run_gate_scans_session'").all<{ name: string }>();
    const foreignKeys = await db.prepare("PRAGMA foreign_key_list(dzn_night_run_gate_scans)").all<{ table: string }>();
    assert.equal(table.results.length, 1);
    assert.equal(index.results.length, 1);
    assert.ok((foreignKeys.results ?? []).some((row: { table: string }) => row.table === "users"));
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_night_run_gate_scans").first<{ count: number }>())?.count, 0);
    passed++; console.log("PASS Night Run recon migration has its schema, index, foreign key and zero-row baseline");
  } finally { await miniflare.dispose(); }

  const nightRunScene = readFileSync("components/games/night-run-3d.tsx", "utf8");
  const nightRunPanel = readFileSync("components/games/games-hub.tsx", "utf8");
  assert.match(nightRunScene, /dznNightRunRecon/, "The Night Run renderer must expose its masked-signal state for visual QA.");
  assert.match(nightRunPanel, /action: "scan"/, "The accessible Night Run controls must dispatch the same authoritative scan action.");
  assert.match(nightRunPanel, /!game\.safeLane/, "The accessible lane deck must remain disabled while an encrypted route is masked.");
  console.log(`Night Run tests passed: ${passed}`);
}

void run();
