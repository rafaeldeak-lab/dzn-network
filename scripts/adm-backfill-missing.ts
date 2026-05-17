import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const hasApply = args.includes("--apply");
const admLocalIndex = args.indexOf("--adm-local");
const hasAdmLocal = admLocalIndex >= 0 && typeof args[admLocalIndex + 1] === "string";

if (hasAdmLocal) {
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/diagnose-adm-import.ts", ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

console.log("DZN ADM missing import audit.");
console.log("No tokens or secrets are printed.");
console.log("");
console.log("This command reports queued/unprocessed ADM files. To apply a local ADM file backfill, rerun with --adm-local.");
console.log("");

const auditArgs = args.filter((arg) => arg !== "--apply");
const audit = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/adm-audit-health.ts", ...auditArgs], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});

if (audit.status && audit.status !== 0) process.exit(audit.status);

if (hasApply) {
  console.log("");
  console.log("No database changes were made because --adm-local was not provided.");
  console.log("Example:");
  console.log('npm run adm:backfill-missing -- --service-id 18765761 --adm-local "C:\\\\path\\\\to\\\\file.ADM" --apply');
}
