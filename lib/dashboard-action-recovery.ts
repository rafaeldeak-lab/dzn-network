const ACTIVE_DASHBOARD_ACTION_STATUSES = new Set(["queued", "running", "polling"]);

// The browser ADM runner can work for around 30 minutes, so preserve a wide resume window.
export const DASHBOARD_ACTION_RESUME_MAX_AGE_MS = 2 * 60 * 60 * 1000;

type PersistedDashboardAction = {
  status?: string | null;
  startedAt?: string | null;
  lastUpdatedAt?: string | null;
};

export function isPersistedDashboardActionActive(status?: string | null) {
  return Boolean(status && ACTIVE_DASHBOARD_ACTION_STATUSES.has(status));
}

export function getPersistedDashboardActionExpiryDelay(action: PersistedDashboardAction, now = Date.now()) {
  if (!isPersistedDashboardActionActive(action.status)) return false;

  const checkpoints = [action.startedAt, action.lastUpdatedAt]
    .map((value) => Date.parse(value ?? ""))
    .filter((value) => Number.isFinite(value));

  if (!checkpoints.length) return 0;

  const mostRecentCheckpoint = Math.max(...checkpoints);
  if (mostRecentCheckpoint > now + 5 * 60 * 1000) return 0;
  return Math.max(0, mostRecentCheckpoint + DASHBOARD_ACTION_RESUME_MAX_AGE_MS - now);
}

export function shouldDiscardPersistedDashboardAction(action: PersistedDashboardAction, now = Date.now()) {
  const expiryDelay = getPersistedDashboardActionExpiryDelay(action, now);
  return expiryDelay === 0;
}
