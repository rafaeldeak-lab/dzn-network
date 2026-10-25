import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const root = path.resolve(process.cwd());
  const sandboxConfig = await readFile(path.join(root, "wrangler.checkout-sandbox.toml"), "utf8");
  const deployScript = await readFile(path.join(root, "scripts", "deploy-checkout-sandbox.mjs"), "utf8");
  const expectedProject = "dzn-network-checkout-sandbox";
  const expectedDatabase = "e8563ccb-7f30-4950-8137-6a7eb3a8cc3c";
  const productionDatabase = "37515c66-2787-49e4-8568-a461517e975e";

  expect(sandboxConfig.includes(`name = \"${expectedProject}\"`), "Sandbox config must name only the sandbox Pages project.");
  expect(sandboxConfig.includes(`database_id = \"${expectedDatabase}\"`), "Sandbox config must bind only the sandbox D1 database.");
  expect(!sandboxConfig.includes(productionDatabase), "Sandbox config must not mention the production D1 database.");
  expect(deployScript.includes('DZN_ALLOW_CHECKOUT_SANDBOX_DEPLOY'), "Sandbox deployment must require explicit operator intent.");
  expect(deployScript.includes(`"--project-name", projectName`), "Sandbox deployment must name the sandbox Pages project.");
  expect(deployScript.includes(`"--branch", "main"`), "Sandbox deployment must target the sandbox project's production branch.");
  expect(deployScript.includes("mkdtemp(stagingPrefix)"), "Sandbox deployment must use an isolated staging directory.");
  expect(!deployScript.includes("writeFile(primaryConfig"), "Sandbox deployment must not replace the primary Wrangler configuration.");
  await assertInterruptedDeploymentLeavesPrimaryConfigUntouched(root, sandboxConfig);

  console.log("Checkout sandbox deployment contract checks passed.");
}

void main();

async function assertInterruptedDeploymentLeavesPrimaryConfigUntouched(sourceRoot: string, sandboxConfig: string) {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "dzn-checkout-sandbox-"));
  const primaryConfig = path.join(fixtureRoot, "wrangler.toml");
  const stubWrangler = path.join(fixtureRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  const originalConfig = 'name = "normal-release-config"\n';
  let child: ReturnType<typeof spawn> | null = null;

  try {
    await mkdir(path.dirname(stubWrangler), { recursive: true });
    await mkdir(path.join(fixtureRoot, "out"));
    await mkdir(path.join(fixtureRoot, "functions"));
    await mkdir(path.join(fixtureRoot, "lib"));
    await writeFile(primaryConfig, originalConfig, "utf8");
    await writeFile(path.join(fixtureRoot, "wrangler.checkout-sandbox.toml"), sandboxConfig, "utf8");
    await writeFile(path.join(fixtureRoot, "package.json"), '{"private":true}\n', "utf8");
    await writeFile(path.join(fixtureRoot, "tsconfig.json"), '{}\n', "utf8");
    await writeFile(stubWrangler, 'const { writeFileSync } = require("node:fs"); const { join } = require("node:path"); writeFileSync(join(process.cwd(), "wrangler-started"), "yes"); process.on("SIGINT", () => process.exit(0)); setInterval(() => {}, 1000);\n', "utf8");

    child = spawn(process.execPath, [path.join(sourceRoot, "scripts", "deploy-checkout-sandbox.mjs")], {
      cwd: fixtureRoot,
      env: { ...process.env, DZN_ALLOW_CHECKOUT_SANDBOX_DEPLOY: "1" },
      stdio: "ignore",
      detached: process.platform !== "win32",
    });
    await waitFor(() => hasStartedStagingDeployment(fixtureRoot), "Sandbox deployment did not start from its staging directory.");
    const exitPromise = waitForExit(child);
    interruptProcessTree(child, "SIGINT");
    const exit = await exitPromise;
    child = null;

    expect(await readFile(primaryConfig, "utf8") === originalConfig, "Interrupted deployment changed the primary configuration.");
    expect(exit.code === 130 || exit.signal === "SIGINT", `Interrupted deployment exited unexpectedly: ${exit.code ?? exit.signal ?? "unknown"}.`);
  } finally {
    if (child) interruptProcessTree(child, "SIGKILL");
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function interruptProcessTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals) {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // If the process already exited, direct cleanup below is harmless.
    }
  }
  child.kill(signal);
}

async function hasStartedStagingDeployment(root: string) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(".dzn-checkout-sandbox-deploy-")) continue;
    try {
      return (await readFile(path.join(root, entry.name, "wrangler-started"), "utf8")) === "yes";
    } catch {
      // The staging directory is still being assembled.
    }
  }
  return false;
}

async function waitFor(check: () => Promise<boolean>, message: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}
