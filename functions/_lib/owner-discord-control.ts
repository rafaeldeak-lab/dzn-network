import { checkDiscordPostingPermissions, verifyDiscordPostingChannel } from "./discord-posting";
import { getDiscordAnnouncementHealth, type DiscordAnnouncementHealth } from "./discord-server-announcements";
import { readDznFeatureFlags } from "./feature-flags";
import { requireDb } from "./db";
import type { Env, SessionUser } from "./types";

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
  serverAnnouncements: DiscordAnnouncementHealth;
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
  channelName: string | null;
  guildId: string | null;
  guildName: string | null;
  mappedPostTypes: string[];
  webhookConfigured: boolean;
  lastPermissionCheckedAt: string | null;
  lastPermissionStatus: string | null;
  lastPermissionError: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
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
  | "weekly_recap"
  | "daily_recap"
  | "longest_kill"
  | "milestone"
  | "dzn_announcement"
  | "package_promotion";

export type OwnerDiscordPreviewOption = {
  type: OwnerDiscordPreviewType;
  label: string;
  description: string;
  networkWide: boolean;
  suggestedSlot: string;
};

export type OwnerDiscordLinkedServerOption = {
  value: string;
  label: string;
  slug: string | null;
  lifecycleStatus: string | null;
  lifecycleLabel: string;
  status: string | null;
  role: "network" | "nuketown" | "pandora" | "warlords" | "server";
};

export type OwnerDiscordOptions = {
  postTypes: OwnerDiscordPreviewOption[];
  linkedServers: OwnerDiscordLinkedServerOption[];
  destinationSlots: OwnerDiscordChannelSlot[];
};

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

export type OwnerDiscordPermissionCheck = {
  ok: boolean;
  status: "ok" | "missing_permissions" | "not_configured" | "discord_error";
  checkedAt: string;
  mode: string;
  canViewChannel: boolean;
  canSendMessages: boolean;
  canEmbedLinks: boolean;
  canReadMessageHistory: boolean;
  canAttachFiles: boolean | null;
  missingPermissions: string[];
  warning: string | null;
  channelName: string | null;
  permissionSource: string | null;
};

export type OwnerDiscordChannelMapping = OwnerDiscordChannelSlot & {
  enabled: boolean;
  permissionCheck: OwnerDiscordPermissionCheck | null;
};

export type OwnerDiscordAuditLogEntry = {
  id: string;
  actorDiscordId: string | null;
  action: string;
  targetType: string | null;
  targetSlot: string | null;
  guildId: string | null;
  channelId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  result: string;
  reason: string | null;
  requestId: string | null;
  createdAt: string | null;
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

type StoredChannelMapping = {
  id: string;
  slot: string;
  guild_id: string;
  guild_name: string | null;
  channel_id: string;
  channel_name: string | null;
  enabled: number | null;
  last_permission_status: string | null;
  last_permission_checked_at: string | null;
  last_permission_error: string | null;
  last_permission_json: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoredAuditRow = {
  id: string;
  actor_user_id: string | null;
  actor_discord_id: string | null;
  action: string;
  target_type: string | null;
  target_slot: string | null;
  guild_id: string | null;
  channel_id: string | null;
  before_json: string | null;
  after_json: string | null;
  result: string;
  reason: string | null;
  request_id: string | null;
  created_at: string | null;
};

type StoredLinkedServerOptionRow = {
  id: string;
  server_name: string | null;
  public_slug: string | null;
  status: string | null;
  lifecycle_status: string | null;
  nitrado_service_id: string | null;
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

export const OWNER_DISCORD_CHANNEL_SLOTS: Array<{ slot: string; label: string; postTypes: string[] }> = [
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

export const OWNER_DISCORD_PREVIEW_OPTIONS: OwnerDiscordPreviewOption[] = [
  { type: "new_server", label: "New server joined DZN", description: "Announce a newly listed DZN server.", networkWide: false, suggestedSlot: "announcements" },
  { type: "top_server", label: "Top server update", description: "Preview a stored leaderboard or server highlight.", networkWide: false, suggestedSlot: "leaderboard-updates" },
  { type: "legacy_server", label: "PANDORA legacy/offline history preserved", description: "Explain that historical stats remain visible after live sync stops.", networkWide: false, suggestedSlot: "server-updates" },
  { type: "archived_server", label: "Warlords archived/hidden internal notice", description: "Internal owner notice for hidden fake/test data.", networkWide: false, suggestedSlot: "admin-alerts" },
  { type: "server_wars_event", label: "Server Wars event promo", description: "Preview an event promo without changing Server Wars scoring.", networkWide: true, suggestedSlot: "server-wars" },
  { type: "weekly_recap", label: "Weekly DZN network recap", description: "Network-wide weekly recap generated from stored public data.", networkWide: true, suggestedSlot: "announcements" },
  { type: "daily_recap", label: "Daily network recap", description: "Network-wide daily snapshot generated from stored public data.", networkWide: true, suggestedSlot: "announcements" },
  { type: "longest_kill", label: "Longest kill update", description: "Highlight a stored longest-kill stat without changing scoring.", networkWide: false, suggestedSlot: "leaderboard-updates" },
  { type: "milestone", label: "Milestone reached", description: "Preview a server or network milestone announcement.", networkWide: false, suggestedSlot: "owner-alerts" },
  { type: "dzn_announcement", label: "DZN announcement", description: "Owner-authored DZN network announcement preview.", networkWide: true, suggestedSlot: "announcements" },
  { type: "package_promotion", label: "Free/Pro/Premium promotion post", description: "Preview package messaging while auto posting stays disabled.", networkWide: true, suggestedSlot: "announcements" },
];

export async function getOwnerDiscordOverview(env: Env): Promise<OwnerDiscordOverview> {
  const flags = readDznFeatureFlags(env);
  const botTokenPresent = stringOrNull(env.DISCORD_BOT_TOKEN)?.length ? true : false;
  const [connectedGuildCount, configuredChannelCount, lastPostAttempt, serverAnnouncements] = await Promise.all([
    countRows(env, "discord_guilds"),
    countConfiguredOwnerChannels(env),
    getLastStoredPostAttempt(env),
    getDiscordAnnouncementHealth(env),
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
    serverAnnouncements,
    postingMode: getPostingMode(botTokenPresent, flags.discordNotificationsEnabled),
    generatedAt: new Date().toISOString(),
  };
}

export async function getOwnerDiscordPostTypes(env: Env): Promise<OwnerDiscordPostType[]> {
  const [destinations, mappings] = await Promise.all([getStoredDestinations(env), getStoredChannelMappings(env)]);
  const destinationByPostType = new Map(destinations.map((destination) => [stringOrNull(destination.post_type), destination]));
  const channelBySlot = new Map(mappings.map((mapping) => [mapping.slot, mapping]));

  return POST_TYPES.map((postType) => {
    const destination = destinationByPostType.get(postType.key) ?? null;
    const mappedSlot = OWNER_DISCORD_CHANNEL_SLOTS.find((slot) => slot.postTypes.includes(postType.key));
    const mapping = mappedSlot ? channelBySlot.get(mappedSlot.slot) ?? null : null;
    const channelTarget = stringOrNull(destination?.discord_channel_id) ?? mapping?.channel_id ?? null;
    const channelConfigured = Boolean(channelTarget);
    return {
      key: postType.key,
      label: postType.label,
      enabled: false,
      productionSendingDisabled: true,
      previewAvailable: true,
      channelTarget,
      channelConfigured,
      lastGeneratedPreview: null,
      requiredDataSource: postType.requiredDataSource,
    };
  });
}

export async function getOwnerDiscordChannels(env: Env): Promise<OwnerDiscordChannelSlot[]> {
  const mappings = await getStoredChannelMappings(env);
  const mappingBySlot = new Map(mappings.map((mapping) => [mapping.slot, mapping]));
  const legacyDestinations = await getStoredDestinations(env);

  return OWNER_DISCORD_CHANNEL_SLOTS.map((slot) => {
    const mapping = mappingBySlot.get(slot.slot) ?? null;
    if (mapping) return toChannelSlot(slot, mapping);

    const matching = legacyDestinations.find((destination) => slot.postTypes.includes(stringOrNull(destination.post_type) ?? ""));
    const enabled = truthy(matching?.enabled);
    const channelId = stringOrNull(matching?.discord_channel_id);
    return {
      slot: slot.slot,
      label: slot.label,
      status: channelId ? (enabled ? "preview_only" : "disabled") : "not_configured",
      channelId,
      channelName: null,
      guildId: stringOrNull(matching?.guild_id),
      guildName: null,
      mappedPostTypes: slot.postTypes,
      webhookConfigured: Boolean(stringOrNull(matching?.discord_webhook_url)),
      lastPermissionCheckedAt: null,
      lastPermissionStatus: null,
      lastPermissionError: null,
      updatedBy: null,
      updatedAt: stringOrNull(matching?.updated_at),
    };
  });
}

export async function getOwnerDiscordChannelMappings(env: Env): Promise<OwnerDiscordChannelMapping[]> {
  const slots = await getOwnerDiscordChannels(env);
  return slots.map((slot) => ({
    ...slot,
    enabled: slot.status !== "disabled" && slot.status !== "not_configured",
    permissionCheck: parsePermissionJsonForApi((slot as OwnerDiscordChannelSlot & { lastPermissionJson?: string | null }).lastPermissionJson ?? null),
  }));
}

export async function getOwnerDiscordTemplates(env: Env): Promise<OwnerDiscordTemplate[]> {
  return OWNER_DISCORD_PREVIEW_OPTIONS.map((option) => ({
    type: option.type,
    label: option.label,
    description: option.description,
    preview: buildOwnerDiscordPreviewEmbed(env, { type: option.type }),
  }));
}

export async function getOwnerDiscordOptions(env: Env): Promise<OwnerDiscordOptions> {
  const [destinationSlots, linkedServers] = await Promise.all([
    getOwnerDiscordChannels(env),
    getOwnerDiscordLinkedServerOptions(env),
  ]);
  return {
    postTypes: OWNER_DISCORD_PREVIEW_OPTIONS,
    linkedServers,
    destinationSlots,
  };
}

export async function saveOwnerDiscordChannelMapping(env: Env, user: SessionUser, input: {
  slot?: unknown;
  guildId?: unknown;
  guildName?: unknown;
  channelId?: unknown;
  channelName?: unknown;
  reason?: unknown;
  requestId?: unknown;
}) {
  await ensureOwnerDiscordControlSchema(env);
  const slot = normalizeChannelSlot(input.slot);
  if (!slot) return { ok: false as const, status: 400, error: "Invalid Discord channel slot." };
  const guildId = sanitizeDiscordId(input.guildId);
  if (!guildId) return { ok: false as const, status: 400, error: "Valid Discord Server ID is required." };
  const channelId = sanitizeDiscordId(input.channelId);
  if (!channelId) return { ok: false as const, status: 400, error: "Valid Discord channel ID is required." };
  const guildName = safeText(input.guildName, 120);
  const channelName = safeText(input.channelName, 120);
  const reason = safeText(input.reason, 240);
  const requestId = safeRequestId(input.requestId);
  const db = requireDb(env);
  const before = await getStoredChannelMappingBySlot(env, slot.slot);
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO discord_channel_mappings (
        id, slot, guild_id, guild_name, channel_id, channel_name, enabled,
        last_permission_status, last_permission_checked_at, last_permission_error, last_permission_json,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
      ON CONFLICT(slot) DO UPDATE SET
        guild_id = excluded.guild_id,
        guild_name = excluded.guild_name,
        channel_id = excluded.channel_id,
        channel_name = excluded.channel_name,
        enabled = 1,
        last_permission_status = CASE
          WHEN discord_channel_mappings.guild_id = excluded.guild_id
           AND discord_channel_mappings.channel_id = excluded.channel_id
          THEN discord_channel_mappings.last_permission_status ELSE NULL END,
        last_permission_checked_at = CASE
          WHEN discord_channel_mappings.guild_id = excluded.guild_id
           AND discord_channel_mappings.channel_id = excluded.channel_id
          THEN discord_channel_mappings.last_permission_checked_at ELSE NULL END,
        last_permission_error = CASE
          WHEN discord_channel_mappings.guild_id = excluded.guild_id
           AND discord_channel_mappings.channel_id = excluded.channel_id
          THEN discord_channel_mappings.last_permission_error ELSE NULL END,
        last_permission_json = CASE
          WHEN discord_channel_mappings.guild_id = excluded.guild_id
           AND discord_channel_mappings.channel_id = excluded.channel_id
          THEN discord_channel_mappings.last_permission_json ELSE NULL END,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), slot.slot, guildId, guildName, channelId, channelName, user.discord_id, user.discord_id, now, now)
    .run();

  const after = await getStoredChannelMappingBySlot(env, slot.slot);
  await insertOwnerDiscordAuditLog(env, user, {
    action: "channel_mapping_saved",
    targetType: "discord_channel_mapping",
    targetSlot: slot.slot,
    guildId,
    channelId,
    before,
    after,
    result: "success",
    reason,
    requestId,
  });
  return { ok: true as const, mapping: after ? toChannelSlot(slot, after) : null };
}

export async function disableOwnerDiscordChannelMapping(env: Env, user: SessionUser, input: {
  slot?: unknown;
  reason?: unknown;
  requestId?: unknown;
}) {
  await ensureOwnerDiscordControlSchema(env);
  const slot = normalizeChannelSlot(input.slot);
  if (!slot) return { ok: false as const, status: 400, error: "Invalid Discord channel slot." };
  const reason = safeText(input.reason, 240);
  const requestId = safeRequestId(input.requestId);
  const before = await getStoredChannelMappingBySlot(env, slot.slot);
  if (!before) return { ok: false as const, status: 404, error: "Discord channel mapping was not found." };
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare("UPDATE discord_channel_mappings SET enabled = 0, updated_by = ?, updated_at = ? WHERE slot = ?")
    .bind(user.discord_id, now, slot.slot)
    .run();
  const after = await getStoredChannelMappingBySlot(env, slot.slot);
  await insertOwnerDiscordAuditLog(env, user, {
    action: "channel_mapping_disabled",
    targetType: "discord_channel_mapping",
    targetSlot: slot.slot,
    guildId: before.guild_id,
    channelId: before.channel_id,
    before,
    after,
    result: "success",
    reason,
    requestId,
  });
  return { ok: true as const, mapping: after ? toChannelSlot(slot, after) : null };
}

export async function runOwnerDiscordPermissionCheck(env: Env, user: SessionUser, input: {
  slot?: unknown;
  reason?: unknown;
  requestId?: unknown;
}) {
  await ensureOwnerDiscordControlSchema(env);
  const slot = normalizeChannelSlot(input.slot);
  if (!slot) return { ok: false as const, status: 400, error: "Invalid Discord channel slot." };
  const requestId = safeRequestId(input.requestId);
  const reason = safeText(input.reason, 240);
  const mapping = await getStoredChannelMappingBySlot(env, slot.slot);
  if (!mapping || Number(mapping.enabled ?? 0) !== 1) {
    return { ok: false as const, status: 404, error: "Configure and enable this channel mapping before checking permissions." };
  }

  const before = mapping;
  const permissionCheck = await performPermissionCheck(env, mapping);
  const now = permissionCheck.checkedAt;
  await requireDb(env)
    .prepare(
      `UPDATE discord_channel_mappings
          SET last_permission_status = ?,
              last_permission_checked_at = ?,
              last_permission_error = ?,
              last_permission_json = ?,
              channel_name = COALESCE(?, channel_name),
              updated_by = ?,
              updated_at = ?
        WHERE slot = ?`,
    )
    .bind(
      permissionCheck.status,
      now,
      permissionCheck.warning,
      JSON.stringify(permissionCheck),
      permissionCheck.channelName,
      user.discord_id,
      now,
      slot.slot,
    )
    .run();
  const after = await getStoredChannelMappingBySlot(env, slot.slot);
  await insertOwnerDiscordAuditLog(env, user, {
    action: "permission_check_run",
    targetType: "discord_channel_mapping",
    targetSlot: slot.slot,
    guildId: mapping.guild_id,
    channelId: mapping.channel_id,
    before,
    after,
    result: permissionCheck.ok ? "success" : "failed",
    reason: reason ?? permissionCheck.warning,
    requestId,
  });
  return { ok: true as const, permissionCheck, mapping: after ? toChannelSlot(slot, after) : null };
}

export async function sendOwnerDiscordTestEmbed(env: Env, user: SessionUser, input: {
  slot?: unknown;
  type?: unknown;
  confirmation?: unknown;
  previewOnly?: unknown;
  reason?: unknown;
  requestId?: unknown;
}) {
  await ensureOwnerDiscordControlSchema(env);
  const slot = normalizeChannelSlot(input.slot);
  if (!slot) return { ok: false as const, status: 400, error: "Invalid Discord channel slot." };
  const confirmation = String(input.confirmation ?? "").trim();
  if (confirmation !== "SEND_TEST_EMBED") {
    return { ok: false as const, status: 400, error: "Type SEND_TEST_EMBED to send a Discord test embed." };
  }
  const mapping = await getStoredChannelMappingBySlot(env, slot.slot);
  if (!mapping || Number(mapping.enabled ?? 0) !== 1) {
    return { ok: false as const, status: 409, error: "Configure this channel mapping before sending a test embed." };
  }
  const permission = parsePermissionJson(mapping.last_permission_json) ?? await performPermissionCheck(env, mapping);
  if (!permission.ok) {
    await insertOwnerDiscordAuditLog(env, user, {
      action: "test_embed_failed",
      targetType: "discord_test_embed",
      targetSlot: slot.slot,
      guildId: mapping.guild_id,
      channelId: mapping.channel_id,
      before: mapping,
      after: { permission },
      result: "failed",
      reason: permission.warning ?? "Discord permission check has not passed.",
      requestId: safeRequestId(input.requestId),
    });
    return { ok: false as const, status: 409, error: "Run a passing Discord permission check before sending a test embed.", permissionCheck: permission };
  }

  const preview = buildOwnerDiscordPreviewEmbed(env, {
    type: input.type,
    title: "DZN test embed - owner triggered",
    description: "This is a single manually triggered DZN owner-console test embed. Automatic Discord posting remains disabled.",
    colorHex: "#22d3ee",
  });
  const previewOnly = parseBoolean(input.previewOnly);
  const requestId = safeRequestId(input.requestId);
  const reason = safeText(input.reason, 240);

  await insertOwnerDiscordAuditLog(env, user, {
    action: "test_embed_preview_generated",
    targetType: "discord_test_embed",
    targetSlot: slot.slot,
    guildId: mapping.guild_id,
    channelId: mapping.channel_id,
    before: null,
    after: { preview_type: preview.type, title: preview.title, preview_only: true },
    result: "success",
    reason,
    requestId,
  });

  if (previewOnly) {
    return {
      ok: true as const,
      sent: false,
      mode: "preview_only",
      preview,
      permissionCheck: permission,
      messageId: null,
      autoPostingEnabled: false,
    };
  }

  const delivery = await sendOwnerDiscordMessage(env, mapping.channel_id, preview)
    .then((messageId) => ({ ok: true as const, messageId }))
    .catch((error) => ({ ok: false as const, messageId: null, error: safeText(error instanceof Error ? error.message : error, 240) ?? "Discord test embed failed." }));

  await insertOwnerDiscordAuditLog(env, user, {
    action: delivery.ok ? "test_embed_sent" : "test_embed_failed",
    targetType: "discord_test_embed",
    targetSlot: slot.slot,
    guildId: mapping.guild_id,
    channelId: mapping.channel_id,
    before: null,
    after: { preview_type: preview.type, message_id: delivery.messageId, auto_posting_enabled: false },
    result: delivery.ok ? "success" : "failed",
    reason: delivery.ok ? reason : delivery.error,
    requestId,
  });

  if (!delivery.ok) {
    return { ok: false as const, status: 502, error: delivery.error, permissionCheck: permission, preview };
  }
  return {
    ok: true as const,
    sent: true,
    mode: "manual_owner_test",
    preview,
    permissionCheck: permission,
    messageId: delivery.messageId,
    autoPostingEnabled: false,
  };
}

export async function getOwnerDiscordAuditLog(env: Env, limit = 50): Promise<OwnerDiscordAuditLogEntry[]> {
  try {
    if (!(await tableExists(env, "discord_owner_audit_log"))) return [];
    const rows = await requireDb(env)
      .prepare(
        `SELECT id, actor_user_id, actor_discord_id, action, target_type, target_slot,
                guild_id, channel_id, before_json, after_json, result, reason, request_id, created_at
           FROM discord_owner_audit_log
          ORDER BY created_at DESC
          LIMIT ?`,
      )
      .bind(Math.max(1, Math.min(Math.trunc(limit), 100)))
      .all<StoredAuditRow>();
    return (rows.results ?? []).map(toAuditLogEntry);
  } catch {
    return [];
  }
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

export async function ensureOwnerDiscordControlSchema(env: Env) {
  const db = requireDb(env);
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS discord_channel_mappings (
      id TEXT PRIMARY KEY,
      slot TEXT NOT NULL UNIQUE,
      guild_id TEXT NOT NULL,
      guild_name TEXT,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_permission_status TEXT,
      last_permission_checked_at TEXT,
      last_permission_error TEXT,
      last_permission_json TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_discord_channel_mappings_slot ON discord_channel_mappings(slot)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_discord_channel_mappings_guild_channel ON discord_channel_mappings(guild_id, channel_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_discord_channel_mappings_enabled ON discord_channel_mappings(enabled, updated_at)").run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS discord_owner_audit_log (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      actor_discord_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_slot TEXT,
      guild_id TEXT,
      channel_id TEXT,
      before_json TEXT,
      after_json TEXT,
      result TEXT NOT NULL,
      reason TEXT,
      request_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_discord_owner_audit_log_created_at ON discord_owner_audit_log(created_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_discord_owner_audit_log_action ON discord_owner_audit_log(action, created_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_discord_owner_audit_log_target ON discord_owner_audit_log(target_type, target_slot, created_at)").run();
}

export function sanitizeOwnerDiscordChannelMappingInput(input: {
  slot?: unknown;
  guildId?: unknown;
  channelId?: unknown;
}) {
  return {
    slot: normalizeChannelSlot(input.slot)?.slot ?? null,
    guildId: sanitizeDiscordId(input.guildId),
    channelId: sanitizeDiscordId(input.channelId),
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

async function countConfiguredOwnerChannels(env: Env) {
  try {
    if (await tableExists(env, "discord_channel_mappings")) {
      const row = await requireDb(env)
        .prepare("SELECT COUNT(*) AS count FROM discord_channel_mappings WHERE COALESCE(enabled, 0) = 1")
        .first<{ count?: number }>();
      return Number(row?.count ?? 0);
    }
    return countRows(env, "server_posting_destinations");
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

async function getOwnerDiscordLinkedServerOptions(env: Env): Promise<OwnerDiscordLinkedServerOption[]> {
  const options: OwnerDiscordLinkedServerOption[] = [
    {
      value: "network",
      label: "All Network / Network-wide",
      slug: null,
      lifecycleStatus: null,
      lifecycleLabel: "Network-wide",
      status: null,
      role: "network",
    },
  ];
  try {
    if (!(await tableExists(env, "linked_servers"))) return options;
    const result = await requireDb(env)
      .prepare(
        `SELECT id, server_name, public_slug, status, lifecycle_status, nitrado_service_id
           FROM linked_servers
          ORDER BY
            CASE
              WHEN nitrado_service_id = '18765761' THEN 0
              WHEN lower(COALESCE(server_name, '')) LIKE '%pandora%' THEN 1
              WHEN nitrado_service_id = '900002' OR lower(COALESCE(server_name, '')) LIKE '%warlords%' THEN 2
              ELSE 3
            END,
            lower(COALESCE(server_name, id)) ASC
          LIMIT 200`,
      )
      .all<StoredLinkedServerOptionRow>();
    for (const row of result.results ?? []) {
      const id = stringOrNull(row.id);
      if (!id) continue;
      const label = safeText(row.server_name, 120) ?? id;
      const lifecycleStatus = stringOrNull(row.lifecycle_status);
      options.push({
        value: id,
        label,
        slug: stringOrNull(row.public_slug),
        lifecycleStatus,
        lifecycleLabel: lifecycleOptionLabel(lifecycleStatus),
        status: stringOrNull(row.status),
        role: knownServerRole(row),
      });
    }
  } catch {
    return options;
  }
  return options;
}

async function getStoredChannelMappings(env: Env): Promise<StoredChannelMapping[]> {
  try {
    if (!(await tableExists(env, "discord_channel_mappings"))) return [];
    const result = await requireDb(env)
      .prepare(
        `SELECT id, slot, guild_id, guild_name, channel_id, channel_name, enabled,
                last_permission_status, last_permission_checked_at, last_permission_error,
                last_permission_json, created_by, updated_by, created_at, updated_at
           FROM discord_channel_mappings
          ORDER BY slot ASC`,
      )
      .all<StoredChannelMapping>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

async function getStoredChannelMappingBySlot(env: Env, slot: string) {
  if (!(await tableExists(env, "discord_channel_mappings"))) return null;
  return requireDb(env)
    .prepare(
      `SELECT id, slot, guild_id, guild_name, channel_id, channel_name, enabled,
              last_permission_status, last_permission_checked_at, last_permission_error,
              last_permission_json, created_by, updated_by, created_at, updated_at
         FROM discord_channel_mappings
        WHERE slot = ?
        LIMIT 1`,
    )
    .bind(slot)
    .first<StoredChannelMapping>();
}

async function getLastStoredPostAttempt(env: Env): Promise<OwnerDiscordOverview["lastPostAttempt"]> {
  const audit = await getOwnerDiscordAuditLog(env, 1);
  if (audit[0]) {
    return {
      postType: audit[0].action,
      guildId: audit[0].guildId,
      channelId: audit[0].channelId,
      status: audit[0].result,
      attemptedAt: audit[0].createdAt,
      error: audit[0].result === "failed" ? audit[0].reason : null,
    };
  }
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

async function performPermissionCheck(env: Env, mapping: Pick<StoredChannelMapping, "guild_id" | "channel_id">): Promise<OwnerDiscordPermissionCheck> {
  const checkedAt = new Date().toISOString();
  if (!stringOrNull(env.DISCORD_BOT_TOKEN)) {
    return {
      ok: false,
      status: "not_configured",
      checkedAt,
      mode: "not_configured",
      canViewChannel: false,
      canSendMessages: false,
      canEmbedLinks: false,
      canReadMessageHistory: false,
      canAttachFiles: null,
      missingPermissions: [],
      warning: "DISCORD_BOT_TOKEN is not configured in the runtime.",
      channelName: null,
      permissionSource: null,
    };
  }

  const verifiedChannel = await verifyDiscordPostingChannel(env, mapping.guild_id, mapping.channel_id).catch(() => null);
  if (verifiedChannel) {
    return {
      ok: verifiedChannel.can_post,
      status: verifiedChannel.can_post ? "ok" : "missing_permissions",
      checkedAt,
      mode: "bot",
      canViewChannel: verifiedChannel.can_view,
      canSendMessages: verifiedChannel.can_send,
      canEmbedLinks: verifiedChannel.can_embed,
      canReadMessageHistory: verifiedChannel.can_read_history,
      canAttachFiles: null,
      missingPermissions: verifiedChannel.missing_permissions,
      warning: verifiedChannel.can_post ? null : `Missing: ${verifiedChannel.missing_permissions.join(", ")}.`,
      channelName: verifiedChannel.channel_name,
      permissionSource: verifiedChannel.permission_source,
    };
  }

  const fallback = await checkDiscordPostingPermissions(env, {
    discord_channel_id: mapping.channel_id,
    discord_webhook_url: null,
  });
  return {
    ok: fallback.ok,
    status: fallback.ok ? "ok" : fallback.mode === "not_configured" ? "not_configured" : "missing_permissions",
    checkedAt: fallback.checked_at ?? checkedAt,
    mode: fallback.mode,
    canViewChannel: fallback.ok || !fallback.missing_permissions.includes("View Channel"),
    canSendMessages: fallback.ok || !fallback.missing_permissions.includes("Send Messages"),
    canEmbedLinks: fallback.ok || !fallback.missing_permissions.includes("Embed Links"),
    canReadMessageHistory: fallback.ok || !fallback.missing_permissions.includes("Read Message History"),
    canAttachFiles: null,
    missingPermissions: fallback.missing_permissions,
    warning: fallback.warning,
    channelName: null,
    permissionSource: null,
  };
}

async function sendOwnerDiscordMessage(env: Env, channelId: string, preview: OwnerDiscordPreviewEmbed) {
  const botToken = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not configured in the runtime.");
  const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: preview.title,
          description: preview.description,
          color: parseInt(preview.colorHex.replace("#", ""), 16),
          fields: preview.fields,
          footer: { text: "DZN test embed - owner triggered. Auto posting remains disabled." },
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
  const parsed = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok) {
    throw new Error(`Discord test embed failed with HTTP ${response.status}. ${safeText(parsed?.message, 160) ?? ""}`.trim());
  }
  return typeof parsed?.id === "string" ? parsed.id : null;
}

async function insertOwnerDiscordAuditLog(env: Env, user: SessionUser, input: {
  action: string;
  targetType: string;
  targetSlot: string | null;
  guildId: string | null;
  channelId: string | null;
  before: unknown;
  after: unknown;
  result: "success" | "failed" | string;
  reason: string | null;
  requestId: string | null;
}) {
  await ensureOwnerDiscordControlSchema(env);
  await requireDb(env)
    .prepare(
      `INSERT INTO discord_owner_audit_log (
        id, actor_user_id, actor_discord_id, action, target_type, target_slot,
        guild_id, channel_id, before_json, after_json, result, reason, request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      user.id ?? null,
      user.discord_id ?? null,
      safeAction(input.action),
      safeText(input.targetType, 80),
      input.targetSlot,
      sanitizeDiscordId(input.guildId) ?? input.guildId,
      sanitizeDiscordId(input.channelId) ?? input.channelId,
      stringifySafeJson(input.before),
      stringifySafeJson(input.after),
      safeText(input.result, 40) ?? "unknown",
      safeText(input.reason, 240),
      input.requestId,
      new Date().toISOString(),
    )
    .run();
}

async function tableExists(env: Env, tableName: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").bind(tableName).first<{ name?: string }>();
  return row?.name === tableName;
}

function toChannelSlot(slot: typeof OWNER_DISCORD_CHANNEL_SLOTS[number], mapping: StoredChannelMapping): OwnerDiscordChannelSlot & { lastPermissionJson?: string | null } {
  const enabled = Number(mapping.enabled ?? 0) === 1;
  const permissionStatus = stringOrNull(mapping.last_permission_status);
  const status = !enabled
    ? "disabled"
    : permissionStatus === "missing_permissions" || permissionStatus === "discord_error"
      ? "missing_permission"
      : "configured";
  return {
    slot: slot.slot,
    label: slot.label,
    status,
    channelId: mapping.channel_id,
    channelName: mapping.channel_name,
    guildId: mapping.guild_id,
    guildName: mapping.guild_name,
    mappedPostTypes: slot.postTypes,
    webhookConfigured: false,
    lastPermissionCheckedAt: mapping.last_permission_checked_at,
    lastPermissionStatus: mapping.last_permission_status,
    lastPermissionError: mapping.last_permission_error,
    updatedBy: maskDiscordId(mapping.updated_by),
    updatedAt: mapping.updated_at,
    lastPermissionJson: mapping.last_permission_json,
  };
}

function toAuditLogEntry(row: StoredAuditRow): OwnerDiscordAuditLogEntry {
  return {
    id: row.id,
    actorDiscordId: maskDiscordId(row.actor_discord_id),
    action: row.action,
    targetType: row.target_type,
    targetSlot: row.target_slot,
    guildId: row.guild_id,
    channelId: row.channel_id,
    before: parseSafeJson(row.before_json),
    after: parseSafeJson(row.after_json),
    result: row.result,
    reason: safeText(row.reason, 240),
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}

function knownServerRole(row: Pick<StoredLinkedServerOptionRow, "server_name" | "nitrado_service_id">): OwnerDiscordLinkedServerOption["role"] {
  const name = String(row.server_name ?? "").toLowerCase();
  const serviceId = String(row.nitrado_service_id ?? "");
  if (serviceId === "18765761" || name.includes("nuketown")) return "nuketown";
  if (name.includes("pandora")) return "pandora";
  if (serviceId === "900002" || name.includes("warlords")) return "warlords";
  return "server";
}

function lifecycleOptionLabel(status: string | null) {
  const labels: Record<string, string> = {
    active_live: "Active",
    active_degraded: "Active degraded",
    token_needs_resave: "Token needs re-save",
    nitrado_upstream_down: "Nitrado temporarily unavailable",
    stale_monitoring: "Stale monitoring",
    expired_detected: "Server appears expired",
    deletion_imminent: "Deletion may be imminent",
    final_sync_pending: "Final sync pending",
    final_sync_complete: "Final sync complete",
    legacy_offline: "Legacy / Offline",
    archived_hidden: "Archived / Hidden",
  };
  return status ? labels[status] ?? status.replace(/_/g, " ") : "Unknown";
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
  if (type === "daily_recap") {
    return {
      type,
      title: "Daily DZN network recap",
      description: "A daily owner-reviewed snapshot of stored DZN Network activity.",
      colorHex: "#06b6d4",
      thumbnailUrl: null,
      bannerUrl: null,
      fields: [
        { name: "Scope", value: "All Network", inline: true },
        { name: "Mode", value: "Manual preview only", inline: true },
        { name: "Safety", value: "Automatic posting remains disabled.", inline: false },
      ],
      footer: "Preview only - not sent",
      cta: { label: "Open DZN", url: "https://dzn-network.pages.dev" },
    };
  }
  if (type === "longest_kill") {
    return {
      type,
      title: "Longest kill update",
      description: "A stored longest-kill highlight ready for owner review.",
      colorHex: "#f97316",
      thumbnailUrl: null,
      bannerUrl: null,
      fields: [
        { name: "Source", value: "Stored ADM kill events", inline: true },
        { name: "Scoring", value: "No scoring rules changed", inline: true },
        { name: "Delivery", value: "Owner-controlled preview before any send.", inline: false },
      ],
      footer: "Preview only - not sent",
      cta: { label: "View Leaderboards", url: "https://dzn-network.pages.dev/leaderboards" },
    };
  }
  if (type === "milestone") {
    return {
      type,
      title: "Milestone reached",
      description: "A DZN server or network milestone is ready for announcement review.",
      colorHex: "#facc15",
      thumbnailUrl: null,
      bannerUrl: null,
      fields: [
        { name: "Milestone", value: "Stored achievement or activity threshold", inline: true },
        { name: "Approval", value: "Owner reviewed", inline: true },
        { name: "Auto posting", value: "Disabled", inline: false },
      ],
      footer: "Preview only - not sent",
      cta: { label: "Open DZN", url: "https://dzn-network.pages.dev" },
    };
  }
  if (type === "dzn_announcement") {
    return {
      type,
      title: "DZN announcement",
      description: "An owner-authored DZN Network announcement preview.",
      colorHex: "#22d3ee",
      thumbnailUrl: null,
      bannerUrl: null,
      fields: [
        { name: "Audience", value: "DZN community", inline: true },
        { name: "Status", value: "Preview only", inline: true },
        { name: "Safety", value: "No message is sent unless the owner uses the guarded test path.", inline: false },
      ],
      footer: "Preview only - not sent",
      cta: { label: "Visit DZN", url: "https://dzn-network.pages.dev" },
    };
  }
  if (type === "package_promotion") {
    return {
      type,
      title: "Free / Pro listing promotion",
      description: "A package promotion preview that keeps paid visibility separate from competitive stats.",
      colorHex: "#a3e635",
      thumbnailUrl: null,
      bannerUrl: null,
      fields: [
        { name: "Free Listing", value: "Useful public discovery basics", inline: true },
        { name: "Pro Listing", value: "Enhanced presentation without stat advantage", inline: true },
        { name: "Fairness", value: "No paid rank, K/D, score, review, crown or season-win advantage.", inline: false },
      ],
      footer: "Preview only - not sent",
      cta: { label: "View Listings", url: "https://dzn-network.pages.dev" },
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

function normalizePreviewType(value: unknown): OwnerDiscordPreviewType {
  const normalized = stringOrNull(value);
  if (
    normalized === "new_server" ||
    normalized === "top_server" ||
    normalized === "legacy_server" ||
    normalized === "archived_server" ||
    normalized === "server_wars_event" ||
    normalized === "weekly_recap" ||
    normalized === "daily_recap" ||
    normalized === "longest_kill" ||
    normalized === "milestone" ||
    normalized === "dzn_announcement" ||
    normalized === "package_promotion"
  ) {
    return normalized;
  }
  return "weekly_recap";
}

function normalizeChannelSlot(value: unknown) {
  const normalized = stringOrNull(value);
  return OWNER_DISCORD_CHANNEL_SLOTS.find((slot) => slot.slot === normalized) ?? null;
}

function sanitizeDiscordId(value: unknown) {
  const text = stringOrNull(value);
  return text && /^\d{8,32}$/.test(text) ? text : null;
}

function safeText(value: unknown, maxLength: number) {
  const text = stringOrNull(value);
  if (!text) return null;
  return text
    .replace(/[A-Za-z0-9+/=]{32,}/g, "[redacted]")
    .replace(/(token|secret|key|webhook|authorization)=\S+/gi, "$1=[redacted]")
    .replace(/https:\/\/discord\.com\/api\/webhooks\/\S+/gi, "https://discord.com/api/webhooks/[redacted]")
    .slice(0, maxLength);
}

function safeColorHex(value: unknown) {
  const text = stringOrNull(value);
  if (!text) return null;
  return /^#[0-9a-f]{6}$/i.test(text) ? text : null;
}

function safeRequestId(value: unknown) {
  const text = stringOrNull(value);
  return text && /^[a-zA-Z0-9_.:-]{1,96}$/.test(text) ? text : crypto.randomUUID();
}

function safeAction(value: unknown) {
  return safeText(value, 80)?.replace(/[^a-z0-9_.:-]/gi, "_").toLowerCase() ?? "unknown";
}

function stringifySafeJson(value: unknown) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(redactUnsafe(value));
}

function parseSafeJson(value: string | null) {
  if (!value) return null;
  try {
    return redactUnsafe(JSON.parse(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function redactUnsafe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUnsafe);
  if (!value || typeof value !== "object") return safeText(value, 1000) ?? value;
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|webhook|authorization|encrypted|auth_tag|iv|key/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redactUnsafe(raw);
    }
  }
  return result;
}

function parsePermissionJson(value: string | null): OwnerDiscordPermissionCheck | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as OwnerDiscordPermissionCheck;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parsePermissionJsonForApi(value: string | null) {
  const parsed = parsePermissionJson(value);
  if (!parsed) return null;
  return {
    ...parsed,
    warning: safeText(parsed.warning, 240),
  };
}

function normalizeBotToken(value: string | undefined | null) {
  if (!value?.trim()) return null;
  return value.trim().replace(/^Bot\s+/i, "");
}

function maskDiscordId(value: unknown) {
  const text = stringOrNull(value);
  if (!text) return null;
  return text.length <= 8 ? "[redacted]" : `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function parseBoolean(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
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
