import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  publicProfileAttributionFairness,
  publicProfileAttributionFromRow,
  readPublicProfileAttributionsByDiscordIds,
  readPublicProfileAttributionsByUserIds,
  type PublicProfileAttribution,
} from "../functions/_lib/public-profile-attribution";
import { getPlayerChallengesPayload } from "../functions/_lib/player-progression";
import {
  rankLongestKills,
  rankPublicPlayers,
  selectLatestKill,
  type PublicLongestKillRow,
} from "../functions/_lib/public-leaderboards";
import { buildPublicReviewSummary, type ServerReviewRow } from "../functions/_lib/server-reviews";
import type { Env, SessionUser } from "../functions/_lib/types";

type FakeOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

const PUBLIC_PROFILE: PublicProfileAttribution = {
  display_name: "RafaelDeak",
  public_handle: "rafaeldeak-a1b2c",
  public_href: "/players/rafaeldeak-a1b2c",
  public_api_href: "/api/public/player-profiles/rafaeldeak-a1b2c",
};

const MOCK_USER: SessionUser = {
  id: "user-published",
  discord_id: "discord-published",
  username: "RafaelDeak",
  avatar: "discord-avatar-hash",
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertStaticContracts();
  await assertAttributionHelper();
  assertReviewAttribution();
  await assertPlayerChallengeAttribution();
  assertLeaderboardAttributionDoesNotChangeRank();
  assertProtectedSystemsRemainIndependent();
  console.log("Public profile cross-surface attribution tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    "functions/_lib/public-profile-attribution.ts",
    "functions/_lib/server-reviews.ts",
    "functions/_lib/public-leaderboards.ts",
    "functions/_lib/player-progression.ts",
    "functions/_lib/events.ts",
    "components/network/public-network.tsx",
    "components/events/events-platform.tsx",
    "app/leaderboards/page.tsx",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const helper = read("functions/_lib/public-profile-attribution.ts");
  for (const snippet of [
    "public_profile_enabled = 1",
    "public_handle IS NOT NULL",
    "normalizePublicProfileHandle",
    "publicPlayerProfileHref",
    "publicPlayerProfileApiHref",
    "readPublicProfileAttributionsByUserIds",
    "readPublicProfileAttributionsByDiscordIds",
  ]) {
    assert.equal(helper.includes(snippet), true, `Attribution helper must include ${snippet}.`);
  }
  assertNoSqlMutations(helper, "Attribution helper must stay read-only.");
  assert.doesNotMatch(helper, forbiddenProductionMutationPattern(), "Attribution helper must not touch production/external services.");

  const reviews = read("functions/_lib/server-reviews.ts");
  for (const snippet of [
    "readPublicProfileAttributionsByDiscordIds",
    "reviewer_profile: reviewerProfile",
    "reviewer_name: reviewerProfile?.display_name ?? \"DZN player\"",
    "reviewer_avatar_url: null",
  ]) {
    assert.equal(reviews.includes(snippet), true, `Public reviews must include ${snippet}.`);
  }

  const leaderboards = read("functions/_lib/public-leaderboards.ts");
  for (const snippet of [
    "LEFT JOIN player_profiles killer_profiles",
    "LEFT JOIN users killer_users",
    "LEFT JOIN player_profiles victim_profiles",
    "LEFT JOIN users victim_users",
    "CASE WHEN COUNT(DISTINCT killer_users.id) = 1 THEN MAX(killer_users.id) ELSE NULL END AS user_id",
    "CASE WHEN COUNT(DISTINCT victim_users.id) = 1 THEN MAX(victim_users.id) ELSE NULL END AS user_id",
    "applyMergedPublicProfileCandidate",
    "publicProfileAmbiguous",
    "LEFT JOIN users ON users.discord_id = player_profiles.discord_id",
    "public_profile: publicProfileForUser",
    "player_profile: row.player_profile ?? null",
    "victim_profile: row.victim_profile ?? null",
  ]) {
    assert.equal(leaderboards.includes(snippet), true, `Public leaderboards must include ${snippet}.`);
  }
  assert.doesNotMatch(leaderboards, forbiddenProductionMutationPattern(), "Leaderboard attribution must not touch production/external services.");

  const serverUi = read("components/network/public-network.tsx");
  for (const snippet of [
    "reviewer_profile?: PublicProfileAttribution",
    "normalizePublicProfileAttribution(review.reviewer_profile)",
    "View ${reviewerName}'s public DZN profile",
    "PlayerProfileName player={player}",
    "record.public_href === expectedHref",
    "normalizePublicProfileHandle",
  ]) {
    assert.equal(serverUi.includes(snippet), true, `Public server UI must include ${snippet}.`);
  }
  assert.equal(serverUi.includes("review.reviewer_avatar_url ?"), false, "Public review cards must not render cached reviewer avatar URLs for hidden players.");

  const challengesUi = read("components/events/events-platform.tsx");
  for (const snippet of [
    "public_profile?: PublicProfileAttribution",
    "normalizePublicProfileAttribution(progress.public_profile)",
    "normalizePublicProfileAttribution(challenge.player_state?.public_profile)",
    "Public profile",
    "record.public_href === expectedHref",
    "normalizePublicProfileHandle",
  ]) {
    assert.equal(challengesUi.includes(snippet), true, `Challenge UI must include ${snippet}.`);
  }

  const leaderboardUi = read("app/leaderboards/page.tsx");
  for (const snippet of [
    "profile={player.public_profile}",
    "profile={kill.player_profile}",
    "profile={kill.victim_profile}",
    "PlayerInlineMention",
    "record.public_href === expectedHref",
    "normalizePublicProfileHandle",
  ]) {
    assert.equal(leaderboardUi.includes(snippet), true, `Leaderboard UI must include ${snippet}.`);
  }

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:public-profile-cross-surface-attribution"), true, "Focused attribution test must be wired into package scripts.");

  const publicEvents = read("functions/_lib/events.ts");
  for (const snippet of [
    "public_event_creator_member_rows",
    "creator_profile: creatorProfile",
    "link_mode: \"presentation_only\"",
    "uses_gamertag_matching: false",
    "affects_scoring: false",
    "affects_eligibility: false",
    "affects_owner_decisions: false",
    "affects_billing: false",
  ]) {
    assert.equal(publicEvents.includes(snippet), true, `Public event attribution must include ${snippet}.`);
  }
  assert.doesNotMatch(publicEvents, /readPublicProfileAttributionsByRosterPlayerKeys|publicProfileRosterPlayerKey/i, "Public event creator attribution must not use CTF roster bridges.");

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  assert.equal(platformSpec.includes("Public Profile Cross-Surface Attribution Slice"), true, "Master spec must cover this slice.");
  assert.equal(platformSpec.includes("no name-only matching"), true, "Master spec must include the no name-only matching rule.");
  assert.equal(platformSpec.includes("hidden/unpublished profiles are not linked"), true, "Access matrix must cover hidden attribution state.");

  const publicAccessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  assert.equal(publicAccessPolicy.includes("public profile cross-surface attribution slice"), true, "Public access policy must cover this slice.");

  const handoff = read("docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md");
  assert.equal(handoff.includes("Follow-On Public Profile Cross-Surface Attribution"), true, "Public profile handoff must include this follow-on slice.");
}

async function assertAttributionHelper() {
  const state = createAttributionDb();
  const env = { DB: state.db } as Env;

  const byUser = await readPublicProfileAttributionsByUserIds(env, ["user-published", "user-hidden", "user-invalid", "user-published"]);
  assert.equal(byUser.size, 1);
  assert.deepEqual(byUser.get("user-published"), PUBLIC_PROFILE);
  assert.equal(byUser.has("user-hidden"), false);
  assert.equal(byUser.has("user-invalid"), false);

  const byDiscord = await readPublicProfileAttributionsByDiscordIds(env, ["discord-published", "discord-hidden"]);
  assert.equal(byDiscord.size, 1);
  assert.equal(byDiscord.get("discord-published")?.public_href, PUBLIC_PROFILE.public_href);
  assert.equal(byDiscord.has("discord-hidden"), false);

  assert.deepEqual(
    publicProfileAttributionFromRow({ username: "Bad Link", public_handle: "../billing" }),
    null,
    "Malformed handles must not produce links.",
  );
  assert.equal(state.operations.some((operation) => operation.kind === "run"), false, "Attribution lookup must be read-only.");
  for (const operation of state.operations) {
    assert.match(operation.sql, /\bplayer_profile_privacy_preferences\b/i);
    assert.match(operation.sql, /\bINNER\s+JOIN\s+users\b/i);
    assert.doesNotMatch(operation.sql, forbiddenProtectedInfluencePattern());
  }
  assertFairnessFlags(publicProfileAttributionFairness());
}

function assertReviewAttribution() {
  const summary = buildPublicReviewSummary([
    reviewRow("review-published", "discord-published", "PublishedReviewer", "https://cdn.discordapp.com/avatars/1/hash.png"),
    reviewRow("review-hidden", "discord-hidden", "HiddenReviewer", "https://cdn.discordapp.com/avatars/2/hash.png"),
  ], "discord-hidden", new Map([["discord-published", PUBLIC_PROFILE]]));

  assert.equal(summary.review_count, 2);
  const published = summary.reviews.find((review) => review.id === "review-published");
  const hidden = summary.reviews.find((review) => review.id === "review-hidden");

  assert.equal(published?.reviewer_name, PUBLIC_PROFILE.display_name);
  assert.deepEqual(published?.reviewer_profile, PUBLIC_PROFILE);
  assert.equal(published?.reviewer_avatar_url, null);
  assert.equal(hidden?.reviewer_name, "DZN player");
  assert.equal(hidden?.reviewer_profile, null);
  assert.equal(hidden?.reviewer_avatar_url, null);
  assert.equal(hidden?.is_own_review, true);

  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /discord-published|discord-hidden|HiddenReviewer|cdn\.discordapp\.com|reviewer_discord_id|owner_reply_author_user_id/i);
}

async function assertPlayerChallengeAttribution() {
  const state = createPlayerChallengeDb();
  const payload = await getPlayerChallengesPayload({ DB: state.db } as Env, MOCK_USER);

  assert.equal(payload.player_progress.public_profile?.public_href, PUBLIC_PROFILE.public_href);
  assert.equal(payload.challenges[0]?.player_state.public_profile?.public_handle, PUBLIC_PROFILE.public_handle);
  assert.equal(state.operations.some((operation) => operation.kind === "run"), false, "Player challenge attribution must be GET/read-only.");
  assert.equal(
    state.operations.some((operation) => /FROM\s+player_profile_privacy_preferences/i.test(operation.sql) && operation.bindings.includes(MOCK_USER.id)),
    true,
    "Player challenges must read the current player's own public profile attribution.",
  );
  for (const operation of state.operations) {
    assert.doesNotMatch(operation.sql, forbiddenProtectedInfluencePattern());
  }
}

function assertLeaderboardAttributionDoesNotChangeRank() {
  const ranked = rankPublicPlayers([
    {
      playerName: "PublishedLowKills",
      serverName: "DZN One",
      serverSlug: "dzn-one",
      kills: 2,
      deaths: 0,
      longestKill: 40,
      lastSeen: "2026-08-25T12:00:00.000Z",
      publicProfile: PUBLIC_PROFILE,
    },
    {
      playerName: "HiddenHighKills",
      serverName: "DZN One",
      serverSlug: "dzn-one",
      kills: 9,
      deaths: 3,
      longestKill: 25,
      lastSeen: "2026-08-25T12:01:00.000Z",
      publicProfile: null,
    },
  ]);

  assert.equal(ranked[0].player_name, "HiddenHighKills");
  assert.equal(ranked[0].public_profile, null);
  assert.equal(ranked[1].player_name, "PublishedLowKills");
  assert.equal(ranked[1].public_profile?.public_href, PUBLIC_PROFILE.public_href);

  const killRows: PublicLongestKillRow[] = [
    {
      player_key: "published",
      player_name: "PublishedShortKill",
      victim_name: "HiddenVictim",
      server_name: "DZN One",
      server_slug: "dzn-one",
      weapon: "M4-A1",
      distance: 10,
      occurred_at: "2026-08-25T10:00:00.000Z",
      player_profile: PUBLIC_PROFILE,
      victim_profile: null,
    },
    {
      player_key: "hidden",
      player_name: "HiddenLongKill",
      victim_name: "PublishedVictim",
      server_name: "DZN One",
      server_slug: "dzn-one",
      weapon: "SVD",
      distance: 90,
      occurred_at: "2026-08-25T09:00:00.000Z",
      player_profile: null,
      victim_profile: PUBLIC_PROFILE,
    },
  ];
  const personalBests = rankLongestKills(killRows);
  assert.equal(personalBests[0].player_name, "HiddenLongKill");
  assert.equal(personalBests[0].player_profile, null);
  assert.equal(personalBests[0].victim_profile?.public_href, PUBLIC_PROFILE.public_href);

  const latest = selectLatestKill(killRows);
  assert.equal(latest?.player_name, "PublishedShortKill");
  assert.equal(latest?.player_profile?.public_href, PUBLIC_PROFILE.public_href);
}

function assertProtectedSystemsRemainIndependent() {
  for (const file of [
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/status.ts",
    "lib/billing/plans.ts",
    "functions/_lib/server-ranking.ts",
    "functions/_lib/advanced-leaderboards.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/api/cron/player-progression/awards.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /public-profile-attribution|PublicProfileAttribution|public_handle|public_href|\/players\/\[handle\]|\/api\/public\/player-profiles/i,
      `${file} must not depend on public profile attribution state.`,
    );
  }
}

function createAttributionDb() {
  const operations: FakeOperation[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return attributionStatement(sql, bindings, operations);
        },
        ...attributionStatement(sql, [], operations),
      };
    },
  };
  return { db: db as unknown as Env["DB"], operations };
}

function attributionStatement(sql: string, bindings: unknown[], operations: FakeOperation[]) {
  return {
    async all<T>() {
      operations.push({ kind: "all", sql, bindings });
      const rows = [
        { user_id: "user-published", discord_id: "discord-published", username: "RafaelDeak", public_handle: PUBLIC_PROFILE.public_handle },
        { user_id: "user-hidden", discord_id: "discord-hidden", username: "HiddenUser", public_handle: null },
        { user_id: "user-invalid", discord_id: "discord-invalid", username: "InvalidUser", public_handle: "../admin" },
      ];
      if (/users\.discord_id\s+IN/i.test(sql)) {
        const wanted = new Set(bindings.map(String));
        return { results: rows.filter((row) => wanted.has(row.discord_id)) as T[] };
      }
      const wanted = new Set(bindings.map(String));
      return { results: rows.filter((row) => wanted.has(row.user_id)) as T[] };
    },
    async first<T>() {
      operations.push({ kind: "first", sql, bindings });
      return null as T | null;
    },
    async run() {
      operations.push({ kind: "run", sql, bindings });
      return { success: true };
    },
  };
}

function createPlayerChallengeDb() {
  const operations: FakeOperation[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return playerChallengeStatement(sql, bindings, operations);
        },
        ...playerChallengeStatement(sql, [], operations),
      };
    },
  };
  return { db: db as unknown as Env["DB"], operations };
}

function playerChallengeStatement(sql: string, bindings: unknown[], operations: FakeOperation[]) {
  return {
    async all<T>() {
      operations.push({ kind: "all", sql, bindings });
      if (/FROM\s+player_profile_privacy_preferences/i.test(sql)) {
        return {
          results: [{
            user_id: MOCK_USER.id,
            username: MOCK_USER.username,
            public_handle: PUBLIC_PROFILE.public_handle,
          }] as T[],
        };
      }
      if (/FROM\s+player_challenges/i.test(sql)) {
        return { results: [playerChallengeRow()] as T[] };
      }
      if (/FROM\s+player_challenge_participations/i.test(sql)) {
        return { results: [playerChallengeParticipationRow()] as T[] };
      }
      if (/FROM\s+player_calling_card_awards/i.test(sql)) {
        return { results: [] as T[] };
      }
      return { results: [] as T[] };
    },
    async first<T>() {
      operations.push({ kind: "first", sql, bindings });
      if (/SUM\(xp_amount\)/i.test(sql)) return { total_xp: 50 } as T;
      return null as T | null;
    },
    async run() {
      operations.push({ kind: "run", sql, bindings });
      return { success: true };
    },
  };
}

function playerChallengeRow() {
  return {
    id: "foundation-survivor-spark",
    slug: "survivor-spark",
    title: "Survivor Spark",
    description: "Join the foundation survival track.",
    category: "survival",
    status: "active",
    reward_xp: 50,
    calling_card_code: "survivor_spark",
    calling_card_name: "Survivor Spark",
    calling_card_description: "Joined the first DZN player challenge track.",
    calling_card_rarity: "foundation",
    target_value: 1,
    sort_order: 10,
    starts_at: null,
    ends_at: null,
  };
}

function playerChallengeParticipationRow() {
  return {
    challenge_id: "foundation-survivor-spark",
    status: "joined",
    progress_value: 0,
    target_value: 1,
    xp_awarded: 0,
    calling_card_awarded: null,
    joined_at: "2026-08-25T12:00:00.000Z",
    completed_at: null,
    updated_at: "2026-08-25T12:00:00.000Z",
  };
}

function reviewRow(
  id: string,
  reviewerDiscordId: string,
  reviewerName: string,
  reviewerAvatarUrl: string | null,
): ServerReviewRow {
  return {
    id,
    linked_server_id: "server-one",
    reviewer_discord_id: reviewerDiscordId,
    reviewer_name: reviewerName,
    reviewer_avatar_url: reviewerAvatarUrl,
    rating: 5,
    title: "Clean review",
    body: "This is a clean public review with enough useful detail for the public server profile.",
    status: "approved",
    moderation_reason: null,
    report_count: 0,
    owner_reply_body: "Thanks for the fair review.",
    owner_reply_author_user_id: "owner-user",
    owner_reply_author_name: "DZN Owner",
    owner_reply_created_at: "2026-08-25T11:00:00.000Z",
    owner_reply_updated_at: "2026-08-25T11:30:00.000Z",
    created_at: "2026-08-25T10:00:00.000Z",
    updated_at: "2026-08-25T10:00:00.000Z",
    last_edited_at: null,
  };
}

function assertFairnessFlags(fairness: Record<string, boolean>) {
  for (const flag of [
    "paid_plan_influence",
    "ranking_influence",
    "discovery_score_influence",
    "review_score_influence",
    "badge_influence",
    "season_influence",
    "event_influence",
    "server_wars_influence",
    "xp_award_influence",
    "calling_card_award_influence",
    "competitive_eligibility_influence",
  ]) {
    assert.equal(fairness[flag], false, `${flag} must remain false.`);
  }
}

function assertNoSqlMutations(source: string, message: string) {
  const sqlTemplates = source.match(/`[\s\S]*?`/g) ?? [];
  for (const template of sqlTemplates) {
    assert.doesNotMatch(template, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i, message);
  }
}

function forbiddenProtectedInfluencePattern() {
  return /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bserver_rankings\b|\bdiscovery_score\b|\bserver_badge_awards\b|\bbadge_unlock_progress\b|\bdzn_seasons\b|\bcompetitive_events\b|\bevent_matchups\b|\bevent_participants\b|\bserver_war_score_snapshots\b|\bserver_war_events\b|\bstripe\b|\bnitrado\b|\bdiscord_oauth_tokens\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i;
}

function forbiddenProductionMutationPattern() {
  return /\bcreateCheckoutSession\b|\bstripeFormRequest\b|\bSTRIPE_SECRET_KEY\b|\bDZN_LIVE_CHECKOUT_ENABLED\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bwrangler\s+d1\b|\bwrangler\s+secret\b|\bfetchDiscordApi\b|\bfetchNitrado\b/i;
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}
