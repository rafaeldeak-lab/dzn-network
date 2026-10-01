import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const checklist = readFileSync("docs/STORE_CATALOG_ACTIVATION_CHECKLIST.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

for (const required of [
  "0081_store_catalog_foundation.sql",
  "the only pending production migration",
  "DZN_STORE_ENABLED",
  "DZN_STORE_ADMIN_ENABLED",
  "D1 Time Travel recovery bookmark",
  "PRAGMA foreign_key_check",
  "store_products",
  "store_prices",
  "idx_store_products_status_active",
  "idx_store_prices_product_status",
  "idx_store_prices_stripe_price",
  "Both Store tables contain zero rows immediately after migration.",
  "The public Store remains off after this checklist.",
  "separate schemas, threat review, tests, release approval, and live verification",
]) assert.equal(checklist.includes(required), true, `Store activation checklist should include: ${required}`);

assert.match(checklist, /Stop if any condition is unverified/);
assert.match(checklist, /Do not edit the migration ledger manually/);
assert.match(checklist, /generic instruction[\s\S]*is not sufficient approval/i);
assert.doesNotMatch(checklist, /(?:token|secret|password)\s*[=:]\s*\S+/i);

const scripts = packageJson.scripts ?? {};
assert.equal(typeof scripts["test:store-catalog-foundation"], "string");
assert.equal(scripts["test:store-catalog-foundation"].includes("test-store-catalog-activation-checklist.ts"), true);

for (const [name, command] of Object.entries(scripts)) {
  if (/^test:/.test(name)) continue;
  const appliesMigration = /wrangler\s+d1\s+migrations\s+apply/i.test(command);
  const targetsStore = /(?:0081_store_catalog|DZN_STORE_)/i.test(`${name} ${command}`);
  assert.equal(appliesMigration && targetsStore, false, `${name} must not automate Store production migration application.`);
  assert.doesNotMatch(command, /DZN_STORE_(?:ENABLED|ADMIN_ENABLED)\s*=\s*(?:true|1)/i, `${name} must not automate Store activation.`);
}

const automationFiles = [
  ...walk(".github/workflows", (path) => /\.ya?ml$/i.test(path)),
  ...walk("scripts", (path) => /\.(?:ts|js|mjs|cjs|sh)$/i.test(path)),
].filter((path) => !/^scripts\/test-/.test(path));
const remoteMigrationScripts = Object.entries(scripts)
  .filter(([, command]) => /wrangler\s+d1\s+migrations\s+apply/i.test(command) && !/--local\b/i.test(command))
  .map(([name]) => name);
const remoteWrapperPattern = remoteMigrationScripts.length
  ? new RegExp(`npm\\s+(?:run\\s+)?(?:${remoteMigrationScripts.map(escapeRegex).join("|")})\\b`, "i")
  : /$a/;
assert.equal(remoteMigrationScripts.length > 0, true, "The guard must discover the existing remote D1 migration wrapper.");
for (const scriptName of remoteMigrationScripts) {
  assert.equal(remoteWrapperPattern.test(`npm run ${scriptName}`), true, `The guard must recognize ${scriptName} callers.`);
}

for (const file of automationFiles) {
  const source = readFileSync(file, "utf8");
  const appliesMigration = /wrangler\s+d1\s+migrations\s+apply/i.test(source);
  const targetsStore = /(?:0081_store_catalog|DZN_STORE_)/i.test(source);
  const callsRemoteMigrationWrapper = remoteWrapperPattern.test(source);
  assert.equal((appliesMigration || callsRemoteMigrationWrapper) && targetsStore, false, `${file} must not automate Store production migration application.`);
  assert.doesNotMatch(source, /DZN_STORE_(?:ENABLED|ADMIN_ENABLED)\s*(?:=|:)\s*["'`]?(?:true|1|yes|on)\b/i, `${file} must not automate Store activation.`);
}

function walk(dir: string, matcher: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name).replace(/\\/g, "/");
    const stats = statSync(path);
    if (stats.isDirectory()) results.push(...walk(path, matcher));
    else if (matcher(path)) results.push(path);
  }
  return results;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

console.log("Store catalog activation checklist checks passed.");
