import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import {
  OUTPOST_RUN_DIRECTIONS,
  OUTPOST_RUN_GRID_SIZE,
  OUTPOST_RUN_MAX_ENERGY,
  OUTPOST_RUN_MAX_MOVES,
  OUTPOST_RUN_MIN_MOVE_INTERVAL_MS,
  OUTPOST_RUN_REWARD,
  OUTPOST_RUN_START_COOLDOWN_MS,
  OUTPOST_RUN_TTL_MS,
  outpostRunIntensity,
  type OutpostRunCell,
  type OutpostRunDirection,
  type OutpostRunGame,
  type OutpostRunPayload,
  type OutpostRunSupport,
} from "../../lib/games-outpost-run";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
const isDirection = (value: unknown): value is OutpostRunDirection => typeof value === "string" && (OUTPOST_RUN_DIRECTIONS as readonly string[]).includes(value);
const isSupport = (value: unknown): value is OutpostRunSupport => value === "recon" || value === "shield";

type Coordinate = { row: number; column: number };
type OutpostSupportState = {
  reconUsed: boolean;
  shieldUsed: boolean;
  shieldArmed: boolean;
  reconCells: Coordinate[];
};
type OutpostLayout = {
  target: Coordinate;
  hazards: Coordinate[];
  beacon?: Coordinate;
  beaconSecured?: boolean;
  scanHint?: string;
  support?: OutpostSupportState;
};
const start = { row: 2, column: 2 };
const LEGACY_OUTPOST_RUN_MAX_ENERGY = 4;
const LEGACY_OUTPOST_RUN_MAX_MOVES = 12;
const GENERATED_HAZARD_COUNT = 5;
type OutpostRunRow = {
  user_id: string;
  id: string;
  layout_json: string;
  visited_json: string;
  position_row: number;
  position_column: number;
  energy: number;
  moves: number;
  scanned: number;
  status: "playing" | "won" | "failed";
  version: number;
  started_at: number;
  updated_at: number;
};

const scanHints = new Set(["north", "south", "east", "west", "north-east", "north-west", "south-east", "south-west", "relay acquired"]);
const spentLegacySupport: OutpostSupportState = { reconUsed: true, shieldUsed: true, shieldArmed: false, reconCells: [] };

function sameCoordinate(left: Coordinate, right: Coordinate) {
  return left.row === right.row && left.column === right.column;
}

function isCoordinate(value: unknown): value is Coordinate {
  return Boolean(value) && typeof value === "object" && Number.isInteger((value as Coordinate).row) && Number.isInteger((value as Coordinate).column)
    && (value as Coordinate).row >= 0 && (value as Coordinate).row < OUTPOST_RUN_GRID_SIZE
    && (value as Coordinate).column >= 0 && (value as Coordinate).column < OUTPOST_RUN_GRID_SIZE;
}

function isScanHint(value: unknown): value is string {
  return typeof value === "string" && scanHints.has(value);
}

function isSupportState(value: unknown): value is OutpostSupportState {
  if (!value || typeof value !== "object") return false;
  const support = value as OutpostSupportState;
  return typeof support.reconUsed === "boolean" && typeof support.shieldUsed === "boolean" && typeof support.shieldArmed === "boolean"
    && Array.isArray(support.reconCells) && support.reconCells.length <= 4 && support.reconCells.every(isCoordinate)
    && new Set(support.reconCells.map(cell => `${cell.row}:${cell.column}`)).size === support.reconCells.length
    && (!support.shieldArmed || support.shieldUsed);
}

function supportForLayout(layout: OutpostLayout): OutpostSupportState {
  return layout.support ?? spentLegacySupport;
}

function parseLayout(value: string): OutpostLayout {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || !isCoordinate((parsed as OutpostLayout).target) || !Array.isArray((parsed as OutpostLayout).hazards)
    || (parsed as OutpostLayout).hazards.length < 3 || (parsed as OutpostLayout).hazards.length > GENERATED_HAZARD_COUNT || (parsed as OutpostLayout).hazards.some(hazard => !isCoordinate(hazard))
    || ((parsed as OutpostLayout).beacon !== undefined && !isCoordinate((parsed as OutpostLayout).beacon))
    || ((parsed as OutpostLayout).beaconSecured !== undefined && typeof (parsed as OutpostLayout).beaconSecured !== "boolean")
    || ((parsed as OutpostLayout).scanHint !== undefined && !isScanHint((parsed as OutpostLayout).scanHint))
    || ((parsed as OutpostLayout).support !== undefined && !isSupportState((parsed as OutpostLayout).support))) {
    throw new Error("Invalid stored Outpost Run layout");
  }
  const layout = parsed as OutpostLayout;
  const beacon = layout.beacon;
  const uniqueHazards = new Set(layout.hazards.map(hazard => `${hazard.row}:${hazard.column}`));
  const invalidBeacon = Boolean(beacon && (
    sameCoordinate(beacon, start)
    || sameCoordinate(beacon, layout.target)
    || layout.hazards.some(hazard => sameCoordinate(hazard, beacon))
  ));
  if (uniqueHazards.size !== layout.hazards.length || sameCoordinate(layout.target, start)
    || layout.hazards.some(hazard => sameCoordinate(hazard, start) || sameCoordinate(hazard, layout.target))
    || invalidBeacon || (layout.beaconSecured && !beacon)
    || supportForLayout(layout).reconCells.some(cell => sameCoordinate(cell, start))) {
    throw new Error("Invalid stored Outpost Run layout");
  }
  return layout;
}

function maxMovesForLayout(layout: OutpostLayout) { return layout.hazards.length === 3 ? LEGACY_OUTPOST_RUN_MAX_MOVES : OUTPOST_RUN_MAX_MOVES; }
function maxEnergyForLayout(layout: OutpostLayout) { return layout.hazards.length === 3 ? LEGACY_OUTPOST_RUN_MAX_ENERGY : OUTPOST_RUN_MAX_ENERGY; }

function parseVisited(value: string, maxMoves: number): Coordinate[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > maxMoves + 1 || parsed.some(cell => !isCoordinate(cell))) {
    throw new Error("Invalid stored Outpost Run visibility");
  }
  const visited = parsed as Coordinate[];
  if (!sameCoordinate(visited[0], start)) throw new Error("Invalid stored Outpost Run visibility");
  return visited;
}

function randomIndex(length: number) {
  const bytes = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / length) * length;
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % length;
}

function shuffled<T>(values: readonly T[]) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const next = randomIndex(index + 1);
    [copy[index], copy[next]] = [copy[next], copy[index]];
  }
  return copy;
}

const coordinates = Array.from({ length: OUTPOST_RUN_GRID_SIZE * OUTPOST_RUN_GRID_SIZE }, (_, index) => ({
  row: Math.floor(index / OUTPOST_RUN_GRID_SIZE), column: index % OUTPOST_RUN_GRID_SIZE,
}));
const extractionTargets = coordinates.filter(cell => Math.abs(cell.row - start.row) + Math.abs(cell.column - start.column) >= 4);

function manhattanDistance(left: Coordinate, right: Coordinate) {
  return Math.abs(left.row - right.row) + Math.abs(left.column - right.column);
}

function protectedRoute(from: Coordinate, target: Coordinate) {
  const vertical = Array.from({ length: Math.abs(target.row - from.row) }, () => target.row < from.row ? "north" : "south");
  const horizontal = Array.from({ length: Math.abs(target.column - from.column) }, () => target.column < from.column ? "west" : "east");
  const route = [from];
  let position = from;
  for (const direction of shuffled([...vertical, ...horizontal])) {
    position = moveCoordinate(position, direction);
    route.push(position);
  }
  return route;
}

function hasSafeRoute(from: Coordinate, target: Coordinate, hazards: Coordinate[]) {
  const queue = [from];
  const visited = new Set([`${from.row}:${from.column}`]);
  while (queue.length) {
    const position = queue.shift()!;
    if (sameCoordinate(position, target)) return true;
    for (const direction of OUTPOST_RUN_DIRECTIONS) {
      const next = moveCoordinate(position, direction);
      const key = `${next.row}:${next.column}`;
      if (!isCoordinate(next) || visited.has(key) || hazards.some(hazard => sameCoordinate(hazard, next))) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return false;
}

function chooseLayout(): OutpostLayout {
  for (let attempt = 0; attempt < 48; attempt++) {
    const target = extractionTargets[randomIndex(extractionTargets.length)];
    const beaconCandidates = coordinates.filter(cell => !sameCoordinate(cell, start) && !sameCoordinate(cell, target)
      && manhattanDistance(start, cell) >= 2
      && manhattanDistance(start, cell) + manhattanDistance(cell, target) >= 6
      && manhattanDistance(start, cell) + manhattanDistance(cell, target) <= OUTPOST_RUN_MAX_MOVES - 2);
    const beacon = beaconCandidates[randomIndex(beaconCandidates.length)];
    const route = [...protectedRoute(start, beacon), ...protectedRoute(beacon, target).slice(1)];
    const protectedCells = new Set(route.map(cell => `${cell.row}:${cell.column}`));
    const hazards = shuffled(coordinates.filter(cell => !protectedCells.has(`${cell.row}:${cell.column}`))).slice(0, GENERATED_HAZARD_COUNT);
    if (hasSafeRoute(start, beacon, hazards) && hasSafeRoute(beacon, target, hazards)) {
      return { target, hazards, beacon, beaconSecured: false, support: { reconUsed: false, shieldUsed: false, shieldArmed: false, reconCells: [] } };
    }
  }
  throw new Error("Unable to build a safe Outpost Run route");
}

function moveCoordinate(position: Coordinate, direction: OutpostRunDirection): Coordinate {
  if (direction === "north") return { row: position.row - 1, column: position.column };
  if (direction === "east") return { row: position.row, column: position.column + 1 };
  if (direction === "south") return { row: position.row + 1, column: position.column };
  return { row: position.row, column: position.column - 1 };
}

function scanHint(position: Coordinate, target: Coordinate) {
  const vertical = target.row < position.row ? "north" : target.row > position.row ? "south" : "";
  const horizontal = target.column < position.column ? "west" : target.column > position.column ? "east" : "";
  return [vertical, horizontal].filter(Boolean).join("-") || "relay acquired";
}

function reconnaissanceCells(position: Coordinate, visited: Coordinate[]) {
  const alreadyKnown = new Set(visited.map(cell => `${cell.row}:${cell.column}`));
  return OUTPOST_RUN_DIRECTIONS.map(direction => moveCoordinate(position, direction))
    .filter(isCoordinate)
    .filter(cell => !alreadyKnown.has(`${cell.row}:${cell.column}`));
}

function visibleCells(layout: OutpostLayout, visited: Coordinate[]): OutpostRunCell[] {
  const seen = new Set<string>();
  return [...visited, ...supportForLayout(layout).reconCells].filter(cell => {
    const key = `${cell.row}:${cell.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(cell => ({ ...cell, kind: sameCoordinate(cell, { row: 2, column: 2 }) ? "start"
    : sameCoordinate(cell, layout.target) ? "relay"
      : layout.beacon && sameCoordinate(cell, layout.beacon) ? "beacon"
      : layout.hazards.some(hazard => sameCoordinate(cell, hazard)) ? "hazard" : "clear" }));
}

function gameView(row: OutpostRunRow, now: number): OutpostRunGame {
  const layout = parseLayout(row.layout_json);
  const maxMoves = maxMovesForLayout(layout);
  const maxEnergy = maxEnergyForLayout(layout);
  const visited = parseVisited(row.visited_json, maxMoves);
  if (!Number.isInteger(row.position_row) || !Number.isInteger(row.position_column) || row.position_row < 0 || row.position_row >= OUTPOST_RUN_GRID_SIZE
    || row.position_column < 0 || row.position_column >= OUTPOST_RUN_GRID_SIZE || !Number.isInteger(row.energy) || row.energy < 0 || row.energy > maxEnergy
    || !Number.isInteger(row.moves) || row.moves < 0 || row.moves > maxMoves || !Number.isInteger(row.scanned) || ![0, 1].includes(row.scanned)) {
    throw new Error("Invalid stored Outpost Run state");
  }
  const status = row.status === "playing" && now >= row.started_at + OUTPOST_RUN_TTL_MS ? "expired" : row.status;
  const position = { row: row.position_row, column: row.position_column };
  const support = supportForLayout(layout);
  return {
    id: row.id,
    version: row.version,
    status,
    gridSize: OUTPOST_RUN_GRID_SIZE,
    row: position.row,
    column: position.column,
    energy: row.energy,
    maxEnergy,
    moves: row.moves,
    maxMoves,
    intensity: outpostRunIntensity(row.moves),
    objective: layout.beacon && !layout.beaconSecured ? "beacon" : "relay",
    beaconSecured: Boolean(layout.beaconSecured),
    scanHint: row.scanned ? layout.scanHint ?? null : null,
    scanAvailable: status === "playing" && row.scanned === 0,
    reconAvailable: status === "playing" && !support.reconUsed,
    shieldAvailable: status === "playing" && !support.shieldUsed,
    shieldArmed: status === "playing" && support.shieldArmed,
    reconCells: support.reconCells.length,
    visibleCells: visibleCells(layout, visited),
    startedAt: row.started_at,
    expiresAt: row.started_at + OUTPOST_RUN_TTL_MS,
  };
}

async function readOutpostRun(db: D1Database, user: SessionUser, now: number, rewardGranted = false): Promise<OutpostRunPayload> {
  const game = await db.prepare("SELECT * FROM dzn_outpost_run_sessions WHERE user_id = ?").bind(user.id).first<OutpostRunRow>();
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_outpost_run_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, dayKey(now)).first<{ rewarded: number }>();
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, rewardGranted, game: game ? gameView(game, now) : null };
}

export async function handleGamesOutpostRun(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "This request must come from DZN Network." }, 403);
  }
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to enter DZN Outpost Run." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true" || env.DZN_GAMES_OUTPOST_RUN_ENABLED !== "true") {
      return reply({ error: "DZN Outpost Run is not open yet." }, 404);
    }
    const db = requireDb(env);
    const now = Date.now();
    if (request.method === "GET") return reply(await readOutpostRun(db, user, now));

    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024);
    if (!parsed.ok) return reply({ error: "Invalid Outpost Run request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return reply({ error: "Invalid Outpost Run request." }, 400);
    }

    let rewardGranted = false;
    if (body.action === "start") {
      if (Object.keys(body).length !== 1) return reply({ error: "Invalid Outpost Run request." }, 400);
      const layout = chooseLayout();
      const result = await db.prepare(`INSERT INTO dzn_outpost_run_sessions
        (user_id, id, layout_json, visited_json, position_row, position_column, energy, moves, scanned, status, version, started_at, updated_at)
        VALUES (?, ?, ?, ?, 2, 2, ?, 0, 0, 'playing', 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, layout_json = excluded.layout_json, visited_json = excluded.visited_json,
        position_row = 2, position_column = 2, energy = excluded.energy, moves = 0, scanned = 0, status = 'playing', version = 0,
        started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_outpost_run_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), JSON.stringify(layout), JSON.stringify([start]), OUTPOST_RUN_MAX_ENERGY, now, now, now - OUTPOST_RUN_START_COOLDOWN_MS).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before starting another outpost run." }, 429);
    } else if (body.action === "scan" || body.action === "move" || body.action === "support") {
      const expectedKeys = body.action === "move" ? ["action", "gameId", "version", "direction"]
        : body.action === "support" ? ["action", "gameId", "version", "support"] : ["action", "gameId", "version"];
      const keys = Object.keys(body);
      if (keys.length !== expectedKeys.length || keys.some(key => !expectedKeys.includes(key)) || !isId(body.gameId) || !Number.isInteger(body.version)
        || (body.action === "move" && !isDirection(body.direction)) || (body.action === "support" && !isSupport(body.support))) return reply({ error: "Choose a valid Outpost Run command." }, 400);
      const row = await db.prepare("SELECT * FROM dzn_outpost_run_sessions WHERE user_id = ?").bind(user.id).first<OutpostRunRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This outpost run is not available." }, 404);
      if (row.status !== "playing" || row.version !== body.version || now >= row.started_at + OUTPOST_RUN_TTL_MS) {
        return reply({ error: "This outpost run changed or ended. Refresh to continue." }, 409);
      }
      if (now < row.updated_at + OUTPOST_RUN_MIN_MOVE_INTERVAL_MS) return reply({ error: "Take a moment before the next field command." }, 429);
      const layout = parseLayout(row.layout_json);
      const maxMoves = maxMovesForLayout(layout);
      if (row.moves >= maxMoves) return reply({ error: "This outpost run changed or ended. Refresh to continue." }, 409);
      const position = { row: row.position_row, column: row.position_column };
      if (body.action === "scan") {
        if (row.scanned) return reply({ error: "The portable scanner has already been used on this run." }, 409);
        const objective = layout.beacon && !layout.beaconSecured ? layout.beacon : layout.target;
        const scannedLayout = { ...layout, scanHint: scanHint(position, objective) };
        const result = await db.prepare(`UPDATE dzn_outpost_run_sessions SET layout_json = ?, scanned = 1, version = version + 1, updated_at = ?
          WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND started_at > ?`)
          .bind(JSON.stringify(scannedLayout), now, user.id, row.id, row.version, now - OUTPOST_RUN_TTL_MS).run();
        if (!result.meta.changes) return reply({ error: "Another command reached this run first. Refresh to continue." }, 409);
      } else if (body.action === "support") {
        const support = supportForLayout(layout);
        let nextSupport: OutpostSupportState;
        if (body.support === "recon") {
          if (support.reconUsed) return reply({ error: "The recon drone has already completed its field sweep." }, 409);
          nextSupport = { ...support, reconUsed: true, reconCells: reconnaissanceCells(position, parseVisited(row.visited_json, maxMoves)) };
        } else {
          if (support.shieldUsed) return reply({ error: "The storm shield has already been deployed on this run." }, 409);
          nextSupport = { ...support, shieldUsed: true, shieldArmed: true };
        }
        const result = await db.prepare(`UPDATE dzn_outpost_run_sessions SET layout_json = ?, version = version + 1, updated_at = ?
          WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND started_at > ?`)
          .bind(JSON.stringify({ ...layout, support: nextSupport }), now, user.id, row.id, row.version, now - OUTPOST_RUN_TTL_MS).run();
        if (!result.meta.changes) return reply({ error: "Another command reached this run first. Refresh to continue." }, 409);
      } else {
        const direction = body.direction as OutpostRunDirection;
        const next = moveCoordinate(position, direction);
        if (!isCoordinate(next)) return reply({ error: "That route leaves the field grid." }, 400);
        const visited = parseVisited(row.visited_json, maxMoves);
        const support = supportForLayout(layout);
        const terrainHazard = layout.hazards.some(hazard => sameCoordinate(hazard, next));
        const shieldAbsorbed = terrainHazard && support.shieldArmed;
        const energy = row.energy - (terrainHazard && !shieldAbsorbed ? 1 : 0);
        const moves = row.moves + 1;
        const beaconSecured = Boolean(layout.beacon && sameCoordinate(layout.beacon, next));
        const nextLayout = {
          ...layout,
          support: shieldAbsorbed ? { ...support, shieldArmed: false } : support,
          ...(beaconSecured && !layout.beaconSecured ? { beaconSecured: true, scanHint: undefined } : {}),
        };
        const reachedRelay = sameCoordinate(layout.target, next) && (!layout.beacon || nextLayout.beaconSecured);
        const status: OutpostRunRow["status"] = reachedRelay ? "won" : energy <= 0 || moves >= maxMoves ? "failed" : "playing";
        const update = db.prepare(`UPDATE dzn_outpost_run_sessions
          SET layout_json = ?, visited_json = ?, position_row = ?, position_column = ?, energy = ?, moves = ?, status = ?, version = version + 1, updated_at = ?
          WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND started_at > ?`)
          .bind(JSON.stringify(nextLayout), JSON.stringify([...visited, next]), next.row, next.column, energy, moves, status, now, user.id, row.id, row.version, now - OUTPOST_RUN_TTL_MS);
        const statements = [update];
        if (status === "won") {
          statements.push(db.prepare(`INSERT INTO dzn_outpost_run_reward_ledger
            (id, user_id, reward_key, game_id, xp, parts, created_at)
            SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
            ON CONFLICT(user_id, reward_key) DO NOTHING`)
            .bind(crypto.randomUUID(), user.id, dayKey(now), row.id, OUTPOST_RUN_REWARD.xp, OUTPOST_RUN_REWARD.parts, now));
        }
        const result = await db.batch(statements);
        if (!result[0].meta.changes) return reply({ error: "Another command reached this run first. Refresh to continue." }, 409);
        rewardGranted = status === "won" && Boolean(result[1]?.meta.changes);
      }
    } else return reply({ error: "Unknown Outpost Run action." }, 400);
    return reply(await readOutpostRun(db, user, now, rewardGranted));
  } catch {
    return reply({ error: "DZN Outpost Run is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
