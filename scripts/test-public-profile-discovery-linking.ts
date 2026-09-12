import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { stripVolatilePublicProfileLinks } from "../functions/_lib/public-api-cache";
import {
  publicProfileHref,
  readPublicProfileLinksByDiscordIds,
  type PublicProfileLink,
} from "../functions/_lib/player-public-profiles";
import { buildPublicReviewSummary, type ServerReviewRow } from "../functions/_lib/server-reviews";
import { rankLongestKills, rankPublicPlayers } from "../functions/_lib/public-leaderboards";
import type { Env } from "../functions/_lib/types";

const profileHelperSource = readFileSync("functions/_lib/player-public-profiles.ts", "utf8");
const reviewSource = readFileSync("functions/_lib/server-reviews.ts", "utf8");
const leaderboardSource = readFileSync("functions/_lib/public-leaderboards.ts", "utf8");
const cacheSource = readFileSync("functions/_lib/public-api-cache.ts", "utf8");
const publicNetworkSource = readFileSync("components/network/public-network.tsx", "utf8");
const leaderboardsPageSource = readFileSync("app/leaderboards/page.tsx", "utf8");
const packageJson = readFileSync("package.json", "utf8");

const linkHelperSource = profileHelperSource.slice(
  profileHelperSource.indexOf("export async function readPublicProfileLinksByDiscordIds"),
  profileHelperSource.indexOf("export function normalizePublicProfileHandle"),
);
assert.match(linkHelperSource, /player_public_profiles\.status = 'active'/, "Profile attribution links must require an active public handle.");
assert.match(linkHelperSource, /player_profile_privacy_preferences\.public_profile_enabled = 1/, "Profile attribution links must require saved public-profile opt-in.");
assert.match(linkHelperSource, /maxPublicProfileLinkLookupIds/, "Profile attribution link lookups must stay bounded.");
assert.doesNotMatch(
  linkHelperSource,
  /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+|DELETE\s+FROM|account_entitlements|supporter_cards|earned_spins|spin_ledger|stripe|checkout|server_subscriptions|linked_servers|server_reviews|competitive_events|ctf_tournament|badge_awards|xp_award|calling_card)\b/i,
  "Profile attribution lookup must stay read-only and out of billing, owner, review, event, award, and competitive tables.",
);

const rankPublicPlayersSource = leaderboardSource.slice(
  leaderboardSource.indexOf("export function rankPublicPlayers"),
  leaderboardSource.indexOf("export function rankLongestKills"),
);
const rankSortBlock = rankPublicPlayersSource.slice(
  rankPublicPlayersSource.indexOf(".sort"),
  rankPublicPlayersSource.indexOf(".slice"),
);
assert.doesNotMatch(rankSortBlock, /publicProfile|player_public_profiles|profile_href|profile_handle/i, "Public profile links must not participate in player ranking sort order.");
assert.match(leaderboardSource, /player_id: null/, "Public leaderboard payloads must continue to redact raw player IDs.");
assert.match(leaderboardSource, /public_profile_href: publicProfile\?\.href \?\? null/, "Public leaderboard rows should expose only a safe profile href.");
assert.match(leaderboardSource, /player_profiles\.player_id = \$\{eventTable\}\.\$\{playerIdColumn\}/, "Kill-event profile attribution must use the trusted per-server player ID bridge.");
assert.doesNotMatch(leaderboardSource, /playerNameColumn|lower\(player_profiles\.player_name\)/, "Kill-event profile attribution must not fall back to ambiguous player-name matching.");
assert.match(reviewSource, /public_profile_href: publicProfile\?\.href \?\? null/, "Public review rows should expose only a safe profile href.");
assert.match(cacheSource, /stripVolatilePublicProfileLinks\(payload\)/, "Public API snapshots must strip volatile public profile link fields.");
assert.match(publicNetworkSource, /stripVolatilePublicNetworkProfileLinks\(\{ \.\.\.payload, cached_at:/, "Public network browser fallbacks must strip volatile public profile link fields.");
assert.match(leaderboardsPageSource, /stripVolatileLeaderboardProfileLinks\(\{ \.\.\.payload, cached_at:/, "Leaderboard browser fallbacks must strip volatile public profile link fields.");
assert.match(publicNetworkSource, /function PublicPlayerProfileName/, "Server/profile UI should render public profile links through a guarded helper.");
assert.match(publicNetworkSource, /safePublicProfileHref/, "Server/profile UI must validate public profile hrefs.");
assert.match(leaderboardsPageSource, /function InlinePlayerProfileLink/, "Leaderboard kill highlights should render player profile links through a guarded helper.");
assert.match(packageJson, /"test:public-profile-discovery-linking": "tsx scripts\/test-public-profile-discovery-linking\.ts"/, "Dedicated public profile discovery-linking test script must be registered.");

async function testOptInProfileLinkLookup() {
  const db = new FakeProfileLinkD1();
  db.users.set("visible-user", { discord_id: "visible-discord" });
  db.users.set("private-user", { discord_id: "private-discord" });
  db.users.set("disabled-user", { discord_id: "disabled-discord" });
  db.users.set("other-user", { discord_id: "other-discord" });
  db.publicProfiles.set("visible-user", { handle: "visible-player", status: "active" });
  db.publicProfiles.set("private-user", { handle: "private-player", status: "active" });
  db.publicProfiles.set("disabled-user", { handle: "disabled-player", status: "disabled" });
  db.preferences.set("visible-user", { public_profile_enabled: 1 });
  db.preferences.set("private-user", { public_profile_enabled: 0 });
  db.preferences.set("disabled-user", { public_profile_enabled: 1 });

  const links = await readPublicProfileLinksByDiscordIds({ DB: db } as unknown as Env, [
    "visible-discord",
    "visible-discord",
    " private-discord ",
    "disabled-discord",
    "missing-discord",
    "",
    null,
    undefined,
  ]);

  assert.deepEqual(links.get("visible-discord"), {
    handle: "visible-player",
    href: publicProfileHref("visible-player"),
  });
  assert.equal(links.has("private-discord"), false, "Private profiles must not receive attribution links.");
  assert.equal(links.has("disabled-discord"), false, "Disabled handles must not receive attribution links.");
  assert.equal(links.has("missing-discord"), false, "Missing users must not receive attribution links.");
  assert.equal(db.lastBindings.length, 4, "Lookup must de-duplicate and trim requested Discord IDs.");
  assert.equal(JSON.stringify([...links]).includes("other-discord"), false, "Other-user Discord IDs must not be exposed.");
}

function testReviewAttributionIsPresentationOnly() {
  const links = new Map<string, PublicProfileLink>([
    ["visible-discord", { handle: "visible-player", href: "/players/visible-player" }],
  ]);
  const rows: ServerReviewRow[] = [
    reviewRow({ id: "visible-review", reviewerDiscordId: "visible-discord", rating: 5, status: "approved" }),
    reviewRow({ id: "private-review", reviewerDiscordId: "private-discord", rating: 1, status: "approved" }),
    reviewRow({ id: "pending-review", reviewerDiscordId: "visible-discord", rating: 1, status: "pending" }),
  ];

  const summary = buildPublicReviewSummary(rows, "visible-discord", links);
  assert.equal(summary.review_count, 2, "Only approved reviews count toward public review totals.");
  assert.equal(summary.average_rating, 3, "Profile attribution must not alter review averages.");
  assert.equal(summary.rating_breakdown[5], 1);
  assert.equal(summary.rating_breakdown[1], 1);
  assert.equal(summary.reviews.find((review) => review.id === "visible-review")?.public_profile_href, "/players/visible-player");
  assert.equal(summary.reviews.find((review) => review.id === "private-review")?.public_profile_href, null);
  assert.equal(summary.reviews.find((review) => review.id === "visible-review")?.is_own_review, true, "Own-review state must still use the viewer Discord ID privately.");
  assert.equal(JSON.stringify(summary).includes("visible-discord"), false, "Review payloads must not expose reviewer Discord IDs.");
  assert.equal(JSON.stringify(summary).includes("private-discord"), false, "Review payloads must not expose private reviewer Discord IDs.");
}

function testLeaderboardAttributionIsPresentationOnly() {
  const links = new Map<string, PublicProfileLink>([
    ["visible-discord", { handle: "visible-player", href: "/players/visible-player" }],
  ]);
  const input = [
    {
      playerName: "Visible Ace",
      serverName: "Pandora Network",
      serverSlug: "pandora-network",
      kills: 9,
      deaths: 1,
      longestKill: 120.44,
      lastSeen: "2026-09-01T12:00:00.000Z",
      discordId: "visible-discord",
    },
    {
      playerName: "Private Runner",
      serverName: "Pandora Network",
      serverSlug: "pandora-network",
      kills: 8,
      deaths: 0,
      longestKill: 280.1,
      lastSeen: "2026-09-01T12:10:00.000Z",
      discordId: "private-discord",
    },
  ];

  const withoutLinks = rankPublicPlayers(input, 10);
  const withLinks = rankPublicPlayers(input, 10, links);
  assert.deepEqual(
    withLinks.map(({ rank, player_name, kills, kd_label, longest_kill }) => ({ rank, player_name, kills, kd_label, longest_kill })),
    withoutLinks.map(({ rank, player_name, kills, kd_label, longest_kill }) => ({ rank, player_name, kills, kd_label, longest_kill })),
    "Public profile attribution must not change player ranks or metrics.",
  );
  assert.equal(withLinks[0].public_profile_href, "/players/visible-player");
  assert.equal(withLinks[1].public_profile_href, null);
  assert.equal(JSON.stringify(withLinks).includes("visible-discord"), false, "Leaderboard payloads must not expose Discord IDs.");
  assert.equal(JSON.stringify(withLinks).includes("private-discord"), false, "Leaderboard payloads must not expose private Discord IDs.");

  const longestKills = rankLongestKills([
    {
      player_key: "visible",
      player_name: "Visible Ace",
      victim_name: "Victim One",
      server_name: "Pandora Network",
      server_slug: "pandora-network",
      weapon: "M4-A1",
      distance: 280.1,
      occurred_at: "2026-09-01T12:00:00.000Z",
      discord_id: "visible-discord",
    },
    {
      player_key: "private",
      player_name: "Private Runner",
      victim_name: "Victim Two",
      server_name: "Pandora Network",
      server_slug: "pandora-network",
      weapon: "VSD",
      distance: 260.5,
      occurred_at: "2026-09-01T12:10:00.000Z",
      discord_id: "private-discord",
    },
  ], 10, links);

  assert.equal(longestKills[0].rank, 1);
  assert.equal(longestKills[0].player_public_profile_href, "/players/visible-player");
  assert.equal(longestKills[1].player_public_profile_href, null);
  assert.equal(JSON.stringify(longestKills).includes("visible-discord"), false, "Longest-kill payloads must not expose Discord IDs.");
}

function testSnapshotPrivacyStrip() {
  const snapshot = {
    top_players: [{
      player_name: "Visible Ace",
      public_profile_handle: "visible-player",
      public_profile_href: "/players/visible-player",
    }],
    reviews: [{
      reviewer_name: "Visible Ace",
      public_profile_handle: "visible-player",
      public_profile_href: "/players/visible-player",
    }],
    best_overall_kill: {
      player_name: "Visible Ace",
      player_public_profile_handle: "visible-player",
      player_public_profile_href: "/players/visible-player",
    },
  };

  const stripped = stripVolatilePublicProfileLinks(snapshot);
  const serialized = JSON.stringify(stripped);
  assert.equal(JSON.stringify(snapshot).includes("public_profile_href"), true, "The original live payload object should not be mutated by snapshot stripping.");
  assert.equal(serialized.includes("public_profile_href"), false, "Snapshot fallbacks must not retain public profile hrefs.");
  assert.equal(serialized.includes("public_profile_handle"), false, "Snapshot fallbacks must not retain public profile handles.");
  assert.equal(serialized.includes("player_public_profile_href"), false, "Snapshot fallbacks must not retain kill-highlight public profile hrefs.");
  assert.equal((stripped as typeof snapshot).top_players[0].player_name, "Visible Ace", "Snapshot stripping must preserve non-profile public data.");
}

type FakeUser = {
  discord_id: string;
};

type FakePublicProfile = {
  handle: string;
  status: "active" | "disabled";
};

type FakePreference = {
  public_profile_enabled: number;
};

class FakeProfileLinkD1 {
  readonly users = new Map<string, FakeUser>();
  readonly publicProfiles = new Map<string, FakePublicProfile>();
  readonly preferences = new Map<string, FakePreference>();
  readonly queries: string[] = [];
  lastBindings: unknown[] = [];

  prepare(query: string) {
    this.queries.push(normalizedSql(query));
    return new FakeProfileLinkStatement(this, query);
  }
}

class FakeProfileLinkStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: FakeProfileLinkD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    this.db.lastBindings = values;
    return this;
  }

  async all<T>() {
    const query = normalizedSql(this.query);
    assert.match(query, /from users inner join player_public_profiles/, "Profile link lookups must bridge from users to active public profile handles.");
    assert.match(query, /inner join player_profile_privacy_preferences/, "Profile link lookups must require saved privacy preferences.");

    const requestedDiscordIds = new Set(this.bindings.map(String));
    const rows: Array<{ discord_id: string; handle: string }> = [];
    for (const [userId, user] of this.db.users) {
      const profile = this.db.publicProfiles.get(userId);
      const preference = this.db.preferences.get(userId);
      if (!requestedDiscordIds.has(user.discord_id)) continue;
      if (!profile || profile.status !== "active") continue;
      if (preference?.public_profile_enabled !== 1) continue;
      rows.push({ discord_id: user.discord_id, handle: profile.handle });
    }
    return { results: rows, success: true, meta: {} } as T;
  }
}

function reviewRow(options: {
  id: string;
  reviewerDiscordId: string;
  rating: number;
  status: string;
}): ServerReviewRow {
  return {
    id: options.id,
    linked_server_id: "pandora",
    reviewer_discord_id: options.reviewerDiscordId,
    reviewer_name: "DZN Reviewer",
    reviewer_avatar_url: null,
    rating: options.rating,
    title: "Clean review",
    body: "This is a public-safe review body with enough useful detail.",
    status: options.status,
    moderation_reason: null,
    report_count: 0,
    created_at: "2026-09-01T12:00:00.000Z",
    updated_at: "2026-09-01T12:00:00.000Z",
    last_edited_at: null,
  };
}

function normalizedSql(query: string) {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

void testOptInProfileLinkLookup()
  .then(() => {
    testReviewAttributionIsPresentationOnly();
    testLeaderboardAttributionIsPresentationOnly();
    testSnapshotPrivacyStrip();
    console.log("Public profile discovery/linking tests passed.");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
