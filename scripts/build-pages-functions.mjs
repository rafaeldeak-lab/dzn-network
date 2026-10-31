import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const buildOutput = resolve(root, "out");
const routesOutput = resolve(buildOutput, "_routes.json");
const workerOutput = resolve(buildOutput, "_worker.js");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");

if (!existsSync(buildOutput)) {
  throw new Error("Pages Functions packaging requires the static Next output in ./out.");
}
if (!existsSync(wranglerCli)) {
  throw new Error("Pages Functions packaging requires the repository's pinned Wrangler dependency.");
}

const temporaryWorkerOutput = mkdtempSync(join(tmpdir(), "dzn-pages-functions-"));
try {
  const result = spawnSync(process.execPath, [
    wranglerCli, "pages", "functions", "build", "functions",
    "--outdir", temporaryWorkerOutput,
    "--build-output-directory", buildOutput,
    "--output-routes-path", routesOutput,
    "--minify",
  ], { cwd: root, stdio: "inherit" });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Cloudflare Pages Functions build failed with exit code ${result.status ?? "unknown"}.`);

  const bundledWorker = join(temporaryWorkerOutput, "index.js");
  if (!existsSync(bundledWorker) || statSync(bundledWorker).size === 0) {
    throw new Error("Cloudflare Pages Functions build did not produce a worker bundle.");
  }

  copyFileSync(bundledWorker, workerOutput);
  if (!existsSync(workerOutput) || statSync(workerOutput).size === 0) {
    throw new Error("Cloudflare Pages runtime worker was not packaged into ./out.");
  }

  console.log("Cloudflare Pages Functions worker packaged into out/_worker.js.");
} finally {
  rmSync(temporaryWorkerOutput, { recursive: true, force: true });
}
