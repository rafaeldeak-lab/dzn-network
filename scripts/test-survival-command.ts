import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { handleCommandCentre } from "../functions/_lib/command-centre";
import { handleSurvivalCommand } from "../functions/_lib/survival-command";
import type { Env } from "../functions/_lib/types";
import type { SurvivalCommandPayload } from "../lib/survival-command";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof fixture>>;
let passed = 0;

async function fixture(migrate = true) {
  const value = await gamesFixture();
  value.db.sqlite.exec(readFileSync("migrations/0107_dzn_command_centre.sql", "utf8"));
  if (migrate) value.db.sqlite.exec(readFileSync("migrations/0108_dzn_survival_command_expeditions.sql", "utf8"));
  (value.env as Env).DZN_COMMAND_CENTRE_ENABLED = "true";
  (value.env as Env).DZN_SURVIVAL_COMMAND_ENABLED = "true";
  return value;
}

async function test(name: string, action: (value: Fixture) => Promise<void>, migrate = true) {
  const value = await fixture(migrate);
  try { await action(value); passed++; console.log(`PASS ${name}`); } finally { value.db.sqlite.close(); }
}

function request(value: Fixture, body?: unknown, options: { cookie?: string; origin?: string; method?: string } = {}) {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  return handleSurvivalCommand(new Request("https://local.test/api/player/survival-command", {
    method,
    headers: { cookie: options.cookie ?? value.cookie, origin: options.origin ?? "https://local.test", "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  }), value.env);
}

function commandRequest(value: Fixture, body: unknown) {
  return handleCommandCentre(new Request("https://local.test/api/player/command-centre", {
    method: "POST", headers: { cookie: value.cookie, origin: "https://local.test", "content-type": "application/json" }, body: JSON.stringify(body),
  }), value.env);
}

async function payload(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<SurvivalCommandPayload>;
}

async function establish(value: Fixture) {
  assert.equal((await commandRequest(value, { action: "initialize" })).status, 200);
  return payload(await request(value, { action: "initialize" }));
}

async function run() {
  const source = readFileSync("functions/_lib/survival-command.ts", "utf8");
  const migration = readFileSync("migrations/0108_dzn_survival_command_expeditions.sql", "utf8");
  const client = readFileSync("components/survival-command/survival-command.tsx", "utf8");
  const scene = readFileSync("components/survival-command/survival-command-scene.tsx", "utf8");
  const deletion = readFileSync("functions/_lib/deletion.ts", "utf8");
  const playerHubRoute = readFileSync("functions/api/player/hub.ts", "utf8");
  const playerHome = readFileSync("components/player/player-home.tsx", "utf8");
  assert.match(source, /DZN_SURVIVAL_COMMAND_ENABLED !== "true"/);
  assert.match(source, /resolveSurvivalCommandOutcome/);
  assert.match(source, /SUM\(deployment_cost\)/);
  assert.match(source, /request\.headers\.get\("origin"\)/);
  assert.match(migration, /idx_dzn_survival_command_one_active_expedition/);
  assert.match(migration, /UNIQUE \(user_id, request_id\)/);
  assert.match(client, /Route plan/);
  assert.match(client, /readyRefreshRef/);
  assert.match(client, /activeRemaining > 0/);
  assert.match(client, /serverDayKey/);
  assert.match(client, /payload\.deployment\.dayKey === serverDayKey/);
  assert.match(client, /deployment\.used \+ selected\.deploymentCost > deployment\.capacity/);
  assert.match(scene, /dznSurvivalCommandCanvas/);
  assert.match(deletion, /dzn_survival_command_resolution_ledger/);
  assert.match(playerHubRoute, /DZN_SURVIVAL_COMMAND_ENABLED === "true"/);
  assert.match(playerHome, /href: "\/survival-command"/);
  assert.match(playerHome, /hubData\?\.survival_command\?\.available === true/);

  await test("auth, origin, method and feature gates fail closed", async value => {
    assert.equal((await request(value, undefined, { cookie: "" })).status, 401);
    assert.equal((await request(value, { action: "initialize" }, { origin: "https://foreign.test" })).status, 403);
    assert.equal((await request(value, undefined, { method: "DELETE" })).status, 405);
    value.env.DZN_SURVIVAL_COMMAND_ENABLED = "false";
    assert.equal((await request(value)).status, 503);
    value.env.DZN_SURVIVAL_COMMAND_ENABLED = "true";
    value.env.DZN_COMMAND_CENTRE_ENABLED = "false";
    assert.equal((await request(value)).status, 503);
  });

  await test("missing expedition migration remains unavailable without writes", async value => {
    const response = await request(value);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sqlite|select |table|dzn_survival/i);
    assert.equal(value.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_command_centre_profiles").get()?.count, 0);
  }, false);

  await test("sector operations require and preserve an established Command Centre", async value => {
    assert.equal((await request(value, { action: "initialize" })).status, 409);
    const first = await establish(value);
    assert.ok(first.profile);
    assert.equal(first.deployment.capacity, 3);
    assert.equal(first.resources.resolvedExpeditions, 0);
    await establish(value);
    assert.equal(value.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_survival_command_profiles").get()?.count, 1);
  });

  await test("server unlocks, timing and one active team are enforced", async value => {
    await establish(value);
    assert.equal((await request(value, { action: "deploy", sector: "rail_yard", approach: "balanced", requestId: randomUUID() })).status, 409);
    const started = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "scout", requestId: randomUUID(), reward: 9999 }));
    assert.equal(started.expedition?.sector, "perimeter");
    assert.equal(started.expedition?.state, "in-transit");
    assert.equal(started.expedition?.incident, null);
    assert.equal(started.deployment.used, 1);
    assert.equal((await request(value, { action: "deploy", sector: "perimeter", approach: "breach", requestId: randomUUID() })).status, 409);
  });

  await test("only server-ready expeditions accept a valid decision and record rewards once", async value => {
    await establish(value);
    const started = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "balanced", requestId: randomUUID() }));
    const expedition = started.expedition!;
    assert.equal((await request(value, { action: "resolve", expeditionId: expedition.id, version: expedition.version, requestId: randomUUID(), decision: "extract" })).status, 409);
    value.db.sqlite.prepare("UPDATE dzn_survival_command_expeditions SET ready_at = started_at + 1 WHERE id = ?").run(expedition.id);
    const ready = await payload(await request(value));
    assert.equal(ready.expedition?.state, "ready");
    assert.ok(ready.expedition?.incident?.actions.length);
    assert.equal((await request(value, { action: "resolve", expeditionId: expedition.id, version: expedition.version, requestId: randomUUID(), decision: "invent" })).status, 400);
    const decision = ready.expedition!.incident!.actions[0]!;
    const resolveId = randomUUID();
    const resolved = await payload(await request(value, { action: "resolve", expeditionId: expedition.id, version: expedition.version, requestId: resolveId, decision }));
    assert.equal(resolved.expedition, null);
    assert.equal(resolved.history.length, 1);
    assert.ok(resolved.resources.salvage > 0 && resolved.resources.intel > 0);
    const replay = await payload(await request(value, { action: "resolve", expeditionId: expedition.id, version: expedition.version, requestId: resolveId, decision }));
    assert.equal(replay.history.length, 1);
    assert.equal(value.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_survival_command_resolution_ledger").get()?.count, 1);
  });

  await test("expeditions and dossiers remain scoped to their initiating player", async value => {
    await establish(value);
    const started = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "balanced", requestId: randomUUID() }));
    assert.equal((await request(value, { action: "resolve", expeditionId: started.expedition!.id, version: 0, requestId: randomUUID(), decision: "secure" }, { cookie: value.otherCookie })).status, 404);
    assert.equal(value.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_survival_command_resolution_ledger").get()?.count, 0);
  });

  await test("daily capacity is debited by the selected sector cost, not the number of clicks", async value => {
    await establish(value);
    for (let index = 0; index < 3; index++) {
      value.db.sqlite.prepare(`INSERT INTO dzn_survival_command_expeditions
        (id, user_id, request_id, sector, approach, status, seed, deployment_day, deployment_cost, started_at, ready_at, resolved_at)
        VALUES (?, 'local-player', ?, 'perimeter', 'scout', 'resolved', '1234567890123456', ?, 1, ?, ?, ?)`)
        .run(randomUUID(), randomUUID(), new Date().toISOString().slice(0, 10), index + 1, index + 2, index + 2);
    }
    assert.equal((await request(value, { action: "deploy", sector: "perimeter", approach: "balanced", requestId: randomUUID() })).status, 409);
  });

  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    for (const file of ["migrations/0107_dzn_command_centre.sql", "migrations/0108_dzn_survival_command_expeditions.sql"]) {
      const statements = readFileSync(file, "utf8").replace(/^--.*$/gm, "").split(";").map(value => value.trim()).filter(Boolean);
      for (const statement of statements) await db.prepare(statement).run();
    }
    for (const table of ["dzn_survival_command_profiles", "dzn_survival_command_expeditions", "dzn_survival_command_resolution_ledger"]) {
      assert.equal((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first<{ count: number }>())?.count, 0);
    }
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    const activeIndexes = await db.prepare("PRAGMA index_list('dzn_survival_command_expeditions')").all<{ name: string }>();
    assert.ok((activeIndexes.results ?? []).some((index: { name: string }) => index.name === "idx_dzn_survival_command_one_active_expedition"));
    await assert.rejects(db.prepare("INSERT INTO dzn_survival_command_expeditions (id, user_id, request_id, sector, approach, status, seed, deployment_day, deployment_cost, started_at, ready_at) VALUES ('x', 'missing', 'request', 'perimeter', 'scout', 'deployed', '1234567890123456', '2026-10-18', 1, 1, 2)").run());
    passed++; console.log("PASS local D1 migration constraints, indexes, foreign keys and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} Survival Command checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
