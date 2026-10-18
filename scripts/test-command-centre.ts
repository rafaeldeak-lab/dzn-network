import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { handleCommandCentre } from "../functions/_lib/command-centre";
import type { Env } from "../functions/_lib/types";
import type { CommandCentrePayload } from "../lib/command-centre";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof commandCentreFixture>>;
let passed = 0;

async function commandCentreFixture(migrate = true) {
  const fixture = await gamesFixture();
  if (migrate) fixture.db.sqlite.exec(readFileSync("migrations/0107_dzn_command_centre.sql", "utf8"));
  (fixture.env as Env).DZN_COMMAND_CENTRE_ENABLED = "true";
  return fixture;
}

async function test(name: string, action: (fixture: Fixture) => Promise<void>, migrate = true) {
  const fixture = await commandCentreFixture(migrate);
  try { await action(fixture); passed++; console.log(`PASS ${name}`); } finally { fixture.db.sqlite.close(); }
}

function call(fixture: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleCommandCentre(new Request("https://local.test/api/player/command-centre", {
    method,
    headers: { cookie: options.cookie ?? fixture.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  }), fixture.env);
}

async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<CommandCentrePayload>;
}

function grantRewards(fixture: Fixture, count = 4) {
  for (let index = 0; index < count; index++) {
    fixture.db.sqlite.prepare(`INSERT INTO dzn_game_reward_ledger
      (id, user_id, reward_key, kind, game_id, xp, parts, created_at)
      VALUES (?, 'local-player', ?, 'survival', ?, 150, 3, ?)`)
      .run(randomUUID(), `command-centre:${index}`, randomUUID(), index);
  }
}

async function establish(fixture: Fixture) {
  return payload(await call(fixture, { action: "initialize" }));
}

async function run() {
  const source = readFileSync("functions/_lib/command-centre.ts", "utf8");
  const migration = readFileSync("migrations/0107_dzn_command_centre.sql", "utf8");
  const page = readFileSync("components/command-centre/command-centre.tsx", "utf8");
  assert.match(source, /DZN_COMMAND_CENTRE_ENABLED !== "true"/);
  assert.match(source, /dzn_command_centre_spend_ledger/);
  assert.match(migration, /UNIQUE \(user_id, request_id\)/);
  assert.match(page, /does not affect competitive standings/);

  await test("authentication, origin, method and switch checks fail closed", async fixture => {
    assert.equal((await call(fixture, undefined, { cookie: "" })).status, 401);
    assert.equal((await call(fixture, { action: "initialize" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await call(fixture, undefined, { method: "DELETE" })).status, 405);
    fixture.env.DZN_COMMAND_CENTRE_ENABLED = "false";
    assert.equal((await call(fixture)).status, 503);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE name LIKE 'dzn_command_centre_%'").get()?.count, 3);
  });

  await test("missing migration schema remains unavailable without writes", async fixture => {
    const response = await call(fixture);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_command/i);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_game_reward_ledger").get()?.count, 0);
  }, false);

  await test("GET is mutation free and initialization creates exactly one owned settlement", async fixture => {
    const before = await payload(await call(fixture));
    assert.equal(before.profile, null);
    assert.equal(before.buildings.length, 0);
    const started = await establish(fixture);
    assert.equal(started.profile?.tier, "Ruined Camp");
    assert.equal(started.buildings.length, 4);
    assert.ok(started.buildings.every(building => building.level === 1 && building.targetLevel === null));
    await establish(fixture);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_command_centre_profiles").get()?.count, 1);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_command_centre_buildings").get()?.count, 4);
  });

  await test("construction uses server requirements, commits once, and never accepts client-supplied costs", async fixture => {
    await establish(fixture);
    grantRewards(fixture);
    const initial = await payload(await call(fixture));
    const headquarters = initial.buildings.find(building => building.building === "headquarters")!;
    const requestId = randomUUID();
    const upgraded = await payload(await call(fixture, {
      action: "start-upgrade", building: "headquarters", version: headquarters.version, requestId, parts: 999999, requiredXp: 0, durationMs: 1,
    }));
    const updated = upgraded.buildings.find(building => building.building === "headquarters")!;
    assert.equal(updated.targetLevel, 2);
    assert.equal(updated.version, headquarters.version + 1);
    assert.equal(upgraded.resources.partsAvailable, 4);
    assert.equal(fixture.db.sqlite.prepare("SELECT parts_spent FROM dzn_command_centre_spend_ledger").get()?.parts_spent, 8);
    const replay = await payload(await call(fixture, { action: "start-upgrade", building: "headquarters", version: headquarters.version, requestId }));
    assert.equal(replay.resources.partsSpent, 8);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_command_centre_spend_ledger").get()?.count, 1);
  });

  await test("player isolation, headquarters gates and insufficient rewards are enforced", async fixture => {
    const first = await establish(fixture);
    const headquarters = first.buildings.find(building => building.building === "headquarters")!;
    const workshop = first.buildings.find(building => building.building === "workshop")!;
    assert.equal((await call(fixture, { action: "start-upgrade", building: "headquarters", version: headquarters.version, requestId: randomUUID() })).status, 409);
    grantRewards(fixture);
    assert.equal((await call(fixture, { action: "start-upgrade", building: "workshop", version: workshop.version, requestId: randomUUID() })).status, 409);
    assert.equal((await call(fixture, { action: "start-upgrade", building: "headquarters", version: headquarters.version, requestId: randomUUID() }, { cookie: fixture.otherCookie })).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_command_centre_spend_ledger").get()?.count, 0);
  });

  await test("stale construction orders cannot reserve parts and completion uses server time", async fixture => {
    const initial = await establish(fixture);
    grantRewards(fixture);
    const headquarters = initial.buildings.find(building => building.building === "headquarters")!;
    fixture.db.beforeBatch = () => {
      fixture.db.beforeBatch = null;
      fixture.db.sqlite.exec("UPDATE dzn_command_centre_buildings SET version = version + 1 WHERE user_id = 'local-player' AND building = 'headquarters'");
    };
    assert.equal((await call(fixture, { action: "start-upgrade", building: "headquarters", version: headquarters.version, requestId: randomUUID() })).status, 409);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_command_centre_spend_ledger").get()?.count, 0);
    const refreshed = await payload(await call(fixture));
    const current = refreshed.buildings.find(building => building.building === "headquarters")!;
    const started = await payload(await call(fixture, { action: "start-upgrade", building: "headquarters", version: current.version, requestId: randomUUID() }));
    const constructing = started.buildings.find(building => building.building === "headquarters")!;
    assert.equal((await call(fixture, { action: "complete-upgrade", building: "headquarters", version: constructing.version })).status, 409);
    fixture.db.sqlite.exec("UPDATE dzn_command_centre_buildings SET construction_started_at = -1, completes_at = 0 WHERE user_id = 'local-player' AND building = 'headquarters'");
    const completed = await payload(await call(fixture, { action: "complete-upgrade", building: "headquarters", version: constructing.version }));
    assert.equal(completed.buildings.find(building => building.building === "headquarters")?.level, 2);
  });

  await test("API payload exposes aggregate resources but never raw reward ledgers", async fixture => {
    await establish(fixture); grantRewards(fixture);
    const state = await payload(await call(fixture));
    assert.equal(state.resources.xp, 600);
    assert.equal(state.resources.partsAvailable, 12);
    assert.doesNotMatch(JSON.stringify(state), /reward_key|game_id|dzn_game_reward_ledger/i);
  });

  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    const statements = migration.replace(/^--.*$/gm, "").split(";").map(value => value.trim()).filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_command_centre_profiles").first<{ count: number }>())?.count, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_command_centre_buildings").first<{ count: number }>())?.count, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM dzn_command_centre_spend_ledger").first<{ count: number }>())?.count, 0);
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    const indexes = await db.prepare("PRAGMA index_list('dzn_command_centre_spend_ledger')").all<{ name: string }>();
    assert.ok((indexes.results ?? []).some((index: { name: string }) => index.name === "idx_dzn_command_centre_spend_history"));
    await db.prepare("INSERT INTO dzn_command_centre_profiles VALUES ('local-player', 0, 0)").run();
    await db.prepare("INSERT INTO dzn_command_centre_buildings (user_id, building, level, version) VALUES ('local-player', 'headquarters', 1, 0)").run();
    await assert.rejects(db.prepare("UPDATE dzn_command_centre_buildings SET target_level = 4 WHERE user_id = 'local-player'").run());
    passed++; console.log("PASS local D1 migration ledger, constraints, indexes, foreign keys and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} Command Centre checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
