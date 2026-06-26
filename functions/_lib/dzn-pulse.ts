import { ensureMockUser, getLinkedServersForUserSummary, requireDb } from "./db";
import { isDiscordNotificationsEnabled, isDznPulseEnabled } from "./feature-flags";
import { rankServers, type RankedServer } from "./server-ranking";
import { getServerCategoryLabel, normalizeServerCategory } from "./server-categories";
import type { Env, SessionUser } from "./types";

export const PULSE_NO_STORE_HEADERS = {
  "cache-control": "private, no-store, no-cache, must-revalidate",
};

export const PULSE_NOTIFICATION_TYPES = [
  "upcoming_event",
  "event_starting",
  "event_started",
  "event_countdown",
  "event_entry_confirmed",
  "event_score_update",
  "event_rank_update",
  "achievement_unlocked",
  "monthly_global_rank",
  "event_result",
  "prize_unlocked",
  "dzn_news",
  "dzn_announcement",
] as const;

export type PulseNotificationType = typeof PULSE_NOTIFICATION_TYPES[number];
export type PulseNotificationFilter = "all" | "events" | "scores" | "achievements" | "news";

export type PulseNotification = {
  id: string;
  type: PulseNotificationType;
  category: PulseNotificationFilter;
  category_label: string;
  title: string;
  body: string;
  image_url: string | null;
  action_url: string | null;
  server_id: string | null;
  server_name: string | null;
  event_id: string | null;
  event_name: string | null;
  priority: number;
  read_at: string | null;
  created_at: string;
  expires_at: string | null;
  metadata: Record<string, unknown>;
};

export type PulseListResult = {
  ok: true;
  items: PulseNotification[];
  unreadCount: number;
  nextCursor: string | null;
  generated_at: string;
};

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  image_url: string | null;
  action_url: string | null;
  server_id: string | null;
  server_name: string | null;
  event_id: string | null;
  event_name: string | null;
  priority: number | null;
  read_at: string | null;
  created_at: string | null;
  expires_at: string | null;
  metadata: string | null;
};

type CampaignRow = {
  id: string;
  slug: string;
  type: string;
  title: string;
  body: string;
  image_url: string | null;
  action_url: string | null;
  event_id: string | null;
  priority: number | null;
  audience_metadata: string | null;
  metadata: string | null;
  starts_at: string;
  ends_at: string | null;
  created_at: string | null;
  event_name: string | null;
  event_slug: string | null;
  event_category: string | null;
  event_type: string | null;
  event_status: string | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_rewards: string | null;
};

type DismissalRow = {
  campaign_id: string;
  server_id: string | null;
  scope_key: string;
  mode: string;
  snoozed_until: string | null;
};

export type PulseCompatibleServer = {
  id: string;
  name: string;
  category: string | null;
  category_label: string | null;
  current_players: number | null;
  max_players: number | null;
  already_entered: boolean;
};

export type PulseEventPopup = {
  campaign_id: string;
  slug: string;
  type: string;
  title: string;
  body: string;
  image_url: string | null;
  action_url: string | null;
  event_id: string | null;
  event_slug: string | null;
  event_name: string | null;
  event_category: string | null;
  event_category_label: string | null;
  event_type: string | null;
  event_status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  metadata: Record<string, unknown>;
  compatible_servers: PulseCompatibleServer[];
  incompatible_servers: Array<PulseCompatibleServer & { reason: string }>;
  link_server_url: string | null;
};

export type PulseSummary = {
  ok: true;
  generated_at: string;
  metrics: {
    live_events: number;
    active_servers: number;
    players_online: number;
    matches_today: number;
    event_registrations: number;
    participating_servers: number;
    connected_communities: number;
  };
  live_event: PulseSummaryEvent | null;
  top_server: PulseSummaryServer | null;
  announcements: Array<{
    id: string;
    title: string;
    body: string;
    action_url: string | null;
    created_at: string | null;
  }>;
  monthly_rankings: PulseSummaryRankRow[];
  upcoming_events: PulseSummaryEvent[];
  achievements: Array<{
    id: string;
    name: string;
    requirement: string | null;
    current: number | null;
    target: number | null;
    progress: number | null;
    earned_at: string | null;
  }>;
  recent_activity: Array<{
    id: string;
    title: string;
    subtitle: string;
    action_url: string | null;
    server_name: string | null;
    event_name: string | null;
    created_at: string | null;
  }>;
};

type PulseSummaryEvent = {
  id: string;
  slug: string;
  name: string;
  event_type_label: string;
  category_label: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  registered_servers: number;
  participants: number;
  match_count: number;
  progress: number;
  artwork_url: string | null;
};

type PulseSummaryServer = {
  id: string;
  slug: string | null;
  name: string;
  category: string | null;
  category_label: string | null;
  score: number;
  score_label: string;
  rank: number | null;
  players_online: number | null;
  max_players: number | null;
  win_loss: string | null;
  kd_ratio: number | null;
};

type PulseSummaryRankRow = {
  rank: number | null;
  server_name: string;
  server_slug: string | null;
  category_label: string | null;
  points: number;
  win_loss: string | null;
};

type PulseSummaryEventRow = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  event_type: string | null;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  banner_url: string | null;
  server_limit: number | null;
  team_limit: number | null;
  registered_servers: number | null;
  match_count: number | null;
};

type PulseSummaryServerRow = {
  id: string;
  slug: string | null;
  server_name: string | null;
  category: string | null;
  current_players: number | null;
  max_players: number | null;
  kills: number | null;
  deaths: number | null;
  uniquePlayers: number | null;
  joins: number | null;
  longestKill: number | null;
  statsSyncActive: boolean | null;
  lastActivityAt: string | null;
};

export function pulseFeatureDisabledPayload() {
  return {
    ok: false,
    error: "feature_disabled",
    message: "DZN Pulse is not enabled.",
  };
}

export async function resolvePulseUser(env: Env, request: Request): Promise<SessionUser | null> {
  const { getSessionUser } = await import("./db");
  const { isMockAuth } = await import("./mock");
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

export async function listUserNotifications(env: Env, user: SessionUser, options: {
  filter?: string | null;
  cursor?: string | null;
  limit?: number | string | null;
} = {}): Promise<PulseListResult> {
  if (!isDznPulseEnabled(env)) return emptyPulseList();
  const db = requireDb(env);
  const filter = normalizeNotificationFilter(options.filter);
  const limit = sanitizeLimit(options.limit, 20, 50);
  const cursor = parseCursor(options.cursor);
  const bindings: unknown[] = [user.id];
  const conditions = [
    "user_notifications.user_id = ?",
    "(user_notifications.expires_at IS NULL OR datetime(user_notifications.expires_at) > datetime('now'))",
  ];

  if (filter !== "all") {
    conditions.push(`user_notifications.type IN (${notificationTypesForFilter(filter).map(() => "?").join(", ")})`);
    bindings.push(...notificationTypesForFilter(filter));
  }

  if (cursor) {
    conditions.push("(datetime(user_notifications.created_at) < datetime(?) OR (user_notifications.created_at = ? AND user_notifications.id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const result = await db
    .prepare(
      `SELECT user_notifications.*,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
              competitive_events.name AS event_name
       FROM user_notifications
       LEFT JOIN linked_servers ON linked_servers.id = user_notifications.server_id
       LEFT JOIN competitive_events ON competitive_events.id = user_notifications.event_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY datetime(user_notifications.created_at) DESC, user_notifications.id DESC
       LIMIT ?`,
    )
    .bind(...bindings, limit + 1)
    .all<NotificationRow>();

  const rows = result.results ?? [];
  const visibleRows = rows.slice(0, limit);
  const nextRow = rows.length > limit ? rows[limit] : null;

  return {
    ok: true,
    items: visibleRows.map(toNotification),
    unreadCount: await countUnreadNotifications(env, user),
    nextCursor: nextRow ? makeCursor(nextRow) : null,
    generated_at: new Date().toISOString(),
  };
}

export async function countUnreadNotifications(env: Env, user: SessionUser) {
  if (!isDznPulseEnabled(env)) return 0;
  const row = await requireDb(env)
    .prepare(
      `SELECT COUNT(*) AS count
       FROM user_notifications
       WHERE user_id = ?
         AND read_at IS NULL
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
    )
    .bind(user.id)
    .first<{ count: number | null }>()
    .catch(() => ({ count: 0 }));
  return Math.max(0, Number(row?.count ?? 0) || 0);
}

export async function markNotificationRead(env: Env, user: SessionUser, notificationId: string) {
  if (!isDznPulseEnabled(env)) return { status: 404, ...pulseFeatureDisabledPayload() };
  const id = sanitizeIdentifier(notificationId);
  if (!id) return { ok: false, status: 400, error: "invalid_notification_id", message: "Invalid notification id." };
  const now = new Date().toISOString();
  const result = await requireDb(env)
    .prepare("UPDATE user_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?")
    .bind(now, id, user.id)
    .run();
  const changes = Number(result.meta?.changes ?? 0) || 0;
  if (changes <= 0) {
    return { ok: false, status: 404, error: "notification_not_found", message: "Notification was not found." };
  }
  return { ok: true, status: 200, id, read_at: now, unreadCount: await countUnreadNotifications(env, user) };
}

export async function markAllNotificationsRead(env: Env, user: SessionUser) {
  if (!isDznPulseEnabled(env)) return { status: 404, ...pulseFeatureDisabledPayload() };
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `UPDATE user_notifications
       SET read_at = COALESCE(read_at, ?)
       WHERE user_id = ?
         AND read_at IS NULL
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
    )
    .bind(now, user.id)
    .run();
  return { ok: true, status: 200, read_at: now, unreadCount: 0 };
}

export async function clearReadNotifications(env: Env, user: SessionUser) {
  if (!isDznPulseEnabled(env)) return { status: 404, ...pulseFeatureDisabledPayload() };
  const result = await requireDb(env)
    .prepare("DELETE FROM user_notifications WHERE user_id = ? AND read_at IS NOT NULL")
    .bind(user.id)
    .run<{ changes?: number }>();
  return { ok: true, status: 200, cleared: Number(result.meta?.changes ?? 0) || 0, unreadCount: await countUnreadNotifications(env, user) };
}

export async function createNotification(env: Env, input: {
  userId: string;
  type: PulseNotificationType | string;
  title: string;
  body: string;
  dedupeKey: string;
  serverId?: string | null;
  campaignId?: string | null;
  eventId?: string | null;
  imageUrl?: string | null;
  actionUrl?: string | null;
  priority?: number | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  if (!isDznPulseEnabled(env)) return null;
  const type = normalizeNotificationType(input.type);
  const actionUrl = sanitizePulseActionUrl(input.actionUrl ?? null);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await requireDb(env)
    .prepare(
      `INSERT OR IGNORE INTO user_notifications (
        id, user_id, server_id, campaign_id, event_id, type, title, body,
        image_url, action_url, priority, dedupe_key, metadata, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.userId,
      input.serverId ?? null,
      input.campaignId ?? null,
      input.eventId ?? null,
      type,
      sanitizeText(input.title, 140) || "DZN Pulse",
      sanitizeText(input.body, 500),
      sanitizeUrlText(input.imageUrl),
      actionUrl,
      clampInteger(input.priority, 0, 1000),
      sanitizeDedupeKey(input.dedupeKey),
      safeJson(input.metadata),
      now,
      input.expiresAt ?? null,
    )
    .run();
  return { ok: true, id, dedupeKey: input.dedupeKey };
}

export async function dispatchPulseDiscordNotification(env: Env, notification: {
  dedupeKey: string;
  userId: string;
  title: string;
}) {
  if (!isDiscordNotificationsEnabled(env)) {
    return { ok: true, skipped: true, reason: "discord_notifications_disabled" };
  }

  return {
    ok: true,
    skipped: true,
    reason: "discord_notification_dispatcher_not_configured",
    dedupeKey: notification.dedupeKey,
    userId: notification.userId,
    title: notification.title,
  };
}

export async function createEventEntryNotification(env: Env, input: {
  userId: string;
  serverId: string;
  eventId: string;
  eventSlug?: string | null;
  eventName?: string | null;
  serverName?: string | null;
}) {
  const eventName = sanitizeText(input.eventName, 140) || "DZN event";
  const serverName = sanitizeText(input.serverName, 140) || "Your server";
  return createNotification(env, {
    userId: input.userId,
    serverId: input.serverId,
    eventId: input.eventId,
    type: "event_entry_confirmed",
    title: "Event entry confirmed",
    body: `${serverName} entered ${eventName}.`,
    actionUrl: input.eventSlug ? `/events/${encodeURIComponent(input.eventSlug)}` : "/events",
    dedupeKey: `event-entry:${input.userId}:${input.serverId}:${input.eventId}`,
    priority: 60,
    metadata: { eventName, serverName },
  });
}

export async function listEventPopups(env: Env, user: SessionUser): Promise<{
  ok: true;
  items: PulseEventPopup[];
  selected: PulseEventPopup | null;
  generated_at: string;
}> {
  if (!isDznPulseEnabled(env)) return { ok: true, items: [], selected: null, generated_at: new Date().toISOString() };
  const db = requireDb(env);
  const [servers, campaigns, dismissals] = await Promise.all([
    getLinkedServersForUserSummary(env, user.id).catch(() => []),
    readActiveCampaigns(db),
    readPopupDismissals(env, user),
  ]);
  if (!campaigns.length) return { ok: true, items: [], selected: null, generated_at: new Date().toISOString() };

  const items: PulseEventPopup[] = [];
  for (const campaign of campaigns) {
    const popup = await buildPopupForCampaign(env, user, campaign, servers, dismissals);
    if (popup) items.push(popup);
  }

  return {
    ok: true,
    items,
    selected: items[0] ?? null,
    generated_at: new Date().toISOString(),
  };
}

export async function dismissEventPopup(env: Env, user: SessionUser, campaignId: string, input: {
  mode?: string | null;
  serverId?: string | null;
}) {
  if (!isDznPulseEnabled(env)) return { status: 404, ...pulseFeatureDisabledPayload() };
  const id = sanitizeIdentifier(campaignId);
  if (!id) return { ok: false, status: 400, error: "invalid_campaign_id", message: "Invalid campaign id." };
  const mode = normalizeDismissMode(input.mode);
  if (!mode) return { ok: false, status: 400, error: "invalid_dismiss_mode", message: "Dismissal mode must be snooze, forever, or joined." };
  const campaign = await requireDb(env)
    .prepare("SELECT id FROM notification_campaigns WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!campaign) return { ok: false, status: 404, error: "campaign_not_found", message: "Campaign was not found." };
  const serverId = sanitizeIdentifier(input.serverId);
  if (serverId) {
    const server = await requireDb(env)
      .prepare("SELECT id FROM linked_servers WHERE id = ? AND user_id = ? LIMIT 1")
      .bind(serverId, user.id)
      .first<{ id: string }>();
    if (!server) return { ok: false, status: 403, error: "forbidden", message: "You do not have access to this server." };
  }
  const scopeKey = serverId ? `server:${serverId}` : "user";
  const now = new Date().toISOString();
  const snoozedUntil = mode === "snooze" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;

  await requireDb(env)
    .prepare(
      `INSERT INTO event_popup_dismissals (
        id, user_id, server_id, campaign_id, scope_key, mode, snoozed_until, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, campaign_id, scope_key) DO UPDATE SET
        mode = excluded.mode,
        server_id = excluded.server_id,
        snoozed_until = excluded.snoozed_until,
        updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), user.id, serverId, id, scopeKey, mode, snoozedUntil, now, now)
    .run();

  return { ok: true, status: 200, campaign_id: id, mode, snoozed_until: snoozedUntil };
}

export async function getPulseSummary(env: Env, user: SessionUser): Promise<PulseSummary> {
  if (!isDznPulseEnabled(env)) return emptyPulseSummary();
  const [eventRows, rankedServers, servers, announcements, achievements, recentActivity] = await Promise.all([
    readPulseSummaryEvents(env).catch(() => []),
    readPulseSummaryRankings(env).catch(() => []),
    getLinkedServersForUserSummary(env, user.id).catch(() => []),
    readAnnouncements(env, user).catch(() => []),
    readAchievements(env, user).catch(() => []),
    readRecentActivity(env).catch(() => []),
  ]);
  const liveEvent = eventRows.find((event) => event.status === "live") ?? null;
  const upcoming = eventRows.filter((event) => ["upcoming", "registration_open", "standby"].includes(event.status)).slice(0, 5);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    metrics: {
      live_events: eventRows.filter((event) => event.status === "live").length,
      active_servers: servers.filter((server) => String(server.status ?? "").toLowerCase() === "live").length,
      players_online: servers.reduce((total, server) => total + (Number(server.current_players ?? 0) || 0), 0),
      matches_today: eventRows.filter((event) => isSameUtcDay(event.starts_at)).length,
      event_registrations: eventRows.reduce((total, event) => total + Number(event.registered_servers ?? 0), 0),
      participating_servers: eventRows.reduce((total, event) => total + Number(event.registered_servers ?? 0), 0),
      connected_communities: servers.length,
    },
    live_event: liveEvent ? toPulseEventSummary(liveEvent as Record<string, unknown>) : null,
    top_server: rankedServers[0] ? toPulseTopServer(rankedServers[0]) : null,
    announcements,
    monthly_rankings: rankedServers.slice(0, 5).map(toPulseRankRow),
    upcoming_events: upcoming.map((event) => toPulseEventSummary(event as Record<string, unknown>)),
    achievements,
    recent_activity: recentActivity,
  };
}

export async function generateDuePulseNotifications(env: Env) {
  if (!isDznPulseEnabled(env)) {
    return { ok: true, skipped: true, reason: "dzn_pulse_disabled", created: 0 };
  }
  return { ok: true, skipped: true, reason: "no_scheduler_hook_configured", created: 0 };
}

async function readPulseSummaryEvents(env: Env) {
  const db = requireDb(env);
  const rows = await db
    .prepare(
      `SELECT competitive_events.id,
              competitive_events.slug,
              competitive_events.name,
              competitive_events.category,
              competitive_events.event_type,
              competitive_events.status,
              competitive_events.starts_at,
              competitive_events.ends_at,
              competitive_events.banner_url,
              competitive_events.server_limit,
              competitive_events.team_limit,
              (SELECT COUNT(*)
               FROM competitive_event_servers
               WHERE competitive_event_servers.event_id = competitive_events.id) AS registered_servers,
              (SELECT COUNT(*)
               FROM competitive_event_matches
               WHERE competitive_event_matches.event_id = competitive_events.id) AS match_count
       FROM competitive_events
       WHERE COALESCE(competitive_events.visibility, 'public') != 'private'
         AND competitive_events.status IN ('live', 'registration_open', 'upcoming', 'standby')
       ORDER BY CASE competitive_events.status
         WHEN 'live' THEN 0
         WHEN 'registration_open' THEN 1
         WHEN 'upcoming' THEN 2
         WHEN 'standby' THEN 3
         ELSE 4
       END, datetime(COALESCE(competitive_events.starts_at, competitive_events.created_at)) ASC
       LIMIT 8`,
    )
    .all<PulseSummaryEventRow>()
    .catch(() => ({ results: [] as PulseSummaryEventRow[] }));

  return (rows.results ?? []).map((row) => {
    const registered = numberOrZero(row.registered_servers);
    const serverLimit = numberOrZero(row.server_limit ?? row.team_limit);
    const category = normalizeServerCategory(row.category);
    const eventType = normalizeEventTypeText(row.event_type);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: category ?? row.category ?? "same-category",
      category_label: category ? getServerCategoryLabel(category) : "Same Category",
      event_type: eventType,
      event_type_label: pulseEventTypeLabel(eventType),
      status: String(row.status ?? "upcoming"),
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      registered_servers: registered,
      total_participants: registered,
      match_count: numberOrZero(row.match_count),
      progress_percent: serverLimit > 0 ? Math.min(100, Math.round((registered / serverLimit) * 100)) : Math.min(100, registered * 12),
      banner_url: row.banner_url,
    };
  });
}

async function readPulseSummaryRankings(env: Env) {
  const db = requireDb(env);
  const rows = await db
    .prepare(
      `SELECT linked_servers.id,
              linked_servers.public_slug AS slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
              COALESCE(NULLIF(linked_servers.server_mode, ''), linked_servers.server_type, linked_servers.server_category) AS category,
              linked_servers.current_players,
              COALESCE(linked_servers.max_players, linked_servers.player_slots) AS max_players,
              COALESCE(server_stats.total_kills, 0) AS kills,
              COALESCE(server_stats.total_deaths, 0) AS deaths,
              COALESCE(server_stats.unique_players, 0) AS uniquePlayers,
              COALESCE(server_stats.total_joins, 0) AS joins,
              0 AS longestKill,
              CASE
                WHEN COALESCE(server_stats.total_kills, 0) > 0
                  OR COALESCE(server_stats.total_deaths, 0) > 0
                  OR COALESCE(server_stats.unique_players, 0) > 0
                  OR COALESCE(server_stats.total_joins, 0) > 0
                  OR lower(COALESCE(adm_sync_state.last_sync_status, '')) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
                THEN 1 ELSE 0
              END AS statsSyncActive,
              COALESCE(server_stats.last_event_at, linked_servers.updated_at, linked_servers.created_at) AS lastActivityAt
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       WHERE lower(COALESCE(linked_servers.status, 'pending')) = 'live'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY COALESCE(server_stats.total_kills, 0) DESC,
                COALESCE(server_stats.unique_players, 0) DESC,
                datetime(COALESCE(server_stats.last_event_at, linked_servers.updated_at, linked_servers.created_at)) DESC
       LIMIT 25`,
    )
    .all<PulseSummaryServerRow>()
    .catch(() => ({ results: [] as PulseSummaryServerRow[] }));

  return rankServers((rows.results ?? []).map((row) => ({
    ...row,
    server_name: row.server_name ?? "Unnamed DZN Server",
    statsSyncActive: Number(row.statsSyncActive ?? 0) === 1,
  })), 5);
}

export function sanitizePulseActionUrl(value: string | null | undefined) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text || text.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(text)) return null;
  if (!text.startsWith("/")) return null;
  try {
    const url = new URL(text, "https://dzn.local");
    const path = `${url.pathname}${url.search}${url.hash}`;
    const allowedExact = [
      "/dashboard",
      "/dashboard/events",
      "/events",
      "/leaderboards",
      "/servers",
      "/seasons",
      "/dzn-pulse",
      "/setup",
    ];
    const allowedPrefixes = [
      "/dashboard/",
      "/events/",
      "/servers/",
      "/seasons/",
      "/dzn-pulse/",
      "/setup/",
    ];
    return allowedExact.includes(url.pathname) || allowedPrefixes.some((prefix) => url.pathname.startsWith(prefix))
      ? path
      : null;
  } catch {
    return null;
  }
}

function emptyPulseList(): PulseListResult {
  return {
    ok: true,
    items: [],
    unreadCount: 0,
    nextCursor: null,
    generated_at: new Date().toISOString(),
  };
}

function emptyPulseSummary(): PulseSummary {
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    metrics: {
      live_events: 0,
      active_servers: 0,
      players_online: 0,
      matches_today: 0,
      event_registrations: 0,
      participating_servers: 0,
      connected_communities: 0,
    },
    live_event: null,
    top_server: null,
    announcements: [],
    monthly_rankings: [],
    upcoming_events: [],
    achievements: [],
    recent_activity: [],
  };
}

async function readActiveCampaigns(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT notification_campaigns.*,
              competitive_events.name AS event_name,
              competitive_events.slug AS event_slug,
              competitive_events.category AS event_category,
              competitive_events.event_type AS event_type,
              competitive_events.status AS event_status,
              competitive_events.starts_at AS event_starts_at,
              competitive_events.ends_at AS event_ends_at,
              competitive_events.rewards AS event_rewards
       FROM notification_campaigns
       LEFT JOIN competitive_events ON competitive_events.id = notification_campaigns.event_id
       WHERE datetime(notification_campaigns.starts_at) <= datetime('now')
         AND (notification_campaigns.ends_at IS NULL OR datetime(notification_campaigns.ends_at) > datetime('now'))
         AND (
           competitive_events.id IS NULL
           OR competitive_events.ends_at IS NULL
           OR datetime(competitive_events.ends_at) > datetime('now')
         )
       ORDER BY notification_campaigns.priority DESC,
                datetime(COALESCE(competitive_events.starts_at, notification_campaigns.starts_at)) ASC,
                datetime(notification_campaigns.created_at) DESC
       LIMIT 10`,
    )
    .all<CampaignRow>()
    .catch(() => ({ results: [] as CampaignRow[] }));
  return result.results ?? [];
}

async function readPopupDismissals(env: Env, user: SessionUser) {
  const result = await requireDb(env)
    .prepare("SELECT campaign_id, server_id, scope_key, mode, snoozed_until FROM event_popup_dismissals WHERE user_id = ?")
    .bind(user.id)
    .all<DismissalRow>()
    .catch(() => ({ results: [] as DismissalRow[] }));
  return result.results ?? [];
}

async function buildPopupForCampaign(
  env: Env,
  user: SessionUser,
  campaign: CampaignRow,
  servers: Array<Record<string, unknown>>,
  dismissals: DismissalRow[],
): Promise<PulseEventPopup | null> {
  if (isDismissed(campaign.id, null, dismissals)) return null;
  const eventCategory = normalizeServerCategory(campaign.event_category);
  const compatible: PulseCompatibleServer[] = [];
  const incompatible: Array<PulseCompatibleServer & { reason: string }> = [];

  for (const server of servers) {
    const serverId = stringValue(server.id);
    if (!serverId) continue;
    if (isDismissed(campaign.id, serverId, dismissals)) continue;
    const serverCategory = normalizeServerCategory(server.server_category);
    const base = {
      id: serverId,
      name: serverName(server),
      category: serverCategory,
      category_label: serverCategory ? getServerCategoryLabel(serverCategory) : null,
      current_players: nullableNumber(server.current_players),
      max_players: nullableNumber(server.max_players ?? server.player_slots),
      already_entered: await serverAlreadyEnteredEvent(env, campaign.event_id, serverId),
    };
    if (base.already_entered) continue;
    if (eventCategory && serverCategory !== eventCategory) {
      incompatible.push({ ...base, reason: `This event is for ${getServerCategoryLabel(eventCategory)} servers.` });
    } else {
      compatible.push(base);
    }
  }

  const metadata = safeParseObject(campaign.metadata);
  const allowLinkServer = metadata.allow_link_server === true;
  if (!compatible.length && (!allowLinkServer || servers.length > 0)) return null;

  return {
    campaign_id: campaign.id,
    slug: campaign.slug,
    type: campaign.type,
    title: campaign.title,
    body: campaign.body,
    image_url: sanitizeUrlText(campaign.image_url),
    action_url: sanitizePulseActionUrl(campaign.action_url) ?? (campaign.event_slug ? `/events/${encodeURIComponent(campaign.event_slug)}` : "/events"),
    event_id: campaign.event_id,
    event_slug: campaign.event_slug,
    event_name: campaign.event_name,
    event_category: eventCategory,
    event_category_label: eventCategory ? getServerCategoryLabel(eventCategory) : null,
    event_type: campaign.event_type,
    event_status: campaign.event_status,
    starts_at: campaign.event_starts_at ?? campaign.starts_at,
    ends_at: campaign.event_ends_at ?? campaign.ends_at,
    priority: Number(campaign.priority ?? 0) || 0,
    metadata,
    compatible_servers: compatible,
    incompatible_servers: incompatible,
    link_server_url: allowLinkServer ? "/setup" : null,
  };
}

async function serverAlreadyEnteredEvent(env: Env, eventId: string | null, serverId: string) {
  if (!eventId) return false;
  const db = requireDb(env);
  const competitiveRow = await db
    .prepare(
      "SELECT id FROM competitive_event_servers WHERE event_id = ? AND server_id = ? LIMIT 1",
    )
    .bind(eventId, serverId)
    .first<{ id: string }>()
    .catch(() => null);
  if (competitiveRow?.id) return true;

  const ownerEntryRow = await db
    .prepare(
      "SELECT id FROM server_event_entries WHERE event_id = ? AND linked_server_id = ? AND status = 'entered' LIMIT 1",
    )
    .bind(eventId, serverId)
    .first<{ id: string }>()
    .catch(() => null);
  return Boolean(ownerEntryRow?.id);
}

function isDismissed(campaignId: string, serverId: string | null, dismissals: DismissalRow[]) {
  const now = Date.now();
  return dismissals.some((item) => {
    if (item.campaign_id !== campaignId) return false;
    if (serverId && item.scope_key !== `server:${serverId}` && item.scope_key !== "user") return false;
    if (item.mode === "forever" || item.mode === "joined") return true;
    if (item.mode === "snooze" && item.snoozed_until && Date.parse(item.snoozed_until) > now) return true;
    return false;
  });
}

async function readAnnouncements(env: Env, user: SessionUser) {
  const db = requireDb(env);
  const rows = await db
    .prepare(
      `SELECT id, title, body, action_url, created_at
       FROM user_notifications
       WHERE user_id = ?
         AND type IN ('dzn_news', 'dzn_announcement')
       ORDER BY datetime(created_at) DESC
       LIMIT 5`,
    )
    .bind(user.id)
    .all<{ id: string; title: string; body: string; action_url: string | null; created_at: string | null }>()
    .catch(() => ({ results: [] as Array<{ id: string; title: string; body: string; action_url: string | null; created_at: string | null }> }));
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    action_url: sanitizePulseActionUrl(row.action_url),
    created_at: row.created_at,
  }));
}

async function readAchievements(env: Env, user: SessionUser) {
  const db = requireDb(env);
  const rows = await db
    .prepare(
      `SELECT server_badge_awards.id,
              server_badge_awards.badge_code,
              server_badge_awards.awarded_at,
              badge_unlock_progress.current_value,
              badge_unlock_progress.target_value,
              badge_unlock_progress.progress_percent
       FROM server_badge_awards
       JOIN linked_servers ON linked_servers.id = server_badge_awards.server_id
       LEFT JOIN badge_unlock_progress
         ON badge_unlock_progress.server_id = server_badge_awards.server_id
        AND badge_unlock_progress.badge_code = server_badge_awards.badge_code
       WHERE linked_servers.user_id = ?
         AND server_badge_awards.is_active = 1
       ORDER BY datetime(server_badge_awards.awarded_at) DESC
       LIMIT 5`,
    )
    .bind(user.id)
    .all<{
      id: string;
      badge_code: string;
      awarded_at: string | null;
      current_value: number | null;
      target_value: number | null;
      progress_percent: number | null;
    }>()
    .catch(() => ({ results: [] as Array<{ id: string; badge_code: string; awarded_at: string | null; current_value: number | null; target_value: number | null; progress_percent: number | null }> }));
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: formatBadgeName(row.badge_code),
    requirement: null,
    current: nullableNumber(row.current_value),
    target: nullableNumber(row.target_value),
    progress: nullableNumber(row.progress_percent),
    earned_at: row.awarded_at,
  }));
}

async function readRecentActivity(env: Env) {
  const db = requireDb(env);
  const rows = await db
    .prepare(
      `SELECT competitive_event_activity.id,
              competitive_event_activity.message,
              competitive_event_activity.created_at,
              competitive_events.name AS event_name,
              competitive_events.slug AS event_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name
       FROM competitive_event_activity
       LEFT JOIN competitive_events ON competitive_events.id = competitive_event_activity.event_id
       LEFT JOIN linked_servers ON linked_servers.id = competitive_event_activity.server_id
       ORDER BY datetime(competitive_event_activity.created_at) DESC
       LIMIT 8`,
    )
    .all<{ id: string; message: string; created_at: string | null; event_name: string | null; event_slug: string | null; server_name: string | null }>()
    .catch(() => ({ results: [] as Array<{ id: string; message: string; created_at: string | null; event_name: string | null; event_slug: string | null; server_name: string | null }> }));
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    title: row.message,
    subtitle: [row.server_name, row.event_name].filter(Boolean).join(" • "),
    action_url: row.event_slug ? `/events/${encodeURIComponent(row.event_slug)}` : "/events",
    server_name: row.server_name,
    event_name: row.event_name,
    created_at: row.created_at,
  }));
}

function toPulseEventSummary(event: Record<string, unknown>): PulseSummaryEvent {
  const category = normalizeServerCategory(event.category);
  const eventType = normalizeEventTypeText(event.event_type);
  return {
    id: String(event.id ?? ""),
    slug: String(event.slug ?? "events"),
    name: String(event.name ?? "DZN Event"),
    event_type_label: String(event.event_type_label ?? pulseEventTypeLabel(eventType)),
    category_label: String(event.category_label ?? (category ? getServerCategoryLabel(category) : "Same Category")),
    status: String(event.status ?? "upcoming"),
    starts_at: stringValue(event.starts_at),
    ends_at: stringValue(event.ends_at),
    registered_servers: numberOrZero(event.registered_servers),
    participants: numberOrZero(event.total_participants ?? event.participants),
    match_count: numberOrZero(event.match_count),
    progress: numberOrZero(event.progress_percent ?? event.progress),
    artwork_url: stringValue(event.banner_url) ?? stringValue(event.artwork_url),
  };
}

function toPulseTopServer(row: RankedServer<PulseSummaryServerRow>): PulseSummaryServer {
  const category = normalizeServerCategory(row.category);
  return {
    id: row.id,
    slug: row.slug,
    name: row.server_name ?? "Unnamed DZN Server",
    category,
    category_label: category ? getServerCategoryLabel(category) : null,
    score: numberOrZero(row.score),
    score_label: row.score_label || String(numberOrZero(row.score)),
    rank: nullableNumber(row.rank),
    players_online: nullableNumber(row.current_players),
    max_players: nullableNumber(row.max_players),
    win_loss: null,
    kd_ratio: calculateKd(row.kills, row.deaths),
  };
}

function toPulseRankRow(row: RankedServer<PulseSummaryServerRow>): PulseSummaryRankRow {
  const category = normalizeServerCategory(row.category);
  return {
    rank: nullableNumber(row.rank),
    server_name: row.server_name ?? "Unnamed DZN Server",
    server_slug: row.slug,
    category_label: category ? getServerCategoryLabel(category) : null,
    points: numberOrZero(row.score),
    win_loss: null,
  };
}

function toNotification(row: NotificationRow): PulseNotification {
  const type = normalizeNotificationType(row.type);
  const category = categoryForNotificationType(type);
  return {
    id: row.id,
    type,
    category,
    category_label: categoryLabel(category),
    title: row.title,
    body: row.body,
    image_url: sanitizeUrlText(row.image_url),
    action_url: sanitizePulseActionUrl(row.action_url),
    server_id: row.server_id,
    server_name: row.server_name,
    event_id: row.event_id,
    event_name: row.event_name,
    priority: Number(row.priority ?? 0) || 0,
    read_at: row.read_at,
    created_at: row.created_at ?? new Date().toISOString(),
    expires_at: row.expires_at,
    metadata: safeParseObject(row.metadata),
  };
}

function notificationTypesForFilter(filter: PulseNotificationFilter): PulseNotificationType[] {
  if (filter === "events") return ["upcoming_event", "event_starting", "event_started", "event_countdown", "event_entry_confirmed", "event_result", "prize_unlocked"];
  if (filter === "scores") return ["event_score_update", "event_rank_update", "monthly_global_rank"];
  if (filter === "achievements") return ["achievement_unlocked"];
  if (filter === "news") return ["dzn_news", "dzn_announcement"];
  return [...PULSE_NOTIFICATION_TYPES];
}

function categoryForNotificationType(type: PulseNotificationType): PulseNotificationFilter {
  if (notificationTypesForFilter("events").includes(type)) return "events";
  if (notificationTypesForFilter("scores").includes(type)) return "scores";
  if (notificationTypesForFilter("achievements").includes(type)) return "achievements";
  if (notificationTypesForFilter("news").includes(type)) return "news";
  return "all";
}

function categoryLabel(category: PulseNotificationFilter) {
  if (category === "events") return "Events";
  if (category === "scores") return "Scores";
  if (category === "achievements") return "Achievements";
  if (category === "news") return "News";
  return "All";
}

function normalizeNotificationFilter(value: unknown): PulseNotificationFilter {
  const normalized = String(value ?? "all").trim().toLowerCase();
  return normalized === "events" || normalized === "scores" || normalized === "achievements" || normalized === "news" ? normalized : "all";
}

function normalizeNotificationType(value: unknown): PulseNotificationType {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (PULSE_NOTIFICATION_TYPES as readonly string[]).includes(normalized) ? normalized as PulseNotificationType : "dzn_announcement";
}

function normalizeDismissMode(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "snooze" || normalized === "forever" || normalized === "joined" ? normalized : null;
}

function sanitizeIdentifier(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{3,160}$/.test(value) ? value : "";
}

function sanitizeDedupeKey(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 240) : crypto.randomUUID();
}

function sanitizeText(value: unknown, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sanitizeUrlText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.startsWith("/") && !text.startsWith("//")) return text.slice(0, 500);
  if (/^https:\/\/[a-z0-9.-]+/i.test(text)) return text.slice(0, 500);
  return null;
}

function safeJson(value: Record<string, unknown> | null | undefined) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function safeParseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function makeCursor(row: Pick<NotificationRow, "created_at" | "id">) {
  return `${encodeURIComponent(row.created_at ?? "")}__${encodeURIComponent(row.id)}`;
}

function parseCursor(value: unknown) {
  const text = typeof value === "string" ? value : "";
  if (!text.includes("__")) return null;
  const [createdAt, id] = text.split("__");
  const decodedCreatedAt = decodeURIComponent(createdAt ?? "");
  const decodedId = decodeURIComponent(id ?? "");
  if (!decodedCreatedAt || !sanitizeIdentifier(decodedId)) return null;
  return { createdAt: decodedCreatedAt, id: decodedId };
}

function sanitizeLimit(value: unknown, fallback: number, max: number) {
  const parsed = Math.round(Number(value ?? fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

function clampInteger(value: unknown, min: number, max: number) {
  const parsed = Math.round(Number(value ?? min));
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: unknown) {
  return nullableNumber(value) ?? 0;
}

function serverName(server: Record<string, unknown>) {
  return stringValue(server.display_name) ??
    stringValue(server.hostname) ??
    stringValue(server.server_name) ??
    stringValue(server.nitrado_service_name) ??
    stringValue(server.guild_name) ??
    "DZN Server";
}

function isSameUtcDay(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate();
}

function normalizeEventTypeText(value: unknown) {
  const text = String(value ?? "event").trim().toLowerCase();
  return /^[a-z0-9_-]{2,80}$/.test(text) ? text : "event";
}

function pulseEventTypeLabel(value: string) {
  const labels: Record<string, string> = {
    capture_the_flag: "Capture The Flag",
    community_cup: "Community Cup",
    bot_tournament: "Bot Tournament",
    faction_wars: "Faction Wars",
    seasonal_wars: "Seasonal Wars",
    kill_race: "Kill Race",
    survival_challenge: "Survival Challenge",
    event: "Event",
  };
  return labels[value] ?? value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function calculateKd(killsValue: unknown, deathsValue: unknown) {
  const kills = numberOrZero(killsValue);
  const deaths = numberOrZero(deathsValue);
  if (kills === 0 && deaths === 0) return null;
  if (deaths === 0) return kills;
  return Math.round((kills / deaths) * 100) / 100;
}

function formatBadgeName(value: string) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
