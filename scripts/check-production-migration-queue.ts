import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const CONFIRMATION = "RUN_READ_ONLY_PRODUCTION_MIGRATION_QUEUE_CHECK";
const databaseName = "dzn_network_db";
const migrationsDirectory = "migrations";

if (process.env.DZN_CONFIRM_PRODUCTION_READ_ONLY !== CONFIRMATION) {
  throw new Error(`DZN_CONFIRM_PRODUCTION_READ_ONLY must equal ${CONFIRMATION}.`);
}

const localMigrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort((left, right) => left.localeCompare(right));

const prefixes = new Map<string, string[]>();
for (const name of localMigrations) {
  const prefix = name.slice(0, 4);
  prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), name]);
}
const duplicatePrefixes = [...prefixes.entries()].filter(([, names]) => names.length > 1);
if (duplicatePrefixes.length > 0) {
  throw new Error(`Duplicate migration prefixes: ${duplicatePrefixes.map(([prefix, names]) => `${prefix} (${names.join(", ")})`).join("; ")}`);
}

const result = spawnSync(process.execPath, [
  "node_modules/wrangler/bin/wrangler.js",
  "d1",
  "execute",
  databaseName,
  "--remote",
  "--json",
  "--command",
  "SELECT name FROM d1_migrations ORDER BY id;",
], { encoding: "utf8", windowsHide: true });

if (result.error) throw new Error(`Unable to start Wrangler: ${result.error.message}`);
if (result.status !== 0) throw new Error(`Production migration ledger read failed: ${sanitize(result.stderr || result.stdout)}`);

const payload = parseWranglerJson(result.stdout);
const rows = payload.flatMap((entry) => entry.results ?? entry.result?.[0]?.results ?? []);
const applied = new Set(rows.map((row) => String(row.name ?? "")).filter(Boolean));
const pending = localMigrations.filter((name) => !applied.has(name));
const expected = String(process.env.DZN_EXPECTED_PENDING_MIGRATIONS ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

if (expected.length > 0 && JSON.stringify(pending) !== JSON.stringify(expected)) {
  throw new Error(`Pending migration queue mismatch. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(pending)}.`);
}

console.log(JSON.stringify({
  database: databaseName,
  readOnly: true,
  appliedCount: applied.size,
  localCount: localMigrations.length,
  pending,
}, null, 2));

function parseWranglerJson(stdout: string) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Wrangler did not return a JSON result array.");
  const parsed = JSON.parse(stdout.slice(start, end + 1));
  if (!Array.isArray(parsed) || parsed.some((entry) => entry?.success !== true)) {
    throw new Error("Wrangler returned an unsuccessful production ledger response.");
  }
  return parsed as Array<{ results?: Array<{ name?: unknown }>; result?: Array<{ results?: Array<{ name?: unknown }> }> }>;
}

function sanitize(value: string) {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-token]")
    .slice(0, 500);
}
