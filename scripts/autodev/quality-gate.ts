import { makeReport, pass, fail, readText, runCommand, writeReport, type AutoDevCheck } from "./lib";

const packageJson = JSON.parse(readText("package.json") || "{}") as { scripts?: Record<string, string> };
const scripts = packageJson.scripts ?? {};
type GateCommand = [string, string[]];

const commands: GateCommand[] = [
  ["npm", ["run", "test"]],
  ["npm", ["run", "test:nitrado-diagnostics"]],
  ["npm", ["run", "test:github-workflows"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "build"]],
  ["git", ["diff", "--check"]],
  ["npm", ["run", "worker:adm-sync:dry-run"]],
] as GateCommand[];

if (scripts["test:auto-sync-dashboard"]) commands.splice(3, 0, ["npm", ["run", "test:auto-sync-dashboard"]]);

const checks: AutoDevCheck[] = [];
for (const [command, args] of commands) {
  const result = runCommand(command, [...args], command === "npm" && args[1] === "build" ? 180000 : 300000);
  checks.push(result.ok
    ? pass(result.command, `Passed in ${result.durationMs}ms.`, { status: result.status })
    : fail(result.command, `Failed with status ${result.status}.`, result, "high"));
  if (!result.ok) break;
}

const report = makeReport("quality-gate", checks, [
  "Do not deploy or merge when any quality gate fails.",
  "401/403 endpoint failures remain fatal; recoverable Nitrado states are handled by production smoke/ADM watch.",
]);
writeReport("quality-gate", report);
if (!report.ok) process.exit(1);
