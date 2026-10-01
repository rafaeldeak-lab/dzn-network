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
  ...walk("scripts", (path) => /\.(?:ts|tsx|js|mjs|cjs|sh|ps1|cmd|bat)$/i.test(path)),
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
assert.equal(hasRemoteMigrationInvocation('spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--remote"])'), true);
assert.equal(hasRemoteMigrationInvocation("node_modules\\.bin\\wrangler.cmd d1 migrations apply DB --remote"), true);
assert.equal(hasRemoteMigrationInvocation("& .\\node_modules\\.bin\\wrangler.ps1 d1 migrations apply DB --remote"), true);
assert.equal(hasWranglerMigrationApply('execFileSync("wrangler", ["d1", "migrations", "apply", "DB", "--remote"])'), true);
assert.equal(hasRemoteStoreMigrationExecute("npx wrangler d1 execute DB --remote --file migrations/0081_store_catalog_foundation.sql"), true);
assert.equal(hasRemoteStoreMigrationExecute("npx wrangler d1 execute DB --remote \\\n  --file migrations/0081_store_catalog_foundation.sql"), true);
assert.equal(hasRemoteStoreMigrationExecute('execFileSync("wrangler", [\n  "d1", "execute", "DB", "--remote",\n  "--file", "migrations/0081_store_catalog_foundation.sql",\n])'), true);
assert.equal(hasRemoteStoreMigrationExecute(
  'MIGRATION=migrations/0081_store_catalog_foundation.sql; npx wrangler d1 execute DB --remote --file "$MIGRATION"',
), true);
assert.equal(hasRemoteStoreMigrationExecute(
  'npx wrangler d1 execute DB --remote --command "$(cat migrations/0081_store_catalog_foundation.sql)"',
), true);
assert.equal(callsRemoteMigrationHelper(
  "bash scripts/apply-migrations.sh",
  { "scripts/apply-migrations.sh": `npm run ${remoteMigrationScripts[0]!}` },
), true);
assert.equal(callsRemoteMigrationHelper(
  "tsx scripts/store-rollout.ts",
  {
    "scripts/store-rollout.ts": 'import "./apply-migrations";',
    "scripts/apply-migrations.ts": `npm run ${remoteMigrationScripts[0]!}`,
  },
), true);
assert.equal(callsRemoteMigrationHelper(
  "bash scripts/store-rollout.sh",
  {
    "scripts/store-rollout.sh": "source ./apply-migrations.sh",
    "scripts/apply-migrations.sh": `npm run ${remoteMigrationScripts[0]!}`,
  },
), true);
assert.equal(callsRemoteMigrationHelper(
  "cd scripts && bash apply-migrations.sh",
  { "scripts/apply-migrations.sh": `npm run ${remoteMigrationScripts[0]!}` },
), true);
assert.equal(callsRemoteMigrationHelper(
  "working-directory: scripts\nrun: bash apply-migrations.sh",
  { "scripts/apply-migrations.sh": `npm run ${remoteMigrationScripts[0]!}` },
), true);
assert.equal(callsRemoteMigrationHelper(
  "working-directory: scripts\nrun: ./apply-migrations.sh",
  { "scripts/apply-migrations.sh": `npm run ${remoteMigrationScripts[0]!}` },
), true);
assert.equal(extractNpmRunTargets("npm test").includes("test"), true);
assert.equal(extractNpmRunTargets("npm restart").includes("start"), true);
assert.equal(callsRemoteMigrationHelper(
  "tsx scripts/store-rollout.ts",
  {
    "scripts/store-rollout.ts": 'require("./apply-migrations")',
    "scripts/apply-migrations/index.cjs": `npm run ${remoteMigrationScripts[0]!}`,
  },
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
  const callsRemoteHelper = callsRemoteMigrationHelper(source);
  assert.equal((appliesMigration || callsRemoteWrapper || callsRemoteHelper) && targetsStore, false, `${file} must not automate Store production migration application.`);
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
      || callsRemoteMigrationWrapper(command, resolvedRemoteScripts)
      || callsRemoteMigrationHelper(command));
}

function isStoreTarget(pathOrName: string, content: string) {
  return /(?:0081_store_catalog|DZN_STORE_)/i.test(content) || /(?:^|[:/_-])store(?:[:/_.-]|$)/i.test(pathOrName);
}

function resolvesRemoteMigration(name: string, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  const command = scripts[name];
  if (!command) return false;
  const nextSeen = new Set(seen).add(name);
  if (hasRemoteMigrationInvocation(command)
    || hasRemoteStoreMigrationExecute(command, isStoreTarget(name, command))
    || callsRemoteMigrationHelper(command, {}, new Set(), nextSeen)) return true;
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

function callsRemoteMigrationHelper(
  source: string,
  fixtureFiles: Record<string, string> = {},
  seen = new Set<string>(),
  packageSeen = new Set<string>(),
  fromFile?: string,
): boolean {
  for (const referencedPath of extractScriptReferences(source, fromFile)) {
    if (referencedPath === "scripts/test-store-catalog-activation-checklist.ts" || seen.has(referencedPath)) continue;
    const fixture = fixtureFiles[referencedPath];
    const absolutePath = resolve(referencedPath);
    const helperSource = fixture ?? (existsSync(absolutePath) && statSync(absolutePath).isFile()
      ? readFileSync(absolutePath, "utf8")
      : null);
    if (helperSource === null) continue;
    const nextSeen = new Set(seen).add(referencedPath);
    if (hasRemoteMigrationInvocation(helperSource)
      || hasRemoteStoreMigrationExecute(helperSource, true)
      || extractNpmRunTargets(helperSource).some((target) => resolvesRemoteMigration(target, packageSeen))
      || callsRemoteMigrationHelper(helperSource, fixtureFiles, nextSeen, packageSeen, referencedPath)) return true;
  }
  return false;
}

function extractScriptReferences(source: string, fromFile?: string) {
  const root = resolve(".");
  const normalized = normalizeCommandTokens(source).replace(/\\\s*\r?\n/g, " ");
  const references = new Set<string>();
  for (const match of normalized.matchAll(/(?:^|\s)((?:\.\/)?scripts\/[\w./-]+(?:\.(?:ts|tsx|js|mjs|cjs|sh|ps1|cmd|bat))?)\b/gi)) {
    addScriptReference(references, root, resolve(match[1]), Boolean(/\.[a-z]+$/i.test(match[1])));
  }
  for (const match of normalized.matchAll(/\bcd\s+([^\s;&|]+)\s*(?:&&|;)\s*(?:bash|sh|source|\.)\s+([^\s;&|]+)/gi)) {
    const baseDir = fromFile ? dirname(fromFile) : ".";
    const workingDir = resolve(baseDir, stripToken(match[1]));
    const helper = stripToken(match[2]);
    addScriptReference(references, root, resolve(workingDir, helper), Boolean(/\.[a-z]+$/i.test(helper)));
  }
  const workflowDirs = [...source.matchAll(/\bworking-directory\s*:\s*["']?([^\s#"']+)/gi)]
    .map((match) => stripToken(match[1]));
  const workflowHelpers = [
    ...source.matchAll(/(?:^|[\s|>])(?:bash|sh|source|\.)\s+([\w./-]+\.(?:ts|tsx|js|mjs|cjs|sh|ps1|cmd|bat))/gim),
    ...source.matchAll(/(?:^|[\s|>])(\.{1,2}\/[\w./-]+\.(?:ts|tsx|js|mjs|cjs|sh|ps1|cmd|bat))/gim),
  ].map((match) => stripToken(match[1]));
  for (const workingDir of workflowDirs) {
    for (const helper of workflowHelpers) {
      addScriptReference(references, root, resolve(workingDir, helper), true);
    }
  }
  if (fromFile) {
    for (const match of source.matchAll(/["'`](\.{1,2}\/[\w./-]+)["'`]/g)) {
      addScriptReference(references, root, resolve(dirname(fromFile), match[1]), Boolean(/\.[a-z]+$/i.test(match[1])));
    }
    for (const match of source.matchAll(/(?:^|[\s;&|])(?:source\s+|\.\s+|(?:bash|sh)\s+)?(\.{1,2}\/[\w./-]+)/gm)) {
      addScriptReference(references, root, resolve(dirname(fromFile), match[1]), Boolean(/\.[a-z]+$/i.test(match[1])));
    }
  }
  return [...references];
}

function addScriptReference(references: Set<string>, root: string, absoluteBase: string, hasExtension: boolean) {
  const candidates = hasExtension
    ? [absoluteBase]
    : [".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".ps1", ".cmd", ".bat"].flatMap((extension) => [
      `${absoluteBase}${extension}`,
      join(absoluteBase, `index${extension}`),
    ]);
  for (const candidate of candidates) {
    const fromRoot = relative(root, candidate).replace(/\\/g, "/");
    if (!fromRoot.startsWith("..") && !isAbsolute(fromRoot)) {
      references.add(fromRoot);
    }
  }
}

function extractNpmRunTargets(source: string) {
  const targets = new Set<string>();
  const normalized = normalizeCommandTokens(source).replace(/\\\s*\r?\n/g, " ");
  for (const match of normalized.matchAll(/npm\s+([^;&|\r\n]+)/gi)) {
    const tokens = match[1].match(/"[^"]*"|'[^']*'|`[^`]*`|\S+/g) ?? [];
    const runIndex = tokens.findIndex((rawToken) => /^(?:run|run-script|rum|urn)$/i.test(stripToken(rawToken)));
    const candidateTokens = runIndex >= 0 ? tokens.slice(runIndex + 1) : tokens;
    for (const rawToken of candidateTokens) {
      const token = rawToken.replace(/^["'`]|["'`,)\]}]+$/g, "");
      if (runIndex < 0 && /^restart$/i.test(token) && !scripts.restart) {
        for (const fallback of ["stop", "start"]) if (scripts[fallback]) targets.add(fallback);
      } else if (scripts[token] && (runIndex >= 0 || /^(?:start|stop|restart|test)$/i.test(token))) {
        targets.add(token);
      }
    }
  }
  return [...targets];
}

function hasRemoteMigrationInvocation(command: string) {
  const invocations = wranglerInvocationWindows(command, /(?:npx\s+)?(?:[\w.@-]+[\\/])*wrangler(?:\.(?:js|cmd|exe|ps1))?\s+d1\s+migrations\s+apply\b/gi);
  return invocations.some((invocation) => /--remote\b/i.test(invocation) || !/--local\b/i.test(invocation));
}

function hasWranglerMigrationApply(source: string) {
  return /(?:[\w.@-]+[\\/])*wrangler(?:\.(?:js|cmd|exe|ps1))?\s+d1\s+migrations\s+apply/i.test(normalizeCommandTokens(source));
}

function hasRemoteStoreMigrationExecute(source: string, storeTarget = isStoreTarget("", source)) {
  const invocations = wranglerInvocationWindows(source, /(?:npx\s+)?(?:[\w.@-]+[\\/])*wrangler(?:\.(?:js|cmd|exe|ps1))?\s+d1\s+execute\b/gi);
  return invocations.some((invocation) => {
    if (!/--remote\b/i.test(invocation)) return false;
    if (storeTarget && /--command(?:=|\s)+/i.test(invocation)) return true;
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
    const nextWrangler = tail.slice(match[0].length).search(/\b(?:npx\s+)?(?:[\w.@-]+[\\/])*wrangler(?:\.(?:js|cmd|exe|ps1))?\b/i);
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
  return wranglerInvocationWindows(source, /(?:npx\s+)?(?:[\w.@-]+[\\/])*wrangler(?:\.(?:js|cmd|exe|ps1))?\b/gi).some((invocation) => {
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
