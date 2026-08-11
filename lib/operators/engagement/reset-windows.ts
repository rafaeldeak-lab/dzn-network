const DAY_MS = 86_400_000;
const WEEK_MS = DAY_MS * 7;

export const OPERATOR_SEASON_START = "2026-06-01T00:00:00.000Z";
export const OPERATOR_SEASON_END = "2026-09-01T00:00:00.000Z";

export function getUtcDateKey(value: string | Date): string | null {
  const date = coerceDate(value);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

export function getNextOperatorDailyReset(now: string | Date): string {
  const date = coerceDate(now) ?? new Date(OPERATOR_SEASON_START);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

export function getNextOperatorWeeklyReset(now: string | Date): string {
  const date = coerceDate(now) ?? new Date(OPERATOR_SEASON_START);
  const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = new Date(startOfDay).getUTCDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  return new Date(startOfDay + daysUntilMonday * DAY_MS).toISOString();
}

export function getNextOperatorSeasonReset(now: string | Date): string {
  const date = coerceDate(now) ?? new Date(OPERATOR_SEASON_START);
  const seasonEnd = new Date(OPERATOR_SEASON_END);
  if (date.getTime() < seasonEnd.getTime()) return seasonEnd.toISOString();
  return new Date(seasonEnd.getTime() + WEEK_MS * 13).toISOString();
}

export function isFutureTimestamp(occurredAt: string, now: string | Date): boolean {
  const eventDate = coerceDate(occurredAt);
  const nowDate = coerceDate(now);
  if (!eventDate || !nowDate) return true;
  return eventDate.getTime() > nowDate.getTime();
}

export function daysBetweenUtcDates(previousDateKey: string, currentDateKey: string): number | null {
  const previous = Date.parse(`${previousDateKey}T00:00:00.000Z`);
  const current = Date.parse(`${currentDateKey}T00:00:00.000Z`);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
  return Math.floor((current - previous) / DAY_MS);
}

function coerceDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
