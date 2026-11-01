import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
const build = packageJson.scripts?.build ?? "";
const builderPath = "scripts/build-pages-functions.mjs";
const builder = readFileSync(builderPath, "utf8");

assert.match(build, /node scripts\/build-pages-functions\.mjs/, "The standard Pages build must package Functions before deployment.");
assert.match(build, /node scripts\/patch-pages-routes\.mjs/, "The standard Pages build must preserve its Pages routing manifest.");
assert.ok(build.indexOf("build-pages-functions") < build.indexOf("patch-pages-routes"), "The route manifest must be patched after the Functions builder writes it.");
assert.match(builder, /wranglerCli, "pages", "functions", "build", "functions"/, "The Pages Functions source must be compiled during the standard build.");
assert.match(builder, /"--build-output-directory", buildOutput/, "The Functions build must target the static Next output.");
assert.match(builder, /copyFileSync\(bundledWorker, workerOutput\)/, "The compiled Functions worker must be packaged as out/_worker.js.");
assert.match(builder, /rmSync\(temporaryWorkerOutput, \{ recursive: true, force: true \}\)/, "Temporary function bundles must not pollute the repository.");
assert.equal(existsSync("functions/_middleware.ts"), true, "The Pages middleware source must remain present for protected page routing.");

console.log("DZN Pages runtime-build contract passed: Pages Functions are packaged with normal Cloudflare builds.");
