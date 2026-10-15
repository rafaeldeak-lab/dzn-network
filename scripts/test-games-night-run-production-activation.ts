import assert from "node:assert/strict";
import { unstable_readConfig } from "wrangler";

const production = unstable_readConfig({ config: "wrangler.toml", env: "production" });
assert.equal(production.vars.DZN_GAMES_NIGHT_RUN_ENABLED, "false");
assert.equal(unstable_readConfig({ config: "wrangler.toml", env: "preview" }).vars.DZN_GAMES_NIGHT_RUN_ENABLED, undefined);
console.log("PASS Night Run remains disabled until its isolated production migration and verification are complete.");
