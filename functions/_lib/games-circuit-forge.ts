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
};

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

function gameView(row: CircuitForgeRow, now: number): CircuitForgeGame {
  if (!Number.isInteger(row.rotations) || row.rotations < 0 || row.rotations > CIRCUIT_FORGE_MAX_ROTATIONS
    || !Number.isInteger(row.version) || row.version < 0 || row.version > CIRCUIT_FORGE_MAX_ROTATIONS) {
    throw new Error("Invalid stored Circuit Forge state");
  }
  const masks = circuitMasks(parseRotations(row.rotations_json));
  const powered = poweredCircuitTiles(masks);
  const status = row.status === "playing" && now >= row.started_at + CIRCUIT_FORGE_TTL_MS ? "expired" : row.status;
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
  };
}

async function readCircuitForge(db: D1Database, user: SessionUser, now: number, rewardGranted = false): Promise<CircuitForgePayload> {
  const game = await db.prepare("SELECT * FROM dzn_circuit_forge_sessions WHERE user_id = ?").bind(user.id).first<CircuitForgeRow>();
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_circuit_forge_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, dayKey(now)).first<{ rewarded: number }>();
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, rewardGranted, game: game ? gameView(game, now) : null };
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
    if (request.method === "GET") return reply(await readCircuitForge(db, user, now));

    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024);
    if (!parsed.ok) return reply({ error: "Invalid Circuit Forge request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return reply({ error: "Invalid Circuit Forge request." }, 400);
    }

    let rewardGranted = false;
    if (body.action === "start") {
      if (Object.keys(body).length !== 1) return reply({ error: "Invalid Circuit Forge request." }, 400);
      const result = await db.prepare(`INSERT INTO dzn_circuit_forge_sessions
        (user_id, id, rotations_json, rotations, status, version, started_at, updated_at)
        VALUES (?, ?, ?, 0, 'playing', 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, rotations_json = excluded.rotations_json, rotations = 0,
        status = 'playing', version = 0, started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_circuit_forge_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), JSON.stringify(createCircuit()), now, now, now - CIRCUIT_FORGE_START_COOLDOWN_MS).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before opening another Circuit Forge board." }, 429);
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
      const update = db.prepare(`UPDATE dzn_circuit_forge_sessions
        SET rotations_json = ?, rotations = ?, status = ?, version = version + 1, updated_at = ?
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
    return reply(await readCircuitForge(db, user, now, rewardGranted));
  } catch {
    return reply({ error: "DZN Circuit Forge is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
