import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import {
  NIGHT_RUN_GATE_LEAD_MS,
  NIGHT_RUN_LANES,
  NIGHT_RUN_MAX_COLLISIONS,
  NIGHT_RUN_MIN_ACTION_INTERVAL_MS,
  NIGHT_RUN_MIN_REACTION_MS,
  NIGHT_RUN_RECON_SCAN_GRACE_MS,
  NIGHT_RUN_REWARD,
  NIGHT_RUN_SIGNAL_BURST_MS,
  NIGHT_RUN_START_COOLDOWN_MS,
  NIGHT_RUN_TOTAL_GATES,
  NIGHT_RUN_TTL_MS,
  nightRunGateWindowMs,
  nightRunIntensity,
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
  decoy_armed?: number;
  decoy_used?: number;
  burst_used?: number;
  gate_extension_ms?: number;
};

type NightRunGateScanRow = { scanned: number };
const routeControlColumns = ["decoy_armed", "decoy_used", "burst_used", "gate_extension_ms"] as const;

function randomIndex(length: number) {
  const limit = Math.floor(0x1_0000_0000 / length) * length;
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % length;
}

function createLaneSequence(): NightRunLane[] {
  const reconPatterns: ReadonlyArray<ReadonlyArray<number>> = [[2, 5], [2, 6], [3, 6], [4, 7]];
  const reconGates = new Set(reconPatterns[randomIndex(reconPatterns.length)]);
  const sequence: NightRunLane[] = [];
  while (sequence.length < NIGHT_RUN_TOTAL_GATES) {
    const previous = sequence.at(-1);
    const index = sequence.length;
    const forcedLane = reconGates.has(index) ? NIGHT_RUN_LANES[(3 - (index * 2) % 3) % 3] : null;
    const nextForcedLane = reconGates.has(index + 1) ? NIGHT_RUN_LANES[(3 - ((index + 1) * 2) % 3) % 3] : null;
    const lanes = forcedLane ? [forcedLane] : NIGHT_RUN_LANES.filter(lane => lane !== previous && lane !== nextForcedLane);
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

function requiresRecon(sequence: NightRunLane[], gateIndex: number) {
  const lane = sequence[gateIndex];
  if (!lane || gateIndex < 2) return false;
  return (NIGHT_RUN_LANES.indexOf(lane) + gateIndex * 2) % 3 === 0;
}

function routeControl(row: NightRunRow, enabled: boolean) {
  return {
    decoyArmed: enabled && row.decoy_armed === 1,
    decoyUsed: enabled && row.decoy_used === 1,
    burstUsed: enabled && row.burst_used === 1,
    burstActive: enabled && row.gate_extension_ms === NIGHT_RUN_SIGNAL_BURST_MS,
  };
}

async function hasRouteControlSchema(db: D1Database) {
  const result = await db.prepare("PRAGMA table_info(dzn_night_run_sessions)").all<{ name: string }>();
  const names = new Set((result.results ?? []).map(row => row.name));
  return routeControlColumns.every(column => names.has(column));
}

function gateEndsAt(row: NightRunRow, reconEnabled = false, routeControlEnabled = false) {
  const sequence = parseLaneSequence(row.lane_sequence_json);
  const support = routeControl(row, routeControlEnabled);
  return row.gate_started_at + nightRunGateWindowMs(row.gate_index) + (reconEnabled && requiresRecon(sequence, row.gate_index) ? NIGHT_RUN_RECON_SCAN_GRACE_MS : 0) + (support.burstActive ? NIGHT_RUN_SIGNAL_BURST_MS : 0);
}

function gameView(row: NightRunRow, now: number, reconEnabled: boolean, routeControlEnabled: boolean, scanned: boolean): NightRunGame {
  const sequence = parseLaneSequence(row.lane_sequence_json);
  if (!Number.isInteger(row.gate_index) || row.gate_index < 0 || row.gate_index > NIGHT_RUN_TOTAL_GATES ||
    !Number.isInteger(row.collisions) || row.collisions < 0 || row.collisions > NIGHT_RUN_MAX_COLLISIONS) {
    throw new Error("Invalid stored Night Run progress");
  }
  const gateEnds = gateEndsAt(row, reconEnabled, routeControlEnabled);
  const support = routeControl(row, routeControlEnabled);
  const status = row.status === "playing" && (now >= row.started_at + NIGHT_RUN_TTL_MS || now >= gateEnds) ? "expired" : row.status;
  const gateOpen = status === "playing" && now >= row.gate_started_at && now < gateEnds;
  const reconRequired = gateOpen && reconEnabled && requiresRecon(sequence, row.gate_index);
  const scannerAvailable = reconRequired && !scanned;
  return {
    id: row.id,
    version: row.version,
    status,
    gatesCleared: row.gate_index,
    totalGates: NIGHT_RUN_TOTAL_GATES,
    collisions: row.collisions,
    maxCollisions: NIGHT_RUN_MAX_COLLISIONS,
    safeLane: gateOpen && !scannerAvailable ? sequence[row.gate_index] ?? null : null,
    requiresRecon: reconRequired,
    scannerAvailable,
    routeControlAvailable: routeControlEnabled,
    decoyAvailable: routeControlEnabled && !support.decoyArmed && !support.decoyUsed,
    decoyArmed: support.decoyArmed,
    decoySpent: support.decoyUsed,
    burstAvailable: routeControlEnabled && !support.burstUsed,
    burstActive: support.burstActive,
    burstSpent: support.burstUsed,
    gateStartsAt: row.gate_started_at,
    gateEndsAt: gateEnds,
    intensity: nightRunIntensity(row.gate_index),
    startedAt: row.started_at,
    expiresAt: row.started_at + NIGHT_RUN_TTL_MS,
  };
}

async function readNightRun(db: D1Database, user: SessionUser, now: number, reconEnabled: boolean, routeControlEnabled: boolean, rewardGranted = false): Promise<NightRunPayload> {
  const game = await db.prepare("SELECT * FROM dzn_night_run_sessions WHERE user_id = ?").bind(user.id).first<NightRunRow>();
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_night_run_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, dayKey(now)).first<{ rewarded: number }>();
  const scanned = game && reconEnabled
    ? await db.prepare("SELECT 1 AS scanned FROM dzn_night_run_gate_scans WHERE user_id = ? AND game_id = ? AND gate_index = ?")
      .bind(user.id, game.id, game.gate_index).first<NightRunGateScanRow>()
    : null;
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, rewardGranted, game: game ? gameView(game, now, reconEnabled, routeControlEnabled, scanned?.scanned === 1) : null };
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
    if (request.method === "POST" && env.DZN_NIGHT_RUN_ROUTE_CONTROL_MIGRATION_MAINTENANCE === "true") {
      return reply({ error: "DZN Night Run is temporarily unavailable during protected maintenance. Your convoy progress is unchanged." }, 503);
    }
    const db = requireDb(env);
    const now = Date.now();
    const reconEnabled = env.DZN_GAMES_NIGHT_RUN_RECON_ENABLED === "true";
    const routeControlEnabled = env.DZN_GAMES_NIGHT_RUN_ROUTE_CONTROL_ENABLED === "true";
    if (request.method === "GET") return reply(await readNightRun(db, user, now, reconEnabled, routeControlEnabled));

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
      const gameId = crypto.randomUUID();
      // A hidden route-control release can still have its migration installed. Reset
      // those columns when a convoy restarts so toggling the feature cannot revive
      // a previous run's armed or spent support state.
      const routeControlSchemaPresent = routeControlEnabled || await hasRouteControlSchema(db);
      const supportColumns = routeControlSchemaPresent ? ", decoy_armed, decoy_used, burst_used, gate_extension_ms" : "";
      const supportValues = routeControlSchemaPresent ? ", 0, 0, 0, 0" : "";
      const supportUpdate = routeControlSchemaPresent ? ", decoy_armed = 0, decoy_used = 0, burst_used = 0, gate_extension_ms = 0" : "";
      const result = await db.prepare(`INSERT INTO dzn_night_run_sessions
        (user_id, id, lane_sequence_json, gate_index, collisions, status, version, gate_started_at, started_at, updated_at${supportColumns})
        VALUES (?, ?, ?, 0, 0, 'playing', 0, ?, ?, ?${supportValues})
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, lane_sequence_json = excluded.lane_sequence_json,
        gate_index = 0, collisions = 0, status = 'playing', version = 0, gate_started_at = excluded.gate_started_at,
        started_at = excluded.started_at, updated_at = excluded.updated_at${supportUpdate}
        WHERE dzn_night_run_sessions.started_at <= ?`)
        .bind(user.id, gameId, JSON.stringify(createLaneSequence()), gateStartedAt, now, now, now - NIGHT_RUN_START_COOLDOWN_MS).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before starting another convoy run." }, 429);
      if (reconEnabled) {
        await db.prepare("DELETE FROM dzn_night_run_gate_scans WHERE user_id = ? AND game_id <> ?").bind(user.id, gameId).run();
      }
    } else if (body.action === "scan") {
      const keys = Object.keys(body);
      if (!reconEnabled || keys.length !== 3 || keys.some(key => !["action", "gameId", "version"].includes(key)) ||
        !isId(body.gameId) || !Number.isInteger(body.version)) {
        return reply({ error: "Run a valid gate scan." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_night_run_sessions WHERE user_id = ?").bind(user.id).first<NightRunRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This convoy run is not available." }, 404);
      const sequence = parseLaneSequence(row.lane_sequence_json);
      if (row.status !== "playing" || row.version !== body.version || row.gate_index >= sequence.length ||
        now >= row.started_at + NIGHT_RUN_TTL_MS || now >= gateEndsAt(row, reconEnabled, routeControlEnabled)) {
        return reply({ error: "This convoy run changed or ended. Refresh to continue." }, 409);
      }
      if (!requiresRecon(sequence, row.gate_index)) return reply({ error: "This gate does not need a scanner pass." }, 409);
      if (now < row.gate_started_at + NIGHT_RUN_MIN_REACTION_MS) return reply({ error: "Let the jammer signal settle before scanning." }, 429);
      if (now < row.updated_at + NIGHT_RUN_MIN_ACTION_INTERVAL_MS) return reply({ error: "Choose one convoy action at a time." }, 429);
      const update = db.prepare(`UPDATE dzn_night_run_sessions SET version = version + 1, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND started_at > ? AND gate_started_at <= ?`)
        .bind(now, user.id, row.id, row.version, now - NIGHT_RUN_TTL_MS, now);
      const recordScan = db.prepare(`INSERT INTO dzn_night_run_gate_scans (user_id, game_id, gate_index, scanned_at)
        SELECT ?, ?, ?, ? WHERE changes() = 1
        ON CONFLICT(user_id, game_id, gate_index) DO NOTHING`)
        .bind(user.id, row.id, row.gate_index, now);
      const result = await db.batch([update, recordScan]);
      if (!result[0].meta.changes || !result[1].meta.changes) return reply({ error: "Another convoy action reached this gate first. Refresh to continue." }, 409);
    } else if (body.action === "support") {
      const keys = Object.keys(body);
      if (!routeControlEnabled || keys.length !== 4 || keys.some(key => !["action", "gameId", "version", "support"].includes(key)) ||
        !isId(body.gameId) || !Number.isInteger(body.version) || (body.support !== "decoy" && body.support !== "burst")) {
        return reply({ error: "Choose a valid route-control action." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_night_run_sessions WHERE user_id = ?").bind(user.id).first<NightRunRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This convoy run is not available." }, 404);
      const sequence = parseLaneSequence(row.lane_sequence_json);
      const support = routeControl(row, true);
      const scanRow = reconEnabled && requiresRecon(sequence, row.gate_index)
        ? await db.prepare("SELECT 1 AS scanned FROM dzn_night_run_gate_scans WHERE user_id = ? AND game_id = ? AND gate_index = ?").bind(user.id, row.id, row.gate_index).first<NightRunGateScanRow>()
        : null;
      if (row.status !== "playing" || row.version !== body.version || row.gate_index >= sequence.length ||
        now >= row.started_at + NIGHT_RUN_TTL_MS || now >= gateEndsAt(row, reconEnabled, true) ||
        (reconEnabled && requiresRecon(sequence, row.gate_index) && scanRow?.scanned !== 1)) {
        return reply({ error: "This gate changed or needs its scanner pass first. Refresh to continue." }, 409);
      }
      if (now < row.gate_started_at + NIGHT_RUN_MIN_REACTION_MS || now < row.updated_at + NIGHT_RUN_MIN_ACTION_INTERVAL_MS) {
        return reply({ error: "Choose one convoy action at a time." }, 429);
      }
      const isDecoy = body.support === "decoy";
      if ((isDecoy && (support.decoyArmed || support.decoyUsed)) || (!isDecoy && support.burstUsed)) {
        return reply({ error: "That route-control tool has already been used on this run." }, 409);
      }
      const update = isDecoy
        ? db.prepare(`UPDATE dzn_night_run_sessions SET decoy_armed = 1, version = version + 1, updated_at = ?
          WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND decoy_armed = 0 AND decoy_used = 0 AND started_at > ? AND gate_started_at <= ?`)
          .bind(now, user.id, row.id, row.version, now - NIGHT_RUN_TTL_MS, now)
        : db.prepare(`UPDATE dzn_night_run_sessions SET burst_used = 1, gate_extension_ms = ?, version = version + 1, updated_at = ?
          WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND burst_used = 0 AND gate_extension_ms = 0 AND started_at > ? AND gate_started_at <= ?`)
          .bind(NIGHT_RUN_SIGNAL_BURST_MS, now, user.id, row.id, row.version, now - NIGHT_RUN_TTL_MS, now);
      if (!(await update.run()).meta.changes) return reply({ error: "Another route-control action reached this gate first. Refresh to continue." }, 409);
    } else if (body.action === "drive") {
      const keys = Object.keys(body);
      if (keys.length !== 4 || keys.some(key => !["action", "gameId", "version", "lane"].includes(key)) ||
        !isId(body.gameId) || !Number.isInteger(body.version) || !isLane(body.lane)) {
        return reply({ error: "Choose a valid convoy lane." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_night_run_sessions WHERE user_id = ?").bind(user.id).first<NightRunRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This convoy run is not available." }, 404);
      const sequence = parseLaneSequence(row.lane_sequence_json);
      if (row.status !== "playing" || row.version !== body.version || row.gate_index >= sequence.length ||
        now >= row.started_at + NIGHT_RUN_TTL_MS || now >= gateEndsAt(row, reconEnabled, routeControlEnabled)) {
        return reply({ error: "This convoy run changed or ended. Refresh to continue." }, 409);
      }
      if (now < row.gate_started_at + NIGHT_RUN_MIN_REACTION_MS) return reply({ error: "Let the gate signal settle before steering." }, 429);
      let scanned = false;
      if (reconEnabled && requiresRecon(sequence, row.gate_index)) {
        const scanRow = await db.prepare("SELECT 1 AS scanned FROM dzn_night_run_gate_scans WHERE user_id = ? AND game_id = ? AND gate_index = ?")
          .bind(user.id, row.id, row.gate_index).first<NightRunGateScanRow>();
        if (scanRow?.scanned !== 1) return reply({ error: "Scan the jammer gate before steering." }, 409);
        scanned = true;
      }
      if (!scanned && now < row.updated_at + NIGHT_RUN_MIN_ACTION_INTERVAL_MS) return reply({ error: "Choose one lane at a time." }, 429);

      const support = routeControl(row, routeControlEnabled);
      const correct = sequence[row.gate_index] === body.lane;
      const nextGate = correct ? row.gate_index + 1 : row.gate_index;
      const decoyTriggered = !correct && support.decoyArmed;
      const collisions = correct || decoyTriggered ? row.collisions : row.collisions + 1;
      const status: NightRunRow["status"] = nextGate === NIGHT_RUN_TOTAL_GATES ? "won" : collisions >= NIGHT_RUN_MAX_COLLISIONS ? "failed" : "playing";
      const nextGateStartsAt = status === "playing" ? now + NIGHT_RUN_GATE_LEAD_MS : row.gate_started_at;
      const routeUpdate = routeControlEnabled ? ", decoy_armed = ?, decoy_used = ?, gate_extension_ms = 0" : "";
      const update = db.prepare(`UPDATE dzn_night_run_sessions
        SET gate_index = ?, collisions = ?, status = ?, version = version + 1, gate_started_at = ?, updated_at = ?${routeUpdate}
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing' AND started_at > ? AND gate_started_at <= ?`)
        .bind(nextGate, collisions, status, nextGateStartsAt, now, ...(routeControlEnabled ? [decoyTriggered ? 0 : row.decoy_armed ?? 0, decoyTriggered ? 1 : row.decoy_used ?? 0] : []), user.id, row.id, row.version, now - NIGHT_RUN_TTL_MS, now);
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
    return reply(await readNightRun(db, user, now, reconEnabled, routeControlEnabled, rewardGranted));
  } catch {
    return reply({ error: "DZN Night Run is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
