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

const optionalPump = sliceBetween(
  "const pumpOptionalDashboardRequests = useCallback",
  "const runOptionalDashboardRequest = useCallback",
);
const optionalRunner = sliceBetween(
  "const runOptionalDashboardRequest = useCallback",
  "useEffect(() => {\n    onRefreshRef.current = onRefresh;",
);
const serverSwitchReset = sliceBetween(
  "activeServerIdRef.current = serverProp.id;",
  "cancelled = true;",
);

assert.equal(
  optionalPump.includes("optionalRequestActiveCountRef.current < OPTIONAL_DASHBOARD_MAX_IN_FLIGHT"),
  true,
  "Optional request pump must enforce the shared concurrency limit.",
);
assert.equal(
  optionalPump.includes("request.generation !== optionalRequestGenerationRef.current"),
  true,
  "Optional request pump must reject stale generation work.",
);
assert.equal(
  optionalPump.includes("request.serverId !== activeServerIdRef.current"),
  true,
  "Optional request pump must reject old-server work.",
);
assert.equal(
  optionalPump.includes("optional_started"),
  true,
  "Optional request diagnostics must record starts in development.",
);
assert.equal(
  optionalPump.includes("optional_finished"),
  true,
  "Optional request diagnostics must record completions in development.",
);
assert.equal(
  optionalRunner.includes("OPTIONAL_DASHBOARD_RETRY_LIMIT"),
  true,
  "Optional request runner must enforce a retry limit.",
);
assert.equal(
  optionalRunner.includes("isRetryableDashboardOptionalError"),
  true,
  "Optional request runner must retry only retryable failures.",
);
assert.equal(
  optionalRunner.includes("optional_retry_scheduled"),
  true,
  "Optional request retries must be visible in development diagnostics.",
);
assert.equal(
  optionalRunner.includes("sleepDashboardOptionalRetry(randomDashboardOptionalRetryDelayMs())"),
  true,
  "Optional request retry must use bounded jitter instead of immediate storms.",
);
assert.equal(
  serverSwitchReset.includes("optionalRequestGenerationRef.current += 1"),
  true,
  "Server switching must invalidate optional requests.",
);
assert.equal(
  serverSwitchReset.includes("optionalRequestQueueRef.current = []"),
  true,
  "Server switching must clear queued optional requests.",
);
assert.equal(
  serverSwitchReset.includes("advancedStatsRequestedRef.current = false"),
  true,
  "Server switching must reset Advanced Stats visibility state.",
);
assert.equal(
  serverSwitchReset.includes("serverWarsRequestedRef.current = false"),
  true,
  "Server switching must reset Server Wars visibility state.",
);

console.log("Dashboard optional concurrency tests passed.");
