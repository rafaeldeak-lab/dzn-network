import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync("components/onboarding/dashboard.tsx", "utf8");
const api = readFileSync("components/onboarding/api.ts", "utf8");
const types = readFileSync("components/onboarding/types.ts", "utf8");

const admJobCompletionBlock = dashboard.slice(
  dashboard.indexOf("if (isCompletedAdmImportJobStatus(response.job.status))"),
  dashboard.indexOf("} catch {", dashboard.indexOf("if (isCompletedAdmImportJobStatus(response.job.status))")),
);
const planSummaryBlock = dashboard.slice(
  dashboard.indexOf("const refreshPlanSummary"),
  dashboard.indexOf("const refreshDiscordPostingSetup"),
);

assert.equal(api.includes("getDashboardLiveStats"), true, "Client API must expose the lightweight live-stats helper.");
assert.equal(api.includes("/dashboard/live-stats"), true, "Client API must call the protected live-stats route.");
assert.equal(api.includes("credentials: \"include\""), true, "Live-stats fetch must include the owner session.");
assert.equal(types.includes("DashboardLiveStatsResult"), true, "Live-stats response must be typed.");

assert.equal(dashboard.includes("const LIVE_STATS_POLL_INTERVAL_MS = 30000"), true, "Live stats must poll every 30 seconds.");
assert.equal(dashboard.includes("const DASHBOARD_HEALTH_POLL_INTERVAL_MS = 120000"), true, "Heavy dashboard health must poll every 120 seconds.");
assert.equal(dashboard.includes("liveStatsRequestIdRef"), true, "Live stats must use request ordering.");
assert.equal(dashboard.includes("activeServerIdRef"), true, "Live stats must guard against selected-server changes.");
assert.equal(dashboard.includes("lastAppliedLiveStatsGeneratedAtRef"), true, "Live stats must compare generated_at values.");
assert.equal(dashboard.includes("advertisingRequestIdRef"), true, "Advertising access must use request ordering.");
assert.equal(dashboard.includes("lastAppliedAdvertisingRequestIdRef"), true, "Advertising access must retain the newest applied request.");
assert.equal(dashboard.includes("lastAppliedAdvertisingGeneratedAtRef"), true, "Advertising access must retain the newest response timestamp.");
assert.equal(dashboard.includes("billingRequestIdRef"), true, "Account billing must use request ordering across every dashboard loader.");
assert.equal(dashboard.includes("lastAppliedBillingRequestIdRef"), true, "Account billing must retain the newest applied request.");
assert.equal(dashboard.includes("input.requestId < lastAppliedBillingRequestIdRef.current"), true, "Older account-billing requests must be ignored.");
assert.equal(dashboard.includes("input.requestId < billingRequestIdRef.current"), false, "A successful billing response must survive when a newer request merely started and then failed.");
assert.equal(dashboard.includes("requestId: billing.requestId"), true, "The Billing tab must apply its account response through the shared ordering guard.");
assert.equal(planSummaryBlock.includes("requestId: result.requestId"), true, "The Overview summary must apply its account response through the shared ordering guard.");
const planSummaryBarrierIndex = planSummaryBlock.indexOf("await Promise.allSettled");
const planSummaryBillingApplyIndex = planSummaryBlock.indexOf("applyBillingStatus({");
const planSummaryAdvertisingApplyIndex = planSummaryBlock.indexOf("applyAdvertisingStatus({");
assert.ok(planSummaryBarrierIndex >= 0, "Overview must settle both requests before reporting the combined refresh result.");
assert.ok(planSummaryBillingApplyIndex >= 0 && planSummaryBillingApplyIndex < planSummaryBarrierIndex, "Overview must apply account billing without waiting for selected-server access.");
assert.ok(planSummaryAdvertisingApplyIndex >= 0 && planSummaryAdvertisingApplyIndex < planSummaryBarrierIndex, "Overview must apply selected-server access without waiting for account billing.");
assert.equal(dashboard.includes("advertisingAccessRecoveryKeyRef"), true, "An accepted access change must have a bounded advertising recovery guard.");
assert.equal(dashboard.includes("(!planSummaryVisible && activeTab !== \"billing\")"), true, "Advertising recovery must remain active for the Billing tab as well as the Overview summary.");
assert.equal(dashboard.includes("!advertisingStatus ||\n      selectedServerAdvertising"), true, "Only an invalidated retained advertising snapshot should trigger recovery.");
assert.equal(dashboard.includes("advertisingAccessRecoveryKeyRef.current === recoveryKey"), true, "Advertising recovery must run at most once per accepted access version.");
assert.equal(dashboard.includes("input.requestId < lastAppliedAdvertisingRequestIdRef.current"), true, "Older advertising requests must be ignored.");
assert.equal(dashboard.includes("input.requestId < advertisingRequestIdRef.current"), false, "A successful advertising response must survive when a newer request merely started and then failed.");
assert.equal(dashboard.includes("isOlderGeneratedAt(input.generatedAt, lastAppliedAdvertisingGeneratedAtRef.current)"), true, "Older advertising snapshots must be ignored.");
assert.equal(dashboard.includes("applyAdvertisingStatus({ requestServerId: server.id, requestId, generatedAt, advertising: next })"), true, "A completed bump must invalidate earlier advertising reads.");
assert.equal(dashboard.includes("isOlderGeneratedAt(response.generated_at, lastAppliedLiveStatsGeneratedAtRef.current)"), true, "Older live-stat responses must be ignored.");
assert.equal(dashboard.includes("response.server_id !== requestServerId"), true, "Responses for the wrong server must be ignored.");
assert.equal(dashboard.includes("activeServerIdRef.current !== requestServerId"), true, "Previous-server responses must be ignored after switching servers.");
assert.equal(dashboard.includes("setDashboardLiveStats(null);"), true, "Switching servers must clear current live stats.");
assert.equal(dashboard.includes("loadDashboardLiveStatsCache(serverProp.id)"), true, "Switching servers must load only the selected server cache.");
assert.equal(dashboard.includes("dashboardLiveStatsCacheKey(serverId)"), true, "Live stats cache keys must include server id.");
assert.equal(dashboard.includes("parsed?.ok && parsed.server_id === serverId"), true, "Live stats cache must reject another server's data.");
assert.equal(dashboard.includes("document.visibilityState === \"hidden\""), true, "Polling must pause while hidden.");
assert.equal(dashboard.includes("document.addEventListener(\"visibilitychange\""), true, "Polling must refresh on visibility.");
assert.equal(dashboard.includes("refreshDashboardLiveStats();"), true, "Dashboard must invoke live stat refresh directly.");
assert.equal(admJobCompletionBlock.includes("void refreshDashboardLiveStats();"), true, "Completed ADM jobs must trigger live refreshes.");
assert.equal(admJobCompletionBlock.includes("void refreshDashboardHealth();"), true, "Completed ADM jobs must trigger heavy refreshes.");
assert.equal(dashboard.includes("Promise.resolve().then(refreshDashboardLiveStats)"), false, "Live stats must not have a duplicate standalone initial effect.");
assert.equal(dashboard.includes("Promise.resolve().then(refreshDashboardHealth)"), false, "Dashboard health must not have a duplicate standalone initial effect.");

console.log("Dashboard response-ordering tests passed.");
