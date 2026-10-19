import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest as deleteAccount } from "../functions/api/account/delete";
import { onRequest as migrationMaintenance } from "../functions/api/health/state-preserving-migration";
import { gamesFixture } from "./lib/games-hub-local";

async function request(env: CloudflareEnv, cookie = "") {
  return deleteAccount({
    request: new Request("https://local.test/api/account/delete", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ final_confirmed: true, confirmation_text: "DELETE MY DZN ACCOUNT" }),
    }),
    env,
  } as Parameters<typeof deleteAccount>[0]);
}

function maintenanceRequest(env: CloudflareEnv, method = "GET") {
  return migrationMaintenance({ request: new Request("https://local.test/api/health/state-preserving-migration", { method }), env } as Parameters<typeof migrationMaintenance>[0]);
}

async function run() {
  const accountDeletionRoute = readFileSync("functions/api/account/delete.ts", "utf8");
  assert.match(
    accountDeletionRoute,
    /DZN_ACCOUNT_DELETE_ENABLED === "false"[\s\S]*?reserveAccountDeletionOperation\(env, user\.id\)[\s\S]*?try \{[\s\S]*?const body = await readJson/,
    "An accepted account-delete request must publish its operation marker before reading its body.",
  );
  assert.match(
    accountDeletionRoute,
    /finally \{\s*if \(!deletionOperationHandedOff\) await releaseAccountDeletionOperation/,
    "An account-delete request that exits before handoff must release its operation marker.",
  );
  const fixture = await gamesFixture();
  try {
    fixture.env.DZN_GAMES_CIPHER_GRID_ENABLED = "false";
    fixture.env.DZN_ACCOUNT_DELETE_ENABLED = "false";
    const before = fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'local-player'").get()?.count;
    assert.equal((await request(fixture.env)).status, 401, "Maintenance must preserve the account endpoint's normal anonymous boundary.");
    assert.equal((await request(fixture.env, fixture.cookie)).status, 503, "A signed-in owner must not reach a destructive account path during maintenance.");
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'local-player'").get()?.count, before, "Maintenance must preserve the account and its cascading game state.");
    assert.equal((await maintenanceRequest(fixture.env)).status, 200, "The independent maintenance signal must prove both protected write paths are quiesced.");
    assert.equal((await maintenanceRequest(fixture.env, "POST")).status, 405, "The maintenance signal must remain read-only.");

    fixture.env.DZN_GAMES_CIPHER_GRID_ENABLED = "true";
    fixture.env.DZN_ACCOUNT_DELETE_ENABLED = "true";
    assert.equal((await maintenanceRequest(fixture.env)).status, 404, "The temporary maintenance signal must disappear after both protected paths are reactivated.");

    delete fixture.env.DZN_ACCOUNT_DELETE_ENABLED;
    assert.equal((await request(fixture.env)).status, 401, "The maintenance guard must not disable the normal authorization boundary outside the temporary production window.");
    assert.equal((await maintenanceRequest(fixture.env)).status, 404, "The maintenance signal must disappear when the protected window is not fully configured.");
    console.log("Account deletion maintenance guard tests passed.");
  } finally {
    fixture.db.sqlite.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
