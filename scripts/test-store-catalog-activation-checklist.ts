import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

const automationFiles = [
  ...walk(".github/workflows", (path) => /\.ya?ml$/i.test(path)),
  ...walk("scripts", (path) => /\.(?:ts|js|mjs|cjs|sh)$/i.test(path)),
  ...execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter((path) => /(?:^|\/)wrangler[^/]*\.(?:toml|jsonc?)$/i.test(path)),
].filter((path) => path !== "scripts/test-store-catalog-activation-checklist.ts");
const remoteMigrationScripts = Object.keys(scripts).filter((name) => resolvesRemoteMigration(name));
const storeFlagAssignmentPattern = /(?:^|[\s|;&])DZN_STORE_(?:ENABLED|ADMIN_ENABLED)\s*=/im;
const storeFlagConfigPattern = /["']?DZN_STORE_(?:ENABLED|ADMIN_ENABLED)["']?\s*:/i;
const storeFlagWranglerMutationPattern = /wrangler[^\r\n]*(?:pages\s+)?secret\s+(?:put|bulk)[^\r\n]*DZN_STORE_(?:ENABLED|ADMIN_ENABLED)\b/i;
assert.equal(remoteMigrationScripts.length > 0, true, "The guard must discover the existing remote D1 migration wrapper.");
for (const scriptName of remoteMigrationScripts) {
  assert.equal(callsRemoteMigrationWrapper(`npm run ${scriptName}`), true, `The guard must recognize ${scriptName} callers.`);
  assert.equal(callsRemoteMigrationWrapper(`npm run-script ${scriptName}`), true, `The guard must recognize the run-script alias for ${scriptName}.`);
  assert.equal(callsRemoteMigrationWrapper(`npm rum ${scriptName}`), true, `The guard must recognize the rum alias for ${scriptName}.`);
  assert.equal(callsRemoteMigrationWrapper(`npm urn ${scriptName}`), true, `The guard must recognize the urn alias for ${scriptName}.`);
  assert.equal(callsRemoteMigrationWrapper(`npm run --if-present ${scriptName}`), true, `The guard must recognize option-prefixed ${scriptName} callers.`);
  assert.equal(callsRemoteMigrationWrapper(`npm run --script-shell /bin/bash ${scriptName}`), true, `The guard must skip option values before ${scriptName}.`);
}
assert.equal(isStoreMigrationAutomation("store:rollout", `npm run ${remoteMigrationScripts[0]!}`), true);
assert.equal(isStoreMigrationAutomation("store:rollout", "echo ready", ["store:rollout"]), true);
assert.equal(hasRemoteMigrationInvocation("wrangler d1 migrations apply DB --local && wrangler d1 migrations apply DB --remote"), true);
assert.equal(hasRemoteMigrationInvocation("wrangler d1 migrations apply DB --local"), false);
assert.equal(hasWranglerMigrationApply('execFileSync("wrangler", ["d1", "migrations", "apply", "DB", "--remote"])'), true);
assert.equal(hasRemoteStoreMigrationExecute("npx wrangler d1 execute DB --remote --file migrations/0081_store_catalog_foundation.sql"), true);
assert.equal(isStoreMigrationAutomation("store:rollout", 'node -e \'execFileSync("wrangler", ["d1", "migrations", "apply", "DB", "--remote"])\''), true);
assert.equal(storeFlagAssignmentPattern.test("DZN_STORE_ENABLED=$ENABLE_STORE next start"), true);
assert.equal(storeFlagWranglerMutationPattern.test("printf true | npx wrangler pages secret put DZN_STORE_ENABLED"), true);
assert.equal(hasStoreFlagWranglerMutation('execFileSync("wrangler", ["pages", "secret", "put", "DZN_STORE_ENABLED"])'), true);
assert.equal(isStoreTarget("scripts/store-rollout.ts", `npm run ${remoteMigrationScripts[0]!}`), true);
assert.equal(automationFiles.includes("wrangler.toml"), true, "The guard must scan the production Wrangler configuration.");
assert.equal(automationFiles.includes("scripts/test-store-catalog-foundation.ts"), true, "The guard must scan executable test-prefixed helpers.");

for (const [name, command] of Object.entries(scripts)) {
  assert.equal(isStoreMigrationAutomation(name, command), false, `${name} must not automate Store production migration application.`);
  assert.doesNotMatch(command, storeFlagAssignmentPattern, `${name} must not automate Store activation.`);
  assert.equal(hasStoreFlagWranglerMutation(command), false, `${name} must not mutate Store activation secrets.`);
}

for (const file of automationFiles) {
  const source = readFileSync(file, "utf8");
  const appliesMigration = hasWranglerMigrationApply(source) || hasRemoteStoreMigrationExecute(source);
  const targetsStore = isStoreTarget(file, source);
  const callsRemoteWrapper = callsRemoteMigrationWrapper(source);
  assert.equal((appliesMigration || callsRemoteWrapper) && targetsStore, false, `${file} must not automate Store production migration application.`);
  assert.doesNotMatch(source, storeFlagAssignmentPattern, `${file} must not automate Store activation.`);
  assert.equal(hasStoreFlagWranglerMutation(source), false, `${file} must not mutate Store activation secrets.`);
  if (/\.(?:ya?ml|toml|jsonc?)$/i.test(file)) {
    assert.doesNotMatch(source, storeFlagConfigPattern, `${file} must not configure Store activation.`);
  }
}

function isStoreMigrationAutomation(name: string, command: string, resolvedRemoteScripts = remoteMigrationScripts) {
  return isStoreTarget(name, command)
    && (resolvedRemoteScripts.includes(name)
      || hasRemoteMigrationInvocation(command)
      || hasRemoteStoreMigrationExecute(command)
      || callsRemoteMigrationWrapper(command, resolvedRemoteScripts));
}

function isStoreTarget(pathOrName: string, content: string) {
  return /(?:0081_store_catalog|DZN_STORE_)/i.test(content) || /(?:^|[:/_-])store(?:[:/_.-]|$)/i.test(pathOrName);
}

function resolvesRemoteMigration(name: string, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  const command = scripts[name];
  if (!command) return false;
  if (hasRemoteMigrationInvocation(command) || hasRemoteStoreMigrationExecute(command)) return true;
  const nextSeen = new Set(seen).add(name);
  for (const hook of [`pre${name}`, `post${name}`]) {
    if (scripts[hook] && resolvesRemoteMigration(hook, nextSeen)) return true;
  }
  for (const target of extractNpmRunTargets(command)) {
    if (resolvesRemoteMigration(target, nextSeen)) return true;
  }
  return false;
}

function callsRemoteMigrationWrapper(source: string, resolvedRemoteScripts = remoteMigrationScripts) {
  return extractNpmRunTargets(source).some((target) => resolvedRemoteScripts.includes(target));
}

function extractNpmRunTargets(source: string) {
  const targets = new Set<string>();
  for (const match of source.matchAll(/npm\s+(?:run|run-script|rum|urn)\s+([^;&|\r\n]+)/gi)) {
    const tokens = match[1].match(/"[^"]*"|'[^']*'|`[^`]*`|\S+/g) ?? [];
    for (const rawToken of tokens) {
      const token = rawToken.replace(/^["'`]|["'`,)\]}]+$/g, "");
      if (scripts[token]) targets.add(token);
    }
  }
  return [...targets];
}

function hasRemoteMigrationInvocation(command: string) {
  const invocations = normalizeCommandTokens(command).match(/(?:npx\s+)?wrangler\s+d1\s+migrations\s+apply\b[^;&|\r\n]*/gi) ?? [];
  return invocations.some((invocation) => /--remote\b/i.test(invocation) || !/--local\b/i.test(invocation));
}

function hasWranglerMigrationApply(source: string) {
  return /wrangler\s+d1\s+migrations\s+apply/i.test(normalizeCommandTokens(source));
}

function hasRemoteStoreMigrationExecute(source: string) {
  const normalized = normalizeCommandTokens(source);
  const invocations = normalized.match(/(?:npx\s+)?wrangler\s+d1\s+execute\b[^;&|\r\n]*/gi) ?? [];
  return invocations.some((invocation) => /--remote\b/i.test(invocation)
    && /--file(?:=|\s)+\S*0081_store_catalog_foundation\.sql\b/i.test(invocation));
}

function hasStoreFlagWranglerMutation(source: string) {
  return storeFlagWranglerMutationPattern.test(normalizeCommandTokens(source));
}

function normalizeCommandTokens(source: string) {
  return source.replace(/["'`,()[\]{}]/g, " ");
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

console.log("Store catalog activation checklist checks passed.");
