import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { classifyChangedFiles } from "./risk-classifier";
import { fail, gitChangedFiles, makeReport, pass, skip, writeReport, type AutoDevReport } from "./lib";

const enabled = process.env.AUTODEV_ENABLE_PROPOSE_FIX === "true";
const checks = [];

if (!enabled) {
  checks.push(skip("propose fix", "Safe fix proposal is disabled by default. Set AUTODEV_ENABLE_PROPOSE_FIX=true to allow PR branch creation."));
  const report = makeReport("propose-fix", checks, ["AutoDev does not create branches unless explicitly enabled."]);
  writeReport("propose-fix", report);
  process.exit(0);
}

const changed = gitChangedFiles();
if (changed.length > 0) {
  checks.push(fail("clean working tree", "Working tree must be clean before AutoDev proposes a fix.", { changed }, "high"));
  const report = makeReport("propose-fix", checks);
  writeReport("propose-fix", report);
  process.exit(1);
}

const reports = loadReports().filter((report) => !report.ok);
if (!reports.length) {
  checks.push(skip("reports", "No failing reports found."));
  const report = makeReport("propose-fix", checks);
  writeReport("propose-fix", report);
  process.exit(0);
}

const classifications = classifyChangedFiles(changed);
if (classifications.some((item) => item.risk !== "low")) {
  checks.push(fail("risk gate", "AutoDev can only propose deterministic low-risk fixes.", classifications, "high"));
  const report = makeReport("propose-fix", checks, ["Create an issue and request human/Codex review."]);
  writeReport("propose-fix", report);
  process.exit(1);
}

const branch = `autodev/safe-fix-${Date.now()}`;
execFileSync("git", ["checkout", "-b", branch], { stdio: "inherit" });
checks.push(pass("branch", `Created branch ${branch}.`));
checks.push(skip("fix application", "No deterministic low-risk fixer matched current reports. Issue creation should handle this failure."));

const report = makeReport("propose-fix", checks, ["No code was changed because the failure was not safely auto-fixable."]);
writeReport("propose-fix", report);

function loadReports(): AutoDevReport[] {
  const dir = path.join(".autodev", "reports");
  if (!existsSync(dir)) return [];
  return ["audit", "quality-gate", "production-smoke", "adm-cycle-watch"]
    .map((name) => path.join(dir, `${name}.json`))
    .filter(existsSync)
    .map((file) => JSON.parse(readFileSync(file, "utf8")) as AutoDevReport);
}
