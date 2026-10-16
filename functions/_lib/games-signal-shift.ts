import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import {
  SIGNAL_SHIFT_GRID_SIZE,
  SIGNAL_SHIFT_MAX_MOVES,
  SIGNAL_SHIFT_MIN_MOVE_INTERVAL_MS,
  SIGNAL_SHIFT_REWARD,
  SIGNAL_SHIFT_START_COOLDOWN_MS,
  SIGNAL_SHIFT_TILE_COUNT,
  SIGNAL_SHIFT_TTL_MS,
  signalShiftIntensity,
  type SignalShiftGame,
  type SignalShiftPayload,
} from "../../lib/games-signal-shift";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);

type SignalShiftRow = {
  user_id: string;
  id: string;
  tiles_json: string;
  moves: number;
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

function solvedTiles() {
  return Array.from({ length: SIGNAL_SHIFT_TILE_COUNT }, (_, index) => (index + 1) % SIGNAL_SHIFT_TILE_COUNT);
}

function neighbors(index: number) {
  const row = Math.floor(index / SIGNAL_SHIFT_GRID_SIZE);
  const column = index % SIGNAL_SHIFT_GRID_SIZE;
  return [
    row > 0 ? index - SIGNAL_SHIFT_GRID_SIZE : null,
    column < SIGNAL_SHIFT_GRID_SIZE - 1 ? index + 1 : null,
    row < SIGNAL_SHIFT_GRID_SIZE - 1 ? index + SIGNAL_SHIFT_GRID_SIZE : null,
    column > 0 ? index - 1 : null,
  ].filter((value): value is number => value !== null);
}

function isSolved(tiles: readonly number[]) {
  return tiles.length === SIGNAL_SHIFT_TILE_COUNT && tiles.every((tile, index) => tile === (index + 1) % SIGNAL_SHIFT_TILE_COUNT);
}

function parseTiles(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== SIGNAL_SHIFT_TILE_COUNT
    || parsed.some(tile => !Number.isInteger(tile) || tile < 0 || tile >= SIGNAL_SHIFT_TILE_COUNT)
    || new Set(parsed).size !== SIGNAL_SHIFT_TILE_COUNT) {
    throw new Error("Invalid stored Signal Shift board");
  }
  return [...parsed] as number[];
}

// Shuffle only by legal blank moves, so every generated grid is solvable without exposing a solution.
function createPuzzle() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const tiles = solvedTiles();
    let blank = SIGNAL_SHIFT_TILE_COUNT - 1;
    let previousBlank = -1;
    // Keep a known legal reverse route inside the 64-move cap while ensuring every board starts deep enough to feel like a real routing task.
    const shuffles = 60 + randomIndex(5);
    for (let step = 0; step < shuffles; step++) {
      const options = neighbors(blank).filter(index => index !== previousBlank);
      const nextBlank = options[randomIndex(options.length)];
      [tiles[blank], tiles[nextBlank]] = [tiles[nextBlank], tiles[blank]];
      previousBlank = blank;
      blank = nextBlank;
    }
    if (!isSolved(tiles) && tiles.reduce((count, tile, index) => count + Number(tile !== (index + 1) % SIGNAL_SHIFT_TILE_COUNT), 0) >= 8) return tiles;
  }
  throw new Error("Unable to create a Signal Shift board");
}

function gameView(row: SignalShiftRow, now: number): SignalShiftGame {
  const tiles = parseTiles(row.tiles_json);
  if (!Number.isInteger(row.moves) || row.moves < 0 || row.moves > SIGNAL_SHIFT_MAX_MOVES || !Number.isInteger(row.version) || row.version < 0 || row.version > 96) {
    throw new Error("Invalid stored Signal Shift state");
  }
  const status = row.status === "playing" && now >= row.started_at + SIGNAL_SHIFT_TTL_MS ? "expired" : row.status;
  return {
    id: row.id,
    version: row.version,
    status,
    gridSize: SIGNAL_SHIFT_GRID_SIZE,
    tiles,
    moves: row.moves,
    maxMoves: SIGNAL_SHIFT_MAX_MOVES,
    intensity: signalShiftIntensity(row.moves),
    startedAt: row.started_at,
    expiresAt: row.started_at + SIGNAL_SHIFT_TTL_MS,
  };
}

async function readSignalShift(db: D1Database, user: SessionUser, now: number, rewardGranted = false): Promise<SignalShiftPayload> {
  const game = await db.prepare("SELECT * FROM dzn_signal_shift_sessions WHERE user_id = ?").bind(user.id).first<SignalShiftRow>();
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_signal_shift_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, dayKey(now)).first<{ rewarded: number }>();
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, rewardGranted, game: game ? gameView(game, now) : null };
}

export async function handleGamesSignalShift(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "This request must come from DZN Network." }, 403);
  }
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to route DZN Signal Shift." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true" || env.DZN_GAMES_SIGNAL_SHIFT_ENABLED !== "true") {
      return reply({ error: "DZN Signal Shift is not open yet." }, 404);
    }
    const db = requireDb(env);
    const now = Date.now();
    if (request.method === "GET") return reply(await readSignalShift(db, user, now));

    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024);
    if (!parsed.ok) return reply({ error: "Invalid Signal Shift request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return reply({ error: "Invalid Signal Shift request." }, 400);
    }

    let rewardGranted = false;
    if (body.action === "start") {
      if (Object.keys(body).length !== 1) return reply({ error: "Invalid Signal Shift request." }, 400);
      const result = await db.prepare(`INSERT INTO dzn_signal_shift_sessions
        (user_id, id, tiles_json, moves, status, version, started_at, updated_at)
        VALUES (?, ?, ?, 0, 'playing', 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, tiles_json = excluded.tiles_json, moves = 0,
        status = 'playing', version = 0, started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_signal_shift_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), JSON.stringify(createPuzzle()), now, now, now - SIGNAL_SHIFT_START_COOLDOWN_MS).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before routing another Signal Shift board." }, 429);
    } else if (body.action === "move") {
      const keys = Object.keys(body);
      const tile = body.tile;
      if (keys.length !== 4 || keys.some(key => !["action", "gameId", "version", "tile"].includes(key))
        || !isId(body.gameId) || !Number.isInteger(body.version) || typeof tile !== "number" || !Number.isInteger(tile)
        || tile < 1 || tile >= SIGNAL_SHIFT_TILE_COUNT) {
        return reply({ error: "Choose a neighbouring Signal Shift sector." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_signal_shift_sessions WHERE user_id = ?").bind(user.id).first<SignalShiftRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This Signal Shift route is not available." }, 404);
      if (row.status !== "playing" || row.version !== body.version || row.moves >= SIGNAL_SHIFT_MAX_MOVES || now >= row.started_at + SIGNAL_SHIFT_TTL_MS) {
        return reply({ error: "This Signal Shift route changed or ended. Refresh to continue." }, 409);
      }
      if (now < row.updated_at + SIGNAL_SHIFT_MIN_MOVE_INTERVAL_MS) return reply({ error: "Route one sector at a time." }, 429);
      const tiles = parseTiles(row.tiles_json);
      const blank = tiles.indexOf(0);
      const tileIndex = tiles.indexOf(tile);
      if (blank < 0 || tileIndex < 0 || !neighbors(blank).includes(tileIndex)) {
        return reply({ error: "Only a sector beside the open relay slot can shift." }, 400);
      }
      [tiles[blank], tiles[tileIndex]] = [tiles[tileIndex], tiles[blank]];
      const moves = row.moves + 1;
      const status: SignalShiftRow["status"] = isSolved(tiles) ? "won" : moves >= SIGNAL_SHIFT_MAX_MOVES ? "failed" : "playing";
      const update = db.prepare(`UPDATE dzn_signal_shift_sessions
        SET tiles_json = ?, moves = ?, status = ?, version = version + 1, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND started_at > ? AND moves < ?`)
        .bind(JSON.stringify(tiles), moves, status, now, user.id, row.id, row.version, now - SIGNAL_SHIFT_TTL_MS, SIGNAL_SHIFT_MAX_MOVES);
      const statements = [update];
      if (status === "won") {
        statements.push(db.prepare(`INSERT INTO dzn_signal_shift_reward_ledger
          (id, user_id, reward_key, game_id, xp, parts, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
          ON CONFLICT(user_id, reward_key) DO NOTHING`)
          .bind(crypto.randomUUID(), user.id, dayKey(now), row.id, SIGNAL_SHIFT_REWARD.xp, SIGNAL_SHIFT_REWARD.parts, now));
      }
      const result = await db.batch(statements);
      if (!result[0].meta.changes) return reply({ error: "Another route command reached this board first. Refresh to continue." }, 409);
      rewardGranted = status === "won" && Boolean(result[1]?.meta.changes);
    } else return reply({ error: "Unknown Signal Shift action." }, 400);
    return reply(await readSignalShift(db, user, now, rewardGranted));
  } catch {
    return reply({ error: "DZN Signal Shift is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
