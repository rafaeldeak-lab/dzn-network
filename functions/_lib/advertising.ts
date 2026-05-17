import type { PlanEntitlements } from "./plans";

export const BOOSTED_VISIBILITY_HOURS = 24;

export type AdvertisingState = {
  last_bumped_at: string | null;
  bump_count_current_period: number;
  bump_period_start: string | null;
  bump_period_end: string | null;
  featured_until: string | null;
  featured_label: string | null;
};

export type PublicAdvertising = {
  is_featured: boolean;
  featured_until: string | null;
  is_boosted: boolean;
  last_bumped_at: string | null;
  badge_label: "FEATURED" | "BOOSTED" | "SPONSORED" | null;
};

export function publicAdvertisingFromState(state: Partial<AdvertisingState> | null | undefined, now = new Date()): PublicAdvertising {
  const featuredUntil = stringOrNull(state?.featured_until);
  const lastBumpedAt = stringOrNull(state?.last_bumped_at);
  const isFeatured = Boolean(featuredUntil && dateValue(featuredUntil) > now.getTime());
  const isBoosted = Boolean(lastBumpedAt && now.getTime() - dateValue(lastBumpedAt) <= BOOSTED_VISIBILITY_HOURS * 60 * 60 * 1000);
  const customLabel = stringOrNull(state?.featured_label)?.toUpperCase();
  return {
    is_featured: isFeatured,
    featured_until: featuredUntil,
    is_boosted: isBoosted,
    last_bumped_at: lastBumpedAt,
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
  const bumpCount = Number(state?.bump_count_current_period ?? 0);
  if (bumpCount >= entitlements.included_bumps_per_month) {
    return { ok: false as const, reason: "Monthly bump limit reached", code: "limit_reached" as const };
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
