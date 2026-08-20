set -euo pipefail

npm run test:github-workflows
npm run test:discord-server-announcements
npm run test:owner-console
npm run test:creator-event-governance
npm run test:performance-foundation
npm run test
npm run lint
npm run build
git diff --check
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

node <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");
const routes = JSON.parse(fs.readFileSync("out/_routes.json", "utf8"));
const include = Array.isArray(routes.include) ? routes.include : [];
const exclude = Array.isArray(routes.exclude) ? routes.exclude : [];
const required = ["/api/*", "/owner", "/owner/*"];
for (const route of required) if (!include.includes(route)) throw new Error(`out/_routes.json missing ${route}.`);
function splatPrefix(route) {
  return route.endsWith("/*") ? route.slice(0, -1) : null;
}
for (const routeset of [include, exclude]) {
  for (const route of routeset) {
    const prefix = splatPrefix(route);
    if (!prefix) continue;
    const overlap = routeset.find((candidate) => candidate !== route && candidate.startsWith(prefix));
    if (overlap && !(route === "/owner/*" && overlap === "/owner")) throw new Error(`Cloudflare route overlap: ${route} covers ${overlap}.`);
  }
}
const worker = fs.readFileSync("out/_worker.js");
const workerHash = crypto.createHash("sha256").update(worker).digest("hex");
const functionsWorker = fs.readFileSync(".pages-functions/index.js");
const functionsWorkerHash = crypto.createHash("sha256").update(functionsWorker).digest("hex");
if (workerHash !== functionsWorkerHash) throw new Error("out/_worker.js does not match .pages-functions/index.js.");
fs.writeFileSync("dzn-event-platform-performance-preview/worker-package.json", JSON.stringify({
  workerByteSize: worker.length,
  workerShaPrefix: workerHash.slice(0, 12),
  includeCount: include.length,
  excludeCount: exclude.length,
  hasApiWildcard: include.includes("/api/*"),
  hasOwner: include.includes("/owner"),
  hasOwnerWildcard: include.includes("/owner/*"),
}, null, 2));
console.log(`Phase 2A Pages Functions package verified: workerByteSize=${worker.length}; workerShaPrefix=${workerHash.slice(0, 12)}; includeCount=${include.length}; excludeCount=${exclude.length}`);
NODE
