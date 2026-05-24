import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
const healthApiSource = readFileSync("functions/api/servers/[serverId]/dashboard/health.ts", "utf8");

const autoSurfaceStart = dashboardSource.indexOf("function AutoSyncDashboard");
const autoSurfaceEnd = dashboardSource.indexOf("function LastSyncDetails");
assert.notEqual(autoSurfaceStart, -1, "AutoSyncDashboard component must exist");
assert.notEqual(autoSurfaceEnd, -1, "AutoSyncDashboard slice end must exist");
assert.ok(autoSurfaceEnd > autoSurfaceStart, "AutoSyncDashboard slice must be valid");

const autoSurface = dashboardSource.slice(autoSurfaceStart, autoSurfaceEnd);

for (const forbidden of [
  "Check ADM Files",
  "Verify ADM Automation",
  "Backfill Missing ADM Now",
  "Recover Stuck Sync Locks",
  "Upload ADM Files",
  "Paste ADM Log Text",
  "Import ADM Files Now",
  "Optional exact ADM filename",
  "Show ADM Technical Diagnostics",
  "Manual fallback",
  "Manual confirmation",
  "Manual ADM Imports",
  "Previous Import Attempts",
  "Import Diagnostics",
  "Run Auto-Sync Now",
]) {
  assert.equal(autoSurface.includes(forbidden), false, `Owner Auto Sync surface must not render ${forbidden}`);
}

for (const required of [
  "AUTO SYNC ACTIVE",
  "WAITING FOR READABLE ADM",
  "NITRADO FILE SERVICE WAITING",
  "Awaiting first sync",
]) {
  assert.equal(dashboardSource.includes(required), true, `Owner Auto Sync status formatter should include ${required}`);
}

for (const required of [
  "Server Overview",
  "Automation Status",
  "Important Auto Health",
  "Live Sync Stats",
  "Recent Synced Events",
  "Recent Sync Runs",
  "AutomaticAdmImportJobPanel",
  "DZN automatically discovers, retries, and imports ADM data without manual action.",
  "No manual action required",
  "DZN retries unreadable ADM files automatically",
]) {
  assert.equal(autoSurface.includes(required), true, `Owner Auto Sync surface should render ${required}`);
}

assert.equal(autoSurface.includes("Nitrado Logs: Monitoring"), true);
assert.equal(dashboardSource.includes("NITRADO_UPSTREAM_DOWN"), true);
assert.equal(dashboardSource.includes("manualActionRequired: false"), true);
assert.equal(dashboardSource.includes("NITRADO_UNAUTHORIZED"), true);
assert.equal(dashboardSource.includes("manualActionRequired: true"), true);

assert.equal(dashboardSource.includes('activeTab !== "sync-health" && !normalizedServerCategory'), true);
assert.equal(dashboardSource.includes('activeTab === "discord-posts" || activeTab === "sync-health" ? "hidden"'), true);

assert.equal(healthApiSource.includes("autoSync"), true);
assert.equal(healthApiSource.includes("manualActionRequired"), true);
assert.equal(healthApiSource.includes("retryMode: \"automatic\""), true);
assert.equal(healthApiSource.includes("DZN found the latest ADM but Nitrado has not made it readable yet. Auto-sync will retry automatically."), true);
assert.equal(healthApiSource.includes("Reduce Log Output is disabled"), false);

console.log("Auto Sync dashboard owner UI checks passed.");
