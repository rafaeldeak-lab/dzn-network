import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

type SqlValue = string | number | null;

type PreviewServer = {
  id: string;
  guildId: string;
  guildDbId: string;
  userId: string;
  ownerDiscordId: string;
  serviceId: string;
  slug: string | null;
  name: string;
  planKey: "starter" | "pro" | "premium";
  subscriptionStatus: "active" | "trialing" | "past_due" | "canceled";
  mode: string;
  category: string;
  mapName: string;
  currentPlayers: number | null;
  maxPlayers: number;
  listingVisibility: "public" | "hidden";
  updatedAt: string;
};

type PreviewUser = {
  id: string;
  discordId: string;
  username: string;
  token: string | null;
  planKey: "free" | "starter" | "pro" | "premium";
  planStatus: "active" | "trialing" | "past_due" | "canceled";
};

const PREVIEW_PREFIX = "adv-preview-";
const OWNER_TOKEN = "preview-advanced-owner-token";
const LOCKED_TOKEN = "preview-advanced-locked-token";
const OTHER_TOKEN = "preview-advanced-other-token";
const SESSION_SECRET = "dev-session-secret";
const NOW = "2026-06-06T18:00:00.000Z";

if (process.argv.some((arg) => arg === "--remote" || arg.includes("--remote"))) {
  throw new Error("This seed script is local-preview only and must never run with --remote.");
}

const users: PreviewUser[] = [
  { id: `${PREVIEW_PREFIX}owner`, discordId: `${PREVIEW_PREFIX}owner-discord`, username: "Advanced Premium Preview Owner", token: OWNER_TOKEN, planKey: "premium", planStatus: "active" },
  { id: `${PREVIEW_PREFIX}pro-owner`, discordId: `${PREVIEW_PREFIX}pro-discord`, username: "Advanced Pro Preview Owner", token: null, planKey: "pro", planStatus: "active" },
  { id: `${PREVIEW_PREFIX}locked-owner`, discordId: `${PREVIEW_PREFIX}locked-discord`, username: "Starter Preview Owner", token: LOCKED_TOKEN, planKey: "starter", planStatus: "active" },
  { id: `${PREVIEW_PREFIX}free-owner`, discordId: `${PREVIEW_PREFIX}free-discord`, username: "Free Preview Owner", token: null, planKey: "free", planStatus: "canceled" },
  { id: `${PREVIEW_PREFIX}cancelled-owner`, discordId: `${PREVIEW_PREFIX}cancelled-discord`, username: "Cancelled Preview Owner", token: null, planKey: "premium", planStatus: "past_due" },
  { id: `${PREVIEW_PREFIX}other-owner`, discordId: `${PREVIEW_PREFIX}other-discord`, username: "Cross Owner Preview", token: OTHER_TOKEN, planKey: "premium", planStatus: "trialing" },
];

const servers: PreviewServer[] = [
  {
    id: `${PREVIEW_PREFIX}premium-dm`,
    guildId: `${PREVIEW_PREFIX}guild-premium-dm`,
    guildDbId: `${PREVIEW_PREFIX}discord-guild-premium-dm`,
    userId: `${PREVIEW_PREFIX}owner`,
    ownerDiscordId: `${PREVIEW_PREFIX}owner-discord`,
    serviceId: "900001",
    slug: "advanced-premium-deathmatch",
    name: "Advanced Premium Deathmatch",
    planKey: "premium",
    subscriptionStatus: "active",
    mode: "DEATHMATCH",
    category: "deathmatch",
    mapName: "ChernarusPlus",
    currentPlayers: 7,
    maxPlayers: 50,
    listingVisibility: "public",
    updatedAt: "2026-06-06T18:05:00.000Z",
  },
  {
    id: `${PREVIEW_PREFIX}other-deathmatch`,
    guildId: `${PREVIEW_PREFIX}guild-other-deathmatch`,
    guildDbId: `${PREVIEW_PREFIX}discord-guild-other-deathmatch`,
    userId: `${PREVIEW_PREFIX}other-owner`,
    ownerDiscordId: `${PREVIEW_PREFIX}other-discord`,
    serviceId: "900008",
    slug: "advanced-other-deathmatch",
    name: "Advanced Other Deathmatch",
    planKey: "premium",
    subscriptionStatus: "trialing",
    mode: "DEATHMATCH",
    category: "deathmatch",
    mapName: "ChernarusPlus",
    currentPlayers: 5,
    maxPlayers: 44,
    listingVisibility: "public",
    updatedAt: "2026-06-06T18:04:30.000Z",
  },
  {
    id: `${PREVIEW_PREFIX}pro-pve`,
    guildId: `${PREVIEW_PREFIX}guild-pro-pve`,
    guildDbId: `${PREVIEW_PREFIX}discord-guild-pro-pve`,
    userId: `${PREVIEW_PREFIX}pro-owner`,
    ownerDiscordId: `${PREVIEW_PREFIX}pro-discord`,
    serviceId: "900002",
    slug: "advanced-pro-pve",
    name: "Advanced Pro PVE Builders",
    planKey: "pro",
    subscriptionStatus: "active",
    mode: "PVE",
    category: "pve",
    mapName: "Livonia",
    currentPlayers: 3,
    maxPlayers: 40,
    listingVisibility: "public",
    updatedAt: "2026-06-06T18:04:00.000Z",
  },
  {
    id: `${PREVIEW_PREFIX}starter-basic`,
    guildId: `${PREVIEW_PREFIX}guild-starter`,
    guildDbId: `${PREVIEW_PREFIX}discord-guild-starter`,
    userId: `${PREVIEW_PREFIX}locked-owner`,
    ownerDiscordId: `${PREVIEW_PREFIX}locked-discord`,
    serviceId: "900003",
    slug: "advanced-starter-basic",
    name: "Advanced Starter Basic",
    planKey: "starter",
    subscriptionStatus: "active",
    mode: "SURVIVAL",
    category: "survival",
    mapName: "ChernarusPlus",
    currentPlayers: 0,
    maxPlayers: 30,
    listingVisibility: "public",
    updatedAt: "2026-06-06T18:03:00.000Z",
  },
  {
    id: `${PREVIEW_PREFIX}free-preview`,
    guildId: `${PREVIEW_PREFIX}guild-free`,
    guildDbId: `${PREVIEW_PREFIX}discord-guild-free`,
    userId: `${PREVIEW_PREFIX}free-owner`,
    ownerDiscordId: `${PREVIEW_PREFIX}free-discord`,
    serviceId: "900004",
    slug: "advanced-free-preview",
    name: "Advanced Free Preview",
    planKey: "starter",
    subscriptionStatus: "canceled",
    mode: "PVP",
    category: "pvp",
    mapName: "ChernarusPlus",
    currentPlayers: 0,
    maxPlayers: 20,
    listingVisibility: "public",
    updatedAt: "2026-06-06T18:02:00.000Z",
  },
  {
    id: `${PREVIEW_PREFIX}cancelled-premium`,
    guildId: `${PREVIEW_PREFIX}guild-cancelled-premium`,
    guildDbId: `${PREVIEW_PREFIX}discord-guild-cancelled-premium`,
    userId: `${PREVIEW_PREFIX}cancelled-owner`,
    ownerDiscordId: `${PREVIEW_PREFIX}cancelled-discord`,
    serviceId: "900005",
    slug: "advanced-cancelled-premium",
    name: "Advanced Cancelled Premium",
    planKey: "premium",
    subscriptionStatus: "past_due",
    mode: "HYBRID",
    category: "hybrid",
    mapName: "Sakhal",
    currentPlayers: 1,
    maxPlayers: 32,
    listingVisibility: "public",
    updatedAt: "2026-06-06T18:01:00.000Z",
  },
  {
    id: `${PREVIEW_PREFIX}private-premium`,
    guildId: `${PREVIEW_PREFIX}guild-private-premium`,
    guildDbId: `${PREVIEW_PREFIX}discord-guild-private-premium`,
    userId: `${PREVIEW_PREFIX}owner`,
    ownerDiscordId: `${PREVIEW_PREFIX}owner-discord`,
    serviceId: "900006",
    slug: "advanced-private-premium",
    name: "Advanced Private Premium",
    planKey: "premium",
    subscriptionStatus: "active",
    mode: "PVP",
    category: "pvp",
    mapName: "ChernarusPlus",
    currentPlayers: 2,
    maxPlayers: 24,
    listingVisibility: "hidden",
    updatedAt: "2026-06-06T18:00:30.000Z",
  },
  {
    id: `${PREVIEW_PREFIX}other-owner-premium`,
    guildId: `${PREVIEW_PREFIX}guild-other-premium`,
    guildDbId: `${PREVIEW_PREFIX}discord-guild-other-premium`,
    userId: `${PREVIEW_PREFIX}other-owner`,
    ownerDiscordId: `${PREVIEW_PREFIX}other-discord`,
    serviceId: "900007",
    slug: "advanced-other-premium",
    name: "Advanced Other Owner Premium",
    planKey: "premium",
    subscriptionStatus: "trialing",
    mode: "PVP",
    category: "pvp",
    mapName: "ChernarusPlus",
    currentPlayers: 4,
    maxPlayers: 40,
    listingVisibility: "public",
    updatedAt: "2026-06-06T17:59:00.000Z",
  },
];

const statements: string[] = [
  "-- Local-only deterministic advanced showcase preview seed.",
  "-- This file intentionally uses INSERT OR REPLACE and is executed through wrangler d1 --local only.",
  `CREATE TABLE IF NOT EXISTS owner_billing_accounts (
    id TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL UNIQUE,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    plan_key TEXT NOT NULL DEFAULT 'free',
    plan_status TEXT NOT NULL DEFAULT 'free',
    current_period_start TEXT,
    current_period_end TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
];

for (const user of users) {
  statements.push(insert("users", {
    id: user.id,
    discord_id: user.discordId,
    username: user.username,
    avatar: null,
    created_at: NOW,
    updated_at: NOW,
  }));
  if (user.token) {
    statements.push(insert("sessions", {
      id: `${user.id}-session`,
      user_id: user.id,
      session_token_hash: hmacSession(user.token),
      expires_at: "2026-07-06T18:00:00.000Z",
      created_at: NOW,
    }));
  }
  statements.push(insert("owner_billing_accounts", {
    id: `${user.id}-billing`,
    discord_user_id: user.discordId,
    stripe_customer_id: null,
    stripe_subscription_id: user.planKey === "free" ? null : `${user.id}-local-owner-subscription`,
    plan_key: user.planKey,
    plan_status: user.planStatus,
    current_period_start: "2026-06-01T00:00:00.000Z",
    current_period_end: "2026-07-01T00:00:00.000Z",
    cancel_at_period_end: user.planStatus === "canceled" ? 1 : 0,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: NOW,
  }));
}

for (const server of servers) {
  statements.push(insert("discord_guilds", {
    id: server.guildDbId,
    guild_id: server.guildId,
    owner_user_id: server.userId,
    name: `${server.name} Discord`,
    icon: null,
    icon_url: null,
    permissions: "8",
    is_owner: 1,
    created_at: NOW,
    updated_at: NOW,
  }));
  statements.push(insert("linked_servers", {
    id: server.id,
    user_id: server.userId,
    guild_id: server.guildId,
    discord_guild_id: server.guildDbId,
    nitrado_service_id: server.serviceId,
    nitrado_service_name: server.name,
    server_name: server.name,
    server_type: server.category,
    server_category: server.category,
    tags_json: JSON.stringify([server.mode, server.planKey, "advanced-preview"]),
    region: "EU",
    game: "DayZ",
    platform: "PlayStation",
    ip_address: "127.0.0.1",
    player_slots: server.maxPlayers,
    status: "live",
    public_slug: server.slug,
    created_at: "2026-06-06T12:00:00.000Z",
    updated_at: server.updatedAt,
    display_name: server.name,
    hostname: server.name,
    description: `${server.name} deterministic local advanced showcase preview data.`,
    max_players: server.maxPlayers,
    current_players: server.currentPlayers,
    map_name: server.mapName,
    mission: server.mapName,
    server_status: "online",
    is_online: 1,
    server_mode: server.mode,
    server_mode_source: "preview-seed",
    metadata_last_checked_at: "2026-06-06T18:00:00.000Z",
    metadata_last_changed_at: "2026-06-06T17:55:00.000Z",
    player_count_last_checked_at: "2026-06-06T18:00:00.000Z",
    player_count_source: "preview-seed",
    player_count_status: "fresh",
    public_short_description: `${server.mode} advanced showcase preview.`,
    public_description: `${server.name} contains seeded ADM-derived combat, build, travel, and exploration rows for local preview only.`,
    public_language: "English",
    public_region_label: "Europe",
    public_listing_updated_at: "2026-06-06T18:00:00.000Z",
    listing_visibility: server.listingVisibility,
  }));
  statements.push(insert("server_subscriptions", {
    id: `${server.id}-subscription`,
    guild_id: server.guildId,
    owner_discord_id: server.ownerDiscordId,
    stripe_customer_id: null,
    stripe_subscription_id: `${server.id}-local-subscription`,
    stripe_price_id: `${server.planKey}-local-price`,
    plan_key: server.planKey,
    status: server.subscriptionStatus,
    current_period_start: "2026-06-01T00:00:00.000Z",
    current_period_end: "2026-07-01T00:00:00.000Z",
    cancel_at_period_end: 0,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: server.updatedAt,
  }));
  statements.push(insert("server_public_cache", {
    id: `${server.id}-public-cache`,
    guild_id: server.guildId,
    plan_key: server.planKey,
    public_server_name: server.name,
    current_player_count: server.currentPlayers,
    max_player_count: server.maxPlayers,
    server_online: 1,
    server_status: "online",
    leaderboard_snapshot_json: null,
    event_snapshot_json: null,
    network_rank: null,
    partner_featured: server.planKey === "premium" && server.subscriptionStatus === "active" ? 1 : 0,
    last_status_update_at: "2026-06-06T18:00:00.000Z",
    last_adm_update_at: "2026-06-06T18:00:00.000Z",
    updated_at: server.updatedAt,
  }));
}

seedProfilesAndEvents();
seedServerWarsPreview();

const sqlFile = join(tmpdir(), "dzn-advanced-showcase-preview-seed.sql");
writeFileSync(sqlFile, `${statements.join("\n")}\n`, "utf8");

const wranglerCli = join("node_modules", "wrangler", "bin", "wrangler.js");
const result = spawnSync(process.execPath, [wranglerCli, "d1", "execute", "dzn_network_db", "--local", "--file", sqlFile], {
  stdio: "inherit",
});

if (result.status !== 0) {
  throw new Error(`Local advanced showcase preview seed failed with exit code ${result.status ?? "unknown"}.`);
}

console.log("Advanced showcase preview seed complete.");
console.log("Local preview auth cookies:");
console.log(`  Owner unlocked: dzn_session=${OWNER_TOKEN}`);
console.log(`  Starter/locked: dzn_session=${LOCKED_TOKEN}`);
console.log(`  Cross-owner: dzn_session=${OTHER_TOKEN}`);

function seedProfilesAndEvents() {
  const playerNames = ["Raptor", "Ghost", "Medic", "Builder", "Scout", "Rival", "Nomad", "Warden"];
  for (const server of servers) {
    for (let index = 0; index < playerNames.length; index += 1) {
      const name = `${playerNames[index]} ${server.planKey.toUpperCase()}`;
      const playerId = `${server.id}-player-${index + 1}`;
      statements.push(insert("player_profiles", {
        id: `${server.id}-profile-${index + 1}`,
        linked_server_id: server.id,
        player_name: name,
        player_id: playerId,
        discord_id: null,
        kills: server.id.includes("premium-dm") ? Math.max(0, 14 - index) : Math.max(0, 6 - index),
        deaths: index + 1,
        suicides: 0,
        longest_kill_distance: 160 - index * 8,
        last_seen_at: iso(index),
        first_seen_at: "2026-06-06T13:00:00.000Z",
        created_at: "2026-06-06T13:00:00.000Z",
        updated_at: iso(index),
        source_service_id: server.serviceId,
        highest_killstreak: Math.max(1, 8 - index),
        current_killstreak: Math.max(0, 4 - index),
        total_time_alive_seconds: 3600 + index * 420,
        headshots: Math.max(0, 4 - index),
        favourite_weapon: index % 2 === 0 ? "M4-A1" : "KA-M",
      }));
    }

    const killCount = server.id.includes("premium-dm") ? 32 : server.id.includes("pro-pve") ? 3 : server.id.includes("starter") ? 2 : 6;
    for (let index = 0; index < killCount; index += 1) {
      addKill(server, index, playerNames);
    }
    addPlayerMovement(server, playerNames);
  }

  addBuildEvents(servers.find((server) => server.id.endsWith("pro-pve"))!, "pro");
  addBuildEvents(servers.find((server) => server.id.endsWith("premium-dm"))!, "premium");
  addBuildEvents(servers.find((server) => server.id.endsWith("cancelled-premium"))!, "cancelled");

  for (const server of servers) {
    const killCount = server.id.includes("premium-dm") ? 32 : server.id.includes("pro-pve") ? 3 : server.id.includes("starter") ? 2 : 6;
    const playerEventCount = 16;
    statements.push(insert("server_stats", {
      id: `${server.id}-stats`,
      linked_server_id: server.id,
      total_kills: killCount,
      total_deaths: killCount,
      total_joins: playerEventCount / 2,
      total_disconnects: playerEventCount / 2,
      unique_players: playerNames.length,
      last_event_at: "2026-06-06T18:00:00.000Z",
      updated_at: "2026-06-06T18:00:00.000Z",
      source_service_id: server.serviceId,
    }));
  }
}

function seedServerWarsPreview() {
  const premium = servers.find((server) => server.id.endsWith("premium-dm"))!;
  const opponent = servers.find((server) => server.id.endsWith("other-deathmatch"))!;
  const proPve = servers.find((server) => server.id.endsWith("pro-pve"))!;

  addServerWarEvent({
    id: `${PREVIEW_PREFIX}war-live-deathmatch`,
    slug: "preview-live-deathmatch-war",
    title: "Preview Live Deathmatch War",
    description: "Local preview Server Wars event using deterministic ADM-derived snapshot data.",
    eventType: "deathmatch_war",
    category: "deathmatch",
    eligibleCategories: ["deathmatch"],
    status: "live",
    ruleset: "deathmatch_war",
    startsAt: "2026-06-06T17:00:00.000Z",
    endsAt: "2026-06-06T20:00:00.000Z",
    createdByUserId: premium.userId,
    createdByServerId: premium.id,
    visibility: "public",
    packageRequired: "pro",
  });
  addServerWarParticipant(`${PREVIEW_PREFIX}war-live-deathmatch`, premium, "joined");
  addServerWarParticipant(`${PREVIEW_PREFIX}war-live-deathmatch`, opponent, "joined");
  addServerWarSnapshot(`${PREVIEW_PREFIX}war-live-deathmatch`, premium, 1, 612, {
    kills: 32,
    deaths: 24,
    uniqueFighters: 8,
    longestKillM: 187.7,
    kdRatio: 1.33,
    thresholds: { kdBonus: true, fullEligibility: true },
  });
  addServerWarSnapshot(`${PREVIEW_PREFIX}war-live-deathmatch`, opponent, 2, 488, {
    kills: 24,
    deaths: 21,
    uniqueFighters: 7,
    longestKillM: 154.4,
    kdRatio: 1.14,
    thresholds: { kdBonus: false, fullEligibility: true },
  });

  addServerWarEvent({
    id: `${PREVIEW_PREFIX}war-auto-scheduled`,
    slug: "preview-auto-start-server-war",
    title: "Preview Auto-Started Server War",
    description: "Local preview event that automation promotes from scheduled to live and snapshots automatically.",
    eventType: "deathmatch_war",
    category: "deathmatch",
    eligibleCategories: ["deathmatch"],
    status: "scheduled",
    ruleset: "deathmatch_war",
    startsAt: "2026-06-06T13:00:00.000Z",
    endsAt: "2035-06-06T20:00:00.000Z",
    createdByUserId: premium.userId,
    createdByServerId: premium.id,
    visibility: "public",
    packageRequired: "pro",
  });
  addServerWarParticipant(`${PREVIEW_PREFIX}war-auto-scheduled`, premium, "joined");
  addServerWarParticipant(`${PREVIEW_PREFIX}war-auto-scheduled`, opponent, "joined");

  addServerWarEvent({
    id: `${PREVIEW_PREFIX}war-auto-ended`,
    slug: "preview-auto-finalized-server-war",
    title: "Preview Auto-Finalized Server War",
    description: "Local preview event that automation finalizes into frozen results, trophy, and current title.",
    eventType: "deathmatch_war",
    category: "deathmatch",
    eligibleCategories: ["deathmatch"],
    status: "live",
    ruleset: "deathmatch_war",
    startsAt: "2026-06-06T13:00:00.000Z",
    endsAt: "2026-06-06T19:00:00.000Z",
    createdByUserId: premium.userId,
    createdByServerId: premium.id,
    visibility: "public",
    packageRequired: "pro",
  });
  addServerWarParticipant(`${PREVIEW_PREFIX}war-auto-ended`, premium, "joined");
  addServerWarParticipant(`${PREVIEW_PREFIX}war-auto-ended`, opponent, "joined");

  addServerWarEvent({
    id: `${PREVIEW_PREFIX}war-pending-challenge`,
    slug: "preview-pending-challenge",
    title: "Preview Pending Challenge",
    description: "Local preview head-to-head challenge awaiting opponent response.",
    eventType: "deathmatch_war",
    category: "deathmatch",
    eligibleCategories: ["deathmatch"],
    status: "pending_acceptance",
    ruleset: "deathmatch_war",
    startsAt: "2026-06-06T19:00:00.000Z",
    endsAt: "2026-06-06T21:00:00.000Z",
    createdByUserId: premium.userId,
    createdByServerId: premium.id,
    visibility: "public",
    packageRequired: "pro",
  });
  addServerWarParticipant(`${PREVIEW_PREFIX}war-pending-challenge`, premium, "accepted");
  addServerWarParticipant(`${PREVIEW_PREFIX}war-pending-challenge`, opponent, "pending");
  statements.push(insert("server_war_challenges", {
    id: `${PREVIEW_PREFIX}challenge-pending`,
    event_id: `${PREVIEW_PREFIX}war-pending-challenge`,
    challenger_server_id: premium.id,
    opponent_server_id: opponent.id,
    challenger_owner_user_id: premium.userId,
    opponent_owner_user_id: opponent.userId,
    status: "pending",
    message: "Local preview pending same-category Server Wars challenge.",
    expires_at: "2026-06-07T18:00:00.000Z",
    accepted_at: null,
    declined_at: null,
    created_at: NOW,
    updated_at: NOW,
  }));

  addServerWarEvent({
    id: `${PREVIEW_PREFIX}war-expired-challenge`,
    slug: "preview-expired-challenge",
    title: "Preview Expired Challenge",
    description: "Local preview challenge that automation marks expired without awarding trophies.",
    eventType: "deathmatch_war",
    category: "deathmatch",
    eligibleCategories: ["deathmatch"],
    status: "pending_acceptance",
    ruleset: "deathmatch_war",
    startsAt: "2026-06-08T19:00:00.000Z",
    endsAt: "2026-06-08T21:00:00.000Z",
    createdByUserId: premium.userId,
    createdByServerId: premium.id,
    visibility: "public",
    packageRequired: "pro",
  });
  addServerWarParticipant(`${PREVIEW_PREFIX}war-expired-challenge`, premium, "accepted");
  addServerWarParticipant(`${PREVIEW_PREFIX}war-expired-challenge`, opponent, "pending");
  statements.push(insert("server_war_challenges", {
    id: `${PREVIEW_PREFIX}challenge-expired`,
    event_id: `${PREVIEW_PREFIX}war-expired-challenge`,
    challenger_server_id: premium.id,
    opponent_server_id: opponent.id,
    challenger_owner_user_id: premium.userId,
    opponent_owner_user_id: opponent.userId,
    status: "pending",
    message: "Local preview expired same-category Server Wars challenge.",
    expires_at: "2026-06-09T18:00:00.000Z",
    accepted_at: null,
    declined_at: null,
    created_at: NOW,
    updated_at: NOW,
  }));

  addServerWarEvent({
    id: `${PREVIEW_PREFIX}war-completed-builders`,
    slug: "preview-completed-builder-cup",
    title: "Preview Completed Builder Cup",
    description: "Local preview completed Server Wars event with frozen results and trophy records.",
    eventType: "pve_builder_cup",
    category: "pve",
    eligibleCategories: ["pve", "pvp_pve"],
    status: "completed",
    ruleset: "pve_builder_cup",
    startsAt: "2026-06-05T17:00:00.000Z",
    endsAt: "2026-06-05T20:00:00.000Z",
    createdByUserId: proPve.userId,
    createdByServerId: proPve.id,
    visibility: "public",
    packageRequired: "pro",
    finalizedAt: "2026-06-05T20:05:00.000Z",
  });
  addServerWarParticipant(`${PREVIEW_PREFIX}war-completed-builders`, proPve, "joined", 1, 355);
  addServerWarSnapshot(`${PREVIEW_PREFIX}war-completed-builders`, proPve, 1, 355, {
    buildScore: 96,
    structuresBuilt: 10,
    repairs: 1,
    activeBuilders: 4,
    raidScore: 8,
  }, "2026-06-05T20:00:00.000Z");
  statements.push(insert("server_war_results", {
    id: `${PREVIEW_PREFIX}result-builders-pro`,
    event_id: `${PREVIEW_PREFIX}war-completed-builders`,
    server_id: proPve.id,
    final_rank: 1,
    final_score: 355,
    metric_breakdown: JSON.stringify({
      buildScore: 96,
      structuresBuilt: 10,
      repairs: 1,
      activeBuilders: 4,
      raidScore: 8,
    }),
    top_contributors: JSON.stringify([{ name: "Builder PRO", contribution: "Top builder", value: 96 }]),
    finalized_at: "2026-06-05T20:05:00.000Z",
    created_at: "2026-06-05T20:05:00.000Z",
  }));
  statements.push(insert("server_trophies", {
    id: `${PREVIEW_PREFIX}trophy-builders-pro`,
    server_id: proPve.id,
    event_id: `${PREVIEW_PREFIX}war-completed-builders`,
    trophy_key: "pve_builder_cup_champion",
    title: "PVE Builder Cup Champion",
    description: "Winner of the local preview Builder Cup.",
    category: "pve",
    reward_type: "permanent",
    awarded_at: "2026-06-05T20:05:00.000Z",
    expires_at: null,
    is_current_title: 0,
    metadata: JSON.stringify({ source: "local-preview", score: 355 }),
    created_at: "2026-06-05T20:05:00.000Z",
  }));
  statements.push(insert("server_champion_titles", {
    id: `${PREVIEW_PREFIX}champion-builders-pro`,
    server_id: proPve.id,
    event_id: `${PREVIEW_PREFIX}war-completed-builders`,
    title_key: "current_pve_builder_champion",
    title: "Current PVE Builder Champion",
    category: "pve",
    awarded_at: "2026-06-05T20:05:00.000Z",
    expires_at: "2026-07-05T20:05:00.000Z",
    active: 1,
    created_at: "2026-06-05T20:05:00.000Z",
    updated_at: "2026-06-05T20:05:00.000Z",
  }));
}

function addServerWarEvent(event: {
  id: string;
  slug: string;
  title: string;
  description: string;
  eventType: string;
  category: string;
  eligibleCategories: string[];
  status: string;
  ruleset: string;
  startsAt: string;
  endsAt: string;
  createdByUserId: string;
  createdByServerId: string;
  visibility: string;
  packageRequired: string;
  finalizedAt?: string;
}) {
  statements.push(insert("server_war_events", {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    event_type: event.eventType,
    category: event.category,
    eligible_categories: JSON.stringify(event.eligibleCategories),
    status: event.status,
    scoring_ruleset_key: event.ruleset,
    starts_at: event.startsAt,
    ends_at: event.endsAt,
    created_by_user_id: event.createdByUserId,
    created_by_server_id: event.createdByServerId,
    visibility: event.visibility,
    package_required: event.packageRequired,
    created_at: NOW,
    updated_at: NOW,
    finalized_at: event.finalizedAt ?? null,
  }));
}

function addServerWarParticipant(eventId: string, server: PreviewServer, status: string, finalRank: number | null = null, finalScore: number | null = null) {
  statements.push(insert("server_war_participants", {
    id: `${eventId}-${server.id}-participant`,
    event_id: eventId,
    server_id: server.id,
    owner_user_id: server.userId,
    category_at_entry: server.category,
    status,
    joined_at: status === "joined" || status === "accepted" ? NOW : null,
    accepted_at: status === "joined" || status === "accepted" ? NOW : null,
    declined_at: null,
    final_rank: finalRank,
    final_score: finalScore,
    created_at: NOW,
    updated_at: NOW,
  }));
}

function addServerWarSnapshot(eventId: string, server: PreviewServer, rank: number, score: number, metricBreakdown: Record<string, unknown>, snapshotAt = "2026-06-06T18:00:00.000Z") {
  statements.push(insert("server_war_score_snapshots", {
    id: `${eventId}-${server.id}-snapshot`,
    event_id: eventId,
    server_id: server.id,
    snapshot_at: snapshotAt,
    score,
    rank,
    metric_breakdown: JSON.stringify({
      ...metricBreakdown,
      score,
      rank,
      dataSource: "local-preview-snapshot",
    }),
    contributor_summary: JSON.stringify({
      topContributors: [
        { name: "Raptor", role: "Combat contributor", value: Number(metricBreakdown.kills ?? metricBreakdown.buildScore ?? 0) },
        { name: "Builder", role: "Support contributor", value: Number(metricBreakdown.uniqueFighters ?? metricBreakdown.structuresBuilt ?? 0) },
      ],
      rawCoordinatesExposed: false,
      exactRoutesExposed: false,
    }),
    data_window_start: "2026-06-06T17:00:00.000Z",
    data_window_end: "2026-06-06T20:00:00.000Z",
    computed_at: snapshotAt,
    created_at: snapshotAt,
  }));
}

function addKill(server: PreviewServer, index: number, names: string[]) {
  const killerIndex = index % names.length;
  const victimIndex = (index + 1) % names.length;
  const killer = `${names[killerIndex]} ${server.planKey.toUpperCase()}`;
  const victim = `${names[victimIndex]} ${server.planKey.toUpperCase()}`;
  const distance = 42 + index * 4.7;
  const weapon = index % 3 === 0 ? "M4-A1" : index % 3 === 1 ? "KA-M" : "LAR";
  statements.push(insert("kill_events", {
    id: `${server.id}-kill-${String(index).padStart(3, "0")}`,
    linked_server_id: server.id,
    killer_profile_id: `${server.id}-profile-${killerIndex + 1}`,
    victim_profile_id: `${server.id}-profile-${victimIndex + 1}`,
    killer_name: killer,
    victim_name: victim,
    killer_id: `${server.id}-player-${killerIndex + 1}`,
    victim_id: `${server.id}-player-${victimIndex + 1}`,
    weapon,
    distance: round(distance),
    position_x: 4100 + index * 54,
    position_y: 7800 + index * 38,
    position_z: 295,
    adm_file: "advanced-preview-combat.ADM",
    line_number: index + 1,
    occurred_at: iso(index),
    raw_line: `Preview ADM kill: ${victim} killed by ${killer} with ${weapon} from ${round(distance)} meters`,
    created_at: iso(index),
    source_service_id: server.serviceId,
    source_adm_file: "advanced-preview-combat.ADM",
    source_line_number: index + 1,
    source_sync_run_id: `${server.id}-preview-sync`,
    event_hash: `${server.id}-kill-hash-${index}`,
  }));
}

function addPlayerMovement(server: PreviewServer, names: string[]) {
  let eventIndex = 0;
  for (let playerIndex = 0; playerIndex < Math.min(4, names.length); playerIndex += 1) {
    const playerName = `${names[playerIndex]} ${server.planKey.toUpperCase()}`;
    const playerId = `${server.id}-player-${playerIndex + 1}`;
    const baseX = server.mapName === "Livonia" ? 2500 + playerIndex * 250 : server.mapName === "Sakhal" ? 1200 + playerIndex * 160 : 4200 + playerIndex * 220;
    const baseY = server.mapName === "Livonia" ? 7200 + playerIndex * 210 : server.mapName === "Sakhal" ? 3400 + playerIndex * 120 : 8000 + playerIndex * 230;
    for (let step = 0; step < 4; step += 1) {
      const eventType = step === 0 ? "player_connected" : step === 3 ? "player_disconnected" : "player_position";
      statements.push(insert("player_events", {
        id: `${server.id}-player-event-${playerIndex}-${step}`,
        linked_server_id: server.id,
        player_profile_id: `${server.id}-profile-${playerIndex + 1}`,
        player_name: playerName,
        player_id: playerId,
        event_type: eventType,
        position_x: baseX + step * 180,
        position_y: baseY + step * 130,
        position_z: 280 + step,
        adm_file: "advanced-preview-playerlist.ADM",
        line_number: eventIndex + 1,
        occurred_at: iso(120 + eventIndex * 2),
        raw_line: `Preview ADM ${eventType} for ${playerName}`,
        created_at: iso(120 + eventIndex * 2),
        source_service_id: server.serviceId,
        source_adm_file: "advanced-preview-playerlist.ADM",
        source_line_number: eventIndex + 1,
        source_sync_run_id: `${server.id}-preview-sync`,
        event_hash: `${server.id}-player-event-hash-${playerIndex}-${step}`,
      }));
      eventIndex += 1;
    }
  }
}

function addBuildEvents(server: PreviewServer, suffix: string) {
  const rows = [
    ["placed", null, null, null, "Fence Kit", "FenceKit", "Builder"],
    ["built", "wall_base_up", "Fence", "Hatchet", null, null, "Builder"],
    ["built", "wall_metal_down", "Fence", "Hatchet", null, null, "Builder"],
    ["built", "wall_gate", "Gate", "Pliers", null, null, "Builder"],
    ["placed", null, null, null, "Watchtower Kit", "WatchtowerKit", "Scout"],
    ["built", "level_1_base", "Watchtower", "Shovel", null, null, "Scout"],
    ["built", "level_1_wall_2_base_down", "Watchtower", "Hatchet", null, null, "Scout"],
    ["placed", null, null, null, "Wooden Crate", "WoodenCrate", "Medic"],
    ["placed", null, null, null, "Sea Chest", "SeaChest", "Medic"],
    ["placed", null, null, null, "Barrel", "Barrel_Green", "Medic"],
    ["repaired", null, "Fence", "Hatchet", null, null, "Warden"],
    ["mounted", null, "Fence", null, "BarbedWire", "BarbedWire", "Warden"],
    ["unmounted", null, "Fence", null, "BarbedWire", "BarbedWire", "Warden"],
    ["dismantled", "Upper Frame", "Fence", "Hatchet", null, null, "Rival"],
    ["destroyed", null, "Gate", "Chainsaw", null, null, "Rival"],
    ["placed", null, null, null, "Land Mine", "LandMineTrap", "Nomad"],
    ["placed", null, null, null, "Bear Trap", "BearTrap", "Nomad"],
    ["placed", null, null, null, "Improvised Explosive", "ImprovisedExplosive", "Nomad"],
  ] as const;
  rows.forEach((row, index) => {
    const [eventType, buildPart, targetObject, tool, placedObject, placedClass, name] = row;
    statements.push(insert("build_events", {
      id: `${server.id}-build-${suffix}-${String(index).padStart(3, "0")}`,
      linked_server_id: server.id,
      nitrado_service_id: server.serviceId,
      player_id: `${server.id}-build-player-${name.toLowerCase()}`,
      player_name: `${name} ${server.planKey.toUpperCase()}`,
      event_type: eventType,
      build_part: buildPart,
      target_object: targetObject,
      tool,
      placed_object: placedObject,
      placed_class: placedClass,
      pos_x: 2200 + index * 35,
      pos_y: 6400 + index * 45,
      pos_z: 281,
      source_adm_file: "advanced-preview-build.ADM",
      source_line_number: index + 1,
      occurred_at: iso(240 + index * 3),
      raw_line: `Preview ADM build action ${eventType} ${buildPart ?? placedObject ?? targetObject ?? ""}`.trim(),
      created_at: iso(240 + index * 3),
    }));
  });
}

function insert(table: string, row: Record<string, SqlValue>) {
  const columns = Object.keys(row);
  return `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => sql(row[column])).join(", ")});`;
}

function sql(value: SqlValue) {
  if (value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function hmacSession(token: string) {
  return createHmac("sha256", SESSION_SECRET).update(token).digest("base64url");
}

function iso(minutes: number) {
  return new Date(Date.parse("2026-06-06T13:00:00.000Z") + minutes * 60_000).toISOString();
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
