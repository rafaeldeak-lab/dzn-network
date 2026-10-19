import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest as deleteAccount } from "../functions/api/account/delete";
import { onRequest as maintenance } from "../functions/api/health/survival-command-loadout-migration";
import { gamesFixture } from "./lib/games-hub-local";

const wrangler = readFileSync("wrangler.toml", "utf8");
const productionBlock = wrangler.match(/\[env\.production\.vars\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
assert.match(productionBlock, /^DZN_ACCOUNT_DELETE_ENABLED = "true"$/m, "Account closure must be restored after the protected 0109 release completes.");

async function run() {
  const fixture = await gamesFixture();
  try {
    fixture.env.DZN_ACCOUNT_DELETE_ENABLED = "false";
    const active = await maintenance({ request: new Request("https://local.test/api/health/survival-command-loadout-migration"), env: fixture.env } as Parameters<typeof maintenance>[0]);
    assert.equal(active.status, 200, "The dedicated maintenance signal must prove account closure is paused.");
    assert.deepEqual(await active.json(), { status: "survival-command-loadout-maintenance" });
    const deleteResponse = await deleteAccount({
      request: new Request("https://local.test/api/account/delete", {
        method: "POST",
        headers: { cookie: fixture.cookie, "content-type": "application/json" },
        body: JSON.stringify({ final_confirmed: true, confirmation_text: "DELETE MY DZN ACCOUNT" }),
      }),
      env: fixture.env,
    } as Parameters<typeof deleteAccount>[0]);
    assert.equal(deleteResponse.status, 503, "Protected maintenance must block a signed-in account closure before it can alter expedition rows.");
    assert.equal((await maintenance({ request: new Request("https://local.test/api/health/survival-command-loadout-migration", { method: "POST" }), env: fixture.env } as Parameters<typeof maintenance>[0])).status, 405);

    fixture.env.DZN_ACCOUNT_DELETE_ENABLED = "true";
    assert.equal((await maintenance({ request: new Request("https://local.test/api/health/survival-command-loadout-migration"), env: fixture.env } as Parameters<typeof maintenance>[0])).status, 404, "The maintenance signal must disappear when account closure is restored.");
    console.log("Survival Command loadout migration maintenance tests passed.");
  } finally {
    fixture.db.sqlite.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
