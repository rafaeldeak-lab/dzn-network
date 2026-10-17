import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleGamesHub } from "../functions/_lib/games-hub";
import { handleGamesRangerRange } from "../functions/_lib/games-ranger-range";
import type { Env } from "../functions/_lib/types";
import {
  RANGER_RANGE_MAX_MISSES,
  RANGER_RANGE_MIN_REACTION_MS,
  RANGER_RANGE_REWARD,
  RANGER_RANGE_TOTAL_SHOTS,
  RANGER_RANGE_TTL_MS,
  rangerRangeSightForWind,
  rangerRangeTargetWindowMs,
  type RangerRangePayload,
  type RangerRangeSight,
  type RangerRangeTarget,
} from "../lib/games-ranger-range";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof rangerRangeFixture>>;
let passed = 0;

async function rangerRangeFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0102_games_hub_ranger_range.sql", "utf8"));
  (fixture.env as Env).DZN_GAMES_RANGER_RANGE_ENABLED = "true";
  return fixture;
}

async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await rangerRangeFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}

function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleGamesRangerRange(new Request("https://local.test/api/games/ranger-range", { method, headers: {
    cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json",
  }, body: method === "GET" ? undefined : JSON.stringify(body) }), fixture.env);
}

async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<RangerRangePayload>;
}

async function start(fixture: Fixture, protocol: "wind-v1" | "legacy" = "wind-v1") {
  return payload(await call(fixture, protocol === "wind-v1" ? { action: "start", protocol } : { action: "start" }));
}

function openTarget(fixture: Fixture) {
  const past = Date.now() - Math.max(RANGER_RANGE_MIN_REACTION_MS + 80, 600);
  fixture.db.sqlite.prepare("UPDATE dzn_ranger_range_sessions SET target_started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
    .run(past, past);
}

async function visibleTarget(fixture: Fixture) {
  const state = await payload(await call(fixture));
  assert.ok(state.game?.target, "Expected a live range target.");
  return state;
}

function fire(state: RangerRangePayload, target: RangerRangeTarget, sight?: RangerRangeSight) {
  assert.ok(state.game);
  assert.ok(state.game.wind);
  return { action: "fire", gameId: state.game.id, version: state.game.version, target, sight: sight ?? rangerRangeSightForWind(state.game.wind) };
}

function wrongTarget(target: RangerRangeTarget): RangerRangeTarget {
  return target === "ridge" ? "ruins" : "ridge";
}

async function completeRun(fixture: Fixture, initial?: RangerRangePayload) {
  let current = initial ?? await start(fixture);
  while (current.game?.status === "playing") {
    openTarget(fixture);
    current = await visibleTarget(fixture);
    const target = current.game?.target;
    assert.ok(target);
    current = await payload(await call(fixture, fire(current, target)));
  }
  return current;
}

async function run() {
  assert.equal(rangerRangeSightForWind("left"), "left", "A crosswind from the left must be held into the wind.");
  assert.equal(rangerRangeSightForWind("calm"), "centre", "Still air must keep the neutral hold.");
  assert.equal(rangerRangeSightForWind("right"), "right", "A crosswind from the right must be held into the wind.");

  await test("authentication, origin, method, feature switches and invalid shapes fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "start" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_GAMES_RANGER_RANGE_ENABLED = "false";
    assert.equal((await call(fixture)).status, 404);
    fixture.env.DZN_GAMES_RANGER_RANGE_ENABLED = "true";
    for (const body of [null, [], { action: "start", reward: 160 }, { action: "fire" }, { action: "fire", gameId: "x", version: 0, target: "ridge", sight: "centre" }]) {
      assert.equal((await call(fixture, body)).status, 400);
    }
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_ranger_range_sessions").get()?.count, 0);
  });

  await test("missing schema returns a sanitized unavailable response", async fixture => {
    const response = await call(fixture);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_ranger_range/i);
  }, false);

  await test("the target remains hidden until its server-issued window opens", async fixture => {
    const started = await start(fixture);
    assert.equal(started.game?.totalShots, RANGER_RANGE_TOTAL_SHOTS);
    assert.equal(started.game?.target, null);
    assert.equal(started.game?.wind, null);
    assert.ok((started.game?.targetStartsAt ?? 0) > started.serverTime);
    assert.equal(JSON.stringify(started).includes("target_sequence_json"), false);
    openTarget(fixture);
    const visible = await visibleTarget(fixture);
    assert.ok(visible.game?.target);
    assert.ok(visible.game?.wind);
    assert.match((await call(fixture)).headers.get("cache-control")!, /private, no-store/);
    assert.equal((await call(fixture)).headers.get("vary"), "Cookie");
  });

  await test("old pages receive a still-air sequence when they start a fresh range", async fixture => {
    const started = await start(fixture, "legacy");
    openTarget(fixture);
    const state = await visibleTarget(fixture);
    assert.equal(state.game?.wind, "calm");
    const result = await payload(await call(fixture, { action: "fire", gameId: started.game!.id, version: state.game!.version, target: state.game!.target! }));
    assert.equal(result.game?.shotsCleared, 1);
  });

  await test("range sessions tighten their server-issued target window during later phases", async fixture => {
    await start(fixture);
    const now = Date.now();
    fixture.db.sqlite.prepare("UPDATE dzn_ranger_range_sessions SET shot_index = 4, target_started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
      .run(now, now - 1_000);
    const pressure = await payload(await call(fixture));
    assert.equal(pressure.game?.intensity, "pressure");
    assert.equal((pressure.game?.targetEndsAt ?? 0) - (pressure.game?.targetStartsAt ?? 0), rangerRangeTargetWindowMs(4, RANGER_RANGE_TOTAL_SHOTS));
    fixture.db.sqlite.prepare("UPDATE dzn_ranger_range_sessions SET shot_index = 6, target_started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
      .run(now, now - 1_000);
    const blackout = await payload(await call(fixture));
    assert.equal(blackout.game?.intensity, "blackout");
    assert.equal((blackout.game?.targetEndsAt ?? 0) - (blackout.game?.targetStartsAt ?? 0), rangerRangeTargetWindowMs(6, RANGER_RANGE_TOTAL_SHOTS));
  });

  await test("the server rejects pre-emptive shots and rapid repeat actions without ending a live run", async fixture => {
    await start(fixture);
    const tooEarly = Date.now() - Math.max(1, RANGER_RANGE_MIN_REACTION_MS - 30);
    fixture.db.sqlite.prepare("UPDATE dzn_ranger_range_sessions SET target_started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
      .run(tooEarly, tooEarly - 500);
    const early = await visibleTarget(fixture);
    assert.equal((await call(fixture, fire(early, early.game!.target!))).status, 429);
    openTarget(fixture);
    const live = await visibleTarget(fixture);
    fixture.db.sqlite.prepare("UPDATE dzn_ranger_range_sessions SET updated_at = ? WHERE user_id = 'local-player'").run(Date.now());
    assert.equal((await call(fixture, fire(live, live.game!.target!))).status, 429);
    assert.equal((await visibleTarget(fixture)).game?.status, "playing");
  });

  await test("the exact server-owned target sequence completes and grants one bounded daily reward", async fixture => {
    let state = await completeRun(fixture);
    assert.equal(state.game?.status, "won");
    assert.equal(state.rewardGranted, true);
    assert.equal(state.rewardedToday, true);
    const reward = fixture.db.sqlite.prepare("SELECT xp, parts FROM dzn_ranger_range_reward_ledger").get();
    assert.equal(reward?.xp, RANGER_RANGE_REWARD.xp);
    assert.equal(reward?.parts, RANGER_RANGE_REWARD.parts);
    fixture.db.sqlite.exec("UPDATE dzn_ranger_range_sessions SET started_at = started_at - 6000");
    state = await completeRun(fixture);
    assert.equal(state.game?.status, "won");
    assert.equal(state.rewardGranted, false);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_ranger_range_reward_ledger").get()?.count, 1);
  });

  await test("a wrong wind hold is scored as a bounded miss even when the live plate is correct", async fixture => {
    await start(fixture);
    openTarget(fixture);
    const state = await visibleTarget(fixture);
    const sight = rangerRangeSightForWind(state.game!.wind!);
    const wrongSight: RangerRangeSight = sight === "left" ? "right" : "left";
    const result = await payload(await call(fixture, fire(state, state.game!.target!, wrongSight)));
    assert.equal(result.game?.shotsCleared, 0);
    assert.equal(result.game?.misses, 1);
    assert.equal(result.game?.status, "playing");
  });

  await test("legacy target-only sessions remain playable as still-air range runs", async fixture => {
    await start(fixture);
    fixture.db.sqlite.prepare("UPDATE dzn_ranger_range_sessions SET target_sequence_json = ?, target_started_at = ?, updated_at = ? WHERE user_id = 'local-player'")
      .run(JSON.stringify(["ridge", "ruins", "road", "treeline", "tower", "ravine", "ridge", "road"]), Date.now() - 600, Date.now() - 600);
    const state = await visibleTarget(fixture);
    assert.equal(state.game?.wind, "calm");
    const result = await payload(await call(fixture, { action: "fire", gameId: state.game!.id, version: state.game!.version, target: state.game!.target! }));
    assert.equal(result.game?.shotsCleared, 1);
  });

  await test("a current wind-scored session rejects the old four-field fire request", async fixture => {
    await start(fixture);
    openTarget(fixture);
    const state = await visibleTarget(fixture);
    const response = await call(fixture, { action: "fire", gameId: state.game!.id, version: state.game!.version, target: state.game!.target! });
    assert.equal(response.status, 400);
    assert.equal((await visibleTarget(fixture)).game?.shotsCleared, 0);
  });

  await test("wrong targets use bounded misses and cannot mint a reward", async fixture => {
    let state = await start(fixture);
    for (let miss = 0; miss < RANGER_RANGE_MAX_MISSES; miss++) {
      openTarget(fixture);
      state = await visibleTarget(fixture);
      state = await payload(await call(fixture, fire(state, wrongTarget(state.game!.target!))));
    }
    assert.equal(state.game?.status, "failed");
    assert.equal(state.game?.misses, RANGER_RANGE_MAX_MISSES);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_ranger_range_reward_ledger").get()?.count, 0);
  });

  await test("another player cannot read, advance, replay, or overwrite a private range", async fixture => {
    await start(fixture);
    openTarget(fixture);
    const own = await visibleTarget(fixture);
    assert.equal((await call(fixture, fire(own, own.game!.target!), { cookie: fixture.otherCookie })).status, 404);
    assert.equal((await payload(await call(fixture, undefined, { cookie: fixture.otherCookie }))).game, null);
    fixture.db.sqlite.prepare("UPDATE dzn_ranger_range_sessions SET started_at = ?, target_started_at = ? WHERE user_id = 'local-player'")
      .run(Date.now() - RANGER_RANGE_TTL_MS, Date.now() - 1_000);
    assert.equal((await call(fixture, fire(own, own.game!.target!))).status, 409);
  });

  await test("a stale final arrow cannot write a reward after its version changes", async fixture => {
    let state = await start(fixture);
    while ((state.game?.shotsCleared ?? 0) < (state.game?.totalShots ?? 0) - 1) {
      openTarget(fixture);
      state = await visibleTarget(fixture);
      state = await payload(await call(fixture, fire(state, state.game!.target!)));
    }
    openTarget(fixture);
    state = await visibleTarget(fixture);
    fixture.db.beforeBatch = () => {
      fixture.db.beforeBatch = null;
      fixture.db.sqlite.exec("UPDATE dzn_ranger_range_sessions SET version = version + 1 WHERE user_id = 'local-player'");
    };
    assert.equal((await call(fixture, fire(state, state.game!.target!))).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_ranger_range_reward_ledger").get()?.count, 0);
  });

  await test("the Hub includes verified Ranger Range rewards only after the schema and flag are both present", async fixture => {
    fixture.env.DZN_GAMES_RANGER_RANGE_ENABLED = "false";
    const hidden = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    assert.equal((await hidden.json() as { availableGames: { "ranger-range": boolean } }).availableGames["ranger-range"], false);
    fixture.env.DZN_GAMES_RANGER_RANGE_ENABLED = "true";
    const won = await completeRun(fixture);
    assert.equal(won.rewardGranted, true);
    const hub = await handleGamesHub(new Request("https://local.test/api/games/hub", { headers: { cookie: fixture.cookie } }), fixture.env);
    const data = await hub.json() as { availableGames: { "ranger-range": boolean }; summary: { xp: number; parts: number; history: { kind: string }[] } };
    assert.equal(data.availableGames["ranger-range"], true);
    assert.equal(data.summary.xp, RANGER_RANGE_REWARD.xp);
    assert.equal(data.summary.parts, RANGER_RANGE_REWARD.parts);
    assert.ok(data.summary.history.some(entry => entry.kind === "ranger-range"));
  });

  const rangerScene = readFileSync("components/games/ranger-range-3d.tsx", "utf8");
  const rangerPanel = readFileSync("components/games/games-hub.tsx", "utf8");
  assert.match(rangerScene, /dznRangerRangeCanvas/, "The tactical range scene must expose its own render target for visual QA.");
  assert.match(rangerScene, /if \(target && liveTargetRef\.current && sightReadyRef\.current\)/, "The 3D scene must require a selected sight hold before forwarding a live plate selection to the authoritative fire action.");
  assert.match(rangerScene, /const bowGroup = new THREE\.Group\(\)/, "Ranger Range must retain the rendered bow foreground rather than falling back to a flat target deck.");
  assert.match(rangerScene, /const windRibbon = new THREE\.Line/, "Ranger Range must visualise the server-issued range condition in the WebGL scene.");
  assert.match(rangerScene, /const showFallback = \(\) =>/, "The WebGL fallback must retain a dedicated art state.");
  assert.doesNotMatch(rangerScene, /mount\.style\.display = "none"/, "The WebGL fallback must not hide the cinematic backdrop or the accessible target deck.");
  assert.match(rangerPanel, /RANGER_RANGE_WIND_META/, "The accessible range controls must present the server-issued wind condition without exposing server storage.");
  assert.match(rangerPanel, /<RangerRange3D safeTarget=\{targetOpen \? game\.target : null\} wind=\{targetOpen \? game\.wind : null\}/, "The tactical 3D range must render from the same server-issued target and wind condition as the accessible controls.");

  console.log(`Ranger Range tests passed: ${passed}`);
}

void run();
