import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wrangler = readFileSync("wrangler.toml", "utf8");
const productionBlock = wrangler.match(/\[env\.production\.vars\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";

assert.match(productionBlock, /^DZN_GAMES_HUB_ENABLED = "true"$/m);
assert.match(productionBlock, /^DZN_GAMES_TRIVIA_ENABLED = "true"$/m);
assert.match(productionBlock, /^DZN_GAMES_WORD_CHAIN_ENABLED = "true"$/m);
assert.doesNotMatch(productionBlock, /^DZN_COMMS_PRESENCE_(?:READ|WRITE|RETENTION)_ENABLED = "true"$/m);
assert.doesNotMatch(productionBlock, /^DZN_STORE_ENABLED = "true"$/m);
assert.doesNotMatch(productionBlock, /^DZN_STORE_ADMIN_ENABLED = "true"$/m);

console.log("Word Chain production activation boundary checks passed.");
