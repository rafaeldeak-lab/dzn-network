import type { ParsedAdmEvent } from "./adm-parser";
import { requireDb } from "./db";
import type { Env } from "./types";

export type BuildEventType =
  | "built"
  | "placed"
  | "dismantled"
  | "folded"
  | "repaired"
  | "mounted"
  | "unmounted"
  | "destroyed"
  | "flag_raised"
  | "flag_lowered";
export type BuildCategory =
  | "structure"
  | "build_kit"
  | "storage"
  | "trap"
  | "utility"
  | "territory"
  | "deployable"
  | "maintenance"
  | "raid"
  | "defence"
  | "none";

export type ParsedBuildActivity = {
  eventType: BuildEventType;
  category: BuildCategory;
  buildPart: string | null;
  targetObject: string | null;
  tool: string | null;
  placedObject: string | null;
  placedClass: string | null;
  score: number;
};

export type BuildScoreInput = {
  structuresBuilt?: number | null;
  buildItemsPlaced?: number | null;
  storageItemsPlaced?: number | null;
  trapsPlaced?: number | null;
  weightedStructurePoints?: number | null;
};

export type BuildStatsInput = {
  eventType: BuildEventType;
  category: BuildCategory;
  buildPart?: string | null;
  placedClass?: string | null;
};

export type PublicBuildLeaderboardRow = {
  rank: number;
  server_id: string;
  server_name: string;
  slug: string | null;
  structures_built: number;
  build_items_placed: number;
  storage_items_placed: number;
  traps_placed: number;
  build_score: number;
  top_builder_name: string | null;
  top_builder_count: number;
  last_build_at: string | null;
};

type BuildServerRow = {
  server_id: string;
  server_name: string | null;
  slug: string | null;
  structures_built: number | null;
  build_items_placed: number | null;
  storage_items_placed: number | null;
  traps_placed: number | null;
  build_score: number | null;
  top_builder_name: string | null;
  top_builder_count: number | null;
  last_build_at: string | null;
};

const STRUCTURE_PARTS = new Set([
  "base",
  "wall_base_up",
  "wall_base_down",
  "wall_gate",
  "wall_wood_up",
  "wall_wood_down",
  "wall_metal_up",
  "wall_metal_down",
  "wall_platform",
  "platform",
  "stairs",
  "roof",
  "floor",
  "ramp",
  "watchtower",
  "watchtower_base",
  "watchtower_floor",
  "watchtower_roof",
  "watchtower_stairs",
  "watchtower_wall",
  "level_1_base",
  "level_1_roof",
  "level_1_stairs",
  "level_2_base",
  "level_2_roof",
  "level_2_stairs",
  "level_3_base",
  "level_3_roof",
  "level_3_stairs",
]);

const BUILD_KITS = new Set([
  "fencekit",
  "watchtowerkit",
  "territoryflagkit",
  "flagpolekit",
  "shelterkit",
]);

const STORAGE_CLASSES = [
  "woodencrate",
  "barrel",
  "seachest",
  "tent",
  "mediumtent",
  "largetent",
  "carTent",
].map((value) => value.toLowerCase());

const TRAP_CLASSES = new Set([
  "landminetrap",
  "beartrap",
  "tripwiretrap",
  "improvisedexplosive",
  "claymoremine",
  "fireworkslauncher",
]);
const UTILITY_CLASSES = new Set(["spotlight", "constructionlight"]);

export function classifyParsedBuildEvent(parsed: ParsedAdmEvent): ParsedBuildActivity | null {
  if (parsed.eventType === "player_built_structure") {
    const buildPart = normalizeBuildPart(parsed.buildPart);
    const category = buildPart && isStructureBuildPart(buildPart) ? "structure" : "deployable";
    return {
      eventType: "built",
      category,
      buildPart,
      targetObject: normalizeText(parsed.targetObject),
      tool: normalizeText(parsed.tool),
      placedObject: null,
      placedClass: null,
      score: category === "structure" ? scoreBuiltPart(buildPart) : 0,
    };
  }

  if (parsed.eventType === "player_dismantled_structure") {
    return {
      eventType: "dismantled",
      category: "raid",
      buildPart: normalizeBuildPart(parsed.buildPart),
      targetObject: normalizeText(parsed.targetObject),
      tool: normalizeText(parsed.tool),
      placedObject: null,
      placedClass: null,
      score: 0,
    };
  }

  if (parsed.eventType === "player_repaired_structure") {
    return {
      eventType: "repaired",
      category: "maintenance",
      buildPart: normalizeBuildPart(parsed.buildPart ?? parsed.targetObject ?? parsed.objectType),
      targetObject: normalizeText(parsed.targetObject ?? parsed.objectType),
      tool: normalizeText(parsed.tool),
      placedObject: null,
      placedClass: null,
      score: 1,
    };
  }

  if (parsed.eventType === "player_mounted_object" || parsed.eventType === "player_unmounted_object") {
    return {
      eventType: parsed.eventType === "player_mounted_object" ? "mounted" : "unmounted",
      category: "defence",
      buildPart: normalizeBuildPart(parsed.buildPart ?? parsed.placedObject),
      targetObject: normalizeText(parsed.targetObject ?? parsed.objectType),
      tool: null,
      placedObject: normalizeText(parsed.placedObject ?? parsed.buildPart),
      placedClass: normalizeClass(parsed.placedClass ?? parsed.placedObject ?? parsed.buildPart),
      score: parsed.eventType === "player_mounted_object" ? 2 : 0,
    };
  }

  if (parsed.eventType === "player_destroyed_object") {
    return {
      eventType: "destroyed",
      category: "raid",
      buildPart: normalizeBuildPart(parsed.buildPart ?? parsed.targetObject ?? parsed.objectType),
      targetObject: normalizeText(parsed.targetObject ?? parsed.objectType),
      tool: normalizeText(parsed.tool),
      placedObject: null,
      placedClass: null,
      score: 5,
    };
  }

  if (parsed.eventType === "player_folded_structure") {
    return {
      eventType: "folded",
      category: "maintenance",
      buildPart: normalizeBuildPart(parsed.buildPart ?? parsed.targetObject ?? parsed.objectType),
      targetObject: normalizeText(parsed.targetObject ?? parsed.objectType),
      tool: normalizeText(parsed.tool),
      placedObject: null,
      placedClass: null,
      score: 0,
    };
  }

  if (parsed.eventType === "territory_flag_raised" || parsed.eventType === "territory_flag_lowered") {
    return {
      eventType: parsed.eventType === "territory_flag_raised" ? "flag_raised" : "flag_lowered",
      category: "territory",
      buildPart: null,
      targetObject: normalizeText(parsed.targetObject ?? parsed.objectType),
      tool: null,
      placedObject: normalizeText(parsed.placedObject),
      placedClass: normalizeClass(parsed.placedClass ?? parsed.objectType),
      score: 0,
    };
  }

  if (parsed.eventType === "player_placed_object") {
    const placedClass = normalizeClass(parsed.placedClass ?? parsed.objectType);
    const placedObject = normalizeText(parsed.placedObject ?? parsed.objectType);
    const category = classifyPlacedObject(placedClass, placedObject);
    if (category === "none") return null;
    return {
      eventType: "placed",
      category,
      buildPart: null,
      targetObject: null,
      tool: null,
      placedObject,
      placedClass,
      score: scorePlacedObject(category),
    };
  }

  return null;
}

export function isParsedBuildEvent(parsed: ParsedAdmEvent) {
  return classifyParsedBuildEvent(parsed) !== null;
}

export function calculateBuildScore(stats: BuildScoreInput) {
  const weightedStructurePoints = numberOrZero(stats.weightedStructurePoints);
  const structurePoints = weightedStructurePoints > 0 ? weightedStructurePoints : numberOrZero(stats.structuresBuilt) * 10;
  return Math.max(
    0,
    structurePoints +
      numberOrZero(stats.buildItemsPlaced) * 5 +
      numberOrZero(stats.storageItemsPlaced) * 3 +
      numberOrZero(stats.trapsPlaced),
  );
}

export function summarizeBuildStats(events: BuildStatsInput[]) {
  let structuresBuilt = 0;
  let buildItemsPlaced = 0;
  let storageItemsPlaced = 0;
  let trapsPlaced = 0;
  let weightedStructurePoints = 0;

  for (const event of events) {
    if (event.eventType === "built" && event.category === "structure") {
      structuresBuilt += 1;
      weightedStructurePoints += scoreBuiltPart(event.buildPart);
    }
    if (event.eventType === "placed" && event.category === "build_kit") buildItemsPlaced += 1;
    if (event.eventType === "placed" && event.category === "storage") storageItemsPlaced += 1;
    if (event.eventType === "placed" && event.category === "trap") trapsPlaced += 1;
  }

  return {
    structuresBuilt,
    buildItemsPlaced,
    storageItemsPlaced,
    trapsPlaced,
    buildScore: calculateBuildScore({
      structuresBuilt,
      buildItemsPlaced,
      storageItemsPlaced,
      trapsPlaced,
      weightedStructurePoints,
    }),
  };
}

export async function ensureBuildEventSchema(env: Env) {
  const db = requireDb(env);
  for (const statement of BUILD_EVENT_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
}

export async function rebuildServerBuildStats(env: Env, linkedServerId: string) {
  await ensureBuildEventSchema(env);
  const db = requireDb(env);
  const server = await db
    .prepare("SELECT nitrado_service_id FROM linked_servers WHERE id = ? LIMIT 1")
    .bind(linkedServerId)
    .first<{ nitrado_service_id: string | null }>();

  const totals = await db
    .prepare(
      `SELECT
        SUM(CASE WHEN event_type = 'built' AND ${structureBuildPartSql("build_part")} THEN 1 ELSE 0 END) AS structures_built,
        SUM(CASE WHEN event_type = 'placed' AND lower(COALESCE(placed_class, '')) IN (${sqlStringList([...BUILD_KITS])}) THEN 1 ELSE 0 END) AS build_items_placed,
        SUM(CASE WHEN event_type = 'placed' AND ${storageSql("placed_class")} THEN 1 ELSE 0 END) AS storage_items_placed,
        SUM(CASE WHEN event_type = 'placed' AND lower(COALESCE(placed_class, '')) IN (${sqlStringList([...TRAP_CLASSES])}) THEN 1 ELSE 0 END) AS traps_placed,
        SUM(
          CASE
            WHEN event_type = 'built' AND build_part = 'wall_gate' THEN 15
            WHEN event_type = 'built' AND build_part = 'base' THEN 12
            WHEN event_type = 'built' AND build_part LIKE 'wall_metal_%' THEN 12
            WHEN event_type = 'built' AND ${structureBuildPartSql("build_part")} THEN 10
            WHEN event_type = 'placed' AND lower(COALESCE(placed_class, '')) IN (${sqlStringList([...BUILD_KITS])}) THEN 5
            WHEN event_type = 'placed' AND ${storageSql("placed_class")} THEN 3
            WHEN event_type = 'placed' AND lower(COALESCE(placed_class, '')) IN (${sqlStringList([...TRAP_CLASSES])}) THEN 1
            WHEN event_type = 'placed' AND lower(COALESCE(placed_class, '')) IN (${sqlStringList([...UTILITY_CLASSES])}) THEN 1
            ELSE 0
          END
        ) AS build_score,
        MAX(COALESCE(occurred_at, created_at)) AS last_build_at
       FROM build_events
       WHERE linked_server_id = ?`,
    )
    .bind(linkedServerId)
    .first<{
      structures_built: number | null;
      build_items_placed: number | null;
      storage_items_placed: number | null;
      traps_placed: number | null;
      build_score: number | null;
      last_build_at: string | null;
    }>();

  const topBuilder = await db
    .prepare(
      `SELECT player_name, COUNT(*) AS count
       FROM build_events
       WHERE linked_server_id = ?
         AND event_type IN ('built', 'placed')
         AND player_name IS NOT NULL
       GROUP BY COALESCE(player_id, lower(player_name)), player_name
       ORDER BY count DESC, MAX(COALESCE(occurred_at, created_at)) DESC
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ player_name: string | null; count: number | null }>();

  await db
    .prepare(
      `INSERT INTO server_build_stats (
        linked_server_id, nitrado_service_id, structures_built, build_items_placed,
        storage_items_placed, traps_placed, build_score, top_builder_name,
        top_builder_count, last_build_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        nitrado_service_id = excluded.nitrado_service_id,
        structures_built = excluded.structures_built,
        build_items_placed = excluded.build_items_placed,
        storage_items_placed = excluded.storage_items_placed,
        traps_placed = excluded.traps_placed,
        build_score = excluded.build_score,
        top_builder_name = excluded.top_builder_name,
        top_builder_count = excluded.top_builder_count,
        last_build_at = excluded.last_build_at,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      linkedServerId,
      server?.nitrado_service_id ?? "",
      numberOrZero(totals?.structures_built),
      numberOrZero(totals?.build_items_placed),
      numberOrZero(totals?.storage_items_placed),
      numberOrZero(totals?.traps_placed),
      numberOrZero(totals?.build_score),
      topBuilder?.player_name ?? null,
      numberOrZero(topBuilder?.count),
      totals?.last_build_at ?? null,
    )
    .run();
}

export async function getRankedBuildServers(env: Env, limit = 10): Promise<PublicBuildLeaderboardRow[]> {
  await ensureBuildEventSchema(env);
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT
        linked_servers.id AS server_id,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug AS slug,
        COALESCE(server_build_stats.structures_built, 0) AS structures_built,
        COALESCE(server_build_stats.build_items_placed, 0) AS build_items_placed,
        COALESCE(server_build_stats.storage_items_placed, 0) AS storage_items_placed,
        COALESCE(server_build_stats.traps_placed, 0) AS traps_placed,
        COALESCE(server_build_stats.build_score, 0) AS build_score,
        server_build_stats.top_builder_name,
        COALESCE(server_build_stats.top_builder_count, 0) AS top_builder_count,
        server_build_stats.last_build_at
       FROM linked_servers
       LEFT JOIN server_build_stats ON server_build_stats.linked_server_id = linked_servers.id
       WHERE lower(linked_servers.status) = 'live'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY build_score DESC, structures_built DESC, last_build_at DESC
       LIMIT ?`,
    )
    .bind(Math.min(Math.max(Math.trunc(limit), 1), 50))
    .all<BuildServerRow>();

  return (result.results ?? []).map((row, index) => ({
    rank: index + 1,
    server_id: row.server_id,
    server_name: row.server_name ?? "Unnamed DZN Server",
    slug: row.slug ?? null,
    structures_built: numberOrZero(row.structures_built),
    build_items_placed: numberOrZero(row.build_items_placed),
    storage_items_placed: numberOrZero(row.storage_items_placed),
    traps_placed: numberOrZero(row.traps_placed),
    build_score: numberOrZero(row.build_score),
    top_builder_name: row.top_builder_name ?? null,
    top_builder_count: numberOrZero(row.top_builder_count),
    last_build_at: row.last_build_at ?? null,
  }));
}

function classifyPlacedObject(placedClass: string | null, placedObject: string | null): BuildCategory {
  const lookup = normalizeClass(placedClass ?? placedObject) ?? "";
  if (BUILD_KITS.has(lookup)) return "build_kit";
  if (TRAP_CLASSES.has(lookup)) return "trap";
  if (UTILITY_CLASSES.has(lookup)) return "utility";
  if (STORAGE_CLASSES.some((prefix) => lookup.startsWith(prefix))) return "storage";
  return "none";
}

function scorePlacedObject(category: BuildCategory) {
  if (category === "build_kit") return 5;
  if (category === "storage") return 3;
  if (category === "trap") return 1;
  if (category === "utility") return 1;
  return 0;
}

function scoreBuiltPart(part: string | null | undefined) {
  const normalized = normalizeBuildPart(part);
  if (!normalized) return 0;
  if (normalized === "wall_gate") return 15;
  if (normalized === "base") return 12;
  if (normalized.startsWith("wall_metal_")) return 12;
  if (isStructureBuildPart(normalized)) return 10;
  return 0;
}

function isStructureBuildPart(value: string | null | undefined) {
  const normalized = normalizeBuildPart(value);
  if (!normalized) return false;
  if (STRUCTURE_PARTS.has(normalized)) return true;
  if (/^level_[123]_(base|roof|stairs)$/.test(normalized)) return true;
  if (/^level_[123]_wall_\d+_(base|wood|metal)_(up|down)$/.test(normalized)) return true;
  if (/^wall_(base|wood|metal)_(up|down)$/.test(normalized)) return true;
  return false;
}

function normalizeBuildPart(value: string | null | undefined) {
  const text = normalizeText(value)?.replace(/\s+/g, "_").toLowerCase();
  return text || null;
}

function normalizeClass(value: string | null | undefined) {
  const text = normalizeText(value)?.replace(/[^A-Za-z0-9_]/g, "").toLowerCase();
  return text || null;
}

function normalizeText(value: string | null | undefined) {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || null;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function sqlStringList(values: string[]) {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
}

function storageSql(column: string) {
  return `(${STORAGE_CLASSES.map((prefix) => `lower(COALESCE(${column}, '')) LIKE '${prefix.replace(/'/g, "''")}%'`).join(" OR ")})`;
}

function structureBuildPartSql(column: string) {
  const normalized = `lower(COALESCE(${column}, ''))`;
  return `(${[
    `${normalized} IN (${sqlStringList([...STRUCTURE_PARTS])})`,
    `${normalized} LIKE 'level_%_base'`,
    `${normalized} LIKE 'level_%_roof'`,
    `${normalized} LIKE 'level_%_stairs'`,
    `${normalized} LIKE 'level_%_wall_%_base_%'`,
    `${normalized} LIKE 'level_%_wall_%_wood_%'`,
    `${normalized} LIKE 'level_%_wall_%_metal_%'`,
    `${normalized} LIKE 'wall_base_%'`,
    `${normalized} LIKE 'wall_wood_%'`,
    `${normalized} LIKE 'wall_metal_%'`,
  ].join(" OR ")})`;
}

const BUILD_EVENT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS build_events (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    nitrado_service_id TEXT NOT NULL,
    player_id TEXT,
    player_name TEXT,
    event_type TEXT NOT NULL,
    build_part TEXT,
    target_object TEXT,
    tool TEXT,
    placed_object TEXT,
    placed_class TEXT,
    pos_x REAL,
    pos_y REAL,
    pos_z REAL,
    source_adm_file TEXT NOT NULL,
    source_line_number INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    raw_line TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_build_events_linked_server_id ON build_events(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_build_events_nitrado_service_id ON build_events(nitrado_service_id)",
  "CREATE INDEX IF NOT EXISTS idx_build_events_player_id ON build_events(player_id)",
  "CREATE INDEX IF NOT EXISTS idx_build_events_occurred_at ON build_events(occurred_at)",
  "CREATE INDEX IF NOT EXISTS idx_build_events_event_type ON build_events(event_type)",
  "CREATE INDEX IF NOT EXISTS idx_build_events_build_part ON build_events(build_part)",
  "CREATE INDEX IF NOT EXISTS idx_build_events_placed_class ON build_events(placed_class)",
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_build_events_service_file_line
   ON build_events(nitrado_service_id, source_adm_file, source_line_number)`,
  `CREATE TABLE IF NOT EXISTS server_build_stats (
    linked_server_id TEXT PRIMARY KEY,
    nitrado_service_id TEXT NOT NULL,
    structures_built INTEGER NOT NULL DEFAULT 0,
    build_items_placed INTEGER NOT NULL DEFAULT 0,
    storage_items_placed INTEGER NOT NULL DEFAULT 0,
    traps_placed INTEGER NOT NULL DEFAULT 0,
    build_score INTEGER NOT NULL DEFAULT 0,
    top_builder_name TEXT,
    top_builder_count INTEGER NOT NULL DEFAULT 0,
    last_build_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_server_build_stats_nitrado_service_id ON server_build_stats(nitrado_service_id)",
  "CREATE INDEX IF NOT EXISTS idx_server_build_stats_build_score ON server_build_stats(build_score)",
  "CREATE INDEX IF NOT EXISTS idx_server_build_stats_last_build_at ON server_build_stats(last_build_at)",
];
