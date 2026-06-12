import { requireDb } from "./db";
import { finalizeServerWarEvent } from "./server-war-finalize";
import { refreshServerWarEventSnapshot } from "./server-war-snapshots";
import { ensureServerWarsSchema } from "./server-war-schema";
import type { Env } from "./types";

export const SERVER_WAR_AUTOMATION_DEFAULT_EVENT_LIMIT = 1;
export const SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT = 3;
export const SERVER_WAR_AUTOMATION_DEFAULT_CHALLENGE_LIMIT = 10;
export const SERVER_WAR_AUTOMATION_MAX_CHALLENGE_LIMIT = 20;
export const SERVER_WAR_AUTOMATION_DEFAULT_DEADLINE_MS = 2_500;

export type ServerWarAutomationOptions = {
  now?: string | Date;
  maxEvents?: number;
  maxFinalizations?: number;
  maxChallengeExpirations?: number;
  deadlineMs?: number;
  source?: string;
};

export type ServerWarAutomationItemResult = {
  id: string;
  ok: boolean;
  status?: string;
  error?: string;
  skipped?: boolean;
};

export type ServerWarAutomationResult = {
  ok: true;
  source: string;
  now: string;
  budgetExhausted: boolean;
  transitions: {
    scheduledToLive: number;
    liveToFinalizing: number;
    expiredChallenges: number;
  };
  snapshots: ServerWarAutomationItemResult[];
  finalized: ServerWarAutomationItemResult[];
  warnings: string[];
};

type EventIdRow = {
  id: string;
};

type ChallengeExpiryRow = {
  id: string;
  event_id: string;
  opponent_server_id: string;
};

type AutomationBudget = {
  startedAtMs: number;
  deadlineAtMs: number;
};

export async function runServerWarAutomationTick(
  env: Env,
  options: ServerWarAutomationOptions = {},
): Promise<ServerWarAutomationResult> {
  await ensureServerWarsSchema(env);
  const now = normalizeNow(options.now);
  const budget = createAutomationBudget(options.deadlineMs);
  const source = typeof options.source === "string" && options.source.trim()
    ? options.source.trim().slice(0, 80)
    : "cron";
  const maxEvents = clampLimit(options.maxEvents, SERVER_WAR_AUTOMATION_DEFAULT_EVENT_LIMIT, SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT);
  const maxFinalizations = clampLimit(options.maxFinalizations, maxEvents, SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT);
  const maxChallengeExpirations = clampLimit(
    options.maxChallengeExpirations,
    SERVER_WAR_AUTOMATION_DEFAULT_CHALLENGE_LIMIT,
    SERVER_WAR_AUTOMATION_MAX_CHALLENGE_LIMIT,
  );
  const warnings: string[] = [];

  const expiredChallenges = await expireDueServerWarChallenges(env, now, maxChallengeExpirations, budget, warnings);
  const scheduledToLive = await transitionScheduledServerWarsToLive(env, now, maxEvents, budget, warnings);
  const liveToFinalizing = await transitionEndedServerWarsToFinalizing(env, now, maxEvents, budget, warnings);
  const snapshots = await refreshDueServerWarSnapshots(env, {
    now,
    maxEvents,
    budget,
    warnings,
  });
  const finalized = await finalizeEndedServerWars(env, {
    now,
    maxFinalizations,
    budget,
    warnings,
  });

  return {
    ok: true,
    source,
    now,
    budgetExhausted: isBudgetLow(budget),
    transitions: {
      scheduledToLive,
      liveToFinalizing,
      expiredChallenges,
    },
    snapshots,
    finalized,
    warnings,
  };
}

export async function refreshDueServerWarSnapshots(
  env: Env,
  options: ServerWarAutomationOptions & { budget?: AutomationBudget; warnings?: string[] } = {},
): Promise<ServerWarAutomationItemResult[]> {
  await ensureServerWarsSchema(env);
  const now = normalizeNow(options.now);
  const budget = options.budget ?? createAutomationBudget(options.deadlineMs);
  const warnings = options.warnings ?? [];
  const maxEvents = clampLimit(options.maxEvents, SERVER_WAR_AUTOMATION_DEFAULT_EVENT_LIMIT, SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT);
  if (isBudgetLow(budget)) {
    warnings.push("Snapshot refresh skipped because Server Wars automation budget is low.");
    return [];
  }

  const events = await requireDb(env)
    .prepare(
      `SELECT id
       FROM server_war_events
       WHERE status = 'live'
         AND datetime(starts_at) <= datetime(?)
         AND datetime(ends_at) > datetime(?)
       ORDER BY
         COALESCE((SELECT MAX(snapshot_at) FROM server_war_score_snapshots WHERE event_id = server_war_events.id), '') ASC,
         starts_at ASC,
         updated_at ASC
       LIMIT ${maxEvents}`,
    )
    .bind(now, now)
    .all<EventIdRow>();

  const results: ServerWarAutomationItemResult[] = [];
  for (const event of events.results ?? []) {
    if (isBudgetLow(budget)) {
      warnings.push("Snapshot refresh stopped early because Server Wars automation budget is low.");
      break;
    }
    try {
      await refreshServerWarEventSnapshot(env, event.id);
      results.push({ id: event.id, ok: true });
    } catch (error) {
      const message = safeMessage(error);
      console.warn("DZN SERVER WARS SNAPSHOT REFRESH FAILED", { eventId: event.id, message });
      results.push({ id: event.id, ok: false, error: message });
    }
  }
  return results;
}

export async function finalizeEndedServerWars(
  env: Env,
  options: ServerWarAutomationOptions & { budget?: AutomationBudget; warnings?: string[] } = {},
): Promise<ServerWarAutomationItemResult[]> {
  await ensureServerWarsSchema(env);
  const now = normalizeNow(options.now);
  const budget = options.budget ?? createAutomationBudget(options.deadlineMs);
  const warnings = options.warnings ?? [];
  const maxFinalizations = clampLimit(options.maxFinalizations, SERVER_WAR_AUTOMATION_DEFAULT_EVENT_LIMIT, SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT);
  if (isBudgetLow(budget)) {
    warnings.push("Finalization skipped because Server Wars automation budget is low.");
    return [];
  }

  const events = await requireDb(env)
    .prepare(
      `SELECT id
       FROM server_war_events
       WHERE status IN ('finalizing', 'live')
         AND datetime(ends_at) <= datetime(?)
       ORDER BY ends_at ASC, updated_at ASC
       LIMIT ${maxFinalizations}`,
    )
    .bind(now)
    .all<EventIdRow>();

  const results: ServerWarAutomationItemResult[] = [];
  for (const event of events.results ?? []) {
    if (isBudgetLow(budget)) {
      warnings.push("Finalization stopped early because Server Wars automation budget is low.");
      break;
    }
    try {
      await requireDb(env)
        .prepare("UPDATE server_war_events SET status = 'finalizing', updated_at = ? WHERE id = ? AND status = 'live'")
        .bind(now, event.id)
        .run();
      await refreshServerWarEventSnapshot(env, event.id);
      const finalized = await finalizeServerWarEvent(env, event.id);
      results.push({
        id: event.id,
        ok: true,
        status: finalized.alreadyFinalized ? "already_finalized" : "finalized",
      });
    } catch (error) {
      const message = safeMessage(error);
      console.warn("DZN SERVER WARS FINALIZATION FAILED", { eventId: event.id, message });
      results.push({ id: event.id, ok: false, error: message });
    }
  }
  return results;
}

async function expireDueServerWarChallenges(
  env: Env,
  now: string,
  limit: number,
  budget: AutomationBudget,
  warnings: string[],
) {
  if (isBudgetLow(budget)) return 0;
  const rows = await requireDb(env)
    .prepare(
      `SELECT id, event_id, opponent_server_id
       FROM server_war_challenges
       WHERE status = 'pending'
         AND datetime(expires_at) <= datetime(?)
       ORDER BY expires_at ASC
       LIMIT ${limit}`,
    )
    .bind(now)
    .all<ChallengeExpiryRow>();
  let expired = 0;
  for (const row of rows.results ?? []) {
    if (isBudgetLow(budget)) {
      warnings.push("Challenge expiry stopped early because Server Wars automation budget is low.");
      break;
    }
    await requireDb(env)
      .prepare(
        `UPDATE server_war_challenges
         SET status = 'expired', updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(now, row.id)
      .run();
    await requireDb(env)
      .prepare(
        `UPDATE server_war_events
         SET status = 'cancelled', updated_at = ?
         WHERE id = ? AND status = 'pending_acceptance'`,
      )
      .bind(now, row.event_id)
      .run();
    await requireDb(env)
      .prepare(
        `UPDATE server_war_participants
         SET status = CASE WHEN server_id = ? THEN 'declined' ELSE status END,
             declined_at = CASE WHEN server_id = ? THEN COALESCE(declined_at, ?) ELSE declined_at END,
             updated_at = ?
         WHERE event_id = ?
           AND status = 'pending'`,
      )
      .bind(row.opponent_server_id, row.opponent_server_id, now, now, row.event_id)
      .run();
    expired += 1;
  }
  return expired;
}

async function transitionScheduledServerWarsToLive(
  env: Env,
  now: string,
  limit: number,
  budget: AutomationBudget,
  warnings: string[],
) {
  if (isBudgetLow(budget)) return 0;
  const rows = await requireDb(env)
    .prepare(
      `SELECT id
       FROM server_war_events
       WHERE status = 'scheduled'
         AND datetime(starts_at) <= datetime(?)
         AND datetime(ends_at) > datetime(?)
       ORDER BY starts_at ASC
       LIMIT ${limit}`,
    )
    .bind(now, now)
    .all<EventIdRow>();
  let changed = 0;
  for (const row of rows.results ?? []) {
    if (isBudgetLow(budget)) {
      warnings.push("Scheduled-to-live transition stopped early because Server Wars automation budget is low.");
      break;
    }
    await requireDb(env)
      .prepare("UPDATE server_war_events SET status = 'live', updated_at = ? WHERE id = ? AND status = 'scheduled'")
      .bind(now, row.id)
      .run();
    changed += 1;
  }
  return changed;
}

async function transitionEndedServerWarsToFinalizing(
  env: Env,
  now: string,
  limit: number,
  budget: AutomationBudget,
  warnings: string[],
) {
  if (isBudgetLow(budget)) return 0;
  const rows = await requireDb(env)
    .prepare(
      `SELECT id
       FROM server_war_events
       WHERE status IN ('live', 'scheduled')
         AND datetime(ends_at) <= datetime(?)
       ORDER BY ends_at ASC
       LIMIT ${limit}`,
    )
    .bind(now)
    .all<EventIdRow>();
  let changed = 0;
  for (const row of rows.results ?? []) {
    if (isBudgetLow(budget)) {
      warnings.push("Live-to-finalizing transition stopped early because Server Wars automation budget is low.");
      break;
    }
    await requireDb(env)
      .prepare("UPDATE server_war_events SET status = 'finalizing', updated_at = ? WHERE id = ? AND status IN ('live', 'scheduled')")
      .bind(now, row.id)
      .run();
    changed += 1;
  }
  return changed;
}

function normalizeNow(value: string | Date | undefined) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function clampLimit(value: unknown, fallback: number, max: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, max)) : fallback;
}

function createAutomationBudget(deadlineMs = SERVER_WAR_AUTOMATION_DEFAULT_DEADLINE_MS): AutomationBudget {
  const startedAtMs = Date.now();
  return {
    startedAtMs,
    deadlineAtMs: startedAtMs + Math.max(1_000, Math.min(Math.trunc(deadlineMs), 10_000)),
  };
}

function isBudgetLow(budget: AutomationBudget) {
  return budget.deadlineAtMs - Date.now() < 750;
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
