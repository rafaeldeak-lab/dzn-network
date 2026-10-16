import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import {
  ECHO_ARRAY_CUE_LEAD_MS,
  ECHO_ARRAY_CUE_TAIL_MS,
  echoArrayCueIntervalMs,
  echoArrayIntensity,
  ECHO_ARRAY_MAX_ERRORS,
  ECHO_ARRAY_MIN_INPUT_INTERVAL_MS,
  ECHO_ARRAY_NODES,
  ECHO_ARRAY_REWARD,
  ECHO_ARRAY_STAGE_LENGTHS,
  ECHO_ARRAY_START_COOLDOWN_MS,
  ECHO_ARRAY_TTL_MS,
  type EchoArrayGame,
  type EchoArrayNode,
  type EchoArrayPayload,
} from "../../lib/games-echo-array";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
const isNode = (value: unknown): value is EchoArrayNode => typeof value === "string" && (ECHO_ARRAY_NODES as readonly string[]).includes(value);

type EchoArrayRow = {
  user_id: string;
  id: string;
  sequence_json: string;
  stage: number;
  input_index: number;
  errors: number;
  status: "playing" | "won" | "failed";
  version: number;
  cue_started_at: number;
  started_at: number;
  updated_at: number;
};

function stageLength(stage: number) {
  const length = ECHO_ARRAY_STAGE_LENGTHS[stage - 1];
  if (!length) throw new Error("Invalid stored Echo Array stage");
  return length;
}

function cueDuration(stage: number) {
  return ECHO_ARRAY_CUE_LEAD_MS + stageLength(stage) * echoArrayCueIntervalMs(stage) + ECHO_ARRAY_CUE_TAIL_MS;
}

function cueEndsAt(row: EchoArrayRow) {
  return row.cue_started_at + cueDuration(row.stage);
}

function randomIndex(length: number) {
  const limit = Math.floor(0x1_0000_0000 / length) * length;
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % length;
}

function createSequence() {
  const sequence: EchoArrayNode[] = [];
  const total = ECHO_ARRAY_STAGE_LENGTHS.at(-1)!;
  while (sequence.length < total) {
    const previous = sequence.at(-1);
    const candidates = previous ? ECHO_ARRAY_NODES.filter(node => node !== previous) : ECHO_ARRAY_NODES;
    sequence.push(candidates[randomIndex(candidates.length)]);
  }
  return sequence;
}

function parseSequence(value: string): EchoArrayNode[] {
  const parsed = JSON.parse(value) as unknown;
  const total = ECHO_ARRAY_STAGE_LENGTHS.at(-1)!;
  if (!Array.isArray(parsed) || parsed.length !== total || parsed.some(node => !isNode(node))) {
    throw new Error("Invalid stored Echo Array sequence");
  }
  return parsed as EchoArrayNode[];
}

function gameView(row: EchoArrayRow, now: number): EchoArrayGame {
  const sequence = parseSequence(row.sequence_json);
  const length = stageLength(row.stage);
  if (!Number.isInteger(row.input_index) || row.input_index < 0 || row.input_index > length || !Number.isInteger(row.errors) || row.errors < 0 || row.errors > ECHO_ARRAY_MAX_ERRORS) {
    throw new Error("Invalid stored Echo Array progress");
  }
  const status = row.status === "playing" && now >= row.started_at + ECHO_ARRAY_TTL_MS ? "expired" : row.status;
  const active = status === "playing";
  const cueEnds = cueEndsAt(row);
  const revealing = active && now < cueEnds;
  return {
    id: row.id,
    version: row.version,
    status,
    phase: active ? revealing ? "revealing" : "input" : null,
    stage: row.stage,
    totalStages: ECHO_ARRAY_STAGE_LENGTHS.length,
    sequenceLength: length,
    intensity: echoArrayIntensity(row.stage),
    cueIntervalMs: echoArrayCueIntervalMs(row.stage),
    inputIndex: row.input_index,
    errors: row.errors,
    maxErrors: ECHO_ARRAY_MAX_ERRORS,
    cue: revealing ? sequence.slice(0, length) : null,
    cueStartedAt: row.cue_started_at,
    cueEndsAt: cueEnds,
    startedAt: row.started_at,
    expiresAt: row.started_at + ECHO_ARRAY_TTL_MS,
  };
}

async function readEchoArray(db: D1Database, user: SessionUser, now: number, rewardGranted = false): Promise<EchoArrayPayload> {
  const game = await db.prepare("SELECT * FROM dzn_echo_array_sessions WHERE user_id = ?").bind(user.id).first<EchoArrayRow>();
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_echo_array_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, dayKey(now)).first<{ rewarded: number }>();
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, rewardGranted, game: game ? gameView(game, now) : null };
}

export async function handleGamesEchoArray(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "This request must come from DZN Network." }, 403);
  }
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to enter Echo Array." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true" || env.DZN_GAMES_ECHO_ARRAY_ENABLED !== "true") {
      return reply({ error: "DZN Echo Array is not open yet." }, 404);
    }
    const db = requireDb(env);
    const now = Date.now();
    if (request.method === "GET") return reply(await readEchoArray(db, user, now));

    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024);
    if (!parsed.ok) return reply({ error: "Invalid Echo Array request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return reply({ error: "Invalid Echo Array request." }, 400);
    }

    let rewardGranted = false;
    if (body.action === "start") {
      if (Object.keys(body).length !== 1) return reply({ error: "Invalid Echo Array request." }, 400);
      const result = await db.prepare(`INSERT INTO dzn_echo_array_sessions
        (user_id, id, sequence_json, stage, input_index, errors, status, version, cue_started_at, started_at, updated_at)
        VALUES (?, ?, ?, 1, 0, 0, 'playing', 0, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, sequence_json = excluded.sequence_json,
        stage = 1, input_index = 0, errors = 0, status = 'playing', version = 0,
        cue_started_at = excluded.cue_started_at, started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_echo_array_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), JSON.stringify(createSequence()), now, now, now, now - ECHO_ARRAY_START_COOLDOWN_MS).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before starting another echo." }, 429);
    } else if (body.action === "tap") {
      const keys = Object.keys(body);
      if (keys.length !== 4 || keys.some(key => !["action", "gameId", "version", "node"].includes(key)) ||
        !isId(body.gameId) || !Number.isInteger(body.version) || !isNode(body.node)) {
        return reply({ error: "Choose a valid Echo Array node." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_echo_array_sessions WHERE user_id = ?").bind(user.id).first<EchoArrayRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This Echo Array run is not available." }, 404);
      const sequence = parseSequence(row.sequence_json);
      const length = stageLength(row.stage);
      if (row.status !== "playing" || row.version !== body.version || row.input_index >= length || now >= row.started_at + ECHO_ARRAY_TTL_MS) {
        return reply({ error: "This Echo Array run changed or ended. Refresh to continue." }, 409);
      }
      if (now < cueEndsAt(row)) return reply({ error: "Watch the full echo before replaying it." }, 429);
      if (now < row.updated_at + ECHO_ARRAY_MIN_INPUT_INTERVAL_MS) return reply({ error: "Take a moment before selecting the next node." }, 429);

      const correct = sequence[row.input_index] === body.node;
      let nextStage = row.stage;
      let inputIndex = row.input_index;
      let errors = row.errors;
      let status: EchoArrayRow["status"] = "playing";
      let cueStartedAt = row.cue_started_at;
      if (correct) {
        inputIndex++;
        if (inputIndex === length) {
          if (row.stage === ECHO_ARRAY_STAGE_LENGTHS.length) status = "won";
          else { nextStage++; inputIndex = 0; cueStartedAt = now; }
        }
      } else {
        errors++;
        if (errors >= ECHO_ARRAY_MAX_ERRORS) status = "failed";
        else { inputIndex = 0; cueStartedAt = now; }
      }

      const update = db.prepare(`UPDATE dzn_echo_array_sessions
        SET stage = ?, input_index = ?, errors = ?, status = ?, cue_started_at = ?, version = version + 1, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND started_at > ?`)
        .bind(nextStage, inputIndex, errors, status, cueStartedAt, now, user.id, row.id, row.version, now - ECHO_ARRAY_TTL_MS);
      const statements = [update];
      if (status === "won") {
        statements.push(db.prepare(`INSERT INTO dzn_echo_array_reward_ledger
          (id, user_id, reward_key, game_id, xp, parts, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
          ON CONFLICT(user_id, reward_key) DO NOTHING`)
          .bind(crypto.randomUUID(), user.id, dayKey(now), row.id, ECHO_ARRAY_REWARD.xp, ECHO_ARRAY_REWARD.parts, now));
      }
      const result = await db.batch(statements);
      if (!result[0].meta.changes) return reply({ error: "Another echo input reached this run first. Refresh to continue." }, 409);
      rewardGranted = status === "won" && Boolean(result[1]?.meta.changes);
    } else return reply({ error: "Unknown Echo Array action." }, 400);
    return reply(await readEchoArray(db, user, now, rewardGranted));
  } catch {
    return reply({ error: "DZN Echo Array is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
