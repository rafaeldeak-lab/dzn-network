import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

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
const storeFlagConfigPattern = /["']?DZN_STORE_(?:ENABLED|ADMIN_ENABLED)["']?\s*(?:=|:)/i;
const storeFlagWranglerMutationPattern = /wrangler[^\r\n]*(?:pages\s+)?secret\s+(?:put|bulk)[^\r\n]*DZN_STORE_(?:ENABLED|ADMIN_ENABLED)\b/i;
assert.equal(remoteMigrationScripts.length > 0, true, "The guard must discover the existing remote D1 migration wrapper.");
for (const scriptName of remoteMigrationScripts) {
  assert.equal(callsRemoteMigrationWrapper(`npm run ${scriptName}`), true, `The guard must recognize ${scriptName} callers.`);
  assert.equal(callsRemoteMigrationWrapper(`npm run-script ${scriptName}`), true, `The guard must recognize the run-script alias for ${scriptName}.`);
  assert.equal(callsRemoteMigrationWrapper(`npm rum ${scriptName}`), true, `The guard must recognize the rum alias for ${scriptName}.`);
  assert.equal(callsRemoteMigrationWrapper(`npm urn ${scriptName}`), true, `The guard must recognize the urn alias for ${scriptName}.`);
  assert.equal(callsRemoteMigrationWrapper(`npm run --if-present ${scriptName}`), true, `The guard must recognize option-prefixed ${scriptName} callers.`);
  assert.equal(callsRemoteMigrationWrapper(`npm run --script-shell /bin/bash ${scriptName}`), true, `The guard must skip option values before ${scriptName}.`);
  assert.equal(callsRemoteMigrationWrapper(`npm run \\\n  ${scriptName}`), true, `The guard must recognize continued ${scriptName} callers.`);
}
assert.equal(isStoreMigrationAutomation("store:rollout", `npm run ${remoteMigrationScripts[0]!}`), true);
assert.equal(isStoreMigrationAutomation("store:rollout", "echo ready", ["store:rollout"]), true);
assert.equal(hasRemoteMigrationInvocation("wrangler d1 migrations apply DB --local && wrangler d1 migrations apply DB --remote"), true);
assert.equal(hasRemoteMigrationInvocation("wrangler d1 migrations apply DB --local"), false);
assert.equal(hasWranglerMigrationApply('execFileSync("wrangler", ["d1", "migrations", "apply", "DB", "--remote"])'), true);
assert.equal(hasRemoteStoreMigrationExecute("npx wrangler d1 execute DB --remote --file migrations/0081_store_catalog_foundation.sql"), true);
assert.equal(hasRemoteStoreMigrationExecute("npx wrangler d1 execute DB --remote \\\n  --file migrations/0081_store_catalog_foundation.sql"), true);
assert.equal(hasRemoteStoreMigrationExecute('execFileSync("wrangler", [\n  "d1", "execute", "DB", "--remote",\n  "--file", "migrations/0081_store_catalog_foundation.sql",\n])'), true);
assert.equal(hasRemoteStoreMigrationExecute(
  'MIGRATION=migrations/0081_store_catalog_foundation.sql; npx wrangler d1 execute DB --remote --file "$MIGRATION"',
), true);
assert.equal(isStoreMigrationAutomation("store:rollout", 'node -e \'execFileSync("wrangler", ["d1", "migrations", "apply", "DB", "--remote"])\''), true);
assert.equal(storeFlagAssignmentPattern.test("DZN_STORE_ENABLED=$ENABLE_STORE next start"), true);
assert.equal(storeFlagWranglerMutationPattern.test("printf true | npx wrangler pages secret put DZN_STORE_ENABLED"), true);
assert.equal(hasStoreFlagWranglerMutation('execFileSync("wrangler", ["pages", "secret", "put", "DZN_STORE_ENABLED"])'), true);
assert.equal(hasStoreFlagWranglerMutation('execFileSync("wrangler", [\n  "pages", "secret", "put",\n  "DZN_STORE_ENABLED",\n])'), true);
assert.equal(hasStoreFlagWranglerMutation(
  "npx wrangler pages secret bulk store-secrets.json",
  ".",
  { "store-secrets.json": '{"DZN_STORE_ENABLED":"true"}' },
), true);
assert.equal(callsRemoteMigrationWrapper(`npm --silent run ${remoteMigrationScripts[0]!}`), true);
assert.equal(callsRemoteMigrationWrapper(`execFileSync("npm", ["run", "${remoteMigrationScripts[0]!}"])`), true);
assert.equal(hasStoreFlagWranglerMutation("cd config && npx wrangler pages secret bulk store-secrets.json"), true);
assert.equal(hasStoreFlagWranglerMutation(
  'npx wrangler pages secret bulk --config wrangler.toml "$STORE_SECRETS"',
), true);
assert.equal(hasStoreFlagWranglerMutation(
  'STORE_FLAG=DZN_STORE_ENABLED; printf true | npx wrangler pages secret put "$STORE_FLAG"',
), true);
assert.equal(hasStoreFlagWranglerMutation("printf true | npx wrangler pages secret put UNRELATED_SECRET"), false);
assert.equal(storeFlagConfigPattern.test('"DZN_STORE_ENABLED" = "true"'), true);
assert.equal(isStoreTarget("scripts/store-rollout.ts", `npm run ${remoteMigrationScripts[0]!}`), true);
assert.equal(automationFiles.includes("wrangler.toml"), true, "The guard must scan the production Wrangler configuration.");
assert.equal(automationFiles.includes("scripts/test-store-catalog-foundation.ts"), true, "The guard must scan executable test-prefixed helpers.");

for (const [name, command] of Object.entries(scripts)) {
  assert.equal(isStoreMigrationAutomation(name, command), false, `${name} must not automate Store production migration application.`);
  assert.doesNotMatch(command, storeFlagAssignmentPattern, `${name} must not automate Store activation.`);
  assert.equal(
    hasStoreFlagWranglerMutation(command, ".", {}, isStoreTarget(name, command)),
    false,
    `${name} must not mutate Store activation secrets.`,
  );
}

for (const file of automationFiles) {
  const source = readFileSync(file, "utf8");
  const targetsStore = isStoreTarget(file, source);
  const appliesMigration = hasRemoteMigrationInvocation(source) || hasRemoteStoreMigrationExecute(source, targetsStore);
  const callsRemoteWrapper = callsRemoteMigrationWrapper(source);
  assert.equal((appliesMigration || callsRemoteWrapper) && targetsStore, false, `${file} must not automate Store production migration application.`);
  assert.doesNotMatch(source, storeFlagAssignmentPattern, `${file} must not automate Store activation.`);
  assert.equal(hasStoreFlagWranglerMutation(source, dirname(file), {}, targetsStore), false, `${file} must not mutate Store activation secrets.`);
  if (/\.(?:ya?ml|toml|jsonc?)$/i.test(file)) {
    assert.doesNotMatch(source, storeFlagConfigPattern, `${file} must not configure Store activation.`);
  }
}

function isStoreMigrationAutomation(name: string, command: string, resolvedRemoteScripts = remoteMigrationScripts) {
  return isStoreTarget(name, command)
    && (resolvedRemoteScripts.includes(name)
      || hasRemoteMigrationInvocation(command)
      || hasRemoteStoreMigrationExecute(command, isStoreTarget(name, command))
      || callsRemoteMigrationWrapper(command, resolvedRemoteScripts));
}

function isStoreTarget(pathOrName: string, content: string) {
  return /(?:0081_store_catalog|DZN_STORE_)/i.test(content) || /(?:^|[:/_-])store(?:[:/_.-]|$)/i.test(pathOrName);
}

function resolvesRemoteMigration(name: string, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  const command = scripts[name];
  if (!command) return false;
  if (hasRemoteMigrationInvocation(command) || hasRemoteStoreMigrationExecute(command, isStoreTarget(name, command))) return true;
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
  const normalized = normalizeCommandTokens(source).replace(/\\\s*\r?\n/g, " ");
  for (const match of normalized.matchAll(/npm\s+([^;&|\r\n]+)/gi)) {
    const tokens = match[1].match(/"[^"]*"|'[^']*'|`[^`]*`|\S+/g) ?? [];
    const runIndex = tokens.findIndex((rawToken) => /^(?:run|run-script|rum|urn)$/i.test(stripToken(rawToken)));
    if (runIndex < 0) continue;
    for (const rawToken of tokens.slice(runIndex + 1)) {
      const token = rawToken.replace(/^["'`]|["'`,)\]}]+$/g, "");
      if (scripts[token]) targets.add(token);
    }
  }
  return [...targets];
}

function hasRemoteMigrationInvocation(command: string) {
  const invocations = wranglerInvocationWindows(command, /(?:npx\s+)?wrangler\s+d1\s+migrations\s+apply\b/gi);
  return invocations.some((invocation) => /--remote\b/i.test(invocation) || !/--local\b/i.test(invocation));
}

function hasWranglerMigrationApply(source: string) {
  return /wrangler\s+d1\s+migrations\s+apply/i.test(normalizeCommandTokens(source));
}

function hasRemoteStoreMigrationExecute(source: string, storeTarget = isStoreTarget("", source)) {
  const invocations = wranglerInvocationWindows(source, /(?:npx\s+)?wrangler\s+d1\s+execute\b/gi);
  return invocations.some((invocation) => {
    if (!/--remote\b/i.test(invocation)) return false;
    const fileMatch = invocation.match(/--file(?:=|\s)+(\S+)/i);
    if (!fileMatch) return false;
    const file = stripToken(fileMatch[1]);
    if (/0081_store_catalog_foundation\.sql\b/i.test(file)) return true;
    return storeTarget && (/[$%{}]/.test(file) || !/\.sql$/i.test(file));
  });
}

function wranglerInvocationWindows(source: string, pattern: RegExp) {
  const normalized = normalizeCommandTokens(source).replace(/\\\s*\r?\n/g, " ").replace(/\s+/g, " ");
  const windows: string[] = [];
  for (const match of normalized.matchAll(pattern)) {
    const start = match.index ?? 0;
    const tail = normalized.slice(start, start + 800);
    const boundaries = [tail.indexOf(" && "), tail.indexOf(" || "), tail.indexOf(" ; ")]
      .filter((index) => index > 0);
    const nextWrangler = tail.slice(match[0].length).search(/\b(?:npx\s+)?wrangler\b/i);
    if (nextWrangler >= 0) boundaries.push(match[0].length + nextWrangler);
    windows.push(tail.slice(0, boundaries.length ? Math.min(...boundaries) : undefined));
  }
  return windows;
}

function hasStoreFlagWranglerMutation(
  source: string,
  baseDir = ".",
  fixtureFiles: Record<string, string> = {},
  storeTarget = isStoreTarget("", source),
) {
  return wranglerInvocationWindows(source, /(?:npx\s+)?wrangler\b/gi).some((invocation) => {
    if (storeFlagWranglerMutationPattern.test(invocation)) return true;
    const putMatch = invocation.match(/\b(?:pages\s+)?secret\s+put\b\s+(\S+)/i);
    if (/\b(?:pages\s+)?secret\s+put\b/i.test(invocation)) {
      const key = putMatch ? stripToken(putMatch[1]) : "";
      if (!/^[A-Z][A-Z0-9_]*$/.test(key) && storeTarget) return true;
    }
    const bulkMatch = invocation.match(/\b(?:pages\s+)?secret\s+bulk\b([\s\S]*)/i);
    if (!bulkMatch) return false;

    if (/\bcd\s+[^;&|]+(?:&&|;)|\bworking-directory\s*:/i.test(source)) return true;
    const candidate = extractSecretBulkInput(bulkMatch[1]);
    if (!candidate || /[$%{}]/.test(candidate)) return true;
    const fixture = fixtureFiles[candidate];
    if (fixture !== undefined) return storeFlagConfigPattern.test(fixture);
    const resolvedInputs = bulkInputCandidates(candidate, baseDir)
      .filter((path) => existsSync(path) && statSync(path).isFile());
    if (resolvedInputs.length === 0) return true;
    return resolvedInputs.some((path) => storeFlagConfigPattern.test(readFileSync(path, "utf8")));
  });
}

function extractSecretBulkInput(tail: string) {
  const tokens = (tail.match(/"[^"]*"|'[^']*'|`[^`]*`|\S+/g) ?? []).map(stripToken);
  const valueOptions = new Set(["--config", "-c", "--env", "-e", "--cwd", "--name", "--project-name"]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (valueOptions.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    return token;
  }
  return null;
}

function bulkInputCandidates(candidate: string, baseDir: string) {
  const root = resolve(".");
  const paths = isAbsolute(candidate)
    ? [resolve(candidate)]
    : [resolve(baseDir, candidate), resolve(root, candidate)];
  return [...new Set(paths)].filter((path) => {
    const fromRoot = relative(root, path);
    return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
  });
}

function stripToken(token: string) {
  return token.replace(/^["'`]|["'`,)\]}]+$/g, "");
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
