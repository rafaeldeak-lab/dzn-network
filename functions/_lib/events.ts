import { ensureLinkedServerMetadataColumns, requireDb } from "./db";
import { ensureBillingSchema, normalizePlanKey, type PlanKey } from "./plans";
import {
  SERVER_CATEGORIES,
  assertSameServerCategory,
  categoryMismatchPayload,
  getServerCategoryLabel,
  normalizeServerCategory,
  normalizeServerCategoryFromRecord,
  type ServerCategory,
} from "./server-categories";
import type { Env, SessionUser } from "./types";

export const EVENT_STATUSES = ["live", "upcoming", "standby", "ended", "registration_open", "full"] as const;
export const EVENT_TYPES = [
  "capture_the_flag",
  "community_cup",
  "bot_tournament",
  "faction_wars",
  "seasonal_wars",
  "kill_race",
  "survival_challenge",
] as const;

export type CompetitiveEventStatus = typeof EVENT_STATUSES[number];
export type CompetitiveEventType = typeof EVENT_TYPES[number];

const EVENT_TYPE_LABELS: Record<CompetitiveEventType, string> = {
  capture_the_flag: "Capture The Flag",
  community_cup: "Community Cup",
  bot_tournament: "Bot Tournament",
  faction_wars: "Faction Wars",
  seasonal_wars: "Seasonal Wars",
  kill_race: "Kill Race",
  survival_challenge: "Survival Challenge",
};

const FULL_EVENT_PLANS: PlanKey[] = ["pro", "premium", "network", "partner"];

type EventRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  event_type: string;
  status: string;
  visibility: string | null;
  premium_tier: string | null;
  server_limit: number | null;
  team_limit: number | null;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string | null;
  banner_url: string | null;
  rules: string | null;
  rewards: string | null;
  created_at: string | null;
  updated_at: string | null;
  registered_servers: number | null;
  total_score: number | null;
  match_count: number | null;
};

type EventServerRow = {
  id: string;
  server_id: string;
  category: string;
  approved: number | null;
  score: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  seed: number | null;
  registered_at: string | null;
  server_name: string | null;
  public_slug: string | null;
  server_type: string | null;
  server_mode: string | null;
  server_category: string | null;
  current_players: number | null;
  max_players: number | null;
  event_mmr: number | null;
  verified_server: number | null;
};

type MatchRow = {
  id: string;
  event_id: string;
  left_server_id: string;
  right_server_id: string;
  category: string;
  match_status: string | null;
  winner_server_id: string | null;
  round_number: number | null;
  left_score: number | null;
  right_score: number | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  left_server_name: string | null;
  left_slug: string | null;
  right_server_name: string | null;
  right_slug: string | null;
  winner_name: string | null;
};

type ActivityRow = {
  id: string;
  event_id: string | null;
  server_id: string | null;
  activity_type: string;
  message: string;
  metadata: string | null;
  created_at: string | null;
  event_name: string | null;
  event_slug: string | null;
  server_name: string | null;
  public_slug: string | null;
};

type ServerRow = {
  id: string;
  user_id: string | null;
  guild_id: string | null;
  public_slug: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  server_type: string | null;
  server_mode: string | null;
  server_category: string | null;
  competitive_enabled: number | null;
  verified_server: number | null;
  event_mmr: number | null;
  season_points: number | null;
  event_wins: number | null;
  event_losses: number | null;
  event_draws: number | null;
  last_event_at: string | null;
  current_players: number | null;
  max_players: number | null;
  plan_key: string | null;
  subscription_status: string | null;
};

type EventListOptions = {
  status?: string | null;
  category?: string | null;
  type?: string | null;
  full?: boolean;
  limit?: number;
};

type CreateCompetitiveEventInput = {
  name?: string | null;
  description?: string | null;
  event_type?: string | null;
  hosting_server_id?: string | null;
  server_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  server_limit?: number | string | null;
  team_limit?: number | string | null;
  status?: string | null;
  registration_status?: string | null;
  tournament_channel_id?: string | null;
  rules?: string | null;
  rewards?: string | null;
  visibility?: string | null;
};

export async function ensureCompetitiveEventsSchema(env: Env) {
  const db = requireDb(env);
  await ensureLinkedServerMetadataColumns(env);
  await ensureBillingSchema(env);
  await ensureColumns(db, "linked_servers", {
    server_category: "TEXT",
    competitive_enabled: "INTEGER NOT NULL DEFAULT 0",
    verified_server: "INTEGER NOT NULL DEFAULT 0",
    event_mmr: "INTEGER NOT NULL DEFAULT 1000",
    season_points: "INTEGER NOT NULL DEFAULT 0",
    event_wins: "INTEGER NOT NULL DEFAULT 0",
    event_losses: "INTEGER NOT NULL DEFAULT 0",
    event_draws: "INTEGER NOT NULL DEFAULT 0",
    last_event_at: "TEXT",
  });
  for (const statement of COMPETITIVE_EVENT_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
}

export async function getEventsListPayload(env: Env, viewer: SessionUser | null, options: EventListOptions = {}) {
  if (!env.DB) return demoEventsListPayload(options, false);
  await ensureCompetitiveEventsSchema(env);
  const entitlement = await hasFullEventAccess(env, viewer);
  const full = options.full === true && entitlement;
  const limit = full ? sanitizeLimit(options.limit, 100, 100) : Math.min(sanitizeLimit(options.limit, 10, 24), 10);
  const db = requireDb(env);
  const conditions = ["COALESCE(visibility, 'public') != 'private'"];
  const bindings: unknown[] = [];
  const statusFilter = resolveEventStatusFilter(options.status);
  const category = normalizeServerCategory(options.category);
  const type = normalizeEventType(options.type);
  if (statusFilter.length === 1) {
    conditions.push("status = ?");
    bindings.push(statusFilter[0]);
  } else if (statusFilter.length > 1) {
    conditions.push(`status IN (${statusFilter.map(() => "?").join(", ")})`);
    bindings.push(...statusFilter);
  }
  if (category) {
    conditions.push("category = ?");
    bindings.push(category);
  }
  if (type) {
    conditions.push("event_type = ?");
    bindings.push(type);
  }
  const result = await db
    .prepare(
      `SELECT competitive_events.*,
              (SELECT COUNT(*) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS registered_servers,
              (SELECT COALESCE(SUM(score), 0) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS total_score,
              (SELECT COUNT(*) FROM competitive_event_matches WHERE competitive_event_matches.event_id = competitive_events.id) AS match_count
       FROM competitive_events
       WHERE ${conditions.join(" AND ")}
       ORDER BY CASE status
         WHEN 'live' THEN 0
         WHEN 'registration_open' THEN 1
         WHEN 'upcoming' THEN 2
         WHEN 'standby' THEN 3
         WHEN 'full' THEN 4
         ELSE 5
       END, datetime(COALESCE(starts_at, created_at)) ASC
       LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<EventRow>();
  const events = (result.results ?? []).map(toEventSummary);
  const visibleEvents = events.length ? events : filterDemoEvents(options, limit);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source: events.length ? "live" : "display_fallback",
    teaserMode: !full,
    full,
    categoryFilters: SERVER_CATEGORIES.map((value) => ({ value, label: getServerCategoryLabel(value) })),
    statusFilters: EVENT_STATUSES.map((value) => ({ value, label: eventStatusLabel(value) })),
    typeFilters: EVENT_TYPES.map((value) => ({ value, label: eventTypeLabel(value) })),
    summary: summarizeEvents(visibleEvents),
    events: visibleEvents,
  };
}

export async function getEventDetailPayload(env: Env, viewer: SessionUser | null, slug: string, options: { full?: boolean } = {}) {
  if (!env.DB) return demoEventDetailPayload(slug, false);
  await ensureCompetitiveEventsSchema(env);
  const entitlement = await hasFullEventAccess(env, viewer);
  const full = options.full === true && entitlement;
  const event = await requireDb(env)
    .prepare(
      `SELECT competitive_events.*,
              (SELECT COUNT(*) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS registered_servers,
              (SELECT COALESCE(SUM(score), 0) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS total_score,
              (SELECT COUNT(*) FROM competitive_event_matches WHERE competitive_event_matches.event_id = competitive_events.id) AS match_count
       FROM competitive_events
       WHERE slug = ? AND visibility != 'private'
       LIMIT 1`,
    )
    .bind(cleanSlug(slug))
    .first<EventRow>();
  if (!event) return demoEventDetailPayload(slug, entitlement);
  const [servers, matches, activity] = await Promise.all([
    fetchEventServers(env, event.id, full ? 100 : 10),
    fetchEventMatches(env, event.id),
    fetchEventActivity(env, event.id, full ? 50 : 12),
  ]);
  const normalizedEvent = toEventSummary(event);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source: "live",
    premiumLocked: !full,
    teaserMode: !full,
    event: normalizedEvent,
    registered_servers: servers,
    leaderboard: servers
      .slice()
      .sort((a, b) => b.score - a.score || b.wins - a.wins || a.server_name.localeCompare(b.server_name))
      .map((server, index) => ({ ...server, rank: index + 1 })),
    activity_feed: activity,
    current_matches: matches.filter((match) => match.match_status !== "completed"),
    matches,
    category_badge: {
      value: normalizedEvent.category,
      label: normalizedEvent.category_label,
    },
  };
}

export async function createCompetitiveEvent(env: Env, viewer: SessionUser | null, input: CreateCompetitiveEventInput) {
  if (!viewer) return { ok: false, status: 401, error: "UNAUTHORIZED", message: "Log in with Discord to create events." };
  await ensureCompetitiveEventsSchema(env);
  const server = await fetchOwnedServer(env, viewer, input.hosting_server_id ?? input.server_id);
  if (!server) return { ok: false, status: 404, error: "SERVER_NOT_FOUND", message: "Hosting server not found." };
  const category = normalizeServerCategoryFromRecord(server);
  if (!category) {
    return { ok: false, status: 409, error: "NO_CATEGORY", message: "Set your server category before creating events." };
  }
  if (!serverHasEventEntitlement(server)) {
    return { ok: false, status: 403, error: "PLAN_LOCKED", message: "Event creation is a Pro or Premium feature." };
  }

  const name = sanitizePlainText(input.name, 90);
  if (name.length < 3) return { ok: false, status: 400, error: "INVALID_NAME", message: "Event name must be at least 3 characters." };

  const eventType = normalizeEventType(input.event_type) ?? "community_cup";
  const status = normalizeEventStatus(input.status ?? input.registration_status) ?? "registration_open";
  if (!["registration_open", "upcoming", "standby"].includes(status)) {
    return { ok: false, status: 400, error: "INVALID_STATUS", message: "New events must start as registration open, upcoming, or standby." };
  }
  const visibility = normalizeVisibility(input.visibility);
  const startsAt = sanitizeDateTime(input.starts_at);
  const endsAt = sanitizeDateTime(input.ends_at);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return { ok: false, status: 400, error: "INVALID_DATE_RANGE", message: "End date must be after the start date." };
  }
  const serverLimit = sanitizePositiveRange(input.server_limit, 16, 2, 128);
  const teamLimit = sanitizePositiveRange(input.team_limit, serverLimit, 2, 128);
  const rules = sanitizePlainText(input.rules, 4000);
  const rewards = sanitizePlainText(input.rewards, 2000);
  const description = sanitizePlainText(input.description, 500);
  const db = requireDb(env);
  const slug = await makeUniqueEventSlug(env, cleanSlug(name) || "dzn-event");
  const eventId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO competitive_events (
        id, name, slug, description, category, event_type, status, visibility, premium_tier,
        server_limit, team_limit, starts_at, ends_at, created_by, rules, rewards, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(
      eventId,
      name,
      slug,
      description || null,
      category,
      eventType,
      status,
      visibility,
      "pro",
      serverLimit,
      teamLimit,
      startsAt,
      endsAt,
      viewer.id,
      rules || "Same-category only. DZN dedupe and server-scope rules apply.",
      rewards || null,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO competitive_event_servers (id, event_id, server_id, category, approved, seed, registered_at)
       VALUES (?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP)`,
    )
    .bind(registrationId, eventId, server.id, category)
    .run();
  await db
    .prepare(
      `UPDATE linked_servers
       SET competitive_enabled = 1,
           server_category = COALESCE(server_category, ?),
           last_event_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(category, server.id)
    .run();
  await insertEventActivity(env, eventId, server.id, "event_created", `${serverDisplayName(server)} created ${name}.`, {
    category,
    event_type: eventType,
    visibility,
    strict_same_category: true,
    tournament_channel_configured: Boolean(sanitizeDiscordSnowflake(input.tournament_channel_id)),
  });

  return {
    ok: true,
    status: 200,
    event_slug: slug,
    event_id: eventId,
    registration_id: registrationId,
    category,
    category_label: getServerCategoryLabel(category),
    message: "Event created. Only same-category servers can register.",
  };
}

export async function joinCompetitiveEvent(env: Env, viewer: SessionUser | null, slug: string, serverId: string) {
  if (!viewer) return { ok: false, status: 401, error: "UNAUTHORIZED", message: "Log in with Discord to join events." };
  await ensureCompetitiveEventsSchema(env);
  const db = requireDb(env);
  const event = await db
    .prepare("SELECT * FROM competitive_events WHERE slug = ? LIMIT 1")
    .bind(cleanSlug(slug))
    .first<EventRow>();
  if (!event) return { ok: false, status: 404, error: "EVENT_NOT_FOUND", message: "Event not found." };
  const normalizedStatus = normalizeEventStatus(event.status);
  if (!normalizedStatus || !["registration_open", "upcoming"].includes(normalizedStatus)) {
    return { ok: false, status: 409, error: "EVENT_NOT_OPEN", message: "Registration is not open for this event." };
  }
  const server = await fetchOwnedServer(env, viewer, serverId);
  if (!server) return { ok: false, status: 404, error: "SERVER_NOT_FOUND", message: "Server not found." };
  const eventCategory = normalizeServerCategory(event.category);
  const serverCategory = normalizeServerCategoryFromRecord(server);
  if (!serverCategory) {
    return { ok: false, status: 409, error: "NO_CATEGORY", message: "Set your server category before joining events." };
  }
  if (!eventCategory || eventCategory !== serverCategory) {
    return { ...categoryMismatchPayload(), status: 409 };
  }
  const entitlement = serverHasEventEntitlement(server);
  if (event.premium_tier && event.premium_tier !== "free" && !entitlement) {
    return { ok: false, status: 403, error: "PLAN_LOCKED", message: "Unlock event registration with Pro or Premium." };
  }
  const existing = await db
    .prepare("SELECT id FROM competitive_event_servers WHERE event_id = ? AND server_id = ? LIMIT 1")
    .bind(event.id, server.id)
    .first<{ id: string }>();
  if (existing) return { ok: true, status: 200, already_registered: true, message: "Server is already registered for this event." };

  const serverLimit = Number(event.server_limit ?? event.team_limit ?? 0);
  if (serverLimit > 0) {
    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM competitive_event_servers WHERE event_id = ?")
      .bind(event.id)
      .first<{ count: number | null }>();
    if (Number(count?.count ?? 0) >= serverLimit) {
      return { ok: false, status: 409, error: "EVENT_FULL", message: "This event is full." };
    }
  }

  const registrationId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO competitive_event_servers (id, event_id, server_id, category, approved, registered_at)
       VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
    )
    .bind(registrationId, event.id, server.id, eventCategory)
    .run();
  await db
    .prepare("UPDATE linked_servers SET competitive_enabled = 1, server_category = COALESCE(server_category, ?), last_event_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(eventCategory, server.id)
    .run();
  await insertEventActivity(env, event.id, server.id, "server_joined_event", `${serverDisplayName(server)} joined ${event.name}.`, {
    category: eventCategory,
    strict_same_category: true,
  });
  return {
    ok: true,
    status: 200,
    registration_id: registrationId,
    event_id: event.id,
    event_slug: event.slug,
    event_name: event.name,
    server_id: server.id,
    server_name: serverDisplayName(server),
    category: eventCategory,
    message: "Server registered for this category-safe event.",
  };
}

export async function createCategorySafeMatchmaking(env: Env, viewer: SessionUser | null, input: {
  server_id?: string | null;
  opponent_server_id?: string | null;
  event_slug?: string | null;
  event_type?: string | null;
  preview?: boolean;
}) {
  if (!viewer) return { ok: false, status: 401, error: "UNAUTHORIZED", message: "Log in with Discord to use matchmaking." };
  await ensureCompetitiveEventsSchema(env);
  const primary = await fetchOwnedServer(env, viewer, input.server_id);
  if (!primary) return { ok: false, status: 404, error: "SERVER_NOT_FOUND", message: "Server not found." };
  if (!serverHasEventEntitlement(primary)) {
    return { ok: false, status: 403, error: "PLAN_LOCKED", message: "Cross-server matchmaking is a Pro or Premium feature." };
  }
  if (Number(primary.competitive_enabled ?? 0) !== 1) {
    return { ok: false, status: 409, error: "COMPETITIVE_DISABLED", message: "Enable competitive matchmaking for this server first." };
  }
  const category = normalizeServerCategoryFromRecord(primary);
  if (!category) return { ok: false, status: 409, error: "MISSING_CATEGORY", message: "Set a server category before matchmaking." };
  const event = input.event_slug ? await fetchEventBySlug(env, input.event_slug) : null;
  if (event) {
    const eventCategory = normalizeServerCategory(event.category);
    if (!eventCategory || eventCategory !== category) return { ...categoryMismatchPayload(), status: 409 };
  }
  const opponent = input.opponent_server_id
    ? await fetchServerById(env, input.opponent_server_id)
    : await findMatchmakingOpponent(env, primary, category, normalizeEventType(input.event_type));
  if (!opponent) return { ok: false, status: 404, error: "NO_MATCH_FOUND", message: "No same-category opponent is currently available." };
  try {
    assertSameServerCategory(primary, opponent);
  } catch {
    return { ...categoryMismatchPayload(), status: 409 };
  }
  const preview = input.preview !== false || !event;
  if (preview) {
    return {
      ok: true,
      status: 200,
      preview: true,
      same_category_only: true,
      category,
      left_server: publicServer(primary),
      right_server: publicServer(opponent),
      mmr_delta: Math.abs(Number(primary.event_mmr ?? 1000) - Number(opponent.event_mmr ?? 1000)),
    };
  }
  const matchId = crypto.randomUUID();
  await requireDb(env)
    .prepare(
      `INSERT INTO competitive_event_matches (
        id, event_id, left_server_id, right_server_id, category, match_status, round_number, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(matchId, event.id, primary.id, opponent.id, category)
    .run();
  await insertEventActivity(env, event.id, primary.id, "battle_started", `${serverDisplayName(primary)} matched against ${serverDisplayName(opponent)}.`, {
    category,
    same_category_only: true,
    opponent_server_id: opponent.id,
  });
  return { ok: true, status: 200, preview: false, match_id: matchId, category, left_server: publicServer(primary), right_server: publicServer(opponent) };
}

export async function getLiveEventFeedPayload(env: Env, limit = 25) {
  if (!env.DB) {
    return {
      ok: true,
      generated_at: new Date().toISOString(),
      source: "display_fallback",
      activity: demoActivity(),
    };
  }
  await ensureCompetitiveEventsSchema(env);
  const activity = await fetchEventActivity(env, null, sanitizeLimit(limit, 25, 50));
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source: activity.length ? "live" : "display_fallback",
    activity: activity.length ? activity : demoActivity(),
  };
}

export async function getServerEventsProfilePayload(env: Env, serverIdOrSlug: string, viewer: SessionUser | null) {
  if (!env.DB) return demoServerEventsProfile(serverIdOrSlug, false);
  await ensureCompetitiveEventsSchema(env);
  const server = await fetchServerByIdOrSlug(env, serverIdOrSlug);
  if (!server) return demoServerEventsProfile(serverIdOrSlug, false);
  const category = normalizeServerCategoryFromRecord(server);
  const entitlement = await hasFullEventAccess(env, viewer);
  const [current, history, compatible] = await Promise.all([
    fetchServerRegisteredEvents(env, server.id, ["live", "registration_open", "upcoming", "standby"]),
    fetchServerRegisteredEvents(env, server.id, ["ended"]),
    category ? fetchCompatibleEvents(env, category) : Promise.resolve([]),
  ]);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source: "live",
    premiumLocked: !entitlement,
    server: {
      ...publicServer(server),
      category,
      category_label: getServerCategoryLabel(category),
      verified_server: Number(server.verified_server ?? 0) === 1,
      event_mmr: Number(server.event_mmr ?? 1000),
      season_points: Number(server.season_points ?? 0),
      event_wins: Number(server.event_wins ?? 0),
      event_losses: Number(server.event_losses ?? 0),
      event_draws: Number(server.event_draws ?? 0),
      last_event_at: server.last_event_at,
    },
    current_events: current,
    upcoming_events: current.filter((event) => event.status !== "live"),
    event_history: history,
    trophies: buildTrophies(server),
    recent_matches: await fetchServerMatches(env, server.id),
    compatible_upcoming_events: compatible,
  };
}

async function fetchEventServers(env: Env, eventId: string, limit: number) {
  const result = await requireDb(env)
    .prepare(
      `SELECT competitive_event_servers.*,
              linked_servers.public_slug, linked_servers.server_type, linked_servers.server_mode, linked_servers.server_category,
              linked_servers.current_players, linked_servers.max_players, linked_servers.event_mmr, linked_servers.verified_server,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name
       FROM competitive_event_servers
       JOIN linked_servers ON linked_servers.id = competitive_event_servers.server_id
       WHERE competitive_event_servers.event_id = ?
       ORDER BY competitive_event_servers.score DESC, competitive_event_servers.wins DESC, competitive_event_servers.seed ASC, server_name ASC
       LIMIT ?`,
    )
    .bind(eventId, sanitizeLimit(limit, 10, 100))
    .all<EventServerRow>();
  return (result.results ?? []).map(toEventServer);
}

async function fetchEventMatches(env: Env, eventId: string) {
  const result = await requireDb(env)
    .prepare(
      `SELECT competitive_event_matches.*,
              COALESCE(NULLIF(left_server.display_name, ''), NULLIF(left_server.hostname, ''), left_server.server_name, left_server.nitrado_service_name) AS left_server_name,
              left_server.public_slug AS left_slug,
              COALESCE(NULLIF(right_server.display_name, ''), NULLIF(right_server.hostname, ''), right_server.server_name, right_server.nitrado_service_name) AS right_server_name,
              right_server.public_slug AS right_slug,
              COALESCE(NULLIF(winner.display_name, ''), NULLIF(winner.hostname, ''), winner.server_name, winner.nitrado_service_name) AS winner_name
       FROM competitive_event_matches
       JOIN linked_servers AS left_server ON left_server.id = competitive_event_matches.left_server_id
       JOIN linked_servers AS right_server ON right_server.id = competitive_event_matches.right_server_id
       LEFT JOIN linked_servers AS winner ON winner.id = competitive_event_matches.winner_server_id
       WHERE competitive_event_matches.event_id = ?
       ORDER BY COALESCE(competitive_event_matches.round_number, 0) ASC, competitive_event_matches.created_at ASC
       LIMIT 64`,
    )
    .bind(eventId)
    .all<MatchRow>();
  return (result.results ?? [])
    .filter((row) => normalizeServerCategory(row.category))
    .map(toMatch);
}

async function fetchEventActivity(env: Env, eventId: string | null, limit = 25) {
  const where = eventId ? "WHERE competitive_event_activity.event_id = ?" : "";
  const bindings = eventId ? [eventId, sanitizeLimit(limit, 25, 50)] : [sanitizeLimit(limit, 25, 50)];
  const result = await requireDb(env)
    .prepare(
      `SELECT competitive_event_activity.*,
              competitive_events.name AS event_name,
              competitive_events.slug AS event_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
              linked_servers.public_slug
       FROM competitive_event_activity
       LEFT JOIN competitive_events ON competitive_events.id = competitive_event_activity.event_id
       LEFT JOIN linked_servers ON linked_servers.id = competitive_event_activity.server_id
       ${where}
       ORDER BY datetime(competitive_event_activity.created_at) DESC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<ActivityRow>();
  return (result.results ?? []).map(toActivity);
}

async function fetchOwnedServer(env: Env, viewer: SessionUser, serverId: string | null | undefined) {
  const cleanId = cleanIdentifier(serverId);
  if (!cleanId) return null;
  return requireDb(env)
    .prepare(
      `SELECT linked_servers.*,
              server_subscriptions.plan_key, server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE linked_servers.id = ?
         AND linked_servers.user_id = ?
         AND lower(COALESCE(linked_servers.status, 'pending')) != 'deleted'
       LIMIT 1`,
    )
    .bind(cleanId, viewer.id)
    .first<ServerRow>();
}

async function fetchServerById(env: Env, serverId: string | null | undefined) {
  const cleanId = cleanIdentifier(serverId);
  if (!cleanId) return null;
  return requireDb(env)
    .prepare(
      `SELECT linked_servers.*,
              server_subscriptions.plan_key, server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE linked_servers.id = ?
       LIMIT 1`,
    )
    .bind(cleanId)
    .first<ServerRow>();
}

async function fetchServerByIdOrSlug(env: Env, value: string) {
  const clean = String(value ?? "").trim();
  if (!clean) return null;
  return requireDb(env)
    .prepare(
      `SELECT linked_servers.*,
              server_subscriptions.plan_key, server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE linked_servers.id = ? OR linked_servers.public_slug = ?
       LIMIT 1`,
    )
    .bind(clean, clean)
    .first<ServerRow>();
}

async function fetchEventBySlug(env: Env, slug: string | null | undefined) {
  const clean = cleanSlug(slug);
  if (!clean) return null;
  return requireDb(env)
    .prepare("SELECT * FROM competitive_events WHERE slug = ? LIMIT 1")
    .bind(clean)
    .first<EventRow>();
}

async function findMatchmakingOpponent(env: Env, primary: ServerRow, category: ServerCategory, type: CompetitiveEventType | null) {
  const typeCondition = type
    ? `AND EXISTS (
        SELECT 1 FROM competitive_event_servers
        JOIN competitive_events ON competitive_events.id = competitive_event_servers.event_id
        WHERE competitive_event_servers.server_id = linked_servers.id
          AND competitive_events.event_type = ?
          AND competitive_events.category = ?
        LIMIT 1
      )`
    : "";
  return requireDb(env)
    .prepare(
      `SELECT linked_servers.*,
              server_subscriptions.plan_key, server_subscriptions.status AS subscription_status
       FROM linked_servers
       JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE COALESCE(linked_servers.server_category, linked_servers.server_type, linked_servers.server_mode) IS NOT NULL
         AND linked_servers.id != ?
         AND linked_servers.competitive_enabled = 1
         AND lower(COALESCE(linked_servers.status, '')) = 'live'
         AND lower(COALESCE(server_subscriptions.status, '')) IN ('active', 'trialing')
         AND lower(COALESCE(server_subscriptions.plan_key, '')) IN ('pro', 'premium', 'network', 'partner')
         ${typeCondition}
       ORDER BY CASE WHEN linked_servers.server_category = ? THEN 0 ELSE 1 END,
                ABS(COALESCE(linked_servers.event_mmr, 1000) - ?) ASC,
                linked_servers.last_event_at ASC
       LIMIT 12`,
    )
    .bind(...(type ? [primary.id, type, category, category, Number(primary.event_mmr ?? 1000)] : [primary.id, category, Number(primary.event_mmr ?? 1000)]))
    .all<ServerRow>()
    .then((result) => (result.results ?? []).find((candidate) => normalizeServerCategoryFromRecord(candidate) === category) ?? null);
}

async function fetchServerRegisteredEvents(env: Env, serverId: string, statuses: string[]) {
  const placeholders = statuses.map(() => "?").join(", ");
  const result = await requireDb(env)
    .prepare(
      `SELECT competitive_events.*,
              (SELECT COUNT(*) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS registered_servers,
              competitive_event_servers.score AS total_score,
              (SELECT COUNT(*) FROM competitive_event_matches WHERE competitive_event_matches.event_id = competitive_events.id) AS match_count
       FROM competitive_event_servers
       JOIN competitive_events ON competitive_events.id = competitive_event_servers.event_id
       WHERE competitive_event_servers.server_id = ?
         AND competitive_events.status IN (${placeholders})
       ORDER BY datetime(COALESCE(competitive_events.starts_at, competitive_events.created_at)) DESC
       LIMIT 20`,
    )
    .bind(serverId, ...statuses)
    .all<EventRow>();
  return (result.results ?? []).map(toEventSummary);
}

async function fetchCompatibleEvents(env: Env, category: ServerCategory) {
  const result = await requireDb(env)
    .prepare(
      `SELECT competitive_events.*,
              (SELECT COUNT(*) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS registered_servers,
              (SELECT COALESCE(SUM(score), 0) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS total_score,
              (SELECT COUNT(*) FROM competitive_event_matches WHERE competitive_event_matches.event_id = competitive_events.id) AS match_count
       FROM competitive_events
       WHERE category = ?
         AND status IN ('registration_open', 'upcoming', 'standby')
         AND visibility != 'private'
       ORDER BY datetime(COALESCE(starts_at, created_at)) ASC
       LIMIT 10`,
    )
    .bind(category)
    .all<EventRow>();
  return (result.results ?? []).map(toEventSummary);
}

async function fetchServerMatches(env: Env, serverId: string) {
  const result = await requireDb(env)
    .prepare(
      `SELECT competitive_event_matches.*,
              COALESCE(NULLIF(left_server.display_name, ''), NULLIF(left_server.hostname, ''), left_server.server_name, left_server.nitrado_service_name) AS left_server_name,
              left_server.public_slug AS left_slug,
              COALESCE(NULLIF(right_server.display_name, ''), NULLIF(right_server.hostname, ''), right_server.server_name, right_server.nitrado_service_name) AS right_server_name,
              right_server.public_slug AS right_slug,
              COALESCE(NULLIF(winner.display_name, ''), NULLIF(winner.hostname, ''), winner.server_name, winner.nitrado_service_name) AS winner_name
       FROM competitive_event_matches
       JOIN linked_servers AS left_server ON left_server.id = competitive_event_matches.left_server_id
       JOIN linked_servers AS right_server ON right_server.id = competitive_event_matches.right_server_id
       LEFT JOIN linked_servers AS winner ON winner.id = competitive_event_matches.winner_server_id
       WHERE competitive_event_matches.left_server_id = ? OR competitive_event_matches.right_server_id = ?
       ORDER BY datetime(competitive_event_matches.created_at) DESC
       LIMIT 12`,
    )
    .bind(serverId, serverId)
    .all<MatchRow>();
  return (result.results ?? []).map(toMatch);
}

async function hasFullEventAccess(env: Env, viewer: SessionUser | null) {
  if (!viewer) return false;
  const row = await requireDb(env)
    .prepare(
      `SELECT server_subscriptions.plan_key, server_subscriptions.status
       FROM server_subscriptions
       LEFT JOIN discord_guilds ON discord_guilds.guild_id = server_subscriptions.guild_id
       WHERE server_subscriptions.owner_discord_id = ?
          OR discord_guilds.owner_user_id = ?
       ORDER BY CASE lower(COALESCE(server_subscriptions.plan_key, 'free'))
         WHEN 'premium' THEN 0
         WHEN 'partner' THEN 0
         WHEN 'network' THEN 1
         WHEN 'pro' THEN 1
         ELSE 2
       END
       LIMIT 1`,
    )
    .bind(viewer.discord_id, viewer.id)
    .first<{ plan_key: string | null; status: string | null }>();
  return Boolean(row && isActiveSubscription(row.status) && FULL_EVENT_PLANS.includes(normalizePlanKey(row.plan_key)));
}

function serverHasEventEntitlement(server: Pick<ServerRow, "plan_key" | "subscription_status">) {
  return isActiveSubscription(server.subscription_status) && FULL_EVENT_PLANS.includes(normalizePlanKey(server.plan_key));
}

async function insertEventActivity(env: Env, eventId: string | null, serverId: string | null, activityType: string, message: string, metadata: Record<string, unknown>) {
  await requireDb(env)
    .prepare(
      `INSERT INTO competitive_event_activity (id, event_id, server_id, activity_type, message, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(crypto.randomUUID(), eventId, serverId, activityType, message, JSON.stringify(metadata))
    .run();
}

function toEventSummary(row: EventRow) {
  const category = normalizeServerCategory(row.category) ?? "modded";
  const eventType = normalizeEventType(row.event_type) ?? "community_cup";
  const status = normalizeEventStatus(row.status) ?? "upcoming";
  const registered = Number(row.registered_servers ?? 0);
  const serverLimit = Number(row.server_limit ?? row.team_limit ?? 0);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    category,
    category_label: getServerCategoryLabel(category),
    event_type: eventType,
    event_type_label: eventTypeLabel(eventType),
    status,
    status_label: eventStatusLabel(status),
    visibility: row.visibility ?? "public",
    premium_tier: row.premium_tier ?? "free",
    server_limit: serverLimit || null,
    team_limit: Number(row.team_limit ?? 0) || null,
    registered_servers: registered,
    total_participants: registered,
    progress_percent: serverLimit > 0 ? Math.min(100, Math.round((registered / serverLimit) * 100)) : Math.min(100, registered * 12),
    total_score: Number(row.total_score ?? 0),
    match_count: Number(row.match_count ?? 0),
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    banner_url: row.banner_url,
    rules: row.rules,
    rewards: row.rewards,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toEventServer(row: EventServerRow) {
  const category = normalizeServerCategory(row.category) ?? normalizeServerCategoryFromRecord(row) ?? "modded";
  return {
    registration_id: row.id,
    server_id: row.server_id,
    server_name: row.server_name ?? "Unnamed DZN Server",
    public_slug: row.public_slug,
    category,
    category_label: getServerCategoryLabel(category),
    approved: Number(row.approved ?? 0) === 1,
    score: Number(row.score ?? 0),
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    draws: Number(row.draws ?? 0),
    seed: row.seed,
    registered_at: row.registered_at,
    current_players: Number(row.current_players ?? 0),
    max_players: Number(row.max_players ?? 0),
    event_mmr: Number(row.event_mmr ?? 1000),
    verified_server: Number(row.verified_server ?? 0) === 1,
  };
}

function toMatch(row: MatchRow) {
  const category = normalizeServerCategory(row.category) ?? "modded";
  return {
    id: row.id,
    event_id: row.event_id,
    category,
    category_label: getServerCategoryLabel(category),
    match_status: row.match_status ?? "pending",
    winner_server_id: row.winner_server_id,
    winner_name: row.winner_name,
    round_number: Number(row.round_number ?? 1),
    left_score: Number(row.left_score ?? 0),
    right_score: Number(row.right_score ?? 0),
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    left_server: { server_id: row.left_server_id, server_name: row.left_server_name ?? "Left Server", public_slug: row.left_slug },
    right_server: { server_id: row.right_server_id, server_name: row.right_server_name ?? "Right Server", public_slug: row.right_slug },
  };
}

function toActivity(row: ActivityRow) {
  return {
    id: row.id,
    event_id: row.event_id,
    event_name: row.event_name,
    event_slug: row.event_slug,
    server_id: row.server_id,
    server_name: row.server_name,
    public_slug: row.public_slug,
    activity_type: row.activity_type,
    message: row.message,
    metadata: parseJson(row.metadata),
    created_at: row.created_at,
  };
}

function publicServer(server: ServerRow) {
  const category = normalizeServerCategoryFromRecord(server);
  return {
    server_id: server.id,
    server_name: serverDisplayName(server),
    public_slug: server.public_slug,
    category,
    category_label: getServerCategoryLabel(category),
    event_mmr: Number(server.event_mmr ?? 1000),
    current_players: Number(server.current_players ?? 0),
    max_players: Number(server.max_players ?? 0),
  };
}

function serverDisplayName(server: Pick<ServerRow, "display_name" | "hostname" | "server_name" | "nitrado_service_name">) {
  return server.display_name || server.hostname || server.server_name || server.nitrado_service_name || "Unnamed DZN Server";
}

function buildTrophies(server: ServerRow) {
  const wins = Number(server.event_wins ?? 0);
  return [
    ...(wins > 0 ? [{ label: "Event Winner", value: `${wins} wins` }] : []),
    ...(Number(server.season_points ?? 0) > 0 ? [{ label: "Season Points", value: String(server.season_points) }] : []),
    ...(Number(server.verified_server ?? 0) === 1 ? [{ label: "Verified Server", value: "DZN verified" }] : []),
  ];
}

function summarizeEvents(events: ReturnType<typeof toEventSummary>[]) {
  return {
    active_events: events.filter((event) => event.status === "live").length,
    upcoming_events: events.filter((event) => ["upcoming", "registration_open", "standby"].includes(event.status)).length,
    completed_events: events.filter((event) => event.status === "ended").length,
    registered_servers: events.reduce((total, event) => total + event.registered_servers, 0),
    total_participants: events.reduce((total, event) => total + event.total_participants, 0),
  };
}

export function normalizeEventStatus(value: unknown): CompetitiveEventStatus | null {
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (EVENT_STATUSES as readonly string[]).includes(text) ? text as CompetitiveEventStatus : null;
}

export function resolveEventStatusFilter(value: unknown): CompetitiveEventStatus[] {
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!text || text === "all") return [];
  if (text === "active") return ["live"];
  if (text === "completed") return ["ended"];
  if (text === "upcoming") return ["upcoming", "registration_open", "standby"];
  const normalized = normalizeEventStatus(text);
  return normalized ? [normalized] : [];
}

export function normalizeEventType(value: unknown): CompetitiveEventType | null {
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (text === "ctf") return "capture_the_flag";
  return (EVENT_TYPES as readonly string[]).includes(text) ? text as CompetitiveEventType : null;
}

export function eventTypeLabel(value: unknown) {
  const normalized = normalizeEventType(value);
  return normalized ? EVENT_TYPE_LABELS[normalized] : "Community Cup";
}

export function eventStatusLabel(value: unknown) {
  const normalized = normalizeEventStatus(value);
  if (!normalized) return "Upcoming";
  return normalized.split("_").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function sanitizeLimit(value: unknown, fallback: number, max: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function cleanSlug(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}

async function makeUniqueEventSlug(env: Env, baseSlug: string) {
  const db = requireDb(env);
  const cleanBase = cleanSlug(baseSlug) || "dzn-event";
  for (let index = 0; index < 20; index += 1) {
    const candidate = index === 0 ? cleanBase : `${cleanBase}-${index + 1}`;
    const existing = await db.prepare("SELECT id FROM competitive_events WHERE slug = ? LIMIT 1").bind(candidate).first<{ id: string }>();
    if (!existing) return candidate;
  }
  return `${cleanBase}-${crypto.randomUUID().slice(0, 8)}`;
}

function cleanIdentifier(value: unknown) {
  const text = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{3,96}$/.test(text) ? text : null;
}

function sanitizePlainText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function sanitizeDateTime(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function sanitizePositiveRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= min ? Math.min(parsed, max) : fallback;
}

function normalizeVisibility(value: unknown) {
  const text = String(value ?? "public").trim().toLowerCase();
  return ["public", "private", "unlisted"].includes(text) ? text : "public";
}

function sanitizeDiscordSnowflake(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{16,24}$/.test(text) ? text : null;
}

function isActiveSubscription(value: unknown) {
  return ["active", "trialing"].includes(String(value ?? "").toLowerCase());
}

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function ensureColumns(db: D1Database, tableName: string, columns: Record<string, string>) {
  const existing = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  const names = new Set((existing.results ?? []).map((column) => column.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!names.has(name)) {
      await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${type}`).run();
    }
  }
}

function demoEventsListPayload(options: EventListOptions, entitlement: boolean) {
  const full = options.full === true && entitlement;
  const limit = full ? sanitizeLimit(options.limit, 100, 100) : 10;
  const events = filterDemoEvents(options, limit);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source: "display_fallback",
    teaserMode: !full,
    full,
    categoryFilters: SERVER_CATEGORIES.map((value) => ({ value, label: getServerCategoryLabel(value) })),
    statusFilters: EVENT_STATUSES.map((value) => ({ value, label: eventStatusLabel(value) })),
    typeFilters: EVENT_TYPES.map((value) => ({ value, label: eventTypeLabel(value) })),
    summary: summarizeEvents(events),
    events,
  };
}

function filterDemoEvents(options: EventListOptions, limit: number) {
  const statusFilter = resolveEventStatusFilter(options.status);
  const category = normalizeServerCategory(options.category);
  const type = normalizeEventType(options.type);
  return demoEvents()
    .filter((event) => {
      const statusOk = statusFilter.length === 0 || statusFilter.includes(event.status);
      const categoryOk = !category || event.category === category;
      const typeOk = !type || event.event_type === type;
      return statusOk && categoryOk && typeOk;
    })
    .slice(0, limit);
}

function demoEventDetailPayload(slug: string, entitlement: boolean) {
  const event = demoEvents().find((item) => item.slug === cleanSlug(slug)) ?? demoEvents()[0];
  const leaderboard = demoServers(event.category).slice(0, entitlement ? 16 : 10);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source: "display_fallback",
    premiumLocked: !entitlement,
    teaserMode: !entitlement,
    event,
    registered_servers: leaderboard,
    leaderboard: leaderboard.map((server, index) => ({ ...server, rank: index + 1 })),
    activity_feed: demoActivity(),
    current_matches: demoMatches(event.category),
    matches: demoMatches(event.category),
    category_badge: { value: event.category, label: event.category_label },
  };
}

function demoServerEventsProfile(slug: string, entitlement: boolean) {
  const category = normalizeServerCategory(slug.includes("pvp") ? "pvp" : slug.includes("role") ? "roleplay" : "deathmatch") ?? "deathmatch";
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source: "display_fallback",
    premiumLocked: !entitlement,
    server: {
      server_id: slug,
      server_name: slug.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      public_slug: slug,
      category,
      category_label: getServerCategoryLabel(category),
      verified_server: true,
      event_mmr: 1503,
      season_points: 3240,
      event_wins: 7,
      event_losses: 2,
      event_draws: 1,
      last_event_at: new Date().toISOString(),
    },
    current_events: demoEvents().filter((event) => event.category === category).slice(0, 2),
    upcoming_events: demoEvents().filter((event) => event.category === category && event.status !== "live").slice(0, 2),
    event_history: demoEvents().filter((event) => event.status === "ended").slice(0, 2),
    trophies: [{ label: "Season Contender", value: "Top 10" }, { label: "Verified Server", value: "DZN verified" }],
    recent_matches: demoMatches(category),
    compatible_upcoming_events: demoEvents().filter((event) => event.category === category),
  };
}

function demoEvents() {
  const now = Date.now();
  const rows = [
    ["dzn-season-1", "DZN Season 1", "Capture the flag across verified DayZ console communities.", "deathmatch", "capture_the_flag", "live", 32, 512, 24],
    ["weekly-warriors", "Weekly Warriors", "Compact weekly fight night for same-category servers.", "deathmatch", "community_cup", "live", 16, 256, 10],
    ["pandora-showdown", "Pandora Showdown", "Roster-locked bot tournament with live scorecards.", "pvp", "bot_tournament", "live", 8, 128, 6],
    ["spring-clash", "Spring Clash", "Upcoming category-safe bracket for faction servers.", "faction_wars", "faction_wars", "upcoming", 24, 384, 0],
    ["legends-cup", "Legends Cup", "Seasonal survival challenge for hardcore servers.", "hardcore", "survival_challenge", "registration_open", 16, 258, 0],
    ["summer-wars", "Summer Wars", "PvP/PvE seasonal war with premium analytics.", "pvp_pve", "seasonal_wars", "upcoming", 32, 512, 0],
  ] as const;
  return rows.map(([slug, name, description, category, eventType, status, registered, participants, score], index) => {
    const normalizedCategory = normalizeServerCategory(category) ?? "modded";
    const normalizedType = normalizeEventType(eventType) ?? "community_cup";
    const normalizedStatus = normalizeEventStatus(status) ?? "upcoming";
    return {
      id: `demo-${slug}`,
      name,
      slug,
      description,
      category: normalizedCategory,
      category_label: getServerCategoryLabel(normalizedCategory),
      event_type: normalizedType,
      event_type_label: eventTypeLabel(normalizedType),
      status: normalizedStatus,
      status_label: eventStatusLabel(normalizedStatus),
      visibility: "public",
      premium_tier: index < 3 ? "pro" : "free",
      server_limit: 32,
      team_limit: 32,
      registered_servers: registered,
      total_participants: participants,
      progress_percent: Math.min(100, Math.round((registered / 32) * 100)),
      total_score: score * 100,
      match_count: score,
      starts_at: new Date(now + (index - 1) * 86400000).toISOString(),
      ends_at: new Date(now + (index + 3) * 86400000).toISOString(),
      banner_url: index % 2 === 0 ? "/media/dzn-cinematic-survivor.png" : "/dzn/build/build-hero.webp",
      rules: "Same category only. Verified rosters only. DZN dedupe and server-scope rules apply.",
      rewards: "Champion badge, featured placement, and seasonal points.",
      created_at: new Date(now - 86400000 * 12).toISOString(),
      updated_at: new Date(now - 3600000).toISOString(),
    };
  });
}

function demoServers(category: string) {
  const safeCategory = normalizeServerCategory(category) ?? "deathmatch";
  return ["Pandora DayZ", "Nuke Town", "Warlords PvP", "Vendetta", "Rogue Squad", "Outcasts", "Frontier EU", "Last Haven", "DeadZone UK", "Iron Valley"].map((name, index) => ({
    registration_id: `demo-reg-${index}`,
    server_id: `demo-server-${index}`,
    server_name: name,
    public_slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    category: safeCategory,
    category_label: getServerCategoryLabel(safeCategory),
    approved: true,
    score: 2340 - index * 165,
    wins: Math.max(0, 7 - index),
    losses: index % 4,
    draws: index % 2,
    seed: index + 1,
    registered_at: new Date(Date.now() - index * 3600000).toISOString(),
    current_players: 12 + index,
    max_players: 50,
    event_mmr: 1500 - index * 28,
    verified_server: index < 4,
  }));
}

function demoMatches(category: string) {
  const servers = demoServers(category);
  return [0, 2, 4, 6].map((index, roundIndex) => ({
    id: `demo-match-${index}`,
    event_id: "demo-dzn-season-1",
    category: servers[index]?.category ?? "deathmatch",
    category_label: servers[index]?.category_label ?? "Deathmatch",
    match_status: roundIndex === 0 ? "live" : roundIndex === 1 ? "completed" : "pending",
    winner_server_id: roundIndex === 1 ? servers[index]?.server_id : null,
    winner_name: roundIndex === 1 ? servers[index]?.server_name : null,
    round_number: roundIndex + 1,
    left_score: 3 - roundIndex,
    right_score: roundIndex,
    starts_at: new Date(Date.now() + roundIndex * 3600000).toISOString(),
    ends_at: null,
    left_server: servers[index],
    right_server: servers[index + 1] ?? servers[0],
  }));
}

function demoActivity() {
  return [
    "Pandora DayZ captured a flag and advanced the bracket.",
    "Nuke Town joined a Deathmatch-only community cup.",
    "Warlords PvP score updated from verified roster actions.",
    "Spring Clash registration opened for Faction Wars servers.",
  ].map((message, index) => ({
    id: `demo-activity-${index}`,
    event_id: "demo-dzn-season-1",
    event_name: "DZN Season 1",
    event_slug: "dzn-season-1",
    server_id: `demo-server-${index}`,
    server_name: message.split(" ").slice(0, 2).join(" "),
    public_slug: null,
    activity_type: ["ctf_capture", "server_joined_event", "score_updated", "registration_opened"][index] ?? "score_updated",
    message,
    metadata: { source: "display_fallback" },
    created_at: new Date(Date.now() - index * 900000).toISOString(),
  }));
}

const COMPETITIVE_EVENT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS competitive_events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'upcoming',
    visibility TEXT NOT NULL DEFAULT 'public',
    premium_tier TEXT DEFAULT 'free',
    server_limit INTEGER,
    team_limit INTEGER,
    starts_at TEXT,
    ends_at TEXT,
    created_by TEXT,
    banner_url TEXT,
    rules TEXT,
    rewards TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS competitive_event_servers (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    server_id TEXT NOT NULL,
    category TEXT NOT NULL,
    approved INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    seed INTEGER,
    registered_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, server_id)
  )`,
  `CREATE TABLE IF NOT EXISTS competitive_event_matches (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    left_server_id TEXT NOT NULL,
    right_server_id TEXT NOT NULL,
    category TEXT NOT NULL,
    match_status TEXT DEFAULT 'pending',
    winner_server_id TEXT,
    round_number INTEGER,
    left_score INTEGER DEFAULT 0,
    right_score INTEGER DEFAULT 0,
    starts_at TEXT,
    ends_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS competitive_event_activity (
    id TEXT PRIMARY KEY,
    event_id TEXT,
    server_id TEXT,
    activity_type TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS competitive_seasons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'upcoming',
    starts_at TEXT,
    ends_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS competitive_season_standings (
    id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL,
    server_id TEXT NOT NULL,
    category TEXT NOT NULL,
    points INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    events_played INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(season_id, server_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_competitive_events_status ON competitive_events(status)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_events_category ON competitive_events(category)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_events_event_type ON competitive_events(event_type)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_event_servers_event_id ON competitive_event_servers(event_id)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_event_servers_server_id ON competitive_event_servers(server_id)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_event_servers_category ON competitive_event_servers(category)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_event_matches_event_id ON competitive_event_matches(event_id)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_event_matches_category ON competitive_event_matches(category)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_event_matches_status ON competitive_event_matches(match_status)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_event_activity_event_id ON competitive_event_activity(event_id)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_event_activity_created_at ON competitive_event_activity(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_season_standings_season_id ON competitive_season_standings(season_id)",
  "CREATE INDEX IF NOT EXISTS idx_competitive_season_standings_category ON competitive_season_standings(category)",
  "CREATE INDEX IF NOT EXISTS idx_linked_servers_server_category ON linked_servers(server_category)",
  "CREATE INDEX IF NOT EXISTS idx_linked_servers_competitive_category ON linked_servers(competitive_enabled, server_category)",
];
