export type EventStatus = "live" | "upcoming" | "standby" | "ended" | "registration_open" | "full";
export type ServerCategory = "deathmatch" | "pvp" | "pve" | "pvp_pve" | "hardcore" | "roleplay" | "faction_wars" | "vanilla" | "modded";
export type EventType = "capture_the_flag" | "community_cup" | "bot_tournament" | "faction_wars" | "seasonal_wars" | "kill_race" | "survival_challenge";

export type CompetitiveEvent = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: ServerCategory;
  category_label: string;
  event_type: EventType;
  event_type_label: string;
  status: EventStatus;
  status_label: string;
  premium_tier: string;
  registered_servers: number;
  total_participants: number;
  progress_percent: number;
  total_score: number;
  match_count: number;
  server_limit: number | null;
  starts_at: string | null;
  ends_at: string | null;
  banner_url: string | null;
  rules?: string | null;
  rewards?: string | null;
};

export type EventServer = {
  rank?: number;
  registration_id: string;
  server_id: string;
  server_name: string;
  public_slug: string | null;
  category: ServerCategory;
  category_label: string;
  approved: boolean;
  score: number;
  wins: number;
  losses: number;
  draws: number;
  seed: number | null;
  registered_at: string | null;
  current_players: number;
  max_players: number;
  event_mmr: number;
  verified_server: boolean;
};

export type EventMatch = {
  id: string;
  event_id: string;
  category: ServerCategory;
  category_label: string;
  match_status: string;
  winner_server_id: string | null;
  winner_name: string | null;
  round_number: number;
  left_score: number;
  right_score: number;
  starts_at: string | null;
  ends_at: string | null;
  left_server: Pick<EventServer, "server_id" | "server_name" | "public_slug">;
  right_server: Pick<EventServer, "server_id" | "server_name" | "public_slug">;
};

export type EventActivity = {
  id: string;
  event_id: string | null;
  event_name: string | null;
  event_slug: string | null;
  server_id: string | null;
  server_name: string | null;
  public_slug: string | null;
  activity_type: string;
  message: string;
  created_at: string | null;
};

export type EventsPayload = {
  ok: boolean;
  generated_at: string;
  source: string;
  teaserMode: boolean;
  full: boolean;
  summary: {
    active_events: number;
    upcoming_events: number;
    completed_events: number;
    registered_servers: number;
    total_participants: number;
  };
  events: CompetitiveEvent[];
};

export type EventDetailPayload = {
  ok: boolean;
  source: string;
  premiumLocked: boolean;
  teaserMode: boolean;
  event: CompetitiveEvent;
  registered_servers: EventServer[];
  leaderboard: EventServer[];
  activity_feed: EventActivity[];
  current_matches: EventMatch[];
  matches: EventMatch[];
};

export type ServerEventsPayload = {
  ok: boolean;
  source: string;
  premiumLocked: boolean;
  server: {
    server_id: string;
    server_name: string;
    public_slug: string | null;
    category: ServerCategory;
    category_label: string;
    verified_server: boolean;
    event_mmr: number;
    season_points: number;
    event_wins: number;
    event_losses: number;
    event_draws: number;
    last_event_at: string | null;
  };
  current_events: CompetitiveEvent[];
  upcoming_events: CompetitiveEvent[];
  event_history: CompetitiveEvent[];
  trophies: Array<{ label: string; value: string }>;
  recent_matches: EventMatch[];
  compatible_upcoming_events: CompetitiveEvent[];
};

const now = Date.now();

export const fallbackEvents: CompetitiveEvent[] = [
  event("dzn-season-1", "DZN Season 1", "Capture the flag across verified console communities.", "deathmatch", "capture_the_flag", "live", 32, 512, 88, "/media/dzn-cinematic-survivor.png", 2),
  event("weekly-warriors", "Weekly Warriors", "Community cup duel nights for Deathmatch servers only.", "deathmatch", "community_cup", "live", 16, 256, 62, "/dzn/build/build-hero.webp", 1),
  event("pandora-showdown", "Pandora Showdown", "Roster-locked bot tournament with verified PvP scoring.", "pvp", "bot_tournament", "live", 8, 128, 51, "/media/dzn-cinematic-survivor.png", 4),
  event("spring-clash", "Spring Clash", "Faction Wars registration with same-category pairing.", "faction_wars", "faction_wars", "registration_open", 24, 384, 12, "/dzn/build/watchtower.webp", 8),
  event("legends-cup", "Legends Cup", "Hardcore survival challenge with premium analytics.", "hardcore", "survival_challenge", "upcoming", 16, 258, 0, "/dzn/build/gates-fence.webp", 14),
  event("summer-wars", "Summer Wars", "PvP/PvE seasonal conflict for hybrid communities.", "pvp_pve", "seasonal_wars", "upcoming", 32, 512, 0, "/dzn/build/full-walls.webp", 21),
  event("iron-vanilla-cup", "Iron Vanilla Cup", "A clean-rules tournament for vanilla shards.", "vanilla", "kill_race", "ended", 12, 144, 100, "/dzn/build/storage-expansion.webp", -7),
];

export const fallbackServers: EventServer[] = [
  server("Pandora DayZ", "deathmatch", 2340, 5, 0, 31),
  server("Nuke Town", "deathmatch", 1870, 4, 1, 28),
  server("Warlords PvP", "deathmatch", 1560, 4, 1, 24),
  server("Vendetta", "deathmatch", 1230, 3, 2, 22),
  server("Rogue Squad", "deathmatch", 990, 2, 2, 16),
  server("Outcasts", "deathmatch", 760, 1, 3, 14),
  server("DeadZone UK", "deathmatch", 610, 1, 3, 12),
  server("Iron Valley", "deathmatch", 430, 0, 4, 8),
  server("Last Haven", "deathmatch", 390, 0, 4, 6),
  server("Frontier EU", "deathmatch", 310, 0, 5, 5),
];

export const fallbackMatches: EventMatch[] = [
  match(1, fallbackServers[0], fallbackServers[1], 3, 0, "completed"),
  match(1, fallbackServers[2], fallbackServers[3], 3, 1, "completed"),
  match(1, fallbackServers[4], fallbackServers[5], 3, 0, "live"),
  match(1, fallbackServers[6], fallbackServers[7], 2, 1, "pending"),
  match(2, fallbackServers[0], fallbackServers[2], 2, 1, "live"),
  match(2, fallbackServers[4], fallbackServers[6], 0, 0, "pending"),
  match(3, fallbackServers[0], fallbackServers[4], 0, 0, "pending"),
];

export const fallbackActivity: EventActivity[] = [
  activity("ctf_capture", "Pandora DayZ captured a flag.", "Pandora DayZ", 5),
  activity("score_updated", "Nuke Town gained 250 verified points.", "Nuke Town", 11),
  activity("server_joined_event", "Rogue Squad registered for Deathmatch cup.", "Rogue Squad", 18),
  activity("battle_started", "Weekly Warriors bracket moved to semi finals.", "Warlords PvP", 24),
];

export function fallbackEventsPayload(): EventsPayload {
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source: "display_fallback",
    teaserMode: true,
    full: false,
    summary: {
      active_events: fallbackEvents.filter((item) => item.status === "live").length,
      upcoming_events: fallbackEvents.filter((item) => ["upcoming", "registration_open", "standby"].includes(item.status)).length,
      completed_events: fallbackEvents.filter((item) => item.status === "ended").length,
      registered_servers: fallbackEvents.reduce((total, item) => total + item.registered_servers, 0),
      total_participants: fallbackEvents.reduce((total, item) => total + item.total_participants, 0),
    },
    events: fallbackEvents,
  };
}

export function fallbackEventDetail(slug: string): EventDetailPayload {
  const eventRow = fallbackEvents.find((item) => item.slug === slug) ?? fallbackEvents[0];
  return {
    ok: true,
    source: "display_fallback",
    premiumLocked: true,
    teaserMode: true,
    event: eventRow,
    registered_servers: fallbackServers,
    leaderboard: fallbackServers.map((item, index) => ({ ...item, rank: index + 1 })),
    activity_feed: fallbackActivity,
    current_matches: fallbackMatches.filter((item) => item.match_status !== "completed"),
    matches: fallbackMatches,
  };
}

export function fallbackServerEvents(slug: string): ServerEventsPayload {
  const serverRow = fallbackServers.find((item) => item.public_slug === slug) ?? fallbackServers[0];
  return {
    ok: true,
    source: "display_fallback",
    premiumLocked: true,
    server: {
      server_id: serverRow.server_id,
      server_name: serverRow.server_name,
      public_slug: slug,
      category: serverRow.category,
      category_label: serverRow.category_label,
      verified_server: true,
      event_mmr: serverRow.event_mmr,
      season_points: 3240,
      event_wins: 7,
      event_losses: 2,
      event_draws: 1,
      last_event_at: new Date(now - 7200000).toISOString(),
    },
    current_events: fallbackEvents.filter((item) => item.category === serverRow.category && item.status === "live"),
    upcoming_events: fallbackEvents.filter((item) => item.category === serverRow.category && item.status !== "ended"),
    event_history: fallbackEvents.filter((item) => item.status === "ended"),
    trophies: [{ label: "Season Contender", value: "Top 10" }, { label: "Same Category", value: serverRow.category_label }],
    recent_matches: fallbackMatches,
    compatible_upcoming_events: fallbackEvents.filter((item) => item.category === serverRow.category),
  };
}

export function categoryLabel(category: string | null | undefined) {
  const key = category ?? "modded";
  return key === "pvp_pve" ? "PvP/PvE" : key === "faction_wars" ? "Faction Wars" : key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function event(slug: string, name: string, description: string, category: ServerCategory, eventType: EventType, status: EventStatus, servers: number, participants: number, progress: number, banner: string, dayOffset: number): CompetitiveEvent {
  return {
    id: `fallback-${slug}`,
    name,
    slug,
    description,
    category,
    category_label: categoryLabel(category),
    event_type: eventType,
    event_type_label: eventType.split("_").map(categoryLabel).join(" "),
    status,
    status_label: status.split("_").map(categoryLabel).join(" "),
    premium_tier: status === "ended" ? "free" : "pro",
    registered_servers: servers,
    total_participants: participants,
    progress_percent: progress,
    total_score: progress * 100,
    match_count: Math.max(2, Math.round(servers / 2)),
    server_limit: 32,
    starts_at: new Date(now + dayOffset * 86400000).toISOString(),
    ends_at: new Date(now + (dayOffset + 3) * 86400000).toISOString(),
    banner_url: banner,
    rules: "Only same-category servers can compete. Roster verification and DZN dedupe remain enforced.",
    rewards: "Champion badge, featured placement, premium leaderboard spotlight.",
  };
}

function server(name: string, category: ServerCategory, score: number, wins: number, losses: number, players: number): EventServer {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    registration_id: `fallback-reg-${slug}`,
    server_id: `fallback-${slug}`,
    server_name: name,
    public_slug: slug,
    category,
    category_label: categoryLabel(category),
    approved: true,
    score,
    wins,
    losses,
    draws: wins % 2,
    seed: wins + losses,
    registered_at: new Date(now - wins * 3600000).toISOString(),
    current_players: players,
    max_players: 50,
    event_mmr: 1000 + score / 10,
    verified_server: wins > 2,
  };
}

function match(round: number, left: EventServer, right: EventServer, leftScore: number, rightScore: number, status: string): EventMatch {
  return {
    id: `fallback-match-${round}-${left.server_id}-${right.server_id}`,
    event_id: "fallback-dzn-season-1",
    category: left.category,
    category_label: left.category_label,
    match_status: status,
    winner_server_id: leftScore > rightScore ? left.server_id : rightScore > leftScore ? right.server_id : null,
    winner_name: leftScore > rightScore ? left.server_name : rightScore > leftScore ? right.server_name : null,
    round_number: round,
    left_score: leftScore,
    right_score: rightScore,
    starts_at: new Date(now + round * 3600000).toISOString(),
    ends_at: status === "completed" ? new Date(now - round * 3600000).toISOString() : null,
    left_server: left,
    right_server: right,
  };
}

function activity(type: string, message: string, server: string, minutesAgo: number): EventActivity {
  return {
    id: `fallback-activity-${type}-${minutesAgo}`,
    event_id: "fallback-dzn-season-1",
    event_name: "DZN Season 1",
    event_slug: "dzn-season-1",
    server_id: `fallback-${server.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    server_name: server,
    public_slug: null,
    activity_type: type,
    message,
    created_at: new Date(now - minutesAgo * 60000).toISOString(),
  };
}
