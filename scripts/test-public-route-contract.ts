import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = "app";
const sourceRoots = ["app", "components"];
const protectedRouteRoots = ["/dashboard", "/dzn-pulse", "/events", "/owner", "/player", "/seasons", "/setup"];
const publicRouteRoots = [
  "/",
  "/command-centre",
  "/community",
  "/discord-owner-access",
  "/games",
  "/leaderboards",
  "/login",
  "/pricing",
  "/privacy",
  "/refunds",
  "/servers",
  "/store",
  "/survival-command",
  "/terms",
  "/updates",
  "/signup",
];
const legacyRedirects = new Map([["/player-hub", "/player"]]);

const middlewareSource = readFileSync("functions/_middleware.ts", "utf8");
const routePatcherSource = readFileSync("scripts/patch-pages-routes.mjs", "utf8");
const pagesRoutes = JSON.parse(readFileSync("public/_routes.json", "utf8")) as { include?: unknown };
const includedRoutes = new Set(Array.isArray(pagesRoutes.include) ? pagesRoutes.include.filter((value): value is string => typeof value === "string") : []);

for (const route of [...publicRouteRoots, ...protectedRouteRoots]) {
  assert.equal(hasAppPage(route), true, `${route} must resolve to a checked-in app page.`);
}

for (const route of protectedRouteRoots) {
  assert.equal(middlewareSource.includes(`"${route}"`), true, `${route} must remain protected by page middleware.`);
  assert.equal(includedRoutes.has(route), true, `${route} must invoke Cloudflare Pages middleware.`);
  assert.equal(includedRoutes.has(`${route}/*`), true, `${route} child paths must invoke Cloudflare Pages middleware.`);
  assert.equal(routePatcherSource.includes(`"${route}"`), true, `${route} must be restored when the Pages route manifest is built.`);
  assert.equal(routePatcherSource.includes(`"${route}/*"`), true, `${route} child paths must be restored when the Pages route manifest is built.`);
}

for (const [legacyPath, canonicalPath] of legacyRedirects) {
  assert.equal(hasAppPage(canonicalPath), true, `${canonicalPath} must remain a real canonical route.`);
  assert.equal(middlewareSource.includes(`"${legacyPath}": "${canonicalPath}"`), true, `${legacyPath} must redirect to ${canonicalPath}.`);
  assert.equal(includedRoutes.has(legacyPath), true, `${legacyPath} must invoke the Cloudflare Pages redirect middleware.`);
  assert.equal(routePatcherSource.includes(`"${legacyPath}"`), true, `${legacyPath} must be restored when the Pages route manifest is built.`);
}

for (const [route, origins] of collectLiteralNavigationTargets()) {
  assert.equal(hasAppPage(route), true, `${route} is linked by ${[...origins].join(", ")} but has no matching app page.`);
}

console.log("Public route contract tests passed.");

function hasAppPage(route: string) {
  const segments = route.split("/").filter(Boolean);
  let current = appRoot;

  for (const segment of segments) {
    const staticDirectory = join(current, segment);
    if (existsSync(staticDirectory)) {
      current = staticDirectory;
      continue;
    }

    const dynamicDirectory = readdirSync(current, { withFileTypes: true }).find((entry) => entry.isDirectory() && /^\[.+\]$/.test(entry.name));
    if (!dynamicDirectory) return false;
    current = join(current, dynamicDirectory.name);
  }

  return existsSync(join(current, "page.tsx"));
}

function collectLiteralNavigationTargets() {
  const targets = new Map<string, Set<string>>();
  const navigationPattern = /(?:href|to)\s*[:=]\s*["'](\/[A-Za-z0-9_/-]*)["']|(?:push|replace|assign)\(\s*["'](\/[A-Za-z0-9_/-]*)["']/g;

  for (const file of collectSourceFiles()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(navigationPattern)) {
      const route = match[1] ?? match[2];
      if (!route || route.startsWith("/api/")) continue;
      const origins = targets.get(route) ?? new Set<string>();
      origins.add(file.replaceAll("\\", "/"));
      targets.set(route, origins);
    }
  }

  return targets;
}

function collectSourceFiles() {
  const files: string[] = [];
  for (const root of sourceRoots) walk(root, files);
  return files;
}

function walk(directory: string, files: string[]) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
}
