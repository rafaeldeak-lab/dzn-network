import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest as deleteAccount } from "../functions/api/account/delete";
import { onRequest as maintenance } from "../functions/api/health/night-run-route-control-migration";
import { handleGamesNightRun } from "../functions/_lib/games-night-run";
import { gamesFixture } from "./lib/games-hub-local";

const wrangler = readFileSync("wrangler.toml", "utf8");
const productionBlock = wrangler.match(/\[env\.production\.vars\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
assert.match(productionBlock, /^DZN_GAMES_NIGHT_RUN_ENABLED = "true"$/m);
assert.doesNotMatch(productionBlock, /^DZN_NIGHT_RUN_ROUTE_CONTROL_MIGRATION_MAINTENANCE = /m);
assert.doesNotMatch(productionBlock, /^DZN_CIRCUIT_FORGE_GRID_CONTROL_MIGRATION_MAINTENANCE = /m);
assert.match(productionBlock, /^DZN_ACCOUNT_DELETE_ENABLED = "true"$/m);

async function run() {
  const fixture = await gamesFixture();
  try {
    fixture.db.sqlite.exec(readFileSync("migrations/0104_games_hub_night_run.sql", "utf8"));
    fixture.db.sqlite.exec(readFileSync("migrations/0105_games_hub_night_run_recon.sql", "utf8"));
    fixture.db.sqlite.exec(readFileSync("migrations/0110_games_hub_night_run_route_control.sql", "utf8"));
    fixture.env.DZN_GAMES_NIGHT_RUN_ENABLED = "true";
    fixture.env.DZN_GAMES_NIGHT_RUN_RECON_ENABLED = "true";
    fixture.env.DZN_NIGHT_RUN_ROUTE_CONTROL_MIGRATION_MAINTENANCE = "true";
    fixture.env.DZN_ACCOUNT_DELETE_ENABLED = "false";

    const active = await maintenance({ request: new Request("https://local.test/api/health/night-run-route-control-migration"), env: fixture.env } as Parameters<typeof maintenance>[0]);
    assert.equal(active.status, 200, "The maintenance signal must prove Night Run and account closure writes are paused.");
    assert.deepEqual(await active.json(), { status: "night-run-route-control-maintenance" });
    assert.equal((await maintenance({ request: new Request("https://local.test/api/health/night-run-route-control-migration", { method: "POST" }), env: fixture.env } as Parameters<typeof maintenance>[0])).status, 405);

    const readResponse = await handleGamesNightRun(new Request("https://local.test/api/games/night-run", { headers: { cookie: fixture.cookie } }), fixture.env);
    assert.equal(readResponse.status, 200, "Night Run reads should remain available during the migration window.");
    const pausedStart = await handleGamesNightRun(new Request("https://local.test/api/games/night-run", {
      method: "POST",
      headers: { cookie: fixture.cookie, origin: "https://local.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }), fixture.env);
    assert.equal(pausedStart.status, 503, "Night Run writes must stop before they can alter preserved sessions.");
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM dzn_night_run_sessions").get()?.count, 0);

    const deleteResponse = await deleteAccount({
      request: new Request("https://local.test/api/account/delete", {
        method: "POST",
        headers: { cookie: fixture.cookie, "content-type": "application/json" },
        body: JSON.stringify({ final_confirmed: true, confirmation_text: "DELETE MY DZN ACCOUNT" }),
      }),
      env: fixture.env,
    } as Parameters<typeof deleteAccount>[0]);
    assert.equal(deleteResponse.status, 503, "Account closure must stop before it can cascade-delete preserved sessions.");
    assert.ok(fixture.db.sqlite.prepare("SELECT id FROM users WHERE id = 'local-player'").get());

    fixture.env.DZN_NIGHT_RUN_ROUTE_CONTROL_MIGRATION_MAINTENANCE = "false";
    fixture.env.DZN_ACCOUNT_DELETE_ENABLED = "true";
    assert.equal((await maintenance({ request: new Request("https://local.test/api/health/night-run-route-control-migration"), env: fixture.env } as Parameters<typeof maintenance>[0])).status, 404);
    const resumedStart = await handleGamesNightRun(new Request("https://local.test/api/games/night-run", {
      method: "POST",
      headers: { cookie: fixture.cookie, origin: "https://local.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }), fixture.env);
    assert.equal(resumedStart.status, 200, "Night Run writes must resume once maintenance is removed.");
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM dzn_night_run_sessions").get()?.count, 1);
    console.log("Night Run route-control migration maintenance tests passed.");
  } finally {
    fixture.db.sqlite.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
