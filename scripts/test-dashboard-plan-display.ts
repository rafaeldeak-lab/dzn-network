import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dashboardBillingPlan, dashboardServerPlan } from "../components/onboarding/dashboard-plan-display";
import { dashboardAccessLabel, dashboardAdvancedStatsMessage, dashboardBillingPeriod, dashboardBumpCount, dashboardPromotionCredits } from "../components/onboarding/dashboard-detail-display";
import { getServerVisualShowcase } from "../lib/badges/visuals";
import { onRequest as authMe } from "../functions/api/auth/me";

const health = { server_id: "showcase", current_plan: "premium", source: "live", stale: false };
const now = Date.parse("2026-09-12T12:00:00Z");
const period = { plan_key: "pro", plan_status: "active", cancel_at_period_end: false, current_period_end: "2026-07-18T12:00:00Z" };
assert.deepEqual(dashboardBillingPeriod(period, now), { label: "Last Period Ended", value: "18 Jul 2026" });
assert.equal(dashboardBillingPeriod({ ...period, current_period_end: "2026-09-12T12:00:00Z" }, now).label, "Last Period Ended");
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
assert.ok(source.includes('label="Bumps This Period" value={dashboardBumpCount(advertisingStatus?.bump_count_current_period)}'));
assert.equal(source.includes('advertisingStatus.included_bumps_per_month'), false);
assert.ok(source.includes('dashboardAccessLabel(wars?.access?.effectivePlan)'));
assert.ok(source.includes('dashboardAccessLabel(stats?.access?.effectivePlan)'));
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
assert.ok(source.includes('dashboardBillingPlan(billing) === null ? "Checking plan..."'));
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
