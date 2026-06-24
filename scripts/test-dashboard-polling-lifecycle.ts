import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync("components/onboarding/dashboard.tsx", "utf8");

function sliceBetween(startMarker: string, endMarker: string) {
  const start = dashboard.indexOf(startMarker);
  const end = dashboard.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing marker: ${endMarker}`);
  return dashboard.slice(start, end);
}

function countOccurrences(source: string, needle: string) {
  return source.split(needle).length - 1;
}

const liveStatsCallback = sliceBetween(
  "const refreshDashboardLiveStats = useCallback",
  "const refreshDashboardHealth = useCallback",
);
const healthCallback = sliceBetween(
  "const refreshDashboardHealth = useCallback",
  "const latestCanonicalDashboardHealth",
);
const syncCallback = sliceBetween(
  "const refreshSyncData = useCallback",
  "async function refreshDashboardDataAfterAction",
);
const liveStatsPollingEffect = sliceBetween(
  "const refreshVisibleLiveStats = () => {",
  "}, [refreshDashboardLiveStats]);",
);
const healthPollingEffect = sliceBetween(
  "if (activeTab !== \"sync-health\") return;",
  "}, [activeTab, refreshDashboardHealth]);",
);
const syncPollingEffect = sliceBetween(
  "const refreshVisibleSyncData = () => {",
  "}, [refreshSyncData]);",
);

assert.equal(
  syncCallback.includes("lastRefreshedAtRef.current"),
  true,
  "Sync refresh must read the latest refresh timestamp from a ref.",
);
assert.match(
  syncCallback,
  /\}, \[server\.id\]\);/,
  "Sync refresh must not depend on state it mutates, such as lastRefreshedAt.",
);
assert.equal(
  syncCallback.includes("getNitradoLogSettings"),
  false,
  "Nitrado log settings must not be part of the 30-second sync poll.",
);

assert.match(
  liveStatsCallback,
  /\}, \[server\.id\]\);/,
  "Live-stats refresh must only be recreated for a selected-server change.",
);
assert.equal(
  liveStatsCallback.includes("liveStatsInFlightRef.current"),
  true,
  "Live-stats refresh must skip overlapping requests.",
);
assert.equal(
  liveStatsCallback.includes("failedEndpointRef.current"),
  true,
  "Live-stats refresh must read failed endpoint state through a ref.",
);
assert.equal(
  liveStatsCallback.includes("failedEndpoint,"),
  false,
  "Live-stats refresh must not depend on failedEndpoint state directly.",
);

assert.match(
  healthCallback,
  /\}, \[server\.id\]\);/,
  "Dashboard health refresh must only be recreated for a selected-server change.",
);
assert.equal(
  healthCallback.includes("dashboardHealthInFlightRef.current"),
  true,
  "Dashboard health refresh must skip overlapping requests.",
);
assert.equal(
  healthCallback.includes("recentEventsRef.current"),
  true,
  "Dashboard health refresh must read recent events through a ref.",
);
assert.equal(
  healthCallback.includes("lastGoodAdmJobRef.current"),
  true,
  "Dashboard health refresh must read ADM job state through a ref.",
);
assert.equal(
  healthCallback.includes("recentEvents.length"),
  false,
  "Recent event updates must not recreate the health polling callback.",
);

assert.equal(
  countOccurrences(dashboard, "Promise.resolve().then(refreshDashboardLiveStats)"),
  0,
  "Live-stats must not have a duplicate standalone immediate effect.",
);
assert.equal(
  countOccurrences(dashboard, "Promise.resolve().then(refreshDashboardHealth)"),
  0,
  "Dashboard health must not have a duplicate standalone immediate effect.",
);
assert.equal(
  countOccurrences(liveStatsPollingEffect, "window.setTimeout(refreshVisibleLiveStats, 0)"),
  1,
  "Live-stats polling owns exactly one initial request.",
);
assert.equal(
  countOccurrences(syncPollingEffect, "window.setTimeout(refreshVisibleSyncData, 0)"),
  1,
  "Sync polling owns exactly one initial request.",
);
assert.equal(
  countOccurrences(healthPollingEffect, "window.setTimeout(refreshVisibleHealth, 0)"),
  1,
  "Dashboard health polling owns exactly one initial request when Sync Health is active.",
);
assert.equal(
  healthPollingEffect.includes("document.visibilityState === \"hidden\""),
  true,
  "Dashboard health polling must pause while hidden.",
);
assert.equal(
  liveStatsPollingEffect.includes("document.visibilityState === \"hidden\""),
  true,
  "Live-stats polling must pause while hidden.",
);
assert.equal(
  syncPollingEffect.includes("document.visibilityState === \"hidden\""),
  true,
  "Sync polling must pause while hidden.",
);
assert.equal(
  dashboard.includes("const LIVE_STATS_TIMEOUT_MS = 8000"),
  true,
  "Live-stats requests must have a bounded timeout.",
);
assert.equal(
  dashboard.includes("const DASHBOARD_HEALTH_TIMEOUT_MS = 12000"),
  true,
  "Dashboard health requests must have a bounded timeout.",
);
assert.equal(
  dashboard.includes("const SYNC_FEED_TIMEOUT_MS = 10000"),
  true,
  "Sync feed requests must have a bounded timeout.",
);

console.log("Dashboard polling lifecycle tests passed.");
