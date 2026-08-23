import { existsSync, rmSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const TYPESCRIPT_BUILD_INFO_CACHES = ["tsconfig.tsbuildinfo", ".next/cache/.tsbuildinfo"];

export function removeTypeScriptBuildInfoCaches() {
  for (const cachePath of TYPESCRIPT_BUILD_INFO_CACHES) {
    if (existsSync(cachePath) && statSync(cachePath).isFile()) rmSync(cachePath, { force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  removeTypeScriptBuildInfoCaches();
}
