import assert from "node:assert/strict";
import { unstable_readConfig } from "wrangler";

const production = unstable_readConfig({ config: "wrangler.toml", env: "production" });
assert.equal(production.vars.DZN_GAMES_NIGHT_RUN_ENABLED, "true");
assert.equal(production.vars.DZN_GAMES_NIGHT_RUN_RECON_ENABLED, "true");
assert.equal(production.vars.DZN_GAMES_NIGHT_RUN_ROUTE_CONTROL_ENABLED, "true");
assert.equal(production.vars.DZN_ACCOUNT_DELETE_ENABLED, "true");
assert.equal(production.vars.DZN_NIGHT_RUN_ROUTE_CONTROL_MIGRATION_MAINTENANCE, undefined);
assert.equal(unstable_readConfig({ config: "wrangler.toml", env: "preview" }).vars.DZN_GAMES_NIGHT_RUN_ENABLED, undefined);
assert.equal(unstable_readConfig({ config: "wrangler.toml", env: "preview" }).vars.DZN_GAMES_NIGHT_RUN_RECON_ENABLED, undefined);
assert.equal(unstable_readConfig({ config: "wrangler.toml", env: "preview" }).vars.DZN_GAMES_NIGHT_RUN_ROUTE_CONTROL_ENABLED, undefined);
console.log("PASS Night Run route control is enabled in production only after its isolated migration verification.");
