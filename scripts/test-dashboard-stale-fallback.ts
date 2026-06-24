import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync("components/onboarding/dashboard.tsx", "utf8");

assert.equal(
  dashboard.includes("const canonicalStats = dashboardLiveStats?.stats"),
  true,
  "Dashboard must build a single canonical stat snapshot.",
);
assert.equal(
  dashboard.includes("?? latestCanonicalDashboardHealth?.stats"),
  true,
  "Dashboard health canonical stats must be the second priority.",
);
assert.equal(
  dashboard.includes("?? lastGoodDashboardLiveStats?.stats"),
  true,
  "Last-good live stats must be available as a fallback.",
);
assert.equal(
  dashboard.includes("?? lastGoodDashboardStats?.stats"),
  true,
  "Local fallback must be used only after canonical live/health data is unavailable.",
);

const statValuesBlock = dashboard.slice(
  dashboard.indexOf("const dashboardStatValues = {"),
  dashboard.indexOf("const ownerReputationTier"),
);
assert.equal(statValuesBlock.includes("effectiveSyncData?.total_kills"), false, "Sync-status kills must not override canonical stats.");
assert.equal(statValuesBlock.includes("effectiveSyncData?.total_deaths"), false, "Sync-status deaths must not override canonical stats.");
assert.equal(statValuesBlock.includes("server.score"), false, "Auth/server props must not override canonical score.");
assert.equal(statValuesBlock.includes("canonicalStats?.kills"), true, "Stat values must use the canonical snapshot.");
assert.equal(statValuesBlock.includes("canonicalStats?.unique_players"), true, "Unique players must use the canonical snapshot.");

assert.equal(
  dashboard.includes("const shouldShowLiveRefreshWarning = Boolean(liveRefreshWarning);"),
  true,
  "Cached data must not hide live refresh warnings.",
);
assert.equal(
  dashboard.includes("Live stat refresh failed. Showing last successful canonical data from"),
  true,
  "Live stat failures must show an explicit last-good warning.",
);
assert.equal(
  dashboard.includes("showingLastKnownCanonicalStats || liveStatsError ? \"Last known\" : \"Live\""),
  true,
  "Stat cards must label last-known values.",
);
assert.equal(
  dashboard.includes("setLiveStatsError(\"\");"),
  true,
  "Successful live-stat refresh must clear stale warning state.",
);
assert.equal(
  dashboard.includes("setDashboardLiveStats(response);"),
  true,
  "Successful live-stat refresh must update the canonical snapshot atomically.",
);
assert.equal(
  dashboard.includes("<LiveSyncStats stats={stats} canonicalStatsStatusDetail={canonicalStatsStatusDetail} showingLastKnownStats={showingLastKnownStats} />"),
  true,
  "Overview and Sync Health must use the same canonical snapshot metadata.",
);
assert.equal(
  dashboard.includes("getMe(),\n      getSyncStatus(server.id)"),
  true,
  "Manual import refresh may refresh auth/server metadata once after a write.",
);

console.log("Dashboard stale-fallback tests passed.");
