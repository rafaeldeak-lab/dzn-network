import type { PlanEntitlements } from "./plans";
import type { ListingLimits } from "../../lib/billing/plans";

export const BOOSTED_VISIBILITY_HOURS = 24;

export type AdvertisingState = {
  last_bumped_at: string | null;
  bump_count_current_period: number;
  bump_period_start: string | null;
  bump_period_end: string | null;
  next_bump_at: string | null;
  featured_until: string | null;
  featured_label: string | null;
};

export type PublicAdvertising = {
  is_featured: boolean;
  featured_until: string | null;
  is_boosted: boolean;
  last_bumped_at: string | null;
  next_bump_at?: string | null;
  boosted_until: string | null;
  boosted_time_left_label: string | null;
  badge_label: "FEATURED" | "BOOSTED" | "SPONSORED" | null;
};

export function publicAdvertisingFromState(state: Partial<AdvertisingState> | null | undefined, now = new Date()): PublicAdvertising {
  const featuredUntil = stringOrNull(state?.featured_until);
  const lastBumpedAt = stringOrNull(state?.last_bumped_at);
  const nowMs = now.getTime();
  const featuredUntilMs = dateValue(featuredUntil);
  const lastBumpedAtMs = dateValue(lastBumpedAt);
  const boostedUntilMs = lastBumpedAtMs ? lastBumpedAtMs + BOOSTED_VISIBILITY_HOURS * 60 * 60 * 1000 : 0;
  const isFeatured = Boolean(featuredUntil && featuredUntilMs > nowMs);
  const isBoosted = Boolean(lastBumpedAt && boostedUntilMs > nowMs);
  const customLabel = stringOrNull(state?.featured_label)?.toUpperCase();
  return {
    is_featured: isFeatured,
    featured_until: featuredUntil,
    is_boosted: isBoosted,
    last_bumped_at: lastBumpedAt,
    next_bump_at: stringOrNull(state?.next_bump_at),
    boosted_until: isBoosted ? new Date(boostedUntilMs).toISOString() : null,
    boosted_time_left_label: isBoosted ? formatTimeLeft(boostedUntilMs - nowMs) : null,
    badge_label: isFeatured ? (customLabel === "SPONSORED" ? "SPONSORED" : "FEATURED") : isBoosted ? "BOOSTED" : null,
  };
}

export function advertisingSortScore(advertising: PublicAdvertising) {
  if (advertising.is_featured) return 2_000_000_000 + dateValue(advertising.featured_until);
  if (advertising.is_boosted) return 1_000_000_000 + dateValue(advertising.last_bumped_at);
  return 0;
}

export function evaluateBumpEligibility(input: {
  entitlements: PlanEntitlements;
  state: Partial<AdvertisingState> | null;
  now: Date;
}) {
  const { entitlements, state, now } = input;
  if (!entitlements.can_use_ad_bumps) {
    return { ok: false as const, reason: "Upgrade required", code: "upgrade_required" as const };
  }
  const lastBumpedAt = stringOrNull(state?.last_bumped_at);
  if (lastBumpedAt) {
    const nextAt = dateValue(lastBumpedAt) + entitlements.bump_cooldown_hours * 60 * 60 * 1000;
    if (nextAt > now.getTime()) {
      const hours = Math.ceil((nextAt - now.getTime()) / (60 * 60 * 1000));
      return { ok: false as const, reason: `Cooldown active, try again in ${hours} hour${hours === 1 ? "" : "s"}`, code: "cooldown" as const, retry_after_hours: hours };
    }
  }
  return { ok: true as const };
}

export function evaluateListingBumpEligibility(input: {
  limits: Pick<ListingLimits, "bumpCooldownDays" | "publicLabel">;
  state: Partial<AdvertisingState> | null;
  now: Date;
}) {
  const { limits, state, now } = input;
  const nowMs = now.getTime();
  const explicitNextAt = dateValue(stringOrNull(state?.next_bump_at));
  const lastBumpedAt = stringOrNull(state?.last_bumped_at);
  const fallbackNextAt = lastBumpedAt ? dateValue(lastBumpedAt) + limits.bumpCooldownDays * 24 * 60 * 60 * 1000 : 0;
  const nextAt = Math.max(explicitNextAt, fallbackNextAt);
  if (nextAt > nowMs) {
    const retryAfterSeconds = Math.max(1, Math.ceil((nextAt - nowMs) / 1000));
    return {
      ok: false as const,
      reason: `Your ${limits.publicLabel.toLowerCase()} can be bumped again ${formatDateTime(nextAt)}.`,
      code: "cooldown" as const,
      next_bump_at: new Date(nextAt).toISOString(),
      retry_after_seconds: retryAfterSeconds,
      retry_after_days: Math.ceil(retryAfterSeconds / (24 * 60 * 60)),
    };
  }
  return { ok: true as const, next_bump_at: null };
}

export function defaultBumpPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function periodExpired(periodEnd: string | null | undefined, now = new Date()) {
  return !periodEnd || dateValue(periodEnd) <= now.getTime();
}

function dateValue(value: string | null | undefined) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function formatTimeLeft(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.ceil((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 24) {
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    return `${days}d left`;
  }
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(minutes, 1)}m left`;
}

function formatDateTime(ms: number) {
  return new Date(ms).toUTCString();
}
