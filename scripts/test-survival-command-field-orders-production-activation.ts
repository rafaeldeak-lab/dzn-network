import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("functions/_lib/survival-command.ts", "utf8");
const env = readFileSync("cloudflare-env.d.ts", "utf8");
const pages = readFileSync("wrangler.toml", "utf8");
const migration = readFileSync("migrations/0112_dzn_survival_command_field_orders.sql", "utf8");

assert.match(env, /DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED\?: string/);
assert.match(source, /env\.DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED === "true"/);
assert.match(source, /fieldOrdersSchemaIsReady/);
assert.match(migration, /idx_dzn_survival_command_field_order_request/);
assert.match(migration, /idx_dzn_survival_command_field_order_active/);
assert.doesNotMatch(pages, /DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED/);

console.log("Survival Command Field Orders remain disabled in production and preview until the isolated migration is verified.");
