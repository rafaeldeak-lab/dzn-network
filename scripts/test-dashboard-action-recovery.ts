import assert from "node:assert/strict";
import {
  DASHBOARD_ACTION_RESUME_MAX_AGE_MS,
  getPersistedDashboardActionExpiryDelay,
  isPersistedDashboardActionActive,
  shouldDiscardPersistedDashboardAction,
} from "../lib/dashboard-action-recovery";

const now = Date.parse("2026-10-20T12:00:00.000Z");
const fresh = new Date(now - 15 * 60 * 1000).toISOString();
const stale = new Date(now - DASHBOARD_ACTION_RESUME_MAX_AGE_MS - 1).toISOString();
const future = new Date(now + 5 * 60 * 1000 + 1).toISOString();

assert.equal(isPersistedDashboardActionActive("queued"), true);
assert.equal(isPersistedDashboardActionActive("running"), true);
assert.equal(isPersistedDashboardActionActive("polling"), true);
assert.equal(isPersistedDashboardActionActive("completed"), false);
assert.equal(getPersistedDashboardActionExpiryDelay({ status: "completed", startedAt: fresh, lastUpdatedAt: fresh }, now), false);
assert.equal(
  getPersistedDashboardActionExpiryDelay({ status: "running", startedAt: fresh, lastUpdatedAt: fresh }, now),
  DASHBOARD_ACTION_RESUME_MAX_AGE_MS - 15 * 60 * 1000,
  "An active action must be re-checked when its resume window expires.",
);

assert.equal(
  shouldDiscardPersistedDashboardAction({ status: "running", startedAt: fresh, lastUpdatedAt: fresh }, now),
  false,
  "A recent active action must resume after a reload.",
);
assert.equal(
  shouldDiscardPersistedDashboardAction({ status: "running", startedAt: stale, lastUpdatedAt: stale }, now),
  true,
  "An abandoned active action must not permanently lock the dashboard.",
);
assert.equal(
  shouldDiscardPersistedDashboardAction({ status: "polling", startedAt: "not-a-date", lastUpdatedAt: null }, now),
  true,
  "Malformed active state must not disable dashboard controls.",
);
assert.equal(
  shouldDiscardPersistedDashboardAction({ status: "queued", startedAt: future, lastUpdatedAt: future }, now),
  true,
  "A materially future action timestamp must not block a dashboard after a bad client clock.",
);
assert.equal(
  shouldDiscardPersistedDashboardAction({ status: "completed", startedAt: stale, lastUpdatedAt: stale }, now),
  false,
  "Terminal action history does not need active-action recovery handling.",
);

console.log("Dashboard action recovery checks passed.");
