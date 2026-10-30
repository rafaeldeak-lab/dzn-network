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
  /** Discord's canonical icon for a connected server, when it is available. */
  guild_icon_url?: string | null;
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
  left_server: Pick<EventServer, "server_id" | "server_name" | "public_slug" | "guild_icon_url">;
  right_server: Pick<EventServer, "server_id" | "server_name" | "public_slug" | "guild_icon_url">;
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

const BETA_GENERATED_AT = "2026-10-30T00:00:00.000Z";

/**
 * This is deliberately not a synthetic tournament. It keeps the public views
 * useful before a verified organiser publishes their first event, without
 * inventing a score, date, server, registration or live bracket.
 */
export const competitionCentrePreview: CompetitiveEvent = {
  id: "competition-centre-beta",
  name: "Competition Centre Beta",
  slug: "competition-centre-beta",
  description: "The DZN competition workspace is being refined. Published event records, real connected-server marks, and verified results will appear here when organisers open them.",
  category: "modded",
  category_label: "All categories",
  event_type: "community_cup",
  event_type_label: "Competition tools",
  status: "standby",
  status_label: "In beta",
  premium_tier: "none",
  registered_servers: 0,
  total_participants: 0,
  progress_percent: 0,
  total_score: 0,
  match_count: 0,
  server_limit: null,
  starts_at: null,
  ends_at: null,
  banner_url: "/media/competition-centre/competition-centre-hero-v1.png",
  rules: "Competition rules are published by an authorised organiser with each verified event.",
  rewards: "Season and event rewards are shown only after they are configured for a real competition.",
};

export const fallbackEvents: CompetitiveEvent[] = [competitionCentrePreview];
export const fallbackServers: EventServer[] = [];
export const fallbackMatches: EventMatch[] = [];
export const fallbackActivity: EventActivity[] = [];

export function fallbackEventsPayload(): EventsPayload {
  return {
    ok: true,
    generated_at: BETA_GENERATED_AT,
    source: "display_fallback",
    teaserMode: true,
    full: false,
    summary: {
      active_events: 0,
      upcoming_events: 0,
      completed_events: 0,
      registered_servers: 0,
      total_participants: 0,
    },
    events: fallbackEvents,
  };
}

export function fallbackEventDetail(slug: string): EventDetailPayload {
  void slug;
  return {
    ok: true,
    source: "display_fallback",
    premiumLocked: false,
    teaserMode: true,
    event: competitionCentrePreview,
    registered_servers: [],
    leaderboard: [],
    activity_feed: [],
    current_matches: [],
    matches: [],
  };
}

export function fallbackServerEvents(slug: string): ServerEventsPayload {
  return {
    ok: true,
    source: "display_fallback",
    premiumLocked: false,
    server: {
      server_id: slug || "competition-centre-beta",
      server_name: "Competition data is awaiting publication",
      public_slug: null,
      category: "modded",
      category_label: "All categories",
      verified_server: false,
      event_mmr: 0,
      season_points: 0,
      event_wins: 0,
      event_losses: 0,
      event_draws: 0,
      last_event_at: null,
    },
    current_events: [],
    upcoming_events: [],
    event_history: [],
    trophies: [],
    recent_matches: [],
    compatible_upcoming_events: [],
  };
}

export function categoryLabel(category: string | null | undefined) {
  const key = category ?? "modded";
  return key === "pvp_pve" ? "PvP/PvE" : key === "faction_wars" ? "Faction Wars" : key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
