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
  dashboard.includes("const LIVE_STATS_POLL_INTERVAL_MS = 30000"),
  true,
  "Overview live-stats cadence must be 2 requests/minute after the initial request.",
);
assert.equal(
  dashboard.includes("const SYNC_POLL_INTERVAL_MS = 30000"),
  true,
  "Sync status and recent events cadence must be 2 requests/minute after the initial request.",
);
assert.equal(
  dashboard.includes("const DASHBOARD_HEALTH_POLL_INTERVAL_MS = 120000"),
  true,
  "Heavy dashboard health cadence must be at most 1 request/2 minutes.",
);

assert.equal(
  countOccurrences(liveStatsCallback, "getDashboardLiveStats("),
  1,
  "Live-stats callback must issue exactly one HTTP request.",
);
assert.equal(
  countOccurrences(healthCallback, "getDashboardHealth("),
  1,
  "Dashboard health callback must issue exactly one HTTP request.",
);
assert.equal(
  countOccurrences(syncCallback, "getSyncStatus("),
  1,
  "Sync callback must issue exactly one sync-status request.",
);
assert.equal(
  countOccurrences(syncCallback, "getRecentSyncEvents("),
  1,
  "Sync callback must issue exactly one recent-events request.",
);
assert.equal(
  syncCallback.includes("getNitradoLogSettings"),
  false,
  "Nitrado log settings must not repeat on the 30-second sync poll.",
);
assert.equal(
  countOccurrences(dashboard, "getNitradoLogSettings("),
  2,
  "Nitrado log settings may be fetched initially and by an explicit manual check only.",
);
assert.equal(
  countOccurrences(liveStatsPollingEffect, "window.setInterval"),
  1,
  "Live-stats must have one polling interval.",
);
assert.equal(
  countOccurrences(syncPollingEffect, "window.setInterval"),
  1,
  "Sync feeds must have one polling interval.",
);
assert.equal(
  countOccurrences(healthPollingEffect, "window.setInterval"),
  1,
  "Dashboard health must have one polling interval when Sync Health is active.",
);
assert.equal(
  healthPollingEffect.includes("if (activeTab !== \"sync-health\") return;"),
  true,
  "Heavy dashboard health polling must not run from Overview.",
);
assert.equal(
  liveStatsCallback.includes("skipped_in_flight"),
  true,
  "Live-stats polling must report skipped intervals when a request is in flight.",
);
assert.equal(
  healthCallback.includes("skipped_in_flight"),
  true,
  "Dashboard health polling must report skipped intervals when a request is in flight.",
);
assert.equal(
  dashboard.includes("process.env.NODE_ENV !== \"development\""),
  true,
  "Request diagnostics must be development-only.",
);

console.log("Dashboard request-volume tests passed.");
