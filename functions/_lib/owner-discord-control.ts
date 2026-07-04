import { readDznFeatureFlags } from "./feature-flags";
import type { Env } from "./types";

export type OwnerDiscordPostingMode = "disabled" | "preview_only" | "production_disabled" | "ready_but_off";

export type OwnerDiscordOverview = {
  integrationStatus: string;
  botConfigured: boolean;
  botTokenPresent: boolean;
  discordPulseDeliveryEnabled: boolean;
  discordNotificationsEnabled: boolean;
  connectedGuildCount: number | null;
  configuredChannelCount: number | null;
  lastPostAttempt: {
    postType: string | null;
    guildId: string | null;
    channelId: string | null;
    status: string | null;
    attemptedAt: string | null;
    error: string | null;
  } | null;
  postingMode: OwnerDiscordPostingMode;
  generatedAt: string;
};

export type OwnerDiscordPostType = {
  key: string;
  label: string;
  enabled: boolean;
  productionSendingDisabled: boolean;
  previewAvailable: boolean;
  channelTarget: string | null;
  channelConfigured: boolean;
  lastGeneratedPreview: string | null;
  requiredDataSource: string;
};

export type OwnerDiscordChannelSlot = {
  slot: string;
  label: string;
  status: "not_configured" | "configured" | "missing_permission" | "disabled" | "preview_only";
  channelId: string | null;
  guildId: string | null;
  mappedPostTypes: string[];
  webhookConfigured: boolean;
};

export type OwnerDiscordTemplate = {
  type: OwnerDiscordPreviewType;
  label: string;
  description: string;
  preview: OwnerDiscordPreviewEmbed;
};

export type OwnerDiscordPreviewType =
  | "new_server"
  | "top_server"
  | "legacy_server"
  | "archived_server"
  | "server_wars_event"
  | "weekly_recap";

export type OwnerDiscordPreviewEmbed = {
  type: OwnerDiscordPreviewType;
  title: string;
  description: string;
  colorHex: string;
  thumbnailUrl: string | null;
  bannerUrl: string | null;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  footer: string;
  timestamp: string;
  cta: { label: string; url: string } | null;
  previewOnly: true;
  sent: false;
};

type StoredDestination = {
  guild_id?: unknown;
  post_type?: unknown;
  discord_channel_id?: unknown;
  discord_webhook_url?: unknown;
  enabled?: unknown;
  required_feature?: unknown;
  min_plan_key?: unknown;
  updated_at?: unknown;
};

type StoredPostState = {
  guild_id?: unknown;
  post_type?: unknown;
  discord_channel_id?: unknown;
  last_posted_at?: unknown;
  last_edited_at?: unknown;
  last_error?: unknown;
  updated_at?: unknown;
};

const POST_TYPES: Array<{ key: string; label: string; requiredDataSource: string }> = [
  { key: "new_server_added", label: "New server added", requiredDataSource: "linked_servers, server_public_cache" },
  { key: "server_went_live", label: "Server went live", requiredDataSource: "server_sync_state" },
  { key: "server_went_offline", label: "Server went offline", requiredDataSource: "server_sync_state" },
  { key: "server_token_needs_resave", label: "Server token needs re-save", requiredDataSource: "server lifecycle state" },
  { key: "legacy_offline_preserved", label: "Legacy/offline server preserved", requiredDataSource: "server lifecycle state" },
  { key: "server_archived_hidden", label: "Server archived/hidden", requiredDataSource: "server lifecycle state" },
  { key: "top_server_update", label: "Top server update", requiredDataSource: "public leaderboards" },
  { key: "longest_kill_update", label: "Longest kill update", requiredDataSource: "ADM kill events" },
  { key: "daily_network_recap", label: "Daily network recap", requiredDataSource: "stored network stats" },
  { key: "weekly_network_recap", label: "Weekly network recap", requiredDataSource: "stored network stats" },
  { key: "server_wars_event_created", label: "Server Wars event created", requiredDataSource: "server wars events" },
  { key: "server_wars_result", label: "Server Wars result", requiredDataSource: "server wars results" },
  { key: "challenge_created", label: "Challenge created", requiredDataSource: "challenge events" },
  { key: "tournament_created", label: "Tournament created", requiredDataSource: "tournament events" },
  { key: "milestone_reached", label: "Milestone reached", requiredDataSource: "stored achievement stats" },
  { key: "dzn_announcement", label: "DZN announcement", requiredDataSource: "owner-authored announcement" },
  { key: "package_promotion", label: "Free/Pro/Premium promotion post", requiredDataSource: "billing package metadata" },
];

const CHANNEL_SLOTS: Array<{ slot: string; label: string; postTypes: string[] }> = [
  { slot: "announcements", label: "Announcements", postTypes: ["new_server_added", "dzn_announcement", "package_promotion"] },
  { slot: "server-updates", label: "Server updates", postTypes: ["server_went_live", "server_went_offline", "server_token_needs_resave", "legacy_offline_preserved", "server_archived_hidden"] },
  { slot: "leaderboard-updates", label: "Leaderboard updates", postTypes: ["top_server_update", "longest_kill_update"] },
  { slot: "server-wars", label: "Server Wars", postTypes: ["server_wars_event_created", "server_wars_result"] },
  { slot: "challenges", label: "Challenges", postTypes: ["challenge_created"] },
  { slot: "tournaments", label: "Tournaments", postTypes: ["tournament_created"] },
  { slot: "admin-alerts", label: "Admin alerts", postTypes: ["server_token_needs_resave", "server_archived_hidden"] },
  { slot: "owner-alerts", label: "Owner alerts", postTypes: ["legacy_offline_preserved", "milestone_reached"] },
  { slot: "audit-log", label: "Audit log", postTypes: ["server_archived_hidden", "dzn_announcement"] },
];

export async function getOwnerDiscordOverview(env: Env): Promise<OwnerDiscordOverview> {
  const flags = readDznFeatureFlags(env);
  const botTokenPresent = stringOrNull(env.DISCORD_BOT_TOKEN)?.length ? true : false;
  const [connectedGuildCount, configuredChannelCount, lastPostAttempt] = await Promise.all([
    countRows(env, "discord_guilds"),
    countRows(env, "server_posting_destinations"),
    getLastStoredPostAttempt(env),
  ]);

  return {
    integrationStatus: botTokenPresent ? "configured_preview_only" : "not_configured",
    botConfigured: botTokenPresent,
    botTokenPresent,
    discordPulseDeliveryEnabled: flags.discordNotificationsEnabled,
    discordNotificationsEnabled: flags.discordNotificationsEnabled,
    connectedGuildCount,
    configuredChannelCount,
    lastPostAttempt,
    postingMode: getPostingMode(botTokenPresent, flags.discordNotificationsEnabled),
    generatedAt: new Date().toISOString(),
  };
}

export async function getOwnerDiscordPostTypes(env: Env): Promise<OwnerDiscordPostType[]> {
  const destinations = await getStoredDestinations(env);
  const destinationByPostType = new Map(destinations.map((destination) => [stringOrNull(destination.post_type), destination]));

  return POST_TYPES.map((postType) => {
    const destination = destinationByPostType.get(postType.key) ?? null;
    const enabled = truthy(destination?.enabled);
    return {
      key: postType.key,
      label: postType.label,
      enabled,
      productionSendingDisabled: true,
      previewAvailable: true,
      channelTarget: stringOrNull(destination?.discord_channel_id),
      channelConfigured: Boolean(stringOrNull(destination?.discord_channel_id)),
      lastGeneratedPreview: null,
      requiredDataSource: postType.requiredDataSource,
    };
  });
}

export async function getOwnerDiscordChannels(env: Env): Promise<OwnerDiscordChannelSlot[]> {
  const destinations = await getStoredDestinations(env);

  return CHANNEL_SLOTS.map((slot) => {
    const matching = destinations.find((destination) => slot.postTypes.includes(stringOrNull(destination.post_type) ?? ""));
    const enabled = truthy(matching?.enabled);
    const channelId = stringOrNull(matching?.discord_channel_id);
    return {
      slot: slot.slot,
      label: slot.label,
      status: channelId ? (enabled ? "configured" : "disabled") : "not_configured",
      channelId,
      guildId: stringOrNull(matching?.guild_id),
      mappedPostTypes: slot.postTypes,
      webhookConfigured: Boolean(stringOrNull(matching?.discord_webhook_url)),
    };
  });
}

export async function getOwnerDiscordTemplates(env: Env): Promise<OwnerDiscordTemplate[]> {
  return (["new_server", "top_server", "legacy_server", "archived_server", "server_wars_event", "weekly_recap"] as const).map((type) => ({
    type,
    label: getPreviewTypeLabel(type),
    description: getPreviewTypeDescription(type),
    preview: buildOwnerDiscordPreviewEmbed(env, { type }),
  }));
}

export function buildOwnerDiscordPreviewEmbed(
  _env: Partial<Env> | Record<string, unknown>,
  input: { type?: unknown; title?: unknown; description?: unknown; colorHex?: unknown } = {},
): OwnerDiscordPreviewEmbed {
  const type = normalizePreviewType(input.type);
  const base = getPreviewBase(type);
  const customTitle = safeText(input.title, 120);
  const customDescription = safeText(input.description, 500);
  const customColor = safeColorHex(input.colorHex);

  return {
    ...base,
    title: customTitle ?? base.title,
    description: customDescription ?? base.description,
    colorHex: customColor ?? base.colorHex,
    timestamp: new Date().toISOString(),
    previewOnly: true,
    sent: false,
  };
}

function getPostingMode(botTokenPresent: boolean, discordNotificationsEnabled: boolean): OwnerDiscordPostingMode {
  if (discordNotificationsEnabled) return "ready_but_off";
  if (botTokenPresent) return "production_disabled";
  return "disabled";
}

async function countRows(env: Env, tableName: string): Promise<number | null> {
  try {
    if (!(await tableExists(env, tableName))) return null;
    const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{ count?: number }>();
    return Number(row?.count ?? 0);
  } catch {
    return null;
  }
}

async function getStoredDestinations(env: Env): Promise<StoredDestination[]> {
  try {
    if (!(await tableExists(env, "server_posting_destinations"))) return [];
    const result = await env.DB.prepare(
      `SELECT guild_id, post_type, discord_channel_id, discord_webhook_url, enabled, required_feature, min_plan_key, updated_at
       FROM server_posting_destinations
       ORDER BY updated_at DESC
       LIMIT 100`,
    ).all<StoredDestination>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

async function getLastStoredPostAttempt(env: Env): Promise<OwnerDiscordOverview["lastPostAttempt"]> {
  try {
    if (!(await tableExists(env, "server_posting_state"))) return null;
    const row = await env.DB.prepare(
      `SELECT guild_id, post_type, discord_channel_id, last_posted_at, last_edited_at, last_error, updated_at
       FROM server_posting_state
       ORDER BY COALESCE(last_edited_at, last_posted_at, updated_at) DESC
       LIMIT 1`,
    ).first<StoredPostState>();
    if (!row) return null;
    return {
      postType: stringOrNull(row.post_type),
      guildId: stringOrNull(row.guild_id),
      channelId: stringOrNull(row.discord_channel_id),
      status: stringOrNull(row.last_error) ? "error" : "stored",
      attemptedAt: stringOrNull(row.last_edited_at) ?? stringOrNull(row.last_posted_at) ?? stringOrNull(row.updated_at),
      error: safeText(row.last_error, 180),
    };
  } catch {
    return null;
  }
}

async function tableExists(env: Env, tableName: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").bind(tableName).first<{ name?: string }>();
  return row?.name === tableName;
}

function getPreviewBase(type: OwnerDiscordPreviewType): Omit<OwnerDiscordPreviewEmbed, "timestamp" | "previewOnly" | "sent"> {
  if (type === "new_server") {
    return {
      type,
      title: "New server joined DZN",
      description: "A new DayZ server listing is ready for discovery on DZN Network.",
      colorHex: "#22d3ee",
      thumbnailUrl: null,
      bannerUrl: null,
      fields: [
        { name: "Server", value: "Fresh DZN Beta Listing", inline: true },
        { name: "Package", value: "Free Listing", inline: true },
        { name: "Status", value: "Public profile created", inline: false },
      ],
      footer: "Preview only - not sent",
      cta: { label: "View Listing", url: "https://dzn-network.pages.dev/servers" },
    };
  }
  if (type === "top_server") {
    return {
      type,
      title: "NukeTown top server update",
      description: "NukeTown is currently leading the live server snapshot based on stored DZN data.",
      colorHex: "#34d399",
      thumbnailUrl: null,
      bannerUrl: null,
      fields: [
        { name: "Server", value: "NukeTown DEATHMATCH", inline: true },
        { name: "Players", value: "Stored live count shown in DZN", inline: true },
        { name: "Fairness", value: "No paid rank, K/D, score or review advantage.", inline: false },
      ],
      footer: "Preview only - not sent",
      cta: { label: "View Server", url: "https://dzn-network.pages.dev/servers" },
    };
  }
  if (type === "legacy_server") {
    return {
      type,
      title: "PANDORA legacy history preserved",
      description: "Live sync can stop for an offline server while historical tracking remains readable.",
      colorHex: "#a78bfa",
      thumbnailUrl: null,
      bannerUrl: null,
      fields: [
        { name: "Lifecycle", value: "Legacy / Offline", inline: true },
        { name: "Sync", value: "Recurring live sync stopped", inline: true },
        { name: "History", value: "Historical stats and build tracking remain preserved.", inline: false },
      ],
      footer: "Preview only - not sent",
      cta: { label: "View History", url: "https://dzn-network.pages.dev/servers" },
    };
  }
  if (type === "archived_server") {
    return {
      type,
      title: "Warlords archived/hidden internal notice",
      description: "A fake or test listing can stay archived internally without consuming active sync resources.",
      colorHex: "#f59e0b",
      thumbnailUrl: null,
      bannerUrl: null,
      fields: [
        { name: "Lifecycle", value: "Archived / Hidden", inline: true },
        { name: "Public surfaces", value: "Excluded", inline: true },
        { name: "Data", value: "Rows remain preserved. No destructive cleanup is performed.", inline: false },
      ],
      footer: "Preview only - not sent",
      cta: null,
    };
  }
  if (type === "server_wars_event") {
    return {
      type,
      title: "Server Wars event promo",
      description: "A competitive DZN Server Wars event is ready for public promotion.",
      colorHex: "#fb7185",
      thumbnailUrl: null,
      bannerUrl: null,
      fields: [
        { name: "Event", value: "Weekend Territory Clash", inline: true },
        { name: "Eligibility", value: "Active live servers only", inline: true },
        { name: "Scoring", value: "Uses existing Server Wars rules. No scoring changes.", inline: false },
      ],
      footer: "Preview only - not sent",
      cta: { label: "View Event", url: "https://dzn-network.pages.dev/server-wars" },
    };
  }
  return {
    type,
    title: "Weekly DZN network recap",
    description: "A compact weekly recap of DZN Network activity generated from stored public data.",
    colorHex: "#38bdf8",
    thumbnailUrl: null,
    bannerUrl: null,
    fields: [
      { name: "Servers", value: "Active and legacy states summarized separately", inline: true },
      { name: "Highlights", value: "Top servers, longest kills and milestones", inline: true },
      { name: "Safety", value: "Preview only while production Discord delivery is disabled.", inline: false },
    ],
    footer: "Preview only - not sent",
    cta: { label: "Open DZN", url: "https://dzn-network.pages.dev" },
  };
}

function getPreviewTypeLabel(type: OwnerDiscordPreviewType) {
  const labels: Record<OwnerDiscordPreviewType, string> = {
    new_server: "New server joined DZN",
    top_server: "NukeTown top server update",
    legacy_server: "PANDORA legacy/offline history preserved",
    archived_server: "Warlords archived/hidden internal notice",
    server_wars_event: "Server Wars event promo",
    weekly_recap: "Weekly DZN network recap",
  };
  return labels[type];
}

function getPreviewTypeDescription(type: OwnerDiscordPreviewType) {
  const descriptions: Record<OwnerDiscordPreviewType, string> = {
    new_server: "A public listing announcement generated from stored server data.",
    top_server: "A leaderboard-style preview that does not alter ranking, score or stats.",
    legacy_server: "A lifecycle notice showing preserved history without active sync.",
    archived_server: "An internal safety notice for archived fake/test listings.",
    server_wars_event: "A promotional event embed using existing Server Wars data only.",
    weekly_recap: "A network recap template for future scheduled posting.",
  };
  return descriptions[type];
}

function normalizePreviewType(value: unknown): OwnerDiscordPreviewType {
  const normalized = stringOrNull(value);
  if (
    normalized === "new_server" ||
    normalized === "top_server" ||
    normalized === "legacy_server" ||
    normalized === "archived_server" ||
    normalized === "server_wars_event" ||
    normalized === "weekly_recap"
  ) {
    return normalized;
  }
  return "weekly_recap";
}

function safeText(value: unknown, maxLength: number) {
  const text = stringOrNull(value);
  if (!text) return null;
  return text
    .replace(/[A-Za-z0-9+/=]{32,}/g, "[redacted]")
    .replace(/(token|secret|key|webhook)=\S+/gi, "$1=[redacted]")
    .slice(0, maxLength);
}

function safeColorHex(value: unknown) {
  const text = stringOrNull(value);
  if (!text) return null;
  return /^#[0-9a-f]{6}$/i.test(text) ? text : null;
}

function stringOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function truthy(value: unknown) {
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
