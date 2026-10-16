import assert from "node:assert/strict";
import { unstable_readConfig } from "wrangler";

const production = unstable_readConfig({ config: "wrangler.toml", env: "production" });
assert.equal(production.vars.DZN_GAMES_CIRCUIT_FORGE_ENABLED, "true");
assert.equal(unstable_readConfig({ config: "wrangler.toml", env: "preview" }).vars.DZN_GAMES_CIRCUIT_FORGE_ENABLED, undefined);
console.log("PASS Circuit Forge is enabled only in production after its isolated migration verification.");
