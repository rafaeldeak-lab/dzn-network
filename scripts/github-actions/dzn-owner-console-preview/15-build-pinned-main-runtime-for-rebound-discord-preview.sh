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
const routes = JSON.parse(fs.readFileSync("out/_routes.json", "utf8"));
const include = Array.isArray(routes.include) ? routes.include : [];
const exclude = Array.isArray(routes.exclude) ? routes.exclude : [];
function isSplat(route) {
  return typeof route === "string" && route.endsWith("/*");
}
function splatPrefix(route) {
  return route.slice(0, -1);
}
for (const route of ["/api/*", "/owner", "/owner/*"]) {
  if (!include.includes(route)) throw new Error(`out/_routes.json missing ${route}.`);
}
for (const splat of include.filter(isSplat)) {
  const prefix = splatPrefix(splat);
  const overlap = include.find((route) => route !== splat && route.startsWith(prefix));
  if (overlap) throw new Error(`include route overlap: ${splat} covers ${overlap}.`);
}
console.log("Pinned main runtime build and Cloudflare route normalization verified.");
NODE
