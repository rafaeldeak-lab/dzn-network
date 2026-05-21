import { requireDb } from "./db";
import { normalizePlanKey, type PlanKey } from "./plans";
import type { Env } from "./types";

export type CtfTournamentPhase = "PRE_WAR_ROSTER" | "WAR_PREP_CONFIG" | "BATTLE_ACTIVE" | "CONCLUDED";
export type CtfTargetMetric = "KILLS" | "BUILDING";
export type CtfTrackedEventType = "KILL" | "SUICIDE" | "CONNECT" | "DISCONNECT" | "BUILD_PLACEMENT";

export type CtfLogEvent = {
  eventHash: string;
  linkedServerId: string;
  occurredAt: string;
  eventType: CtfTrackedEventType;
  playerAName: string;
  playerAId: string;
  playerBName?: string | null;
  playerBId?: string | null;
  weapon?: string | null;
  distance?: number | null;
};

type CtfTournamentRow = {
  id: string;
  tournament_name: string;
  current_phase: CtfTournamentPhase;
  phase_ends_at: string;
  target_metric: CtfTargetMetric;
  target_flag_points: number;
  broadcast_interval_minutes: number;
  grace_period_config: string | null;
};

type BotConfigRow = {
  linked_server_id: string;
  server_name: string | null;
  guild_id: string | null;
  tournament_channel_id: string | null;
  bot_access_token: string | null;
};

type ScorecardTeamRow = {
  linked_server_id: string;
  server_name: string | null;
  accumulated_points: number | null;
  has_raised_flag: number | null;
  last_broadcasted_at: string | null;
  tournament_channel_id: string | null;
  bot_access_token: string | null;
};

const STRICT_MATCHMAKING_PLANS: PlanKey[] = ["pro", "partner"];
const DEFAULT_APP_URL = "https://dzn-network.pages.dev";
let ctfAuditLogsPrinted = false;

export async function ensureCtfTournamentSchema(env: Env) {
  const db = requireDb(env);
  await ensureColumns(db, "linked_servers", {
    bot_access_token: "TEXT",
    tournament_channel_id: "TEXT",
    bot_installed_at: "TEXT",
    is_searching_for_match: "INTEGER NOT NULL DEFAULT 0",
    matchmaking_opt_in_at: "TEXT",
    dynamic_visibility_score: "INTEGER NOT NULL DEFAULT 0",
  });
  await ensureColumns(db, "kill_events", { event_hash: "TEXT" });
  await ensureColumns(db, "player_events", { event_hash: "TEXT" });
  await ensureColumns(db, "sessions", { session_hash: "TEXT" });
  for (const statement of CTF_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
  logCtfAuditReadiness();
}

export async function saveBotOnboardingConfig(env: Env, input: {
  linkedServerId: string;
  discordGuildId?: string | null;
  tournamentChannelId?: string | null;
  botAccessToken?: string | null;
}) {
  await ensureCtfTournamentSchema(env);
  const channelId = normalizeDiscordId(input.tournamentChannelId);
  const token = cleanSecret(input.botAccessToken);
  await requireDb(env)
    .prepare(
      `UPDATE linked_servers SET
        tournament_channel_id = COALESCE(?, tournament_channel_id),
        bot_access_token = COALESCE(?, bot_access_token),
        bot_installed_at = CASE WHEN ? IS NOT NULL OR ? IS NOT NULL THEN COALESCE(bot_installed_at, ?) ELSE bot_installed_at END,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(channelId, token, channelId, token, new Date().toISOString(), input.linkedServerId)
    .run();
  console.log("DZN BOT ONBOARDING CONFIG VAULT UPDATED", {
    linkedServerId: input.linkedServerId,
    discordGuildConfigured: Boolean(input.discordGuildId),
    tournamentChannelConfigured: Boolean(channelId),
    botTokenConfigured: Boolean(token),
  });
}

export async function processServerMatchmakingOptIn(env: Env, linkedServerId: string) {
  await ensureCtfTournamentSchema(env);
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT linked_servers.id, linked_servers.guild_id, server_subscriptions.plan_key, server_subscriptions.status
       FROM linked_servers
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE linked_servers.id = ?
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ id: string; guild_id: string | null; plan_key: string | null; status: string | null }>();
  if (!row) return { ok: false, status: "not_found" as const, reason: "Server not found." };

  const planKey = normalizePlanKey(row.plan_key);
  const active = isActiveSubscription(row.status);
  if (!active || !STRICT_MATCHMAKING_PLANS.includes(planKey)) {
    return {
      ok: false,
      status: "plan_locked" as const,
      plan_key: planKey,
      subscription_status: row.status ?? "inactive",
      reason: "Matchmaking requires an active DZN Pro or DZN Partner subscription.",
    };
  }

  const now = new Date().toISOString();
  await db
    .prepare("UPDATE linked_servers SET is_searching_for_match = 1, matchmaking_opt_in_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(now, linkedServerId)
    .run();
  console.log("DZN PRO MATCHMAKING OPT IN ACCEPTED", { linkedServerId, planKey });
  return { ok: true, status: "queued" as const, plan_key: planKey, matchmaking_opt_in_at: now };
}

export async function dispatchUnifiedRegistrationEmbed(env: Env, linkedServerId: string, input: {
  opponentName: string;
  targetMetric?: string | null;
  tournamentId?: string | null;
}) {
  await ensureCtfTournamentSchema(env);
  const botConfig = await fetchServerBotConfig(env, linkedServerId);
  if (!botConfig?.tournament_channel_id) {
    return { ok: false, status: "missing_channel" as const, reason: "Tournament channel is not configured." };
  }
  const token = cleanSecret(botConfig.bot_access_token) ?? cleanSecret(env.DISCORD_BOT_TOKEN);
  if (!token) {
    return { ok: false, status: "missing_bot_token" as const, reason: "Discord bot token is not configured." };
  }
  const payload = buildRegistrationEmbedPayload(env, linkedServerId, {
    opponentName: input.opponentName,
    targetMetric: normalizeTargetMetric(input.targetMetric),
    serverName: botConfig.server_name ?? "Connected server",
    tournamentId: input.tournamentId ?? null,
  });
  const result = await postDiscordBotMessage(token, botConfig.tournament_channel_id, payload);
  console.log("DZN UNIFIED REGISTRATION EMBED DISPATCHED", {
    linkedServerId,
    channelId: botConfig.tournament_channel_id,
    messageId: result.messageId,
  });
  return { ok: true, status: "sent" as const, channel_id: botConfig.tournament_channel_id, message_id: result.messageId };
}

export async function getActiveCtfCampaign(env: Env, linkedServerId: string) {
  await ensureCtfTournamentSchema(env);
  return requireDb(env)
    .prepare(
      `SELECT ctf_tournaments.*
       FROM ctf_tournaments
       JOIN ctf_match_participants ON ctf_match_participants.ctf_tournament_id = ctf_tournaments.id
       WHERE ctf_match_participants.linked_server_id = ?
         AND ctf_tournaments.current_phase = 'BATTLE_ACTIVE'
       ORDER BY ctf_tournaments.phase_ends_at ASC
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<CtfTournamentRow>();
}

export async function evaluateCtfPointProgression(env: Env, campaign: CtfTournamentRow, event: CtfLogEvent) {
  await ensureCtfTournamentSchema(env);
  if (isCurrentTimeInGracePeriod(campaign.grace_period_config)) {
    await auditCtfEvent(env, campaign.id, event, 0, false, "grace_period_freeze");
    return { accepted: false, reason: "grace_period_freeze" as const, point_delta: 0 };
  }
  if (!isCtfScoredAction(event.eventType)) {
    return { accepted: false, reason: "not_scored_action" as const, point_delta: 0 };
  }
  const rosterOk = await isPlayerOnLockedRoster(env, campaign.id, event.linkedServerId, event.playerAId);
  if (!rosterOk) {
    await auditCtfEvent(env, campaign.id, event, 0, false, "player_not_on_locked_roster");
    return { accepted: false, reason: "player_not_on_locked_roster" as const, point_delta: 0 };
  }

  const pointDelta = pointsForCampaignEvent(campaign.target_metric, event.eventType);
  if (pointDelta <= 0) {
    await auditCtfEvent(env, campaign.id, event, 0, false, "metric_mismatch");
    return { accepted: false, reason: "metric_mismatch" as const, point_delta: 0 };
  }
  const total = await incrementCtfPoints(env, campaign.id, event.linkedServerId, pointDelta);
  if (total >= Number(campaign.target_flag_points ?? 0)) {
    await markCtfFlagRaised(env, campaign.id, event.linkedServerId);
  }
  await auditCtfEvent(env, campaign.id, event, pointDelta, true, null);
  return { accepted: true, reason: "accepted" as const, point_delta: pointDelta, accumulated_points: total };
}

export async function shouldCountBattleActiveEvent(env: Env, event: CtfLogEvent) {
  const campaign = await getActiveCtfCampaign(env, event.linkedServerId);
  if (!campaign || campaign.current_phase !== "BATTLE_ACTIVE" || !isCtfScoredAction(event.eventType)) {
    return { shouldCount: true, reason: "no_active_roster_gate" as const, campaign: null };
  }
  const rosterOk = await isPlayerOnLockedRoster(env, campaign.id, event.linkedServerId, event.playerAId);
  return {
    shouldCount: rosterOk,
    reason: rosterOk ? "player_on_locked_roster" as const : "player_not_on_locked_roster" as const,
    campaign,
  };
}

export async function dispatchDueCtfScorecards(env: Env, options: { maxCampaigns?: number } = {}) {
  await ensureCtfTournamentSchema(env);
  const db = requireDb(env);
  const now = new Date().toISOString();
  const limit = Math.max(1, Math.min(Math.trunc(Number(options.maxCampaigns ?? 20)) || 20, 50));
  const campaigns = await db
    .prepare(
      `SELECT *
       FROM ctf_tournaments
       WHERE current_phase = 'BATTLE_ACTIVE'
         AND phase_ends_at > ?
       ORDER BY phase_ends_at ASC
       LIMIT ?`,
    )
    .bind(now, limit)
    .all<CtfTournamentRow>();

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];
  for (const campaign of campaigns.results ?? []) {
    processed += 1;
    if (isCurrentTimeInGracePeriod(campaign.grace_period_config)) {
      skipped += 1;
      results.push({ tournament_id: campaign.id, status: "skipped_grace_period" });
      continue;
    }
    try {
      const result = await broadcastCtfStatusScorecards(env, campaign);
      sent += result.sent;
      skipped += result.skipped;
      results.push({ tournament_id: campaign.id, ...result });
    } catch (error) {
      failed += 1;
      results.push({
        tournament_id: campaign.id,
        status: "failed",
        error: error instanceof Error ? error.message : "CTF scorecard dispatch failed",
      });
    }
  }
  console.log("DZN CTF SCORECARD LOOP COMPLETE", { processed, sent, skipped, failed });
  return { ok: failed === 0, processed, sent, skipped, failed, results };
}

export async function broadcastCtfStatusScorecards(env: Env, campaign: CtfTournamentRow) {
  const db = requireDb(env);
  const teams = await db
    .prepare(
      `SELECT ctf_match_participants.linked_server_id, linked_servers.server_name,
              ctf_match_participants.accumulated_points, ctf_match_participants.has_raised_flag,
              ctf_match_participants.last_broadcasted_at, linked_servers.tournament_channel_id,
              linked_servers.bot_access_token
       FROM ctf_match_participants
       JOIN linked_servers ON linked_servers.id = ctf_match_participants.linked_server_id
       WHERE ctf_match_participants.ctf_tournament_id = ?
       ORDER BY ctf_match_participants.accumulated_points DESC, linked_servers.server_name ASC`,
    )
    .bind(campaign.id)
    .all<ScorecardTeamRow>();
  const rows = teams.results ?? [];
  if (rows.length === 0) return { status: "skipped_no_participants", sent: 0, skipped: 1 };

  let scorecardBody = "**LIVE EVENT SCORE PROGRESS REPORT**\n--------------------------------------------\n";
  for (const team of rows) {
    const points = Number(team.accumulated_points ?? 0);
    const percent = progressPercent(points, campaign.target_flag_points);
    scorecardBody += `**${team.server_name ?? team.linked_server_id}**\n` +
      `Scoreboard Tally: ${points} / ${campaign.target_flag_points} pts\n` +
      `Operational Graph: [${renderAsciiProgressBlocks(points, campaign.target_flag_points)}] ${percent}%\n\n`;
  }

  const payload = {
    username: "DZN Metrics Infrastructure",
    embeds: [{
      title: "DZN Shield Showdown Movement Dossier",
      description: scorecardBody,
      color: 15844367,
      footer: { text: "DZN Event Engine - Pro Level Automation Systems" },
    }],
  };

  let sent = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const team of rows) {
    if (!isBroadcastDue(team.last_broadcasted_at, campaign.broadcast_interval_minutes, now)) {
      skipped += 1;
      continue;
    }
    const token = cleanSecret(team.bot_access_token) ?? cleanSecret(env.DISCORD_BOT_TOKEN);
    if (!token || !team.tournament_channel_id) {
      skipped += 1;
      continue;
    }
    await postDiscordBotMessage(token, team.tournament_channel_id, payload);
    await db
      .prepare("UPDATE ctf_match_participants SET last_broadcasted_at = ?, updated_at = ? WHERE ctf_tournament_id = ? AND linked_server_id = ?")
      .bind(now, now, campaign.id, team.linked_server_id)
      .run();
    sent += 1;
  }
  return { status: "completed", sent, skipped };
}

export function renderAsciiProgressBlocks(points: number, targetPoints: number) {
  const percent = progressPercent(points, targetPoints);
  const filledBlocks = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return "🟩".repeat(filledBlocks) + "⬛".repeat(10 - filledBlocks);
}

export function isCurrentTimeInGracePeriod(configJson: string | null | undefined, now: Date = new Date()) {
  const config = parseGracePeriodConfig(configJson);
  if (!config.start || !config.end) return false;
  const current = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  if (config.start <= config.end) return current >= config.start && current <= config.end;
  return current >= config.start || current <= config.end;
}

function buildRegistrationEmbedPayload(env: Env, linkedServerId: string, input: {
  opponentName: string;
  targetMetric: CtfTargetMetric;
  serverName: string;
  tournamentId?: string | null;
}) {
  const appUrl = appBaseUrl(env);
  const url = new URL("/dashboard/register-event", appUrl);
  url.searchParams.set("server", linkedServerId);
  if (input.tournamentId) url.searchParams.set("tournament", input.tournamentId);
  return {
    username: "DZN Bot System Core",
    embeds: [{
      title: "DZN Global Competition Tether: Event System",
      description: `Your community has been automatically paired for an upcoming competitive match!\n\n` +
        `**Home Server:** ${input.serverName}\n` +
        `**Target Competitor:** ${input.opponentName}\n` +
        `**Event Focus Metric:** ${input.targetMetric === "KILLS" ? "PvP Eliminations & Kill Velocity" : "Base Building & Fortification Placements"}\n` +
        `**Roster Window:** 24 Hours Remaining to Confirm Entry\n\n` +
        `**Secure Tournament Entry Compliance**\n` +
        `**Anti-alt roster lock:** Secondary profiles and alternate accounts are rejected by the tournament scorer and will not count.\n\n` +
        `**Exact gamertag verification:** Your linked username must match your in-game profile exactly, including case, spaces, and formatting characters.`,
      color: 15158332,
      footer: { text: "DZN Network - Core Automation & Metrics Infrastructure" },
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Link Profile & Verify Entry",
        url: url.toString(),
      }],
    }],
  };
}

async function fetchServerBotConfig(env: Env, linkedServerId: string) {
  return requireDb(env)
    .prepare(
      `SELECT id AS linked_server_id, server_name, guild_id, tournament_channel_id, bot_access_token
       FROM linked_servers
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<BotConfigRow>();
}

async function postDiscordBotMessage(token: string, channelId: string, payload: unknown) {
  const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Discord bot message dispatch failed with ${response.status}`);
  }
  const message = await response.json().catch(() => null) as { id?: string } | null;
  return { messageId: typeof message?.id === "string" ? message.id : null };
}

async function isPlayerOnLockedRoster(env: Env, tournamentId: string, linkedServerId: string, playerId: string) {
  const row = await requireDb(env)
    .prepare(
      `SELECT 1 AS ok
       FROM ctf_tournament_rosters
       WHERE ctf_tournament_id = ?
         AND linked_server_id = ?
         AND player_id = ?
       LIMIT 1`,
    )
    .bind(tournamentId, linkedServerId, playerId)
    .first<{ ok: number }>();
  return Boolean(row?.ok);
}

async function incrementCtfPoints(env: Env, tournamentId: string, linkedServerId: string, points: number) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `UPDATE ctf_match_participants
       SET accumulated_points = accumulated_points + ?, updated_at = ?
       WHERE ctf_tournament_id = ? AND linked_server_id = ?`,
    )
    .bind(points, now, tournamentId, linkedServerId)
    .run();
  const row = await requireDb(env)
    .prepare("SELECT accumulated_points FROM ctf_match_participants WHERE ctf_tournament_id = ? AND linked_server_id = ? LIMIT 1")
    .bind(tournamentId, linkedServerId)
    .first<{ accumulated_points: number | null }>();
  return Number(row?.accumulated_points ?? 0);
}

async function markCtfFlagRaised(env: Env, tournamentId: string, linkedServerId: string) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare("UPDATE ctf_match_participants SET has_raised_flag = 1, updated_at = ? WHERE ctf_tournament_id = ? AND linked_server_id = ?")
    .bind(now, tournamentId, linkedServerId)
    .run();
}

async function auditCtfEvent(env: Env, tournamentId: string, event: CtfLogEvent, pointDelta: number, accepted: boolean, rejectedReason: string | null) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO ctf_event_audit (
        id, ctf_tournament_id, linked_server_id, event_hash, event_type, player_id, point_delta,
        accepted, rejected_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ctf_tournament_id, linked_server_id, event_hash) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      tournamentId,
      event.linkedServerId,
      event.eventHash,
      event.eventType,
      event.playerAId,
      pointDelta,
      accepted ? 1 : 0,
      rejectedReason,
      now,
    )
    .run();
}

function pointsForCampaignEvent(metric: CtfTargetMetric, eventType: CtfTrackedEventType) {
  if (metric === "KILLS" && eventType === "KILL") return 10;
  if (metric === "BUILDING" && eventType === "BUILD_PLACEMENT") return 5;
  return 0;
}

function isCtfScoredAction(eventType: CtfTrackedEventType) {
  return eventType === "KILL" || eventType === "BUILD_PLACEMENT";
}

function normalizeTargetMetric(value: unknown): CtfTargetMetric {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return text === "BUILDING" ? "BUILDING" : "KILLS";
}

function isActiveSubscription(value: unknown) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  return status === "active" || status === "trialing";
}

function progressPercent(points: number, targetPoints: number) {
  const target = Number(targetPoints);
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(points) / target) * 100)));
}

function isBroadcastDue(lastBroadcastedAt: string | null, intervalMinutes: number, nowIso: string) {
  if (!lastBroadcastedAt) return true;
  const last = new Date(lastBroadcastedAt).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(last) || !Number.isFinite(now)) return true;
  return now - last >= Math.max(1, intervalMinutes) * 60 * 1000;
}

function parseGracePeriodConfig(configJson: string | null | undefined) {
  if (!configJson) return {};
  try {
    const value = JSON.parse(configJson) as { start?: unknown; end?: unknown };
    return {
      start: typeof value.start === "string" ? value.start : null,
      end: typeof value.end === "string" ? value.end : null,
    };
  } catch {
    return {};
  }
}

function normalizeDiscordId(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{5,30}$/.test(text) ? text : null;
}

function cleanSecret(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return text.replace(/^Bot\s+/i, "");
}

function appBaseUrl(env: Env) {
  const configured = (env.DZN_APP_URL ?? env.NEXT_PUBLIC_APP_URL)?.trim().replace(/\/+$/, "");
  return configured || DEFAULT_APP_URL;
}

async function ensureColumns(db: D1Database, tableName: string, columns: Record<string, string>) {
  const existing = await getTableColumns(db, tableName);
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) {
      await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${type}`).run();
    }
  }
}

async function getTableColumns(db: D1Database, tableName: string) {
  const result = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  return new Set((result.results ?? []).map((row) => row.name));
}

function logCtfAuditReadiness() {
  if (ctfAuditLogsPrinted) return;
  ctfAuditLogsPrinted = true;
  console.log("DZN DAYZ CONSOLE TRACKING AUDIT COMPLETE");
  console.log("DZN HULK STYLE LOG TRACKING HARDENED");
  console.log("DZN ONLY BLOCKED BY NITRADO OR INVALID TOKEN");
}

const CTF_SCHEMA_STATEMENTS = [
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_kill_events_event_hash ON kill_events(event_hash)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_player_events_event_hash ON player_events(event_hash)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_session_hash ON sessions(session_hash)",
  "CREATE INDEX IF NOT EXISTS idx_server_subscriptions_active_subscription_lookup ON server_subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL AND stripe_subscription_id != ''",
  `CREATE TABLE IF NOT EXISTS ctf_tournaments (
    id TEXT PRIMARY KEY,
    tournament_name TEXT NOT NULL,
    current_phase TEXT NOT NULL DEFAULT 'PRE_WAR_ROSTER',
    phase_ends_at TEXT NOT NULL,
    target_metric TEXT NOT NULL DEFAULT 'KILLS',
    target_flag_points INTEGER NOT NULL DEFAULT 1000,
    broadcast_interval_minutes INTEGER NOT NULL DEFAULT 60,
    grace_period_config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ctf_tournaments_phase ON ctf_tournaments(current_phase)",
  "CREATE INDEX IF NOT EXISTS idx_ctf_tournaments_phase_ends_at ON ctf_tournaments(phase_ends_at)",
  `CREATE TABLE IF NOT EXISTS ctf_match_participants (
    ctf_tournament_id TEXT NOT NULL,
    linked_server_id TEXT NOT NULL,
    accumulated_points INTEGER NOT NULL DEFAULT 0,
    has_raised_flag INTEGER NOT NULL DEFAULT 0,
    last_broadcasted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ctf_tournament_id, linked_server_id),
    FOREIGN KEY(ctf_tournament_id) REFERENCES ctf_tournaments(id),
    FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ctf_match_participants_server ON ctf_match_participants(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_ctf_match_participants_broadcast ON ctf_match_participants(last_broadcasted_at)",
  `CREATE TABLE IF NOT EXISTS ctf_tournament_rosters (
    ctf_tournament_id TEXT NOT NULL,
    linked_server_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ctf_tournament_id, linked_server_id, player_id),
    FOREIGN KEY(ctf_tournament_id) REFERENCES ctf_tournaments(id),
    FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ctf_tournament_rosters_player ON ctf_tournament_rosters(player_id)",
  "CREATE INDEX IF NOT EXISTS idx_ctf_tournament_rosters_server ON ctf_tournament_rosters(linked_server_id)",
  `CREATE TABLE IF NOT EXISTS server_activity_index (
    linked_server_id TEXT PRIMARY KEY,
    rolling_7day_log_lines INTEGER NOT NULL DEFAULT 0,
    last_calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activity_tier TEXT NOT NULL DEFAULT 'STABLE',
    FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
  )`,
  `CREATE TABLE IF NOT EXISTS server_discord_webhooks (
    linked_server_id TEXT PRIMARY KEY,
    killfeed_webhook_url TEXT,
    connections_webhook_url TEXT,
    announcements_webhook_url TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ctf_event_audit (
    id TEXT PRIMARY KEY,
    ctf_tournament_id TEXT NOT NULL,
    linked_server_id TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    event_type TEXT NOT NULL,
    player_id TEXT,
    point_delta INTEGER NOT NULL DEFAULT 0,
    accepted INTEGER NOT NULL DEFAULT 0,
    rejected_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ctf_tournament_id, linked_server_id, event_hash),
    FOREIGN KEY(ctf_tournament_id) REFERENCES ctf_tournaments(id),
    FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ctf_event_audit_server ON ctf_event_audit(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_ctf_event_audit_event_hash ON ctf_event_audit(event_hash)",
];
