import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import { createGameBoard, gameView, GAME_TTL, moveGame, type GameRow } from "./games-hub-engine";
import { GAME_MODES, WORKSHOP_PART_COST, type GameMode, type HubPayload } from "../../lib/games-hub";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const DAY = 86400000;
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const isMode = (value: unknown): value is GameMode => typeof value === "string" && Object.hasOwn(GAME_MODES, value);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);

async function readGame(db: D1Database, userId: string) {
  return db.prepare("SELECT * FROM dzn_game_sessions WHERE user_id = ?").bind(userId).first<GameRow>();
}

async function availableRewardLedgers(db: D1Database) {
  const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name IN ('dzn_trivia_reward_ledger', 'dzn_word_chain_reward_ledger', 'dzn_hide_seek_reward_ledger')`).all<{ name: string }>();
  const names = new Set((rows.results ?? []).map(row => row.name));
  return { trivia: names.has("dzn_trivia_reward_ledger"), wordChain: names.has("dzn_word_chain_reward_ledger"),
    hideSeek: names.has("dzn_hide_seek_reward_ledger") };
}

type ExtraLedgers = { trivia: boolean; wordChain: boolean; hideSeek: boolean };

export async function readHub(db: D1Database, user: SessionUser, now: number,
  extraLedgers: ExtraLedgers = { trivia: false, wordChain: false, hideSeek: false }): Promise<HubPayload> {
  const totals = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
    COALESCE(SUM(CASE WHEN kind = 'workshop' THEN 1 ELSE 0 END), 0) AS assemblies
    FROM dzn_game_reward_ledger WHERE user_id = ?`).bind(user.id).first<{ xp: number; parts: number; assemblies: number }>();
  const today = await db.prepare(`SELECT kind FROM dzn_game_reward_ledger
    WHERE user_id = ? AND created_at >= ? AND kind != 'workshop'`).bind(user.id, Math.floor(now / DAY) * DAY).all<{ kind: GameMode }>();
  const baseDays = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
    FROM dzn_game_reward_ledger WHERE user_id = ? AND kind != 'workshop'`)
    .bind(DAY, user.id).all<{ day: number }>();
  const rewardDays = new Set((baseDays.results ?? []).map(row => row.day));
  const history = await db.prepare(`SELECT kind, xp, parts, created_at FROM dzn_game_reward_ledger
    WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`).bind(user.id).all<HubPayload["summary"]["history"][number]>();
  const extraTotals = { xp: 0, parts: 0 };
  const extraHistory: HubPayload["summary"]["history"] = [];
  if (extraLedgers.trivia) {
    const trivia = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts
      FROM dzn_trivia_reward_ledger WHERE user_id = ?`).bind(user.id).first<{ xp: number; parts: number }>();
    extraTotals.xp += trivia?.xp ?? 0; extraTotals.parts += trivia?.parts ?? 0;
    const entries = await db.prepare(`SELECT 'trivia:' || difficulty AS kind, xp, parts, created_at
      FROM dzn_trivia_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_trivia_reward_ledger WHERE user_id = ?`).bind(DAY, user.id).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.wordChain) {
    const wordChain = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts
      FROM dzn_word_chain_reward_ledger WHERE user_id = ?`).bind(user.id).first<{ xp: number; parts: number }>();
    extraTotals.xp += wordChain?.xp ?? 0; extraTotals.parts += wordChain?.parts ?? 0;
    const entries = await db.prepare(`SELECT 'word-chain' AS kind, xp, parts, created_at
      FROM dzn_word_chain_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_word_chain_reward_ledger WHERE user_id = ?`).bind(DAY, user.id).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.hideSeek) {
    const hideSeek = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts
      FROM dzn_hide_seek_reward_ledger WHERE user_id = ?`).bind(user.id).first<{ xp: number; parts: number }>();
    extraTotals.xp += hideSeek?.xp ?? 0; extraTotals.parts += hideSeek?.parts ?? 0;
    const entries = await db.prepare(`SELECT 'hide-seek' AS kind, xp, parts, created_at
      FROM dzn_hide_seek_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
  }
  const combinedHistory = [...(history.results ?? []), ...extraHistory]
    .sort((left, right) => right.created_at - left.created_at).slice(0, 12);
  const latestRewardDay = rewardDays.size ? Math.max(...rewardDays) : -1;
  let streak = 0;
  if (latestRewardDay >= Math.floor(now / DAY) - 1) {
    while (rewardDays.has(latestRewardDay - streak)) streak++;
  }
  const row = await readGame(db, user.id);
  return { serverTime: now, summary: { username: user.username, xp: (totals?.xp ?? 0) + extraTotals.xp, parts: (totals?.parts ?? 0) + extraTotals.parts,
    assemblies: totals?.assemblies ?? 0, streak, today: (today.results ?? []).map(item => item.kind),
    resetAt: (Math.floor(now / DAY) + 1) * DAY, history: combinedHistory }, game: row ? gameView(row, now) : null };
}

export async function handleGamesHub(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "This request must come from DZN Network." }, 403);
  }
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to enter the Games Hub." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true") return reply({ error: "The Games Hub is not open on this environment yet." }, 503);
    const db = requireDb(env);
    const now = Date.now();
    const extraLedgers = await availableRewardLedgers(db);
    if (request.method === "GET") return reply(await readHub(db, user, now, extraLedgers));
    const parsed = await readBoundedJson<Record<string, unknown>>(request, 2048);
    if (!parsed.ok) return reply({ error: "Invalid game request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid game request." }, 400);

    if (body.action === "start") {
      if (!isMode(body.mode)) return reply({ error: "Choose a valid difficulty." }, 400);
      const board = createGameBoard(body.mode);
      const result = await db.prepare(`INSERT INTO dzn_game_sessions
        (user_id, id, mode, board_json, status, version, started_at, updated_at) VALUES (?, ?, ?, ?, 'playing', 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, mode = excluded.mode, board_json = excluded.board_json,
        status = 'playing', version = 0, started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_game_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), body.mode, JSON.stringify(board), now, now, now - 5000).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before starting another board." }, 429);
    } else if (body.action === "move") {
      if (!isId(body.gameId) || !Number.isInteger(body.version) || !Number.isInteger(body.x) || !Number.isInteger(body.y)
        || !["reveal", "flag"].includes(String(body.tool))) return reply({ error: "Invalid move." }, 400);
      const row = await readGame(db, user.id);
      if (!row || row.id !== body.gameId) return reply({ error: "This board is not available." }, 404);
      if (row.status !== "playing" || now >= row.started_at + GAME_TTL || row.version !== body.version || row.version >= 2000) {
        return reply({ error: "The board changed or ended. Refresh to continue." }, 409);
      }
      const size = GAME_MODES[row.mode].size;
      const x = body.x as number, y = body.y as number;
      if (x < 0 || y < 0 || x >= size || y >= size) return reply({ error: "Choose a cell on the board." }, 400);
      const next = moveGame(row, x, y, body.tool as "reveal" | "flag");
      if (next) {
        const update = db.prepare(`UPDATE dzn_game_sessions SET board_json = ?, status = ?, version = version + 1, updated_at = ?
          WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing'`)
          .bind(JSON.stringify(next.board), next.status, now, user.id, row.id, row.version);
        const statements = [update];
        if (next.status === "won") {
          const rewards = GAME_MODES[row.mode];
          statements.push(db.prepare(`INSERT INTO dzn_game_reward_ledger (id, user_id, reward_key, kind, game_id, xp, parts, created_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM dzn_game_sessions
              WHERE user_id = ? AND id = ? AND version = ? AND status = 'won')
            ON CONFLICT(user_id, reward_key) DO NOTHING`)
            .bind(crypto.randomUUID(), user.id, `${dayKey(now)}:${row.mode}`, row.mode, row.id, rewards.xp, rewards.parts, now,
              user.id, row.id, row.version + 1));
        }
        // Persist the verified result and daily reward together; stale moves never overwrite a board.
        const result = await db.batch(statements);
        if (!result[0].meta.changes) return reply({ error: "Another move reached this board first. Refresh to continue." }, 409);
      }
    } else if (body.action === "assemble") {
      if (!isId(body.requestId)) return reply({ error: "Invalid assembly request." }, 400);
      const rewardKey = `workshop:${body.requestId}`;
      const extraPartQueries = [
        extraLedgers.trivia ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_trivia_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.wordChain ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_word_chain_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.hideSeek ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_hide_seek_reward_ledger WHERE user_id = ?)` : null,
      ].filter((value): value is string => Boolean(value));
      const availableParts = [`(SELECT COALESCE(SUM(parts), 0) FROM dzn_game_reward_ledger WHERE user_id = ?)`, ...extraPartQueries].join(" + ");
      const statement = db.prepare(`INSERT INTO dzn_game_reward_ledger (id, user_id, reward_key, kind, game_id, xp, parts, created_at)
        SELECT ?, ?, ?, 'workshop', NULL, 0, ?, ? WHERE
          (${availableParts}) >= ?
        ON CONFLICT(user_id, reward_key) DO NOTHING`);
      const bindings = [crypto.randomUUID(), user.id, rewardKey, -WORKSHOP_PART_COST, now, user.id,
        ...(extraLedgers.trivia ? [user.id] : []), ...(extraLedgers.wordChain ? [user.id] : []),
        ...(extraLedgers.hideSeek ? [user.id] : []), WORKSHOP_PART_COST];
      const result = await statement.bind(...bindings).run();
      if (!result.meta.changes) {
        const alreadyDone = await db.prepare("SELECT id FROM dzn_game_reward_ledger WHERE user_id = ? AND reward_key = ?")
          .bind(user.id, rewardKey).first();
        if (!alreadyDone) return reply({ error: "More parts are needed for this assembly." }, 409);
      }
    } else return reply({ error: "Unknown game action." }, 400);
    return reply(await readHub(db, user, now, extraLedgers));
  } catch {
    // Never return SQL, stored board state or session diagnostics to the browser.
    return reply({ error: "Games Hub is temporarily unavailable. Your saved progress has not been reset." }, 503);
  }
}
