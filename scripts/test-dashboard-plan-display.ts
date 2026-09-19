import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dashboardBillingPlan, dashboardServerPlan } from "../components/onboarding/dashboard-plan-display";
import { dashboardAccessLabel, dashboardAdvertisingListing, dashboardAdvancedStatsMessage, dashboardBillingPeriod, dashboardBumpCount, dashboardCurrentAdvertisingDetails, dashboardPromotionCredits, dashboardSelectedServerAccess } from "../components/onboarding/dashboard-detail-display";
import { getServerVisualShowcase } from "../lib/badges/visuals";
import { onRequest as authMe } from "../functions/api/auth/me";

const health = { server_id: "showcase", current_plan: "premium", source: "live", stale: false };
const now = Date.parse("2026-09-12T12:00:00Z");
const period = { plan_key: "pro", plan_status: "active", cancel_at_period_end: false, current_period_end: "2026-07-18T12:00:00Z" };
assert.deepEqual(dashboardBillingPeriod(period, now), { label: "Billing Date", value: "Needs review (18 Jul 2026)" });
assert.equal(dashboardBillingPeriod({ ...period, current_period_end: "2026-09-12T12:00:00Z" }, now).label, "Billing Date");
assert.equal(dashboardBillingPeriod({ ...period, plan_status: "canceled" }, now).label, "Last Period Ended");
assert.equal(dashboardBillingPeriod({ ...period, current_period_end: "2026-10-12T12:00:00Z" }, now).label, "Renews");
assert.equal(dashboardBillingPeriod({ ...period, cancel_at_period_end: true, current_period_end: "2026-10-12T12:00:00Z" }, now).label, "Cancels On");
assert.equal(dashboardBillingPeriod({ ...period, plan_status: "canceled", current_period_end: "2026-10-12T12:00:00Z" }, now).label, "Billing Period End");
for (const end of [null, "", "invalid"]) assert.equal(dashboardBillingPeriod({ ...period, current_period_end: end }, now).value, "Awaiting Stripe update");
assert.equal(dashboardBillingPeriod(null, now).value, "Checking billing...");
for (const count of [null, undefined, "2", -1, 1.5, NaN, Infinity]) assert.equal(dashboardBumpCount(count), "Checking");
assert.equal(dashboardBumpCount(0), "0");
assert.equal(dashboardBumpCount(3), "3", "Bumps are cooldown-limited, not promotion-credit quota use.");
for (const plan of ["pro", "premium", "network", "partner"]) {
  assert.equal(dashboardAccessLabel(plan), "Pro");
  assert.equal(dashboardPromotionCredits({ plan_key: plan, plan_status: "active" }), "2");
  assert.equal(dashboardPromotionCredits({ plan_key: plan, plan_status: "canceled" }), "0");
}
for (const plan of [null, undefined, "", "unexpected"]) assert.equal(dashboardAccessLabel(plan), "Checking access");
assert.equal(dashboardAccessLabel("free"), "Free");
assert.equal(dashboardAccessLabel("starter"), "Starter");
assert.equal(dashboardPromotionCredits(null), "Checking");
assert.equal(dashboardPromotionCredits({ plan_key: "starter", plan_status: "active" }), "0");
assert.deepEqual(
  dashboardAdvertisingListing(
    { access_source: "complimentary_showcase", effective_listing_plan: "pro", listing_label: "Pro Listing" },
  ),
  { listingTier: "pro", complimentary: true, label: "Pro Listing (complimentary)" },
  "The selected server's complimentary listing must not be labelled from account billing.",
);
assert.deepEqual(
  dashboardAdvertisingListing(
    { access_source: "billing", effective_listing_plan: "free", listing_label: "Free Listing" },
  ),
  { listingTier: "free", complimentary: false, label: "Free Listing" },
  "A fresh server access response must override retained account or grant state.",
);
assert.deepEqual(
  dashboardAdvertisingListing(null),
  { listingTier: null, complimentary: false, label: "Checking plan..." },
  "Missing selected-server access must not borrow the account billing plan.",
);
assert.deepEqual(
  dashboardSelectedServerAccess({
    healthAccess: { source: "billing", effectiveListingPlan: "pro" },
    healthGeneratedAt: "2026-09-19T12:00:00Z",
    advertisingAccess: { access_source: "billing", effective_listing_plan: "free" },
    advertisingGeneratedAt: "2026-09-19T12:01:00Z",
    serverDisplayPlan: "pro",
  }),
  { source: "billing", effectivePlan: "free" },
  "A newer selected-server advertising response must revoke retained health access.",
);
assert.deepEqual(
  dashboardSelectedServerAccess({
    healthAccess: null,
    healthGeneratedAt: null,
    advertisingAccess: { access_source: "complimentary_showcase", effective_listing_plan: "pro" },
    advertisingGeneratedAt: "2026-09-19T12:00:00Z",
    serverDisplayPlan: "free",
  }),
  { source: "complimentary_showcase", effectivePlan: "pro" },
);
assert.deepEqual(
  dashboardSelectedServerAccess({
    healthAccess: { source: "billing", effectiveListingPlan: "pro" },
    healthGeneratedAt: "2026-09-19T12:02:00Z",
    advertisingAccess: { access_source: "complimentary_showcase", effective_listing_plan: "pro" },
    advertisingGeneratedAt: "2026-09-19T12:01:00Z",
    serverDisplayPlan: "pro",
  }),
  { source: "billing", effectivePlan: "pro" },
  "A newer health response must revoke retained complimentary access.",
);
assert.deepEqual(
  dashboardSelectedServerAccess({
    healthAccess: null,
    healthGeneratedAt: "2026-09-19T12:02:00Z",
    advertisingAccess: { access_source: "complimentary_showcase", effective_listing_plan: "pro" },
    advertisingGeneratedAt: "2026-09-19T12:01:00Z",
    serverDisplayPlan: "free",
  }),
  { source: null, effectivePlan: null },
  "A failed health refresh must retain the newer access watermark and not revive an older grant label.",
);
const revokedAccess = dashboardSelectedServerAccess({
  healthAccess: { source: "billing", effectiveListingPlan: "free" },
  healthGeneratedAt: "2026-09-19T12:02:00Z",
  advertisingAccess: { access_source: "complimentary_showcase", effective_listing_plan: "pro" },
  advertisingGeneratedAt: "2026-09-19T12:01:00Z",
  serverDisplayPlan: "free",
});
assert.equal(
  dashboardCurrentAdvertisingDetails({
    healthGeneratedAt: "2026-09-19T12:02:00Z",
    advertisingAccess: { access_source: "complimentary_showcase", effective_listing_plan: "pro" },
    advertisingGeneratedAt: "2026-09-19T12:01:00Z",
  }, revokedAccess),
  null,
  "A newer access revocation must hide the retained complimentary bump cooldown and count.",
);
assert.equal(
  dashboardCurrentAdvertisingDetails({
    healthGeneratedAt: "2026-09-19T12:02:00Z",
    advertisingAccess: { access_source: "billing", effective_listing_plan: "free" },
    advertisingGeneratedAt: "2026-09-19T12:01:00Z",
  }, revokedAccess),
  null,
  "An older bump snapshot must not control current cooldown details even when its access label still matches.",
);
assert.match(dashboardAdvancedStatsMessage("advanced_stats_snapshot_pending"), /not available yet/);
assert.equal(dashboardAdvancedStatsMessage("advanced_stats_snapshot_pending").includes("next readable"), false);
assert.equal(dashboardServerPlan("showcase", health, null), "pro");
for (const plan of ["pro", "premium", "network", "partner"]) {
  assert.equal(dashboardServerPlan("showcase", { ...health, current_plan: plan }, null), "pro");
  assert.equal(dashboardBillingPlan({ plan_key: plan, plan_status: "active" }), "pro");
}
assert.equal(dashboardServerPlan("other", health, null), null, "Previous server data must not bleed into a switched server.");
assert.equal(dashboardServerPlan("showcase", { ...health, source: "local_fallback" }, null), null);
assert.equal(dashboardServerPlan("showcase", { ...health, stale: true }, null), null);
assert.equal(dashboardServerPlan("showcase", { ...health, current_plan: "unexpected" }, null), null);
assert.equal(dashboardServerPlan("showcase", null, null), null, "Missing data is not Free or Starter.");
assert.equal(dashboardServerPlan("showcase", { ...health, current_plan: "free" }, { plan_key: "pro", plan_status: "active" }), "free", "Selected server remains authoritative.");
assert.equal(dashboardServerPlan("showcase", null, { plan_key: "premium", plan_status: "active" }), "pro");
assert.equal(dashboardBillingPlan(null), null, "A server plan cannot populate account billing.");
assert.equal(dashboardServerPlan("showcase", null, null, { plan_tier: "pro", plan_status: "active" }), "pro");
assert.equal(dashboardServerPlan("showcase", null, null, { plan_tier: "pro", plan_status: "past_due" }), null);
assert.equal(dashboardServerPlan("showcase", null, null, { plan_tier: "pro" }), null);
assert.equal(dashboardBillingPlan({ plan_key: "free", plan_status: "none" }), "free");
assert.equal(dashboardBillingPlan({ plan_key: "free", plan_status: "free" }), "free");
assert.equal(dashboardServerPlan("showcase", null, null, { plan_tier: "free", plan_status: "free" }), null, "Auth lookup failures use the same Free navigation as a missing account.");
assert.equal(dashboardServerPlan("showcase", null, { plan_key: "free", plan_status: "free" }, { plan_tier: "free", plan_status: "free" }), "free");
assert.equal(dashboardBillingPlan({ plan_key: "starter", plan_status: "trialing" }), "starter");
assert.equal(dashboardBillingPlan({ plan_key: "pro", plan_status: "past_due" }), "free");
assert.equal(dashboardBillingPlan({ plan_key: "unexpected", plan_status: "active" }), null);
for (const status of ["unknown", "checking", "", "not-recognized"]) {
  assert.equal(dashboardBillingPlan({ plan_key: "premium", plan_status: status }), null);
  assert.equal(dashboardServerPlan("showcase", null, null, { plan_tier: "pro", plan_status: status }), null);
}
const canceledBilling = { plan_key: "pro", plan_status: "canceled" };
assert.equal(dashboardServerPlan("showcase", health, canceledBilling), "pro", "Fresh server-specific access remains authoritative.");
assert.equal(dashboardServerPlan("showcase", null, canceledBilling), "free", "Failed refresh must stop using retained live health.");
const visuals = getServerVisualShowcase({ planKey: dashboardServerPlan("showcase", health, null), reputationTier: "Bronze" });
assert.equal(visuals.planVisualTreatment.label, "Pro");

const source = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.ok(source.includes('label="Bumps This Period" value={dashboardBumpCount(selectedServerAdvertising?.bump_count_current_period)}'));
assert.equal(source.includes('advertisingStatus.included_bumps_per_month'), false);
assert.ok(source.includes('dashboardAccessLabel(wars?.access?.effectivePlan)'));
assert.ok(source.includes('stats?.access?.source === "complimentary_showcase"'));
assert.ok(source.includes('"Pro Listing (complimentary)"'));
assert.ok(source.includes("dashboardSelectedServerAccess("));
assert.ok(source.includes("healthAccess: dashboardHealthFresh ? effectiveDashboardHealth?.server_access ?? null : null"));
assert.ok(source.includes('healthGeneratedAt: effectiveDashboardHealth?.source === "local_fallback"'));
assert.ok(source.includes("advertisingGeneratedAt: advertisingStatusGeneratedAt"));
assert.ok(source.includes("dashboardAdvertisingListing(advertising)"));
assert.ok(source.includes('label: "Bump Cooldown"'));
assert.ok(source.includes('`${selectedServerAdvertising.bump_cooldown_days} days`'));
assert.ok(source.includes('advertising={selectedServerAdvertising}'));
assert.equal(source.includes('advertising={advertisingStatus}'), false);
assert.ok(source.includes('summary && analyticsUnlocked'));
assert.ok(source.includes('stats?.access?.dashboardAnalytics === false'));
assert.ok(source.includes('Pro analytics required'));
assert.ok(source.includes('Core gameplay statistics remain available.'));
assert.ok(source.includes('title="Selected Server Access"'));
assert.ok(source.includes('label="Account Servers" value={accountServersUsed}'));
assert.ok(source.includes('ref={planSummaryPanelRef}'));
assert.ok(source.includes('}, [server.id, activeTab]);'));
assert.equal(source.includes('Stats will appear after the next readable activity import'), false);
assert.ok(source.includes('dashboardServerPlan(server.id, dashboardHealthFresh ? effectiveDashboardHealth : null, effectiveBillingStatus, navigation)'));
assert.ok(source.includes("setDashboardHealthFresh(true);"));
const initialHealth = source.slice(source.indexOf("const refreshInitialServerHealth = () => {"), source.indexOf("}, [refreshDashboardHealth]);"));
assert.ok(initialHealth.includes('if (started || document.visibilityState === "hidden") return;'));
assert.ok(initialHealth.includes("void refreshDashboardHealth();"));
assert.ok(initialHealth.includes('document.removeEventListener("visibilitychange", refreshInitialServerHealth)'));
assert.equal(initialHealth.includes("setInterval"), false, "Overview needs initial server health, not repeated heavy polling.");
assert.match(source, /setFailedEndpoint\("dashboard-health"\);\s*setDashboardHealthFresh\(false\);/);
assert.equal(source.includes('effectiveBillingStatus?.plan_key ?? "starter"'), false);
assert.ok(source.includes('serverDisplayPlan === null ? <p'));
assert.ok(source.includes('planKey === null ? "Checking billing..." : planLabel(planKey)'));
assert.equal((source.match(/disabled=\{planKey === null \|\| busyPlan/g) ?? []).length, 2);
assert.ok(source.includes('if (dashboardBillingPlan(billing) === null) return;'));
assert.ok(source.includes("const listing = dashboardAdvertisingListing(advertising);"));
async function testAuthBillingFailure() {
  for (const fail of [false, true]) {
    let billingLookupReached = false;
    const env = { SESSION_SECRET: "synthetic-display-test", DB: { prepare(sql: string) {
      assert.match(sql.trim(), /^SELECT/i, "Auth display regression must be read-only.");
      return {
        bind() { return this; },
        async all() { return { results: [] }; },
        async first() {
          if (sql.includes("FROM sessions")) return { id: "owner", discord_id: "123456789012345678", username: "Example", avatar: null };
          assert.ok(sql.includes("FROM owner_billing_accounts"));
          billingLookupReached = true;
          if (fail) throw new Error("Synthetic billing lookup failure");
          return null;
        },
      };
    } } };
    const response = await authMe({ env, request: new Request("https://example.test/api/auth/me", { headers: { cookie: "dzn_session=synthetic" } }) } as unknown as Parameters<typeof authMe>[0]);
    assert.equal(response.status, 200);
    const payload = await response.json() as { navigation: { plan_tier: string; plan_status: string } };
    assert.equal(billingLookupReached, true);
    assert.equal(payload.navigation.plan_tier, "free");
    assert.equal(payload.navigation.plan_status, "free");
    assert.equal(dashboardServerPlan("showcase", null, null, payload.navigation), null, "Neither ambiguous auth outcome proves Free.");
  }
}

void testAuthBillingFailure().then(() => console.log("Dashboard plan display and auth-failure tests passed.")).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
