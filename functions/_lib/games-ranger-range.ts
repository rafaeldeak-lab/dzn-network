import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import {
  RANGER_RANGE_MAX_MISSES,
  RANGER_RANGE_MIN_ACTION_INTERVAL_MS,
  RANGER_RANGE_MIN_REACTION_MS,
  RANGER_RANGE_REWARD,
  RANGER_RANGE_START_COOLDOWN_MS,
  RANGER_RANGE_TARGET_LEAD_MS,
  RANGER_RANGE_TARGETS,
  RANGER_RANGE_TOTAL_SHOTS,
  RANGER_RANGE_WINDS,
  rangerRangeSightForWind,
  RANGER_RANGE_TTL_MS,
  rangerRangeIntensity,
  rangerRangeTargetWindowMs,
  type RangerRangeGame,
  type RangerRangePayload,
  type RangerRangeSight,
  type RangerRangeTarget,
  type RangerRangeWind,
} from "../../lib/games-ranger-range";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
const isTarget = (value: unknown): value is RangerRangeTarget => typeof value === "string" && (RANGER_RANGE_TARGETS as readonly string[]).includes(value);
const isWind = (value: unknown): value is RangerRangeWind => typeof value === "string" && (RANGER_RANGE_WINDS as readonly string[]).includes(value);
const isSight = (value: unknown): value is RangerRangeSight => typeof value === "string" && ["left", "centre", "right"].includes(value);

type RangerRangeRow = {
  user_id: string;
  id: string;
  target_sequence_json: string;
  shot_index: number;
  misses: number;
  status: "playing" | "won" | "failed";
  version: number;
  target_started_at: number;
  started_at: number;
  updated_at: number;
};

function randomIndex(length: number) {
  const limit = Math.floor(0x1_0000_0000 / length) * length;
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % length;
}

type RangerRangeShot = { target: RangerRangeTarget; wind: RangerRangeWind };

function createTargetSequence(): Array<[RangerRangeTarget, RangerRangeWind]> {
  const sequence: Array<[RangerRangeTarget, RangerRangeWind]> = [];
  while (sequence.length < RANGER_RANGE_TOTAL_SHOTS) {
    const previous = sequence.at(-1)?.[0];
    const candidates = previous ? RANGER_RANGE_TARGETS.filter(target => target !== previous) : RANGER_RANGE_TARGETS;
    // Let players calibrate twice, then guarantee an early crosswind before later random conditions.
    const wind = sequence.length < 2 ? "calm" : sequence.length === 2
      ? (randomIndex(2) === 0 ? "left" : "right")
      : RANGER_RANGE_WINDS[randomIndex(RANGER_RANGE_WINDS.length)];
    sequence.push([candidates[randomIndex(candidates.length)], wind]);
  }
  return sequence;
}

function createLegacyTargetSequence(): RangerRangeTarget[] {
  const sequence: RangerRangeTarget[] = [];
  while (sequence.length < RANGER_RANGE_TOTAL_SHOTS) {
    const previous = sequence.at(-1);
    const candidates = previous ? RANGER_RANGE_TARGETS.filter(target => target !== previous) : RANGER_RANGE_TARGETS;
    sequence.push(candidates[randomIndex(candidates.length)]);
  }
  return sequence;
}

function parseTargetSequence(value: string): RangerRangeShot[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== RANGER_RANGE_TOTAL_SHOTS) {
    throw new Error("Invalid stored Ranger Range target sequence");
  }
  return parsed.map((shot): RangerRangeShot => {
    // Existing active runs stored only targets. Keep those rows playable with still-air shots.
    if (isTarget(shot)) return { target: shot, wind: "calm" };
    if (Array.isArray(shot) && shot.length === 2 && isTarget(shot[0]) && isWind(shot[1])) return { target: shot[0], wind: shot[1] };
    throw new Error("Invalid stored Ranger Range target sequence");
  });
}

function isLegacyTargetOnlySequence(value: string) {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.length === RANGER_RANGE_TOTAL_SHOTS && parsed.every(isTarget);
}

function targetEndsAt(row: RangerRangeRow) {
  return row.target_started_at + rangerRangeTargetWindowMs(row.shot_index);
}

function gameView(row: RangerRangeRow, now: number): RangerRangeGame {
  const sequence = parseTargetSequence(row.target_sequence_json);
  if (!Number.isInteger(row.shot_index) || row.shot_index < 0 || row.shot_index > RANGER_RANGE_TOTAL_SHOTS ||
    !Number.isInteger(row.misses) || row.misses < 0 || row.misses > RANGER_RANGE_MAX_MISSES) {
    throw new Error("Invalid stored Ranger Range progress");
  }
  const targetEnds = targetEndsAt(row);
  const status = row.status === "playing" && (now >= row.started_at + RANGER_RANGE_TTL_MS || now >= targetEnds) ? "expired" : row.status;
  const active = status === "playing";
  const targetOpen = active && now >= row.target_started_at && now < targetEnds;
  const shot = sequence[row.shot_index];
  return {
    id: row.id,
    version: row.version,
    status,
    shotsCleared: row.shot_index,
    totalShots: RANGER_RANGE_TOTAL_SHOTS,
    misses: row.misses,
    maxMisses: RANGER_RANGE_MAX_MISSES,
    target: targetOpen ? shot?.target ?? null : null,
    wind: targetOpen ? shot?.wind ?? null : null,
    targetStartsAt: row.target_started_at,
    targetEndsAt: targetEnds,
    intensity: rangerRangeIntensity(row.shot_index),
    startedAt: row.started_at,
    expiresAt: row.started_at + RANGER_RANGE_TTL_MS,
  };
}

async function readRangerRange(db: D1Database, user: SessionUser, now: number, rewardGranted = false): Promise<RangerRangePayload> {
  const game = await db.prepare("SELECT * FROM dzn_ranger_range_sessions WHERE user_id = ?").bind(user.id).first<RangerRangeRow>();
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_ranger_range_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, dayKey(now)).first<{ rewarded: number }>();
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, rewardGranted, game: game ? gameView(game, now) : null };
}

export async function handleGamesRangerRange(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "This request must come from DZN Network." }, 403);
  }
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to enter Ranger Range." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true" || env.DZN_GAMES_RANGER_RANGE_ENABLED !== "true") {
      return reply({ error: "DZN Ranger Range is not open yet." }, 404);
    }
    const db = requireDb(env);
    const now = Date.now();
    if (request.method === "GET") return reply(await readRangerRange(db, user, now));

    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024);
    if (!parsed.ok) return reply({ error: "Invalid Ranger Range request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return reply({ error: "Invalid Ranger Range request." }, 400);
    }

    let rewardGranted = false;
    if (body.action === "start") {
      const keys = Object.keys(body);
      const windScoredStart = keys.length === 2 && keys.every(key => ["action", "protocol"].includes(key)) && body.protocol === "wind-v1";
      const legacyStart = keys.length === 1;
      if (!windScoredStart && !legacyStart) return reply({ error: "Invalid Ranger Range request." }, 400);
      const targetStartsAt = now + RANGER_RANGE_TARGET_LEAD_MS;
      const result = await db.prepare(`INSERT INTO dzn_ranger_range_sessions
        (user_id, id, target_sequence_json, shot_index, misses, status, version, target_started_at, started_at, updated_at)
        VALUES (?, ?, ?, 0, 0, 'playing', 0, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, target_sequence_json = excluded.target_sequence_json,
        shot_index = 0, misses = 0, status = 'playing', version = 0, target_started_at = excluded.target_started_at,
        started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_ranger_range_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), JSON.stringify(windScoredStart ? createTargetSequence() : createLegacyTargetSequence()), targetStartsAt, now, now, now - RANGER_RANGE_START_COOLDOWN_MS).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before beginning another range run." }, 429);
    } else if (body.action === "fire") {
      const keys = Object.keys(body);
      const modernRequest = keys.length === 5 && keys.every(key => ["action", "gameId", "version", "target", "sight"].includes(key));
      const legacyRequest = keys.length === 4 && keys.every(key => ["action", "gameId", "version", "target"].includes(key));
      if ((!modernRequest && !legacyRequest) || !isId(body.gameId) || !Number.isInteger(body.version) || !isTarget(body.target)
        || (modernRequest && !isSight(body.sight))) {
        return reply({ error: "Choose a valid range target." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_ranger_range_sessions WHERE user_id = ?").bind(user.id).first<RangerRangeRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This range run is not available." }, 404);
      const sequence = parseTargetSequence(row.target_sequence_json);
      if (legacyRequest && !isLegacyTargetOnlySequence(row.target_sequence_json)) {
        return reply({ error: "Choose a valid range target." }, 400);
      }
      if (row.status !== "playing" || row.version !== body.version || row.shot_index >= sequence.length ||
        now >= row.started_at + RANGER_RANGE_TTL_MS || now >= targetEndsAt(row)) {
        return reply({ error: "This range run changed or ended. Refresh to continue." }, 409);
      }
      if (now < row.target_started_at + RANGER_RANGE_MIN_REACTION_MS) return reply({ error: "Let the target settle before releasing an arrow." }, 429);
      if (now < row.updated_at + RANGER_RANGE_MIN_ACTION_INTERVAL_MS) return reply({ error: "Release one arrow at a time." }, 429);

      const shot = sequence[row.shot_index];
      const sight: RangerRangeSight = legacyRequest ? "centre" : body.sight as RangerRangeSight;
      const correct = shot?.target === body.target && rangerRangeSightForWind(shot.wind) === sight;
      const nextShot = correct ? row.shot_index + 1 : row.shot_index;
      const misses = correct ? row.misses : row.misses + 1;
      const status: RangerRangeRow["status"] = nextShot === RANGER_RANGE_TOTAL_SHOTS ? "won" : misses >= RANGER_RANGE_MAX_MISSES ? "failed" : "playing";
      const nextTargetStartsAt = status === "playing" ? now + RANGER_RANGE_TARGET_LEAD_MS : row.target_started_at;
      const update = db.prepare(`UPDATE dzn_ranger_range_sessions
        SET shot_index = ?, misses = ?, status = ?, version = version + 1, target_started_at = ?, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND started_at > ? AND target_started_at <= ?`)
        .bind(nextShot, misses, status, nextTargetStartsAt, now, user.id, row.id, row.version, now - RANGER_RANGE_TTL_MS, now);
      const statements = [update];
      if (status === "won") {
        statements.push(db.prepare(`INSERT INTO dzn_ranger_range_reward_ledger
          (id, user_id, reward_key, game_id, xp, parts, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
          ON CONFLICT(user_id, reward_key) DO NOTHING`)
          .bind(crypto.randomUUID(), user.id, dayKey(now), row.id, RANGER_RANGE_REWARD.xp, RANGER_RANGE_REWARD.parts, now));
      }
      const result = await db.batch(statements);
      if (!result[0].meta.changes) return reply({ error: "Another arrow reached this run first. Refresh to continue." }, 409);
      rewardGranted = status === "won" && Boolean(result[1]?.meta.changes);
    } else return reply({ error: "Unknown Ranger Range action." }, 400);
    return reply(await readRangerRange(db, user, now, rewardGranted));
  } catch {
    return reply({ error: "DZN Ranger Range is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
