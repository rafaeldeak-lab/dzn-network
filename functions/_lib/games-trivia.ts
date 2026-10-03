import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import { questionById, TRIVIA_QUESTIONS } from "./games-trivia-questions";
import { TRIVIA_DIFFICULTIES, type TriviaDifficulty, type TriviaGameView, type TriviaPayload } from "../../lib/games-trivia";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const DAY = 86400000;
const TTL = 15 * 60 * 1000;
const isDifficulty = (value: unknown): value is TriviaDifficulty => typeof value === "string" && Object.hasOwn(TRIVIA_DIFFICULTIES, value);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
type TriviaRow = { user_id: string; id: string; difficulty: TriviaDifficulty; question_ids_json: string; current_index: number; correct_count: number; status: "playing" | "passed" | "failed"; version: number; started_at: number; updated_at: number };

export function triviaPresentation(question: { id: string; choices: readonly string[]; answer: number }, gameId: string) {
  const shift = [...`${gameId}:${question.id}`].reduce((total, character) => total + character.charCodeAt(0), 0) % question.choices.length;
  return {
    choices: question.choices.map((_, index) => question.choices[(index - shift + question.choices.length) % question.choices.length]),
    answer: (question.answer + shift) % question.choices.length,
  };
}

function chooseQuestions(difficulty: TriviaDifficulty) {
  const pool = TRIVIA_QUESTIONS.filter(question => question.difficulty === difficulty);
  const shuffled = [...pool];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.slice(0, 5).map(question => question.id);
}

function gameView(row: TriviaRow, now: number): TriviaGameView {
  const ids = JSON.parse(row.question_ids_json) as string[];
  const source = row.status === "playing" && now < row.started_at + TTL ? questionById.get(ids[row.current_index]) : null;
  const presentation = source ? triviaPresentation(source, row.id) : null;
  return {
    id: row.id,
    difficulty: row.difficulty,
    version: row.version,
    status: row.status === "playing" && now >= row.started_at + TTL ? "expired" : row.status,
    correct: row.correct_count,
    question: source && presentation ? { number: row.current_index + 1, total: ids.length, prompt: source.prompt, choices: presentation.choices } : null,
    startedAt: row.started_at,
    expiresAt: row.started_at + TTL,
  };
}

async function readTrivia(db: D1Database, user: SessionUser, now: number): Promise<TriviaPayload> {
  const row = await db.prepare("SELECT * FROM dzn_trivia_sessions WHERE user_id = ?").bind(user.id).first<TriviaRow>();
  const rewards = await db.prepare("SELECT difficulty FROM dzn_trivia_reward_ledger WHERE user_id = ? AND created_at >= ?")
    .bind(user.id, Math.floor(now / DAY) * DAY).all<{ difficulty: TriviaDifficulty }>();
  return { serverTime: now, game: row ? gameView(row, now) : null, rewardedToday: (rewards.results ?? []).map(item => item.difficulty) };
}

export async function handleGamesTrivia(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "This request must come from DZN Network." }, 403);
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to play DZN Trivia." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true" || env.DZN_GAMES_TRIVIA_ENABLED !== "true") return reply({ error: "DZN Trivia is not open yet." }, 404);
    const db = requireDb(env);
    const now = Date.now();
    if (request.method === "GET") return reply(await readTrivia(db, user, now));
    const parsed = await readBoundedJson<Record<string, unknown>>(request, 2048);
    if (!parsed.ok) return reply({ error: "Invalid trivia request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid trivia request." }, 400);

    if (body.action === "start") {
      if (!isDifficulty(body.difficulty)) return reply({ error: "Choose a valid difficulty." }, 400);
      const result = await db.prepare(`INSERT INTO dzn_trivia_sessions
        (user_id, id, difficulty, question_ids_json, current_index, correct_count, status, version, started_at, updated_at)
        VALUES (?, ?, ?, ?, 0, 0, 'playing', 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, difficulty = excluded.difficulty,
        question_ids_json = excluded.question_ids_json, current_index = 0, correct_count = 0,
        status = 'playing', version = 0, started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_trivia_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), body.difficulty, JSON.stringify(chooseQuestions(body.difficulty)), now, now, now - 5000).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before starting another round." }, 429);
    } else if (body.action === "answer") {
      if (!isId(body.gameId) || !Number.isInteger(body.version) || !Number.isInteger(body.answer) || Number(body.answer) < 0 || Number(body.answer) > 3) return reply({ error: "Choose one answer." }, 400);
      const row = await db.prepare("SELECT * FROM dzn_trivia_sessions WHERE user_id = ?").bind(user.id).first<TriviaRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This trivia round is not available." }, 404);
      if (row.status !== "playing" || row.version !== body.version || row.current_index >= 5 || now >= row.started_at + TTL) return reply({ error: "This round changed or ended. Refresh to continue." }, 409);
      const ids = JSON.parse(row.question_ids_json) as string[];
      const question = questionById.get(ids[row.current_index]);
      if (!question) throw new Error("Invalid stored trivia question");
      const correct = triviaPresentation(question, row.id).answer === body.answer ? 1 : 0;
      const final = row.current_index === ids.length - 1;
      const correctTotal = row.correct_count + correct;
      const nextStatus = final ? (correctTotal >= 4 ? "passed" : "failed") : "playing";
      const update = db.prepare(`UPDATE dzn_trivia_sessions SET current_index = current_index + 1,
        correct_count = correct_count + ?, status = ?, version = version + 1, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing'`)
        .bind(correct, nextStatus, now, user.id, row.id, row.version);
      const statements = [update];
      if (nextStatus === "passed") {
        const reward = TRIVIA_DIFFICULTIES[row.difficulty];
        statements.push(db.prepare(`INSERT INTO dzn_trivia_reward_ledger
          (id, user_id, reward_key, difficulty, game_id, xp, parts, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
          ON CONFLICT(user_id, reward_key) DO NOTHING`)
          .bind(crypto.randomUUID(), user.id, `${new Date(now).toISOString().slice(0, 10)}:${row.difficulty}`, row.difficulty, row.id, reward.xp, reward.parts, now));
      }
      const result = await db.batch(statements);
      if (!result[0].meta.changes) return reply({ error: "Another answer reached this round first. Refresh to continue." }, 409);
    } else return reply({ error: "Unknown trivia action." }, 400);
    return reply(await readTrivia(db, user, now));
  } catch {
    return reply({ error: "DZN Trivia is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
