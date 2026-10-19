import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wrangler = readFileSync("wrangler.toml", "utf8");
const productionBlock = wrangler.match(/\[env\.production\.vars\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";

assert.match(productionBlock, /^DZN_GAMES_HUB_ENABLED = "true"$/m);
assert.match(productionBlock, /^DZN_GAMES_CIPHER_GRID_ENABLED = "true"$/m);
assert.doesNotMatch(productionBlock, /^DZN_NIGHT_RUN_ROUTE_CONTROL_MIGRATION_MAINTENANCE = /m, "Night Run maintenance must be removed after the isolated 0110 preservation rollout.");
assert.doesNotMatch(productionBlock, /^DZN_CIRCUIT_FORGE_GRID_CONTROL_MIGRATION_MAINTENANCE = /m, "Circuit Forge maintenance must be removed after the isolated 0111 preservation rollout.");
assert.match(productionBlock, /^DZN_ACCOUNT_DELETE_ENABLED = "true"$/m, "Account closure must be restored after the isolated 0111 preservation rollout.");
assert.doesNotMatch(productionBlock, /^DZN_GAMES_CIPHER_GRID_SPECIALIST_ENABLED = "true"$/m);
assert.doesNotMatch(productionBlock, /^DZN_COMMS_PRESENCE_(?:READ|WRITE|RETENTION)_ENABLED = "true"$/m);
assert.doesNotMatch(productionBlock, /^DZN_STORE_ENABLED = "true"$/m);
assert.doesNotMatch(productionBlock, /^DZN_STORE_ADMIN_ENABLED = "true"$/m);

console.log("Cipher Grid production activation boundary checks passed.");
