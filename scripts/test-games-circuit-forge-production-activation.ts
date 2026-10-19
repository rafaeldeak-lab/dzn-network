import assert from "node:assert/strict";
import { unstable_readConfig } from "wrangler";

const production = unstable_readConfig({ config: "wrangler.toml", env: "production" });
assert.equal(production.vars.DZN_GAMES_CIRCUIT_FORGE_ENABLED, "true");
assert.equal(unstable_readConfig({ config: "wrangler.toml", env: "preview" }).vars.DZN_GAMES_CIRCUIT_FORGE_ENABLED, undefined);
assert.equal(production.vars.DZN_GAMES_CIRCUIT_FORGE_GRID_CONTROL_ENABLED, "true");
assert.equal(unstable_readConfig({ config: "wrangler.toml", env: "preview" }).vars.DZN_GAMES_CIRCUIT_FORGE_GRID_CONTROL_ENABLED, undefined);
assert.equal(production.vars.DZN_CIRCUIT_FORGE_GRID_CONTROL_MIGRATION_MAINTENANCE, undefined);
assert.equal(production.vars.DZN_ACCOUNT_DELETE_ENABLED, "true");
console.log("PASS Circuit Forge grid controls are enabled in production only after isolated migration verification and maintenance cleanup.");
