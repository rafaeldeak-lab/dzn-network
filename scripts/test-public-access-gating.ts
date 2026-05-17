import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyLeaderboardsAccess, applyServerLeaderboardAccess } from "../functions/_lib/public-leaderboards";
import { applyHomeStatsAccess } from "../functions/api/public/home-stats";
import { applyServerReviewsAccess } from "../functions/api/public/server-reviews";
import { applyPublicServerAccess } from "../functions/api/public/servers";

const baseServer = {
  linked_server_id: "pandora",
  public_slug: "pandora-dayz",
  server_name: "PANDORA DayZ",
  server_type: "PVP",
  tags_json: JSON.stringify(["Factions", "Events", "KOS", "Weekend Raids"]),
  status: "live",
  nitrado_service_name: "PANDORA DayZ",
  guild_name: "Pandora",
  guild_icon_url: null,
  adm_status: "Connected",
  stats_sync: "Active",
  player_slots: 22,
  max_players: 22,
  current_players: 6,
  platform: "PlayStation",
  map_name: "Chernarus",
  mission: null,
  server_status: "online",
  is_online: true,
  last_sync_at: "2026-05-17T10:00:00.000Z",
  metadata_last_checked_at: "2026-05-17T10:01:00.000Z",
  public_short_description: "High action PvP server.",
  public_description: "A detailed community description that public preview users can read in shortened form.",
  public_discord_invite: "https://discord.gg/pandora",
  public_website_url: "https://pandora.example/rules",
  public_rules: "No cheating.",
  public_language: "English",
  public_region_label: "EU",
  public_listing_updated_at: "2026-05-17T09:00:00.000Z",
  created_at: "2026-05-01T09:00:00.000Z",
  total_kills: 20,
  total_deaths: 8,
  total_joins: 80,
  total_disconnects: 72,
  unique_players: 14,
  longest_kill: 120.4,
  kd: 2.5,
  kd_label: "2.50",
  rank: 1,
  score: 430,
  score_label: "430",
  score_breakdown: {
    kills_points: 200,
    unique_players_points: 70,
    joins_points: 160,
    longest_kill_points: 120,
    sync_bonus: 25,
    death_penalty: 16,
    final_score: 430,
  },
  stats_sync_active: true,
  average_rating: 4.8,
  review_count: 23,
  rating_breakdown: { 5: 20, 4: 3, 3: 0, 2: 0, 1: 0 },
  advertising: {
    is_featured: false,
    featured_until: null,
    is_boosted: false,
    last_bumped_at: null,
    boosted_until: null,
    boosted_time_left_label: null,
    badge_label: null,
  },
  recent_events: [
    {
      source: "kill",
      event_type: "kill",
      label: "Kill confirmed",
      player_name: null,
      killer_name: "Player A",
      victim_name: "Player B",
      weapon: "M4-A1",
      distance: 90,
      occurred_at: "2026-05-17T10:02:00.000Z",
      created_at: "2026-05-17T10:02:00.000Z",
    },
  ],
  top_players: [
    {
      rank: 1,
      player_name: "Player A",
      player_id: null,
      server_name: "PANDORA DayZ",
      server_slug: "pandora-dayz",
      kills: 9,
      deaths: 1,
      kd: 9,
      kd_label: "9.00",
      longest_kill: 90,
      last_seen: "2026-05-17T10:02:00.000Z",
    },
  ],
  pvp_leaderboard: [],
} satisfies Parameters<typeof applyPublicServerAccess>[0];

const previewServer = applyPublicServerAccess(baseServer, false);
assert.equal(previewServer.is_locked, true);
assert.equal(previewServer.access_level, "preview");
assert.equal(previewServer.public_discord_invite, null);
assert.equal(previewServer.public_website_url, null);
assert.equal(previewServer.public_rules, null);
assert.equal(previewServer.current_players, 6);
assert.equal(previewServer.unique_players, 0);
assert.equal(previewServer.kd_label, "Login required");
assert.equal(previewServer.recent_events.length, 0);
assert.equal(previewServer.top_players?.length, 0);
assert.equal(previewServer.pvp_leaderboard?.length, 0);
assert.equal(JSON.stringify(previewServer).includes("reviewer_discord_id"), false);

const fullServer = applyPublicServerAccess(baseServer, true);
assert.equal(fullServer.is_locked, false);
assert.equal(fullServer.current_players, 6);
assert.equal(fullServer.max_players, 22);
assert.equal(fullServer.public_discord_invite, "https://discord.gg/pandora");
assert.equal(fullServer.recent_events.length, 1);
assert.equal(fullServer.top_players?.length, 1);

const homePreview = applyHomeStatsAccess({
  topServers: [{ server_name: "One" }, { server_name: "Two" }, { server_name: "Three" }, { server_name: "Four" }],
  topPlayers: [{ player_name: "Hidden" }],
  recentActivity: [
    { source: "kill", title: "Player A eliminated Player B", serverName: "PANDORA" },
    { source: "server", title: "PANDORA activity synced", serverName: "PANDORA" },
    { source: "build", title: "Player built wall", serverName: "NukeTown" },
    { source: "sync", title: "Another row", serverName: "Warlords" },
  ],
  top_build_servers: [{ server_name: "Hidden build" }],
  event_leaderboard: { title: "Hidden event" },
}, false);
assert.equal(homePreview.is_locked, true);
assert.equal(homePreview.topServers.length, 3);
assert.equal(homePreview.topPlayers.length, 0);
assert.equal(homePreview.recentActivity.length, 3);
assert.equal(homePreview.recentActivity[0].title, "PANDORA activity synced");
assert.equal(homePreview.top_build_servers.length, 0);
assert.equal(homePreview.event_leaderboard, null);

const leaderboardPreview = applyLeaderboardsAccess({
  ok: true,
  top_servers: Array.from({ length: 4 }, (_, index) => ({
    rank: index + 1,
    server_id: `server-${index + 1}`,
    server_name: `Server ${index + 1}`,
    slug: `server-${index + 1}`,
    mode: "PVP",
    kills: 10,
    deaths: 2,
    kd: 5,
    kd_label: "5.00",
    longest_kill: 100,
    unique_players: 10,
    joins: 10,
    stats_sync_active: true,
    score: 100,
    score_label: "100",
    score_breakdown: baseServer.score_breakdown,
  })),
  top_players: baseServer.top_players,
  best_overall_kill: {
    player_name: "Player A",
    victim_name: "Player B",
    server_name: "PANDORA DayZ",
    server_slug: "pandora-dayz",
    weapon: "M4-A1",
    distance: 90,
    occurred_at: "2026-05-17T10:02:00.000Z",
  },
  latest_kill: null,
  personal_best_kills: [
    {
      rank: 1,
      player_name: "Player A",
      victim_name: "Player B",
      server_name: "PANDORA DayZ",
      server_slug: "pandora-dayz",
      weapon: "M4-A1",
      distance: 90,
      occurred_at: "2026-05-17T10:02:00.000Z",
    },
  ],
  longest_kills: [],
  build_leaderboard: [],
  updated_at: "2026-05-17T10:02:00.000Z",
}, false);
assert.equal(leaderboardPreview.is_locked, true);
assert.equal(leaderboardPreview.top_servers.length, 3);
assert.equal(leaderboardPreview.top_players.length, 0);
assert.equal(leaderboardPreview.best_overall_kill, null);
assert.equal(leaderboardPreview.personal_best_kills.length, 0);
assert.equal(leaderboardPreview.top_servers[0].score_breakdown, null);

const serverLeaderboardPreview = applyServerLeaderboardAccess({ ok: true, players: baseServer.top_players }, false);
assert.equal(serverLeaderboardPreview.is_locked, true);
assert.equal(serverLeaderboardPreview.players.length, 0);

const reviewPreview = applyServerReviewsAccess({
  average_rating: 4.8,
  review_count: 23,
  rating_breakdown: { 5: 20, 4: 3, 3: 0, 2: 0, 1: 0 },
  reviews: [
    {
      id: "review-1",
      reviewer_name: "Reviewer",
      reviewer_avatar_url: null,
      rating: 5,
      title: "Great",
      body: "A clean review body.",
      created_at: "2026-05-17T10:02:00.000Z",
      updated_at: "2026-05-17T10:02:00.000Z",
    },
  ],
}, false);
assert.equal(reviewPreview.is_locked, true);
assert.equal(reviewPreview.review_count, 23);
assert.equal(reviewPreview.reviews.length, 0);
assert.equal(JSON.stringify(reviewPreview).includes("reviewer_discord_id"), false);

const homepageSource = readFileSync("components/dzn/dzn-landing-page.tsx", "utf8");
assert.equal(homepageSource.includes("Players Online"), true);
assert.equal(homepageSource.includes("currentPlayersOnline"), true);

console.log("Public access gating tests passed.");
