import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const projectName = "dzn-network-checkout-sandbox";
const sandboxDatabaseId = "e8563ccb-7f30-4950-8137-6a7eb3a8cc3c";
const productionDatabaseId = "37515c66-2787-49e4-8568-a461517e975e";
const root = process.cwd();
const outputDirectory = process.argv[2] ?? "out";
const sandboxConfig = path.join(root, "wrangler.checkout-sandbox.toml");
const sourceOutput = path.resolve(root, outputDirectory);
const stagingPrefix = path.join(root, ".dzn-checkout-sandbox-deploy-");

if (process.env.DZN_ALLOW_CHECKOUT_SANDBOX_DEPLOY !== "1") {
  throw new Error("Refusing sandbox deployment. Set DZN_ALLOW_CHECKOUT_SANDBOX_DEPLOY=1 after confirming this is the isolated checkout sandbox.");
}

const sandboxSource = await readFile(sandboxConfig, "utf8");
if (!sandboxSource.includes(`name = \"${projectName}\"`) || !sandboxSource.includes(`database_id = \"${sandboxDatabaseId}\"`)) {
  throw new Error("Sandbox Wrangler configuration does not target the expected Pages project and D1 database.");
}
if (sandboxSource.includes(productionDatabaseId) || sandboxSource.includes('name = "dzn-network"')) {
  throw new Error("Sandbox Wrangler configuration contains a production target.");
}
if (sourceOutput !== root && !sourceOutput.startsWith(`${root}${path.sep}`)) {
  throw new Error("Sandbox deployment output must stay inside the current worktree.");
}

const stagingRoot = await mkdtemp(stagingPrefix);

try {
  // Pages ignores --config; compile from an isolated directory instead of replacing the primary configuration.
  await Promise.all([
    cp(sourceOutput, path.join(stagingRoot, "out"), { recursive: true }),
    cp(path.join(root, "functions"), path.join(stagingRoot, "functions"), { recursive: true }),
    cp(path.join(root, "lib"), path.join(stagingRoot, "lib"), { recursive: true }),
    cp(path.join(root, "package.json"), path.join(stagingRoot, "package.json")),
    cp(path.join(root, "tsconfig.json"), path.join(stagingRoot, "tsconfig.json")),
    writeFile(path.join(stagingRoot, "wrangler.toml"), sandboxSource, "utf8"),
  ]);
  await runWrangler(stagingRoot, ["pages", "deploy", "out", "--project-name", projectName, "--branch", "main"]);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

function runWrangler(cwd, args) {
  const wranglerCli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, ...args], {
      cwd,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Wrangler exited with code ${code ?? "unknown"}.`));
    });
  });
}
