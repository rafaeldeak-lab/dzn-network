import { getSessionUser, requireDb } from "./db";
import { moderateDznCommsBody } from "./dzn-comms-live";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import { WORD_CHAIN_DICTIONARY, WORD_CHAIN_SEEDS } from "./games-word-chain-dictionary";
import { WORD_CHAIN_REWARD, type WordChainPayload } from "../../lib/games-word-chain";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const normalizeWord = (value: unknown) => typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";

function seedForDay(id: string) {
  const score = [...id].reduce((total, value) => total + value.charCodeAt(0), 0);
  return WORD_CHAIN_SEEDS[score % WORD_CHAIN_SEEDS.length];
}

type RoundRow = { id: string; current_word: string; current_user_id: string | null; version: number; created_at: number; updated_at: number };

async function readRound(db: D1Database, user: SessionUser, now: number): Promise<WordChainPayload> {
  const id = dayKey(now);
  const seed = seedForDay(id);
  const row = await db.prepare("SELECT * FROM dzn_word_chain_rounds WHERE id = ?").bind(id).first<RoundRow>();
  const entries = row ? await db.prepare(`SELECT entries.id, entries.word, users.username AS player,
      entries.turn_number, entries.created_at
    FROM dzn_word_chain_entries AS entries JOIN users ON users.id = entries.user_id
    WHERE entries.round_id = ? ORDER BY entries.turn_number DESC LIMIT 12`).bind(id).all<{
      id: string; word: string; player: string; turn_number: number; created_at: number;
    }>() : { results: [] };
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_word_chain_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, id).first<{ rewarded: number }>();
  const currentWord = row?.current_word ?? seed;
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, round: {
    id, currentWord, requiredLetter: currentWord.at(-1)!, version: row?.version ?? 0,
    canPlay: row?.current_user_id !== user.id && (row?.version ?? 0) < 500,
    entries: (entries.results ?? []).map(entry => ({ id: entry.id, word: entry.word, player: entry.player,
      turn: entry.turn_number, createdAt: entry.created_at })),
  } };
}

export async function handleGamesWordChain(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "This request must come from DZN Network." }, 403);
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to play DZN Word Chain." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true" || env.DZN_GAMES_WORD_CHAIN_ENABLED !== "true") return reply({ error: "DZN Word Chain is not open yet." }, 404);
    const db = requireDb(env);
    const now = Date.now();
    if (request.method === "GET") return reply(await readRound(db, user, now));
    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024);
    if (!parsed.ok) return reply({ error: "Invalid Word Chain request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "play" ||
      Object.keys(body).length !== 4 || Object.keys(body).some(key => !["action", "roundId", "version", "word"].includes(key)) ||
      typeof body.roundId !== "string" || !Number.isInteger(body.version)) return reply({ error: "Invalid Word Chain request." }, 400);
    const word = normalizeWord(body.word);
    if (!/^[a-z]{3,18}$/.test(word)) return reply({ error: "Use one word with 3 to 18 letters." }, 400);
    if (!WORD_CHAIN_DICTIONARY.has(word)) return reply({ error: "That word is not in the DZN Word Chain dictionary." }, 422);
    if (moderateDznCommsBody(word).decision !== "allow") return reply({ error: "That word cannot be used." }, 422);
    const id = dayKey(now);
    if (body.roundId !== id || Number(body.version) < 0 || Number(body.version) > 500) return reply({ error: "The chain changed. Refresh to continue." }, 409);
    const seed = seedForDay(id);
    await db.prepare(`INSERT OR IGNORE INTO dzn_word_chain_rounds
      (id, current_word, current_user_id, version, created_at, updated_at) VALUES (?, ?, NULL, 0, ?, ?)`)
      .bind(id, seed, now, now).run();
    const round = await db.prepare("SELECT * FROM dzn_word_chain_rounds WHERE id = ?").bind(id).first<RoundRow>();
    if (!round || round.version !== body.version || round.version >= 500) return reply({ error: "The chain changed. Refresh to continue." }, 409);
    if (round.current_user_id === user.id) return reply({ error: "Another player must take the next turn." }, 409);
    if (!word.startsWith(round.current_word.at(-1)!)) return reply({ error: `The next word must start with ${round.current_word.at(-1)!.toUpperCase()}.` }, 422);
    const duplicate = await db.prepare("SELECT 1 AS used FROM dzn_word_chain_entries WHERE round_id = ? AND word = ?")
      .bind(id, word).first<{ used: number }>();
    if (word === seed || duplicate) return reply({ error: "That word has already been used today." }, 409);
    const recent = await db.prepare("SELECT created_at FROM dzn_word_chain_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(user.id).first<{ created_at: number }>();
    if (recent && recent.created_at > now - 5000) return reply({ error: "Wait a few seconds before taking another turn." }, 429);
    const entryId = crypto.randomUUID();
    try {
      const result = await db.batch([
        db.prepare(`UPDATE dzn_word_chain_rounds SET current_word = ?, current_user_id = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ? AND current_word = ? AND (current_user_id IS NULL OR current_user_id != ?)`)
          .bind(word, user.id, now, id, round.version, round.current_word, user.id),
        db.prepare(`INSERT INTO dzn_word_chain_entries (id, round_id, user_id, word, turn_number, created_at)
          SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1`).bind(entryId, id, user.id, word, round.version + 1, now),
        db.prepare(`INSERT INTO dzn_word_chain_reward_ledger (id, user_id, reward_key, round_id, entry_id, xp, parts, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
          ON CONFLICT(user_id, reward_key) DO NOTHING`)
          .bind(crypto.randomUUID(), user.id, id, id, entryId, WORD_CHAIN_REWARD.xp, WORD_CHAIN_REWARD.parts, now),
      ]);
      if (!result[0].meta.changes || !result[1].meta.changes) return reply({ error: "Another player reached the chain first. Refresh to continue." }, 409);
    } catch {
      return reply({ error: "Another player reached the chain first. Refresh to continue." }, 409);
    }
    return reply(await readRound(db, user, now));
  } catch {
    return reply({ error: "DZN Word Chain is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
