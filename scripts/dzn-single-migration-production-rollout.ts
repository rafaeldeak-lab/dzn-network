import { createHash } from "node:crypto";
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

type StatePreservationPlan = {
  table: TablePlan;
  beforeColumns: string[];
  beforeColumnVariants?: string[][];
  afterColumns: string[];
  afterColumnVariants?: string[][];
  rowColumns: string[];
  allowConcurrentInserts?: boolean;
  sourceHash: string;
  beforeSqlFragments: string[];
  afterSqlFragments: string[];
  addedColumns: Array<{
    name: string;
    expectedValue: string | null;
  }>;
};

type MigrationPlan = {
  migration: string;
  predecessor: string;
  tables: TablePlan[];
  indexes: string[];
  triggers?: string[];
  statePreservation?: StatePreservationPlan;
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

function playerOwnedTable(name: string, columns: string[], additionalForeignKeys: ForeignKey[] = []): TablePlan {
  return {
    name,
    columns,
    foreignKeys: [{ from: "user_id", table: "users", to: "id", onDelete: "CASCADE" }, ...additionalForeignKeys],
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
  "0105_games_hub_night_run_recon.sql": {
    migration: "0105_games_hub_night_run_recon.sql",
    predecessor: "0104_games_hub_night_run.sql",
    tables: [
      playerOwnedTable("dzn_night_run_gate_scans", ["user_id", "game_id", "gate_index", "scanned_at"]),
    ],
    indexes: ["idx_dzn_night_run_gate_scans_session"],
  },
  "0107_dzn_command_centre.sql": {
    migration: "0107_dzn_command_centre.sql",
    predecessor: "0106_games_hub_cipher_grid_specialist.sql",
    tables: [
      playerOwnedTable("dzn_command_centre_profiles", ["user_id", "created_at", "updated_at"]),
      playerOwnedTable("dzn_command_centre_buildings", ["user_id", "building", "level", "target_level", "construction_started_at", "completes_at", "version"]),
      playerOwnedTable("dzn_command_centre_spend_ledger", ["id", "user_id", "request_id", "building", "from_level", "to_level", "parts_spent", "created_at"]),
    ],
    indexes: ["idx_dzn_command_centre_buildings_state", "idx_dzn_command_centre_spend_history"],
  },
  "0108_dzn_survival_command_expeditions.sql": {
    migration: "0108_dzn_survival_command_expeditions.sql",
    predecessor: "0107_dzn_command_centre.sql",
    tables: [
      playerOwnedTable("dzn_survival_command_profiles", ["user_id", "established_at", "updated_at"]),
      playerOwnedTable("dzn_survival_command_expeditions", ["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version"]),
      playerOwnedTable(
        "dzn_survival_command_resolution_ledger",
        ["id", "user_id", "expedition_id", "request_id", "action", "outcome", "salvage", "intel", "outcome_fingerprint", "resolved_at"],
        [{ from: "expedition_id", table: "dzn_survival_command_expeditions", to: "id", onDelete: "CASCADE" }],
      ),
    ],
    indexes: [
      "idx_dzn_survival_command_one_active_expedition",
      "idx_dzn_survival_command_expeditions_user_recent",
      "idx_dzn_survival_command_expeditions_daily",
      "idx_dzn_survival_command_resolution_history",
    ],
  },
  "0109_dzn_survival_command_loadouts.sql": {
    migration: "0109_dzn_survival_command_loadouts.sql",
    predecessor: "0108_dzn_survival_command_expeditions.sql",
    tables: [
      playerOwnedTable("dzn_survival_command_loadout_unlocks", ["user_id", "loadout", "unlocked_at"]),
      playerOwnedTable("dzn_survival_command_spend_ledger", ["id", "user_id", "request_id", "loadout", "salvage_spent", "intel_spent", "created_at"]),
    ],
    indexes: ["idx_dzn_survival_command_loadout_history"],
    statePreservation: {
      table: playerOwnedTable("dzn_survival_command_expeditions", ["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version"]),
      beforeColumns: ["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version"],
      afterColumns: ["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version", "loadout"],
      rowColumns: ["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version"],
      sourceHash: "80cbe71073858d889f617c423b6b0f0a43cb89d1d52788ed4fcc519e2a20ad43",
      beforeSqlFragments: ["CHECK (SECTOR IN ('PERIMETER', 'RAIL_YARD', 'RADIO_RIDGE', 'BLACKSITE'))", "CHECK (APPROACH IN ('SCOUT', 'BALANCED', 'BREACH'))", "UNIQUE (USER_ID, REQUEST_ID)"],
      afterSqlFragments: ["LOADOUT TEXT NOT NULL DEFAULT 'FIELD_KIT'", "CHECK (LOADOUT IN ('FIELD_KIT', 'SIGNAL_SCANNER', 'RECOVERY_KIT', 'CONVOY_PLATING'))"],
      addedColumns: [{ name: "loadout", expectedValue: "field_kit" }],
    },
  },
  "0110_games_hub_night_run_route_control.sql": {
    migration: "0110_games_hub_night_run_route_control.sql",
    predecessor: "0109_dzn_survival_command_loadouts.sql",
    tables: [],
    indexes: ["idx_dzn_night_run_route_control"],
    statePreservation: {
      table: playerOwnedTable("dzn_night_run_sessions", ["user_id", "id", "lane_sequence_json", "gate_index", "collisions", "status", "version", "gate_started_at", "started_at", "updated_at"]),
      beforeColumns: ["user_id", "id", "lane_sequence_json", "gate_index", "collisions", "status", "version", "gate_started_at", "started_at", "updated_at"],
      afterColumns: ["user_id", "id", "lane_sequence_json", "gate_index", "collisions", "status", "version", "gate_started_at", "started_at", "updated_at", "decoy_armed", "decoy_used", "burst_used", "gate_extension_ms"],
      rowColumns: ["user_id", "id", "lane_sequence_json", "gate_index", "collisions", "status", "version", "gate_started_at", "started_at", "updated_at"],
      sourceHash: "97c632a2d541eaeb480b9a4f455678abf139de69df0aedc9bdb47b9376126f22",
      beforeSqlFragments: ["CHECK (JSON_VALID(LANE_SEQUENCE_JSON) AND JSON_TYPE(LANE_SEQUENCE_JSON) = 'ARRAY')", "CHECK (GATE_INDEX BETWEEN 0 AND 9)", "CHECK (COLLISIONS BETWEEN 0 AND 2)", "ID TEXT NOT NULL UNIQUE"],
      afterSqlFragments: [
        "DECOY_ARMED INTEGER NOT NULL DEFAULT 0 CHECK (DECOY_ARMED IN (0, 1))",
        "DECOY_USED INTEGER NOT NULL DEFAULT 0 CHECK (DECOY_USED IN (0, 1))",
        "BURST_USED INTEGER NOT NULL DEFAULT 0 CHECK (BURST_USED IN (0, 1))",
        "GATE_EXTENSION_MS INTEGER NOT NULL DEFAULT 0 CHECK (GATE_EXTENSION_MS IN (0, 900))",
      ],
      addedColumns: [
        { name: "decoy_armed", expectedValue: "0" },
        { name: "decoy_used", expectedValue: "0" },
        { name: "burst_used", expectedValue: "0" },
        { name: "gate_extension_ms", expectedValue: "0" },
      ],
    },
  },
  "0111_games_hub_circuit_forge_grid_control.sql": {
    migration: "0111_games_hub_circuit_forge_grid_control.sql",
    predecessor: "0110_games_hub_night_run_route_control.sql",
    tables: [],
    indexes: ["idx_dzn_circuit_forge_grid_control"],
    statePreservation: {
      table: playerOwnedTable("dzn_circuit_forge_sessions", ["user_id", "id", "rotations_json", "rotations", "status", "version", "started_at", "updated_at"]),
      beforeColumns: ["user_id", "id", "rotations_json", "rotations", "status", "version", "started_at", "updated_at"],
      afterColumns: ["user_id", "id", "rotations_json", "rotations", "status", "version", "started_at", "updated_at", "diagnostic_used", "phase_used", "diagnostic_index"],
      rowColumns: ["user_id", "id", "rotations_json", "rotations", "status", "version", "started_at", "updated_at"],
      sourceHash: "dbe9a7164829adac8d0b520ea49c159816eb30cb86d865a7f1cda2c0854abcc6",
      beforeSqlFragments: [
        "CHECK (JSON_VALID(ROTATIONS_JSON) AND JSON_TYPE(ROTATIONS_JSON) = 'ARRAY')",
        "CHECK (ROTATIONS BETWEEN 0 AND 64)",
        "CHECK (STATUS IN ('PLAYING', 'WON', 'FAILED'))",
        "CHECK (VERSION BETWEEN 0 AND 64)",
        "ID TEXT NOT NULL UNIQUE",
      ],
      afterSqlFragments: [
        "DIAGNOSTIC_USED INTEGER NOT NULL DEFAULT 0 CHECK (DIAGNOSTIC_USED IN (0, 1))",
        "PHASE_USED INTEGER NOT NULL DEFAULT 0 CHECK (PHASE_USED IN (0, 1))",
        "DIAGNOSTIC_INDEX INTEGER CHECK (DIAGNOSTIC_INDEX IS NULL OR (DIAGNOSTIC_INDEX BETWEEN 0 AND 24 AND DIAGNOSTIC_INDEX <> 12))",
      ],
      addedColumns: [
        { name: "diagnostic_used", expectedValue: "0" },
        { name: "phase_used", expectedValue: "0" },
        { name: "diagnostic_index", expectedValue: null },
      ],
    },
  },
  "0112_dzn_survival_command_field_orders.sql": {
    migration: "0112_dzn_survival_command_field_orders.sql",
    predecessor: "0111_games_hub_circuit_forge_grid_control.sql",
    tables: [],
    indexes: ["idx_dzn_survival_command_field_order_request", "idx_dzn_survival_command_field_order_active"],
    statePreservation: {
      table: playerOwnedTable("dzn_survival_command_expeditions", ["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version", "loadout"]),
      beforeColumns: ["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version", "loadout"],
      afterColumns: ["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version", "loadout", "field_order", "field_order_request_id", "field_order_at"],
      rowColumns: ["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version", "loadout"],
      sourceHash: "9426b2732c208119ebf5bbdf5f82bebeb998b478c34e1180cb5fbf02ca7d400c",
      beforeSqlFragments: [
        "CHECK (SECTOR IN ('PERIMETER', 'RAIL_YARD', 'RADIO_RIDGE', 'BLACKSITE'))",
        "CHECK (APPROACH IN ('SCOUT', 'BALANCED', 'BREACH'))",
        "UNIQUE (USER_ID, REQUEST_ID)",
        "LOADOUT TEXT NOT NULL DEFAULT 'FIELD_KIT'",
        "CHECK (LOADOUT IN ('FIELD_KIT', 'SIGNAL_SCANNER', 'RECOVERY_KIT', 'CONVOY_PLATING'))",
      ],
      afterSqlFragments: [
        "FIELD_ORDER TEXT CHECK (FIELD_ORDER IS NULL OR FIELD_ORDER IN ('OVERWATCH', 'INTERCEPT', 'RECOVERY'))",
        "FIELD_ORDER_REQUEST_ID TEXT",
        "FIELD_ORDER_AT INTEGER",
      ],
      addedColumns: [
        { name: "field_order", expectedValue: null },
        { name: "field_order_request_id", expectedValue: null },
        { name: "field_order_at", expectedValue: null },
      ],
    },
  },
  "0113_dzn_server_status_evidence.sql": {
    migration: "0113_dzn_server_status_evidence.sql",
    predecessor: "0112_dzn_survival_command_field_orders.sql",
    tables: [
      {
        name: "dzn_server_status_evidence",
        columns: ["server_id", "server_status_confirmed_at"],
        foreignKeys: [{ from: "server_id", table: "linked_servers", to: "id", onDelete: "CASCADE" }],
      },
    ],
    indexes: [],
  },
  "0114_dzn_comms_chat_interactions.sql": {
    migration: "0114_dzn_comms_chat_interactions.sql",
    predecessor: "0113_dzn_server_status_evidence.sql",
    tables: [
      {
        name: "dzn_comms_custom_emoji_reactions",
        columns: ["id", "message_id", "actor_user_id", "reaction_key", "active", "created_at", "updated_at", "removed_at"],
        foreignKeys: [
          { from: "message_id", table: "dzn_comms_messages", to: "id", onDelete: "CASCADE" },
          { from: "actor_user_id", table: "users", to: "id", onDelete: "CASCADE" },
        ],
      },
      {
        name: "dzn_comms_typing_sessions",
        columns: ["channel_id", "actor_user_id", "display_name", "updated_at", "expires_at"],
        foreignKeys: [
          { from: "channel_id", table: "dzn_comms_channels", to: "id", onDelete: "CASCADE" },
          { from: "actor_user_id", table: "users", to: "id", onDelete: "CASCADE" },
        ],
      },
    ],
    indexes: ["idx_dzn_comms_custom_emoji_reactions_message_active", "idx_dzn_comms_typing_channel_expiry"],
    triggers: [
      "dzn_comms_custom_emoji_reaction_visible_insert",
      "dzn_comms_custom_emoji_reaction_visible_reactivate",
      "dzn_comms_custom_emoji_reaction_actor_cap_insert",
      "dzn_comms_custom_emoji_reaction_actor_cap_reactivate",
      "dzn_comms_custom_emoji_reaction_message_cap_insert",
      "dzn_comms_custom_emoji_reaction_message_cap_reactivate",
      "dzn_comms_custom_emoji_reactions_message_unavailable",
      "dzn_comms_legacy_reaction_actor_cap_insert",
      "dzn_comms_legacy_reaction_actor_cap_reactivate",
      "dzn_comms_legacy_reaction_message_cap_insert",
      "dzn_comms_legacy_reaction_message_cap_reactivate",
    ],
  },
  "0115_vault_cabinets.sql": {
    migration: "0115_vault_cabinets.sql",
    predecessor: "0114_dzn_comms_chat_interactions.sql",
    tables: [
      {
        name: "dzn_vault_grants",
        columns: ["id", "scope_type", "scope_id", "item_id", "source_type", "source_key", "status", "granted_at", "reversed_at"],
        foreignKeys: [],
      },
      {
        name: "dzn_vault_showcases",
        columns: ["scope_type", "scope_id", "version", "published", "slots_json", "updated_by_user_id", "updated_at"],
        foreignKeys: [],
      },
      {
        name: "dzn_vault_audit",
        columns: ["id", "scope_type", "scope_id", "actor_user_id", "action", "previous_version", "next_version", "detail_json", "created_at"],
        foreignKeys: [],
      },
    ],
    indexes: ["idx_dzn_vault_grants_scope", "idx_dzn_vault_audit_scope"],
    triggers: [
      "dzn_vault_grant_owner_exists",
      "dzn_vault_grant_identity_immutable",
      "dzn_vault_showcase_owner_exists",
      "dzn_vault_showcase_identity_immutable",
      "dzn_vault_audit_identity_immutable",
      "dzn_vault_audit_actor_anonymise_only",
    ],
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
  case "print-state-preservation-table":
    printStatePreservationTable(required("--migration"));
    break;
  case "print-state-preservation-objects-query":
    printStatePreservationObjectsQuery(required("--migration"));
    break;
  case "print-state-preservation-rows-query":
    printStatePreservationRowsQuery(required("--migration"));
    break;
  case "print-state-preservation-defaults-query":
    printStatePreservationDefaultsQuery(required("--migration"));
    break;
  case "verify-state-preservation-before":
    verifyStatePreservationBefore(required("--migration"), required("--objects"), required("--table-info"), required("--foreign-keys"), required("--foreign-key-check"));
    break;
  case "verify-state-preservation-after":
    verifyStatePreservationAfter(
      required("--migration"),
      required("--objects"),
      required("--table-info"),
      required("--foreign-keys"),
      required("--foreign-key-check"),
      required("--before-row-count"),
      required("--after-row-count"),
      required("--before-fingerprint"),
      required("--after-fingerprint"),
      required("--defaults"),
      argumentsByName.get("--before-rows"),
      argumentsByName.get("--after-rows"),
    );
    break;
  case "fingerprint":
    fingerprint(required("--rows"));
    break;
  case "print-account-deletion-operation-query":
    printAccountDeletionOperationQuery();
    break;
  case "verify-account-deletion-operations":
    verifyAccountDeletionOperations(required("--operations"));
    break;
  default:
    throw new Error("Expected one of: prepare, verify-ledger, verify-baseline, verify-schema, print-objects-query, print-target-tables, print-state-preservation-table, print-state-preservation-objects-query, print-state-preservation-rows-query, print-state-preservation-defaults-query, verify-state-preservation-before, verify-state-preservation-after, fingerprint, print-account-deletion-operation-query, verify-account-deletion-operations.");
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

function stripSqlComments(source: string) {
  let result = "";
  let quote: "'" | '"' | "`" | "[" | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (quote) {
      result += character;
      if (quote === "[") {
        if (character === "]") quote = null;
      } else if (character === quote) {
        if (next === quote) {
          result += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      result += character;
      continue;
    }
    if (character === "[") {
      quote = "[";
      result += character;
      continue;
    }
    if (character === "-" && next === "-") {
      while (index < source.length && source[index] !== "\n") index += 1;
      if (index < source.length) result += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      if (index < source.length) index += 1;
      result += " ";
      continue;
    }

    result += character;
  }
  return result;
}

function normalizeSql(source: string) {
  return stripSqlComments(source)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;$/, "")
    .replace(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+/i, "CREATE TABLE ")
    .replace(/^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+/i, "CREATE INDEX ")
    .replace(/^CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+/i, "CREATE TRIGGER ");
}

function sourceStatements(plan: MigrationPlan) {
  // Migration plans pin the canonical Git blob, which always uses LF. Normalize a
  // Windows checkout before hashing so the integrity guard is platform-neutral.
  const source = readFileSync(join("migrations", plan.migration), "utf8").replace(/\r\n/g, "\n");
  if (plan.statePreservation) {
    const sourceHash = createHash("sha256").update(source).digest("hex");
    if (sourceHash !== plan.statePreservation.sourceHash) {
      throw new Error(`${plan.migration} source hash does not match the approved state-preservation plan.`);
    }
  }
  const withoutComments = source
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statementPattern = /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?[A-Za-z_][A-Za-z0-9_]*\s+[\s\S]*?\bEND\s*;|(?:CREATE\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|ALTER\s+TABLE)\b[\s\S]*?;/gi;
  const statements: string[] = [];
  let cursor = 0;
  for (const match of withoutComments.matchAll(statementPattern)) {
    const leading = withoutComments.slice(cursor, match.index).trim();
    if (leading) throw new Error("Single-migration rollout targets must contain only approved additive schema objects.");
    statements.push(match[0].trim().replace(/;$/, ""));
    cursor = (match.index ?? 0) + match[0].length;
  }
  if (withoutComments.slice(cursor).trim()) {
    throw new Error("Single-migration rollout targets must contain only approved additive schema objects.");
  }
  const alterStatements = statements.filter((statement) => /^ALTER\s+TABLE\b/i.test(statement));
  if (alterStatements.length > 0 && !plan.statePreservation) {
    throw new Error("Single-migration rollout targets must be additive schema-only SQL.");
  }
  if (plan.statePreservation) {
    if (alterStatements.length !== plan.statePreservation.addedColumns.length) {
      throw new Error(`${plan.migration} does not contain exactly the approved state-preserving column additions.`);
    }
    for (const addedColumn of plan.statePreservation.addedColumns) {
      const matchingStatements = alterStatements.filter((statement) => new RegExp(`^ALTER\\s+TABLE\\s+${plan.statePreservation?.table.name}\\s+ADD\\s+COLUMN\\s+${addedColumn.name}\\b`, "i").test(statement));
      if (matchingStatements.length !== 1) {
        throw new Error(`${plan.migration} does not contain the approved state-preserving column addition ${addedColumn.name}.`);
      }
    }
  }
  return statements;
}

function expectedObjectSql(plan: MigrationPlan) {
  const statements = sourceStatements(plan);
  const expectedTableNames = new Set(plan.tables.map((table) => table.name));
  const permittedIndexTableNames = new Set([...expectedTableNames, ...(plan.statePreservation ? [plan.statePreservation.table.name] : [])]);
  const expectedIndexNames = new Set(plan.indexes);
  const expectedTriggerNames = new Set(plan.triggers ?? []);
  const objects: Record<string, string> = {};

  for (const statement of statements) {
    if (/^ALTER\s+TABLE\b/i.test(statement)) {
      if (!plan.statePreservation) throw new Error(`Migration ${plan.migration} contains an unsupported ALTER TABLE statement.`);
      continue;
    }
    const tableMatch = statement.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/i);
    if (tableMatch) {
      const name = tableMatch[1];
      if (!expectedTableNames.has(name) || objects[name]) {
        throw new Error(`Migration ${plan.migration} contains an unsupported table statement for ${name}.`);
      }
      objects[name] = normalizeSql(statement);
      continue;
    }

    const indexMatch = statement.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i);
    if (indexMatch) {
      const name = indexMatch[1];
      const tableName = indexMatch[2];
      if (!expectedIndexNames.has(name) || objects[name] || !permittedIndexTableNames.has(tableName)) {
        throw new Error(`Migration ${plan.migration} contains an unsupported index statement for ${name}.`);
      }
      objects[name] = normalizeSql(statement);
      continue;
    }

    const triggerMatch = statement.match(/^CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\b/i);
    if (triggerMatch) {
      const name = triggerMatch[1];
      if (!expectedTriggerNames.has(name) || objects[name]) {
        throw new Error(`Migration ${plan.migration} contains an unsupported trigger statement for ${name}.`);
      }
      objects[name] = normalizeSql(statement);
      continue;
    }

    throw new Error(`Migration ${plan.migration} contains an unsupported statement: ${statement.slice(0, 160)}.`);
  }

  const expectedNames = [...expectedTableNames, ...expectedIndexNames, ...expectedTriggerNames].sort();
  const actualNames = Object.keys(objects).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`Migration ${plan.migration} object set mismatch. Expected ${expectedNames.join(", ")}; received ${actualNames.join(", ")}.`);
  }
  return objects;
}

function migrationObjectNames(plan: MigrationPlan) {
  return [...plan.tables.map((table) => table.name), ...plan.indexes, ...(plan.triggers ?? [])];
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

function printAccountDeletionOperationQuery() {
  console.log("SELECT COUNT(*) AS active_account_deletion_operation_count FROM user_notifications WHERE type = 'internal_account_deletion_operation';");
}

function verifyAccountDeletionOperations(operationsPath: string) {
  const rows = readRows(operationsPath);
  if (rows.length !== 1) throw new Error("Expected exactly one aggregate account-deletion operation row.");
  const activeOperationCount = Number(rows[0]?.active_account_deletion_operation_count ?? -1);
  if (!Number.isInteger(activeOperationCount) || activeOperationCount < 0) {
    throw new Error("Expected a non-negative active_account_deletion_operation_count.");
  }
  if (activeOperationCount !== 0) {
    throw new Error(`Account-deletion operations are still active (${activeOperationCount}); refusing to capture the state-preservation baseline.`);
  }
  console.log("No active account-deletion operations remain.");
}

function verifyLedger(migrationName: string, ledgerPath: string, phase: string) {
  if (phase !== "before" && phase !== "after") throw new Error("--phase must be before or after.");
  const plan = planFor(migrationName);
  const { migrations, targetIndex } = migrationPosition(plan);
  const applied = readRows(ledgerPath).map((row) => String(row.name ?? "")).filter(Boolean);
  if (new Set(applied).size !== applied.length) throw new Error("Production migration ledger contains duplicate names.");
  const expected = migrations.slice(0, phase === "before" ? targetIndex : targetIndex + 1);
  const appliedNames = new Set(applied);
  const expectedNames = new Set(expected);
  const missing = expected.filter((name) => !appliedNames.has(name));
  const unexpected = applied.filter((name) => !expectedNames.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Production ledger membership mismatch for ${migrationName} ${phase} verification. ` +
        `Missing names: ${missing.join(", ") || "(none)"}. ` +
        `Unexpected names: ${unexpected.join(", ") || "(none)"}.`,
    );
  }
  console.log(`Production migration ledger ${phase} verification passed for ${migrationName}.`);
}

function verifyBaseline(migrationName: string, objectsPath: string, foreignKeyCheckPath: string) {
  const plan = planFor(migrationName);
  const expectedNames = new Set(migrationObjectNames(plan));
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
  const expectedNames = new Set(migrationObjectNames(plan));
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

function statePreservationFor(migrationName: string) {
  const statePreservation = planFor(migrationName).statePreservation;
  if (!statePreservation) throw new Error(`Migration ${migrationName} is not an approved state-preserving rollout target.`);
  return statePreservation;
}

function verifyStateColumns(tableName: string, actualRowsPath: string, expectedColumns: string[], acceptedVariants: string[][] = []) {
  const actualColumns = readRows(actualRowsPath).map((row) => String(row.name ?? ""));
  const acceptedOrders = [expectedColumns, ...acceptedVariants];
  if (!acceptedOrders.some((expected) => JSON.stringify(actualColumns) === JSON.stringify(expected))) {
    throw new Error(`Column verification failed for ${tableName}. Expected one of: ${acceptedOrders.map((columns) => columns.join(", ")).join(" | ")}; received ${actualColumns.join(", ")}.`);
  }
}

function verifyStateForeignKeys(state: StatePreservationPlan, foreignKeysPath: string) {
  const foreignKeys = readRows(foreignKeysPath);
  if (foreignKeys.length !== state.table.foreignKeys.length) {
    throw new Error(`Foreign-key count mismatch for ${state.table.name}.`);
  }
  for (const expected of state.table.foreignKeys) {
    const actual = foreignKeys.find((row) =>
      String(row.from ?? "") === expected.from &&
      String(row.table ?? "") === expected.table &&
      String(row.to ?? "") === expected.to &&
      String(row.on_delete ?? "").toUpperCase() === expected.onDelete,
    );
    if (!actual) throw new Error(`Missing expected foreign key ${state.table.name}.${expected.from} -> ${expected.table}.${expected.to}.`);
  }
}

function stateTableSql(state: StatePreservationPlan, objectsPath: string) {
  const objects = readRows(objectsPath);
  if (objects.length !== 1) throw new Error(`Expected exactly one source schema object for ${state.table.name}.`);
  const table = objects[0];
  if (String(table.type ?? "") !== "table" || String(table.name ?? "") !== state.table.name) {
    throw new Error(`Missing source table ${state.table.name}.`);
  }
  return normalizeSql(String(table.sql ?? "")).toUpperCase();
}

function verifyStatePreservationBefore(migrationName: string, objectsPath: string, tableInfoPath: string, foreignKeysPath: string, foreignKeyCheckPath: string) {
  const state = statePreservationFor(migrationName);
  const sql = stateTableSql(state, objectsPath);
  for (const fragment of state.beforeSqlFragments) {
    if (!sql.includes(fragment)) throw new Error(`${state.table.name} is missing the required pre-migration constraint ${fragment}.`);
  }
  verifyStateColumns(state.table.name, tableInfoPath, state.beforeColumns, state.beforeColumnVariants);
  verifyStateForeignKeys(state, foreignKeysPath);
  if (readRows(foreignKeyCheckPath).length > 0) throw new Error("Production foreign_key_check returned violations before migration.");
  console.log(`Production state-preservation baseline passed for ${migrationName}.`);
}

function fingerprint(rowsPath: string) {
  console.log(createHash("sha256").update(JSON.stringify(readRows(rowsPath))).digest("hex"));
}

function readCount(path: string) {
  const rowCount = Number(readRows(path)[0]?.row_count ?? -1);
  if (!Number.isInteger(rowCount) || rowCount < 0) throw new Error(`Expected a non-negative row_count in ${path}.`);
  return rowCount;
}

function readFingerprint(path: string) {
  const value = readFileSync(resolveInsideRepository(path), "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`Expected a SHA-256 fingerprint in ${path}.`);
  return value;
}

function verifyStatePreservationAfter(
  migrationName: string,
  objectsPath: string,
  tableInfoPath: string,
  foreignKeysPath: string,
  foreignKeyCheckPath: string,
  beforeRowCountPath: string,
  afterRowCountPath: string,
  beforeFingerprintPath: string,
  afterFingerprintPath: string,
  defaultsPath: string,
  beforeRowsPath?: string,
  afterRowsPath?: string,
) {
  const state = statePreservationFor(migrationName);
  const sql = stateTableSql(state, objectsPath);
  for (const fragment of [...state.beforeSqlFragments, ...state.afterSqlFragments]) {
    if (!sql.includes(fragment)) throw new Error(`${state.table.name} is missing the required post-migration constraint ${fragment}.`);
  }
  verifyStateColumns(state.table.name, tableInfoPath, state.afterColumns, state.afterColumnVariants);
  verifyStateForeignKeys(state, foreignKeysPath);
  if (readRows(foreignKeyCheckPath).length > 0) throw new Error("Production foreign_key_check returned violations after migration.");

  const beforeCount = readCount(beforeRowCountPath);
  const afterCount = readCount(afterRowCountPath);
  if (state.allowConcurrentInserts) {
    if (!beforeRowsPath || !afterRowsPath) {
      throw new Error(`${state.table.name} requires pre- and post-migration identity rows when concurrent inserts are allowed.`);
    }
    if (afterCount < beforeCount) throw new Error(`${state.table.name} row count decreased from ${beforeCount} to ${afterCount}.`);
    const afterRows = new Set(readRows(afterRowsPath).map((row) => JSON.stringify(row)));
    const missingRows = readRows(beforeRowsPath).filter((row) => !afterRows.has(JSON.stringify(row)));
    if (missingRows.length > 0) {
      throw new Error(`${state.table.name} lost or changed ${missingRows.length} pre-existing identity rows during the state-preserving migration.`);
    }
  } else {
    if (beforeCount !== afterCount) throw new Error(`${state.table.name} row count changed from ${beforeCount} to ${afterCount}.`);
    if (readFingerprint(beforeFingerprintPath) !== readFingerprint(afterFingerprintPath)) {
      throw new Error(`${state.table.name} fingerprint changed during the state-preserving migration.`);
    }
  }
  const initializedDefaults = readRows(defaultsPath);
  const preexistingIdentityRows = state.allowConcurrentInserts && beforeRowsPath ? readRows(beforeRowsPath) : [];
  if (!state.allowConcurrentInserts && initializedDefaults.length !== afterCount) {
    throw new Error(`${state.table.name} default-initialization query returned ${initializedDefaults.length} rows for ${afterCount} preserved rows.`);
  }
  for (const addedColumn of state.addedColumns) {
    if (state.allowConcurrentInserts) {
      const observedDefaultById = new Map(initializedDefaults.map((row) => [String(row.id ?? ""), row[addedColumn.name]]));
      const missingPreexistingDefault = preexistingIdentityRows.some((row) => !observedDefaultById.has(String(row.id ?? "")));
      if (missingPreexistingDefault) {
        throw new Error(`${state.table.name} default-initialization query did not retain every pre-existing row.`);
      }
    }
    const invalid = initializedDefaults.some((row) => addedColumn.expectedValue === null
      ? row[addedColumn.name] !== null
      : String(row[addedColumn.name] ?? "") !== addedColumn.expectedValue);
    if (invalid) {
      const expected = addedColumn.expectedValue === null ? "NULL" : addedColumn.expectedValue;
      throw new Error(`${state.table.name}.${addedColumn.name} was not initialized to ${expected} for every preserved row.`);
    }
  }
  console.log(`Production state preservation, default initialization, constraints, and foreign keys passed for ${migrationName}; ${beforeCount} ${state.table.name} rows retained.`);
}

function quoteSql(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function printObjectsQuery(migrationName: string) {
  const plan = planFor(migrationName);
  const names = migrationObjectNames(plan).map(quoteSql).join(", ");
  console.log(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name IN (${names}) ORDER BY type, name;`);
}

function printTargetTables(migrationName: string) {
  for (const table of planFor(migrationName).tables) console.log(table.name);
}

function printStatePreservationTable(migrationName: string) {
  const table = planFor(migrationName).statePreservation?.table.name;
  if (table) console.log(table);
}

function printStatePreservationObjectsQuery(migrationName: string) {
  const state = statePreservationFor(migrationName);
  console.log(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name = ${quoteSql(state.table.name)};`);
}

function printStatePreservationRowsQuery(migrationName: string) {
  const state = statePreservationFor(migrationName);
  console.log(`SELECT ${state.rowColumns.join(", ")} FROM ${state.table.name} ORDER BY id ASC;`);
}

function printStatePreservationDefaultsQuery(migrationName: string) {
  const state = statePreservationFor(migrationName);
  console.log(`SELECT id, ${state.addedColumns.map((column) => column.name).join(", ")} FROM ${state.table.name} ORDER BY id ASC;`);
}
