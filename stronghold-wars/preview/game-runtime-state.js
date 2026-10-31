export const BUILDING_KEYS = Object.freeze(['hq', 'workshop', 'tower', 'comms', 'depot']);

export function expireRevealEffects(revealEffects, now) {
  for (const [key, deadline] of revealEffects) {
    if (!Number.isFinite(Number(deadline)) || Number(deadline) <= now) revealEffects.delete(key);
  }
}

export function buildingScaffoldState({ legacyJobs = [], projects = [], revealEffects = new Map(), now = Date.now() } = {}) {
  expireRevealEffects(revealEffects, now);
  const legacyKeys = new Set(legacyJobs.map(job => job.key));
  const constructionKeys = new Set(projects.filter(project => project.status === 'constructing' && project.startedAt <= now).map(project => project.key));
  return Object.fromEntries(BUILDING_KEYS.map(key => [key, legacyKeys.has(key) || constructionKeys.has(key) || revealEffects.has(key)]));
}

// Keeps same-community member changes presentation-neutral while making the shared
// community snapshot authoritative whenever the selected community changes.
export function reconcileBuildingSnapshot(previousCommunityId, communityId, levels, renderedLevels = {}) {
  const communityChanged = previousCommunityId !== communityId;
  const changedKeys = BUILDING_KEYS.filter(key => communityChanged || renderedLevels[key] !== levels[key]);
  return { communityChanged, changedKeys, levels: { ...levels } };
}
