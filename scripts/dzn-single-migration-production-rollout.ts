import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const DATABASE_NAME = "dzn_network_db";
const DATABASE_ID = "37515c66-2787-49e4-8568-a461517e975e";

type ForeignKey = {
  from: string;
  table: string;
  to: string;
  onDelete: string;
};

type TablePlan = {
  name: string;
  columns: string[];
  foreignKeys: ForeignKey[];
};

type MigrationPlan = {
  migration: string;
  predecessor: string;
  tables: TablePlan[];
  indexes: string[];
};

type PreparedPlan = {
  database: {
    name: string;
    id: string;
  };
  migration: MigrationPlan;
  stagedMigrations: string[];
  expectedObjectSql: Record<string, string>;
};

function playerOwnedTable(name: string, columns: string[]): TablePlan {
  return {
    name,
    columns,
    foreignKeys: [{ from: "user_id", table: "users", to: "id", onDelete: "CASCADE" }],
  };
}

const MIGRATION_PLANS: Record<string, MigrationPlan> = {
  "0096_games_hub_relay_rush.sql": {
    migration: "0096_games_hub_relay_rush.sql",
    predecessor: "0095_dzn_owner_discord_delivery.sql",
    tables: [
      playerOwnedTable("dzn_relay_rush_sessions", ["user_id", "id", "route_json", "current_index", "misses", "status", "version", "started_at", "updated_at"]),
      playerOwnedTable("dzn_relay_rush_reward_ledger", ["id", "user_id", "reward_key", "game_id", "xp", "parts", "created_at"]),
    ],
    indexes: ["idx_dzn_relay_rush_rewards_history"],
  },
  "0097_games_hub_cipher_grid.sql": {
    migration: "0097_games_hub_cipher_grid.sql",
    predecessor: "0096_games_hub_relay_rush.sql",
    tables: [
      playerOwnedTable("dzn_cipher_grid_sessions", ["user_id", "id", "answer", "attempts_json", "status", "version", "started_at", "updated_at"]),
      playerOwnedTable("dzn_cipher_grid_reward_ledger", ["id", "user_id", "reward_key", "game_id", "xp", "parts", "created_at"]),
    ],
    indexes: ["idx_dzn_cipher_grid_rewards_history"],
  },
  "0098_games_hub_echo_array.sql": {
    migration: "0098_games_hub_echo_array.sql",
    predecessor: "0097_games_hub_cipher_grid.sql",
    tables: [
      playerOwnedTable("dzn_echo_array_sessions", ["user_id", "id", "sequence_json", "stage", "input_index", "errors", "status", "version", "cue_started_at", "started_at", "updated_at"]),
      playerOwnedTable("dzn_echo_array_reward_ledger", ["id", "user_id", "reward_key", "game_id", "xp", "parts", "created_at"]),
    ],
    indexes: ["idx_dzn_echo_array_rewards_history"],
  },
  "0099_games_hub_outpost_run.sql": {
    migration: "0099_games_hub_outpost_run.sql",
    predecessor: "0098_games_hub_echo_array.sql",
    tables: [
      playerOwnedTable("dzn_outpost_run_sessions", ["user_id", "id", "layout_json", "visited_json", "position_row", "position_column", "energy", "moves", "scanned", "status", "version", "started_at", "updated_at"]),
      playerOwnedTable("dzn_outpost_run_reward_ledger", ["id", "user_id", "reward_key", "game_id", "xp", "parts", "created_at"]),
    ],
    indexes: ["idx_dzn_outpost_run_rewards_history"],
  },
  "0100_games_hub_signal_shift.sql": {
    migration: "0100_games_hub_signal_shift.sql",
    predecessor: "0099_games_hub_outpost_run.sql",
    tables: [
      playerOwnedTable("dzn_signal_shift_sessions", ["user_id", "id", "tiles_json", "moves", "status", "version", "started_at", "updated_at"]),
      playerOwnedTable("dzn_signal_shift_reward_ledger", ["id", "user_id", "reward_key", "game_id", "xp", "parts", "created_at"]),
    ],
    indexes: ["idx_dzn_signal_shift_rewards_history"],
  },
  "0101_games_hub_circuit_forge.sql": {
    migration: "0101_games_hub_circuit_forge.sql",
    predecessor: "0100_games_hub_signal_shift.sql",
    tables: [
      playerOwnedTable("dzn_circuit_forge_sessions", ["user_id", "id", "rotations_json", "rotations", "status", "version", "started_at", "updated_at"]),
      playerOwnedTable("dzn_circuit_forge_reward_ledger", ["id", "user_id", "reward_key", "game_id", "xp", "parts", "created_at"]),
    ],
    indexes: ["idx_dzn_circuit_forge_rewards_history"],
  },
  "0102_games_hub_ranger_range.sql": {
    migration: "0102_games_hub_ranger_range.sql",
    predecessor: "0101_games_hub_circuit_forge.sql",
    tables: [
      playerOwnedTable("dzn_ranger_range_sessions", ["user_id", "id", "target_sequence_json", "shot_index", "misses", "status", "version", "target_started_at", "started_at", "updated_at"]),
      playerOwnedTable("dzn_ranger_range_reward_ledger", ["id", "user_id", "reward_key", "game_id", "xp", "parts", "created_at"]),
    ],
    indexes: ["idx_dzn_ranger_range_rewards_history"],
  },
};

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
    prepareMigrationStage(required("--migration"), required("--stage-dir"));
    break;
  case "verify-ledger":
    verifyLedger(required("--migration"), required("--ledger"), required("--phase"));
    break;
  case "verify-baseline":
    verifyBaseline(required("--migration"), required("--objects"), required("--foreign-key-check"));
    break;
  case "verify-schema":
    verifySchema(required("--stage-dir"), required("--objects"), required("--foreign-key-check"));
    break;
  case "print-objects-query":
    printObjectsQuery(required("--migration"));
    break;
  case "print-target-tables":
    printTargetTables(required("--migration"));
    break;
  default:
    throw new Error("Expected one of: prepare, verify-ledger, verify-baseline, verify-schema, print-objects-query, print-target-tables.");
}

function required(name: string) {
  const value = argumentsByName.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function planFor(migrationName: string) {
  const plan = MIGRATION_PLANS[migrationName];
  if (!plan) {
    throw new Error(`Migration ${migrationName} is not an approved single-migration rollout target.`);
  }
  return plan;
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

function migrationPosition(plan: MigrationPlan) {
  const migrations = numberedMigrations();
  const targetIndex = migrations.indexOf(plan.migration);
  if (targetIndex < 1) throw new Error(`Migration ${plan.migration} is missing or has no predecessor.`);
  if (migrations[targetIndex - 1] !== plan.predecessor) {
    throw new Error(`Migration ${plan.migration} must immediately follow ${plan.predecessor}.`);
  }
  return { migrations, targetIndex };
}

function normalizeSql(source: string) {
  return source
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;$/, "")
    .replace(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+/i, "CREATE TABLE ")
    .replace(/^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+/i, "CREATE INDEX ");
}

function sourceStatements(source: string) {
  const withoutComments = source
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  if (/\b(DROP|TRUNCATE|INSERT|UPDATE|ALTER|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i.test(withoutComments)) {
    throw new Error("Single-migration rollout targets must be additive schema-only SQL.");
  }
  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function expectedObjectSql(plan: MigrationPlan) {
  const source = readFileSync(join("migrations", plan.migration), "utf8");
  const statements = sourceStatements(source);
  const expectedTableNames = new Set(plan.tables.map((table) => table.name));
  const expectedIndexNames = new Set(plan.indexes);
  const objects: Record<string, string> = {};

  for (const statement of statements) {
    const tableMatch = statement.match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i);
    if (tableMatch) {
      const name = tableMatch[1];
      if (!expectedTableNames.has(name) || objects[name]) {
        throw new Error(`Migration ${plan.migration} contains an unsupported table statement for ${name}.`);
      }
      objects[name] = normalizeSql(statement);
      continue;
    }

    const indexMatch = statement.match(/^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i);
    if (indexMatch) {
      const name = indexMatch[1];
      const tableName = indexMatch[2];
      if (!expectedIndexNames.has(name) || objects[name] || !expectedTableNames.has(tableName)) {
        throw new Error(`Migration ${plan.migration} contains an unsupported index statement for ${name}.`);
      }
      objects[name] = normalizeSql(statement);
      continue;
    }

    throw new Error(`Migration ${plan.migration} contains an unsupported statement: ${statement.slice(0, 160)}.`);
  }

  const expectedNames = [...expectedTableNames, ...expectedIndexNames].sort();
  const actualNames = Object.keys(objects).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`Migration ${plan.migration} object set mismatch. Expected ${expectedNames.join(", ")}; received ${actualNames.join(", ")}.`);
  }
  return objects;
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

function prepareMigrationStage(migrationName: string, stageInput: string) {
  const plan = planFor(migrationName);
  const { migrations, targetIndex } = migrationPosition(plan);
  const stageDirectory = resolveInsideRepository(stageInput);
  if (existsSync(stageDirectory)) {
    throw new Error(`Refusing to reuse existing migration stage ${stageInput}.`);
  }

  const stagedMigrations = migrations.slice(0, targetIndex + 1);
  const objects = expectedObjectSql(plan);
  mkdirSync(join(stageDirectory, "migrations"), { recursive: true });
  for (const migration of stagedMigrations) {
    copyFileSync(join("migrations", migration), join(stageDirectory, "migrations", migration));
  }

  const config = [
    'name = "dzn-single-migration-production-rollout"',
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

  const prepared: PreparedPlan = {
    database: { name: DATABASE_NAME, id: DATABASE_ID },
    migration: plan,
    stagedMigrations,
    expectedObjectSql: objects,
  };
  writeFileSync(join(stageDirectory, "migration-plan.json"), `${JSON.stringify(prepared, null, 2)}\n`, "utf8");
  console.log(`Prepared isolated stage for ${migrationName} with ${stagedMigrations.length} migration files.`);
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

function verifyLedger(migrationName: string, ledgerPath: string, phase: string) {
  if (phase !== "before" && phase !== "after") throw new Error("--phase must be before or after.");
  const plan = planFor(migrationName);
  const { migrations, targetIndex } = migrationPosition(plan);
  const applied = readRows(ledgerPath).map((row) => String(row.name ?? "")).filter(Boolean);
  if (new Set(applied).size !== applied.length) throw new Error("Production migration ledger contains duplicate names.");
  const expected = migrations.slice(0, phase === "before" ? targetIndex : targetIndex + 1);
  if (JSON.stringify(applied) !== JSON.stringify(expected)) {
    throw new Error(`Production ledger mismatch before ${migrationName} ${phase} verification. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(applied)}.`);
  }
  console.log(`Production migration ledger ${phase} verification passed for ${migrationName}.`);
}

function verifyBaseline(migrationName: string, objectsPath: string, foreignKeyCheckPath: string) {
  const plan = planFor(migrationName);
  const expectedNames = new Set([...plan.tables.map((table) => table.name), ...plan.indexes]);
  const objects = readRows(objectsPath);
  const unexpectedExisting = objects.filter((row) => expectedNames.has(String(row.name ?? "")));
  if (unexpectedExisting.length > 0) {
    throw new Error(`Migration ${migrationName} target objects already exist: ${unexpectedExisting.map((row) => String(row.name)).join(", ")}.`);
  }
  const foreignKeyViolations = readRows(foreignKeyCheckPath);
  if (foreignKeyViolations.length > 0) throw new Error("Production foreign_key_check returned violations before migration.");
  console.log(`Production zero-object baseline passed for ${migrationName}.`);
}

function readPreparedPlan(stageInput: string) {
  const stageDirectory = resolveInsideRepository(stageInput);
  const prepared = JSON.parse(readFileSync(join(stageDirectory, "migration-plan.json"), "utf8")) as PreparedPlan;
  if (prepared.database?.name !== DATABASE_NAME || prepared.database?.id !== DATABASE_ID) {
    throw new Error("Prepared plan database identity mismatch.");
  }
  const canonical = planFor(prepared.migration?.migration ?? "");
  if (JSON.stringify(canonical) !== JSON.stringify(prepared.migration)) {
    throw new Error("Prepared migration plan does not match the source allowlist.");
  }
  migrationPosition(canonical);
  return { stageDirectory, prepared, plan: canonical };
}

function verifySchema(stageInput: string, objectsPath: string, foreignKeyCheckPath: string) {
  const { stageDirectory, prepared, plan } = readPreparedPlan(stageInput);
  const expectedNames = new Set([...plan.tables.map((table) => table.name), ...plan.indexes]);
  const actualObjects = readRows(objectsPath);
  if (actualObjects.length !== expectedNames.size) {
    throw new Error(`Expected ${expectedNames.size} target schema objects, found ${actualObjects.length}.`);
  }

  const objectsByName = new Map(actualObjects.map((row) => [String(row.name ?? ""), row]));
  for (const name of expectedNames) {
    const object = objectsByName.get(name);
    if (!object) throw new Error(`Missing production schema object ${name}.`);
    const expectedSql = normalizeSql(prepared.expectedObjectSql[name] ?? "");
    if (!expectedSql || normalizeSql(String(object.sql ?? "")) !== expectedSql) {
      throw new Error(`Production schema SQL mismatch for ${name}.`);
    }
  }

  for (const table of plan.tables) {
    const tableInfo = readRows(join(relative(resolve(process.cwd()), stageDirectory), `table-info-${table.name}.json`));
    const actualColumns = tableInfo.map((row) => String(row.name ?? ""));
    if (JSON.stringify(actualColumns) !== JSON.stringify(table.columns)) {
      throw new Error(`Column verification failed for ${table.name}. Expected ${table.columns.join(", ")}; received ${actualColumns.join(", ")}.`);
    }

    const foreignKeys = readRows(join(relative(resolve(process.cwd()), stageDirectory), `foreign-keys-${table.name}.json`));
    if (foreignKeys.length !== table.foreignKeys.length) {
      throw new Error(`Foreign-key count mismatch for ${table.name}.`);
    }
    for (const expected of table.foreignKeys) {
      const actual = foreignKeys.find((row) =>
        String(row.from ?? "") === expected.from &&
        String(row.table ?? "") === expected.table &&
        String(row.to ?? "") === expected.to &&
        String(row.on_delete ?? "").toUpperCase() === expected.onDelete,
      );
      if (!actual) throw new Error(`Missing expected foreign key ${table.name}.${expected.from} -> ${expected.table}.${expected.to}.`);
    }

    const rowCount = Number(readRows(join(relative(resolve(process.cwd()), stageDirectory), `row-count-${table.name}.json`))[0]?.row_count ?? -1);
    if (rowCount !== 0) throw new Error(`Migration ${plan.migration} should retain a zero-row baseline for ${table.name}; found ${rowCount}.`);
  }

  const foreignKeyViolations = readRows(foreignKeyCheckPath);
  if (foreignKeyViolations.length > 0) throw new Error("Production foreign_key_check returned violations after migration.");
  console.log(`Production schema, index, constraint, foreign-key, and zero-row verification passed for ${plan.migration}.`);
}

function quoteSql(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function printObjectsQuery(migrationName: string) {
  const plan = planFor(migrationName);
  const names = [...plan.tables.map((table) => table.name), ...plan.indexes].map(quoteSql).join(", ");
  console.log(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name IN (${names}) ORDER BY type, name;`);
}

function printTargetTables(migrationName: string) {
  for (const table of planFor(migrationName).tables) console.log(table.name);
}
