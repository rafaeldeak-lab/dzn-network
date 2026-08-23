import { readFileSync, writeFileSync } from "node:fs";

const routesPath = "out/_routes.json";
const requiredIncludes = ["/api/*", "/owner", "/owner/*"];

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function isSplat(route) {
  return typeof route === "string" && route.endsWith("/*");
}

function splatPrefix(route) {
  return route.slice(0, -1);
}

function normalizeRoutes(values) {
  const source = unique(values);
  const splats = source.filter(isSplat);
  return source.filter((route) => {
    for (const splat of splats) {
      if (route === splat) continue;
      if (route.startsWith(splatPrefix(splat))) return false;
    }
    return true;
  });
}

let routes = { version: 1, include: [], exclude: [] };
try {
  routes = JSON.parse(readFileSync(routesPath, "utf8"));
} catch {
  routes = { version: 1, include: [], exclude: [] };
}

const include = normalizeRoutes([...(Array.isArray(routes.include) ? routes.include : []), ...requiredIncludes]);
const exclude = normalizeRoutes(Array.isArray(routes.exclude) ? routes.exclude : []);

writeFileSync(routesPath, `${JSON.stringify({ version: 1, include, exclude }, null, 2)}\n`);
console.log(`Patched Cloudflare Pages function routes: ${include.join(", ")}`);
