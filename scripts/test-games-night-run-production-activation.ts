import assert from "node:assert/strict";
import { unstable_readConfig } from "wrangler";

const production = unstable_readConfig({ config: "wrangler.toml", env: "production" });
assert.equal(production.vars.DZN_GAMES_NIGHT_RUN_ENABLED, "true");
assert.equal(production.vars.DZN_GAMES_NIGHT_RUN_RECON_ENABLED, undefined);
assert.equal(production.vars.DZN_GAMES_NIGHT_RUN_ROUTE_CONTROL_ENABLED, undefined);
assert.equal(unstable_readConfig({ config: "wrangler.toml", env: "preview" }).vars.DZN_GAMES_NIGHT_RUN_ENABLED, undefined);
console.log("PASS Night Run recon remains disabled until its isolated migration verification.");
