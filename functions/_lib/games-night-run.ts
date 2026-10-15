import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import {
  NIGHT_RUN_GATE_LEAD_MS,
  NIGHT_RUN_GATE_WINDOW_MS,
  NIGHT_RUN_LANES,
  NIGHT_RUN_MAX_COLLISIONS,
  NIGHT_RUN_MIN_ACTION_INTERVAL_MS,
  NIGHT_RUN_MIN_REACTION_MS,
  NIGHT_RUN_REWARD,
  NIGHT_RUN_START_COOLDOWN_MS,
  NIGHT_RUN_TOTAL_GATES,
  NIGHT_RUN_TTL_MS,
  type NightRunGame,
  type NightRunLane,
  type NightRunPayload,
} from "../../lib/games-night-run";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
const isLane = (value: unknown): value is NightRunLane => typeof value === "string" && (NIGHT_RUN_LANES as readonly string[]).includes(value);

type NightRunRow = {
  user_id: string;
  id: string;
  lane_sequence_json: string;
  gate_index: number;
  collisions: number;
  status: "playing" | "won" | "failed";
  version: number;
  gate_started_at: number;
  started_at: number;
  updated_at: number;
};

function randomIndex(length: number) {
  const limit = Math.floor(0x1_0000_0000 / length) * length;
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % length;
}

function createLaneSequence(): NightRunLane[] {
  const sequence: NightRunLane[] = [];
  while (sequence.length < NIGHT_RUN_TOTAL_GATES) {
    const previous = sequence.at(-1);
    const lanes = previous ? NIGHT_RUN_LANES.filter(lane => lane !== previous) : NIGHT_RUN_LANES;
    sequence.push(lanes[randomIndex(lanes.length)]);
  }
  return sequence;
}

function parseLaneSequence(value: string): NightRunLane[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== NIGHT_RUN_TOTAL_GATES || parsed.some(lane => !isLane(lane))) {
    throw new Error("Invalid stored Night Run lane sequence");
  }
  return parsed as NightRunLane[];
}

function gateEndsAt(row: NightRunRow) { return row.gate_started_at + NIGHT_RUN_GATE_WINDOW_MS; }

function gameView(row: NightRunRow, now: number): NightRunGame {
  const sequence = parseLaneSequence(row.lane_sequence_json);
  if (!Number.isInteger(row.gate_index) || row.gate_index < 0 || row.gate_index > NIGHT_RUN_TOTAL_GATES ||
    !Number.isInteger(row.collisions) || row.collisions < 0 || row.collisions > NIGHT_RUN_MAX_COLLISIONS) {
    throw new Error("Invalid stored Night Run progress");
  }
  const status = row.status === "playing" && (now >= row.started_at + NIGHT_RUN_TTL_MS || now >= gateEndsAt(row)) ? "expired" : row.status;
  const gateOpen = status === "playing" && now >= row.gate_started_at && now < gateEndsAt(row);
  return {
    id: row.id,
    version: row.version,
    status,
    gatesCleared: row.gate_index,
    totalGates: NIGHT_RUN_TOTAL_GATES,
    collisions: row.collisions,
    maxCollisions: NIGHT_RUN_MAX_COLLISIONS,
    safeLane: gateOpen ? sequence[row.gate_index] ?? null : null,
    gateStartsAt: row.gate_started_at,
    gateEndsAt: gateEndsAt(row),
    startedAt: row.started_at,
    expiresAt: row.started_at + NIGHT_RUN_TTL_MS,
  };
}

async function readNightRun(db: D1Database, user: SessionUser, now: number, rewardGranted = false): Promise<NightRunPayload> {
  const game = await db.prepare("SELECT * FROM dzn_night_run_sessions WHERE user_id = ?").bind(user.id).first<NightRunRow>();
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_night_run_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, dayKey(now)).first<{ rewarded: number }>();
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, rewardGranted, game: game ? gameView(game, now) : null };
}

export async function handleGamesNightRun(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "This request must come from DZN Network." }, 403);
  }
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to enter Night Run." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true" || env.DZN_GAMES_NIGHT_RUN_ENABLED !== "true") {
      return reply({ error: "DZN Night Run is not open yet." }, 404);
    }
    const db = requireDb(env);
    const now = Date.now();
    if (request.method === "GET") return reply(await readNightRun(db, user, now));

    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024);
    if (!parsed.ok) return reply({ error: "Invalid Night Run request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return reply({ error: "Invalid Night Run request." }, 400);
    }

    let rewardGranted = false;
    if (body.action === "start") {
      if (Object.keys(body).length !== 1) return reply({ error: "Invalid Night Run request." }, 400);
      const gateStartedAt = now + NIGHT_RUN_GATE_LEAD_MS;
      const result = await db.prepare(`INSERT INTO dzn_night_run_sessions
        (user_id, id, lane_sequence_json, gate_index, collisions, status, version, gate_started_at, started_at, updated_at)
        VALUES (?, ?, ?, 0, 0, 'playing', 0, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, lane_sequence_json = excluded.lane_sequence_json,
        gate_index = 0, collisions = 0, status = 'playing', version = 0, gate_started_at = excluded.gate_started_at,
        started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_night_run_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), JSON.stringify(createLaneSequence()), gateStartedAt, now, now, now - NIGHT_RUN_START_COOLDOWN_MS).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before starting another convoy run." }, 429);
    } else if (body.action === "drive") {
      const keys = Object.keys(body);
      if (keys.length !== 4 || keys.some(key => !["action", "gameId", "version", "lane"].includes(key)) ||
        !isId(body.gameId) || !Number.isInteger(body.version) || !isLane(body.lane)) {
        return reply({ error: "Choose a valid convoy lane." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_night_run_sessions WHERE user_id = ?").bind(user.id).first<NightRunRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This convoy run is not available." }, 404);
      const sequence = parseLaneSequence(row.lane_sequence_json);
      if (row.status !== "playing" || row.version !== body.version || row.gate_index >= NIGHT_RUN_TOTAL_GATES ||
        now >= row.started_at + NIGHT_RUN_TTL_MS || now >= gateEndsAt(row)) {
        return reply({ error: "This convoy run changed or ended. Refresh to continue." }, 409);
      }
      if (now < row.gate_started_at + NIGHT_RUN_MIN_REACTION_MS) return reply({ error: "Let the gate signal settle before steering." }, 429);
      if (now < row.updated_at + NIGHT_RUN_MIN_ACTION_INTERVAL_MS) return reply({ error: "Choose one lane at a time." }, 429);

      const correct = sequence[row.gate_index] === body.lane;
      const nextGate = correct ? row.gate_index + 1 : row.gate_index;
      const collisions = correct ? row.collisions : row.collisions + 1;
      const status: NightRunRow["status"] = nextGate === NIGHT_RUN_TOTAL_GATES ? "won" : collisions >= NIGHT_RUN_MAX_COLLISIONS ? "failed" : "playing";
      const nextGateStartsAt = status === "playing" ? now + NIGHT_RUN_GATE_LEAD_MS : row.gate_started_at;
      const update = db.prepare(`UPDATE dzn_night_run_sessions
        SET gate_index = ?, collisions = ?, status = ?, version = version + 1, gate_started_at = ?, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND started_at > ? AND gate_started_at <= ?`)
        .bind(nextGate, collisions, status, nextGateStartsAt, now, user.id, row.id, row.version, now - NIGHT_RUN_TTL_MS, now);
      const statements = [update];
      if (status === "won") {
        statements.push(db.prepare(`INSERT INTO dzn_night_run_reward_ledger
          (id, user_id, reward_key, game_id, xp, parts, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
          ON CONFLICT(user_id, reward_key) DO NOTHING`)
          .bind(crypto.randomUUID(), user.id, dayKey(now), row.id, NIGHT_RUN_REWARD.xp, NIGHT_RUN_REWARD.parts, now));
      }
      const result = await db.batch(statements);
      if (!result[0].meta.changes) return reply({ error: "Another steering input reached this run first. Refresh to continue." }, 409);
      rewardGranted = status === "won" && Boolean(result[1]?.meta.changes);
    } else return reply({ error: "Unknown Night Run action." }, 400);
    return reply(await readNightRun(db, user, now, rewardGranted));
  } catch {
    return reply({ error: "DZN Night Run is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
