import assert from "node:assert/strict";

import { evaluateBumpEligibility, publicAdvertisingFromState } from "../functions/_lib/advertising";
import { getPlanConfig, getPlanFromStripePriceId, upsertOwnerEntitlements } from "../functions/_lib/plans";
import { sortPublicServersForDiscovery } from "../functions/api/public/servers";
import type { Env } from "../functions/_lib/types";

const starter = getPlanConfig("starter");
const pro = getPlanConfig("pro");
const network = getPlanConfig("network");

assert.equal(starter.can_use_ad_bumps, false);
assert.equal(pro.can_use_ad_bumps, true);
assert.equal(pro.max_linked_servers, 3);
assert.equal(network.max_linked_servers, 10);
assert.equal(getPlanConfig("free").max_linked_servers, 1);

const now = new Date("2026-05-17T12:00:00.000Z");
assert.deepEqual(evaluateBumpEligibility({ entitlements: starter, state: null, now }).code, "upgrade_required");
assert.equal(evaluateBumpEligibility({ entitlements: pro, state: null, now }).ok, true);
assert.deepEqual(
  evaluateBumpEligibility({
    entitlements: pro,
    state: {
      last_bumped_at: "2026-05-17T00:30:00.000Z",
      bump_count_current_period: 1,
    },
    now,
  }).code,
  "cooldown",
);
assert.deepEqual(
  evaluateBumpEligibility({
    entitlements: pro,
    state: {
      last_bumped_at: "2026-05-15T00:30:00.000Z",
      bump_count_current_period: 3,
    },
    now,
  }).code,
  "limit_reached",
);

const featured = publicAdvertisingFromState({ featured_until: "2026-05-18T12:00:00.000Z", featured_label: "featured" }, now);
const boosted = publicAdvertisingFromState({ last_bumped_at: "2026-05-17T10:00:00.000Z" }, now);
const organic = publicAdvertisingFromState(null, now);
assert.equal(featured.badge_label, "FEATURED");
assert.equal(boosted.badge_label, "BOOSTED");
assert.equal(organic.badge_label, null);

const sorted = sortPublicServersForDiscovery([
  { advertising: organic, rank: 1, score: 500, created_at: "2026-05-17T00:00:00.000Z", id: "organic" },
  { advertising: boosted, rank: 9, score: 10, created_at: "2026-05-17T00:00:00.000Z", id: "boosted" },
  { advertising: featured, rank: 99, score: 1, created_at: "2026-05-17T00:00:00.000Z", id: "featured" },
]);
assert.equal(sorted[0].id, "featured");
assert.equal(sorted[1].id, "boosted");
assert.equal(sorted[2].id, "organic");
assert.equal(JSON.stringify(sorted).includes("stripe_customer_id"), false);

const env = {
  NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID: "price_starter",
  NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: "price_pro",
  NEXT_PUBLIC_STRIPE_NETWORK_PRICE_ID: "price_network",
  NEXT_PUBLIC_STRIPE_PARTNER_PRICE_ID: "price_partner",
} as Env;
assert.equal(getPlanFromStripePriceId(env, "price_pro"), "pro");
assert.equal(getPlanFromStripePriceId(env, "price_missing"), "free");

const statements: string[] = [];
const bindings: unknown[][] = [];
const fakeEnv = {
  DB: {
    prepare(query: string) {
      statements.push(query);
      return {
        bind(...values: unknown[]) {
          bindings.push(values);
          return this;
        },
        async run() {
          return { success: true, meta: {} };
        },
        async first() {
          return null;
        },
        async all() {
          return { success: true, meta: {}, results: [] };
        },
        async raw() {
          return [];
        },
      };
    },
    async batch() {
      return [];
    },
    async exec() {
      return { success: true, meta: {} };
    },
  },
} as unknown as Env;

async function run() {
  await upsertOwnerEntitlements(fakeEnv, "discord-1", "pro", "active");
  assert.equal(bindings.some((values) => values.includes("discord-1") && values.includes("pro")), true);
  await upsertOwnerEntitlements(fakeEnv, "discord-2", "pro", "canceled");
  assert.equal(bindings.some((values) => values.includes("discord-2") && values.includes("free")), true);
  assert.equal(statements.some((statement) => statement.includes("owner_plan_entitlements")), true);

  console.log("Billing plan and advertising tests passed.");
}

void run();
