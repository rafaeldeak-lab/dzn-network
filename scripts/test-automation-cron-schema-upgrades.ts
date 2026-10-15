import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("functions/_lib/automation.ts", "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("async function ensureAutomationCronRunsColumns");
const end = source.indexOf("async function ensureLinkedServerLifecycleColumns", start);
assert.notEqual(start, -1, "Automation cron schema guard should exist.");
assert.notEqual(end, -1, "Automation cron schema guard should have a stable boundary.");

const guard = source.slice(start, end);
assert.match(guard, /Historical repairs must run once through the ledger-backed 0103 migration/);
assert.doesNotMatch(guard, /UPDATE automation_cron_runs/i, "Routine schema checks must not rescan cron history.");
assert.match(guard, /CREATE INDEX IF NOT EXISTS idx_automation_cron_runs_job_type/);

console.log("Automation cron schema upgrades remain additive and avoid historical rewrites.");
