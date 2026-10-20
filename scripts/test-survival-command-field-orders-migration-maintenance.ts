import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest as deleteAccount } from "../functions/api/account/delete";
import { onRequest as maintenance } from "../functions/api/health/survival-command-field-orders-migration";
import { handleCommandCentre } from "../functions/_lib/command-centre";
import { handleSurvivalCommand } from "../functions/_lib/survival-command";
import { gamesFixture } from "./lib/games-hub-local";

const wrangler = readFileSync("wrangler.toml", "utf8");
const productionBlock = wrangler.match(/\[env\.production\.vars\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
assert.doesNotMatch(productionBlock, /^DZN_SURVIVAL_COMMAND_FIELD_ORDERS_MIGRATION_MAINTENANCE = /m);
assert.match(productionBlock, /^DZN_ACCOUNT_DELETE_ENABLED = "true"$/m);
assert.doesNotMatch(productionBlock, /^DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED = "true"$/m);

async function run() {
  const fixture = await gamesFixture();
  try {
    fixture.db.sqlite.exec(readFileSync("migrations/0107_dzn_command_centre.sql", "utf8"));
    fixture.db.sqlite.exec(readFileSync("migrations/0108_dzn_survival_command_expeditions.sql", "utf8"));
    fixture.db.sqlite.exec(readFileSync("migrations/0109_dzn_survival_command_loadouts.sql", "utf8"));
    fixture.env.DZN_COMMAND_CENTRE_ENABLED = "true";
    fixture.env.DZN_SURVIVAL_COMMAND_ENABLED = "true";
    fixture.env.DZN_SURVIVAL_COMMAND_FIELD_ORDERS_MIGRATION_MAINTENANCE = "true";
    fixture.env.DZN_ACCOUNT_DELETE_ENABLED = "false";
    assert.equal((await handleCommandCentre(new Request("https://local.test/api/player/command-centre", {
      method: "POST",
      headers: { cookie: fixture.cookie, origin: "https://local.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "initialize" }),
    }), fixture.env)).status, 200);

    const active = await maintenance({
      request: new Request("https://local.test/api/health/survival-command-field-orders-migration"),
      env: fixture.env,
    } as Parameters<typeof maintenance>[0]);
    assert.equal(active.status, 200, "The maintenance signal must prove Survival Command and account closure writes are paused.");
    assert.deepEqual(await active.json(), { status: "survival-command-field-orders-maintenance" });
    assert.equal((await maintenance({
      request: new Request("https://local.test/api/health/survival-command-field-orders-migration", { method: "POST" }),
      env: fixture.env,
    } as Parameters<typeof maintenance>[0])).status, 405);

    const readResponse = await handleSurvivalCommand(new Request("https://local.test/api/player/survival-command", {
      headers: { cookie: fixture.cookie },
    }), fixture.env);
    assert.equal(readResponse.status, 200, "Survival Command reads should remain available during the migration window.");
    const pausedWrite = await handleSurvivalCommand(new Request("https://local.test/api/player/survival-command", {
      method: "POST",
      headers: { cookie: fixture.cookie, origin: "https://local.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "initialize" }),
    }), fixture.env);
    assert.equal(pausedWrite.status, 503, "Survival Command writes must stop before preserved expeditions are fingerprinted.");
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM dzn_survival_command_profiles").get()?.count, 0);

    const deleteResponse = await deleteAccount({
      request: new Request("https://local.test/api/account/delete", {
        method: "POST",
        headers: { cookie: fixture.cookie, "content-type": "application/json" },
        body: JSON.stringify({ final_confirmed: true, confirmation_text: "DELETE MY DZN ACCOUNT" }),
      }),
      env: fixture.env,
    } as Parameters<typeof deleteAccount>[0]);
    assert.equal(deleteResponse.status, 503, "Account closure must stop before it can cascade-delete preserved expeditions.");

    fixture.env.DZN_SURVIVAL_COMMAND_FIELD_ORDERS_MIGRATION_MAINTENANCE = "false";
    fixture.env.DZN_ACCOUNT_DELETE_ENABLED = "true";
    assert.equal((await maintenance({
      request: new Request("https://local.test/api/health/survival-command-field-orders-migration"),
      env: fixture.env,
    } as Parameters<typeof maintenance>[0])).status, 404);
    const resumedWrite = await handleSurvivalCommand(new Request("https://local.test/api/player/survival-command", {
      method: "POST",
      headers: { cookie: fixture.cookie, origin: "https://local.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "initialize" }),
    }), fixture.env);
    assert.equal(resumedWrite.status, 200, "Survival Command writes must resume when maintenance is removed.");
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM dzn_survival_command_profiles").get()?.count, 1);
    console.log("Survival Command field-order migration maintenance tests passed.");
  } finally {
    fixture.db.sqlite.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
