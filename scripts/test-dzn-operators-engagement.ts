import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { getDznOperatorsFeatureFlags } from "../lib/operators/feature-flags";
import { getOperatorChallengeCatalog, getChallengesForCategory } from "../lib/operators/engagement/challenges";
import { DEMO_OPERATOR_PLAYERS, getDemoLeaderboardRows } from "../lib/operators/engagement/demo-data";
import { buildOperatorLeaderboardRows } from "../lib/operators/engagement/leaderboards";
import { parseOperatorEngagementPreviewStorage } from "../lib/operators/engagement/local-preview";
import {
  applyOperatorEngagementEvent,
  assertNoEngagementCompetitiveFields,
  calculateChallengeProgress,
  claimOperatorRewardPreview,
  createOperatorEngagementState,
  getChallengeCompletionState,
  getClaimableOperatorRewards,
} from "../lib/operators/engagement/progress";
import { buildOperatorPlayerProfile, buildOperatorServerCommunityProfile } from "../lib/operators/engagement/profile-builders";
import { getOperatorRankProgress, OPERATOR_RANKS } from "../lib/operators/engagement/ranks";
import { OPERATOR_ACHIEVEMENTS, OPERATOR_STREAK_REWARDS } from "../lib/operators/engagement/rewards";
import { getNextOperatorDailyReset, getNextOperatorWeeklyReset } from "../lib/operators/engagement/reset-windows";
import { recordOperatorDailyCheckIn } from "../lib/operators/engagement/streaks";
import { freeCompetitionParticipation } from "../lib/operators/loadout";

const defaultFlags = getDznOperatorsFeatureFlags({});
assert.deepEqual(defaultFlags, { enabled: false, demoMode: false });
assert.equal(defaultFlags.engagementEnabled, false);
const phaseOneOnlyFlags = getDznOperatorsFeatureFlags({ NEXT_PUBLIC_DZN_OPERATORS_ENABLED: "true" });
assert.deepEqual(phaseOneOnlyFlags, { enabled: true, demoMode: false });
assert.equal(phaseOneOnlyFlags.engagementEnabled, false);
const allFlags = getDznOperatorsFeatureFlags({
  NEXT_PUBLIC_DZN_OPERATORS_ENABLED: "true",
  NEXT_PUBLIC_DZN_OPERATORS_DEMO_MODE: "true",
  NEXT_PUBLIC_DZN_OPERATORS_ENGAGEMENT_ENABLED: "true",
});
assert.deepEqual(allFlags, { enabled: true, demoMode: true });
assert.equal(allFlags.engagementEnabled, true);

assert.equal(getNextOperatorDailyReset("2026-06-01T13:30:00.000Z"), "2026-06-02T00:00:00.000Z");
assert.equal(getNextOperatorWeeklyReset("2026-06-03T13:30:00.000Z"), "2026-06-08T00:00:00.000Z");

const empty = createOperatorEngagementState();
const dayOne = recordOperatorDailyCheckIn(empty, "2026-06-01T08:00:00.000Z");
const sameDay = recordOperatorDailyCheckIn(dayOne, "2026-06-01T22:00:00.000Z");
assert.equal(sameDay.dailyStreak.current, 1, "Same-day check-in is idempotent.");
const dayTwo = recordOperatorDailyCheckIn(dayOne, "2026-06-02T08:00:00.000Z");
assert.equal(dayTwo.dailyStreak.current, 2, "Next-day check-in increments once.");
const missed = recordOperatorDailyCheckIn(dayTwo, "2026-06-05T08:00:00.000Z");
assert.equal(missed.dailyStreak.current, 1, "A missed UTC day resets safely.");

const futureEventState = applyOperatorEngagementEvent(empty, {
  id: "future",
  metric: "operators_page_visit",
  amount: 1,
  occurredAt: "2026-06-03T00:00:00.000Z",
  source: "website",
}, "2026-06-01T00:00:00.000Z");
assert.equal(futureEventState.xp, 0, "Future events do not award progress.");

const challenge = getOperatorChallengeCatalog().find((entry) => entry.id === "daily-view-leaderboard");
assert.ok(challenge);
assert.equal(getChallengeCompletionState(challenge, undefined), "active");
const capped = calculateChallengeProgress(challenge, { challengeId: challenge.id, value: 99 });
assert.equal(capped.value, challenge.target, "Challenge progress is capped.");

const eventState = applyOperatorEngagementEvent(empty, {
  id: "leaderboard-view-1",
  metric: "operator_leaderboard_view",
  amount: 1,
  occurredAt: "2026-06-01T10:00:00.000Z",
  source: "website",
}, "2026-06-01T10:00:00.000Z");
assert.equal(eventState.completedChallengeIds.includes(challenge.id), true);
assert.equal(eventState.xp, challenge.xpReward, "Challenge completion awards XP once.");
const duplicateEventState = applyOperatorEngagementEvent(eventState, {
  id: "leaderboard-view-1",
  metric: "operator_leaderboard_view",
  amount: 1,
  occurredAt: "2026-06-01T10:00:00.000Z",
  source: "website",
}, "2026-06-01T10:00:00.000Z");
assert.equal(duplicateEventState.xp, eventState.xp, "Duplicate event ID is ignored.");

const claimable = getClaimableOperatorRewards(eventState);
const rewardToClaim = claimable[0]?.id ?? "unknown";
const claimed = claimOperatorRewardPreview(eventState, rewardToClaim);
const claimedTwice = claimOperatorRewardPreview(claimed, rewardToClaim);
assert.deepEqual(claimedTwice.claimedRewardIds, claimed.claimedRewardIds, "Claiming reward twice is rejected.");
assert.equal(createOperatorEngagementState({ xp: -40 }).xp, 0, "XP never becomes negative.");

for (let index = 1; index < OPERATOR_RANKS.length; index += 1) {
  assert.equal(OPERATOR_RANKS[index].minXp > OPERATOR_RANKS[index - 1].minXp, true, "Rank thresholds are ordered.");
}
assert.deepEqual(getOperatorRankProgress(4860), getOperatorRankProgress(4860), "Rank progress is deterministic.");

const freeTargets = getOperatorChallengeCatalog().map((entry) => [entry.id, entry.target, entry.xpReward]);
const premiumTargets = getOperatorChallengeCatalog().map((entry) => [entry.id, entry.target, entry.xpReward]);
assert.deepEqual(freeTargets, premiumTargets, "Premium receives no easier target or XP multiplier.");
assert.deepEqual(buildOperatorLeaderboardRows(DEMO_OPERATOR_PLAYERS, "weekly"), buildOperatorLeaderboardRows(DEMO_OPERATOR_PLAYERS, "weekly"), "Leaderboard sorting is stable.");
const tiedRows = buildOperatorLeaderboardRows([
  { id: "b", displayName: "Beta", publicRef: "beta", xp: 1000, linkedServerSlug: "a", linkedServerName: "A" },
  { id: "a", displayName: "Alpha", publicRef: "alpha", xp: 1000, linkedServerSlug: "a", linkedServerName: "A" },
], "all_time");
assert.equal(tiedRows[0].displayName, "Alpha", "Tie-breaking is deterministic.");
assert.equal(getDemoLeaderboardRows("weekly").some((row) => row.highlighted), true, "Current player is highlighted safely.");

const serializedRewards = JSON.stringify([...OPERATOR_STREAK_REWARDS, ...OPERATOR_RANKS.map((rank) => rank.reward), ...getOperatorChallengeCatalog().map((entry) => entry.reward)]);
assert.equal(/probability|odds|monetary|cash|boost|spin|loot/i.test(serializedRewards), false, "Rewards are fixed and fully disclosed.");
assert.equal(/Math\.random/.test(readFileSync("lib/operators/engagement/progress.ts", "utf8")), false, "No Math.random use in engagement domain.");

const malformed = parseOperatorEngagementPreviewStorage("{broken");
assert.equal(malformed.note, "preview_only_non_authoritative", "Malformed local storage resets safely.");
assert.equal(Object.keys(parseOperatorEngagementPreviewStorage(JSON.stringify({
  ...createOperatorEngagementState(),
  challengeProgress: { unknown: { challengeId: "unknown", value: 10 } },
  claimedRewardIds: ["unknown-reward"],
})).challengeProgress).includes("unknown"), false, "Unknown challenges are ignored safely.");
assert.equal(claimOperatorRewardPreview(empty, "unknown-reward").claimedRewardIds.includes("unknown-reward"), false, "Unknown rewards are ignored safely.");
assert.equal(createOperatorEngagementState({ recentActivity: Array.from({ length: 30 }, (_, index) => ({
  id: `activity-${index}`,
  label: "Activity",
  occurredAt: "2026-06-01T00:00:00.000Z",
  type: "profile_viewed" as const,
})) }).recentActivity.length <= 12, true, "Recent activity is bounded.");

assert.equal(buildOperatorPlayerProfile("unknown"), null, "Unknown player query returns unavailable state.");
assert.equal(buildOperatorServerCommunityProfile("unknown"), null, "Unknown server query returns unavailable state.");
const player = buildOperatorPlayerProfile("rafael");
assert.ok(player);
const serializedPlayer = JSON.stringify(player);
assert.equal(/coordinate|discord|database|session|auth/i.test(serializedPlayer), false, "Player profile exposes no raw coordinates or private identity data.");
const server = buildOperatorServerCommunityProfile("pandora-dayz");
assert.ok(server);
assert.equal(server.communityChallenges.every((entry) => entry.source === "future_server_aggregate"), true, "Server dashboard exposes aggregate progress only.");
assert.equal(JSON.stringify(server).includes("grantXp"), false, "Server owner cannot grant XP in Phase 2.");
assert.equal(JSON.stringify(server).includes("competitionScore"), false, "Community progress cannot alter player competition score.");

assert.deepEqual(freeCompetitionParticipation(), {
  competitions: true,
  publicStatistics: true,
  leaderboards: true,
  votingRights: true,
  progression: true,
  badgesAndTrophies: true,
  contracts: true,
});

assert.doesNotThrow(() => assertNoEngagementCompetitiveFields(getOperatorChallengeCatalog()));
assert.throws(() => assertNoEngagementCompetitiveFields({ xpMultiplier: 2 }), /Prohibited engagement field/);
assert.equal(getChallengesForCategory("daily").length >= 8, true);
assert.equal(getChallengesForCategory("weekly").length >= 5, true);
assert.equal(getChallengesForCategory("seasonal").length >= 6, true);
assert.equal(getChallengesForCategory("community").length >= 4, true);

const allIds = new Set<string>();
for (const item of [...getOperatorChallengeCatalog(), ...OPERATOR_ACHIEVEMENTS, ...OPERATOR_RANKS]) {
  assert.equal(allIds.has(item.id), false, `Seeded ID must be unique: ${item.id}`);
  allIds.add(item.id);
}
for (const achievement of OPERATOR_ACHIEVEMENTS) {
  assert.equal(achievement.accessibilityLabel.length > 0, true, "All achievements have accessibility labels.");
}
for (const rank of OPERATOR_RANKS) {
  assert.equal(rank.reward.exactContents.length > 0, true, "All rank rewards identify exact contents.");
}

for (const route of [
  "app/operators/challenges/page.tsx",
  "app/operators/rank/page.tsx",
  "app/operators/leaderboards/page.tsx",
  "app/operators/player/page.tsx",
  "app/operators/server/page.tsx",
]) {
  assert.equal(existsSync(route), true, `Route file exists: ${route}`);
}
assert.equal(readFileSync("app/operators/player/page.tsx", "utf8").includes("<Suspense"), true, "Player query page remains static-export safe.");
assert.equal(readFileSync("app/operators/server/page.tsx", "utf8").includes("<Suspense"), true, "Server query page remains static-export safe.");

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
assert.equal(packageJson.scripts["test:dzn-operators-engagement"], "tsx scripts/test-dzn-operators-engagement.ts");
assert.equal(packageJson.scripts.test.includes("npm run test:dzn-operators && npm run test:dzn-operators-engagement"), true);

console.log("DZN Operators engagement tests passed.");
