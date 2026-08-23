set -euo pipefail

npm ci
npm run test:github-workflows
npm run test:discord-server-announcements
npm run test:owner-console
npm run test
npm run lint
npm run build
rm -rf .pages-functions
mkdir -p .pages-functions
./node_modules/.bin/wrangler pages functions build functions \
  --outdir .pages-functions \
  --build-output-directory out \
  --output-routes-path out/_routes.json \
  --minify
node scripts/patch-pages-routes.mjs
test -s .pages-functions/index.js
cp .pages-functions/index.js out/_worker.js
test -s out/_worker.js
cmp -s .pages-functions/index.js out/_worker.js
git diff --check

node <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");
const workerPath = "out/_worker.js";
const functionsWorkerPath = ".pages-functions/index.js";
const routesPath = "out/_routes.json";
const routes = JSON.parse(fs.readFileSync(routesPath, "utf8"));
const requiredIncludes = ["/api/*", "/owner", "/owner/*"];
function uniqueRoutes(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}
function isSplat(route) {
  return typeof route === "string" && route.endsWith("/*");
}
function splatPrefix(route) {
  return route.slice(0, -1);
}
function normalizeRoutes(values) {
  const source = uniqueRoutes(values);
  const splats = source.filter(isSplat);
  const removed = [];
  const normalized = source.filter((route) => {
    for (const splat of splats) {
      if (route === splat) continue;
      if (route.startsWith(splatPrefix(splat))) {
        removed.push({ route, coveredBy: splat });
        return false;
      }
    }
    return true;
  }).sort();
  return { routes: normalized, removed };
}
function assertNoSplatOverlap(values, label) {
  const routes = uniqueRoutes(values);
  for (const splat of routes.filter(isSplat)) {
    const prefix = splatPrefix(splat);
    const overlap = routes.find((route) => route !== splat && route.startsWith(prefix));
    if (overlap) throw new Error(`${label} route overlap: ${splat} covers ${overlap}.`);
  }
}
const includeResult = normalizeRoutes([...(routes.include ?? []), ...requiredIncludes]);
const excludeResult = normalizeRoutes(routes.exclude ?? []);
const finalRoutes = {
  version: routes.version ?? 1,
  include: includeResult.routes,
  exclude: excludeResult.routes,
};
assertNoSplatOverlap(finalRoutes.include, "include");
assertNoSplatOverlap(finalRoutes.exclude, "exclude");
fs.writeFileSync(routesPath, `${JSON.stringify(finalRoutes, null, 2)}\n`);
const include = finalRoutes.include;
const exclude = finalRoutes.exclude;
for (const route of requiredIncludes) {
  if (!include.includes(route)) throw new Error(`out/_routes.json missing ${route}.`);
}
if (!fs.statSync(functionsWorkerPath).size) throw new Error(".pages-functions/index.js is empty.");
const workerBytes = fs.readFileSync(workerPath);
const functionsWorkerBytes = fs.readFileSync(functionsWorkerPath);
const workerHash = crypto.createHash("sha256").update(workerBytes).digest("hex");
const functionsWorkerHash = crypto.createHash("sha256").update(functionsWorkerBytes).digest("hex");
if (workerHash !== functionsWorkerHash) throw new Error("out/_worker.js does not match .pages-functions/index.js.");
console.log("Repair pinned main runtime package summary:", JSON.stringify({
  workerByteSize: workerBytes.length,
  workerShaPrefix: workerHash.slice(0, 12),
  includeCount: include.length,
  excludeCount: exclude.length,
  hasApiWildcard: include.includes("/api/*"),
  hasOwner: include.includes("/owner"),
  hasOwnerWildcard: include.includes("/owner/*"),
  removedOverlappedIncludeRoutes: includeResult.removed.length,
  removedOverlappedExcludeRoutes: excludeResult.removed.length,
}));
NODE
