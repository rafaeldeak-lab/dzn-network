import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";
import { createGameState, gameView, GAME_TTL, moveGame, scanGame, serializeGameState, type GameRow } from "./games-hub-engine";
import { DEFAULT_HUB_GAME_AVAILABILITY, GAME_MODES, WORKSHOP_PART_COST, type GameMode, type HubGameAvailability, type HubPayload } from "../../lib/games-hub";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const DAY = 86400000;
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const isMode = (value: unknown): value is GameMode => typeof value === "string" && Object.hasOwn(GAME_MODES, value);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);

async function readGame(db: D1Database, userId: string) {
  return db.prepare("SELECT * FROM dzn_game_sessions WHERE user_id = ?").bind(userId).first<GameRow>();
}

async function availableGameSchemas(db: D1Database) {
  const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name IN ('dzn_trivia_sessions', 'dzn_trivia_reward_ledger', 'dzn_word_chain_rounds', 'dzn_word_chain_entries', 'dzn_word_chain_reward_ledger',
      'dzn_hide_seek_sessions', 'dzn_hide_seek_reward_ledger', 'dzn_relay_rush_sessions', 'dzn_relay_rush_reward_ledger',
      'dzn_cipher_grid_sessions', 'dzn_cipher_grid_reward_ledger', 'dzn_echo_array_sessions', 'dzn_echo_array_reward_ledger',
      'dzn_outpost_run_sessions', 'dzn_outpost_run_reward_ledger', 'dzn_signal_shift_sessions', 'dzn_signal_shift_reward_ledger',
      'dzn_circuit_forge_sessions', 'dzn_circuit_forge_reward_ledger', 'dzn_ranger_range_sessions', 'dzn_ranger_range_reward_ledger',
      'dzn_night_run_sessions', 'dzn_night_run_reward_ledger', 'dzn_command_centre_spend_ledger')`).all<{ name: string }>();
  const names = new Set((rows.results ?? []).map(row => row.name));
  const complete = (...tables: string[]) => tables.every(table => names.has(table));
  return { trivia: complete("dzn_trivia_sessions", "dzn_trivia_reward_ledger"), wordChain: complete("dzn_word_chain_rounds", "dzn_word_chain_entries", "dzn_word_chain_reward_ledger"),
    hideSeek: complete("dzn_hide_seek_sessions", "dzn_hide_seek_reward_ledger"), relayRush: complete("dzn_relay_rush_sessions", "dzn_relay_rush_reward_ledger"),
    cipherGrid: complete("dzn_cipher_grid_sessions", "dzn_cipher_grid_reward_ledger"), echoArray: complete("dzn_echo_array_sessions", "dzn_echo_array_reward_ledger"),
    outpostRun: complete("dzn_outpost_run_sessions", "dzn_outpost_run_reward_ledger"), signalShift: complete("dzn_signal_shift_sessions", "dzn_signal_shift_reward_ledger"),
    circuitForge: complete("dzn_circuit_forge_sessions", "dzn_circuit_forge_reward_ledger"),
    rangerRange: complete("dzn_ranger_range_sessions", "dzn_ranger_range_reward_ledger"),
    nightRun: complete("dzn_night_run_sessions", "dzn_night_run_reward_ledger"),
    commandCentreSpending: names.has("dzn_command_centre_spend_ledger") };
}

type ExtraLedgers = { trivia: boolean; wordChain: boolean; hideSeek: boolean; relayRush: boolean; cipherGrid: boolean; echoArray: boolean; outpostRun: boolean; signalShift: boolean; circuitForge: boolean; rangerRange: boolean; nightRun: boolean; commandCentreSpending: boolean };

function enabledGames(env: Env, schemas: ExtraLedgers): HubGameAvailability {
  const hubEnabled = env.DZN_GAMES_HUB_ENABLED === "true";
  return {
    minefield: hubEnabled,
    trivia: hubEnabled && schemas.trivia && env.DZN_GAMES_TRIVIA_ENABLED === "true",
    "word-chain": hubEnabled && schemas.wordChain && env.DZN_GAMES_WORD_CHAIN_ENABLED === "true",
    "hide-seek": hubEnabled && schemas.hideSeek && env.DZN_GAMES_HIDE_SEEK_ENABLED === "true",
    "relay-rush": hubEnabled && schemas.relayRush && env.DZN_GAMES_RELAY_RUSH_ENABLED === "true",
    "cipher-grid": hubEnabled && schemas.cipherGrid && env.DZN_GAMES_CIPHER_GRID_ENABLED === "true",
    "echo-array": hubEnabled && schemas.echoArray && env.DZN_GAMES_ECHO_ARRAY_ENABLED === "true",
    "outpost-run": hubEnabled && schemas.outpostRun && env.DZN_GAMES_OUTPOST_RUN_ENABLED === "true",
    "signal-shift": hubEnabled && schemas.signalShift && env.DZN_GAMES_SIGNAL_SHIFT_ENABLED === "true",
    "circuit-forge": hubEnabled && schemas.circuitForge && env.DZN_GAMES_CIRCUIT_FORGE_ENABLED === "true",
    "ranger-range": hubEnabled && schemas.rangerRange && env.DZN_GAMES_RANGER_RANGE_ENABLED === "true",
    "night-run": hubEnabled && schemas.nightRun && env.DZN_GAMES_NIGHT_RUN_ENABLED === "true",
  };
}

export async function readHub(db: D1Database, user: SessionUser, now: number,
  extraLedgers: ExtraLedgers = { trivia: false, wordChain: false, hideSeek: false, relayRush: false, cipherGrid: false, echoArray: false, outpostRun: false, signalShift: false, circuitForge: false, rangerRange: false, nightRun: false, commandCentreSpending: false },
  availableGames: HubGameAvailability = DEFAULT_HUB_GAME_AVAILABILITY): Promise<HubPayload> {
  const dayStart = Math.floor(now / DAY) * DAY;
  const rollingWeekStart = now - 7 * DAY;
  const totals = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
    COALESCE(SUM(CASE WHEN kind = 'workshop' THEN 1 ELSE 0 END), 0) AS assemblies,
    COALESCE(SUM(CASE WHEN kind != 'workshop' AND created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
    COALESCE(SUM(CASE WHEN kind != 'workshop' AND created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
    MIN(CASE WHEN kind != 'workshop' AND created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
    FROM dzn_game_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
    .first<{ xp: number; parts: number; assemblies: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
  const today = await db.prepare(`SELECT kind FROM dzn_game_reward_ledger
    WHERE user_id = ? AND created_at BETWEEN ? AND ? AND kind != 'workshop'`).bind(user.id, dayStart, now).all<{ kind: GameMode }>();
  const baseDays = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
    FROM dzn_game_reward_ledger WHERE user_id = ? AND kind != 'workshop' AND created_at <= ?`)
    .bind(DAY, user.id, now).all<{ day: number }>();
  const rewardDays = new Set((baseDays.results ?? []).map(row => row.day));
  const history = await db.prepare(`SELECT kind, xp, parts, created_at FROM dzn_game_reward_ledger
    WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`).bind(user.id).all<HubPayload["summary"]["history"][number]>();
  const extraTotals = { xp: 0, parts: 0 };
  const challengeTotals = { dailyRewards: totals?.daily_rewards ?? 0, weeklyXp: totals?.weekly_xp ?? 0 };
  const weeklyOldest = [totals?.weekly_oldest ?? null];
  const extraHistory: HubPayload["summary"]["history"] = [];
  if (extraLedgers.trivia) {
    const trivia = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
      COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
      COALESCE(SUM(CASE WHEN created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
      MIN(CASE WHEN created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
      FROM dzn_trivia_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
      .first<{ xp: number; parts: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
    extraTotals.xp += trivia?.xp ?? 0; extraTotals.parts += trivia?.parts ?? 0;
    challengeTotals.dailyRewards += trivia?.daily_rewards ?? 0; challengeTotals.weeklyXp += trivia?.weekly_xp ?? 0;
    weeklyOldest.push(trivia?.weekly_oldest ?? null);
    const entries = await db.prepare(`SELECT 'trivia:' || difficulty AS kind, xp, parts, created_at
      FROM dzn_trivia_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_trivia_reward_ledger WHERE user_id = ? AND created_at <= ?`).bind(DAY, user.id, now).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.wordChain) {
    const wordChain = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
      COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
      COALESCE(SUM(CASE WHEN created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
      MIN(CASE WHEN created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
      FROM dzn_word_chain_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
      .first<{ xp: number; parts: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
    extraTotals.xp += wordChain?.xp ?? 0; extraTotals.parts += wordChain?.parts ?? 0;
    challengeTotals.dailyRewards += wordChain?.daily_rewards ?? 0; challengeTotals.weeklyXp += wordChain?.weekly_xp ?? 0;
    weeklyOldest.push(wordChain?.weekly_oldest ?? null);
    const entries = await db.prepare(`SELECT 'word-chain' AS kind, xp, parts, created_at
      FROM dzn_word_chain_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_word_chain_reward_ledger WHERE user_id = ? AND created_at <= ?`).bind(DAY, user.id, now).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.hideSeek) {
    const hideSeek = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
      COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
      COALESCE(SUM(CASE WHEN created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
      MIN(CASE WHEN created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
      FROM dzn_hide_seek_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
      .first<{ xp: number; parts: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
    extraTotals.xp += hideSeek?.xp ?? 0; extraTotals.parts += hideSeek?.parts ?? 0;
    challengeTotals.dailyRewards += hideSeek?.daily_rewards ?? 0; challengeTotals.weeklyXp += hideSeek?.weekly_xp ?? 0;
    weeklyOldest.push(hideSeek?.weekly_oldest ?? null);
    const entries = await db.prepare(`SELECT 'hide-seek' AS kind, xp, parts, created_at
      FROM dzn_hide_seek_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_hide_seek_reward_ledger WHERE user_id = ? AND created_at <= ?`).bind(DAY, user.id, now).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.relayRush) {
    const relayRush = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
      COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
      COALESCE(SUM(CASE WHEN created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
      MIN(CASE WHEN created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
      FROM dzn_relay_rush_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
      .first<{ xp: number; parts: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
    extraTotals.xp += relayRush?.xp ?? 0; extraTotals.parts += relayRush?.parts ?? 0;
    challengeTotals.dailyRewards += relayRush?.daily_rewards ?? 0; challengeTotals.weeklyXp += relayRush?.weekly_xp ?? 0;
    weeklyOldest.push(relayRush?.weekly_oldest ?? null);
    const entries = await db.prepare(`SELECT 'relay-rush' AS kind, xp, parts, created_at
      FROM dzn_relay_rush_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_relay_rush_reward_ledger WHERE user_id = ? AND created_at <= ?`).bind(DAY, user.id, now).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.cipherGrid) {
    const cipherGrid = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
      COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
      COALESCE(SUM(CASE WHEN created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
      MIN(CASE WHEN created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
      FROM dzn_cipher_grid_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
      .first<{ xp: number; parts: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
    extraTotals.xp += cipherGrid?.xp ?? 0; extraTotals.parts += cipherGrid?.parts ?? 0;
    challengeTotals.dailyRewards += cipherGrid?.daily_rewards ?? 0; challengeTotals.weeklyXp += cipherGrid?.weekly_xp ?? 0;
    weeklyOldest.push(cipherGrid?.weekly_oldest ?? null);
    const entries = await db.prepare(`SELECT 'cipher-grid' AS kind, xp, parts, created_at
      FROM dzn_cipher_grid_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_cipher_grid_reward_ledger WHERE user_id = ? AND created_at <= ?`).bind(DAY, user.id, now).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.echoArray) {
    const echoArray = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
      COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
      COALESCE(SUM(CASE WHEN created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
      MIN(CASE WHEN created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
      FROM dzn_echo_array_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
      .first<{ xp: number; parts: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
    extraTotals.xp += echoArray?.xp ?? 0; extraTotals.parts += echoArray?.parts ?? 0;
    challengeTotals.dailyRewards += echoArray?.daily_rewards ?? 0; challengeTotals.weeklyXp += echoArray?.weekly_xp ?? 0;
    weeklyOldest.push(echoArray?.weekly_oldest ?? null);
    const entries = await db.prepare(`SELECT 'echo-array' AS kind, xp, parts, created_at
      FROM dzn_echo_array_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_echo_array_reward_ledger WHERE user_id = ? AND created_at <= ?`).bind(DAY, user.id, now).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.outpostRun) {
    const outpostRun = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
      COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
      COALESCE(SUM(CASE WHEN created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
      MIN(CASE WHEN created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
      FROM dzn_outpost_run_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
      .first<{ xp: number; parts: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
    extraTotals.xp += outpostRun?.xp ?? 0; extraTotals.parts += outpostRun?.parts ?? 0;
    challengeTotals.dailyRewards += outpostRun?.daily_rewards ?? 0; challengeTotals.weeklyXp += outpostRun?.weekly_xp ?? 0;
    weeklyOldest.push(outpostRun?.weekly_oldest ?? null);
    const entries = await db.prepare(`SELECT 'outpost-run' AS kind, xp, parts, created_at
      FROM dzn_outpost_run_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_outpost_run_reward_ledger WHERE user_id = ? AND created_at <= ?`).bind(DAY, user.id, now).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.signalShift) {
    const signalShift = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
      COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
      COALESCE(SUM(CASE WHEN created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
      MIN(CASE WHEN created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
      FROM dzn_signal_shift_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
      .first<{ xp: number; parts: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
    extraTotals.xp += signalShift?.xp ?? 0; extraTotals.parts += signalShift?.parts ?? 0;
    challengeTotals.dailyRewards += signalShift?.daily_rewards ?? 0; challengeTotals.weeklyXp += signalShift?.weekly_xp ?? 0;
    weeklyOldest.push(signalShift?.weekly_oldest ?? null);
    const entries = await db.prepare(`SELECT 'signal-shift' AS kind, xp, parts, created_at
      FROM dzn_signal_shift_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_signal_shift_reward_ledger WHERE user_id = ? AND created_at <= ?`).bind(DAY, user.id, now).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.circuitForge) {
    const circuitForge = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
      COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
      COALESCE(SUM(CASE WHEN created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
      MIN(CASE WHEN created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
      FROM dzn_circuit_forge_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
      .first<{ xp: number; parts: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
    extraTotals.xp += circuitForge?.xp ?? 0; extraTotals.parts += circuitForge?.parts ?? 0;
    challengeTotals.dailyRewards += circuitForge?.daily_rewards ?? 0; challengeTotals.weeklyXp += circuitForge?.weekly_xp ?? 0;
    weeklyOldest.push(circuitForge?.weekly_oldest ?? null);
    const entries = await db.prepare(`SELECT 'circuit-forge' AS kind, xp, parts, created_at
      FROM dzn_circuit_forge_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_circuit_forge_reward_ledger WHERE user_id = ? AND created_at <= ?`).bind(DAY, user.id, now).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.rangerRange) {
    const rangerRange = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
      COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
      COALESCE(SUM(CASE WHEN created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
      MIN(CASE WHEN created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
      FROM dzn_ranger_range_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
      .first<{ xp: number; parts: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
    extraTotals.xp += rangerRange?.xp ?? 0; extraTotals.parts += rangerRange?.parts ?? 0;
    challengeTotals.dailyRewards += rangerRange?.daily_rewards ?? 0; challengeTotals.weeklyXp += rangerRange?.weekly_xp ?? 0;
    weeklyOldest.push(rangerRange?.weekly_oldest ?? null);
    const entries = await db.prepare(`SELECT 'ranger-range' AS kind, xp, parts, created_at
      FROM dzn_ranger_range_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_ranger_range_reward_ledger WHERE user_id = ? AND created_at <= ?`).bind(DAY, user.id, now).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  if (extraLedgers.nightRun) {
    const nightRun = await db.prepare(`SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(parts), 0) AS parts,
      COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS daily_rewards,
      COALESCE(SUM(CASE WHEN created_at > ? AND created_at <= ? THEN xp ELSE 0 END), 0) AS weekly_xp,
      MIN(CASE WHEN created_at > ? AND created_at <= ? THEN created_at END) AS weekly_oldest
      FROM dzn_night_run_reward_ledger WHERE user_id = ?`).bind(dayStart, now, rollingWeekStart, now, rollingWeekStart, now, user.id)
      .first<{ xp: number; parts: number; daily_rewards: number; weekly_xp: number; weekly_oldest: number | null }>();
    extraTotals.xp += nightRun?.xp ?? 0; extraTotals.parts += nightRun?.parts ?? 0;
    challengeTotals.dailyRewards += nightRun?.daily_rewards ?? 0; challengeTotals.weeklyXp += nightRun?.weekly_xp ?? 0;
    weeklyOldest.push(nightRun?.weekly_oldest ?? null);
    const entries = await db.prepare(`SELECT 'night-run' AS kind, xp, parts, created_at
      FROM dzn_night_run_reward_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`)
      .bind(user.id).all<HubPayload["summary"]["history"][number]>();
    extraHistory.push(...(entries.results ?? []));
    const days = await db.prepare(`SELECT DISTINCT CAST(created_at / ? AS INTEGER) AS day
      FROM dzn_night_run_reward_ledger WHERE user_id = ? AND created_at <= ?`).bind(DAY, user.id, now).all<{ day: number }>();
    for (const row of days.results ?? []) rewardDays.add(row.day);
  }
  const combinedHistory = [...(history.results ?? []), ...extraHistory]
    .sort((left, right) => right.created_at - left.created_at).slice(0, 12);
  const latestRewardDay = rewardDays.size ? Math.max(...rewardDays) : -1;
  let streak = 0;
  if (latestRewardDay >= Math.floor(now / DAY) - 1) {
    while (rewardDays.has(latestRewardDay - streak)) streak++;
  }
  const oldestActiveWeeklyReward = weeklyOldest.filter((value): value is number => value !== null)
    .reduce<number | null>((oldest, value) => oldest === null || value < oldest ? value : oldest, null);
  const commandCentreCommittedParts = extraLedgers.commandCentreSpending
    ? (await db.prepare("SELECT COALESCE(SUM(parts_spent), 0) AS parts FROM dzn_command_centre_spend_ledger WHERE user_id = ?")
      .bind(user.id).first<{ parts: number }>())?.parts ?? 0
    : 0;
  const row = await readGame(db, user.id);
  return { serverTime: now, summary: { username: user.username, xp: (totals?.xp ?? 0) + extraTotals.xp,
    parts: Math.max(0, (totals?.parts ?? 0) + extraTotals.parts - commandCentreCommittedParts),
    assemblies: totals?.assemblies ?? 0, streak, today: (today.results ?? []).map(item => item.kind),
    challenges: { ...challengeTotals, streak, weeklyExpiresAt: oldestActiveWeeklyReward === null ? null : oldestActiveWeeklyReward + 7 * DAY },
    resetAt: (Math.floor(now / DAY) + 1) * DAY, history: combinedHistory },
    game: row ? gameView(row, now) : null, availableGames };
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
    const extraLedgers = await availableGameSchemas(db);
    const availableGames = enabledGames(env, extraLedgers);
    if (request.method === "GET") return reply(await readHub(db, user, now, extraLedgers, availableGames));
    const parsed = await readBoundedJson<Record<string, unknown>>(request, 2048);
    if (!parsed.ok) return reply({ error: "Invalid game request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid game request." }, 400);

    if (body.action === "start") {
      if (!isMode(body.mode)) return reply({ error: "Choose a valid difficulty." }, 400);
      const state = createGameState(body.mode);
      const result = await db.prepare(`INSERT INTO dzn_game_sessions
        (user_id, id, mode, board_json, status, version, started_at, updated_at) VALUES (?, ?, ?, ?, 'playing', 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, mode = excluded.mode, board_json = excluded.board_json,
        status = 'playing', version = 0, started_at = excluded.started_at, updated_at = excluded.updated_at
        WHERE dzn_game_sessions.started_at <= ?`)
        .bind(user.id, crypto.randomUUID(), body.mode, serializeGameState(state), now, now, now - 5000).run();
      if (!result.meta.changes) return reply({ error: "Wait a few seconds before starting another board." }, 429);
    } else if (body.action === "move" || body.action === "scan") {
      const scanning = body.action === "scan";
      if (!isId(body.gameId) || !Number.isInteger(body.version) || !Number.isInteger(body.x) || !Number.isInteger(body.y)
        || (!scanning && !["reveal", "flag"].includes(String(body.tool)))) return reply({ error: scanning ? "Invalid scanner target." : "Invalid move." }, 400);
      const row = await readGame(db, user.id);
      if (!row || row.id !== body.gameId) return reply({ error: "This board is not available." }, 404);
      if (row.status !== "playing" || now >= row.started_at + GAME_TTL || row.version !== body.version || row.version >= 2000) {
        return reply({ error: "The board changed or ended. Refresh to continue." }, 409);
      }
      const size = GAME_MODES[row.mode].size;
      const x = body.x as number, y = body.y as number;
      if (x < 0 || y < 0 || x >= size || y >= size) return reply({ error: "Choose a cell on the board." }, 400);
      const next = scanning ? scanGame(row, x, y) : moveGame(row, x, y, body.tool as "reveal" | "flag");
      if (next) {
        const update = db.prepare(`UPDATE dzn_game_sessions SET board_json = ?, status = ?, version = version + 1, updated_at = ?
          WHERE user_id = ? AND id = ? AND version = ? AND status = 'playing'`)
          .bind(serializeGameState(next.state), next.status, now, user.id, row.id, row.version);
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
      } else return reply({ error: scanning ? "That sector cannot be scanned again." : "That move is no longer available." }, 409);
    } else if (body.action === "assemble") {
      if (!isId(body.requestId)) return reply({ error: "Invalid assembly request." }, 400);
      const rewardKey = `workshop:${body.requestId}`;
      const extraPartQueries = [
        extraLedgers.trivia ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_trivia_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.wordChain ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_word_chain_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.hideSeek ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_hide_seek_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.relayRush ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_relay_rush_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.cipherGrid ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_cipher_grid_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.echoArray ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_echo_array_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.outpostRun ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_outpost_run_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.signalShift ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_signal_shift_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.circuitForge ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_circuit_forge_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.rangerRange ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_ranger_range_reward_ledger WHERE user_id = ?)` : null,
        extraLedgers.nightRun ? `(SELECT COALESCE(SUM(parts), 0) FROM dzn_night_run_reward_ledger WHERE user_id = ?)` : null,
      ].filter((value): value is string => Boolean(value));
      const availableParts = `(${[`(SELECT COALESCE(SUM(parts), 0) FROM dzn_game_reward_ledger WHERE user_id = ?)`, ...extraPartQueries].join(" + ")})${extraLedgers.commandCentreSpending
        ? " - (SELECT COALESCE(SUM(parts_spent), 0) FROM dzn_command_centre_spend_ledger WHERE user_id = ?)" : ""}`;
      const statement = db.prepare(`INSERT INTO dzn_game_reward_ledger (id, user_id, reward_key, kind, game_id, xp, parts, created_at)
        SELECT ?, ?, ?, 'workshop', NULL, 0, ?, ? WHERE
          (${availableParts}) >= ?
        ON CONFLICT(user_id, reward_key) DO NOTHING`);
      const bindings = [crypto.randomUUID(), user.id, rewardKey, -WORKSHOP_PART_COST, now, user.id,
        ...(extraLedgers.trivia ? [user.id] : []), ...(extraLedgers.wordChain ? [user.id] : []),
        ...(extraLedgers.hideSeek ? [user.id] : []), ...(extraLedgers.relayRush ? [user.id] : []),
        ...(extraLedgers.cipherGrid ? [user.id] : []), ...(extraLedgers.echoArray ? [user.id] : []),
        ...(extraLedgers.outpostRun ? [user.id] : []), ...(extraLedgers.signalShift ? [user.id] : []),
        ...(extraLedgers.circuitForge ? [user.id] : []), ...(extraLedgers.rangerRange ? [user.id] : []),
        ...(extraLedgers.nightRun ? [user.id] : []), ...(extraLedgers.commandCentreSpending ? [user.id] : []), WORKSHOP_PART_COST];
      const result = await statement.bind(...bindings).run();
      if (!result.meta.changes) {
        const alreadyDone = await db.prepare("SELECT id FROM dzn_game_reward_ledger WHERE user_id = ? AND reward_key = ?")
          .bind(user.id, rewardKey).first();
        if (!alreadyDone) return reply({ error: "More parts are needed for this assembly." }, 409);
      }
    } else return reply({ error: "Unknown game action." }, 400);
    return reply(await readHub(db, user, now, extraLedgers, availableGames));
  } catch {
    // Never return SQL, stored board state or session diagnostics to the browser.
    return reply({ error: "Games Hub is temporarily unavailable. Your saved progress has not been reset." }, 503);
  }
}
