import { isDznAdminDiscordId } from "./admin";
import { ensureLinkedServerMetadataColumns, requireDb } from "./db";
import { normalizePlanKey } from "./plans";
import { getServerCategoryLabel, normalizeServerCategory } from "./server-categories";
import type { Env, SessionUser } from "./types";

export const OWNER_SERVER_CATEGORIES = [
  {
    value: "pvp",
    label: "PvP",
    description: "Kill-focused competitive servers. Player-vs-player combat is the main focus.",
  },
  {
    value: "deathmatch",
    label: "Deathmatch",
    description: "Fast combat and arena-style servers. Non-stop action, high volume, and quick fights.",
  },
  {
    value: "pve",
    label: "PvE",
    description: "Survival and co-op focused servers. Environment, progression, and community reputation matter most.",
  },
  {
    value: "pvp_pve",
    label: "PvP / PvE",
    description: "Hybrid servers with both PvP and PvE systems. Raids, survival, and combat all count.",
  },
] as const;

export type OwnerServerCategory = typeof OWNER_SERVER_CATEGORIES[number]["value"];

export const PUBLIC_LISTING_TAGS = [
  "KOS",
  "Modded",
  "Events",
  "Trader / Economy",
  "Weekend Raids",
  "Factions",
  "Base Building",
  "Hardcore",
  "Vanilla+",
  "Roleplay",
  "High Loot",
  "Build Anywhere",
  "No Raid",
  "Custom Map",
  "Boosted Loot",
  "New Player Friendly",
] as const;

export type ListingVisibility = "public" | "hidden";

type SettingsServerRow = {
  id: string;
  user_id: string | null;
  guild_id: string | null;
  discord_guild_id: string | null;
  server_name: string | null;
  nitrado_service_id: string | null;
  nitrado_service_name: string | null;
  display_name: string | null;
  hostname: string | null;
  status: string | null;
  public_slug: string | null;
  server_category: string | null;
  tags_json: string | null;
  public_description: string | null;
  public_listing_updated_at: string | null;
  category_changed_at: string | null;
  category_cooldown_until: string | null;
  category_effective_at: string | null;
  category_first_set_at: string | null;
  category_first_grace_used_at: string | null;
  category_locked_until: string | null;
  category_lock_reason: string | null;
  listing_visibility: string | null;
  tags_changed_at: string | null;
  tags_cooldown_until: string | null;
  plan_key: string | null;
  subscription_status: string | null;
};

type CategoryPolicy = {
  planGroup: "trial_free" | "pro_partner";
  cooldownDays: number;
  monthlyLimit: number;
};

export type CategoryChangeCheck = {
  allowed: boolean;
  code: string | null;
  message: string;
  graceAvailable: boolean;
  graceUsed: boolean;
  monthlyChangesUsed: number;
  monthlyLimit: number;
  cooldownUntil: string | null;
  nextAllowedChangeAt: string | null;
  effectiveAt: string;
  eventLock: EventLockStatus;
};

export type EventLockStatus = {
  locked: boolean;
  reason: string | null;
  eventName?: string | null;
  startsAt?: string | null;
};

type ListingUpdateInput = {
  description?: unknown;
  visibility?: unknown;
};

const CATEGORY_VALUES = new Set<string>(OWNER_SERVER_CATEGORIES.map((category) => category.value));
const PUBLIC_TAG_LOOKUP = new Map(PUBLIC_LISTING_TAGS.map((tag) => [normalizeTagKey(tag), tag]));

export async function ensureServerListingSettingsSchema(env: Env) {
  const db = requireDb(env);
  await ensureLinkedServerMetadataColumns(env);
  const columns = await db.prepare("PRAGMA table_info(linked_servers)").all<{ name: string }>();
  const existing = new Set((columns.results ?? []).map((column) => column.name));
  const settingColumns: Array<[string, string]> = [
    ["category_changed_at", "TEXT"],
    ["category_cooldown_until", "TEXT"],
    ["category_effective_at", "TEXT"],
    ["category_first_set_at", "TEXT"],
    ["category_first_grace_used_at", "TEXT"],
    ["category_locked_until", "TEXT"],
    ["category_lock_reason", "TEXT"],
    ["listing_visibility", "TEXT DEFAULT 'public'"],
    ["tags_changed_at", "TEXT"],
    ["tags_cooldown_until", "TEXT"],
  ];
  const missingColumns = settingColumns.filter(([name]) => !existing.has(name));

  for (const [name, type] of missingColumns) {
    await db.prepare(`ALTER TABLE linked_servers ADD COLUMN ${name} ${type}`).run();
  }

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS server_category_change_events (
      id TEXT PRIMARY KEY,
      server_id TEXT,
      linked_server_id TEXT,
      nitrado_service_id TEXT,
      changed_by_user_id TEXT NOT NULL,
      old_category TEXT,
      new_category TEXT NOT NULL,
      reason TEXT,
      source TEXT NOT NULL,
      plan_key_at_change TEXT,
      effective_at TEXT,
      cooldown_until TEXT,
      grace_used INTEGER DEFAULT 0,
      override_used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_category_change_events_server_created ON server_category_change_events(linked_server_id, created_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_category_change_events_user_created ON server_category_change_events(changed_by_user_id, created_at)").run();

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS server_listing_change_events (
      id TEXT PRIMARY KEY,
      server_id TEXT,
      changed_by_user_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      old_value_json TEXT,
      new_value_json TEXT,
      created_at TEXT NOT NULL
    )`,
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_listing_change_events_server_type_created ON server_listing_change_events(server_id, change_type, created_at)").run();
}

export async function readOwnerServerSettings(env: Env, user: SessionUser | null, linkedServerId: string) {
  await ensureServerListingSettingsSchema(env);
  const server = await getSettingsServer(env, linkedServerId);
  if (!server) return { status: 404, payload: { ok: false, error: "SERVER_NOT_FOUND", message: "Server not found." } };
  const access = canManageServer(env, user, server);
  if (!user) return { status: 401, payload: { ok: false, error: "NOT_AUTHENTICATED", message: "Log in to manage this server." } };
  if (!access) return { status: 403, payload: { ok: false, error: "NOT_AUTHORIZED", message: "You do not have access to this server." } };

  const now = new Date().toISOString();
  const resolvedLinkedServerId = server.id;
  const monthlyChangesUsed = await countCategoryChangesInLast30Days(env, resolvedLinkedServerId);
  const eventLock = await getCategoryEventLockStatus(env, resolvedLinkedServerId, now, server);
  const policy = categoryPolicyForPlan(server.plan_key, server.subscription_status);
  const cooldownUntil = futureIso(server.category_cooldown_until, now);
  const graceAvailable = isGraceAvailable(server, now);
  const tagsEditCount = await countListingChanges(env, resolvedLinkedServerId, "tags", "-7 days");
  const visibilityEditCount = await countListingChanges(env, resolvedLinkedServerId, "visibility", "-1 day");
  const listingEditCount = await countListingChanges(env, resolvedLinkedServerId, "listing", "-1 day");
  const setupComplete = isServerSetupComplete(server);
  const discordEventChannels = await getSavedDiscordEventChannelSummaryForSettings(env, resolvedLinkedServerId);

  return {
    status: 200,
    payload: {
      ok: true,
      server: serializeSettingsServer(server),
      availableCategories: OWNER_SERVER_CATEGORIES.map((category) => ({
        ...category,
        selected: category.value === normalizeOwnerServerCategory(server.server_category),
        locked: Boolean(cooldownUntil || eventLock.locked),
      })),
      allowedTags: PUBLIC_LISTING_TAGS,
      currentTags: parseTags(server.tags_json),
      plan: {
        plan_key: normalizePlanKey(server.plan_key),
        subscription_status: server.subscription_status ?? "inactive",
        policy_group: policy.planGroup,
      },
      categoryPolicy: {
        cooldownDays: policy.cooldownDays,
        monthlyLimit: policy.monthlyLimit,
        firstSetupGraceHours: 24,
        fairnessNote: "Category cooldowns protect fair competition and cannot be bypassed by upgrading.",
      },
      categoryStatus: {
        currentCategory: normalizeOwnerServerCategory(server.server_category),
        currentCategoryLabel: getServerCategoryLabel(server.server_category),
        cooldownUntil,
        nextAllowedChangeAt: cooldownUntil,
        monthlyChangesUsed,
        monthlyLimit: policy.monthlyLimit,
        graceAvailable,
        eventLock,
        categoryEffectiveAt: server.category_effective_at,
        appliesAfterNextAdmSync: true,
      },
      editState: {
        setupComplete,
        canEditCategory: setupComplete && ((!eventLock.locked && !cooldownUntil && monthlyChangesUsed < policy.monthlyLimit) || graceAvailable),
        canEditTags: !futureIso(server.tags_cooldown_until, now) && tagsEditCount < 5,
        canEditDescription: listingEditCount < 5,
        canEditVisibility: visibilityEditCount < 5,
        tagsCooldownUntil: futureIso(server.tags_cooldown_until, now),
        tagEditsUsedLast7Days: tagsEditCount,
        visibilityEditsUsedToday: visibilityEditCount,
      },
      discordEventChannels,
      setupPageUrl: "/setup",
      publicPageUrl: server.public_slug ? `/servers/profile?slug=${encodeURIComponent(server.public_slug)}` : "/servers",
    },
  };
}

export async function updateServerCategory(env: Env, user: SessionUser | null, linkedServerId: string, input: { category?: unknown; reason?: unknown; source?: "owner" | "setup" | "admin_override" | "support_override" }) {
  await ensureServerListingSettingsSchema(env);
  const server = await getSettingsServer(env, linkedServerId);
  if (!user) return { status: 401, payload: { ok: false, error: "NOT_AUTHENTICATED", message: "Log in to update server settings." } };
  if (!server) return { status: 404, payload: { ok: false, error: "SERVER_NOT_FOUND", message: "Server not found." } };
  if (!canManageServer(env, user, server)) return { status: 403, payload: { ok: false, error: "NOT_AUTHORIZED", message: "You do not have access to this server." } };
  if (isServerSuspended(server)) return { status: 403, payload: { ok: false, error: "SERVER_SUSPENDED", message: "This server cannot be edited right now." } };
  if (!isServerSetupComplete(server)) return { status: 409, payload: { ok: false, error: "SETUP_INCOMPLETE", message: "Finish setup before changing the public category." } };
  const resolvedLinkedServerId = server.id;

  const category = normalizeOwnerServerCategory(input.category);
  if (!category) return { status: 400, payload: { ok: false, error: "CATEGORY_INVALID", message: "Choose PvP, Deathmatch, PvE, or PvP / PvE." } };
  const oldCategory = normalizeOwnerServerCategory(server.server_category);
  if (oldCategory === category) {
    return {
      status: 200,
      payload: {
        ok: true,
        oldCategory,
        newCategory: category,
        effectiveAt: server.category_effective_at,
        cooldownUntil: server.category_cooldown_until,
        nextAllowedChangeAt: server.category_cooldown_until,
        message: "Category is already set to this value.",
      },
    };
  }

  const source = input.source ?? "owner";
  const overrideRequested = source === "admin_override" || source === "support_override";
  const overrideAllowed = overrideRequested && isDznAdminDiscordId(env, user.discord_id) && safeReason(input.reason).length >= 8;
  const check = await getCategoryChangeCheck(env, server, source, overrideAllowed);
  if (!check.allowed) return { status: errorStatusForCode(check.code), payload: { ok: false, error: check.code, message: check.message, categoryStatus: check } };

  const now = new Date().toISOString();
  const policy = categoryPolicyForPlan(server.plan_key, server.subscription_status);
  const cooldownUntil = check.graceUsed || overrideAllowed ? server.category_cooldown_until : addDaysIso(now, policy.cooldownDays);
  const effectiveAt = now;
  const reason = safeReason(input.reason);
  const db = requireDb(env);

  await db.prepare(
    `UPDATE linked_servers SET
      server_category = ?,
      category_changed_at = ?,
      category_cooldown_until = ?,
      category_effective_at = ?,
      category_first_set_at = COALESCE(category_first_set_at, ?),
      category_first_grace_used_at = CASE WHEN ? = 1 THEN ? ELSE category_first_grace_used_at END,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).bind(category, now, cooldownUntil, effectiveAt, now, check.graceUsed ? 1 : 0, check.graceUsed ? now : null, resolvedLinkedServerId).run();

  await db.prepare(
    `INSERT INTO server_category_change_events (
      id, server_id, linked_server_id, nitrado_service_id, changed_by_user_id,
      old_category, new_category, reason, source, plan_key_at_change, effective_at,
      cooldown_until, grace_used, override_used, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    resolvedLinkedServerId,
    resolvedLinkedServerId,
    server.nitrado_service_id,
    user.id,
    oldCategory,
    category,
    reason || null,
    overrideAllowed ? source : "owner",
    normalizePlanKey(server.plan_key),
    effectiveAt,
    cooldownUntil,
    check.graceUsed ? 1 : 0,
    overrideAllowed ? 1 : 0,
    now,
  ).run();

  await refreshPublicCacheBestEffort(env, resolvedLinkedServerId);

  return {
    status: 200,
    payload: {
      ok: true,
      oldCategory,
      newCategory: category,
      effectiveAt,
      cooldownUntil,
      nextAllowedChangeAt: cooldownUntil,
      message: "Category updated. Competitive category ranking updates after the next successful ADM sync.",
    },
  };
}

export async function updateServerTags(env: Env, user: SessionUser | null, linkedServerId: string, input: { tags?: unknown }) {
  await ensureServerListingSettingsSchema(env);
  const server = await getSettingsServer(env, linkedServerId);
  if (!user) return { status: 401, payload: { ok: false, error: "NOT_AUTHENTICATED", message: "Log in to update tags." } };
  if (!server) return { status: 404, payload: { ok: false, error: "SERVER_NOT_FOUND", message: "Server not found." } };
  if (!canManageServer(env, user, server)) return { status: 403, payload: { ok: false, error: "NOT_AUTHORIZED", message: "You do not have access to this server." } };
  const resolvedLinkedServerId = server.id;

  const tags = normalizePublicTags(input.tags);
  if (!tags.ok) return { status: 400, payload: { ok: false, error: "VALIDATION_FAILED", message: tags.error } };
  const now = new Date().toISOString();
  const cooldown = futureIso(server.tags_cooldown_until, now);
  if (cooldown) return { status: 429, payload: { ok: false, error: "TAGS_COOLDOWN_ACTIVE", message: "Tags can be edited once every 24 hours.", nextAllowedChangeAt: cooldown } };
  const edits = await countListingChanges(env, resolvedLinkedServerId, "tags", "-7 days");
  if (edits >= 5) return { status: 429, payload: { ok: false, error: "TAGS_WEEKLY_LIMIT_REACHED", message: "Tags can be edited up to 5 times per 7 days." } };

  const previous = parseTags(server.tags_json);
  await requireDb(env).prepare(
    `UPDATE linked_servers SET
      tags_json = ?,
      tags_changed_at = ?,
      tags_cooldown_until = ?,
      public_listing_updated_at = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).bind(JSON.stringify(tags.value), now, addHoursIso(now, 24), now, resolvedLinkedServerId).run();
  await insertListingChangeEvent(env, resolvedLinkedServerId, user.id, "tags", previous, tags.value, now);
  await refreshPublicCacheBestEffort(env, resolvedLinkedServerId);

  return { status: 200, payload: { ok: true, tags: tags.value, tagsCooldownUntil: addHoursIso(now, 24), message: "Public tags updated." } };
}

export async function updateServerListing(env: Env, user: SessionUser | null, linkedServerId: string, input: ListingUpdateInput) {
  await ensureServerListingSettingsSchema(env);
  const server = await getSettingsServer(env, linkedServerId);
  if (!user) return { status: 401, payload: { ok: false, error: "NOT_AUTHENTICATED", message: "Log in to update listing settings." } };
  if (!server) return { status: 404, payload: { ok: false, error: "SERVER_NOT_FOUND", message: "Server not found." } };
  if (!canManageServer(env, user, server)) return { status: 403, payload: { ok: false, error: "NOT_AUTHORIZED", message: "You do not have access to this server." } };
  const resolvedLinkedServerId = server.id;

  const description = input.description === undefined ? server.public_description : sanitizePublicDescription(input.description);
  if (description && (description.length < 40 || description.length > 500)) {
    return { status: 400, payload: { ok: false, error: "VALIDATION_FAILED", message: "Description must be 40 to 500 characters." } };
  }
  if (description === false) {
    return { status: 400, payload: { ok: false, error: "VALIDATION_FAILED", message: "Description contains unsafe content." } };
  }

  const visibility = input.visibility === undefined ? normalizeListingVisibility(server.listing_visibility) : normalizeListingVisibility(input.visibility);
  if (!visibility) return { status: 400, payload: { ok: false, error: "VALIDATION_FAILED", message: "Visibility must be public or hidden." } };
  if (visibility === "public" && !isServerSetupComplete(server)) {
    return { status: 409, payload: { ok: false, error: "SETUP_INCOMPLETE", message: "Complete setup before making this server public." } };
  }

  const now = new Date().toISOString();
  const listingEdits = await countListingChanges(env, resolvedLinkedServerId, "listing", "-1 day");
  if (listingEdits >= 5) return { status: 429, payload: { ok: false, error: "LISTING_RATE_LIMITED", message: "Listing details can be edited up to 5 times per day." } };
  const visibilityChanged = visibility !== normalizeListingVisibility(server.listing_visibility);
  if (visibilityChanged) {
    const visibilityEdits = await countListingChanges(env, resolvedLinkedServerId, "visibility", "-1 day");
    if (visibilityEdits >= 5) return { status: 429, payload: { ok: false, error: "VISIBILITY_RATE_LIMITED", message: "Visibility can be changed up to 5 times per day." } };
  }

  await requireDb(env).prepare(
    `UPDATE linked_servers SET
      public_description = ?,
      listing_visibility = ?,
      public_listing_updated_at = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).bind(description || null, visibility, now, resolvedLinkedServerId).run();
  await insertListingChangeEvent(env, resolvedLinkedServerId, user.id, "listing", { description: server.public_description, visibility: server.listing_visibility }, { description, visibility }, now);
  if (visibilityChanged) {
    await insertListingChangeEvent(env, resolvedLinkedServerId, user.id, "visibility", server.listing_visibility, visibility, now);
  }
  await refreshPublicCacheBestEffort(env, resolvedLinkedServerId);

  return { status: 200, payload: { ok: true, description: description || null, visibility, publicListingUpdatedAt: now, message: "Public listing updated." } };
}

export function normalizeOwnerServerCategory(value: unknown): OwnerServerCategory | null {
  const normalized = normalizeServerCategory(value);
  return normalized && CATEGORY_VALUES.has(normalized) ? normalized as OwnerServerCategory : null;
}

export function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    const normalized = normalizePublicTags(value);
    return normalized.ok ? normalized.value : [];
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    const normalized = normalizePublicTags(parsed);
    return normalized.ok ? normalized.value : [];
  } catch {
    const normalized = normalizePublicTags(value.split(","));
    return normalized.ok ? normalized.value : [];
  }
}

export function normalizePublicTags(value: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "Tags must be an array." };
  const tags: string[] = [];
  for (const item of value) {
    const tag = PUBLIC_TAG_LOOKUP.get(normalizeTagKey(item));
    if (!tag) return { ok: false, error: "Choose tags from the allowed list only." };
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > 8) return { ok: false, error: "Choose up to 8 tags." };
  return { ok: true, value: tags };
}

export function sanitizePublicDescription(value: unknown): string | null | false {
  const text = String(value ?? "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ");
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (/javascript:|data:text\/html|<|>/i.test(normalized)) return false;
  const urlCount = (normalized.match(/https?:\/\//gi) ?? []).length;
  if (urlCount > 2) return false;
  return normalized.slice(0, 500);
}

export function categoryPolicyForPlan(planKey: unknown, subscriptionStatus?: unknown): CategoryPolicy {
  const normalized = normalizePlanKey(planKey);
  const active = ["active", "trialing"].includes(String(subscriptionStatus ?? "").toLowerCase());
  const fairPaid = active && (normalized === "pro" || normalized === "network" || normalized === "partner");
  return fairPaid
    ? { planGroup: "pro_partner", cooldownDays: 7, monthlyLimit: 2 }
    : { planGroup: "trial_free", cooldownDays: 30, monthlyLimit: 1 };
}

export async function getCategoryChangeCheck(env: Env, server: SettingsServerRow, source: string, overrideAllowed = false): Promise<CategoryChangeCheck> {
  const now = new Date().toISOString();
  const effectiveAt = now;
  const policy = categoryPolicyForPlan(server.plan_key, server.subscription_status);
  const monthlyChangesUsed = await countCategoryChangesInLast30Days(env, server.id);
  const eventLock = await getCategoryEventLockStatus(env, server.id, now, server);
  const graceAvailable = isGraceAvailable(server, now);
  const cooldownUntil = futureIso(server.category_cooldown_until, now);
  const graceUsed = graceAvailable && source === "owner";

  if (overrideAllowed) {
    return { allowed: true, code: null, message: "Admin override allowed.", graceAvailable, graceUsed: false, monthlyChangesUsed, monthlyLimit: policy.monthlyLimit, cooldownUntil, nextAllowedChangeAt: cooldownUntil, effectiveAt, eventLock };
  }
  if (eventLock.locked) {
    return { allowed: false, code: "CATEGORY_LOCKED_DURING_EVENT", message: eventLock.reason ?? "Category changes are locked during active events.", graceAvailable, graceUsed: false, monthlyChangesUsed, monthlyLimit: policy.monthlyLimit, cooldownUntil, nextAllowedChangeAt: cooldownUntil, effectiveAt, eventLock };
  }
  if (!graceUsed && cooldownUntil) {
    return { allowed: false, code: "CATEGORY_COOLDOWN_ACTIVE", message: `You can change category again on ${formatDate(cooldownUntil)}.`, graceAvailable, graceUsed: false, monthlyChangesUsed, monthlyLimit: policy.monthlyLimit, cooldownUntil, nextAllowedChangeAt: cooldownUntil, effectiveAt, eventLock };
  }
  if (!graceUsed && monthlyChangesUsed >= policy.monthlyLimit) {
    return { allowed: false, code: "CATEGORY_MONTHLY_LIMIT_REACHED", message: `You have used ${monthlyChangesUsed} of ${policy.monthlyLimit} category changes in the last 30 days.`, graceAvailable, graceUsed: false, monthlyChangesUsed, monthlyLimit: policy.monthlyLimit, cooldownUntil, nextAllowedChangeAt: cooldownUntil, effectiveAt, eventLock };
  }
  return { allowed: true, code: null, message: "Category changes are available.", graceAvailable, graceUsed, monthlyChangesUsed, monthlyLimit: policy.monthlyLimit, cooldownUntil, nextAllowedChangeAt: cooldownUntil, effectiveAt, eventLock };
}

async function getSettingsServer(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  return db.prepare(
    `SELECT linked_servers.*,
            server_subscriptions.plan_key,
            server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
      WHERE (linked_servers.id = ? OR linked_servers.nitrado_service_id = ? OR linked_servers.public_slug = ?)
        AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
        AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
      ORDER BY server_subscriptions.updated_at DESC, server_subscriptions.created_at DESC
      LIMIT 1`,
  ).bind(linkedServerId, linkedServerId, linkedServerId).first<SettingsServerRow>();
}

type SettingsEventChannelSummary = {
  channelId: string;
  channelName: string | null;
  channelType: string;
  valid: boolean;
  missingPermissions: string[];
};

const SETTINGS_EVENT_CHANNEL_TYPES = [
  "default_event",
  "event_announcements",
  "event_live_scoreboard",
  "event_results",
] as const;

type SettingsEventChannelSelection = Record<typeof SETTINGS_EVENT_CHANNEL_TYPES[number], SettingsEventChannelSummary | null>;

async function getSavedDiscordEventChannelSummaryForSettings(env: Env, linkedServerId: string): Promise<{
  selected: SettingsEventChannelSelection;
  liveScoreboardReady: boolean;
  defaultReady: boolean;
}> {
  const empty = emptyDiscordEventChannelSummary();
  try {
    const rows = await requireDb(env)
      .prepare(
        `SELECT channel_type, channel_id, channel_name, channel_kind,
                bot_can_view, bot_can_send, bot_can_embed, bot_can_read_history
           FROM server_discord_channel_settings
          WHERE linked_server_id = ?`,
      )
      .bind(linkedServerId)
      .all<{
        channel_type: string;
        channel_id: string;
        channel_name: string | null;
        channel_kind: string | null;
        bot_can_view: number | null;
        bot_can_send: number | null;
        bot_can_embed: number | null;
        bot_can_read_history: number | null;
      }>();

    const selected = { ...empty.selected };
    for (const row of rows.results ?? []) {
      if (!isSettingsEventChannelType(row.channel_type)) continue;
      const missingPermissions = [
        row.bot_can_view ? null : "View Channel",
        row.bot_can_send ? null : "Send Messages",
        row.bot_can_embed ? null : "Embed Links",
        row.bot_can_read_history ? null : "Read Message History",
      ].filter(Boolean) as string[];
      selected[row.channel_type] = {
        channelId: row.channel_id,
        channelName: row.channel_name,
        channelType: row.channel_kind ?? "text",
        valid: missingPermissions.length === 0,
        missingPermissions,
      };
    }
    return {
      selected,
      liveScoreboardReady: Boolean(selected.event_live_scoreboard?.valid),
      defaultReady: Boolean(selected.default_event?.valid),
    };
  } catch (error) {
    console.warn("DZN server settings Discord channel summary skipped", error instanceof Error ? error.message : "unknown error");
    return empty;
  }
}

function emptyDiscordEventChannelSummary(): {
  selected: SettingsEventChannelSelection;
  liveScoreboardReady: boolean;
  defaultReady: boolean;
} {
  return {
    selected: {
      default_event: null,
      event_announcements: null,
      event_live_scoreboard: null,
      event_results: null,
    },
    liveScoreboardReady: false,
    defaultReady: false,
  };
}

function isSettingsEventChannelType(value: string): value is typeof SETTINGS_EVENT_CHANNEL_TYPES[number] {
  return (SETTINGS_EVENT_CHANNEL_TYPES as readonly string[]).includes(value);
}

function serializeSettingsServer(server: SettingsServerRow) {
  const displayName = firstString(server.display_name, server.hostname, server.server_name, server.nitrado_service_name, "DZN Server") ?? "DZN Server";
  return {
    id: server.id,
    name: displayName,
    status: server.status,
    publicSlug: server.public_slug,
    currentCategory: normalizeOwnerServerCategory(server.server_category),
    currentCategoryLabel: getServerCategoryLabel(server.server_category),
    description: server.public_description ?? "",
    visibility: normalizeListingVisibility(server.listing_visibility) ?? "public",
    listingUpdatedAt: server.public_listing_updated_at,
    lastUpdatedAt: server.public_listing_updated_at ?? server.category_changed_at,
    categoryChangedAt: server.category_changed_at,
    categoryEffectiveAt: server.category_effective_at,
    setupComplete: isServerSetupComplete(server),
    discordConnected: Boolean(server.guild_id || server.discord_guild_id),
  };
}

function canManageServer(env: Env, user: SessionUser | null, server: SettingsServerRow) {
  if (!user) return false;
  return server.user_id === user.id || isDznAdminDiscordId(env, user.discord_id);
}

function isServerSuspended(server: SettingsServerRow) {
  const status = String(server.status ?? "").toLowerCase();
  return status === "suspended" || status === "deleted" || status === "merged";
}

function isServerSetupComplete(server: SettingsServerRow) {
  return Boolean(server.guild_id && server.nitrado_service_id);
}

function isGraceAvailable(server: SettingsServerRow, nowIso: string) {
  const firstSetAt = parseTime(server.category_first_set_at);
  if (!firstSetAt || server.category_first_grace_used_at) return false;
  return parseTime(nowIso) - firstSetAt <= 24 * 60 * 60 * 1000;
}

async function countCategoryChangesInLast30Days(env: Env, linkedServerId: string) {
  const row = await requireDb(env).prepare(
    `SELECT COUNT(*) AS count
       FROM server_category_change_events
      WHERE linked_server_id = ?
        AND COALESCE(grace_used, 0) = 0
        AND COALESCE(override_used, 0) = 0
        AND datetime(created_at) >= datetime('now', '-30 days')`,
  ).bind(linkedServerId).first<{ count: number | null }>();
  return Number(row?.count ?? 0);
}

async function countListingChanges(env: Env, linkedServerId: string, changeType: string, window: "-1 day" | "-7 days") {
  const row = await requireDb(env).prepare(
    `SELECT COUNT(*) AS count
       FROM server_listing_change_events
      WHERE server_id = ?
        AND change_type = ?
        AND datetime(created_at) >= datetime('now', ?)`,
  ).bind(linkedServerId, changeType, window).first<{ count: number | null }>();
  return Number(row?.count ?? 0);
}

async function getCategoryEventLockStatus(env: Env, linkedServerId: string, nowIso: string, server: SettingsServerRow): Promise<EventLockStatus> {
  const explicitLockUntil = futureIso(server.category_locked_until, nowIso);
  if (explicitLockUntil) return { locked: true, reason: server.category_lock_reason ?? "Category locked by admin/support." };

  const db = requireDb(env);
  const eventRow = await db.prepare(
    `SELECT competitive_events.name, competitive_events.status, competitive_events.starts_at
       FROM competitive_event_servers
       JOIN competitive_events ON competitive_events.id = competitive_event_servers.event_id
      WHERE competitive_event_servers.server_id = ?
        AND lower(COALESCE(competitive_events.status, '')) IN ('live', 'registration_open', 'upcoming', 'standby')
        AND (
          lower(COALESCE(competitive_events.status, '')) = 'live'
          OR competitive_events.starts_at IS NULL
          OR datetime(competitive_events.starts_at) <= datetime('now', '+24 hours')
        )
      ORDER BY datetime(COALESCE(competitive_events.starts_at, competitive_events.created_at)) ASC
      LIMIT 1`,
  ).bind(linkedServerId).first<{ name: string | null; status: string | null; starts_at: string | null }>().catch(() => null);
  if (eventRow) {
    return {
      locked: true,
      reason: "Category locked while this server is participating in an active or imminent event.",
      eventName: eventRow.name,
      startsAt: eventRow.starts_at,
    };
  }

  const ctfRow = await db.prepare(
    `SELECT ctf_tournaments.tournament_name, ctf_tournaments.current_phase, ctf_tournaments.phase_ends_at
       FROM ctf_match_participants
       JOIN ctf_tournaments ON ctf_tournaments.id = ctf_match_participants.ctf_tournament_id
      WHERE ctf_match_participants.linked_server_id = ?
        AND lower(COALESCE(ctf_tournaments.current_phase, '')) NOT IN ('completed', 'ended', 'cancelled', 'canceled')
      LIMIT 1`,
  ).bind(linkedServerId).first<{ tournament_name: string | null; current_phase: string | null; phase_ends_at: string | null }>().catch(() => null);
  if (ctfRow) {
    return {
      locked: true,
      reason: "Category locked while this server is registered in an active tournament.",
      eventName: ctfRow.tournament_name,
      startsAt: ctfRow.phase_ends_at,
    };
  }

  return { locked: false, reason: null };
}

async function insertListingChangeEvent(env: Env, linkedServerId: string, userId: string, changeType: string, oldValue: unknown, newValue: unknown, createdAt: string) {
  await requireDb(env).prepare(
    `INSERT INTO server_listing_change_events (id, server_id, changed_by_user_id, change_type, old_value_json, new_value_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), linkedServerId, userId, changeType, JSON.stringify(oldValue ?? null), JSON.stringify(newValue ?? null), createdAt).run();
}

async function refreshPublicCacheBestEffort(env: Env, linkedServerId: string) {
  try {
    const { rebuildPublicCacheForServer } = await import("./public-cache");
    await rebuildPublicCacheForServer(env, linkedServerId);
  } catch (error) {
    console.warn("DZN server settings public cache refresh skipped", error instanceof Error ? error.message : "unknown error");
  }
}

function normalizeListingVisibility(value: unknown): ListingVisibility | null {
  const normalized = String(value ?? "public").trim().toLowerCase();
  if (!normalized || normalized === "public") return "public";
  if (normalized === "hidden") return "hidden";
  return null;
}

function normalizeTagKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
}

function safeReason(value: unknown) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function futureIso(value: unknown, nowIso: string) {
  const time = parseTime(value);
  if (!time) return null;
  return time > parseTime(nowIso) ? new Date(time).toISOString() : null;
}

function parseTime(value: unknown) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : 0;
}

function addDaysIso(value: string, days: number) {
  return new Date(parseTime(value) + days * 24 * 60 * 60 * 1000).toISOString();
}

function addHoursIso(value: string, hours: number) {
  return new Date(parseTime(value) + hours * 60 * 60 * 1000).toISOString();
}

function formatDate(value: string) {
  return new Date(value).toUTCString();
}

function firstString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function errorStatusForCode(code: string | null) {
  if (code === "CATEGORY_COOLDOWN_ACTIVE" || code === "CATEGORY_MONTHLY_LIMIT_REACHED") return 429;
  if (code === "CATEGORY_LOCKED_DURING_EVENT") return 409;
  return 400;
}
