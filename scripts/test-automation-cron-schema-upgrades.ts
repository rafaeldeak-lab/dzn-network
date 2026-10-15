import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("functions/_lib/automation.ts", "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("async function ensureAutomationCronRunsColumns");
const end = source.indexOf("async function ensureLinkedServerLifecycleColumns", start);
assert.notEqual(start, -1, "Automation cron schema guard should exist.");
assert.notEqual(end, -1, "Automation cron schema guard should have a stable boundary.");

const guard = source.slice(start, end);
assert.match(guard, /const addedColumns = new Set<string>\(\);/);
assert.match(guard, /addedColumns\.add\(column\)/);
assert.match(guard, /if \(addedColumns\.has\("job_type"\)\) \{[\s\S]*?WHERE job_type IS NULL AND endpoint IS NOT NULL[\s\S]*?WHERE job_type IS NULL/);
assert.match(guard, /if \(addedColumns\.has\("started_at"\)\) \{\s*await db\.prepare\("UPDATE automation_cron_runs SET started_at = COALESCE\(started_at, created_at\) WHERE started_at IS NULL"\)\.run\(\);/);
assert.match(guard, /if \(addedColumns\.has\("finished_at"\)\) \{\s*await db\.prepare\("UPDATE automation_cron_runs SET finished_at = COALESCE\(finished_at, created_at\) WHERE finished_at IS NULL"\)\.run\(\);/);
assert.match(guard, /if \(addedColumns\.size > 0\) \{\s*await db\.prepare\("UPDATE automation_cron_runs SET status = 'success' WHERE status IN \('completed', 'manual'\)"\)\.run\(\);/);

console.log("Automation cron schema upgrades avoid historical rewrites on current tables.");
