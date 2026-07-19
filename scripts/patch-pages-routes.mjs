import { readFileSync, writeFileSync } from "node:fs";

const routesPath = "out/_routes.json";
const requiredIncludes = ["/api/*", "/owner", "/owner/*"];

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

let routes = { version: 1, include: [], exclude: [] };
try {
  routes = JSON.parse(readFileSync(routesPath, "utf8"));
} catch {
  routes = { version: 1, include: [], exclude: [] };
}

const include = unique([...(Array.isArray(routes.include) ? routes.include : []), ...requiredIncludes]);
const exclude = unique(Array.isArray(routes.exclude) ? routes.exclude : []);

writeFileSync(routesPath, `${JSON.stringify({ version: 1, include, exclude }, null, 2)}\n`);
console.log(`Patched Cloudflare Pages function routes: ${include.join(", ")}`);
