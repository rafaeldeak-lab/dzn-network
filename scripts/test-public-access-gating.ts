import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyLeaderboardsAccess, applyServerLeaderboardAccess } from "../functions/_lib/public-leaderboards";
import { applyHomeStatsAccess, buildPublicBuildEventLeaderboardRows } from "../functions/api/public/home-stats";
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
  totals: {
    serversLinked: 4,
    players_online: 3,
    currentPlayersOnline: 3,
    killsTracked: 55,
    recentEventsCount: 12,
  },
  network_pulse: {
    active_servers: 2,
    events: 12,
    top_server: { server_name: "Hidden top" },
    best_kd: 4.2,
    current_event: { title: "Hidden event" },
  },
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
  map_nodes: [{ name: "Hidden map node", latitude: 10, longitude: 20 }],
  syncHealth: { active: 2, pending: 1 },
}, false);
assert.equal(homePreview.is_locked, true);
assert.equal(homePreview.topServers.length, 3);
assert.equal(JSON.stringify(homePreview.topServers[0]).includes("Login required"), true);
assert.equal(homePreview.topPlayers.length, 0);
assert.equal(homePreview.recentActivity.length, 3);
assert.equal(homePreview.recentActivity[0].title, "PANDORA activity synced");
assert.equal(JSON.stringify(homePreview.recentActivity).includes("Player A"), false);
assert.equal(homePreview.totals.players_online, 0);
assert.equal(homePreview.totals.killsTracked, 0);
assert.equal(homePreview.network_pulse.top_server, null);
assert.equal(homePreview.network_pulse.current_event, null);
assert.equal(homePreview.map_nodes.length, 0);
assert.equal(homePreview.syncHealth.active, 0);
assert.equal(homePreview.top_build_servers.length, 0);
assert.equal(homePreview.event_leaderboard, null);

const homeFull = applyHomeStatsAccess({
  totals: { players_online: 3 },
  network_pulse: { top_server: { server_name: "Pandora" }, current_event: { title: "Build War" } },
  topServers: [{ server_name: "One", score_label: "230" }],
  topPlayers: [{ player_name: "Visible" }],
  recentActivity: [{
    source: "kill",
    title: "REINHARTFESTRAUS eliminated xAKA-MINI_KickAs with M4-A1",
    serverName: "NukeTown DEATHMATCH",
    killerName: "REINHARTFESTRAUS",
    victimName: "xAKA-MINI_KickAs",
    weapon: "M4-A1",
    distance: 41.6,
  }],
  top_build_servers: [{ server_name: "Visible build" }],
  event_leaderboard: { title: "Visible event" },
  map_nodes: [{ name: "Visible map node" }],
  syncHealth: { active: 2, pending: 1 },
}, true);
assert.equal(homeFull.is_locked, false);
assert.equal(homeFull.access_level, "full");
assert.equal(homeFull.recentActivity[0].title, "REINHARTFESTRAUS eliminated xAKA-MINI_KickAs with M4-A1");
assert.equal(homeFull.recentActivity[0].weapon, "M4-A1");
assert.equal(homeFull.recentActivity[0].distance, 41.6);
assert.equal(homeFull.map_nodes.length, 1);

const buildLeaderboardRows = buildPublicBuildEventLeaderboardRows(
  Array.from({ length: 8 }, (_, index) => ({
    rank: 99,
    server_id: `build-server-${index}`,
    server_name: `Build Server ${index}`,
    slug: `build-server-${index}`,
    structures_built: index === 0 ? 25 : 40 - index,
    build_items_placed: 0,
    storage_items_placed: 0,
    traps_placed: 0,
    build_score: index === 0 ? 500 : 600 - index,
    top_builder_name: null,
    top_builder_count: 0,
    last_build_at: `2026-05-17T1${index % 10}:00:00.000Z`,
  })).concat([
    {
      rank: 99,
      server_id: "tie-structures-high",
      server_name: "Tie High",
      slug: "tie-high",
      structures_built: 55,
      build_items_placed: 0,
      storage_items_placed: 0,
      traps_placed: 0,
      build_score: 590,
      top_builder_name: null,
      top_builder_count: 0,
      last_build_at: "2026-05-17T08:00:00.000Z",
    },
    {
      rank: 99,
      server_id: "tie-structures-low",
      server_name: "Tie Low",
      slug: "tie-low",
      structures_built: 12,
      build_items_placed: 0,
      storage_items_placed: 0,
      traps_placed: 0,
      build_score: 590,
      top_builder_name: null,
      top_builder_count: 0,
      last_build_at: "2026-05-17T09:00:00.000Z",
    },
    ...Array.from({ length: 4 }, (_, index) => ({
      rank: 99,
      server_id: `low-build-server-${index}`,
      server_name: `Low Build Server ${index}`,
      slug: `low-build-server-${index}`,
      structures_built: index + 1,
      build_items_placed: 0,
      storage_items_placed: 0,
      traps_placed: 0,
      build_score: 10 - index,
      top_builder_name: null,
      top_builder_count: 0,
      last_build_at: `2026-05-17T07:0${index}:00.000Z`,
    })),
  ]),
  new Map([
    ["build-server-1", {
      full_walls_built: 12,
      watchtowers_built: 3,
      gates_fence_kits_built: 7,
      storage_expansion_built: 5,
    }],
  ]),
);
assert.equal(buildLeaderboardRows.length, 10);
assert.equal(buildLeaderboardRows[0].server_id, "build-server-1");
assert.equal(buildLeaderboardRows[0].rank, 1);
assert.equal(buildLeaderboardRows[0].full_walls_built, 12);
assert.equal(buildLeaderboardRows[0].watchtowers_built, 3);
assert.equal(buildLeaderboardRows[0].gates_fence_kits_built, 7);
assert.equal(buildLeaderboardRows[0].storage_expansion_built, 5);
assert.equal(buildLeaderboardRows.findIndex((row) => row.server_id === "tie-structures-high") < buildLeaderboardRows.findIndex((row) => row.server_id === "tie-structures-low"), true);
assert.equal(JSON.stringify(buildLeaderboardRows).includes("undefined"), false);
assert.equal(JSON.stringify(buildLeaderboardRows).includes("null"), true);
assert.equal(JSON.stringify(buildLeaderboardRows).includes("NaN"), false);

const emptyBuildLeaderboardRows = buildPublicBuildEventLeaderboardRows([
  {
    rank: 1,
    server_id: "empty",
    server_name: "Empty",
    slug: null,
    structures_built: 0,
    build_items_placed: 0,
    storage_items_placed: 0,
    traps_placed: 0,
    build_score: 0,
    top_builder_name: null,
    top_builder_count: 0,
    last_build_at: null,
  },
]);
assert.equal(emptyBuildLeaderboardRows.length, 0);

const homeFullBuild = applyHomeStatsAccess({
  totals: { players_online: 3 },
  network_pulse: { top_server: null, current_event: null },
  topServers: [],
  topPlayers: [],
  recentActivity: [],
  top_build_servers: [],
  event_leaderboard: {
    event_type: "build",
    title: "Build Tracking Leaderboard",
    subtitle: "Live build intelligence across connected servers",
    refresh_label: "Refreshes every 5 minutes",
    rows: buildLeaderboardRows,
  },
  map_nodes: [],
  syncHealth: { active: 0, pending: 0 },
}, true);
assert.equal(homeFullBuild.event_leaderboard.rows.length, 10);
assert.equal(homeFullBuild.event_leaderboard.rows[0].server_id, "build-server-1");

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
const networkOverviewBlock = homepageSource.slice(
  homepageSource.indexOf("function NetworkOverview"),
  homepageSource.indexOf("function NetworkPulse"),
);
const loggedOutNavBlock = homepageSource.slice(
  homepageSource.indexOf("const loggedOutNavItems"),
  homepageSource.indexOf("const fallbackTopServers"),
);
const navbarBlock = homepageSource.slice(
  homepageSource.indexOf("function Navbar"),
  homepageSource.indexOf("function DiscordIcon"),
);
const landingRenderBlock = homepageSource.slice(
  homepageSource.indexOf("export function DznLandingPage"),
  homepageSource.indexOf("function HomeAliveBackground"),
);
const heroBlock = homepageSource.slice(
  homepageSource.indexOf("function HeroDashboard"),
  homepageSource.indexOf("function HomepagePreviewUnlock"),
);
const previewBannerBlock = homepageSource.slice(
  homepageSource.indexOf("function HomepagePreviewUnlock"),
  homepageSource.indexOf("function LockedPreviewPanel"),
);
const lockedPreviewPanelBlock = homepageSource.slice(
  homepageSource.indexOf("function LockedPreviewPanel"),
  homepageSource.indexOf("function TopServersPanel"),
);
const topServersPanelBlock = homepageSource.slice(
  homepageSource.indexOf("function TopServersPanel"),
  homepageSource.indexOf("function RecentActivityPanel"),
);
const recentActivityPanelBlock = homepageSource.slice(
  homepageSource.indexOf("function RecentActivityPanel"),
  homepageSource.indexOf("function LiveMapPanel"),
);
const activityRowsBlock = homepageSource.slice(
  homepageSource.indexOf("function buildActivityRows"),
  homepageSource.indexOf("function formatServerDisplayName"),
);
const bottomCtaBlock = homepageSource.slice(
  homepageSource.indexOf("function BottomCta"),
  homepageSource.indexOf("function PanelShell"),
);
const buildLeaderboardBlock = homepageSource.slice(
  homepageSource.indexOf("function BuildTrackingLeaderboard"),
  homepageSource.indexOf("function BottomCta"),
);
const globalsSource = readFileSync("app/globals.css", "utf8");
const recentActivityCssBlock = globalsSource.slice(
  globalsSource.indexOf(".dzn-recent-activity-list"),
  globalsSource.indexOf(".dzn-game-modes-section"),
);
const homeStatsSource = readFileSync("functions/api/public/home-stats.ts", "utf8");
const buildLeaderboardCssBlock = globalsSource.slice(
  globalsSource.indexOf(".dzn-build-leaderboard"),
  globalsSource.indexOf(".dzn-game-modes-section"),
);
assert.equal(homepageSource.includes("Players Online"), true);
assert.equal(homepageSource.includes("currentPlayersOnline"), true);
assert.equal(homepageSource.includes("playersOnline"), true);
assert.equal(homepageSource.includes("total slots"), false);
assert.equal(homepageSource.includes("`${formatNumber(currentPlayersOnline)} /"), false);
assert.equal(networkOverviewBlock.includes("maxPlayersCapacity"), false);
assert.equal(networkOverviewBlock.toLowerCase().includes("capacity"), false);
assert.equal(networkOverviewBlock.toLowerCase().includes("slots"), false);
assert.equal(loggedOutNavBlock.includes("Dashboard"), false);
assert.equal(loggedOutNavBlock.includes("Add Your Server"), false);
assert.equal(loggedOutNavBlock.includes("Servers"), false);
assert.equal(loggedOutNavBlock.includes("Leaderboards"), false);
assert.equal(loggedOutNavBlock.includes("Stats"), false);
assert.equal(loggedOutNavBlock.includes("Events"), false);
assert.equal(navbarBlock.includes("authenticated ? navItems : loggedOutNavItems"), true);
assert.equal(navbarBlock.includes("href=\"/login?returnTo=/\""), true);
assert.equal(navbarBlock.includes("href=\"/setup\""), true);
assert.equal((navbarBlock.match(/Add Your Server/g) ?? []).length, 1);
assert.equal(landingRenderBlock.includes("isPreviewMode ? ("), true);
assert.equal(landingRenderBlock.includes("<NetworkOverview homeStats={liveStats.data} />"), true);
assert.equal(homepageSource.includes("DZN LOGGED OUT PREVIEW ACCESS TIGHTENED"), true);
assert.equal(homepageSource.includes("DZN LOGGED OUT CTA CLEANUP COMPLETE"), true);
assert.equal(homepageSource.includes("DZN HOMEPAGE ADD SERVER CTA DEDUPED"), true);
assert.equal((homepageSource.match(/href="\/login\?returnTo=\/"/g) ?? []).length, 2);
assert.equal((homepageSource.match(/Add Your Server/g) ?? []).length, 1);
assert.equal(navbarBlock.includes("Login"), true);
assert.equal(heroBlock.includes("Login with Discord"), true);
assert.equal(heroBlock.includes("Join DZN Discord"), true);
assert.equal(heroBlock.includes("View Leaderboards"), true);
assert.equal(heroBlock.includes("Add Your Server"), false);
assert.equal(previewBannerBlock.includes("Login with Discord"), false);
assert.equal(previewBannerBlock.includes("href=\"/login?returnTo=/\""), false);
assert.equal(lockedPreviewPanelBlock.includes("Login to unlock"), false);
assert.equal(lockedPreviewPanelBlock.includes("href="), false);
assert.equal(lockedPreviewPanelBlock.includes("<Lock className=\"h-4 w-4\" />"), true);
assert.equal(lockedPreviewPanelBlock.includes("Login required"), true);
assert.equal(topServersPanelBlock.includes("/login?returnTo=/leaderboards"), false);
assert.equal(topServersPanelBlock.includes("dzn-top-servers-view--static"), true);
assert.equal(homepageSource.includes("DZN RECENT ACTIVITY SPACING FIXED"), true);
assert.equal(homepageSource.includes("DZN BUILD TRACKING LEADERBOARD UPGRADED"), true);
assert.equal(homeStatsSource.includes("event_type: \"build\""), true);
assert.equal(homeStatsSource.includes("Build Tracking Leaderboard"), true);
assert.equal(homeStatsSource.includes("Refreshes every 5 minutes"), true);
assert.equal(homeStatsSource.includes(".slice(0, 10)"), true);
assert.equal(homeStatsSource.includes("full_walls_built"), true);
assert.equal(homeStatsSource.includes("watchtowers_built"), true);
assert.equal(homeStatsSource.includes("gates_fence_kits_built"), true);
assert.equal(homeStatsSource.includes("storage_expansion_built"), true);
assert.equal(buildLeaderboardBlock.includes("BuildTrackingLeaderboard"), true);
assert.equal(buildLeaderboardBlock.includes("dzn-build-breakdown-grid"), true);
assert.equal(buildLeaderboardBlock.includes("dzn-build-top10"), true);
assert.equal(buildLeaderboardBlock.includes("View Full Stats"), true);
assert.equal(buildLeaderboardBlock.includes("rows.slice(0, 10)"), true);
assert.equal(buildLeaderboardCssBlock.includes("dzn-build-breakdown-card--walls"), true);
assert.equal(buildLeaderboardCssBlock.includes("dzn-build-breakdown-card--watchtowers"), true);
assert.equal(buildLeaderboardCssBlock.includes("dzn-build-breakdown-card--gates"), true);
assert.equal(buildLeaderboardCssBlock.includes("dzn-build-breakdown-card--storage"), true);
assert.equal(recentActivityPanelBlock.includes("dzn-recent-activity-row"), true);
assert.equal(recentActivityPanelBlock.includes("dzn-recent-activity-title"), true);
assert.equal(recentActivityPanelBlock.includes("dzn-recent-activity-meta"), true);
assert.equal(recentActivityPanelBlock.includes("truncate"), false);
assert.equal(activityRowsBlock.includes("formatKillActivityDisplay"), true);
assert.equal(activityRowsBlock.includes("killerName"), true);
assert.equal(activityRowsBlock.includes("victimName"), true);
assert.equal(activityRowsBlock.includes("weapon"), true);
assert.equal(activityRowsBlock.includes("distance"), true);
assert.equal(recentActivityCssBlock.includes("grid-template-columns: 2.375rem minmax(0, 1fr) auto;"), true);
assert.equal(recentActivityCssBlock.includes("min-width: 0;"), true);
assert.equal(recentActivityCssBlock.includes("-webkit-line-clamp: 2;"), true);
assert.equal(recentActivityCssBlock.includes("overflow-wrap: anywhere;"), true);
assert.equal(recentActivityCssBlock.includes("white-space: nowrap;"), true);
assert.equal(homeStatsSource.includes("killerName: row.source === \"kill\" ? row.killer_name : null"), true);
assert.equal(homeStatsSource.includes("distance: row.source === \"kill\" ? finiteNumber(row.distance) : null"), true);
assert.equal(bottomCtaBlock.includes("Login with Discord"), false);
assert.equal(bottomCtaBlock.includes("Add Your Server"), false);
assert.equal(bottomCtaBlock.includes("href=\"#features\""), true);
assert.equal(bottomCtaBlock.includes("/login?returnTo=/setup"), false);
assert.equal(homepageSource.includes("dzn-preview-locked-panel__button"), false);

console.log("Public access gating tests passed.");
