import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const DATABASE_NAME = "dzn_network_db";
const DATABASE_ID = "37515c66-2787-49e4-8568-a461517e975e";
const MIGRATION = "0106_games_hub_cipher_grid_specialist.sql";
const PREDECESSOR = "0105_games_hub_night_run_recon.sql";
const MIGRATION_SHA256 = "80554d1d221ce9eeb560c202b978e8376f4f1bd0315681a44e78627f347afb47";
const TABLE = "dzn_cipher_grid_sessions";
const STAGING_TABLE = "dzn_cipher_grid_sessions_next";
const COLUMNS = ["user_id", "id", "answer", "attempts_json", "status", "version", "started_at", "updated_at"];

type ForeignKey = {
  from: string;
  table: string;
  to: string;
  onDelete: string;
};

const FOREIGN_KEYS: ForeignKey[] = [{ from: "user_id", table: "users", to: "id", onDelete: "CASCADE" }];

const [command, ...rest] = process.argv.slice(2);
const argumentsByName = new Map<string, string>();
for (let index = 0; index < rest.length; index += 2) {
  const name = rest[index];
  const value = rest[index + 1];
  if (!name?.startsWith("--") || value === undefined) {
    throw new Error(`Expected --name value arguments, received ${rest.join(" ")}.`);
  }
  argumentsByName.set(name, value);
}

switch (command) {
  case "prepare":
    prepareMigrationStage(required("--stage-dir"));
    break;
  case "verify-ledger":
    verifyLedger(required("--ledger"), required("--phase"));
    break;
  case "verify-before":
    verifyBefore(required("--objects"), required("--table-info"), required("--foreign-keys"), required("--foreign-key-check"));
    break;
  case "fingerprint":
    fingerprint(required("--rows"));
    break;
  case "verify-after":
    verifyAfter(
      required("--objects"),
      required("--table-info"),
      required("--foreign-keys"),
      required("--foreign-key-check"),
      required("--before-row-count"),
      required("--after-row-count"),
      required("--before-fingerprint"),
      required("--after-fingerprint"),
    );
    break;
  case "print-objects-query":
    console.log(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name IN ('${TABLE}', '${STAGING_TABLE}') ORDER BY type, name;`);
    break;
  case "print-rows-query":
    console.log(`SELECT user_id, id, answer, attempts_json, status, version, started_at, updated_at FROM ${TABLE} ORDER BY user_id ASC;`);
    break;
  case "print-row-count-query":
    console.log(`SELECT COUNT(*) AS row_count FROM ${TABLE};`);
    break;
  default:
    throw new Error("Expected one of: prepare, verify-ledger, verify-before, fingerprint, verify-after, print-objects-query, print-rows-query, print-row-count-query.");
}

function required(name: string) {
  const value = argumentsByName.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function numberedMigrations() {
  const migrations = readdirSync("migrations")
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  const prefixes = new Map<string, string[]>();
  for (const name of migrations) {
    const prefix = name.slice(0, 4);
    prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), name]);
  }
  const duplicatePrefixes = [...prefixes.entries()].filter(([, names]) => names.length > 1);
  if (duplicatePrefixes.length > 0) {
    throw new Error(`Duplicate migration prefixes: ${duplicatePrefixes.map(([prefix, names]) => `${prefix} (${names.join(", ")})`).join("; ")}.`);
  }
  return migrations;
}

function migrationPosition() {
  const migrations = numberedMigrations();
  const targetIndex = migrations.indexOf(MIGRATION);
  if (targetIndex < 1 || migrations[targetIndex - 1] !== PREDECESSOR) {
    throw new Error(`${MIGRATION} must immediately follow ${PREDECESSOR}.`);
  }
  return { migrations, targetIndex };
}

function resolveInsideRepository(value: string) {
  const root = resolve(process.cwd());
  const resolved = resolve(root, value);
  const relativePath = relative(root, resolved);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Stage and verification paths must be inside the checked-out repository.");
  }
  return resolved;
}

function prepareMigrationStage(stageInput: string) {
  const { migrations, targetIndex } = migrationPosition();
  const source = readFileSync(join("migrations", MIGRATION));
  const sourceHash = createHash("sha256").update(source).digest("hex");
  if (sourceHash !== MIGRATION_SHA256) {
    throw new Error(`${MIGRATION} source hash does not match the approved data-preservation plan.`);
  }

  const stageDirectory = resolveInsideRepository(stageInput);
  if (existsSync(stageDirectory)) throw new Error(`Refusing to reuse existing migration stage ${stageInput}.`);
  mkdirSync(join(stageDirectory, "migrations"), { recursive: true });
  for (const migration of migrations.slice(0, targetIndex + 1)) {
    copyFileSync(join("migrations", migration), join(stageDirectory, "migrations", migration));
  }
  const config = [
    'name = "dzn-state-preserving-migration-production-rollout"',
    'compatibility_date = "2026-05-13"',
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    `database_name = "${DATABASE_NAME}"`,
    `database_id = "${DATABASE_ID}"`,
    'migrations_dir = "migrations"',
    "",
  ].join("\n");
  writeFileSync(join(stageDirectory, "wrangler.toml"), config, "utf8");
  writeFileSync(join(stageDirectory, "migration-plan.json"), `${JSON.stringify({
    database: { name: DATABASE_NAME, id: DATABASE_ID },
    migration: MIGRATION,
    predecessor: PREDECESSOR,
    sourceHash,
    table: TABLE,
    stagingTable: STAGING_TABLE,
  }, null, 2)}\n`, "utf8");
  console.log(`Prepared isolated state-preserving stage for ${MIGRATION}.`);
}

function readRows(path: string) {
  const raw = readFileSync(resolveInsideRepository(path), "utf8");
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error(`Expected Wrangler JSON array in ${path}.`);
  const parsed = JSON.parse(raw.slice(start, end + 1));
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.flatMap((entry) => entry?.results ?? entry?.result?.[0]?.results ?? []);
}

function normalizeSql(source: string) {
  return source.replace(/["`]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function verifyLedger(ledgerPath: string, phase: string) {
  if (phase !== "before" && phase !== "after") throw new Error("--phase must be before or after.");
  const { migrations, targetIndex } = migrationPosition();
  const applied = readRows(ledgerPath).map((row) => String(row.name ?? "")).filter(Boolean);
  if (new Set(applied).size !== applied.length) throw new Error("Production migration ledger contains duplicate names.");
  const expected = migrations.slice(0, phase === "before" ? targetIndex : targetIndex + 1);
  const appliedNames = new Set(applied);
  const expectedNames = new Set(expected);
  const missing = expected.filter((name) => !appliedNames.has(name));
  const unexpected = applied.filter((name) => !expectedNames.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`Production ledger membership mismatch for ${MIGRATION} ${phase} verification. Missing names: ${missing.join(", ") || "(none)"}. Unexpected names: ${unexpected.join(", ") || "(none)"}.`);
  }
  console.log(`Production migration ledger ${phase} verification passed for ${MIGRATION}.`);
}

function findObject(rows: Array<Record<string, unknown>>, name: string) {
  return rows.find((row) => String(row.name ?? "") === name);
}

function verifyTableInfo(tableInfoPath: string) {
  const actualColumns = readRows(tableInfoPath).map((row) => String(row.name ?? ""));
  if (JSON.stringify(actualColumns) !== JSON.stringify(COLUMNS)) {
    throw new Error(`Column verification failed for ${TABLE}. Expected ${COLUMNS.join(", ")}; received ${actualColumns.join(", ")}.`);
  }
}

function verifyForeignKeys(foreignKeysPath: string) {
  const foreignKeys = readRows(foreignKeysPath);
  if (foreignKeys.length !== FOREIGN_KEYS.length) throw new Error(`Foreign-key count mismatch for ${TABLE}.`);
  for (const expected of FOREIGN_KEYS) {
    const actual = foreignKeys.find((row) =>
      String(row.from ?? "") === expected.from &&
      String(row.table ?? "") === expected.table &&
      String(row.to ?? "") === expected.to &&
      String(row.on_delete ?? "").toUpperCase() === expected.onDelete,
    );
    if (!actual) throw new Error(`Missing expected foreign key ${TABLE}.${expected.from} -> ${expected.table}.${expected.to}.`);
  }
}

function verifyBefore(objectsPath: string, tableInfoPath: string, foreignKeysPath: string, foreignKeyCheckPath: string) {
  const objects = readRows(objectsPath);
  const table = findObject(objects, TABLE);
  if (!table || String(table.type ?? "") !== "table") throw new Error(`Missing source table ${TABLE}.`);
  if (findObject(objects, STAGING_TABLE)) throw new Error(`Unexpected existing staging table ${STAGING_TABLE}.`);
  const sourceSql = normalizeSql(String(table.sql ?? ""));
  if (!sourceSql.includes("LENGTH(ANSWER) = 5") || !sourceSql.includes("ANSWER = UPPER(ANSWER)")) {
    throw new Error(`${TABLE} is not in the expected five-letter Cipher Grid schema before ${MIGRATION}.`);
  }
  verifyTableInfo(tableInfoPath);
  verifyForeignKeys(foreignKeysPath);
  if (readRows(foreignKeyCheckPath).length > 0) throw new Error("Production foreign_key_check returned violations before migration.");
  console.log(`Production source schema and foreign-key baseline passed for ${MIGRATION}.`);
}

function fingerprint(rowsPath: string) {
  const rows = readRows(rowsPath);
  console.log(createHash("sha256").update(JSON.stringify(rows)).digest("hex"));
}

function readCount(path: string) {
  const rowCount = Number(readRows(path)[0]?.row_count ?? -1);
  if (!Number.isInteger(rowCount) || rowCount < 0) throw new Error(`Expected a non-negative row_count in ${path}.`);
  return rowCount;
}

function readFingerprint(path: string) {
  const fingerprintValue = readFileSync(resolveInsideRepository(path), "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(fingerprintValue)) throw new Error(`Expected a SHA-256 fingerprint in ${path}.`);
  return fingerprintValue;
}

function verifyAfter(
  objectsPath: string,
  tableInfoPath: string,
  foreignKeysPath: string,
  foreignKeyCheckPath: string,
  beforeRowCountPath: string,
  afterRowCountPath: string,
  beforeFingerprintPath: string,
  afterFingerprintPath: string,
) {
  const objects = readRows(objectsPath);
  const table = findObject(objects, TABLE);
  if (!table || String(table.type ?? "") !== "table") throw new Error(`Missing rebuilt table ${TABLE}.`);
  if (findObject(objects, STAGING_TABLE)) throw new Error(`Staging table ${STAGING_TABLE} remained after ${MIGRATION}.`);
  const rebuiltSql = normalizeSql(String(table.sql ?? ""));
  if (!rebuiltSql.includes("LENGTH(ANSWER) IN (5, 6)") || !rebuiltSql.includes("ANSWER = UPPER(ANSWER)")) {
    throw new Error(`${TABLE} does not contain the approved specialist-answer constraint after ${MIGRATION}.`);
  }
  verifyTableInfo(tableInfoPath);
  verifyForeignKeys(foreignKeysPath);
  if (readRows(foreignKeyCheckPath).length > 0) throw new Error("Production foreign_key_check returned violations after migration.");

  const beforeCount = readCount(beforeRowCountPath);
  const afterCount = readCount(afterRowCountPath);
  if (beforeCount !== afterCount) throw new Error(`Cipher Grid session row count changed from ${beforeCount} to ${afterCount}.`);
  if (readFingerprint(beforeFingerprintPath) !== readFingerprint(afterFingerprintPath)) {
    throw new Error("Cipher Grid session fingerprint changed during the state-preserving migration.");
  }
  console.log(`Production schema, constraints, foreign keys, and ${beforeCount} preserved Cipher Grid sessions verified for ${MIGRATION}.`);
}
