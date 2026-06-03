import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { awardBadge, revokeLiveBadge, setCrownHolder } from "../functions/_lib/badge-awards";
import type { Env } from "../functions/_lib/types";
import {
  BADGE_UNLOCK_RULES,
  buildServerBadgeCollection,
  evaluateBadgeRules,
  getBadgeRule,
} from "../lib/badges/rules";
import { getBillingPlanSummaries } from "../functions/_lib/plans";

const premium = buildServerBadgeCollection({
  planKey: "premium",
  createdAt: "2026-01-01T00:00:00.000Z",
  totalKills: 5000,
  uniquePlayers: 150,
  longestKill: 1200,
  active: true,
  verified: true,
  now: "2026-06-03T00:00:00.000Z",
});
assert.equal(premium.earnedBadges.some((badge) => badge.code === "premium_server"), true, "Premium plan should earn premium_server.");
assert.equal(premium.earnedBadges.some((badge) => badge.code === "death_dealer"), true, "5,000 kills should unlock death_dealer.");
assert.equal(premium.earnedBadges.some((badge) => badge.code === "long_shot_legend"), true, "1,000m longest kill should unlock long_shot_legend.");
assert.equal(premium.earnedBadges.some((badge) => badge.staticIconUrl?.endsWith(".svg")), true, "Earned badges should use real SVG assets.");
assert.equal(premium.showcaseBadges.length <= 6, true, "Server card showcase should be capped.");

const legacyNetwork = buildServerBadgeCollection({ planKey: "network", active: true });
const legacyPartner = buildServerBadgeCollection({ planKey: "partner", active: true });
assert.equal(legacyNetwork.earnedBadges.some((badge) => badge.code === "premium_server"), true, "network legacy plan should map to premium_server.");
assert.equal(legacyPartner.earnedBadges.some((badge) => badge.code === "premium_server"), true, "partner legacy plan should map to premium_server.");

const veteran = buildServerBadgeCollection({
  planKey: "starter",
  createdAt: "2025-01-01T00:00:00.000Z",
  active: true,
  now: "2026-06-03T00:00:00.000Z",
});
assert.equal(veteran.earnedBadges.some((badge) => badge.code === "veteran"), true, "180 days should unlock veteran.");
assert.equal(veteran.earnedBadges.some((badge) => badge.code === "legacy_server"), true, "365 days should unlock legacy_server.");

const locked = buildServerBadgeCollection({
  planKey: "starter",
  createdAt: "2026-06-01T00:00:00.000Z",
  totalKills: 100,
  uniquePlayers: 10,
  longestKill: 250,
  active: true,
  now: "2026-06-03T00:00:00.000Z",
});
const deathDealerLocked = locked.lockedBadges.find((badge) => badge.code === "death_dealer");
assert.equal(Boolean(deathDealerLocked), true);
assert.equal(deathDealerLocked?.progressPercent, 2);
const headhunter = locked.lockedBadges.find((badge) => badge.code === "headhunter");
assert.equal(Boolean(headhunter), true, "Unsupported headshot badge should stay locked.");
assert.equal(headhunter?.progressPercent, 0);

const seasonal = buildServerBadgeCollection({
  planKey: "starter",
  active: true,
  awardedBadgeCodes: ["summer_champion"],
  earnedAtByCode: { summer_champion: "2027-08-31T20:00:00.000Z" },
});
const summer = seasonal.earnedBadges.find((badge) => badge.code === "summer_champion");
assert.equal(Boolean(summer), true, "Seasonal badge should display when awarded.");
assert.equal(summer?.permanent, true, "Seasonal badge should remain permanent.");

const crown = buildServerBadgeCollection({
  planKey: "starter",
  active: true,
  activeCrownCodes: ["king_of_dzn"],
});
assert.equal(crown.crowns.some((badge) => badge.code === "king_of_dzn"), true, "Active crown code should produce crown badge.");

const rules = evaluateBadgeRules({ planKey: "starter", totalKills: 4999, active: true });
assert.equal(rules.find((item) => item.rule.badgeCode === "death_dealer")?.unlocked, false);
assert.equal(rules.find((item) => item.rule.badgeCode === "death_dealer")?.targetValue, 5000);
assert.equal(getBadgeRule("dzn_legend")?.manualOnly, true, "DZN Legend should be protected/manual.");
assert.equal(BADGE_UNLOCK_RULES.some((rule) => rule.isCrown && rule.badgeCode === "king_of_pvp"), true);

for (const badge of premium.earnedBadges.concat(locked.lockedBadges)) {
  assert.equal(existsSync(`public${badge.staticIconUrl}`), true, `${badge.code} should point to an existing static asset.`);
  assert.equal(existsSync(`public${badge.animatedIconUrl}`), true, `${badge.code} should point to an existing animated asset.`);
}

const activePlans = getBillingPlanSummaries({
  STRIPE_PRICE_STARTER: "price_starter",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_PREMIUM: "price_premium",
} as Env);
assert.deepEqual(activePlans.map((plan) => plan.plan_key), ["starter", "pro", "premium"]);
assert.equal(JSON.stringify(activePlans).includes("Network"), false);
assert.equal(JSON.stringify(activePlans).includes("Partner"), false);

const publicApiSource = readFileSync("functions/api/public/servers.ts", "utf8");
for (const field of ["earnedBadges", "lockedBadges", "showcaseBadges", "crowns", "reputationVisual"]) {
  assert.equal(publicApiSource.includes(field), true, `${field} should be included in public API output.`);
}

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardSource.includes("buildServerBadgeCollection"), true, "Owner dashboard should use badge unlock collection.");

const migration = readFileSync("migrations/0045_badge_awards.sql", "utf8");
for (const table of ["server_badge_awards", "badge_unlock_progress", "crown_holders"]) {
  assert.equal(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), true, `${table} migration should exist.`);
}
assert.equal(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE\s+player_profiles|player_stats|DROP\s+COLUMN/i.test(migration), false);

async function awaitAsyncChecks() {
  const env = { DB: new MemoryD1() } as unknown as Env;
  const firstAward = await awardBadge(env, "server-a", "death_dealer", "test");
  const secondAward = await awardBadge(env, "server-a", "death_dealer", "test");
  assert.equal(firstAward.id, secondAward.id, "Permanent award should be idempotent.");
  assert.equal((env.DB as unknown as MemoryD1).awards.filter((award) => award.server_id === "server-a" && award.badge_code === "death_dealer").length, 1);

  await setCrownHolder(env, "king_of_dzn", "server-a", 1000);
  await setCrownHolder(env, "king_of_dzn", "server-b", 1200);
  const memory = env.DB as unknown as MemoryD1;
  assert.equal(memory.crowns.get("king_of_dzn")?.server_id, "server-b", "Crown holder should transfer.");
  assert.equal(memory.awards.find((award) => award.server_id === "server-a" && award.badge_code === "king_of_dzn")?.is_active, 0, "Old crown holder should lose active crown.");
  assert.equal(memory.awards.find((award) => award.server_id === "server-b" && award.badge_code === "king_of_dzn")?.is_active, 1, "New crown holder should gain active crown.");

  await revokeLiveBadge(env, "server-b", "king_of_dzn", "test_revoke");
  assert.equal(memory.awards.find((award) => award.server_id === "server-b" && award.badge_code === "king_of_dzn")?.is_active, 0);

  console.log("Badge award tests passed.");
}

type AwardRow = {
  id: string;
  server_id: string;
  badge_code: string;
  awarded_at: string;
  award_type: string;
  source: string;
  is_active: number;
  expires_at: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

class MemoryD1 {
  awards: AwardRow[] = [];
  crowns = new Map<string, { crown_code: string; server_id: string; awarded_at: string; score_snapshot: number; previous_server_id: string | null; created_at: string; updated_at: string }>();

  prepare(sql: string) {
    return new MemoryStatement(this, sql);
  }
}

class MemoryStatement {
  private args: unknown[] = [];

  constructor(private readonly db: MemoryD1, private readonly sql: string) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async run() {
    const normalized = normalizeSql(this.sql);
    if (normalized.startsWith("create ") || normalized.startsWith("create unique ")) return { success: true };
    if (normalized.startsWith("insert into server_badge_awards")) {
      this.db.awards.push({
        id: String(this.args[0]),
        server_id: String(this.args[1]),
        badge_code: String(this.args[2]),
        awarded_at: String(this.args[3]),
        award_type: String(this.args[4]),
        source: String(this.args[5]),
        is_active: Number(this.args[6]),
        expires_at: this.args[7] === null || this.args[7] === undefined ? null : String(this.args[7]),
        metadata_json: this.args[8] === null || this.args[8] === undefined ? null : String(this.args[8]),
        created_at: String(this.args[9]),
        updated_at: String(this.args[10]),
      });
      return { success: true };
    }
    if (normalized.startsWith("update server_badge_awards set is_active = 1")) {
      const id = String(this.args[4]);
      const award = this.db.awards.find((row) => row.id === id);
      if (award) {
        award.is_active = 1;
        award.source = String(this.args[0]);
        award.awarded_at = String(this.args[1]);
        award.metadata_json = this.args[2] === null || this.args[2] === undefined ? null : String(this.args[2]);
        award.updated_at = String(this.args[3]);
      }
      return { success: true };
    }
    if (normalized.startsWith("update server_badge_awards set is_active = 0")) {
      const serverId = String(this.args[2]);
      const code = String(this.args[3]);
      for (const award of this.db.awards) {
        if (award.server_id === serverId && award.badge_code === code && award.is_active === 1) {
          award.is_active = 0;
          award.metadata_json = String(this.args[0]);
          award.updated_at = String(this.args[1]);
        }
      }
      return { success: true };
    }
    if (normalized.startsWith("insert into crown_holders")) {
      const crown = {
        crown_code: String(this.args[0]),
        server_id: String(this.args[1]),
        awarded_at: String(this.args[2]),
        score_snapshot: Number(this.args[3]),
        previous_server_id: this.args[4] === null || this.args[4] === undefined ? null : String(this.args[4]),
        created_at: String(this.args[5]),
        updated_at: String(this.args[6]),
      };
      this.db.crowns.set(crown.crown_code, crown);
      return { success: true };
    }
    if (normalized.startsWith("update crown_holders set")) {
      const crown = this.db.crowns.get(String(this.args[2]));
      if (crown) {
        crown.score_snapshot = Number(this.args[0]);
        crown.updated_at = String(this.args[1]);
      }
      return { success: true };
    }
    return { success: true };
  }

  async first<T>() {
    const normalized = normalizeSql(this.sql);
    if (normalized.startsWith("select * from server_badge_awards")) {
      const serverId = String(this.args[0]);
      const code = String(this.args[1]);
      return (this.db.awards.find((award) => award.server_id === serverId && award.badge_code === code && award.is_active === 1)
        ?? this.db.awards.find((award) => award.server_id === serverId && award.badge_code === code)
        ?? null) as T | null;
    }
    if (normalized.startsWith("select server_id from crown_holders")) {
      const crown = this.db.crowns.get(String(this.args[0]));
      return (crown ? { server_id: crown.server_id } : null) as T | null;
    }
    return null;
  }

  async all<T>() {
    return { results: [] as T[] };
  }
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

awaitAsyncChecks().catch((error) => {
  console.error(error);
  process.exit(1);
});
