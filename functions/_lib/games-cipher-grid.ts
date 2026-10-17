import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import {
  CIPHER_GRID_LEGACY_MAX_ATTEMPTS,
  CIPHER_GRID_MAX_ATTEMPTS,
  CIPHER_GRID_REWARD,
  CIPHER_GRID_SPECIALIST_MAX_ATTEMPTS,
  CIPHER_GRID_SPECIALIST_WORD_LENGTH,
  CIPHER_GRID_TTL_MS,
  CIPHER_GRID_WORD_LENGTH,
  type CipherGridAttempt,
  type CipherGridDifficulty,
  type CipherGridGame,
  type CipherGridMark,
  type CipherGridPayload,
} from "../../lib/games-cipher-grid";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const START_COOLDOWN_MS = 5_000;
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
const isCipherLength = (length: number) => length === CIPHER_GRID_WORD_LENGTH || length === CIPHER_GRID_SPECIALIST_WORD_LENGTH;
const isGuess = (value: unknown, length?: number): value is string => typeof value === "string" &&
  /^[A-Z]+$/.test(value) && (length === undefined ? isCipherLength(value.length) : value.length === length);
const isMark = (value: unknown): value is CipherGridMark => value === "correct" || value === "present" || value === "absent";

// This server-only field lexicon is intentionally not returned by the API.
// Guesses can be any five letters so players are not forced to know a hidden word list.
const FIELD_WORDS = [
  "AMBER", "BLAZE", "BRINK", "CACHE", "CARGO", "CHOKE", "CIVIC", "CLOAK", "COMMS", "COVER",
  "CRATE", "CREST", "DROWN", "DUSKS", "EMBER", "FAULT", "FENCE", "FIELD", "FIRES", "FLARE",
  "FOCUS", "FROST", "GATES", "GEARS", "GHOST", "GLINT", "GUARD", "HAVEN", "HUSKS", "INLET",
  "KNOTS", "LATCH", "LIGHT", "LURCH", "MARCH", "MASON", "MISTY", "NEXUS", "NORTH", "OASIS",
  "PINES", "PRISM", "RADIO", "RAIDS", "RELAY", "RIFLE", "RIFTS", "RIDGE", "RIVER", "ROUTE",
  "RUSTS", "SABLE", "SCALE", "SCOUT", "SCOPE", "SHARD", "SHELL", "SHORE", "SIEGE", "SLATE",
  "SPARK", "SPORE", "STASH", "STORM", "SWAMP", "SWIFT", "THORN", "TOOLS", "TORCH", "TOWER",
  "TRAIL", "TRACK", "TURBO", "VALVE", "VAULT", "VIGIL", "WATER", "WATCH", "WELDS", "WILDS", "WRECK",
] as const;

const SPECIALIST_WORDS = [
  "ANCHOR", "ARMOUR", "BEACON", "BUNKER", "CIPHER", "CONVOY", "DANGER", "DETOUR",
  "FROZEN", "GUNNER", "LOCKED", "MUTANT", "RADIOS", "RUNNER", "SCHEMA", "SIGNAL",
  "STRIKE", "SUPPLY", "TARGET", "TRADER", "VAULTS", "VIGILS", "WALKER",
] as const;

type CipherDefinition = {
  answerLength: number;
  maxAttempts: number;
  difficulty: CipherGridDifficulty;
};

type CipherGridRow = {
  user_id: string;
  id: string;
  answer: string;
  attempts_json: string;
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

function definitionFor(answer: string): CipherDefinition {
  if (answer.length === CIPHER_GRID_WORD_LENGTH) {
    return { answerLength: CIPHER_GRID_WORD_LENGTH, maxAttempts: CIPHER_GRID_MAX_ATTEMPTS, difficulty: "field" };
  }
  if (answer.length === CIPHER_GRID_SPECIALIST_WORD_LENGTH) {
    return { answerLength: CIPHER_GRID_SPECIALIST_WORD_LENGTH, maxAttempts: CIPHER_GRID_SPECIALIST_MAX_ATTEMPTS, difficulty: "specialist" };
  }
  throw new Error("Invalid Cipher Grid answer length");
}

function chooseAnswer(specialistEnabled: boolean) {
  const words = specialistEnabled ? [...FIELD_WORDS, ...SPECIALIST_WORDS] : FIELD_WORDS;
  return words[randomIndex(words.length)];
}

function parseAttempts(value: string, answerLength: number): CipherGridAttempt[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length > CIPHER_GRID_LEGACY_MAX_ATTEMPTS) throw new Error("Invalid stored Cipher Grid attempts");
  return parsed.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid stored Cipher Grid attempt");
    const attempt = entry as { guess?: unknown; marks?: unknown };
    if (!isGuess(attempt.guess, answerLength) || !Array.isArray(attempt.marks) || attempt.marks.length !== answerLength || attempt.marks.some(mark => !isMark(mark))) {
      throw new Error("Invalid stored Cipher Grid attempt");
    }
    return { guess: attempt.guess, marks: [...attempt.marks] };
  });
}

export function markCipherGridGuess(answer: string, guess: string): CipherGridMark[] {
  if (!isGuess(answer) || !isGuess(guess, answer.length)) throw new Error("Invalid Cipher Grid guess");
  const marks = Array<CipherGridMark>(answer.length).fill("absent");
  const remaining = new Map<string, number>();
  for (let index = 0; index < answer.length; index++) {
    if (guess[index] === answer[index]) marks[index] = "correct";
    else remaining.set(answer[index], (remaining.get(answer[index]) ?? 0) + 1);
  }
  for (let index = 0; index < answer.length; index++) {
    if (marks[index] === "correct") continue;
    const available = remaining.get(guess[index]) ?? 0;
    if (available) {
      marks[index] = "present";
      remaining.set(guess[index], available - 1);
    }
  }
  return marks;
}

function gameView(row: CipherGridRow, now: number): CipherGridGame {
  if (!isGuess(row.answer)) throw new Error("Invalid stored Cipher Grid answer");
  const definition = definitionFor(row.answer);
  const attempts = parseAttempts(row.attempts_json, definition.answerLength);
  const legacyAttemptLimit = definition.difficulty === "field" && attempts.length > CIPHER_GRID_MAX_ATTEMPTS;
  const exhausted = row.status === "playing" && attempts.length >= definition.maxAttempts;
  const status = exhausted ? "failed" : row.status === "playing" && now >= row.started_at + CIPHER_GRID_TTL_MS ? "expired" : row.status;
  return {
    id: row.id,
    version: row.version,
    status,
    attempts,
    answerLength: definition.answerLength,
    maxAttempts: legacyAttemptLimit ? CIPHER_GRID_LEGACY_MAX_ATTEMPTS : definition.maxAttempts,
    difficulty: definition.difficulty,
    startedAt: row.started_at,
    expiresAt: row.started_at + CIPHER_GRID_TTL_MS,
  };
}

async function readCipherGrid(db: D1Database, user: SessionUser, now: number, specialistAvailable: boolean, rewardGranted = false): Promise<CipherGridPayload> {
  const game = await db.prepare("SELECT * FROM dzn_cipher_grid_sessions WHERE user_id = ?").bind(user.id).first<CipherGridRow>();
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_cipher_grid_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, dayKey(now)).first<{ rewarded: number }>();
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, rewardGranted, specialistAvailable, game: game ? gameView(game, now) : null };
}

export async function handleGamesCipherGrid(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "This request must come from DZN Network." }, 403);
  }
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to decode Cipher Grid." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true" || env.DZN_GAMES_CIPHER_GRID_ENABLED !== "true") {
      return reply({ error: "DZN Cipher Grid is not open yet." }, 404);
    }
    const db = requireDb(env);
    const now = Date.now();
    const specialistAvailable = env.DZN_GAMES_CIPHER_GRID_SPECIALIST_ENABLED === "true";
    if (request.method === "GET") return reply(await readCipherGrid(db, user, now, specialistAvailable));

    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024);
    if (!parsed.ok) return reply({ error: "Invalid Cipher Grid request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return reply({ error: "Invalid Cipher Grid request." }, 400);
    }

    let rewardGranted = false;
    if (body.action === "start") {
      if (Object.keys(body).length !== 1) return reply({ error: "Invalid Cipher Grid request." }, 400);
      const result = await db.prepare(`INSERT INTO dzn_cipher_grid_sessions
        (user_id, id, answer, attempts_json, status, version, started_at, updated_at)
        VALUES (?, ?, ?, '[]', 'playing', 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, answer = excluded.answer, attempts_json = '[]',
        status = 'playing', version = 0, started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_cipher_grid_sessions.started_at <= ?`)
        // Specialist answers are separately flag-gated because they require migration 0106.
        .bind(user.id, crypto.randomUUID(), chooseAnswer(specialistAvailable), now, now, now - START_COOLDOWN_MS).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before starting another decode." }, 429);
    } else if (body.action === "guess") {
      const keys = Object.keys(body);
      if (keys.length !== 4 || keys.some(key => !["action", "gameId", "version", "guess"].includes(key)) ||
        !isId(body.gameId) || !Number.isInteger(body.version) || typeof body.guess !== "string") {
        return reply({ error: "Enter the required field term." }, 400);
      }
      const row = await db.prepare("SELECT * FROM dzn_cipher_grid_sessions WHERE user_id = ?").bind(user.id).first<CipherGridRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This Cipher Grid decode is not available." }, 404);
      if (row.status !== "playing" || row.version !== body.version || now >= row.started_at + CIPHER_GRID_TTL_MS) {
        return reply({ error: "This decode changed or ended. Refresh to continue." }, 409);
      }
      if (!isGuess(row.answer)) throw new Error("Invalid stored Cipher Grid answer");
      const definition = definitionFor(row.answer);
      if (!isGuess(body.guess, definition.answerLength)) return reply({ error: `Enter a ${definition.answerLength}-letter field term.` }, 400);
      const attempts = parseAttempts(row.attempts_json, definition.answerLength);
      if (attempts.length >= definition.maxAttempts) return reply({ error: "This decode changed or ended. Refresh to continue." }, 409);
      const marks = markCipherGridGuess(row.answer, body.guess);
      const nextAttempts = [...attempts, { guess: body.guess, marks }];
      const status = body.guess === row.answer ? "won" : nextAttempts.length === definition.maxAttempts ? "failed" : "playing";
      const update = db.prepare(`UPDATE dzn_cipher_grid_sessions
        SET attempts_json = ?, status = ?, version = version + 1, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing'`)
        .bind(JSON.stringify(nextAttempts), status, now, user.id, row.id, row.version);
      const statements = [update];
      if (status === "won") {
        statements.push(db.prepare(`INSERT INTO dzn_cipher_grid_reward_ledger
          (id, user_id, reward_key, game_id, xp, parts, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
          ON CONFLICT(user_id, reward_key) DO NOTHING`)
          .bind(crypto.randomUUID(), user.id, dayKey(now), row.id, CIPHER_GRID_REWARD.xp, CIPHER_GRID_REWARD.parts, now));
      }
      const result = await db.batch(statements);
      if (!result[0].meta.changes) return reply({ error: "Another guess reached this decode first. Refresh to continue." }, 409);
      rewardGranted = status === "won" && Boolean(result[1]?.meta.changes);
    } else return reply({ error: "Unknown Cipher Grid action." }, 400);
    return reply(await readCipherGrid(db, user, now, specialistAvailable, rewardGranted));
  } catch {
    return reply({ error: "DZN Cipher Grid is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
