import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import { HIDE_SEEK_TARGETS, HIDE_SEEK_TARGET_BY_ID } from "./games-hide-seek-targets";
import { HIDE_SEEK_MAX_MISSES, HIDE_SEEK_REWARD, type HideSeekGame, type HideSeekPayload } from "../../lib/games-hide-seek";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const TTL = 5 * 60 * 1000;
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
type HideSeekRow = { user_id: string; id: string; target_ids_json: string; found_ids_json: string; misses: number;
  status: "playing" | "won" | "failed"; version: number; started_at: number; updated_at: number };

function selectTargets() {
  const slots = [...HIDE_SEEK_TARGETS];
  for (let index = slots.length - 1; index > 0; index--) {
    const swap = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [slots[index], slots[swap]] = [slots[swap], slots[index]];
  }
  return slots.slice(0, 4).map(target => target.id);
}

function parseIds(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) throw new Error("Invalid stored target state");
  return parsed;
}

function gameView(row: HideSeekRow, now: number): HideSeekGame {
  const targetIds = parseIds(row.target_ids_json);
  const found = new Set(parseIds(row.found_ids_json));
  const status = row.status === "playing" && now >= row.started_at + TTL ? "expired" : row.status;
  return { id: row.id, version: row.version, status, foundCount: found.size, misses: row.misses,
    maxMisses: HIDE_SEEK_MAX_MISSES, startedAt: row.started_at, expiresAt: row.started_at + TTL,
    targets: targetIds.map(id => { const target = HIDE_SEEK_TARGET_BY_ID.get(id); if (!target) throw new Error("Invalid stored target");
      return { ...target, found: found.has(id) }; }) };
}

async function readState(db: D1Database, user: SessionUser, now: number): Promise<HideSeekPayload> {
  const row = await db.prepare("SELECT * FROM dzn_hide_seek_sessions WHERE user_id = ?").bind(user.id).first<HideSeekRow>();
  const reward = await db.prepare("SELECT 1 AS rewarded FROM dzn_hide_seek_reward_ledger WHERE user_id = ? AND reward_key = ?")
    .bind(user.id, dayKey(now)).first<{ rewarded: number }>();
  return { serverTime: now, rewardedToday: reward?.rewarded === 1, game: row ? gameView(row, now) : null };
}

export async function handleGamesHideSeek(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "This request must come from DZN Network." }, 403);
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to play DZN Signal Hunt." }, 401);
    if (env.DZN_GAMES_HUB_ENABLED !== "true" || env.DZN_GAMES_HIDE_SEEK_ENABLED !== "true") return reply({ error: "DZN Signal Hunt is not open yet." }, 404);
    const db = requireDb(env);
    const now = Date.now();
    if (request.method === "GET") return reply(await readState(db, user, now));
    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024);
    if (!parsed.ok) return reply({ error: "Invalid Signal Hunt request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") return reply({ error: "Invalid Signal Hunt request." }, 400);

    if (body.action === "start") {
      if (Object.keys(body).length !== 1) return reply({ error: "Invalid Signal Hunt request." }, 400);
      const result = await db.prepare(`INSERT INTO dzn_hide_seek_sessions
        (user_id, id, target_ids_json, found_ids_json, misses, status, version, started_at, updated_at)
        VALUES (?, ?, ?, '[]', 0, 'playing', 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, target_ids_json = excluded.target_ids_json,
        found_ids_json = '[]', misses = 0, status = 'playing', version = 0,
        started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_hide_seek_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), JSON.stringify(selectTargets()), now, now, now - 5000).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before starting another hunt." }, 429);
    } else if (body.action === "scan") {
      if (Object.keys(body).length !== 5 || Object.keys(body).some(key => !["action", "gameId", "version", "x", "y"].includes(key)) ||
        !isId(body.gameId) || !Number.isInteger(body.version) || !Number.isInteger(body.x) || !Number.isInteger(body.y) ||
        Number(body.x) < 0 || Number(body.x) > 1000 || Number(body.y) < 0 || Number(body.y) > 1000) return reply({ error: "Choose a point inside the scene." }, 400);
      const row = await db.prepare("SELECT * FROM dzn_hide_seek_sessions WHERE user_id = ?").bind(user.id).first<HideSeekRow>();
      if (!row || row.id !== body.gameId) return reply({ error: "This hunt is not available." }, 404);
      if (row.status !== "playing" || row.version !== body.version || now >= row.started_at + TTL) return reply({ error: "This hunt changed or ended. Refresh to continue." }, 409);
      const targets = parseIds(row.target_ids_json);
      const found = new Set(parseIds(row.found_ids_json));
      const hit = targets.map(id => HIDE_SEEK_TARGET_BY_ID.get(id)).find(target => target && !found.has(target.id)
        && Math.hypot(target.x - Number(body.x), target.y - Number(body.y)) <= 45);
      if (hit) found.add(hit.id);
      const misses = row.misses + (hit ? 0 : 1);
      const status = found.size === targets.length ? "won" : misses >= HIDE_SEEK_MAX_MISSES ? "failed" : "playing";
      const update = db.prepare(`UPDATE dzn_hide_seek_sessions SET found_ids_json = ?, misses = ?, status = ?, version = version + 1, updated_at = ?
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing'`)
        .bind(JSON.stringify([...found]), misses, status, now, user.id, row.id, row.version);
      const statements = [update];
      if (status === "won") statements.push(db.prepare(`INSERT INTO dzn_hide_seek_reward_ledger
        (id, user_id, reward_key, game_id, xp, parts, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
        ON CONFLICT(user_id, reward_key) DO NOTHING`).bind(crypto.randomUUID(), user.id, dayKey(now), row.id,
          HIDE_SEEK_REWARD.xp, HIDE_SEEK_REWARD.parts, now));
      const result = await db.batch(statements);
      if (!result[0].meta.changes) return reply({ error: "Another scan reached this hunt first. Refresh to continue." }, 409);
    } else return reply({ error: "Unknown Signal Hunt action." }, 400);
    return reply(await readState(db, user, now));
  } catch {
    return reply({ error: "DZN Signal Hunt is temporarily unavailable. Your Hub progress is unchanged." }, 503);
  }
}
