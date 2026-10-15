import assert from "node:assert/strict";
import { unstable_readConfig } from "wrangler";

const production = unstable_readConfig({ config: "wrangler.toml", env: "production" });
assert.equal(production.vars.DZN_GAMES_RANGER_RANGE_ENABLED, "true");
assert.equal(unstable_readConfig({ config: "wrangler.toml", env: "preview" }).vars.DZN_GAMES_RANGER_RANGE_ENABLED, undefined);
console.log("PASS Ranger Range production activation is isolated to the verified migration and leaves preview disabled.");
