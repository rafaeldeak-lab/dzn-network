import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import {
  RELAY_RUSH_LANES,
  RELAY_RUSH_MAX_MISSES,
  RELAY_RUSH_MIN_ACTION_INTERVAL_MS,
  RELAY_RUSH_PULSE_INTERVAL_MS,
  RELAY_RUSH_REWARD,
  RELAY_RUSH_START_DELAY_MS,
  RELAY_RUSH_TOTAL_PULSES,
  RELAY_RUSH_TTL_MS,
  type RelayRushGame,
  type RelayRushLane,
  type RelayRushPayload,
} from "../../lib/games-relay-rush";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
const isLane = (value: unknown): value is RelayRushLane => typeof value === "string" && (RELAY_RUSH_LANES as readonly string[]).includes(value);

type RelayRushRow = {
  user_id: string;
  id: string;
  route_json: string;
  current_index: number;
  misses: number;
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

function createRoute(): RelayRushLane[] {
  const route: RelayRushLane[] = [];
  while (route.length < RELAY_RUSH_TOTAL_PULSES) {
    const previous = route.at(-1);
    const beforePrevious = route.at(-2);
    const candidates = previous && previous === beforePrevious
      ? RELAY_RUSH_LANES.filter(lane => lane !== previous)
      : RELAY_RUSH_LANES;
    route.push(candidates[randomIndex(candidates.length)]);
  }
  return route;
}

function parseRoute(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== RELAY_RUSH_TOTAL_PULSES || parsed.some(lane => !isLane(lane))) {
    throw new Error("Invalid stored Relay Rush route");
  }
  return parsed as RelayRushLane[];
}

function nextPulseAt(row: RelayRushRow) {
  return Math.max(
    row.started_at + RELAY_RUSH_START_DELAY_MS + row.current_index * RELAY_RUSH_PULSE_INTERVAL_MS,
    row.updated_at + RELAY_RUSH_PULSE_INTERVAL_MS,
  );
}

function gameView(row: RelayRushRow, now: number): RelayRushGame {
  const route = parseRoute(row.route_json);
  const status = row.status === "playing" && now >= row.started_at + RELAY_RUSH_TTL_MS ? "expired" : row.status;
  const active = status === "playing";
  return {
    id: row.id,
    version: row.version,
    status,
    pulsesCleared: row.current_index,
    totalPulses: route.length,
    misses: row.misses,
    maxMisses: RELAY_RUSH_MAX_MISSES,
    nextLane: active ? route[row.current_index] ?? null : null,
    nextAt: active ? nextPulseAt(row) : null,
    startedAt: row.started_at,
    expiresAt: row.started_at + RELAY_RUSH_TTL_MS,
  };
}

async function readState(db: D1Database, user: SessionUser, now: number, rewardGranted = false): Promise<RelayRushPayload> {
  const game = await db.prepare("SELECT * FROM dzn_relay_rush_sessions WHERE user_id = ?").bind(user.id).first<RelayRushRow>();
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_relay_rush_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, dayKey(now)).first<{ rewarded: number }>();
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, rewardGranted, game: game ? gameView(game, now) : null };
}

export async function handleGamesRelayRush(request: Request, env: Env): Promise<Response> {
  if (!['GET', 'POST'].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "This request must come from DZN Network." }, 403);
  }
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to run Relay Rush." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true" || env.DZN_GAMES_RELAY_RUSH_ENABLED !== "true") {
      return reply({ error: "DZN Relay Rush is not open yet." }, 404);
    }
    const db = requireDb(env);
    const now = Date.now();
    if (request.method === "GET") return reply(await readState(db, user, now));

    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024);
    if (!parsed.ok) return reply({ error: "Invalid Relay Rush request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return reply({ error: "Invalid Relay Rush request." }, 400);
    }

    let rewardGranted = false;
    if (body.action === "start") {
      if (Object.keys(body).length !== 1) return reply({ error: "Invalid Relay Rush request." }, 400);
      const result = await db.prepare(`INSERT INTO dzn_relay_rush_sessions
        (user_id, id, route_json, current_index, misses, status, version, started_at, updated_at)
        VALUES (?, ?, ?, 0, 0, 'playing', 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, route_json = excluded.route_json,
        current_index = 0, misses = 0, status = 'playing', version = 0,
        started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_relay_rush_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), JSON.stringify(createRoute()), now, now, now - 5_000).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before starting another run." }, 429);
    } else if (body.action === "pulse") {
      const keys = Object.keys(body);
      if (keys.length !== 4 || keys.some(key => !["action", "gameId", "version", "lane"].includes(key)) ||
        !isId(body.gameId) || !Number.isInteger(body.version) || !isLane(body.lane)) {
        return reply({ error: "Choose a valid Relay Rush lane." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_relay_rush_sessions WHERE user_id = ?").bind(user.id).first<RelayRushRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This Relay Rush run is not available." }, 404);
      if (row.status !== "playing" || row.version !== body.version || row.current_index >= RELAY_RUSH_TOTAL_PULSES || now >= row.started_at + RELAY_RUSH_TTL_MS) {
        return reply({ error: "This run changed or ended. Refresh to continue." }, 409);
      }
      if (now < nextPulseAt(row) || now < row.updated_at + RELAY_RUSH_MIN_ACTION_INTERVAL_MS) {
        return reply({ error: "Wait for the next signal pulse." }, 429);
      }
      const route = parseRoute(row.route_json);
      const correct = route[row.current_index] === body.lane;
      const currentIndex = row.current_index + 1;
      const misses = row.misses + (correct ? 0 : 1);
      const status = misses >= RELAY_RUSH_MAX_MISSES ? "failed" : currentIndex === route.length ? "won" : "playing";
      const update = db.prepare(`UPDATE dzn_relay_rush_sessions
        SET current_index = ?, misses = ?, status = ?, version = version + 1, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing'`)
        .bind(currentIndex, misses, status, now, user.id, row.id, row.version);
      const statements = [update];
      if (status === "won") {
        statements.push(db.prepare(`INSERT INTO dzn_relay_rush_reward_ledger
          (id, user_id, reward_key, game_id, xp, parts, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
          ON CONFLICT(user_id, reward_key) DO NOTHING`)
          .bind(crypto.randomUUID(), user.id, dayKey(now), row.id, RELAY_RUSH_REWARD.xp, RELAY_RUSH_REWARD.parts, now));
      }
      const result = await db.batch(statements);
      if (!result[0].meta.changes) return reply({ error: "Another pulse reached this run first. Refresh to continue." }, 409);
      rewardGranted = status === "won" && Boolean(result[1]?.meta.changes);
    } else return reply({ error: "Unknown Relay Rush action." }, 400);
    return reply(await readState(db, user, now, rewardGranted));
  } catch {
    return reply({ error: "DZN Relay Rush is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
