import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { handleCommandCentre } from "../functions/_lib/command-centre";
import { eraseOrRetainAccountUser } from "../functions/_lib/deletion";
import { handleSurvivalCommand } from "../functions/_lib/survival-command";
import type { Env } from "../functions/_lib/types";
import { resolveSurvivalCommandOutcome, survivalCommandDailyDirectiveFor, type SurvivalCommandAction, type SurvivalCommandPayload } from "../lib/survival-command";
import { gamesFixture } from "./lib/games-hub-local";

type Fixture = Awaited<ReturnType<typeof fixture>>;
let passed = 0;

async function fixture(migrate = true, fieldOrders = false) {
  const value = await gamesFixture();
  value.db.sqlite.exec(readFileSync("migrations/0107_dzn_command_centre.sql", "utf8"));
  if (migrate) {
    value.db.sqlite.exec(readFileSync("migrations/0108_dzn_survival_command_expeditions.sql", "utf8"));
    value.db.sqlite.exec(readFileSync("migrations/0109_dzn_survival_command_loadouts.sql", "utf8"));
    if (fieldOrders) value.db.sqlite.exec(readFileSync("migrations/0112_dzn_survival_command_field_orders.sql", "utf8"));
  }
  (value.env as Env).DZN_COMMAND_CENTRE_ENABLED = "true";
  (value.env as Env).DZN_SURVIVAL_COMMAND_ENABLED = "true";
  (value.env as Env).DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED = fieldOrders ? "true" : "false";
  return value;
}

async function test(name: string, action: (value: Fixture) => Promise<void>, migrate = true, fieldOrders = false) {
  const value = await fixture(migrate, fieldOrders);
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

function creditRecoveredResources(value: Fixture, salvage: number, intel: number) {
  const expeditionId = randomUUID();
  const requestId = randomUUID();
  const now = Date.now();
  value.db.sqlite.prepare(`INSERT INTO dzn_survival_command_expeditions
    (id, user_id, request_id, sector, approach, status, seed, deployment_day, deployment_cost, started_at, ready_at, resolved_at)
    VALUES (?, 'local-player', ?, 'perimeter', 'balanced', 'resolved', '1234567890123456', ?, 1, ?, ?, ?)`)
    .run(expeditionId, requestId, new Date(now).toISOString().slice(0, 10), now - 2, now - 1, now);
  value.db.sqlite.prepare(`INSERT INTO dzn_survival_command_resolution_ledger
    (id, user_id, expedition_id, request_id, action, outcome, salvage, intel, outcome_fingerprint, resolved_at)
    VALUES (?, 'local-player', ?, ?, 'secure', 'clean', ?, ?, '1234abcd', ?)`)
    .run(randomUUID(), expeditionId, randomUUID(), salvage, intel, now);
}

async function run() {
  const source = readFileSync("functions/_lib/survival-command.ts", "utf8");
  const migration = readFileSync("migrations/0108_dzn_survival_command_expeditions.sql", "utf8");
  const loadoutMigration = readFileSync("migrations/0109_dzn_survival_command_loadouts.sql", "utf8");
  const fieldOrdersMigration = readFileSync("migrations/0112_dzn_survival_command_field_orders.sql", "utf8");
  const client = readFileSync("components/survival-command/survival-command.tsx", "utf8");
  const scene = readFileSync("components/survival-command/survival-command-scene.tsx", "utf8");
  const styles = readFileSync("components/survival-command/survival-command.module.css", "utf8");
  const deletion = readFileSync("functions/_lib/deletion.ts", "utf8");
  const playerHubRoute = readFileSync("functions/api/player/hub.ts", "utf8");
  const playerHome = readFileSync("components/player/player-home.tsx", "utf8");
  assert.match(source, /DZN_SURVIVAL_COMMAND_ENABLED !== "true"/);
  assert.match(source, /resolveSurvivalCommandOutcome/);
  assert.match(source, /SUM\(deployment_cost\)/);
  assert.match(source, /unlock-loadout/);
  assert.match(source, /dzn_survival_command_spend_ledger/);
  assert.match(source, /set-field-order/);
  assert.match(source, /DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED/);
  assert.match(source, /survivalCommandDailyDirectiveFor/);
  assert.match(source, /directiveAlreadyCompleted/);
  assert.match(source, /request\.headers\.get\("origin"\)/);
  assert.match(migration, /idx_dzn_survival_command_one_active_expedition/);
  assert.match(migration, /UNIQUE \(user_id, request_id\)/);
  assert.match(loadoutMigration, /ALTER TABLE dzn_survival_command_expeditions/);
  assert.match(loadoutMigration, /dzn_survival_command_loadout_unlocks/);
  assert.match(fieldOrdersMigration, /field_order_request_id/);
  assert.match(fieldOrdersMigration, /idx_dzn_survival_command_field_order_request/);
  assert.match(client, /Route plan/);
  assert.match(client, /readyRefreshRef/);
  assert.match(client, /activeRemaining > 0/);
  assert.match(client, /serverDayKey/);
  assert.match(client, /payload\.deployment\.dayKey === serverDayKey/);
  assert.match(client, /deployment\.used \+ selected\.deploymentCost > deployment\.capacity/);
  assert.match(client, /Base recovery estimates only/);
  assert.match(client, /Field loadout/);
  assert.match(client, /Daily directive/);
  assert.match(client, /Directive route matched/);
  assert.match(scene, /dznSurvivalCommandCanvas/);
  assert.match(client, /Set the field order/);
  assert.match(client, /Tactical command window/);
  assert.match(client, /selected route\{order \? ", locked field order," : ""\}/);
  assert.doesNotMatch(client, /Build a route, send a team, lock a tactical protocol/);
  assert.match(scene, /fieldOrderColours/);
  assert.match(styles, /survival-command-field-command-v2\.png/);
  assert.match(deletion, /dzn_survival_command_resolution_ledger/);
  assert.match(deletion, /dzn_survival_command_spend_ledger/);
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
    assert.equal((await request(value, { action: "deploy", sector: "rail_yard", approach: "balanced", loadout: "field_kit", requestId: randomUUID() })).status, 409);
    const started = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "scout", loadout: "field_kit", requestId: randomUUID(), reward: 9999 }));
    assert.equal(started.expedition?.sector, "perimeter");
    assert.equal(started.expedition?.state, "in-transit");
    assert.equal(started.expedition?.incident, null);
    assert.equal(started.deployment.used, 1);
    assert.equal((await request(value, { action: "deploy", sector: "perimeter", approach: "breach", loadout: "field_kit", requestId: randomUUID() })).status, 409);
  });

  await test("only server-ready expeditions accept a valid decision and record rewards once", async value => {
    await establish(value);
    const started = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "balanced", loadout: "field_kit", requestId: randomUUID() }));
    const expedition = started.expedition!;
    assert.equal((await request(value, { action: "resolve", expeditionId: expedition.id, version: expedition.version, requestId: randomUUID(), decision: "extract" })).status, 409);
    value.db.sqlite.prepare("UPDATE dzn_survival_command_expeditions SET started_at = 0, ready_at = 1 WHERE id = ?").run(expedition.id);
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

  await test("field-order controls stay hidden and reject writes until their separate flag is enabled", async value => {
    value.db.sqlite.exec(readFileSync("migrations/0112_dzn_survival_command_field_orders.sql", "utf8"));
    await establish(value);
    const started = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "balanced", loadout: "field_kit", requestId: randomUUID() }));
    value.db.sqlite.prepare("UPDATE dzn_survival_command_expeditions SET started_at = 0, ready_at = 1 WHERE id = ?").run(started.expedition!.id);
    const ready = await payload(await request(value));
    assert.equal(ready.fieldOrdersAvailable, false);
    assert.ok(ready.expedition?.incident?.actions.length);
    assert.equal((await request(value, { action: "set-field-order", expeditionId: started.expedition!.id, version: ready.expedition!.version, order: "intercept", requestId: randomUUID() })).status, 409);
  });

  await test("field orders create an authoritative tactical phase before the final incident resolution", async value => {
    await establish(value);
    const started = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "balanced", loadout: "field_kit", requestId: randomUUID() }));
    value.db.sqlite.prepare("UPDATE dzn_survival_command_expeditions SET started_at = 0, ready_at = 1 WHERE id = ?").run(started.expedition!.id);
    const ready = await payload(await request(value));
    assert.equal(ready.fieldOrdersAvailable, true);
    assert.equal(ready.expedition?.fieldOrder, null);
    assert.equal(ready.expedition?.incident, null);
    assert.equal((await request(value, { action: "resolve", expeditionId: started.expedition!.id, version: ready.expedition!.version, requestId: randomUUID(), decision: "secure" })).status, 409);
    const orderRequestId = randomUUID();
    const ordered = await payload(await request(value, { action: "set-field-order", expeditionId: started.expedition!.id, version: ready.expedition!.version, order: "intercept", requestId: orderRequestId }));
    assert.equal(ordered.expedition?.fieldOrder, "intercept");
    assert.equal(ordered.expedition?.version, ready.expedition!.version + 1);
    assert.ok(ordered.expedition?.incident?.actions.length);
    const replay = await payload(await request(value, { action: "set-field-order", expeditionId: started.expedition!.id, version: ready.expedition!.version, order: "intercept", requestId: orderRequestId }));
    assert.equal(replay.expedition?.fieldOrder, "intercept");
    assert.equal((await request(value, { action: "set-field-order", expeditionId: started.expedition!.id, version: ordered.expedition!.version, order: "recovery", requestId: orderRequestId })).status, 409);
    assert.equal((await request(value, { action: "set-field-order", expeditionId: started.expedition!.id, version: ordered.expedition!.version, order: "recovery", requestId: randomUUID() }, { cookie: value.otherCookie })).status, 404);
    const decision = ordered.expedition!.incident!.actions[0]!;
    const resolved = await payload(await request(value, { action: "resolve", expeditionId: started.expedition!.id, version: ordered.expedition!.version, requestId: randomUUID(), decision }));
    assert.equal(resolved.expedition, null);
    assert.equal(resolved.history[0]?.fieldOrder, "intercept");
    assert.equal(value.db.sqlite.prepare("SELECT field_order FROM dzn_survival_command_expeditions WHERE id = ?").get(started.expedition!.id)?.field_order, "intercept");
  }, true, true);

  await test("a locked field order remains visible and authoritative after its rollout flag is disabled", async value => {
    await establish(value);
    const started = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "balanced", loadout: "field_kit", requestId: randomUUID() }));
    value.db.sqlite.prepare("UPDATE dzn_survival_command_expeditions SET started_at = 0, ready_at = 1 WHERE id = ?").run(started.expedition!.id);
    const ready = await payload(await request(value));
    const ordered = await payload(await request(value, { action: "set-field-order", expeditionId: started.expedition!.id, version: ready.expedition!.version, order: "intercept", requestId: randomUUID() }));
    const decision = ordered.expedition!.incident!.actions[0]!;
    value.env.DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED = "false";
    const rolledBack = await payload(await request(value));
    assert.equal(rolledBack.fieldOrdersAvailable, false);
    assert.equal(rolledBack.expedition?.fieldOrder, "intercept");
    assert.ok(rolledBack.expedition?.incident?.actions.length);
    const resolved = await payload(await request(value, { action: "resolve", expeditionId: started.expedition!.id, version: rolledBack.expedition!.version, requestId: randomUUID(), decision }));
    assert.equal(resolved.history[0]?.fieldOrder, "intercept");
  }, true, true);

  await test("expeditions and dossiers remain scoped to their initiating player", async value => {
    await establish(value);
    const started = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "balanced", loadout: "field_kit", requestId: randomUUID() }));
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
    assert.equal((await request(value, { action: "deploy", sector: "perimeter", approach: "balanced", loadout: "field_kit", requestId: randomUUID() })).status, 409);
  });

  await test("field loadouts use an earned server ledger and persist with the expedition", async value => {
    await establish(value);
    assert.equal((await request(value, { action: "unlock-loadout", loadout: "signal_scanner", requestId: randomUUID() })).status, 409);
    creditRecoveredResources(value, 70, 40);
    const unlockId = randomUUID();
    const unlocked = await payload(await request(value, { action: "unlock-loadout", loadout: "signal_scanner", requestId: unlockId }));
    assert.equal(unlocked.loadouts.find(entry => entry.key === "signal_scanner")?.unlocked, true);
    assert.equal(unlocked.resources.salvage, 60);
    assert.equal(unlocked.resources.intel, 32);
    const replay = await payload(await request(value, { action: "unlock-loadout", loadout: "signal_scanner", requestId: unlockId }));
    assert.equal(replay.resources.salvage, 60);
    assert.equal(value.db.sqlite.prepare("SELECT COUNT(*) count FROM dzn_survival_command_spend_ledger").get()?.count, 1);
    assert.equal((await request(value, { action: "unlock-loadout", loadout: "recovery_kit", requestId: unlockId })).status, 409);
    assert.equal((await request(value, { action: "deploy", sector: "perimeter", approach: "scout", loadout: "unreleased", requestId: randomUUID() })).status, 400);
    const started = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "scout", loadout: "signal_scanner", requestId: randomUUID() }));
    assert.equal(started.expedition?.loadout, "signal_scanner");
  });

  await test("field loadouts change deterministic mission risk and recovery, not only presentation", async () => {
    const buildings = { headquarters: 4, workshop: 3, watchtower: 3, communications: 3 };
    const base = resolveSurvivalCommandOutcome({ seed: "scanner-proof-seed", sector: "radio_ridge", approach: "scout", loadout: "field_kit", action: "triangulate", buildings });
    const scanner = resolveSurvivalCommandOutcome({ seed: "scanner-proof-seed", sector: "radio_ridge", approach: "scout", loadout: "signal_scanner", action: "triangulate", buildings });
    assert.ok(scanner.intel > base.intel);
    const protectedSeed = Array.from({ length: 300 }, (_, index) => `plating-proof-${index}`).find(seed => {
      const basic = resolveSurvivalCommandOutcome({ seed, sector: "blacksite", approach: "breach", loadout: "field_kit", action: "bridge", buildings });
      const plated = resolveSurvivalCommandOutcome({ seed, sector: "blacksite", approach: "breach", loadout: "convoy_plating", action: "bridge", buildings });
      return basic.outcome === "strained" && plated.outcome !== "strained";
    });
    assert.ok(protectedSeed, "Convoy plating should reduce the deterministic strained-return range.");
  });

  await test("field orders alter deterministic recovery and risk rather than only changing presentation", async () => {
    const buildings = { headquarters: 4, workshop: 3, watchtower: 3, communications: 3 };
    const base = resolveSurvivalCommandOutcome({ seed: "field-order-proof", sector: "radio_ridge", approach: "balanced", loadout: "field_kit", action: "triangulate", buildings });
    const intercept = resolveSurvivalCommandOutcome({ seed: "field-order-proof", sector: "radio_ridge", approach: "balanced", loadout: "field_kit", action: "triangulate", buildings, fieldOrder: "intercept" });
    const recovery = resolveSurvivalCommandOutcome({ seed: "field-order-proof", sector: "radio_ridge", approach: "balanced", loadout: "field_kit", action: "triangulate", buildings, fieldOrder: "recovery" });
    assert.ok(intercept.intel > base.intel);
    assert.ok(recovery.salvage > base.salvage);
    const protectedSeed = Array.from({ length: 500 }, (_, index) => `overwatch-proof-${index}`).find(seed => {
      const unprotected = resolveSurvivalCommandOutcome({ seed, sector: "blacksite", approach: "breach", loadout: "field_kit", action: "bridge", buildings });
      const overwatch = resolveSurvivalCommandOutcome({ seed, sector: "blacksite", approach: "breach", loadout: "field_kit", action: "bridge", buildings, fieldOrder: "overwatch" });
      return unprotected.outcome === "strained" && overwatch.outcome !== "strained";
    });
    assert.ok(protectedSeed, "Overwatch should reduce the deterministic strained-return range.");
  });

  await test("daily directives are deterministic, server-owned and paid only once per deployment day", async value => {
    await establish(value);
    const directiveDay = Array.from({ length: 180 }, (_, index) => `2034-05-${String((index % 28) + 1).padStart(2, "0")}`)
      .find(day => {
        const directive = survivalCommandDailyDirectiveFor("local-player", day);
        return directive.sector === "perimeter" && directive.approach === "scout";
      });
    assert.ok(directiveDay);
    const directive = survivalCommandDailyDirectiveFor("local-player", directiveDay!);
    assert.deepEqual(survivalCommandDailyDirectiveFor("local-player", directiveDay!), directive);

    const first = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "scout", loadout: "field_kit", requestId: randomUUID() }));
    value.db.sqlite.prepare("UPDATE dzn_survival_command_expeditions SET deployment_day = ?, started_at = 0, ready_at = 1 WHERE id = ?").run(directiveDay, first.expedition!.id);
    const ready = await payload(await request(value));
    const action = ready.expedition!.incident!.actions[0]! as SurvivalCommandAction;
    const firstSeed = (value.db.sqlite.prepare("SELECT seed FROM dzn_survival_command_expeditions WHERE id = ?").get(first.expedition!.id) as { seed: string } | undefined)?.seed;
    assert.ok(firstSeed);
    const base = resolveSurvivalCommandOutcome({ seed: firstSeed, sector: "perimeter", approach: "scout", loadout: "field_kit", action, buildings: ready.buildings! });
    await payload(await request(value, { action: "resolve", expeditionId: ready.expedition!.id, version: ready.expedition!.version, requestId: randomUUID(), decision: action }));
    const firstLedger = value.db.sqlite.prepare("SELECT salvage, intel FROM dzn_survival_command_resolution_ledger WHERE expedition_id = ?").get(first.expedition!.id);
    assert.equal(firstLedger?.salvage, base.salvage + directive.bonus.salvage);
    assert.equal(firstLedger?.intel, base.intel + directive.bonus.intel);

    const second = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "scout", loadout: "field_kit", requestId: randomUUID() }));
    value.db.sqlite.prepare("UPDATE dzn_survival_command_expeditions SET deployment_day = ?, started_at = 0, ready_at = 1 WHERE id = ?").run(directiveDay, second.expedition!.id);
    const secondReady = await payload(await request(value));
    const secondAction = secondReady.expedition!.incident!.actions[0]! as SurvivalCommandAction;
    const secondSeed = (value.db.sqlite.prepare("SELECT seed FROM dzn_survival_command_expeditions WHERE id = ?").get(second.expedition!.id) as { seed: string } | undefined)?.seed;
    assert.ok(secondSeed);
    const secondBase = resolveSurvivalCommandOutcome({ seed: secondSeed, sector: "perimeter", approach: "scout", loadout: "field_kit", action: secondAction, buildings: secondReady.buildings! });
    await payload(await request(value, { action: "resolve", expeditionId: secondReady.expedition!.id, version: secondReady.expedition!.version, requestId: randomUUID(), decision: secondAction }));
    const secondLedger = value.db.sqlite.prepare("SELECT salvage, intel FROM dzn_survival_command_resolution_ledger WHERE expedition_id = ?").get(second.expedition!.id);
    assert.equal(secondLedger?.salvage, secondBase.salvage);
    assert.equal(secondLedger?.intel, secondBase.intel);
  });

  await test("retained Store accounts erase every private Survival Command record", async value => {
    await establish(value);
    creditRecoveredResources(value, 70, 40);
    await payload(await request(value, { action: "unlock-loadout", loadout: "signal_scanner", requestId: randomUUID() }));
    const started = await payload(await request(value, { action: "deploy", sector: "perimeter", approach: "balanced", loadout: "field_kit", requestId: randomUUID() }));
    value.db.sqlite.prepare("UPDATE dzn_survival_command_expeditions SET started_at = 0, ready_at = 1 WHERE id = ?").run(started.expedition!.id);
    const ready = await payload(await request(value));
    await payload(await request(value, { action: "resolve", expeditionId: ready.expedition!.id, version: ready.expedition!.version, requestId: randomUUID(), decision: ready.expedition!.incident!.actions[0] }));
    value.db.sqlite.exec("CREATE TABLE store_orders (id TEXT PRIMARY KEY, purchasing_user_id TEXT NOT NULL)");
    value.db.sqlite.prepare("INSERT INTO store_orders (id, purchasing_user_id) VALUES ('retained-order', 'local-player')").run();
    assert.equal(await eraseOrRetainAccountUser(value.db as unknown as D1Database, "local-player"), 1);
    assert.match(String(value.db.sqlite.prepare("SELECT discord_id FROM users WHERE id = 'local-player'").get()?.discord_id), /^deleted-/);
    for (const table of ["dzn_survival_command_profiles", "dzn_survival_command_expeditions", "dzn_survival_command_resolution_ledger", "dzn_survival_command_loadout_unlocks", "dzn_survival_command_spend_ledger"]) {
      assert.equal(value.db.sqlite.prepare(`SELECT COUNT(*) count FROM ${table} WHERE user_id = 'local-player'`).get()?.count, 0);
    }
    assert.equal(value.db.sqlite.prepare("SELECT COUNT(*) count FROM store_orders WHERE purchasing_user_id = 'local-player'").get()?.count, 1);
  });

  const miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local test'); } }", d1Databases: ["DB"] });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.exec("PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('local-player');");
    for (const file of ["migrations/0107_dzn_command_centre.sql", "migrations/0108_dzn_survival_command_expeditions.sql", "migrations/0109_dzn_survival_command_loadouts.sql", "migrations/0112_dzn_survival_command_field_orders.sql"]) {
      const statements = readFileSync(file, "utf8").replace(/^--.*$/gm, "").split(";").map(value => value.trim()).filter(Boolean);
      for (const statement of statements) await db.prepare(statement).run();
    }
    for (const table of ["dzn_survival_command_profiles", "dzn_survival_command_expeditions", "dzn_survival_command_resolution_ledger", "dzn_survival_command_loadout_unlocks", "dzn_survival_command_spend_ledger"]) {
      assert.equal((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first<{ count: number }>())?.count, 0);
    }
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    const activeIndexes = await db.prepare("PRAGMA index_list('dzn_survival_command_expeditions')").all<{ name: string }>();
    assert.ok((activeIndexes.results ?? []).some((index: { name: string }) => index.name === "idx_dzn_survival_command_one_active_expedition"));
    const loadoutIndexes = await db.prepare("PRAGMA index_list('dzn_survival_command_spend_ledger')").all<{ name: string }>();
    assert.ok((loadoutIndexes.results ?? []).some((index: { name: string }) => index.name === "idx_dzn_survival_command_loadout_history"));
    const fieldOrderColumns = await db.prepare("PRAGMA table_info('dzn_survival_command_expeditions')").all<{ name: string }>();
    assert.deepEqual(["field_order", "field_order_request_id", "field_order_at"].every(column => (fieldOrderColumns.results ?? []).some((value: { name: string }) => value.name === column)), true);
    const fieldOrderIndexes = await db.prepare("PRAGMA index_list('dzn_survival_command_expeditions')").all<{ name: string }>();
    assert.ok((fieldOrderIndexes.results ?? []).some((index: { name: string }) => index.name === "idx_dzn_survival_command_field_order_request"));
    await assert.rejects(db.prepare("INSERT INTO dzn_survival_command_expeditions (id, user_id, request_id, sector, approach, loadout, status, seed, deployment_day, deployment_cost, started_at, ready_at, field_order) VALUES ('field-order-invalid', 'local-player', 'field-order-invalid', 'perimeter', 'scout', 'field_kit', 'deployed', '1234567890123456', '2026-10-18', 1, 1, 2, 'invalid')").run());
    await assert.rejects(db.prepare("INSERT INTO dzn_survival_command_expeditions (id, user_id, request_id, sector, approach, status, seed, deployment_day, deployment_cost, started_at, ready_at) VALUES ('x', 'missing', 'request', 'perimeter', 'scout', 'deployed', '1234567890123456', '2026-10-18', 1, 1, 2)").run());
    passed++; console.log("PASS local D1 migration constraints, indexes, foreign keys and zero-row baseline");
  } finally { await miniflare.dispose(); }
  console.log(`${passed} Survival Command checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
