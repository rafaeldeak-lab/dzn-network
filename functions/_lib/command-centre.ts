import {
  COMMAND_CENTRE_BUILDINGS,
  COMMAND_CENTRE_TIERS,
  getCommandCentreUpgrade,
  isCommandCentreBuilding,
  type CommandCentreBuilding,
  type CommandCentreBuildingView,
  type CommandCentrePayload,
} from "../../lib/command-centre";
import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const COMMAND_CENTRE_TABLES = [
  "dzn_command_centre_profiles",
  "dzn_command_centre_buildings",
  "dzn_command_centre_spend_ledger",
] as const;
const REWARD_LEDGERS = [
  "dzn_game_reward_ledger",
  "dzn_trivia_reward_ledger",
  "dzn_word_chain_reward_ledger",
  "dzn_hide_seek_reward_ledger",
  "dzn_relay_rush_reward_ledger",
  "dzn_cipher_grid_reward_ledger",
  "dzn_echo_array_reward_ledger",
  "dzn_outpost_run_reward_ledger",
  "dzn_signal_shift_reward_ledger",
  "dzn_circuit_forge_reward_ledger",
  "dzn_ranger_range_reward_ledger",
  "dzn_night_run_reward_ledger",
] as const;

type ProfileRow = { created_at: number; updated_at: number };
type BuildingRow = {
  building: CommandCentreBuilding;
  level: number;
  target_level: number | null;
  construction_started_at: number | null;
  completes_at: number | null;
  version: number;
};

type RewardTotals = { xp: number; partsEarned: number; partsSpent: number; partsAvailable: number };
type MutationResult = { meta?: { changes?: number } };

function changes(result: unknown) {
  return (result as MutationResult | null)?.meta?.changes ?? 0;
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

async function schemaHasCommandCentre(db: D1Database) {
  const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name IN (${COMMAND_CENTRE_TABLES.map(() => "?").join(", ")})`).bind(...COMMAND_CENTRE_TABLES).all<{ name: string }>();
  const names = new Set((rows.results ?? []).map(row => row.name));
  return COMMAND_CENTRE_TABLES.every(table => names.has(table));
}

async function availableRewardLedgers(db: D1Database) {
  const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name IN (${REWARD_LEDGERS.map(() => "?").join(", ")})`).bind(...REWARD_LEDGERS).all<{ name: string }>();
  const names = new Set((rows.results ?? []).map(row => row.name));
  return REWARD_LEDGERS.filter(table => names.has(table));
}

function rewardTotalsSql(ledgers: readonly string[]) {
  return ledgers.map(table => `SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts
    FROM ${table} WHERE user_id = ?`).join(" UNION ALL ");
}

function rewardPartsSql(ledgers: readonly string[]) {
  return ledgers.map(table => `(SELECT COALESCE(SUM(parts), 0) FROM ${table} WHERE user_id = ?)`).join(" + ");
}

function rewardXpSql(ledgers: readonly string[]) {
  return ledgers.map(table => `(SELECT COALESCE(SUM(xp), 0) FROM ${table} WHERE user_id = ?)`).join(" + ");
}

async function readResources(db: D1Database, userId: string, ledgers: readonly string[]): Promise<RewardTotals> {
  const spent = await db.prepare("SELECT COALESCE(SUM(parts_spent), 0) AS parts FROM dzn_command_centre_spend_ledger WHERE user_id = ?")
    .bind(userId).first<{ parts: number }>();
  if (!ledgers.length) return { xp: 0, partsEarned: 0, partsSpent: spent?.parts ?? 0, partsAvailable: -(spent?.parts ?? 0) };
  const totals = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts FROM (${rewardTotalsSql(ledgers)})`)
    .bind(...ledgers.map(() => userId)).first<{ xp: number; parts: number }>();
  const partsSpent = spent?.parts ?? 0;
  return {
    xp: totals?.xp ?? 0,
    partsEarned: totals?.parts ?? 0,
    partsSpent,
    partsAvailable: (totals?.parts ?? 0) - partsSpent,
  };
}

async function readPayload(db: D1Database, user: SessionUser, now: number, ledgers: readonly string[]): Promise<CommandCentrePayload> {
  const [profile, resources, buildings] = await Promise.all([
    db.prepare("SELECT created_at, updated_at FROM dzn_command_centre_profiles WHERE user_id = ?").bind(user.id).first<ProfileRow>(),
    readResources(db, user.id, ledgers),
    db.prepare(`SELECT building, level, target_level, construction_started_at, completes_at, version
      FROM dzn_command_centre_buildings WHERE user_id = ? ORDER BY CASE building
        WHEN 'headquarters' THEN 0 WHEN 'workshop' THEN 1 WHEN 'watchtower' THEN 2 ELSE 3 END`).bind(user.id).all<BuildingRow>(),
  ]);
  const buildingRows = buildings.results ?? [];
  if (profile && buildingRows.length !== COMMAND_CENTRE_BUILDINGS.length) throw new Error("incomplete-command-centre-state");
  const headquarters = buildingRows.find(row => row.building === "headquarters");
  const views: CommandCentreBuildingView[] = buildingRows.map(row => ({
    building: row.building,
    level: row.level,
    targetLevel: row.target_level ?? null,
    constructionStartedAt: row.construction_started_at ?? null,
    completesAt: row.completes_at ?? null,
    version: row.version,
    nextUpgrade: getCommandCentreUpgrade(row.level),
    blockedByHeadquarters: row.building !== "headquarters" && Boolean(headquarters && headquarters.level < row.level + 1),
  }));
  return {
    serverTime: now,
    profile: profile ? {
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
      tier: COMMAND_CENTRE_TIERS[Math.max(0, Math.min(4, (headquarters?.level ?? 1) - 1))],
    } : null,
    resources,
    buildings: views,
  };
}

async function establish(db: D1Database, userId: string, now: number) {
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO dzn_command_centre_profiles (user_id, created_at, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO NOTHING`).bind(userId, now, now),
    ...COMMAND_CENTRE_BUILDINGS.map(building => db.prepare(`INSERT INTO dzn_command_centre_buildings
      (user_id, building, level, version) VALUES (?, ?, 1, 0) ON CONFLICT(user_id, building) DO NOTHING`).bind(userId, building)),
  ];
  await db.batch(statements);
}

async function startUpgrade(
  db: D1Database,
  user: SessionUser,
  body: Record<string, unknown>,
  now: number,
  ledgers: readonly string[],
) {
  if (!isCommandCentreBuilding(body.building) || !Number.isInteger(body.version) || !isRequestId(body.requestId)) {
    return { error: "Choose a valid building and retry from the current Command Centre state.", status: 400 } as const;
  }
  const building = body.building;
  const version = body.version as number;
  const existingRequest = await db.prepare("SELECT id FROM dzn_command_centre_spend_ledger WHERE user_id = ? AND request_id = ?")
    .bind(user.id, body.requestId).first();
  if (existingRequest) return { error: null, status: 200 } as const;
  const [profile, selected, headquarters] = await Promise.all([
    db.prepare("SELECT user_id FROM dzn_command_centre_profiles WHERE user_id = ?").bind(user.id).first(),
    db.prepare(`SELECT building, level, target_level, construction_started_at, completes_at, version
      FROM dzn_command_centre_buildings WHERE user_id = ? AND building = ?`).bind(user.id, building).first<BuildingRow>(),
    db.prepare("SELECT level FROM dzn_command_centre_buildings WHERE user_id = ? AND building = 'headquarters'").bind(user.id).first<{ level: number }>(),
  ]);
  if (!profile || !selected || !headquarters) return { error: "Establish your Command Centre before starting construction.", status: 409 } as const;
  const next = getCommandCentreUpgrade(selected.level);
  if (!next || selected.target_level != null) return { error: "This building is already at capacity or under construction.", status: 409 } as const;
  if (selected.version !== version) return { error: "This building changed. Refresh the Command Centre before retrying.", status: 409 } as const;
  if (building !== "headquarters" && headquarters.level < selected.level + 1) {
    return { error: "Upgrade Headquarters before expanding this building further.", status: 409 } as const;
  }
  const resources = await readResources(db, user.id, ledgers);
  if (resources.xp < next.requiredXp || resources.partsAvailable < next.parts) {
    return { error: "More verified Games Hub XP or parts are required for this construction order.", status: 409 } as const;
  }
  const partsSql = rewardPartsSql(ledgers);
  const xpSql = rewardXpSql(ledgers);
  if (!partsSql || !xpSql) return { error: "Verified Games Hub rewards are unavailable for construction right now.", status: 503 } as const;
  const target = selected.level + 1;
  const completesAt = now + next.durationMs;
  const spendId = crypto.randomUUID();
  const spend = db.prepare(`INSERT OR IGNORE INTO dzn_command_centre_spend_ledger
    (id, user_id, request_id, building, from_level, to_level, parts_spent, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM dzn_command_centre_profiles WHERE user_id = ?)
      AND EXISTS (SELECT 1 FROM dzn_command_centre_buildings
        WHERE user_id = ? AND building = ? AND level = ? AND version = ? AND target_level IS NULL)
      AND (${partsSql}) - (SELECT COALESCE(SUM(parts_spent), 0) FROM dzn_command_centre_spend_ledger WHERE user_id = ?) >= ?
      AND (${xpSql}) >= ?`);
  const spendBindings = [
    spendId, user.id, body.requestId, building, selected.level, target, next.parts, now,
    user.id, user.id, building, selected.level, version,
    ...ledgers.map(() => user.id), user.id, next.parts,
    ...ledgers.map(() => user.id), next.requiredXp,
  ];
  const update = db.prepare(`UPDATE dzn_command_centre_buildings
    SET target_level = ?, construction_started_at = ?, completes_at = ?, version = version + 1
    WHERE user_id = ? AND building = ? AND level = ? AND version = ? AND target_level IS NULL
      AND EXISTS (SELECT 1 FROM dzn_command_centre_spend_ledger WHERE id = ? AND user_id = ?)`)
    .bind(target, now, completesAt, user.id, building, selected.level, version, spendId, user.id);
  const results = await db.batch([spend.bind(...spendBindings), update]);
  if (!changes(results[1])) {
    const idempotent = await db.prepare("SELECT id FROM dzn_command_centre_spend_ledger WHERE user_id = ? AND request_id = ?")
      .bind(user.id, body.requestId).first();
    if (!idempotent) return { error: "Construction could not be reserved. Refresh before retrying.", status: 409 } as const;
  }
  return { error: null, status: 200 } as const;
}

async function completeUpgrade(db: D1Database, user: SessionUser, body: Record<string, unknown>, now: number) {
  if (!isCommandCentreBuilding(body.building) || !Number.isInteger(body.version)) {
    return { error: "Choose a valid completed construction order.", status: 400 } as const;
  }
  const result = await db.prepare(`UPDATE dzn_command_centre_buildings
    SET level = target_level, target_level = NULL, construction_started_at = NULL, completes_at = NULL, version = version + 1
    WHERE user_id = ? AND building = ? AND version = ? AND target_level IS NOT NULL AND completes_at <= ?`)
    .bind(user.id, body.building, body.version, now).run();
  if (!changes(result)) return { error: "Construction is not ready or the Command Centre changed. Refresh before retrying.", status: 409 } as const;
  await db.prepare("UPDATE dzn_command_centre_profiles SET updated_at = ? WHERE user_id = ?").bind(now, user.id).run();
  return { error: null, status: 200 } as const;
}

export async function handleCommandCentre(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "This request must come from DZN Network." }, 403);
  }
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to access your Command Centre." }, 401);
    if (env.DZN_COMMAND_CENTRE_ENABLED !== "true") return reply({ error: "The Command Centre is not open on this environment yet." }, 503);
    const db = requireDb(env);
    if (!(await schemaHasCommandCentre(db))) return reply({ error: "The Command Centre is preparing its secure progression storage. Try again shortly." }, 503);
    const now = Date.now();
    const ledgers = await availableRewardLedgers(db);
    if (request.method === "GET") return reply(await readPayload(db, user, now, ledgers));
    const parsed = await readBoundedJson<Record<string, unknown>>(request, 2048);
    if (!parsed.ok) return reply({ error: "Invalid Command Centre request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid Command Centre request." }, 400);
    if (body.action === "initialize") await establish(db, user.id, now);
    else if (body.action === "start-upgrade") {
      const result = await startUpgrade(db, user, body, now, ledgers);
      if (result.error) return reply({ error: result.error }, result.status);
    } else if (body.action === "complete-upgrade") {
      const result = await completeUpgrade(db, user, body, now);
      if (result.error) return reply({ error: result.error }, result.status);
    } else return reply({ error: "Unknown Command Centre action." }, 400);
    return reply(await readPayload(db, user, now, ledgers));
  } catch {
    // Do not disclose database layout, player balances or construction details.
    return reply({ error: "The Command Centre is temporarily unavailable. Your stored progression has not been reset." }, 503);
  }
}
