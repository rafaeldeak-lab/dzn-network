import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync("components/onboarding/dashboard.tsx", "utf8").replace(/\r\n/g, "\n");

function sliceBetween(startMarker: string, endMarker: string) {
  const start = dashboard.indexOf(startMarker);
  const end = dashboard.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing marker: ${endMarker}`);
  return dashboard.slice(start, end);
}

const refreshBilling = sliceBetween(
  "const refreshBilling = useCallback",
  "const refreshDiscordPostingSetup = useCallback",
);
const refreshDiscordPostingSetup = sliceBetween(
  "const refreshDiscordPostingSetup = useCallback",
  "const refreshSyncHealthDiagnostics = useCallback",
);
const refreshSyncHealthDiagnostics = sliceBetween(
  "const refreshSyncHealthDiagnostics = useCallback",
  "useEffect(() => {\n    if (activeTab !== \"billing\") return;",
);
const refreshSyncData = sliceBetween(
  "const refreshSyncData = useCallback",
  "async function refreshDashboardDataAfterAction",
);
const refreshAfterAction = sliceBetween(
  "async function refreshDashboardDataAfterAction",
  "async function refreshDashboardAfterManualAdmImport",
);

assert.equal(
  dashboard.includes("const OPTIONAL_DASHBOARD_MAX_IN_FLIGHT = 2"),
  true,
  "Dashboard optional requests must be bounded to two in flight.",
);
assert.equal(
  dashboard.includes("const OPTIONAL_DASHBOARD_RETRY_LIMIT = 1"),
  true,
  "Dashboard optional retries must be bounded.",
);
assert.equal(
  dashboard.includes("const refreshDashboardLiveStats = useCallback"),
  true,
  "Overview must keep the lightweight canonical live-stats stream.",
);
assert.equal(
  dashboard.includes("const refreshSyncData = useCallback"),
  true,
  "Overview must keep the lightweight sync/recent-event stream.",
);

assert.equal(
  refreshBilling.includes("getPostingDestinations("),
  false,
  "Billing refresh must not pull Discord posting destinations.",
);
assert.equal(
  refreshBilling.includes("getDiscordPostingChannels("),
  false,
  "Billing refresh must not pull Discord channels.",
);
assert.equal(
  refreshBilling.includes("getNitradoLogSettings("),
  false,
  "Billing refresh must not verify Nitrado log settings.",
);
assert.equal(
  refreshBilling.includes("getAutomationHealth("),
  false,
  "Billing refresh must not load Sync Health diagnostics.",
);

assert.equal(
  refreshDiscordPostingSetup.includes("getPostingDestinations("),
  true,
  "Discord Posts tab must load saved posting destinations.",
);
assert.equal(
  refreshDiscordPostingSetup.includes("getDiscordPostingChannels("),
  true,
  "Discord Posts tab must load cached Discord channel state.",
);
assert.equal(
  refreshSyncHealthDiagnostics.includes("getNitradoLogSettings("),
  true,
  "Sync Health diagnostics may load saved Nitrado settings.",
);
assert.equal(
  refreshSyncData.includes("getNitradoLogSettings("),
  false,
  "The 30-second core sync stream must not fetch Nitrado log settings.",
);
assert.equal(
  refreshSyncData.includes("getPostingDestinations("),
  false,
  "The 30-second core sync stream must not fetch Discord posting destinations.",
);
assert.equal(
  refreshSyncData.includes("getBillingStatus("),
  false,
  "The 30-second core sync stream must not fetch billing.",
);

assert.equal(
  dashboard.includes("if (activeTab !== \"billing\") return;"),
  true,
  "Billing routes must load only on the Billing tab.",
);
assert.equal(
  dashboard.includes("if (activeTab !== \"discord-posts\") return;"),
  true,
  "Discord routes must load only on the Discord Posts tab.",
);
assert.equal(
  dashboard.includes("if (activeTab !== \"sync-health\" || !showInternalSyncSupportTools) return;"),
  true,
  "Internal Sync Health diagnostics must not load from Overview.",
);
assert.equal(
  refreshAfterAction.includes("includeFull && activeTab === \"billing\""),
  true,
  "Full dashboard action refreshes must not reload billing unless the Billing tab is active.",
);
assert.equal(
  refreshAfterAction.includes("includeFull && activeTab === \"discord-posts\""),
  true,
  "Full dashboard action refreshes must not reload Discord setup unless the Discord Posts tab is active.",
);

assert.equal(
  dashboard.includes("const advancedStatsPanelRef = useRef"),
  true,
  "Advanced Stats must be attached to a visibility gate.",
);
assert.equal(
  dashboard.includes("const serverWarsPanelRef = useRef"),
  true,
  "Server Wars must be attached to a visibility gate.",
);
assert.equal(
  dashboard.includes("new IntersectionObserver"),
  true,
  "Below-fold optional modules must load through IntersectionObserver.",
);
assert.equal(
  dashboard.includes("advancedStatsRequestedRef.current"),
  true,
  "Advanced Stats must load at most once per selected-server visibility cycle.",
);
assert.equal(
  dashboard.includes("serverWarsRequestedRef.current"),
  true,
  "Server Wars must load at most once per selected-server visibility cycle.",
);

console.log("Dashboard core-first load tests passed.");
