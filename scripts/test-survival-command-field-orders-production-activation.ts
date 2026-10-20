import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unstable_readConfig } from "wrangler";

const source = readFileSync("functions/_lib/survival-command.ts", "utf8");
const env = readFileSync("cloudflare-env.d.ts", "utf8");
const migration = readFileSync("migrations/0112_dzn_survival_command_field_orders.sql", "utf8");
const production = unstable_readConfig({ config: "wrangler.toml", env: "production" });
const preview = unstable_readConfig({ config: "wrangler.toml", env: "preview" });

assert.match(env, /DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED\?: string/);
assert.match(source, /env\.DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED === "true"/);
assert.match(source, /fieldOrdersSchemaIsReady/);
assert.match(migration, /idx_dzn_survival_command_field_order_request/);
assert.match(migration, /idx_dzn_survival_command_field_order_active/);
assert.equal(production.vars.DZN_COMMAND_CENTRE_ENABLED, "true");
assert.equal(production.vars.DZN_SURVIVAL_COMMAND_ENABLED, "true");
assert.equal(production.vars.DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED, "true");
assert.equal(production.vars.DZN_SURVIVAL_COMMAND_FIELD_ORDERS_MIGRATION_MAINTENANCE, undefined);
assert.equal(production.vars.DZN_ACCOUNT_DELETE_ENABLED, "true");
assert.equal(preview.vars.DZN_COMMAND_CENTRE_ENABLED, undefined);
assert.equal(preview.vars.DZN_SURVIVAL_COMMAND_ENABLED, undefined);
assert.equal(preview.vars.DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED, undefined);

console.log("PASS Survival Command Field Orders and their prerequisite player features are enabled in production only after the isolated migration and cleanup verification.");
