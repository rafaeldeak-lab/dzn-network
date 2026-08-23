import { existsSync, rmSync, statSync } from "node:fs";
import { classifyChangedFiles } from "./risk-classifier";
import { fail, gitChangedFiles, makeReport, pass, readText, runCommand, skip, warn, writeReport, type AutoDevCheck, type ValidationProfileName } from "./lib";
import { selectQualityGateProfile, type ValidationCommand } from "./validation-profiles";

const TYPESCRIPT_BUILD_INFO_CACHES = ["tsconfig.tsbuildinfo", ".next/cache/.tsbuildinfo"];
const packageJson = JSON.parse(readText("package.json") || "{}") as { scripts?: Record<string, string> };
const scripts = packageJson.scripts ?? {};
const changedFiles = gitChangedFiles();
const classifications = classifyChangedFiles(changedFiles);
const profile = chooseProfile();
const checks: AutoDevCheck[] = [];

checks.push(pass("validation profile", `Selected ${profile.name} profile: ${profile.description}`, {
  changedFiles,
  systems: Array.from(new Set(classifications.map((item) => item.system))),
  risk: classifications.map((item) => item.risk),
}));

if (profile.requiresBrowserQa) checks.push(warn("browser QA required", `${profile.name} changes require browser QA evidence when user-facing behavior changed.`));
if (profile.requiresSecurityReview) checks.push(warn("security review required", `${profile.name} changes require security review before merge.`));

for (const command of profile.commands) {
  if (!isAvailable(command)) {
    checks.push(skip(commandLabel(command), "Command skipped because the referenced npm script is not present.", command));
    continue;
  }
  removeTypeScriptBuildInfoCache(command);
  const result = runCommand(command.command, command.args, command.timeoutMs ?? defaultTimeout(command));
  checks.push(result.ok
    ? pass(result.command, `Passed in ${result.durationMs}ms. ${command.reason}`, { status: result.status })
    : fail(result.command, `Failed with status ${result.status}. ${command.reason}`, result, "high"));
  if (!result.ok) break;
}

const report = makeReport("quality-gate", checks, [
  "Do not deploy or merge when any required quality gate fails.",
  "Use subsystem profiles; do not run ADM Worker dry-run for unrelated docs/CSS-only changes.",
  "401/403 endpoint failures remain fatal; recoverable Nitrado states are handled by production smoke/ADM watch.",
]);
writeReport("quality-gate", { ...report, validationProfile: profile, changedFiles, classifications });
if (!report.ok) process.exit(1);

function chooseProfile() {
  const requested = process.env.AUTODEV_VALIDATION_PROFILE as ValidationProfileName | undefined;
  return selectQualityGateProfile({
    classifications,
    requestedProfile: requested,
    inGithubActions: process.env.GITHUB_ACTIONS === "true",
  });
}

function isAvailable(command: ValidationCommand) {
  if (command.command !== "npm" || command.args[0] !== "run") return true;
  return Boolean(scripts[command.args[1]]);
}

function commandLabel(command: ValidationCommand) {
  return [command.command, ...command.args].join(" ");
}

function defaultTimeout(command: ValidationCommand) {
  if (command.command === "npm" && command.args.includes("build")) return 180000;
  if (command.command === "npm" && command.args.includes("test:full-system")) return 1200000;
  return 300000;
}

function removeTypeScriptBuildInfoCache(command: ValidationCommand) {
  if (!usesTypeScriptBuildInfoCache(command)) return;
  for (const cachePath of TYPESCRIPT_BUILD_INFO_CACHES) {
    if (existsSync(cachePath) && statSync(cachePath).isFile()) rmSync(cachePath, { force: true });
  }
}

function usesTypeScriptBuildInfoCache(command: ValidationCommand) {
  if (command.command === "npx" && command.args[0] === "tsc") return true;
  if (command.command === "npm" && command.args[0] === "run" && command.args[1] === "build") return true;
  return false;
}
