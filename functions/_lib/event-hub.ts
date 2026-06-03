import { isDznAdminDiscordId } from "./admin";
import { requireDb } from "./db";
import {
  DiscordChannelFetchError,
  fetchDiscordPostingChannels,
  verifyDiscordPostingChannel,
  type DiscordPostingChannel,
} from "./discord-posting";
import { ensureCompetitiveEventsSchema, eventTypeLabel, normalizeEventStatus } from "./events";
import { normalizePlanKey, type PlanKey } from "./plans";
import { getServerCategoryLabel, normalizeServerCategory, type ServerCategory } from "./server-categories";
import type { Env, SessionUser } from "./types";

export const EVENT_CHANNEL_TYPES = [
  "default_event",
  "event_announcements",
  "event_live_scoreboard",
  "event_results",
] as const;

export type EventChannelType = typeof EVENT_CHANNEL_TYPES[number];

const REQUIRED_PERMISSION_LABELS = ["View Channel", "Send Messages", "Embed Links", "Read Message History"];
const EVENT_OFFICIAL_TYPES = new Set(["capture_the_flag", "server_vs_server", "bot_tournament", "faction_wars", "seasonal_wars"]);
const PVP_METRICS = new Set(["pvp_kill_count", "pvp_headshot_count", "pvp_weapon_kill_count", "pvp_distance_qualified_kills", "pvp_longest_kill", "pvp_kd_ratio"]);
const BUILD_METRICS = new Set(["build_score", "structures_built", "walls_built", "gates_built", "watchtower_parts_built", "storage_items_placed", "flags_raised"]);

type OwnerServerRow = {
  id: string;
  user_id: string | null;
  guild_id: string | null;
  discord_guild_id: string | null;
  guild_name: string | null;
  server_name: string | null;
  display_name: string | null;
  hostname: string | null;
  nitrado_service_id: string | null;
  status: string | null;
  public_slug: string | null;
  server_category: string | null;
  listing_visibility: string | null;
  current_players: number | null;
  max_players: number | null;
  plan_key: string | null;
  subscription_status: string | null;
};

type EventHubEventRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  event_type: string | null;
  status: string | null;
  visibility: string | null;
  premium_tier: string | null;
  server_limit: number | null;
  team_limit: number | null;
  starts_at: string | null;
  ends_at: string | null;
  rules: string | null;
  rewards: string | null;
  requires_discord_posting: number | null;
  official_event: number | null;
  allow_hybrid_entries: number | null;
  entry_deadline_at: string | null;
  matchup_duration_hours: number | null;
  phase_duration_hours: number | null;
  phase_count: number | null;
  scoring_rules_json: string | null;
  registered_servers: number | null;
  entered_entry_id: string | null;
  entered_status: string | null;
};

type SavedChannelRow = {
  id: string;
  linked_server_id: string;
  guild_id: string;
  channel_type: string;
  channel_id: string;
  channel_name: string | null;
  channel_kind: string | null;
  bot_can_view: number | null;
  bot_can_send: number | null;
  bot_can_embed: number | null;
  bot_can_read_history: number | null;
  last_verified_at: string | null;
  updated_at: string | null;
};

type MatchupRow = {
  id: string;
  event_id: string;
  server_a_entry_id: string | null;
  server_b_entry_id: string | null;
  server_a_id: string;
  server_b_id: string;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  scoring_grace_until: string | null;
  server_a_score: number | null;
  server_b_score: number | null;
  server_a_name: string | null;
  server_b_name: string | null;
  event_name: string | null;
  event_type: string | null;
  round_number: number | null;
};

type PhaseRow = {
  id: string;
  event_id: string;
  matchup_id: string;
  phase_number: number;
  title: string;
  description: string | null;
  category_scope: string | null;
  metric_type: string;
  scoring_rules_json: string | null;
  starts_at: string;
  ends_at: string;
  scoring_grace_until: string | null;
  status: string | null;
  server_a_score: number | null;
  server_b_score: number | null;
  winner_server_id: string | null;
  finalized_at: string | null;
};

type PhaseScore = {
  score: number;
  qualifyingEventsCount: number;
  breakdown: Record<string, unknown>;
};

export async function ensureEventHubSchema(env: Env) {
  await ensureCompetitiveEventsSchema(env);
  const db = requireDb(env);
  await ensureColumns(db, "competitive_events", {
    requires_discord_posting: "INTEGER NOT NULL DEFAULT 0",
    official_event: "INTEGER NOT NULL DEFAULT 0",
    allow_hybrid_entries: "INTEGER NOT NULL DEFAULT 0",
    entry_deadline_at: "TEXT",
    matchup_duration_hours: "INTEGER",
    phase_duration_hours: "INTEGER",
    phase_count: "INTEGER",
    scoring_rules_json: "TEXT",
  });
  await ensureColumns(db, "kill_events", { event_hash: "TEXT" }).catch(() => null);
  await ensureColumns(db, "player_events", { event_hash: "TEXT" }).catch(() => null);
  for (const statement of EVENT_HUB_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
}

export async function getOwnerEventHub(env: Env, user: SessionUser | null, serverId: string) {
  if (!user) return { status: 401, payload: { ok: false, error: "NOT_AUTHENTICATED", message: "Log in to view events." } };
  await ensureEventHubSchema(env);
  const server = await fetchOwnerServer(env, user, serverId);
  if (!server) return { status: 403, payload: { ok: false, error: "NOT_AUTHORIZED", message: "Server not found or you do not have access." } };

  const [channels, cooldown, adm, events, entries, matchups] = await Promise.all([
    getSavedEventChannels(env, server.id),
    getActiveEventCooldown(env, server.id),
    getAdmEligibility(env, server.id),
    fetchOwnerVisibleEvents(env, server.id),
    fetchEntries(env, server.id),
    fetchLiveMatchups(env, server.id),
  ]);

  const channelStatus = summarizeChannelStatus(env, server, channels);
  const serverCategory = normalizeServerCategory(server.server_category);
  const groups = groupEventsForOwner(events, {
    server,
    category: serverCategory,
    channels,
    cooldownUntil: cooldown?.cooldown_until ?? null,
    admReady: adm.ready,
  });

  return {
    status: 200,
    payload: {
      ok: true,
      source: "live",
      generated_at: new Date().toISOString(),
      server: serializeOwnerServer(server, adm, channelStatus),
      discordChannels: {
        selected: serializeSavedChannels(channels),
        status: channelStatus,
        settingsUrl: `/dashboard/server-settings?serverId=${encodeURIComponent(server.id)}#discord-event-channels`,
      },
      cooldown,
      availableEvents: groups.available,
      lockedEvents: groups.locked,
      enteredEvents: entries,
      liveMatchups: matchups.filter((matchup) => ["live", "active", "finalizing"].includes(String(matchup.status ?? "").toLowerCase())),
      brackets: matchups,
      results: matchups.filter((matchup) => ["completed", "finalized"].includes(String(matchup.status ?? "").toLowerCase())),
      tabs: ["available", "entered", "live", "brackets", "results", "locked"],
      phaseTemplates: {
        deathmatch: buildChallengePhaseTemplates("deathmatch", "capture_the_flag"),
        pvp: buildChallengePhaseTemplates("pvp", "capture_the_flag"),
        pve: buildChallengePhaseTemplates("pve", "survival_challenge"),
        pvp_pve: buildChallengePhaseTemplates("pvp_pve", "capture_the_flag"),
      },
    },
  };
}

export async function enterOwnerEvent(env: Env, user: SessionUser | null, serverId: string, eventId: string) {
  if (!user) return { status: 401, payload: { ok: false, error: "NOT_AUTHENTICATED", message: "Log in to enter events." } };
  await ensureEventHubSchema(env);
  const server = await fetchOwnerServer(env, user, serverId);
  if (!server) return { status: 403, payload: { ok: false, error: "NOT_AUTHORIZED", message: "Server not found or you do not have access." } };
  const event = await fetchEventByIdOrSlug(env, eventId);
  if (!event) return { status: 404, payload: { ok: false, error: "EVENT_NOT_FOUND", message: "Event not found." } };

  const [channels, cooldown, adm] = await Promise.all([
    getSavedEventChannels(env, server.id),
    getActiveEventCooldown(env, server.id),
    getAdmEligibility(env, server.id),
  ]);
  const eligibility = getEventEligibility(event, {
    server,
    category: normalizeServerCategory(server.server_category),
    channels,
    cooldownUntil: cooldown?.cooldown_until ?? null,
    admReady: adm.ready,
  });
  if (!eligibility.canEnter) {
    return { status: eligibilityStatus(eligibility.code), payload: { ok: false, error: eligibility.code, message: eligibility.message, action: eligibility.action } };
  }

  const db = requireDb(env);
  const existing = await db
    .prepare("SELECT id FROM competitive_event_servers WHERE event_id = ? AND server_id = ? LIMIT 1")
    .bind(event.id, server.id)
    .first<{ id: string }>();
  if (existing) return { status: 409, payload: { ok: false, error: "ALREADY_ENTERED", message: "This server is already entered in the event." } };

  const limit = Number(event.server_limit ?? event.team_limit ?? 0);
  if (limit > 0 && Number(event.registered_servers ?? 0) >= limit) {
    return { status: 409, payload: { ok: false, error: "EVENT_FULL", message: "This event is full." } };
  }

  const now = new Date().toISOString();
  const entryId = crypto.randomUUID();
  const categoryAtEntry = normalizeServerCategory(server.server_category) ?? "open";
  await db
    .prepare(
      `INSERT INTO competitive_event_servers (id, event_id, server_id, category, approved, registered_at)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(event_id, server_id) DO NOTHING`,
    )
    .bind(entryId, event.id, server.id, categoryAtEntry, now)
    .run();

  await db
    .prepare(
      `INSERT INTO server_event_entries (
        id, event_id, linked_server_id, server_id, owner_user_id, guild_id,
        category_at_entry, plan_key_at_entry, status, entered_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'entered', ?, ?, ?)
      ON CONFLICT(event_id, linked_server_id) DO UPDATE SET
        status = 'entered',
        updated_at = excluded.updated_at`,
    )
    .bind(entryId, event.id, server.id, server.id, user.id, server.guild_id, categoryAtEntry, normalizePlanKey(server.plan_key), now, now, now)
    .run();

  await db
    .prepare("UPDATE linked_servers SET competitive_enabled = 1, last_event_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(now, server.id)
    .run();

  await insertEventActivity(env, event.id, server.id, "server_entered_event", `${serverDisplayName(server)} entered ${event.name}.`, {
    source: "owner_event_hub",
    category_at_entry: categoryAtEntry,
    discord_channel_ready: summarizeChannelStatus(env, server, channels).ready,
    scoring_source: "ADM",
  });

  await maybeCreateInitialMatchupAndPhases(env, event.id);

  return {
    status: 200,
    payload: {
      ok: true,
      entryId,
      status: "entered",
      message: "Server entered successfully. Scoring will be handled automatically from ADM sync.",
    },
  };
}

export async function leaveOwnerEvent(env: Env, user: SessionUser | null, serverId: string, eventId: string) {
  if (!user) return { status: 401, payload: { ok: false, error: "NOT_AUTHENTICATED", message: "Log in to leave events." } };
  await ensureEventHubSchema(env);
  const server = await fetchOwnerServer(env, user, serverId);
  if (!server) return { status: 403, payload: { ok: false, error: "NOT_AUTHORIZED", message: "Server not found or you do not have access." } };
  const event = await fetchEventByIdOrSlug(env, eventId);
  if (!event) return { status: 404, payload: { ok: false, error: "EVENT_NOT_FOUND", message: "Event not found." } };
  const status = normalizeEventStatus(event.status);
  if (status === "live") return { status: 409, payload: { ok: false, error: "EVENT_ALREADY_STARTED", message: "Servers cannot leave after an event starts." } };
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare("UPDATE server_event_entries SET status = 'withdrawn', withdrawn_at = ?, updated_at = ? WHERE event_id = ? AND linked_server_id = ?")
    .bind(now, now, event.id, server.id)
    .run();
  await requireDb(env)
    .prepare("DELETE FROM competitive_event_servers WHERE event_id = ? AND server_id = ?")
    .bind(event.id, server.id)
    .run();
  return { status: 200, payload: { ok: true, status: "withdrawn", message: "Server entry withdrawn." } };
}

export async function listOwnerDiscordEventChannels(env: Env, user: SessionUser | null, serverId: string) {
  if (!user) return { status: 401, payload: { ok: false, error: "NOT_AUTHENTICATED", message: "Log in to choose event channels." } };
  await ensureEventHubSchema(env);
  const server = await fetchOwnerServer(env, user, serverId);
  if (!server) return { status: 403, payload: { ok: false, error: "NOT_AUTHORIZED", message: "Server not found or you do not have access." } };
  const guildId = normalizeDiscordId(server.guild_id ?? server.discord_guild_id);
  if (!guildId) return { status: 409, payload: { ok: false, error: "DISCORD_GUILD_NOT_CONNECTED", message: "Connect a Discord server in Setup before choosing event channels.", channels: [] } };

  const saved = await getSavedEventChannels(env, server.id);
  if (isMockAuthEnabled(env)) {
    return { status: 200, payload: channelListPayload(server, guildId, saved, mockEventChannels()) };
  }

  try {
    const channels = await fetchDiscordPostingChannels(env, guildId);
    await cacheDiscordChannels(env, guildId, channels);
    return { status: 200, payload: channelListPayload(server, guildId, saved, channels) };
  } catch (error) {
    const cachedChannels = await getCachedDiscordChannelOptions(env, guildId);
    const mapped = mapDiscordChannelFetchError(error);
    if (cachedChannels.length > 0) {
      return {
        status: 200,
        payload: {
          ok: true,
          source: "cached",
          warning: mapped.error,
          message: mapped.message,
          guildId,
          guildName: server.guild_name,
          selected: serializeSavedChannels(saved),
          channels: cachedChannels,
        },
      };
    }
    return {
      status: 200,
      payload: {
        ok: false,
        error: mapped.error,
        errorCode: mapped.error,
        message: mapped.message,
        guildId,
        guildName: server.guild_name,
        channels: [],
        selected: serializeSavedChannels(saved),
      },
    };
  }
}

export async function saveOwnerDiscordEventChannels(env: Env, user: SessionUser | null, serverId: string, input: Record<string, unknown>) {
  if (!user) return { status: 401, payload: { ok: false, error: "NOT_AUTHENTICATED", message: "Log in to save event channels." } };
  await ensureEventHubSchema(env);
  const server = await fetchOwnerServer(env, user, serverId);
  if (!server) return { status: 403, payload: { ok: false, error: "NOT_AUTHORIZED", message: "Server not found or you do not have access." } };
  const guildId = normalizeDiscordId(server.guild_id ?? server.discord_guild_id);
  if (!guildId) return { status: 409, payload: { ok: false, error: "DISCORD_GUILD_NOT_CONNECTED", message: "Connect a Discord server in Setup before choosing event channels." } };

  const requested: Array<[EventChannelType, string | null]> = [
    ["default_event", normalizeDiscordId(input.defaultEventChannelId)],
    ["event_announcements", normalizeDiscordId(input.eventAnnouncementsChannelId)],
    ["event_live_scoreboard", normalizeDiscordId(input.eventLiveScoreboardChannelId)],
    ["event_results", normalizeDiscordId(input.eventResultsChannelId)],
  ];
  const provided = requested.filter(([, channelId]) => Boolean(channelId)) as Array<[EventChannelType, string]>;
  if (provided.length === 0) return { status: 400, payload: { ok: false, error: "CHANNEL_NOT_FOUND", message: "Choose at least one valid event channel." } };

  const saved: SavedChannelRow[] = [];
  for (const [channelType, channelId] of provided) {
    let channel: DiscordPostingChannel | null = null;
    try {
      channel = isMockAuthEnabled(env)
        ? mockEventChannels().find((item) => item.channel_id === channelId) ?? null
        : await verifyDiscordPostingChannel(env, guildId, channelId);
    } catch (error) {
      const mapped = mapDiscordChannelFetchError(error);
      return {
        status: mapped.httpStatus,
        payload: {
          ok: false,
          error: mapped.error,
          errorCode: mapped.error,
          message: mapped.error === "BOT_MISSING_PERMISSIONS" ? "DZN Bot cannot post in that channel." : mapped.message,
        },
      };
    }
    if (!channel) return { status: 404, payload: { ok: false, error: "CHANNEL_NOT_IN_CONNECTED_GUILD", message: "Channel was not found in the connected Discord server." } };
    if (!channel.can_post || channel.missing_permissions.length > 0) {
      return {
        status: 409,
        payload: {
          ok: false,
          error: "BOT_MISSING_PERMISSIONS",
          message: "DZN bot needs View Channel, Send Messages, Embed Links, and Read Message History before this channel can be used.",
          missingPermissions: channel.missing_permissions.length ? channel.missing_permissions : REQUIRED_PERMISSION_LABELS,
        },
      };
    }
    saved.push(await upsertEventChannelSetting(env, server.id, guildId, channelType, channel, user.id));
  }

  return {
    status: 200,
    payload: {
      ok: true,
      message: "Discord event channels saved.",
      selected: serializeSavedChannels(await getSavedEventChannels(env, server.id)),
      saved: serializeSavedChannels(saved),
    },
  };
}

export async function testOwnerDiscordEventChannel(env: Env, user: SessionUser | null, serverId: string, input: Record<string, unknown>) {
  if (!user) return { status: 401, payload: { ok: false, error: "NOT_AUTHENTICATED", message: "Log in to test event channels." } };
  await ensureEventHubSchema(env);
  const server = await fetchOwnerServer(env, user, serverId);
  if (!server) return { status: 403, payload: { ok: false, error: "NOT_AUTHORIZED", message: "Server not found or you do not have access." } };
  const channels = await getSavedEventChannels(env, server.id);
  const channelType = normalizeEventChannelType(input.channelType) ?? "default_event";
  const selected = resolveEventChannel(channels, channelType);
  if (!selected) return { status: 409, payload: { ok: false, error: "DISCORD_EVENT_CHANNEL_REQUIRED", message: "Save an event channel before sending a test message." } };
  const recentTests = await countRecentEventChannelTests(env, server.id);
  if (recentTests >= 3) return { status: 429, payload: { ok: false, error: "RATE_LIMITED", message: "You can send up to 3 event channel tests per hour." } };
  if (isMockAuthEnabled(env)) {
    await recordEventDiscordMessage(env, {
      eventId: "channel-test",
      matchupId: null,
      phaseId: null,
      linkedServerId: server.id,
      guildId: selected.guild_id,
      channelId: selected.channel_id,
      messageId: `mock-${Date.now()}`,
      messageType: "channel_test",
      status: "sent",
      payloadHash: "mock",
    });
    return { status: 200, payload: { ok: true, message: "Test event message sent.", mocked: true } };
  }
  const payload = renderChannelTestEmbed(server, hasAdvancedEventRouting(channels));
  let delivery: { messageId: string | null; operation: "edited" | "sent" | "replaced" };
  try {
    delivery = await sendOrEditEventDiscordMessage(env, selected.channel_id, payload, null);
  } catch {
    return {
      status: 502,
      payload: {
        ok: false,
        error: "DISCORD_TEST_MESSAGE_FAILED",
        errorCode: "DISCORD_TEST_MESSAGE_FAILED",
        message: "Discord test message failed. Check that DZN Bot can View Channel, Send Messages, Embed Links, and Read Message History.",
      },
    };
  }
  await recordEventDiscordMessage(env, {
    eventId: "channel-test",
    matchupId: null,
    phaseId: null,
    linkedServerId: server.id,
    guildId: selected.guild_id,
    channelId: selected.channel_id,
    messageId: delivery.messageId,
    messageType: "channel_test",
    status: delivery.operation === "sent" ? "sent" : "editing",
    payloadHash: await hashPayload(payload),
  });
  return { status: 200, payload: { ok: true, message: "Test event message sent.", messageId: delivery.messageId } };
}

export async function processDueEventScoring(env: Env, options: { maxPhases?: number; maxDiscordMessages?: number } = {}) {
  await ensureEventHubSchema(env);
  const db = requireDb(env);
  const now = new Date().toISOString();
  const maxPhases = Math.max(1, Math.min(Math.trunc(Number(options.maxPhases ?? 4)) || 4, 12));
  const phases = await db
    .prepare(
      `SELECT event_challenge_phases.*
       FROM event_challenge_phases
       JOIN event_matchups ON event_matchups.id = event_challenge_phases.matchup_id
       WHERE lower(COALESCE(event_matchups.status, 'pending')) IN ('pending', 'live', 'active', 'finalizing')
         AND datetime(event_challenge_phases.starts_at) <= datetime(?)
         AND datetime(COALESCE(event_challenge_phases.scoring_grace_until, event_challenge_phases.ends_at)) >= datetime(?)
       ORDER BY datetime(event_challenge_phases.starts_at) ASC, event_challenge_phases.phase_number ASC
       LIMIT ?`,
    )
    .bind(now, now, maxPhases)
    .all<PhaseRow>();

  let processed = 0;
  let finalized = 0;
  let discordUpdates = 0;
  const results: Array<Record<string, unknown>> = [];
  for (const phase of phases.results ?? []) {
    const matchup = await fetchMatchup(env, phase.matchup_id);
    if (!matchup) continue;
    processed += 1;
    const result = await scoreAndPersistPhase(env, matchup, phase, now);
    if (result.finalized) finalized += 1;
    if (discordUpdates < Math.max(0, options.maxDiscordMessages ?? 8)) {
      const updates = await updatePhaseDiscordEmbeds(env, matchup, phase, result, Math.max(0, (options.maxDiscordMessages ?? 8) - discordUpdates));
      discordUpdates += updates.updated;
    }
    results.push({ phase_id: phase.id, matchup_id: matchup.id, ...result.summary });
  }
  return { ok: true, processed, finalized, discordUpdates, results };
}

export function buildChallengePhaseTemplates(category: string | null, eventType: string | null) {
  const normalized = normalizeServerCategory(category) ?? "pvp_pve";
  const type = String(eventType ?? "").toLowerCase();
  if (normalized === "deathmatch") {
    return [
      phaseTemplate(1, "Opening Frags", "Most confirmed PvP kills.", "pvp_kill_count", 6, { pointsPerEvent: 3 }),
      phaseTemplate(2, "Headshot Control", "Most headshot kills with allowed weapons.", "pvp_headshot_count", 6, { pointsPerEvent: 5, allowedBodyParts: ["Head", "Brain"] }),
      phaseTemplate(3, "Longshot Pressure", "Distance-qualified PvP kills.", "pvp_distance_qualified_kills", 6, { pointsPerEvent: 4, minDistanceM: 100 }),
      phaseTemplate(4, "Final Sweep", "Final confirmed eliminations.", "pvp_kill_count", 6, { pointsPerEvent: 3 }),
    ];
  }
  if (normalized === "pve") {
    return [
      phaseTemplate(1, "Survival Window", "Unique active players and session activity.", "player_activity_time", 12, { pointsPerEvent: 1 }),
      phaseTemplate(2, "Build the Stronghold", "Build and base expansion activity.", "build_score", 24, { pointsPerEvent: 1 }),
      phaseTemplate(3, "Territory Control", "Flags raised and territory activity.", "flags_raised", 12, { pointsPerEvent: 10 }),
    ];
  }
  if (normalized === "pvp") {
    return [
      phaseTemplate(1, "Opening Shots", "PvP headshot kills.", "pvp_headshot_count", 12, { pointsPerEvent: 5, minDistanceM: 75 }),
      phaseTemplate(2, "Confirmed Eliminations", "Rifle-class confirmed PvP kills.", "pvp_kill_count", 12, { pointsPerEvent: 3, allowedWeaponClasses: ["rifle", "ar"] }),
      phaseTemplate(3, "Longshot Control", "Distance-qualified PvP kills.", "pvp_distance_qualified_kills", 12, { pointsPerEvent: 4, minDistanceM: 100 }),
      phaseTemplate(4, "Final Push", "Mixed PvP push.", "pvp_kill_count", 12, { pointsPerEvent: 3 }),
    ];
  }
  return [
    phaseTemplate(1, "Opening Shots", "PvP headshot kills with distance pressure.", "pvp_headshot_count", 12, { pointsPerEvent: 5, allowedWeapons: ["M4-A1", "Mosin", "Tundra", "Blaze"], minDistanceM: 75 }),
    phaseTemplate(2, "Confirmed Eliminations", "Confirmed PvP kills.", "pvp_kill_count", 12, { pointsPerEvent: 3, allowedWeaponClasses: ["rifle", "ar"] }),
    phaseTemplate(3, "Hold the Line", "Activity and survival pressure.", "player_activity_time", 12, { pointsPerEvent: 1 }),
    phaseTemplate(4, "Build the Forward Base", "Build/base/territory activity.", "build_score", 12, { pointsPerEvent: 1 }),
    phaseTemplate(5, "Longshot Control", "Distance-qualified kills.", "pvp_distance_qualified_kills", 12, { pointsPerEvent: 4, minDistanceM: 100 }),
    phaseTemplate(6, "Final Push", "Mixed score from PvP and activity.", type === "survival_challenge" ? "build_score" : "pvp_kill_count", 12, { pointsPerEvent: 3 }),
  ];
}

export function renderEventProgressBar(scoreA: number, scoreB: number, width = 12) {
  const total = Math.max(1, scoreA + scoreB);
  const left = Math.max(0, Math.min(width, Math.round((scoreA / total) * width)));
  return `${"█".repeat(left)}🏳️${"░".repeat(Math.max(0, width - left))}`;
}

function groupEventsForOwner(events: EventHubEventRow[], context: EventEligibilityContext) {
  const available: unknown[] = [];
  const locked: unknown[] = [];
  for (const event of events) {
    const eligibility = getEventEligibility(event, context);
    const summary = serializeEventCard(event, eligibility, context);
    if (eligibility.alreadyEntered) continue;
    if (eligibility.canEnter) available.push(summary);
    else locked.push(summary);
  }
  return { available, locked };
}

type EventEligibilityContext = {
  server: OwnerServerRow;
  category: ServerCategory | null;
  channels: SavedChannelRow[];
  cooldownUntil: string | null;
  admReady: boolean;
};

function getEventEligibility(event: EventHubEventRow, context: EventEligibilityContext) {
  const status = normalizeEventStatus(event.status) ?? "upcoming";
  const requiredPlan = normalizeRequiredPlan(event.premium_tier);
  const plan = normalizePlanKey(context.server.plan_key);
  const subscriptionActive = isActiveSubscription(context.server.subscription_status);
  const serverCategory = context.category;
  const eventCategory = normalizeServerCategory(event.category);
  const requiresDiscord = eventRequiresDiscord(event);
  const publicListingActive = String(context.server.listing_visibility ?? "public").toLowerCase() !== "hidden";
  const setupComplete = Boolean(context.server.guild_id && context.server.nitrado_service_id);
  const entered = Boolean(event.entered_entry_id);
  const entryOpen = ["registration_open", "upcoming"].includes(status);

  if (entered) return eligibility(true, "ALREADY_ENTERED", "Server is already entered.", "View Entry", true);
  if (!entryOpen) return eligibility(false, "EVENT_NOT_OPEN", "Entries are closed for this event.", status === "live" ? "View Live Matchup" : "Entries Closed");
  if (!setupComplete) return eligibility(false, "SETUP_INCOMPLETE", "Complete setup before entering events.", "Complete Setup");
  if (!serverCategory) return eligibility(false, "CATEGORY_REQUIRED", "Set your server category before entering category-matched events.", "Set Category");
  if (!isCategoryEligible(serverCategory, eventCategory, event)) return eligibility(false, "CATEGORY_MISMATCH", "This event is for a different server category.", "Change Category");
  if (!planAllowsEvent(requiredPlan, plan, subscriptionActive)) return eligibility(false, "PLAN_REQUIRED", `This event requires ${requiredPlan.toUpperCase()} access.`, "Upgrade");
  if (context.cooldownUntil && Date.parse(context.cooldownUntil) > Date.now()) return eligibility(false, "EVENT_COOLDOWN_ACTIVE", "This server is cooling down after a completed official event.", "Cooldown Active");
  if (!context.admReady) return eligibility(false, "ADM_SYNC_REQUIRED", "ADM sync must have recent successful evidence before event entry.", "View Sync Health");
  if (!publicListingActive) return eligibility(false, "PUBLIC_LISTING_REQUIRED", "Public listing must be active to enter this event.", "Open Server Settings");
  if (requiresDiscord && !hasUsablePrimaryEventChannel(context.channels)) {
    return eligibility(false, "DISCORD_EVENT_CHANNEL_REQUIRED", "Choose a Primary Event Channel before entering events that require Discord updates.", "Choose Channel");
  }
  if (Number(event.server_limit ?? event.team_limit ?? 0) > 0 && Number(event.registered_servers ?? 0) >= Number(event.server_limit ?? event.team_limit ?? 0)) {
    return eligibility(false, "EVENT_FULL", "This event is full.", "Event Full");
  }
  return eligibility(true, null, "Server can enter this event.", "Enter Event");
}

function eligibility(canEnter: boolean, code: string | null, message: string, action: string, alreadyEntered = false) {
  return { canEnter, code, message, action, alreadyEntered };
}

function serializeEventCard(event: EventHubEventRow, eligibility: ReturnType<typeof getEventEligibility>, context: EventEligibilityContext) {
  const category = normalizeServerCategory(event.category);
  const phaseCount = sanitizeInteger(event.phase_count, defaultPhaseCount(event));
  const phaseHours = sanitizeInteger(event.phase_duration_hours, defaultPhaseDurationHours(event));
  const durationHours = sanitizeInteger(event.matchup_duration_hours, phaseCount * phaseHours);
  return {
    id: event.id,
    slug: event.slug,
    title: event.name,
    description: event.description ?? "",
    eventType: event.event_type ?? "challenge",
    eventTypeLabel: eventTypeLabel(event.event_type),
    category: category ?? "open",
    categoryLabel: category ? getServerCategoryLabel(category) : "Open",
    requiredPlan: normalizeRequiredPlan(event.premium_tier),
    startTime: event.starts_at,
    endTime: event.ends_at,
    entryDeadline: event.entry_deadline_at ?? event.starts_at,
    matchupDurationHours: durationHours,
    phaseDurationHours: phaseHours,
    challengePhaseDuration: `${phaseHours} hours`,
    enteredServersCount: Number(event.registered_servers ?? 0),
    maxEntries: Number(event.server_limit ?? event.team_limit ?? 0) || null,
    scoringSource: "Scored automatically from ADM sync",
    requiresDiscordPosting: eventRequiresDiscord(event),
    selectedDiscordEventChannel: serializeSavedChannel(findUsableEventChannel(context.channels, "default_event")),
    discordRoutingAdvanced: hasAdvancedEventRouting(context.channels),
    rewards: event.rewards,
    rulesSummary: event.rules,
    eligibility,
    cta: eligibility.action,
    status: normalizeEventStatus(event.status) ?? "upcoming",
  };
}

function serializeOwnerServer(server: OwnerServerRow, adm: Awaited<ReturnType<typeof getAdmEligibility>>, channelStatus: ReturnType<typeof summarizeChannelStatus>) {
  const category = normalizeServerCategory(server.server_category);
  return {
    id: server.id,
    name: serverDisplayName(server),
    category,
    categoryLabel: getServerCategoryLabel(category),
    planKey: normalizePlanKey(server.plan_key),
    subscriptionStatus: server.subscription_status ?? "inactive",
    admSync: adm,
    discordConnected: Boolean(server.guild_id),
    botConfigured: Boolean(channelStatus.botConfigured),
    selectedDiscordEventChannel: channelStatus.selectedChannel,
    publicListingStatus: String(server.listing_visibility ?? "public").toLowerCase() === "hidden" ? "hidden" : "public",
    setupComplete: Boolean(server.guild_id && server.nitrado_service_id),
    playerCount: Number(server.current_players ?? 0),
    maxPlayers: Number(server.max_players ?? 0),
  };
}

function serializeSavedChannels(rows: SavedChannelRow[]) {
  return EVENT_CHANNEL_TYPES.reduce<Record<EventChannelType, ReturnType<typeof serializeSavedChannel>>>((acc, type) => {
    acc[type] = serializeSavedChannel(rows.find((row) => row.channel_type === type) ?? null);
    return acc;
  }, {
    default_event: null,
    event_announcements: null,
    event_live_scoreboard: null,
    event_results: null,
  });
}

function serializeSavedChannel(row: SavedChannelRow | null | undefined) {
  if (!row) return null;
  const missingPermissions = [
    Number(row.bot_can_view ?? 0) === 1 ? null : "View Channel",
    Number(row.bot_can_send ?? 0) === 1 ? null : "Send Messages",
    Number(row.bot_can_embed ?? 0) === 1 ? null : "Embed Links",
    Number(row.bot_can_read_history ?? 0) === 1 ? null : "Read Message History",
  ].filter(Boolean);
  return {
    channelId: row.channel_id,
    channelName: row.channel_name,
    channelType: row.channel_type,
    channelKind: row.channel_kind,
    valid: missingPermissions.length === 0,
    missingPermissions,
    lastVerifiedAt: row.last_verified_at,
    updatedAt: row.updated_at,
  };
}

function summarizeChannelStatus(env: Env, server: OwnerServerRow, rows: SavedChannelRow[]) {
  const selected = findUsableEventChannel(rows, "default_event");
  const ready = Boolean(selected && isSavedChannelUsable(selected));
  return {
    ready,
    label: ready ? "Discord Event Channel Ready" : "Discord Event Channel Missing",
    selectedChannel: serializeSavedChannel(selected),
    advancedRoutingEnabled: hasAdvancedEventRouting(rows),
    guildId: server.guild_id ?? server.discord_guild_id,
    guildName: server.guild_name,
    botConfigured: Boolean(cleanBotToken(env.DISCORD_BOT_TOKEN)) || rows.some(isSavedChannelUsable),
  };
}

function channelListPayload(server: OwnerServerRow, guildId: string, saved: SavedChannelRow[], channels: DiscordPostingChannel[]) {
  return {
    ok: true,
    guildId,
    guildName: server.guild_name,
    selected: serializeSavedChannels(saved),
    channels: channels.map((channel) => ({
      id: channel.channel_id,
      name: channel.channel_name,
      type: channel.channel_type,
      categoryName: channel.category_name,
      canSelect: channel.can_post,
      botCanView: channel.can_view,
      botCanSend: channel.can_send,
      botCanEmbed: channel.can_embed,
      botCanReadHistory: channel.can_read_history,
      missingPermissions: channel.missing_permissions,
    })),
  };
}

async function fetchOwnerServer(env: Env, user: SessionUser, serverId: string) {
  const row = await requireDb(env)
    .prepare(
      `SELECT linked_servers.*,
              discord_guilds.name AS guild_name,
              server_subscriptions.plan_key,
              server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN discord_guilds
         ON discord_guilds.guild_id = linked_servers.guild_id
         OR discord_guilds.id = linked_servers.discord_guild_id
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE (linked_servers.id = ? OR linked_servers.nitrado_service_id = ? OR linked_servers.public_slug = ?)
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
       ORDER BY server_subscriptions.updated_at DESC, server_subscriptions.created_at DESC
       LIMIT 1`,
    )
    .bind(serverId, serverId, serverId)
    .first<OwnerServerRow>();
  if (!row) return null;
  if (row.user_id === user.id || isDznAdminDiscordId(env, user.discord_id)) return row;
  return null;
}

function mapDiscordChannelFetchError(error: unknown) {
  if (error instanceof DiscordChannelFetchError) {
    if (error.code === "missing_bot_token") {
      return { error: "BOT_NOT_INSTALLED", httpStatus: 409, message: "Add DZN Bot in Setup before choosing event channels." };
    }
    if (error.code === "discord_api_403") {
      return { error: "BOT_MISSING_PERMISSIONS", httpStatus: 409, message: "DZN Bot cannot view channels in this Discord server. Check bot permissions in Discord." };
    }
    if (error.code === "bot_not_in_guild") {
      return { error: "BOT_NOT_INSTALLED", httpStatus: 409, message: "Add DZN Bot in Setup before choosing event channels." };
    }
    if (error.status === 429) {
      return { error: "RATE_LIMITED", httpStatus: 429, message: "Discord rate limited channel lookup. Retry in a moment." };
    }
  }
  return { error: "DISCORD_CHANNELS_UNAVAILABLE", httpStatus: 502, message: "Discord channels could not be loaded right now. Retry in a moment." };
}

async function fetchOwnerVisibleEvents(env: Env, linkedServerId: string) {
  const result = await requireDb(env)
    .prepare(
      `SELECT competitive_events.*,
              (SELECT COUNT(*) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS registered_servers,
              server_event_entries.id AS entered_entry_id,
              server_event_entries.status AS entered_status
       FROM competitive_events
       LEFT JOIN server_event_entries
         ON server_event_entries.event_id = competitive_events.id
        AND server_event_entries.linked_server_id = ?
        AND lower(COALESCE(server_event_entries.status, '')) NOT IN ('withdrawn', 'cancelled', 'canceled')
       WHERE COALESCE(competitive_events.visibility, 'public') != 'private'
       ORDER BY CASE competitive_events.status
         WHEN 'live' THEN 0
         WHEN 'registration_open' THEN 1
         WHEN 'upcoming' THEN 2
         WHEN 'standby' THEN 3
         ELSE 4
       END, datetime(COALESCE(competitive_events.starts_at, competitive_events.created_at)) ASC
       LIMIT 80`,
    )
    .bind(linkedServerId)
    .all<EventHubEventRow>();
  return result.results ?? [];
}

async function fetchEventByIdOrSlug(env: Env, eventIdOrSlug: string) {
  const result = await requireDb(env)
    .prepare(
      `SELECT competitive_events.*,
              (SELECT COUNT(*) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS registered_servers,
              NULL AS entered_entry_id,
              NULL AS entered_status
       FROM competitive_events
       WHERE id = ? OR slug = ?
       LIMIT 1`,
    )
    .bind(eventIdOrSlug, eventIdOrSlug)
    .first<EventHubEventRow>();
  return result;
}

async function fetchEntries(env: Env, linkedServerId: string) {
  const result = await requireDb(env)
    .prepare(
      `SELECT server_event_entries.id, server_event_entries.event_id, server_event_entries.status,
              server_event_entries.entered_at, server_event_entries.completed_at,
              competitive_events.name, competitive_events.slug, competitive_events.event_type,
              competitive_events.category, competitive_events.starts_at, competitive_events.ends_at
       FROM server_event_entries
       JOIN competitive_events ON competitive_events.id = server_event_entries.event_id
       WHERE server_event_entries.linked_server_id = ?
       ORDER BY datetime(COALESCE(server_event_entries.entered_at, server_event_entries.created_at)) DESC
       LIMIT 30`,
    )
    .bind(linkedServerId)
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

async function fetchLiveMatchups(env: Env, linkedServerId: string) {
  const result = await requireDb(env)
    .prepare(
      `SELECT event_matchups.*,
              competitive_events.name AS event_name,
              competitive_events.event_type AS event_type,
              a.display_name AS server_a_name,
              b.display_name AS server_b_name
       FROM event_matchups
       JOIN competitive_events ON competitive_events.id = event_matchups.event_id
       LEFT JOIN linked_servers AS a ON a.id = event_matchups.server_a_id
       LEFT JOIN linked_servers AS b ON b.id = event_matchups.server_b_id
       WHERE event_matchups.server_a_id = ? OR event_matchups.server_b_id = ?
       ORDER BY datetime(COALESCE(event_matchups.starts_at, event_matchups.created_at)) DESC
       LIMIT 30`,
    )
    .bind(linkedServerId, linkedServerId)
    .all<MatchupRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    eventId: row.event_id,
    eventName: row.event_name,
    eventType: row.event_type,
    roundNumber: Number(row.round_number ?? 1),
    status: row.status ?? "pending",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    scoringGraceUntil: row.scoring_grace_until,
    serverA: { id: row.server_a_id, name: row.server_a_name ?? "Server A", score: Number(row.server_a_score ?? 0) },
    serverB: { id: row.server_b_id, name: row.server_b_name ?? "Server B", score: Number(row.server_b_score ?? 0) },
  }));
}

async function getSavedEventChannels(env: Env, linkedServerId: string) {
  const result = await requireDb(env)
    .prepare(
      `SELECT *
       FROM server_discord_channel_settings
       WHERE linked_server_id = ?
       ORDER BY CASE channel_type
         WHEN 'event_live_scoreboard' THEN 0
         WHEN 'default_event' THEN 1
         WHEN 'event_announcements' THEN 2
         WHEN 'event_results' THEN 3
         ELSE 4
       END`,
    )
    .bind(linkedServerId)
    .all<SavedChannelRow>()
    .catch(() => ({ results: [] as SavedChannelRow[] }));
  return result.results ?? [];
}

export async function getSavedDiscordEventChannelSummary(env: Env, linkedServerId: string) {
  await ensureEventHubSchema(env);
  const rows = await getSavedEventChannels(env, linkedServerId);
  return {
    selected: serializeSavedChannels(rows),
    liveScoreboardReady: hasUsableEventChannel(rows, "event_live_scoreboard"),
    defaultReady: hasUsableEventChannel(rows, "default_event"),
  };
}

async function upsertEventChannelSetting(env: Env, linkedServerId: string, guildId: string, channelType: EventChannelType, channel: DiscordPostingChannel, userId: string) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await requireDb(env)
    .prepare(
      `INSERT INTO server_discord_channel_settings (
        id, linked_server_id, server_id, guild_id, channel_type, channel_id, channel_name, channel_kind,
        bot_can_view, bot_can_send, bot_can_embed, bot_can_read_history, last_verified_at,
        selected_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(linked_server_id, channel_type) DO UPDATE SET
        guild_id = excluded.guild_id,
        channel_id = excluded.channel_id,
        channel_name = excluded.channel_name,
        channel_kind = excluded.channel_kind,
        bot_can_view = excluded.bot_can_view,
        bot_can_send = excluded.bot_can_send,
        bot_can_embed = excluded.bot_can_embed,
        bot_can_read_history = excluded.bot_can_read_history,
        last_verified_at = excluded.last_verified_at,
        selected_by_user_id = excluded.selected_by_user_id,
        updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      linkedServerId,
      linkedServerId,
      guildId,
      channelType,
      channel.channel_id,
      channel.channel_name,
      channel.channel_type,
      channel.can_view ? 1 : 0,
      channel.can_send ? 1 : 0,
      channel.can_embed ? 1 : 0,
      channel.can_read_history ? 1 : 0,
      now,
      userId,
      now,
      now,
    )
    .run();
  return {
    id,
    linked_server_id: linkedServerId,
    guild_id: guildId,
    channel_type: channelType,
    channel_id: channel.channel_id,
    channel_name: channel.channel_name,
    channel_kind: channel.channel_type,
    bot_can_view: channel.can_view ? 1 : 0,
    bot_can_send: channel.can_send ? 1 : 0,
    bot_can_embed: channel.can_embed ? 1 : 0,
    bot_can_read_history: channel.can_read_history ? 1 : 0,
    last_verified_at: now,
    updated_at: now,
  } satisfies SavedChannelRow;
}

async function getActiveEventCooldown(env: Env, linkedServerId: string) {
  return requireDb(env)
    .prepare(
      `SELECT event_type, plan_key, cooldown_until, source_event_id, reason
       FROM event_cooldowns
       WHERE linked_server_id = ?
         AND datetime(cooldown_until) > datetime('now')
       ORDER BY datetime(cooldown_until) DESC
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<Record<string, string | null>>()
    .catch(() => null);
}

async function getAdmEligibility(env: Env, linkedServerId: string) {
  const row = await requireDb(env)
    .prepare(
      `SELECT latest_adm_file, last_processed_file, last_successful_import_at, last_sync_status
       FROM adm_sync_state
       WHERE linked_server_id = ?
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ latest_adm_file: string | null; last_processed_file: string | null; last_successful_import_at: string | null; last_sync_status: string | null }>()
    .catch(() => null);
  const job = await requireDb(env)
    .prepare(
      `SELECT status, completed_at, updated_at
       FROM adm_import_jobs
       WHERE linked_server_id = ?
         AND source = 'scheduled_nitrado'
       ORDER BY datetime(COALESCE(completed_at, updated_at, created_at)) DESC
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ status: string | null; completed_at: string | null; updated_at: string | null }>()
    .catch(() => null);
  const recentImportAt = row?.last_successful_import_at ?? job?.completed_at ?? job?.updated_at ?? null;
  return {
    ready: Boolean(recentImportAt || row?.latest_adm_file || job),
    latestAdmFile: row?.latest_adm_file ?? null,
    lastProcessedFile: row?.last_processed_file ?? null,
    lastSuccessfulImportAt: recentImportAt,
    status: row?.last_sync_status ?? job?.status ?? "waiting",
  };
}

async function maybeCreateInitialMatchupAndPhases(env: Env, eventId: string) {
  const db = requireDb(env);
  const existing = await db.prepare("SELECT id FROM event_matchups WHERE event_id = ? LIMIT 1").bind(eventId).first<{ id: string }>();
  if (existing) return;
  const entries = await db
    .prepare(
      `SELECT server_event_entries.id, server_event_entries.linked_server_id
       FROM server_event_entries
       WHERE event_id = ?
         AND lower(COALESCE(status, 'entered')) = 'entered'
       ORDER BY datetime(entered_at) ASC
       LIMIT 2`,
    )
    .bind(eventId)
    .all<{ id: string; linked_server_id: string }>();
  const pair = entries.results ?? [];
  if (pair.length < 2) return;
  const event = await fetchEventByIdOrSlug(env, eventId);
  if (!event) return;
  const now = new Date();
  const durationHours = sanitizeInteger(event.matchup_duration_hours, defaultMatchupDurationHours(event));
  const phaseHours = sanitizeInteger(event.phase_duration_hours, defaultPhaseDurationHours(event));
  const phaseCount = sanitizeInteger(event.phase_count, defaultPhaseCount(event));
  const startsAt = event.starts_at && Date.parse(event.starts_at) > Date.now() ? new Date(event.starts_at) : now;
  const endsAt = new Date(startsAt.getTime() + durationHours * 60 * 60 * 1000);
  const matchupId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO event_matchups (
        id, event_id, round_number, server_a_entry_id, server_b_entry_id, server_a_id, server_b_id,
        status, starts_at, ends_at, scoring_grace_until, server_a_score, server_b_score, created_at, updated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, 'pending', ?, ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(matchupId, event.id, pair[0].id, pair[1].id, pair[0].linked_server_id, pair[1].linked_server_id, startsAt.toISOString(), endsAt.toISOString(), addMinutes(endsAt, 30).toISOString())
    .run();
  const templates = buildChallengePhaseTemplates(event.category, event.event_type).slice(0, phaseCount);
  for (const template of templates) {
    const phaseStart = new Date(startsAt.getTime() + (template.phaseNumber - 1) * phaseHours * 60 * 60 * 1000);
    const phaseEnd = new Date(phaseStart.getTime() + phaseHours * 60 * 60 * 1000);
    await db
      .prepare(
        `INSERT INTO event_challenge_phases (
          id, event_id, matchup_id, phase_number, title, description, category_scope, metric_type,
          scoring_rules_json, starts_at, ends_at, scoring_grace_until, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        crypto.randomUUID(),
        event.id,
        matchupId,
        template.phaseNumber,
        template.title,
        template.description,
        event.category ?? "open",
        template.metricType,
        JSON.stringify(template.scoringRules),
        phaseStart.toISOString(),
        phaseEnd.toISOString(),
        addMinutes(phaseEnd, 30).toISOString(),
        template.phaseNumber === 1 ? "active" : "upcoming",
      )
      .run();
  }
}

async function scoreAndPersistPhase(env: Env, matchup: MatchupRow, phase: PhaseRow, nowIso: string) {
  const [scoreA, scoreB] = await Promise.all([
    calculatePhaseScore(env, matchup.server_a_id, phase),
    calculatePhaseScore(env, matchup.server_b_id, phase),
  ]);
  const finalized = Date.parse(nowIso) > Date.parse(phase.scoring_grace_until ?? phase.ends_at);
  const winner = finalized
    ? scoreA.score === scoreB.score
      ? null
      : scoreA.score > scoreB.score ? matchup.server_a_id : matchup.server_b_id
    : null;
  const db = requireDb(env);
  await upsertPhaseScore(env, phase, matchup.server_a_id, scoreA, finalized);
  await upsertPhaseScore(env, phase, matchup.server_b_id, scoreB, finalized);
  await db
    .prepare(
      `UPDATE event_challenge_phases
       SET server_a_score = ?, server_b_score = ?, winner_server_id = ?,
           status = ?, finalized_at = CASE WHEN ? = 1 THEN COALESCE(finalized_at, ?) ELSE finalized_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(scoreA.score, scoreB.score, winner, finalized ? "finalized" : Date.parse(nowIso) > Date.parse(phase.ends_at) ? "finalizing" : "active", finalized ? 1 : 0, nowIso, phase.id)
    .run();
  await db
    .prepare(
      `UPDATE event_matchups
       SET server_a_score = (
             SELECT COALESCE(SUM(score), 0) FROM event_phase_scores
             WHERE matchup_id = ? AND linked_server_id = ?
           ),
           server_b_score = (
             SELECT COALESCE(SUM(score), 0) FROM event_phase_scores
             WHERE matchup_id = ? AND linked_server_id = ?
           ),
           status = CASE WHEN datetime(COALESCE(scoring_grace_until, ends_at)) < datetime(?) THEN 'completed' ELSE 'live' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(matchup.id, matchup.server_a_id, matchup.id, matchup.server_b_id, nowIso, matchup.id)
    .run();
  return {
    finalized,
    scoreA,
    scoreB,
    summary: {
      server_a_score: scoreA.score,
      server_b_score: scoreB.score,
      server_a_events: scoreA.qualifyingEventsCount,
      server_b_events: scoreB.qualifyingEventsCount,
      winner_server_id: winner,
    },
  };
}

async function calculatePhaseScore(env: Env, linkedServerId: string, phase: PhaseRow): Promise<PhaseScore> {
  const metric = phase.metric_type;
  const rules = parseRules(phase.scoring_rules_json);
  if (PVP_METRICS.has(metric)) return calculatePvpScore(env, linkedServerId, phase, rules);
  if (BUILD_METRICS.has(metric)) return calculateBuildScore(env, linkedServerId, phase, rules);
  return calculatePlayerActivityScore(env, linkedServerId, phase, rules);
}

async function calculatePvpScore(env: Env, linkedServerId: string, phase: PhaseRow, rules: Record<string, unknown>): Promise<PhaseScore> {
  const bindings: unknown[] = [linkedServerId, phase.starts_at, phase.ends_at];
  const conditions = ["linked_server_id = ?", "datetime(COALESCE(occurred_at, created_at)) >= datetime(?)", "datetime(COALESCE(occurred_at, created_at)) < datetime(?)"];
  const minDistance = numberOrNull(rules.minDistanceM);
  if (minDistance !== null) {
    conditions.push("COALESCE(distance, 0) >= ?");
    bindings.push(minDistance);
  }
  if (phase.metric_type === "pvp_headshot_count") {
    conditions.push("(raw_line LIKE '%Head%' OR raw_line LIKE '%Brain%' OR raw_line LIKE '%headshot%' OR raw_line LIKE '%head shot%')");
  }
  const weapons = arrayOfStrings(rules.allowedWeapons);
  if (weapons.length) {
    conditions.push(`lower(COALESCE(weapon, '')) IN (${weapons.map(() => "?").join(", ")})`);
    bindings.push(...weapons.map((weapon) => weapon.toLowerCase()));
  }
  const row = await requireDb(env)
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(MAX(distance), 0) AS longest
       FROM kill_events
       WHERE ${conditions.join(" AND ")}`,
    )
    .bind(...bindings)
    .first<{ count: number | null; longest: number | null }>();
  const count = Number(row?.count ?? 0);
  const pointsPerEvent = numberOrNull(rules.pointsPerEvent) ?? (phase.metric_type === "pvp_headshot_count" ? 5 : 3);
  const score = phase.metric_type === "pvp_longest_kill" ? Math.round(Number(row?.longest ?? 0)) : count * pointsPerEvent;
  return { score, qualifyingEventsCount: count, breakdown: { metric: phase.metric_type, count, longest: Number(row?.longest ?? 0), pointsPerEvent } };
}

async function calculateBuildScore(env: Env, linkedServerId: string, phase: PhaseRow, rules: Record<string, unknown>): Promise<PhaseScore> {
  const row = await requireDb(env)
    .prepare(
      `SELECT
          COUNT(*) AS count,
          SUM(CASE WHEN event_type = 'built' THEN 1 ELSE 0 END) AS built,
          SUM(CASE WHEN event_type = 'placed' AND lower(COALESCE(placed_class, '')) LIKE '%crate%' THEN 1 ELSE 0 END) AS storage,
          SUM(CASE WHEN event_type = 'flag_raised' THEN 1 ELSE 0 END) AS flags,
          SUM(CASE
            WHEN event_type = 'built' THEN 10
            WHEN event_type = 'placed' THEN 3
            WHEN event_type = 'flag_raised' THEN 8
            ELSE 0
          END) AS score
       FROM build_events
       WHERE linked_server_id = ?
         AND datetime(occurred_at) >= datetime(?)
         AND datetime(occurred_at) < datetime(?)
         AND event_type IN ('built', 'placed', 'flag_raised')`,
    )
    .bind(linkedServerId, phase.starts_at, phase.ends_at)
    .first<{ count: number | null; built: number | null; storage: number | null; flags: number | null; score: number | null }>()
    .catch(() => ({ count: 0, built: 0, storage: 0, flags: 0, score: 0 }));
  const pointsPerEvent = numberOrNull(rules.pointsPerEvent);
  const count = Number(row?.count ?? 0);
  const rawScore = Number(row?.score ?? 0);
  return {
    score: pointsPerEvent ? count * pointsPerEvent : rawScore,
    qualifyingEventsCount: count,
    breakdown: { metric: phase.metric_type, built: Number(row?.built ?? 0), storage: Number(row?.storage ?? 0), flags: Number(row?.flags ?? 0) },
  };
}

async function calculatePlayerActivityScore(env: Env, linkedServerId: string, phase: PhaseRow, rules: Record<string, unknown>): Promise<PhaseScore> {
  const row = await requireDb(env)
    .prepare(
      `SELECT COUNT(*) AS count, COUNT(DISTINCT COALESCE(player_id, player_name)) AS unique_players
       FROM player_events
       WHERE linked_server_id = ?
         AND datetime(COALESCE(occurred_at, created_at)) >= datetime(?)
         AND datetime(COALESCE(occurred_at, created_at)) < datetime(?)
         AND event_type NOT LIKE 'player_hit%'`,
    )
    .bind(linkedServerId, phase.starts_at, phase.ends_at)
    .first<{ count: number | null; unique_players: number | null }>()
    .catch(() => ({ count: 0, unique_players: 0 }));
  const pointsPerEvent = numberOrNull(rules.pointsPerEvent) ?? 1;
  const count = Number(row?.count ?? 0);
  return { score: count * pointsPerEvent, qualifyingEventsCount: count, breakdown: { metric: phase.metric_type, uniquePlayers: Number(row?.unique_players ?? 0), pointsPerEvent } };
}

async function upsertPhaseScore(env: Env, phase: PhaseRow, linkedServerId: string, score: PhaseScore, finalized: boolean) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO event_phase_scores (
        id, event_id, matchup_id, phase_id, linked_server_id, score, qualifying_events_count,
        breakdown_json, last_scored_at, finalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(phase_id, linked_server_id) DO UPDATE SET
        score = excluded.score,
        qualifying_events_count = excluded.qualifying_events_count,
        breakdown_json = excluded.breakdown_json,
        last_scored_at = excluded.last_scored_at,
        finalized_at = COALESCE(event_phase_scores.finalized_at, excluded.finalized_at)`,
    )
    .bind(crypto.randomUUID(), phase.event_id, phase.matchup_id, phase.id, linkedServerId, score.score, score.qualifyingEventsCount, JSON.stringify(score.breakdown), now, finalized ? now : null)
    .run();
}

async function fetchMatchup(env: Env, matchupId: string) {
  return requireDb(env)
    .prepare(
      `SELECT event_matchups.*,
              competitive_events.name AS event_name,
              competitive_events.event_type AS event_type,
              COALESCE(a.display_name, a.hostname, a.server_name, a.nitrado_service_name) AS server_a_name,
              COALESCE(b.display_name, b.hostname, b.server_name, b.nitrado_service_name) AS server_b_name
       FROM event_matchups
       JOIN competitive_events ON competitive_events.id = event_matchups.event_id
       JOIN linked_servers AS a ON a.id = event_matchups.server_a_id
       JOIN linked_servers AS b ON b.id = event_matchups.server_b_id
       WHERE event_matchups.id = ?
       LIMIT 1`,
    )
    .bind(matchupId)
    .first<MatchupRow>();
}

async function updatePhaseDiscordEmbeds(
  env: Env,
  matchup: MatchupRow,
  phase: PhaseRow,
  scoring: Awaited<ReturnType<typeof scoreAndPersistPhase>>,
  maxUpdates: number,
) {
  if (maxUpdates <= 0) return { updated: 0 };
  const rows = await requireDb(env)
    .prepare(
      `SELECT linked_servers.id AS linked_server_id,
              linked_servers.guild_id,
              server_discord_channel_settings.channel_id,
              server_discord_channel_settings.guild_id AS channel_guild_id
       FROM linked_servers
       LEFT JOIN server_discord_channel_settings
         ON server_discord_channel_settings.linked_server_id = linked_servers.id
        AND server_discord_channel_settings.channel_type IN ('event_live_scoreboard', 'default_event')
       WHERE linked_servers.id IN (?, ?)
       ORDER BY CASE server_discord_channel_settings.channel_type WHEN 'event_live_scoreboard' THEN 0 ELSE 1 END`,
    )
    .bind(matchup.server_a_id, matchup.server_b_id)
    .all<{ linked_server_id: string; guild_id: string | null; channel_id: string | null; channel_guild_id: string | null }>();
  let updated = 0;
  const seen = new Set<string>();
  for (const row of rows.results ?? []) {
    if (updated >= maxUpdates || seen.has(row.linked_server_id) || !row.channel_id) continue;
    seen.add(row.linked_server_id);
    const existing = await requireDb(env)
      .prepare(
        `SELECT message_id, last_payload_hash
         FROM event_discord_messages
         WHERE phase_id = ? AND linked_server_id = ? AND message_type = 'phase_live'
         ORDER BY datetime(updated_at) DESC
         LIMIT 1`,
      )
      .bind(phase.id, row.linked_server_id)
      .first<{ message_id: string | null; last_payload_hash: string | null }>();
    const payload = renderPhaseLiveEmbed(matchup, phase, scoring);
    const hash = await hashPayload(payload);
    if (existing?.last_payload_hash === hash) continue;
    try {
      const delivery = await sendOrEditEventDiscordMessage(env, row.channel_id, payload, existing?.message_id ?? null);
      await recordEventDiscordMessage(env, {
        eventId: matchup.event_id,
        matchupId: matchup.id,
        phaseId: phase.id,
        linkedServerId: row.linked_server_id,
        guildId: row.channel_guild_id ?? row.guild_id ?? "",
        channelId: row.channel_id,
        messageId: delivery.messageId,
        messageType: scoring.finalized ? "phase_final" : "phase_live",
        status: delivery.operation === "edited" ? "editing" : "sent",
        payloadHash: hash,
      });
      updated += 1;
    } catch (error) {
      await recordEventDiscordFailure(env, matchup, phase, row, error);
    }
  }
  return { updated };
}

function renderPhaseLiveEmbed(matchup: MatchupRow, phase: PhaseRow, scoring: Awaited<ReturnType<typeof scoreAndPersistPhase>>) {
  const scoreA = scoring.scoreA.score;
  const scoreB = scoring.scoreB.score;
  const leader = scoreA === scoreB ? "Tied" : scoreA > scoreB ? matchup.server_a_name ?? "Server A" : matchup.server_b_name ?? "Server B";
  return {
    embeds: [{
      title: `DZN Capture the Flag: ${matchup.server_a_name ?? "Server A"} vs ${matchup.server_b_name ?? "Server B"}`,
      description: `Phase ${phase.phase_number} — ${phase.title}\n\n${matchup.server_a_name ?? "Server A"} ${renderEventProgressBar(scoreA, scoreB)} ${matchup.server_b_name ?? "Server B"}\nScore: ${scoreA} - ${scoreB}`,
      color: 0x8b5cf6,
      fields: [
        { name: "Current leader", value: leader, inline: true },
        { name: "Phase objective", value: phase.description ?? phase.metric_type, inline: true },
        { name: "ADM sync status", value: scoring.finalized ? "Finalized from ADM" : "Scored automatically from ADM Sync", inline: true },
        { name: "Time window", value: `${phase.starts_at} to ${phase.ends_at}`, inline: false },
      ],
      footer: { text: "Scored automatically from DZN ADM Sync. Updates every 5 minutes." },
      timestamp: new Date().toISOString(),
    }],
  };
}

function renderChannelTestEmbed(server: OwnerServerRow, advancedRoutingEnabled = false) {
  return {
    embeds: [{
      title: "DZN Event Channel Connected",
      description: `DZN will post event announcements, live scoreboards, and final results here unless advanced routing is configured.${advancedRoutingEnabled ? "\n\nAdvanced routing is enabled for this server." : ""}`,
      color: 0x22d3ee,
      fields: [{ name: "Server", value: serverDisplayName(server), inline: true }],
      footer: { text: "DZN Event Hub" },
      timestamp: new Date().toISOString(),
    }],
  };
}

async function sendOrEditEventDiscordMessage(env: Env, channelId: string, payload: { embeds: unknown[] }, existingMessageId: string | null) {
  const botToken = cleanBotToken(env.DISCORD_BOT_TOKEN);
  if (!botToken) throw new Error("BOT_NOT_INSTALLED");
  const headers = { authorization: `Bot ${botToken}`, "content-type": "application/json" };
  if (existingMessageId) {
    const edit = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(existingMessageId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(payload),
    });
    if (edit.ok) return { messageId: existingMessageId, operation: "edited" as const };
    if (edit.status !== 404) throw new Error(`DISCORD_EDIT_FAILED_${edit.status}`);
  }
  const send = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!send.ok) throw new Error(`DISCORD_SEND_FAILED_${send.status}`);
  const json = await send.json().catch(() => null) as { id?: string } | null;
  return { messageId: typeof json?.id === "string" ? json.id : null, operation: existingMessageId ? "replaced" as const : "sent" as const };
}

async function recordEventDiscordMessage(env: Env, input: {
  eventId: string;
  matchupId: string | null;
  phaseId: string | null;
  linkedServerId: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  messageType: string;
  status: string;
  payloadHash: string | null;
}) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO event_discord_messages (
        id, event_id, matchup_id, phase_id, linked_server_id, guild_id, channel_id, message_id,
        message_type, status, last_payload_hash, last_sent_at, last_edited_at, retry_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(event_id, matchup_id, phase_id, linked_server_id, message_type) DO UPDATE SET
        channel_id = excluded.channel_id,
        message_id = COALESCE(excluded.message_id, event_discord_messages.message_id),
        status = excluded.status,
        last_payload_hash = excluded.last_payload_hash,
        last_edited_at = excluded.last_edited_at,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.eventId,
      input.matchupId,
      input.phaseId,
      input.linkedServerId,
      input.guildId,
      input.channelId,
      input.messageId,
      input.messageType,
      input.status,
      input.payloadHash,
      now,
      now,
      now,
      now,
    )
    .run();
}

async function recordEventDiscordFailure(env: Env, matchup: MatchupRow, phase: PhaseRow, row: { linked_server_id: string; guild_id: string | null; channel_id: string | null; channel_guild_id: string | null }, error: unknown) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO event_discord_messages (
        id, event_id, matchup_id, phase_id, linked_server_id, guild_id, channel_id, message_type,
        status, retry_count, next_retry_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'phase_live', 'failed', 1, ?, ?, ?)
      ON CONFLICT(event_id, matchup_id, phase_id, linked_server_id, message_type) DO UPDATE SET
        status = 'failed',
        retry_count = COALESCE(event_discord_messages.retry_count, 0) + 1,
        next_retry_at = excluded.next_retry_at,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      matchup.event_id,
      matchup.id,
      phase.id,
      row.linked_server_id,
      row.channel_guild_id ?? row.guild_id,
      row.channel_id,
      addMinutes(new Date(), error instanceof Error && /429/.test(error.message) ? 15 : 5).toISOString(),
      now,
      now,
    )
    .run();
}

async function countRecentEventChannelTests(env: Env, linkedServerId: string) {
  const row = await requireDb(env)
    .prepare(
      `SELECT COUNT(*) AS count
       FROM event_discord_messages
       WHERE linked_server_id = ?
         AND message_type = 'channel_test'
         AND datetime(created_at) >= datetime('now', '-1 hour')`,
    )
    .bind(linkedServerId)
    .first<{ count: number | null }>();
  return Number(row?.count ?? 0);
}

async function cacheDiscordChannels(env: Env, guildId: string, channels: DiscordPostingChannel[]) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  for (const channel of channels.slice(0, 200)) {
    await db
      .prepare(
        `INSERT INTO discord_guild_channels_cache (
          id, guild_id, channel_id, channel_name, channel_kind, parent_id, position,
          bot_permission_json, last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, channel_id) DO UPDATE SET
          channel_name = excluded.channel_name,
          channel_kind = excluded.channel_kind,
          position = excluded.position,
          bot_permission_json = excluded.bot_permission_json,
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        crypto.randomUUID(),
        guildId,
        channel.channel_id,
        channel.channel_name,
        channel.channel_type,
        channel.position,
        JSON.stringify({
          canView: channel.can_view,
          canSend: channel.can_send,
          canEmbed: channel.can_embed,
          canReadHistory: channel.can_read_history,
          missingPermissions: channel.missing_permissions,
        }),
        now,
        now,
        now,
      )
      .run();
  }
}

async function getCachedDiscordChannelOptions(env: Env, guildId: string) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT channel_id, channel_name, channel_kind, bot_permission_json
       FROM discord_guild_channels_cache
       WHERE guild_id = ?
       ORDER BY COALESCE(position, 9999), lower(COALESCE(channel_name, channel_id))
       LIMIT 200`,
    )
    .bind(guildId)
    .all<{ channel_id: string; channel_name: string | null; channel_kind: string | null; bot_permission_json: string | null }>()
    .catch(() => ({ results: [] as Array<{ channel_id: string; channel_name: string | null; channel_kind: string | null; bot_permission_json: string | null }> }));

  return (rows.results ?? []).map((row) => {
    const permissions = parseChannelPermissionJson(row.bot_permission_json);
    return {
      id: row.channel_id,
      name: row.channel_name ?? row.channel_id,
      type: row.channel_kind ?? "text",
      categoryName: null,
      canSelect: permissions.canView && permissions.canSend && permissions.canEmbed && permissions.canReadHistory,
      botCanView: permissions.canView,
      botCanSend: permissions.canSend,
      botCanEmbed: permissions.canEmbed,
      botCanReadHistory: permissions.canReadHistory,
      missingPermissions: permissions.missingPermissions,
    };
  });
}

function parseChannelPermissionJson(value: string | null) {
  try {
    const parsed = JSON.parse(value || "{}") as Partial<{
      canView: boolean;
      canSend: boolean;
      canEmbed: boolean;
      canReadHistory: boolean;
      missingPermissions: string[];
    }>;
    return {
      canView: Boolean(parsed.canView),
      canSend: Boolean(parsed.canSend),
      canEmbed: Boolean(parsed.canEmbed),
      canReadHistory: Boolean(parsed.canReadHistory),
      missingPermissions: Array.isArray(parsed.missingPermissions) ? parsed.missingPermissions.map(String) : [],
    };
  } catch {
    return {
      canView: false,
      canSend: false,
      canEmbed: false,
      canReadHistory: false,
      missingPermissions: REQUIRED_PERMISSION_LABELS,
    };
  }
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

function isCategoryEligible(serverCategory: ServerCategory, eventCategory: ServerCategory | null, event: Pick<EventHubEventRow, "category" | "allow_hybrid_entries">) {
  const rawCategory = String(event.category ?? "").trim().toLowerCase();
  if (!rawCategory || rawCategory === "open" || rawCategory === "all") return true;
  if (!eventCategory) return true;
  if (serverCategory === eventCategory) return true;
  if (serverCategory === "pvp_pve" && (eventCategory === "pvp" || eventCategory === "pve")) return Number(event.allow_hybrid_entries ?? 0) === 1;
  return false;
}

function planAllowsEvent(requiredPlan: PlanKey, plan: PlanKey, active: boolean) {
  if (requiredPlan === "free") return true;
  if (!active) return false;
  return planRank(plan) >= planRank(requiredPlan);
}

function planRank(plan: PlanKey) {
  return { free: 0, starter: 1, pro: 2, premium: 4, network: 4, partner: 4 }[plan] ?? 0;
}

function normalizeRequiredPlan(value: unknown): PlanKey {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || text === "community" || text === "trial") return "free";
  const normalized = normalizePlanKey(text);
  if (normalized === "starter") return "free";
  return normalized;
}

function eventRequiresDiscord(event: Pick<EventHubEventRow, "requires_discord_posting" | "event_type">) {
  return Number(event.requires_discord_posting ?? 0) === 1 || EVENT_OFFICIAL_TYPES.has(String(event.event_type ?? "").toLowerCase());
}

function hasUsableEventChannel(rows: SavedChannelRow[], preferred: EventChannelType) {
  return Boolean(resolveEventChannel(rows, preferred));
}

function hasUsablePrimaryEventChannel(rows: SavedChannelRow[]) {
  return Boolean(findUsableEventChannel(rows, "default_event"));
}

function hasAdvancedEventRouting(rows: SavedChannelRow[]) {
  return Boolean(findUsableEventChannel(rows, "default_event"))
    && EVENT_CHANNEL_TYPES.some((type) => type !== "default_event" && Boolean(findUsableEventChannel(rows, type)));
}

function findUsableEventChannel(rows: SavedChannelRow[], type: EventChannelType) {
  return rows.find((item) => item.channel_type === type && isSavedChannelUsable(item)) ?? null;
}

function resolveEventChannel(rows: SavedChannelRow[], preferred: EventChannelType): SavedChannelRow | null {
  const priority: EventChannelType[] = preferred === "event_live_scoreboard"
    ? ["event_live_scoreboard", "default_event", "event_announcements"]
    : preferred === "event_results"
      ? ["event_results", "default_event", "event_announcements"]
      : preferred === "event_announcements"
        ? ["event_announcements", "default_event"]
        : ["default_event", "event_announcements"];
  for (const type of priority) {
    const row = rows.find((item) => item.channel_type === type && isSavedChannelUsable(item));
    if (row) return row;
  }
  return null;
}

function isSavedChannelUsable(row: SavedChannelRow) {
  return Number(row.bot_can_view ?? 0) === 1
    && Number(row.bot_can_send ?? 0) === 1
    && Number(row.bot_can_embed ?? 0) === 1
    && Number(row.bot_can_read_history ?? 0) === 1;
}

function phaseTemplate(phaseNumber: number, title: string, description: string, metricType: string, durationHours: number, scoringRules: Record<string, unknown>) {
  return { phaseNumber, title, description, metricType, durationHours, scoringRules };
}

function defaultMatchupDurationHours(event: Pick<EventHubEventRow, "event_type" | "category">) {
  const category = normalizeServerCategory(event.category);
  const type = String(event.event_type ?? "").toLowerCase();
  if (category === "deathmatch" || type === "kill_race") return 24;
  if (category === "pvp") return 48;
  return 72;
}

function defaultPhaseDurationHours(event: Pick<EventHubEventRow, "event_type" | "category">) {
  const category = normalizeServerCategory(event.category);
  return category === "deathmatch" ? 6 : 12;
}

function defaultPhaseCount(event: Pick<EventHubEventRow, "event_type" | "category">) {
  const category = normalizeServerCategory(event.category);
  if (category === "deathmatch") return 4;
  if (category === "pve") return 3;
  return 6;
}

function eligibilityStatus(code: string | null) {
  if (code === "PLAN_REQUIRED" || code === "NOT_AUTHORIZED") return 403;
  if (code === "EVENT_NOT_FOUND" || code === "SERVER_NOT_FOUND") return 404;
  if (code === "CATEGORY_REQUIRED" || code === "SETUP_INCOMPLETE" || code === "DISCORD_EVENT_CHANNEL_REQUIRED" || code === "ADM_SYNC_REQUIRED" || code === "EVENT_COOLDOWN_ACTIVE") return 409;
  return 400;
}

function normalizeEventChannelType(value: unknown): EventChannelType | null {
  const text = String(value ?? "").trim().toLowerCase();
  return (EVENT_CHANNEL_TYPES as readonly string[]).includes(text) ? text as EventChannelType : null;
}

function normalizeDiscordId(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{5,30}$/.test(text) ? text : null;
}

function serverDisplayName(server: Pick<OwnerServerRow, "display_name" | "hostname" | "server_name">) {
  return server.display_name || server.hostname || server.server_name || "DZN Server";
}

function isActiveSubscription(value: unknown) {
  return ["active", "trialing"].includes(String(value ?? "").toLowerCase());
}

function sanitizeInteger(value: unknown, fallback: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function parseRules(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60 * 1000);
}

function cleanBotToken(value: unknown) {
  const text = String(value ?? "").trim().replace(/^Bot\s+/i, "");
  return text || null;
}

async function hashPayload(value: unknown) {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isMockAuthEnabled(env: Env) {
  return String(env.MOCK_AUTH ?? "").toLowerCase() === "true" || String(env.MOCK_AUTH ?? "") === "1";
}

function mockEventChannels(): DiscordPostingChannel[] {
  return [
    mockChannel("123456789012345678", "event-announcements", "Events"),
    mockChannel("123456789012345679", "live-scoreboards", "Events"),
    mockChannel("123456789012345680", "event-results", "Events"),
  ];
}

function mockChannel(channelId: string, name: string, categoryName: string): DiscordPostingChannel {
  return {
    channel_id: channelId,
    channel_name: name,
    channel_type: "text",
    category_name: categoryName,
    position: 0,
    category_position: 0,
    can_view: true,
    can_send: true,
    can_embed: true,
    can_read_history: true,
    can_manage_messages: false,
    can_post: true,
    missing_permissions: [],
    permission_source: "administrator",
    permission_diagnostics: {
      selected_channel_id: channelId,
      selected_channel_name: name,
      bot_user_id: "mock-bot",
      bot_role_ids: [],
      bot_role_names: [],
      bot_has_administrator: true,
      base_guild_permissions: null,
      effective_channel_permissions: null,
      permission_source: "administrator",
      missing_permissions: [],
    },
  };
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

const EVENT_HUB_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS server_discord_channel_settings (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    server_id TEXT,
    guild_id TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    channel_kind TEXT,
    bot_can_view INTEGER DEFAULT 0,
    bot_can_send INTEGER DEFAULT 0,
    bot_can_embed INTEGER DEFAULT 0,
    bot_can_read_history INTEGER DEFAULT 0,
    last_verified_at TEXT,
    selected_by_user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(linked_server_id, channel_type)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_server_discord_channel_settings_server ON server_discord_channel_settings(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_server_discord_channel_settings_guild ON server_discord_channel_settings(guild_id)",
  `CREATE TABLE IF NOT EXISTS discord_guild_channels_cache (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    channel_kind TEXT,
    parent_id TEXT,
    position INTEGER,
    bot_permission_json TEXT,
    last_seen_at TEXT,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(guild_id, channel_id)
  )`,
  `CREATE TABLE IF NOT EXISTS server_event_entries (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    linked_server_id TEXT NOT NULL,
    server_id TEXT,
    owner_user_id TEXT,
    guild_id TEXT,
    category_at_entry TEXT,
    plan_key_at_entry TEXT,
    status TEXT NOT NULL DEFAULT 'entered',
    entered_at TEXT,
    withdrawn_at TEXT,
    completed_at TEXT,
    cooldown_until TEXT,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(event_id, linked_server_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_server_event_entries_server_status ON server_event_entries(linked_server_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_server_event_entries_event ON server_event_entries(event_id)",
  `CREATE TABLE IF NOT EXISTS event_matchups (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    round_number INTEGER,
    server_a_entry_id TEXT,
    server_b_entry_id TEXT,
    server_a_id TEXT NOT NULL,
    server_b_id TEXT NOT NULL,
    status TEXT,
    starts_at TEXT,
    ends_at TEXT,
    scoring_grace_until TEXT,
    server_a_score INTEGER DEFAULT 0,
    server_b_score INTEGER DEFAULT 0,
    winner_server_id TEXT,
    tie_breaker_json TEXT,
    created_at TEXT,
    updated_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_event_matchups_event ON event_matchups(event_id)",
  "CREATE INDEX IF NOT EXISTS idx_event_matchups_status ON event_matchups(status)",
  `CREATE TABLE IF NOT EXISTS event_challenge_phases (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    matchup_id TEXT NOT NULL,
    phase_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category_scope TEXT,
    metric_type TEXT NOT NULL,
    scoring_rules_json TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    scoring_grace_until TEXT,
    status TEXT,
    server_a_score INTEGER DEFAULT 0,
    server_b_score INTEGER DEFAULT 0,
    winner_server_id TEXT,
    finalized_at TEXT,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(matchup_id, phase_number)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_event_challenge_phases_due ON event_challenge_phases(status, starts_at, ends_at)",
  `CREATE TABLE IF NOT EXISTS event_phase_scores (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    matchup_id TEXT NOT NULL,
    phase_id TEXT NOT NULL,
    linked_server_id TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    qualifying_events_count INTEGER NOT NULL DEFAULT 0,
    breakdown_json TEXT,
    last_scored_at TEXT,
    finalized_at TEXT,
    UNIQUE(phase_id, linked_server_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_event_phase_scores_matchup ON event_phase_scores(matchup_id)",
  `CREATE TABLE IF NOT EXISTS event_cooldowns (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    event_type TEXT,
    plan_key TEXT,
    cooldown_until TEXT NOT NULL,
    source_event_id TEXT,
    source_matchup_id TEXT,
    reason TEXT,
    created_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_event_cooldowns_server_until ON event_cooldowns(linked_server_id, cooldown_until)",
  `CREATE TABLE IF NOT EXISTS event_discord_messages (
    id TEXT PRIMARY KEY,
    event_id TEXT,
    matchup_id TEXT,
    phase_id TEXT,
    linked_server_id TEXT NOT NULL,
    guild_id TEXT,
    channel_id TEXT,
    message_id TEXT,
    message_type TEXT,
    status TEXT,
    last_payload_hash TEXT,
    last_sent_at TEXT,
    last_edited_at TEXT,
    retry_count INTEGER DEFAULT 0,
    next_retry_at TEXT,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(event_id, matchup_id, phase_id, linked_server_id, message_type)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_event_discord_messages_retry ON event_discord_messages(status, next_retry_at)",
  `CREATE TABLE IF NOT EXISTS event_reports (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    report_type TEXT,
    generated_at TEXT,
    champion_server_id TEXT,
    summary_json TEXT,
    public_summary_text TEXT,
    admin_notes_json TEXT
  )`,
];
