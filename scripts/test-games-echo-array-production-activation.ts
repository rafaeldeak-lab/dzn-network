import assert from "node:assert/strict";
import { unstable_readConfig } from "wrangler";

const production = unstable_readConfig({ config: "wrangler.toml", env: "production" });
assert.equal(production.vars.DZN_GAMES_ECHO_ARRAY_ENABLED, "true");
assert.equal(unstable_readConfig({ config: "wrangler.toml", env: "preview" }).vars.DZN_GAMES_ECHO_ARRAY_ENABLED, undefined);
console.log("PASS Echo Array production activation remains scoped to its verified game flag.");
