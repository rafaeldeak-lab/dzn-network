import { readDznFeatureFlags } from "./feature-flags";
import { requireDb } from "./db";
import type { Env } from "./types";

export type DiscordAnnouncementEventType =
  | "new_server"
  | "server_bump"
  | "pro_showcase_thread"
  | "weekly_spotlight";

export type DiscordAnnouncementStatus =
  | "sent"
  | "failed"
  | "skipped_feature_disabled"
  | "skipped_missing_table"
  | "skipped_not_configured"
  | "skipped_hidden_archived"
  | "skipped_dedupe"
  | "skipped_invalid_invite";

export type DiscordAnnouncementResult = {
  ok: boolean;
  sent: boolean;
  status: DiscordAnnouncementStatus;
  dedupeKey: string | null;
  reason: string | null;
};

export type DiscordAnnouncementHealth = {
  featureEnabled: boolean;
  advertChannelConfigured: boolean;
  showcaseChannelConfigured: boolean;
  botTokenConfigured: boolean;
  lastServerAnnouncement: DiscordAnnouncementSummary | null;
  lastBumpPost: DiscordAnnouncementSummary | null;
  lastWeeklySpotlight: DiscordAnnouncementSummary | null;
  recentFailures: DiscordAnnouncementSummary[];
  generatedAt: string;
};

export type DiscordAnnouncementSummary = {
  id: string;
  serverId: string | null;
  eventType: string;
  channelConfigured: boolean;
  status: string;
  failureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type AnnouncementInput = {
  eventType: DiscordAnnouncementEventType;
  serverId?: string | null;
  planKey?: string | null;
  reason?: string | null;
};

type AnnouncementServerRow = {
  id: string;
  server_name: string | null;
  public_slug: string | null;
  status: string | null;
  lifecycle_status: string | null;
  listing_visibility: string | null;
  public_short_description: string | null;
  public_description: string | null;
  public_discord_invite: string | null;
  public_website_url: string | null;
  public_server_name: string | null;
  current_player_count: number | null;
  max_player_count: number | null;
  network_rank: number | null;
  plan_key: string | null;
  subscription_status: string | null;
};

type AnnouncementPostRow = {
  id: string;
  server_id: string | null;
  event_type: string;
  channel_id: string | null;
  status: string;
  failure_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type DiscordMessagePayload = {
  username: string;
  allowed_mentions: { parse: [] };
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
    timestamp?: string;
    thumbnail?: { url: string };
    image?: { url: string };
  }>;
  components?: Array<{
    type: 1;
    components: Array<{ type: 2; style: 5; label: string; url: string }>;
  }>;
};

const ANNOUNCEMENT_TABLE = "discord_announcement_posts";
const FREE_BUMP_COOLDOWN_DAYS = 30;
const PRO_BUMP_COOLDOWN_DAYS = 7;
const DISCORD_API_BASE = "https://discord.com/api/v10";

export async function recordDiscordServerAnnouncementEvent(env: Env, input: AnnouncementInput): Promise<DiscordAnnouncementResult> {
  const flags = readDznFeatureFlags(env);
  if (!flags.discordServerAnnouncementsEnabled) {
    return skipped("skipped_feature_disabled", null, "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED is false.");
  }

  const db = requireDb(env);
  if (!(await tableExists(db, ANNOUNCEMENT_TABLE))) {
    return skipped("skipped_missing_table", null, "Migration 0056 has not created discord_announcement_posts yet.");
  }

  const server = input.serverId ? await loadAnnouncementServer(env, input.serverId) : null;
  if (input.serverId && !server) {
    return recordAnnouncementFailure(env, input, null, "failed", "Linked server was not found.");
  }
  if (server && isHiddenOrArchivedServer(server)) {
    const dedupeKey = buildDedupeKey(input.eventType, server.id, input.planKey ?? server.plan_key, new Date());
    return skipped("skipped_hidden_archived", dedupeKey, "Hidden or archived servers do not post to Discord.");
  }

  const channelId = await resolveAnnouncementChannelId(env, input.eventType);
  if (!channelId) {
    const dedupeKey = buildDedupeKey(input.eventType, server?.id ?? input.serverId ?? null, input.planKey ?? server?.plan_key ?? null, new Date());
    return recordAnnouncementSkip(env, input, dedupeKey, "skipped_not_configured", "Discord announcement channel is not configured.");
  }

  const now = new Date();
  const planKey = normalizePlanKey(input.planKey ?? server?.plan_key);
  const dedupeKey = buildDedupeKey(input.eventType, server?.id ?? input.serverId ?? null, planKey, now);
  if (await isAnnouncementDedupeBlocked(env, input.eventType, server?.id ?? input.serverId ?? null, planKey, now)) {
    return recordAnnouncementSkip(env, input, dedupeKey, "skipped_dedupe", "Announcement dedupe window is still active.");
  }

  const payload = buildAnnouncementPayload(env, {
    eventType: input.eventType,
    server,
    planKey,
    nowIso: now.toISOString(),
  });
  const botToken = cleanSecret(env.DISCORD_BOT_TOKEN);
  if (!botToken) {
    return recordAnnouncementFailure(env, input, dedupeKey, "failed", "Discord bot token is not configured.");
  }

  try {
    const delivery = await sendDiscordAnnouncement(botToken, channelId, payload);
    await upsertAnnouncementPost(env, {
      serverId: server?.id ?? input.serverId ?? null,
      eventType: input.eventType,
      channelId,
      messageId: delivery.messageId,
      threadId: null,
      dedupeKey,
      status: "sent",
      failureReason: null,
    });
    return { ok: true, sent: true, status: "sent", dedupeKey, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discord announcement send failed.";
    return recordAnnouncementFailure(env, input, dedupeKey, "failed", message);
  }
}

export function buildFreeListingEmbed(input: { server?: Partial<AnnouncementServerRow> | null; nowIso?: string }): DiscordMessagePayload {
  return buildAnnouncementPayload({}, { eventType: "new_server", server: input.server ?? null, planKey: "free", nowIso: input.nowIso ?? new Date().toISOString() });
}

export function buildProListingEmbed(input: { server?: Partial<AnnouncementServerRow> | null; nowIso?: string }): DiscordMessagePayload {
  return buildAnnouncementPayload({}, { eventType: "pro_showcase_thread", server: input.server ?? null, planKey: "pro", nowIso: input.nowIso ?? new Date().toISOString() });
}

export function buildBumpEmbed(input: { server?: Partial<AnnouncementServerRow> | null; planKey?: string | null; nowIso?: string }): DiscordMessagePayload {
  return buildAnnouncementPayload({}, { eventType: "server_bump", server: input.server ?? null, planKey: normalizePlanKey(input.planKey), nowIso: input.nowIso ?? new Date().toISOString() });
}

export function buildWeeklySpotlightEmbed(input: { server?: Partial<AnnouncementServerRow> | null; nowIso?: string }): DiscordMessagePayload {
  return buildAnnouncementPayload({}, { eventType: "weekly_spotlight", server: input.server ?? null, planKey: "pro", nowIso: input.nowIso ?? new Date().toISOString() });
}

export async function getDiscordAnnouncementHealth(env: Env): Promise<DiscordAnnouncementHealth> {
  const flags = readDznFeatureFlags(env);
  const db = requireDb(env);
  const tableReady = await tableExists(db, ANNOUNCEMENT_TABLE).catch(() => false);
  const [advertChannelConfigured, showcaseChannelConfigured] = await Promise.all([
    isAnnouncementChannelConfigured(env, "advert"),
    isAnnouncementChannelConfigured(env, "showcase"),
  ]);

  if (!tableReady) {
    return {
      featureEnabled: flags.discordServerAnnouncementsEnabled,
      advertChannelConfigured,
      showcaseChannelConfigured,
      botTokenConfigured: Boolean(cleanSecret(env.DISCORD_BOT_TOKEN)),
      lastServerAnnouncement: null,
      lastBumpPost: null,
      lastWeeklySpotlight: null,
      recentFailures: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const [lastServerAnnouncement, lastBumpPost, lastWeeklySpotlight, recentFailures] = await Promise.all([
    getLastAnnouncement(env, ["new_server", "pro_showcase_thread"]),
    getLastAnnouncement(env, ["server_bump"]),
    getLastAnnouncement(env, ["weekly_spotlight"]),
    getRecentAnnouncementFailures(env),
  ]);

  return {
    featureEnabled: flags.discordServerAnnouncementsEnabled,
    advertChannelConfigured,
    showcaseChannelConfigured,
    botTokenConfigured: Boolean(cleanSecret(env.DISCORD_BOT_TOKEN)),
    lastServerAnnouncement,
    lastBumpPost,
    lastWeeklySpotlight,
    recentFailures,
    generatedAt: new Date().toISOString(),
  };
}

export function validateDiscordInviteUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    if ((host === "discord.gg" || host === "www.discord.gg") && /^\/[a-zA-Z0-9-]{2,64}$/.test(path)) {
      return url.toString();
    }
    if ((host === "discord.com" || host === "www.discord.com") && /^\/invite\/[a-zA-Z0-9-]{2,64}$/.test(path)) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function sanitizeDiscordAnnouncementText(value: unknown, maxLength = 1024) {
  const stripped = stripDiscordMassMentions(typeof value === "string" ? value : "");
  return truncateDiscordText(stripped, maxLength);
}

function buildAnnouncementPayload(env: Partial<Env> | Record<string, unknown>, input: {
  eventType: DiscordAnnouncementEventType;
  server?: Partial<AnnouncementServerRow> | null;
  planKey?: string | null;
  nowIso: string;
}): DiscordMessagePayload {
  const server = input.server ?? null;
  const serverName = sanitizeDiscordAnnouncementText(server?.public_server_name ?? server?.server_name ?? "DZN Server", 180);
  const planKey = normalizePlanKey(input.planKey ?? server?.plan_key);
  const appUrl = getAppUrl(env);
  const profileUrl = profileUrlForServer(appUrl, server);
  const statsUrl = statsUrlForServer(appUrl, server);
  const advertiseUrl = `${appUrl}/dashboard`;
  const inviteUrl = validateDiscordInviteUrl(server?.public_discord_invite ?? null);
  const networkRank = typeof server?.network_rank === "number" && Number.isFinite(server.network_rank) ? `#${server.network_rank}` : "Pending";
  const players = typeof server?.current_player_count === "number" && typeof server?.max_player_count === "number"
    ? `${server.current_player_count} / ${server.max_player_count}`
    : "Stored stats only";

  const baseFields = [
    { name: "DZN Profile", value: profileUrl, inline: false },
    { name: "Network rank", value: networkRank, inline: true },
    { name: "Players", value: players, inline: true },
    {
      name: "Fairness rule",
      value: "Paid promotion does not affect leaderboard rank, review score, kill stats, K/D, crowns, season wins, or gameplay results.",
      inline: false,
    },
  ];

  const payloadByType: Record<DiscordAnnouncementEventType, { title: string; description: string; color: number; fields: typeof baseFields }> = {
    new_server: {
      title: `New server listed: ${serverName}`,
      description: sanitizeDiscordAnnouncementText(server?.public_short_description ?? server?.public_description ?? "A new DayZ server has joined DZN Network.", 360),
      color: planKey === "free" ? 0x22d3ee : 0xfacc15,
      fields: baseFields,
    },
    server_bump: {
      title: `Server bumped: ${serverName}`,
      description: sanitizeDiscordAnnouncementText("This server has refreshed its DZN listing. Edits do not create duplicate bump posts.", 360),
      color: planKey === "free" ? 0x38bdf8 : 0xfacc15,
      fields: baseFields,
    },
    pro_showcase_thread: {
      title: `Pro showcase: ${serverName}`,
      description: sanitizeDiscordAnnouncementText(server?.public_description ?? "A Pro/Premium DZN server showcase is ready.", 420),
      color: 0xfacc15,
      fields: [...baseFields, { name: "Showcase", value: "Pro server presentation. Gameplay scoring is unchanged.", inline: false }],
    },
    weekly_spotlight: {
      title: "Weekly DZN network spotlight",
      description: sanitizeDiscordAnnouncementText(server ? `${serverName} is this week's stored-data spotlight.` : "A weekly recap generated from stored DZN data.", 420),
      color: 0xa78bfa,
      fields: baseFields,
    },
  };

  const selected = payloadByType[input.eventType];
  return {
    username: "DZN Network",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: selected.title,
        description: selected.description,
        color: selected.color,
        fields: selected.fields.map((field) => ({
          name: sanitizeDiscordAnnouncementText(field.name, 256),
          value: sanitizeDiscordAnnouncementText(field.value, 1024) || "Unavailable",
          inline: field.inline,
        })),
        footer: { text: "DZN Network - server announcement system" },
        timestamp: input.nowIso,
      },
    ],
    components: buildAnnouncementButtons([
      { label: "View DZN Profile", url: profileUrl },
      { label: "View Stats / Leaderboard", url: statsUrl },
      { label: "Advertise Your Server", url: advertiseUrl },
      inviteUrl ? { label: "Join Server Discord", url: inviteUrl } : null,
    ]),
  };
}

function buildAnnouncementButtons(buttons: Array<{ label: string; url: string } | null>): DiscordMessagePayload["components"] {
  const components = buttons
    .filter((button): button is { label: string; url: string } => Boolean(button && isSafeButtonUrl(button.url)))
    .slice(0, 5)
    .map((button) => ({
      type: 2 as const,
      style: 5 as const,
      label: truncateDiscordText(button.label, 80),
      url: button.url,
    }));
  return components.length ? [{ type: 1, components }] : undefined;
}

async function sendDiscordAnnouncement(botToken: string, channelId: string, payload: DiscordMessagePayload) {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Discord announcement post failed with ${response.status}`);
  }
  const message = await response.json().catch(() => null) as { id?: string; thread?: { id?: string } } | null;
  return {
    messageId: typeof message?.id === "string" ? message.id : null,
    threadId: typeof message?.thread?.id === "string" ? message.thread.id : null,
  };
}

async function loadAnnouncementServer(env: Env, serverId: string) {
  return requireDb(env)
    .prepare(
      `SELECT
          linked_servers.id,
          linked_servers.server_name,
          linked_servers.public_slug,
          linked_servers.status,
          linked_servers.lifecycle_status,
          linked_servers.listing_visibility,
          linked_servers.public_short_description,
          linked_servers.public_description,
          linked_servers.public_discord_invite,
          linked_servers.public_website_url,
          server_public_cache.public_server_name,
          server_public_cache.current_player_count,
          server_public_cache.max_player_count,
          server_public_cache.network_rank,
          COALESCE(server_subscriptions.plan_key, 'free') AS plan_key,
          server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
       LEFT JOIN server_subscriptions ON server_subscriptions.linked_server_id = linked_servers.id
       WHERE linked_servers.id = ?
       LIMIT 1`,
    )
    .bind(serverId)
    .first<AnnouncementServerRow>();
}

async function resolveAnnouncementChannelId(env: Env, eventType: DiscordAnnouncementEventType) {
  const direct = eventType === "pro_showcase_thread" || eventType === "weekly_spotlight"
    ? cleanDiscordId(env.DZN_DISCORD_SHOWCASE_CHANNEL_ID) ?? cleanDiscordId(env.DZN_DISCORD_ADVERT_CHANNEL_ID)
    : cleanDiscordId(env.DZN_DISCORD_ADVERT_CHANNEL_ID);
  if (direct) return direct;

  const slot = eventType === "pro_showcase_thread" || eventType === "weekly_spotlight" ? "announcements" : "server-updates";
  return getChannelMappingId(env, slot);
}

async function isAnnouncementChannelConfigured(env: Env, kind: "advert" | "showcase") {
  if (kind === "advert" && cleanDiscordId(env.DZN_DISCORD_ADVERT_CHANNEL_ID)) return true;
  if (kind === "showcase" && cleanDiscordId(env.DZN_DISCORD_SHOWCASE_CHANNEL_ID)) return true;
  const fallbackSlot = kind === "advert" ? "server-updates" : "announcements";
  return Boolean(await getChannelMappingId(env, fallbackSlot));
}

async function getChannelMappingId(env: Env, slot: string) {
  const db = requireDb(env);
  if (!(await tableExists(db, "discord_channel_mappings").catch(() => false))) return null;
  const row = await db
    .prepare("SELECT channel_id FROM discord_channel_mappings WHERE slot = ? AND enabled = 1 LIMIT 1")
    .bind(slot)
    .first<{ channel_id: string | null }>();
  return cleanDiscordId(row?.channel_id);
}

function buildDedupeKey(eventType: DiscordAnnouncementEventType, serverId: string | null | undefined, planKey: string | null | undefined, now: Date) {
  if (eventType === "new_server") return `new_server:${serverId ?? "network"}`;
  if (eventType === "pro_showcase_thread") return `pro_showcase_thread:${serverId ?? "network"}`;
  if (eventType === "weekly_spotlight") return `weekly_spotlight:${weekBucket(now)}`;
  const cooldownDays = normalizePlanKey(planKey) === "free" ? FREE_BUMP_COOLDOWN_DAYS : PRO_BUMP_COOLDOWN_DAYS;
  const bucket = Math.floor(now.getTime() / (cooldownDays * 24 * 60 * 60 * 1000));
  return `server_bump:${serverId ?? "network"}:${cooldownDays}d:${bucket}`;
}

async function isAnnouncementDedupeBlocked(env: Env, eventType: DiscordAnnouncementEventType, serverId: string | null | undefined, planKey: string | null | undefined, now: Date) {
  const db = requireDb(env);
  if (eventType === "new_server" || eventType === "pro_showcase_thread") {
    const row = await db
      .prepare(`SELECT id FROM ${ANNOUNCEMENT_TABLE} WHERE dedupe_key = ? AND status = 'sent' LIMIT 1`)
      .bind(buildDedupeKey(eventType, serverId, planKey, now))
      .first<{ id: string }>();
    return Boolean(row);
  }
  if (eventType === "weekly_spotlight") {
    const row = await db
      .prepare(`SELECT id FROM ${ANNOUNCEMENT_TABLE} WHERE dedupe_key = ? AND status = 'sent' LIMIT 1`)
      .bind(buildDedupeKey(eventType, serverId, planKey, now))
      .first<{ id: string }>();
    return Boolean(row);
  }
  const cooldownDays = normalizePlanKey(planKey) === "free" ? FREE_BUMP_COOLDOWN_DAYS : PRO_BUMP_COOLDOWN_DAYS;
  const since = new Date(now.getTime() - cooldownDays * 24 * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      `SELECT id FROM ${ANNOUNCEMENT_TABLE}
       WHERE server_id = ?
         AND event_type = 'server_bump'
         AND status = 'sent'
         AND datetime(created_at) >= datetime(?)
       LIMIT 1`,
    )
    .bind(serverId ?? "", since)
    .first<{ id: string }>();
  return Boolean(row);
}

function isHiddenOrArchivedServer(server: AnnouncementServerRow) {
  const status = String(server.status ?? "").toLowerCase();
  const lifecycle = String(server.lifecycle_status ?? "active_live").toLowerCase();
  const visibility = String(server.listing_visibility ?? "public").toLowerCase();
  return visibility === "hidden" || lifecycle === "archived_hidden" || status === "archived" || status === "deleted" || status === "merged";
}

async function recordAnnouncementSkip(
  env: Env,
  input: AnnouncementInput,
  dedupeKey: string,
  status: Exclude<DiscordAnnouncementStatus, "sent" | "failed" | "skipped_feature_disabled" | "skipped_missing_table">,
  reason: string,
): Promise<DiscordAnnouncementResult> {
  await upsertAnnouncementPost(env, {
    serverId: input.serverId ?? null,
    eventType: input.eventType,
    channelId: null,
    messageId: null,
    threadId: null,
    dedupeKey,
    status,
    failureReason: reason,
  });
  return { ok: true, sent: false, status, dedupeKey, reason };
}

async function recordAnnouncementFailure(
  env: Env,
  input: AnnouncementInput,
  dedupeKey: string | null,
  status: "failed",
  reason: string,
): Promise<DiscordAnnouncementResult> {
  const resolvedDedupeKey = dedupeKey ?? `${input.eventType}:${input.serverId ?? "network"}:failed:${Date.now()}`;
  await upsertAnnouncementPost(env, {
    serverId: input.serverId ?? null,
    eventType: input.eventType,
    channelId: null,
    messageId: null,
    threadId: null,
    dedupeKey: resolvedDedupeKey,
    status,
    failureReason: reason,
  });
  return { ok: false, sent: false, status, dedupeKey: resolvedDedupeKey, reason };
}

async function upsertAnnouncementPost(env: Env, input: {
  serverId: string | null;
  eventType: string;
  channelId: string | null;
  messageId: string | null;
  threadId: string | null;
  dedupeKey: string;
  status: string;
  failureReason: string | null;
}) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO ${ANNOUNCEMENT_TABLE} (
        id, server_id, event_type, channel_id, message_id, thread_id, dedupe_key,
        status, failure_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        channel_id = excluded.channel_id,
        message_id = COALESCE(excluded.message_id, discord_announcement_posts.message_id),
        thread_id = COALESCE(excluded.thread_id, discord_announcement_posts.thread_id),
        status = excluded.status,
        failure_reason = excluded.failure_reason,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.serverId,
      input.eventType,
      input.channelId,
      input.messageId,
      input.threadId,
      input.dedupeKey,
      input.status,
      truncateDiscordText(input.failureReason ?? "", 500) || null,
      now,
      now,
    )
    .run();
}

async function getLastAnnouncement(env: Env, eventTypes: string[]) {
  const placeholders = eventTypes.map(() => "?").join(", ");
  const row = await requireDb(env)
    .prepare(
      `SELECT id, server_id, event_type, channel_id, status, failure_reason, created_at, updated_at
       FROM ${ANNOUNCEMENT_TABLE}
       WHERE event_type IN (${placeholders})
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`,
    )
    .bind(...eventTypes)
    .first<AnnouncementPostRow>();
  return row ? toAnnouncementSummary(row) : null;
}

async function getRecentAnnouncementFailures(env: Env) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT id, server_id, event_type, channel_id, status, failure_reason, created_at, updated_at
       FROM ${ANNOUNCEMENT_TABLE}
       WHERE status = 'failed'
       ORDER BY datetime(updated_at) DESC
       LIMIT 5`,
    )
    .all<AnnouncementPostRow>();
  return (rows.results ?? []).map(toAnnouncementSummary);
}

function toAnnouncementSummary(row: AnnouncementPostRow): DiscordAnnouncementSummary {
  return {
    id: row.id,
    serverId: row.server_id ?? null,
    eventType: row.event_type,
    channelConfigured: Boolean(row.channel_id),
    status: row.status,
    failureReason: row.failure_reason ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function skipped(status: DiscordAnnouncementStatus, dedupeKey: string | null, reason: string): DiscordAnnouncementResult {
  return { ok: true, sent: false, status, dedupeKey, reason };
}

async function tableExists(db: D1Database, name: string) {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .bind(name)
    .first<{ name: string }>();
  return Boolean(row?.name);
}

function profileUrlForServer(appUrl: string, server?: Partial<AnnouncementServerRow> | null) {
  const slug = typeof server?.public_slug === "string" && server.public_slug.trim() ? server.public_slug.trim() : null;
  return slug ? `${appUrl}/servers/${encodeURIComponent(slug)}` : `${appUrl}/servers`;
}

function statsUrlForServer(appUrl: string, server?: Partial<AnnouncementServerRow> | null) {
  const slug = typeof server?.public_slug === "string" && server.public_slug.trim() ? server.public_slug.trim() : null;
  return slug ? `${appUrl}/servers/${encodeURIComponent(slug)}#stats` : `${appUrl}/api/public/leaderboards`;
}

function isSafeButtonUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function getAppUrl(env: Partial<Env> | Record<string, unknown>) {
  const raw = typeof env.DZN_APP_URL === "string" && env.DZN_APP_URL.trim()
    ? env.DZN_APP_URL
    : typeof env.NEXT_PUBLIC_APP_URL === "string" && env.NEXT_PUBLIC_APP_URL.trim()
      ? env.NEXT_PUBLIC_APP_URL
      : "https://dzn-network.pages.dev";
  return raw.replace(/\/+$/, "");
}

function stripDiscordMassMentions(value: string) {
  return value.replace(/@everyone/gi, "everyone").replace(/@here/gi, "here");
}

function truncateDiscordText(value: string, maxLength: number) {
  const cleaned = value.replace(/\0/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function cleanSecret(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function cleanDiscordId(value: unknown) {
  return typeof value === "string" && /^\d{8,32}$/.test(value.trim()) ? value.trim() : null;
}

function normalizePlanKey(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "network" || normalized === "partner") return "premium";
  if (normalized === "pro" || normalized === "premium" || normalized === "starter") return normalized;
  return "free";
}

function weekBucket(now: Date) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
