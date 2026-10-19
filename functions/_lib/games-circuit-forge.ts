import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import {
  CIRCUIT_FORGE_GRID_SIZE,
  CIRCUIT_FORGE_MAX_ROTATIONS,
  CIRCUIT_FORGE_MIN_ROTATION_INTERVAL_MS,
  CIRCUIT_FORGE_REWARD,
  CIRCUIT_FORGE_START_COOLDOWN_MS,
  CIRCUIT_FORGE_TILE_COUNT,
  CIRCUIT_FORGE_TTL_MS,
  type CircuitForgeGame,
  type CircuitForgePayload,
} from "../../lib/games-circuit-forge";
import {
  CIRCUIT_FORGE_CANONICAL_MASKS,
  CIRCUIT_FORGE_CORE_INDEX,
  circuitMasks,
  isCompleteCircuit,
  poweredCircuitTiles,
} from "./games-circuit-forge-layout";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);

type CircuitForgeRow = {
  user_id: string;
  id: string;
  rotations_json: string;
  rotations: number;
  status: "playing" | "won" | "failed";
  version: number;
  started_at: number;
  updated_at: number;
  diagnostic_used?: number;
  phase_used?: number;
  diagnostic_index?: number | null;
};

const gridControlColumns = ["diagnostic_used", "phase_used", "diagnostic_index"] as const;

function randomIndex(length: number) {
  const limit = Math.floor(0x1_0000_0000 / length) * length;
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % length;
}

function parseRotations(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== CIRCUIT_FORGE_TILE_COUNT
    || parsed.some(rotation => !Number.isInteger(rotation) || rotation < 0 || rotation > 3)) {
    throw new Error("Invalid stored Circuit Forge state");
  }
  return [...parsed] as number[];
}

function createCircuit() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const rotations = CIRCUIT_FORGE_CANONICAL_MASKS.map((mask, index) => index === CIRCUIT_FORGE_CORE_INDEX || mask === 15 ? 0 : randomIndex(4));
    const masks = circuitMasks(rotations);
    const powered = poweredCircuitTiles(masks);
    if (!isCompleteCircuit(masks) && rotations.filter(Boolean).length >= 12 && powered.size < CIRCUIT_FORGE_TILE_COUNT) return rotations;
  }
  throw new Error("Unable to route a Circuit Forge board");
}

async function hasGridControlSchema(db: D1Database) {
  const result = await db.prepare("PRAGMA table_info(dzn_circuit_forge_sessions)").all<{ name: string }>();
  const names = new Set((result.results ?? []).map(row => row.name));
  return gridControlColumns.every(column => names.has(column));
}

function gameView(row: CircuitForgeRow, now: number, gridControlEnabled: boolean): CircuitForgeGame {
  if (!Number.isInteger(row.rotations) || row.rotations < 0 || row.rotations > CIRCUIT_FORGE_MAX_ROTATIONS
    || !Number.isInteger(row.version) || row.version < 0 || row.version > CIRCUIT_FORGE_MAX_ROTATIONS) {
    throw new Error("Invalid stored Circuit Forge state");
  }
  const masks = circuitMasks(parseRotations(row.rotations_json));
  const powered = poweredCircuitTiles(masks);
  const status = row.status === "playing" && now >= row.started_at + CIRCUIT_FORGE_TTL_MS ? "expired" : row.status;
  if (gridControlEnabled && (!Number.isInteger(row.diagnostic_used) || !Number.isInteger(row.phase_used)
    || (row.diagnostic_index !== null && row.diagnostic_index !== undefined
      && (!Number.isInteger(row.diagnostic_index) || row.diagnostic_index < 0 || row.diagnostic_index >= CIRCUIT_FORGE_TILE_COUNT || row.diagnostic_index === CIRCUIT_FORGE_CORE_INDEX)))) {
    throw new Error("Invalid stored Circuit Forge grid control");
  }
  const diagnosticUsed = gridControlEnabled && row.diagnostic_used === 1;
  const phaseUsed = gridControlEnabled && row.phase_used === 1;
  return {
    id: row.id,
    version: row.version,
    status,
    gridSize: CIRCUIT_FORGE_GRID_SIZE,
    tiles: masks.map((mask, index) => ({ mask, powered: powered.has(index), core: index === CIRCUIT_FORGE_CORE_INDEX })),
    poweredCount: powered.size,
    rotations: row.rotations,
    maxRotations: CIRCUIT_FORGE_MAX_ROTATIONS,
    startedAt: row.started_at,
    expiresAt: row.started_at + CIRCUIT_FORGE_TTL_MS,
    gridControlAvailable: gridControlEnabled,
    diagnosticAvailable: gridControlEnabled && status === "playing" && !diagnosticUsed,
    diagnosticUsed,
    diagnosticIndex: gridControlEnabled ? row.diagnostic_index ?? null : null,
    phaseAvailable: gridControlEnabled && status === "playing" && diagnosticUsed && row.diagnostic_index !== null && row.diagnostic_index !== undefined && !phaseUsed,
    phaseUsed,
  };
}

async function readCircuitForge(db: D1Database, user: SessionUser, now: number, gridControlEnabled: boolean, rewardGranted = false): Promise<CircuitForgePayload> {
  const game = await db.prepare("SELECT * FROM dzn_circuit_forge_sessions WHERE user_id = ?").bind(user.id).first<CircuitForgeRow>();
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_circuit_forge_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, dayKey(now)).first<{ rewarded: number }>();
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, rewardGranted, game: game ? gameView(game, now, gridControlEnabled) : null };
}

export async function handleGamesCircuitForge(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "This request must come from DZN Network." }, 403);
  }
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to route Circuit Forge." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true" || env.DZN_GAMES_CIRCUIT_FORGE_ENABLED !== "true") {
      return reply({ error: "DZN Circuit Forge is not open yet." }, 404);
    }
    const db = requireDb(env);
    const now = Date.now();
    const gridControlEnabled = env.DZN_GAMES_CIRCUIT_FORGE_GRID_CONTROL_ENABLED === "true";
    if (request.method === "GET") return reply(await readCircuitForge(db, user, now, gridControlEnabled));

    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024);
    if (!parsed.ok) return reply({ error: "Invalid Circuit Forge request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return reply({ error: "Invalid Circuit Forge request." }, 400);
    }

    let rewardGranted = false;
    if (body.action === "start") {
      if (Object.keys(body).length !== 1) return reply({ error: "Invalid Circuit Forge request." }, 400);
      // A new board always clears installed control state, even while its UI flag is temporarily off.
      const gridControlSchemaPresent = gridControlEnabled || await hasGridControlSchema(db);
      const controlColumns = gridControlSchemaPresent ? ", diagnostic_used, phase_used, diagnostic_index" : "";
      const controlValues = gridControlSchemaPresent ? ", 0, 0, NULL" : "";
      const controlReset = gridControlSchemaPresent ? ", diagnostic_used = 0, phase_used = 0, diagnostic_index = NULL" : "";
      const result = await db.prepare(`INSERT INTO dzn_circuit_forge_sessions
        (user_id, id, rotations_json, rotations, status, version, started_at, updated_at${controlColumns})
        VALUES (?, ?, ?, 0, 'playing', 0, ?, ?${controlValues})
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, rotations_json = excluded.rotations_json, rotations = 0,
        status = 'playing', version = 0, started_at = excluded.started_at, updated_at = excluded.updated_at${controlReset}
        WHERE dzn_circuit_forge_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), JSON.stringify(createCircuit()), now, now, now - CIRCUIT_FORGE_START_COOLDOWN_MS).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before opening another Circuit Forge board." }, 429);
    } else if (body.action === "diagnose") {
      const keys = Object.keys(body);
      if (!gridControlEnabled || keys.length !== 3 || keys.some(key => !["action", "gameId", "version"].includes(key))
        || !isId(body.gameId) || !Number.isInteger(body.version)) {
        return reply({ error: "The grid diagnostic is not available for this board." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_circuit_forge_sessions WHERE user_id = ?").bind(user.id).first<CircuitForgeRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This Circuit Forge board is not available." }, 404);
      if (row.status !== "playing" || row.version !== body.version || row.diagnostic_used !== 0
        || now >= row.started_at + CIRCUIT_FORGE_TTL_MS) {
        return reply({ error: "This diagnostic is no longer available. Refresh the board." }, 409);
      }
      const masks = circuitMasks(parseRotations(row.rotations_json));
      const candidates = masks
        .map((mask, index) => mask !== CIRCUIT_FORGE_CANONICAL_MASKS[index] && index !== CIRCUIT_FORGE_CORE_INDEX ? index : -1)
        .filter(index => index >= 0);
      if (!candidates.length) return reply({ error: "The grid no longer needs a diagnostic. Continue the rebuild." }, 409);
      const diagnosticIndex = candidates[(row.version + row.rotations) % candidates.length];
      const result = await db.prepare(`UPDATE dzn_circuit_forge_sessions
        SET diagnostic_used = 1, diagnostic_index = ?, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND diagnostic_used = 0 AND started_at > ?`)
        .bind(diagnosticIndex, now, user.id, row.id, row.version, now - CIRCUIT_FORGE_TTL_MS).run();
      if (!result.meta.changes) return reply({ error: "Another grid control reached this board first. Refresh to continue." }, 409);
    } else if (body.action === "phase") {
      const keys = Object.keys(body);
      const index = body.index;
      if (!gridControlEnabled || keys.length !== 4 || keys.some(key => !["action", "gameId", "version", "index"].includes(key))
        || !isId(body.gameId) || !Number.isInteger(body.version) || typeof index !== "number" || !Number.isInteger(index)
        || index < 0 || index >= CIRCUIT_FORGE_TILE_COUNT || index === CIRCUIT_FORGE_CORE_INDEX) {
        return reply({ error: "Choose a valid relay for the phase control." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_circuit_forge_sessions WHERE user_id = ?").bind(user.id).first<CircuitForgeRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This Circuit Forge board is not available." }, 404);
      if (row.status !== "playing" || row.version !== body.version || row.phase_used !== 0 || row.diagnostic_used !== 1 || row.diagnostic_index !== index
        || row.rotations >= CIRCUIT_FORGE_MAX_ROTATIONS || now >= row.started_at + CIRCUIT_FORGE_TTL_MS) {
        return reply({ error: "This phase control is no longer available. Refresh the board." }, 409);
      }
      if (now < row.updated_at + CIRCUIT_FORGE_MIN_ROTATION_INTERVAL_MS) return reply({ error: "Rotate one relay at a time." }, 429);
      const rotations = parseRotations(row.rotations_json);
      // The server owns the canonical layout, so the one-use lock can precisely realign only the diagnosed relay.
      rotations[index] = 0;
      const rotationCount = row.rotations + 1;
      const complete = isCompleteCircuit(circuitMasks(rotations));
      const status: CircuitForgeRow["status"] = complete ? "won" : rotationCount >= CIRCUIT_FORGE_MAX_ROTATIONS ? "failed" : "playing";
      const update = db.prepare(`UPDATE dzn_circuit_forge_sessions
        SET rotations_json = ?, rotations = ?, status = ?, phase_used = 1, diagnostic_index = NULL, version = version + 1, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND phase_used = 0 AND started_at > ? AND rotations < ?`)
        .bind(JSON.stringify(rotations), rotationCount, status, now, user.id, row.id, row.version, now - CIRCUIT_FORGE_TTL_MS, CIRCUIT_FORGE_MAX_ROTATIONS);
      const statements = [update];
      if (status === "won") {
        statements.push(db.prepare(`INSERT INTO dzn_circuit_forge_reward_ledger
          (id, user_id, reward_key, game_id, xp, parts, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
          ON CONFLICT(user_id, reward_key) DO NOTHING`)
          .bind(crypto.randomUUID(), user.id, dayKey(now), row.id, CIRCUIT_FORGE_REWARD.xp, CIRCUIT_FORGE_REWARD.parts, now));
      }
      const result = await db.batch(statements);
      if (!result[0].meta.changes) return reply({ error: "Another phase control reached this board first. Refresh to continue." }, 409);
      rewardGranted = status === "won" && Boolean(result[1]?.meta.changes);
    } else if (body.action === "rotate") {
      const keys = Object.keys(body);
      const index = body.index;
      if (keys.length !== 4 || keys.some(key => !["action", "gameId", "version", "index"].includes(key))
        || !isId(body.gameId) || !Number.isInteger(body.version) || typeof index !== "number" || !Number.isInteger(index)
        || index < 0 || index >= CIRCUIT_FORGE_TILE_COUNT || index === CIRCUIT_FORGE_CORE_INDEX) {
        return reply({ error: "Choose a valid relay tile to rotate." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_circuit_forge_sessions WHERE user_id = ?").bind(user.id).first<CircuitForgeRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This Circuit Forge board is not available." }, 404);
      if (row.status !== "playing" || row.version !== body.version || row.rotations >= CIRCUIT_FORGE_MAX_ROTATIONS || now >= row.started_at + CIRCUIT_FORGE_TTL_MS) {
        return reply({ error: "This Circuit Forge board changed or ended. Refresh to continue." }, 409);
      }
      if (now < row.updated_at + CIRCUIT_FORGE_MIN_ROTATION_INTERVAL_MS) return reply({ error: "Rotate one relay at a time." }, 429);
      const rotations = parseRotations(row.rotations_json);
      rotations[index] = (rotations[index] + 1) % 4;
      const rotationCount = row.rotations + 1;
      const complete = isCompleteCircuit(circuitMasks(rotations));
      const status: CircuitForgeRow["status"] = complete ? "won" : rotationCount >= CIRCUIT_FORGE_MAX_ROTATIONS ? "failed" : "playing";
      const gridControlSchemaPresent = gridControlEnabled || await hasGridControlSchema(db);
      // Keep a scan target through other turns, but retire it when its relay is manually aligned.
      const diagnosedRelayAligned = gridControlEnabled && row.diagnostic_used === 1 && row.phase_used === 0
        && row.diagnostic_index === index && rotations[index] === 0;
      const diagnosticReset = gridControlSchemaPresent && (!gridControlEnabled || diagnosedRelayAligned) ? ", diagnostic_index = NULL" : "";
      const phaseSpent = diagnosedRelayAligned ? ", phase_used = 1" : "";
      const update = db.prepare(`UPDATE dzn_circuit_forge_sessions
        SET rotations_json = ?, rotations = ?, status = ?${diagnosticReset}${phaseSpent}, version = version + 1, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND started_at > ? AND rotations < ?`)
        .bind(JSON.stringify(rotations), rotationCount, status, now, user.id, row.id, row.version, now - CIRCUIT_FORGE_TTL_MS, CIRCUIT_FORGE_MAX_ROTATIONS);
      const statements = [update];
      if (status === "won") {
        statements.push(db.prepare(`INSERT INTO dzn_circuit_forge_reward_ledger
          (id, user_id, reward_key, game_id, xp, parts, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
          ON CONFLICT(user_id, reward_key) DO NOTHING`)
          .bind(crypto.randomUUID(), user.id, dayKey(now), row.id, CIRCUIT_FORGE_REWARD.xp, CIRCUIT_FORGE_REWARD.parts, now));
      }
      const result = await db.batch(statements);
      if (!result[0].meta.changes) return reply({ error: "Another relay rotation reached this board first. Refresh to continue." }, 409);
      rewardGranted = status === "won" && Boolean(result[1]?.meta.changes);
    } else return reply({ error: "Unknown Circuit Forge action." }, 400);
    return reply(await readCircuitForge(db, user, now, gridControlEnabled, rewardGranted));
  } catch {
    return reply({ error: "DZN Circuit Forge is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
