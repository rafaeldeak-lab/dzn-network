import assert from "node:assert/strict";
import { unstable_readConfig } from "wrangler";

const production = unstable_readConfig({ config: "wrangler.toml", env: "production" });
assert.equal(production.vars.DZN_GAMES_RANGER_RANGE_ENABLED, "false");
assert.equal(unstable_readConfig({ config: "wrangler.toml", env: "preview" }).vars.DZN_GAMES_RANGER_RANGE_ENABLED, undefined);
console.log("PASS Ranger Range remains disabled until its isolated production migration and verification are complete.");
