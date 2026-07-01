import { requireDb } from "./db";
import { effectiveEntitlementPlan, normalizePlanKey } from "./plans";
import { requireServerOwnerOrDznAdmin } from "./public-cache";
import {
  assertSameCategoryChallenge,
  assertServerWarCategoryEligible,
  getServerWarRuleset,
  getServerWarRulesetOptions,
  isPublicServerWarsEligibleServer,
  lockedCategoryMessage,
  normalizeWarServerCategory,
} from "./server-war-categories";
import { getLatestServerWarStandings, type ServerWarStanding } from "./server-war-snapshots";
import { ensureServerWarsSchema } from "./server-war-schema";
import type { Env, SessionUser } from "./types";

export type PublicServerWarEvent = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  eventType: string;
  category: string | null;
  eligibleCategories: string[];
  status: string;
  scoringRulesetKey: string;
  scoringRulesetTitle: string;
  startsAt: string;
  endsAt: string;
  visibility: string;
  packageRequired: string;
  finalizedAt: string | null;
  standings: ServerWarStanding[];
  awaitingSnapshot: boolean;
};

export type PublicChampionTitle = {
  serverId: string;
  serverName: string;
  serverSlug: string | null;
  title: string;
  category: string | null;
  awardedAt: string | null;
};

export type PublicServerWarsPayload = {
  ok: true;
  generated_at: string;
  rulesets: ReturnType<typeof getServerWarRulesetOptions>;
  events: PublicServerWarEvent[];
  champions: PublicChampionTitle[];
  notes: string[];
  empty?: boolean;
  warnings?: string[];
};

export type ServerWarsAccess = {
  configuredPlan: ServerWarsPlan;
  effectivePlan: ServerWarsPlan;
  subscriptionStatus: string | null;
  canViewPublic: boolean;
  canParticipateOpen: boolean;
  canCreateChallenge: boolean;
  canCreateFeatured: boolean;
  lockedReason: string | null;
};

type ServerWarsPlan = "free" | "starter" | "pro" | "premium";

type WarEventRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  event_type: string;
  category: string | null;
  eligible_categories: string | null;
  status: string;
  scoring_ruleset_key: string;
  starts_at: string;
  ends_at: string;
  visibility: string;
  package_required: string;
  finalized_at: string | null;
};

type ServerWarServerRow = {
  id: string;
  user_id: string;
  guild_id: string | null;
  server_name: string | null;
  display_name: string | null;
  hostname: string | null;
  nitrado_service_name: string | null;
  public_slug: string | null;
  server_category: string | null;
  server_type: string | null;
  server_mode: string | null;
  status: string | null;
  listing_visibility: string | null;
  lifecycle_status: string | null;
  plan_key: string | null;
  subscription_status: string | null;
};

const PUBLIC_SERVER_WARS_CACHE_MS = 10_000;
const publicServerWarsPayloadCache = new Map<number, {
  expiresAt: number;
  promise: Promise<PublicServerWarsPayload>;
}>();

export async function getPublicServerWarsPayload(env: Env, options: { limit?: number } = {}): Promise<PublicServerWarsPayload> {
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 12), 30));
  const nowMs = Date.now();
  const cached = publicServerWarsPayloadCache.get(limit);
  if (cached && cached.expiresAt > nowMs) return cached.promise;
  const promise = readPublicServerWarsPayload(env, limit).catch((error) => {
    publicServerWarsPayloadCache.delete(limit);
    throw error;
  });
  publicServerWarsPayloadCache.set(limit, { expiresAt: nowMs + PUBLIC_SERVER_WARS_CACHE_MS, promise });
  return promise;
}

async function readPublicServerWarsPayload(env: Env, limit: number): Promise<PublicServerWarsPayload> {
  let eventRows: WarEventRow[] = [];
  const warnings: string[] = [];
  const rows = await requireDb(env)
    .prepare(
      `SELECT id, slug, title, description, event_type, category, eligible_categories,
              status, scoring_ruleset_key, starts_at, ends_at, visibility,
              package_required, finalized_at
       FROM server_war_events
       WHERE lower(visibility) = 'public'
         AND status IN ('scheduled', 'live', 'completed', 'finalizing')
       ORDER BY
         CASE status
           WHEN 'live' THEN 0
           WHEN 'scheduled' THEN 1
           WHEN 'finalizing' THEN 2
           WHEN 'completed' THEN 3
           ELSE 4
         END,
         starts_at DESC
       LIMIT ${limit}`,
    )
    .all<WarEventRow>()
    .catch((error) => {
      if (isMissingServerWarsSchemaError(error)) return { results: [] as WarEventRow[] };
      throw error;
    });
  eventRows = rows.results ?? [];
  if (eventRows.length === 0) {
    return emptyPublicServerWarsPayload(true);
  }

  const events: PublicServerWarEvent[] = [];
  for (const row of eventRows) {
    try {
      events.push(await eventRowToPublicEvent(env, row, {
        publicOnly: true,
        standingsLimit: 8,
        skipSchemaEnsure: true,
      }));
    } catch (error) {
      warnings.push(`event_${row.id}_unavailable`);
      console.warn("DZN SERVER WAR PUBLIC EVENT LOAD SKIPPED", {
        eventId: row.id,
        message: error instanceof Error ? error.message : "unknown event load error",
      });
    }
  }
  let champions: PublicChampionTitle[] = [];
  try {
    champions = await getCurrentChampionTitles(env, { limit: 8 });
  } catch (error) {
    warnings.push("champions_unavailable");
    console.warn("DZN SERVER WAR CHAMPIONS LOAD SKIPPED", {
      message: error instanceof Error ? error.message : "unknown champion load error",
    });
  }
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    rulesets: getServerWarRulesetOptions(),
    events,
    champions,
    notes: [
      "Server Wars scores are event-window snapshots from real ADM-derived data.",
      "Plans affect hosting and presentation only, never score formulas.",
    ],
    ...(warnings.length ? { warnings } : {}),
  };
}

export async function getPublicServerWarDetailPayload(env: Env, eventIdOrSlug: string) {
  await ensureServerWarsSchema(env);
  const event = await requireDb(env)
    .prepare(
      `SELECT *
       FROM server_war_events
       WHERE (id = ? OR slug = ?)
         AND lower(visibility) = 'public'
       LIMIT 1`,
    )
    .bind(eventIdOrSlug, eventIdOrSlug)
    .first<WarEventRow>();
  if (!event) return null;
  const publicEvent = await eventRowToPublicEvent(env, event, { publicOnly: true, standingsLimit: 50 });
  const participants = await getEventParticipants(env, event.id, { publicOnly: true });
  const results = await getEventResults(env, event.id, { publicOnly: true });
  const trophies = await getEventTrophies(env, event.id, { publicOnly: true });
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    event: publicEvent,
    participants,
    results,
    trophies,
    privacy: {
      rawCoordinatesExposed: false,
      exactRoutesExposed: false,
      publicExploration: "aggregate snapshots only",
    },
  };
}

export async function getPublicServerWarRecordPayload(env: Env, serverIdOrSlug: string) {
  await ensureServerWarsSchema(env);
  const server = await readServerForWars(env, serverIdOrSlug);
  if (!server || !isPublicServerWarsEligibleServer(server)) return null;
  const [active, completed, trophies, titles] = await Promise.all([
    getServerWarEventsForServer(env, server.id, ["scheduled", "live", "finalizing"], true),
    getServerWarEventsForServer(env, server.id, ["completed"], true),
    getServerTrophies(env, server.id, true),
    getServerChampionTitles(env, server.id, true),
  ]);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    server: serializeServer(server),
    activeEvents: active,
    completedEvents: completed,
    trophies,
    currentChampionTitles: titles,
    privacy: {
      rawCoordinatesExposed: false,
      exactRoutesExposed: false,
    },
  };
}

export async function getOwnerServerWarsPayload(env: Env, user: SessionUser, serverId: string, options: { skipSchemaEnsure?: boolean } = {}) {
  if (!options.skipSchemaEnsure) {
    await ensureServerWarsSchema(env);
  }
  const access = await requireServerOwnerOrDznAdmin(env, user, serverId);
  if (!access.allowed) {
    return {
      ok: false as const,
      status: access.reason === "not_found" ? 404 : 403,
      error: access.reason === "not_found" ? "server_not_found" : "forbidden",
    };
  }
  const server = await readServerForWars(env, serverId);
  if (!server) {
    return { ok: false as const, status: 404, error: "server_not_found" };
  }
  const warAccess = getServerWarsAccess(server.plan_key, server.subscription_status);
  const category = normalizeWarServerCategory(server);
  const [events, pendingChallenges, trophies, titles] = await Promise.all([
    getServerWarEventsForServer(env, server.id, ["pending_acceptance", "scheduled", "live", "finalizing", "completed"], false, {
      skipSchemaEnsure: options.skipSchemaEnsure,
    }),
    getPendingChallengesForServer(env, server.id),
    getServerTrophies(env, server.id, false),
    getServerChampionTitles(env, server.id, false),
  ]);
  return {
    ok: true as const,
    generated_at: new Date().toISOString(),
    server: serializeServer(server),
    access: warAccess,
    eligibility: {
      category,
      eligibleRulesets: category
        ? getServerWarRulesetOptions().filter((ruleset) => ruleset.eligibleCategories.includes(category))
        : [],
      lockedReason: category ? null : "Set a server category before entering category-specific Server Wars.",
    },
    events,
    pendingChallenges,
    trophies,
    currentChampionTitles: titles,
  };
}

export async function createServerWarChallenge(
  env: Env,
  user: SessionUser,
  serverId: string,
  body: Record<string, unknown>,
) {
  await ensureServerWarsSchema(env);
  const db = requireDb(env);
  const access = await requireServerOwnerOrDznAdmin(env, user, serverId);
  if (!access.allowed) {
    return {
      ok: false as const,
      status: access.reason === "not_found" ? 404 : access.reason === "unauthenticated" ? 401 : 403,
      error: access.reason === "not_found" ? "server_not_found" : access.reason === "unauthenticated" ? "unauthenticated" : "forbidden",
    };
  }
  const challenger = await readServerForWars(env, serverId);
  const opponentId = sanitizeId(body.opponentServerId ?? body.opponent_server_id);
  const opponent = opponentId ? await readServerForWars(env, opponentId) : null;
  if (!challenger || !opponent) return { ok: false as const, status: 404, error: "opponent_not_found" };
  if (!isPublicServerWarsEligibleServer(opponent)) {
    return { ok: false as const, status: 400, error: "opponent_not_public", message: "Opponent must be a live public server." };
  }
  const ruleset = getServerWarRuleset(body.rulesetKey ?? body.scoring_ruleset_key ?? "deathmatch_war");
  try {
    assertSameCategoryChallenge(challenger, opponent, ruleset.key);
  } catch (error) {
    return {
      ok: false as const,
      status: 400,
      error: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "category_ineligible",
      message: error instanceof Error ? error.message : lockedCategoryMessage(challenger.server_category, ruleset.key),
    };
  }
  const warAccess = getServerWarsAccess(challenger.plan_key, challenger.subscription_status);
  const featured = Boolean(body.featured);
  if (!warAccess.canCreateChallenge || (featured && !warAccess.canCreateFeatured)) {
    return {
      ok: false as const,
      status: 403,
      error: "plan_locked",
      message: featured
        ? "Premium is required to host featured Server Wars."
        : "Pro or Premium is required to create Server VS Server challenges.",
      access: warAccess,
    };
  }

  const now = new Date();
  const startsAt = safeFutureIso(body.startsAt ?? body.starts_at, now.toISOString());
  const endsAt = safeFutureIso(body.endsAt ?? body.ends_at, new Date(Date.parse(startsAt) + 24 * 60 * 60 * 1000).toISOString());
  const title = sanitizeTitle(body.title) || `${serverName(challenger)} vs ${serverName(opponent)}`;
  const eventId = crypto.randomUUID();
  const challengeId = crypto.randomUUID();
  const slug = await uniqueWarSlug(env, title);
  const createdAt = now.toISOString();
  const categoryAtEntry = assertServerWarCategoryEligible(challenger, ruleset.key);
  const opponentCategory = assertServerWarCategoryEligible(opponent, ruleset.key);
  const packageRequired = featured ? "premium" : ruleset.packageRequired;

  await db
    .prepare(
      `INSERT INTO server_war_events (
        id, slug, title, description, event_type, category, eligible_categories, status,
        scoring_ruleset_key, starts_at, ends_at, created_by_user_id, created_by_server_id,
        visibility, package_required, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_acceptance', ?, ?, ?, ?, ?, 'public', ?, ?, ?)`,
    )
    .bind(
      eventId,
      slug,
      title,
      sanitizeNullable(body.description),
      ruleset.eventType,
      ruleset.category,
      JSON.stringify(ruleset.eligibleCategories),
      ruleset.key,
      startsAt,
      endsAt,
      user.id,
      challenger.id,
      packageRequired,
      createdAt,
      createdAt,
    )
    .run();
  await insertParticipant(env, {
    eventId,
    serverId: challenger.id,
    ownerUserId: challenger.user_id,
    categoryAtEntry,
    status: "accepted",
    acceptedAt: createdAt,
    joinedAt: createdAt,
  });
  await insertParticipant(env, {
    eventId,
    serverId: opponent.id,
    ownerUserId: opponent.user_id,
    categoryAtEntry: opponentCategory,
    status: "pending",
  });
  await db
    .prepare(
      `INSERT INTO server_war_challenges (
        id, event_id, challenger_server_id, opponent_server_id, challenger_owner_user_id,
        opponent_owner_user_id, status, message, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .bind(
      challengeId,
      eventId,
      challenger.id,
      opponent.id,
      challenger.user_id,
      opponent.user_id,
      sanitizeNullable(body.message),
      new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString(),
      createdAt,
      createdAt,
    )
    .run();
  return {
    ok: true as const,
    challenge: await getChallengeById(env, challengeId),
    event: await getPublicServerWarDetailPayload(env, eventId),
  };
}

export async function acceptServerWarChallenge(env: Env, user: SessionUser, serverId: string, challengeId: string) {
  return resolveServerWarChallenge(env, user, serverId, challengeId, "accepted");
}

export async function declineServerWarChallenge(env: Env, user: SessionUser, serverId: string, challengeId: string) {
  return resolveServerWarChallenge(env, user, serverId, challengeId, "declined");
}

export function getServerWarsAccess(planKey: unknown, status: unknown): ServerWarsAccess {
  const configuredPlan = toServerWarsPlan(normalizePlanKey(planKey));
  const effectivePlan = toServerWarsPlan(effectiveEntitlementPlan(configuredPlan, typeof status === "string" ? status : null));
  const proPlus = effectivePlan === "pro" || effectivePlan === "premium";
  const premium = effectivePlan === "premium";
  return {
    configuredPlan,
    effectivePlan,
    subscriptionStatus: typeof status === "string" ? status : null,
    canViewPublic: true,
    canParticipateOpen: true,
    canCreateChallenge: proPlus,
    canCreateFeatured: premium,
    lockedReason: proPlus ? null : "Pro or Premium is required to create Server VS Server challenges.",
  };
}

function toServerWarsPlan(value: unknown): ServerWarsPlan {
  const normalized = normalizePlanKey(value);
  if (normalized === "premium" || normalized === "network" || normalized === "partner") return "premium";
  if (normalized === "pro") return "pro";
  if (normalized === "starter") return "starter";
  return "free";
}

async function eventRowToPublicEvent(
  env: Env,
  row: WarEventRow,
  options: { publicOnly: boolean; standingsLimit: number; skipSchemaEnsure?: boolean },
): Promise<PublicServerWarEvent> {
  const ruleset = getServerWarRuleset(row.scoring_ruleset_key);
  let standings = await getLatestServerWarStandings(env, row.id, options.standingsLimit, {
    skipSchemaEnsure: options.skipSchemaEnsure,
  });
  if (options.publicOnly) {
    const eligible = await publicEligibleServerIds(env, standings.map((standing) => standing.serverId));
    standings = standings.filter((standing) => eligible.has(standing.serverId));
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    eventType: row.event_type,
    category: row.category,
    eligibleCategories: parseStringArray(row.eligible_categories),
    status: row.status,
    scoringRulesetKey: row.scoring_ruleset_key,
    scoringRulesetTitle: ruleset.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    visibility: row.visibility,
    packageRequired: row.package_required,
    finalizedAt: row.finalized_at,
    standings,
    awaitingSnapshot: standings.length === 0,
  };
}

async function resolveServerWarChallenge(
  env: Env,
  user: SessionUser,
  serverId: string,
  challengeId: string,
  action: "accepted" | "declined",
) {
  await ensureServerWarsSchema(env);
  const access = await requireServerOwnerOrDznAdmin(env, user, serverId);
  if (!access.allowed) {
    return {
      ok: false as const,
      status: access.reason === "not_found" ? 404 : access.reason === "unauthenticated" ? 401 : 403,
      error: access.reason === "not_found" ? "server_not_found" : access.reason === "unauthenticated" ? "unauthenticated" : "forbidden",
    };
  }
  const challenge = await getChallengeById(env, challengeId);
  if (!challenge) return { ok: false as const, status: 404, error: "challenge_not_found" };
  if (challenge.opponent_server_id !== serverId) {
    return { ok: false as const, status: 403, error: "forbidden" };
  }
  if (challenge.status !== "pending") {
    return { ok: false as const, status: 409, error: "challenge_already_resolved" };
  }
  const now = new Date().toISOString();
  const eventStatus = action === "accepted" ? eventStatusForAcceptedChallenge(challenge.starts_at, challenge.ends_at) : "cancelled";
  await requireDb(env)
    .prepare(
      `UPDATE server_war_challenges
       SET status = ?, accepted_at = CASE WHEN ? = 'accepted' THEN ? ELSE accepted_at END,
           declined_at = CASE WHEN ? = 'declined' THEN ? ELSE declined_at END,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(action, action, now, action, now, now, challengeId)
    .run();
  await requireDb(env)
    .prepare("UPDATE server_war_events SET status = ?, updated_at = ? WHERE id = ?")
    .bind(eventStatus, now, challenge.event_id)
    .run();
  await requireDb(env)
    .prepare(
      `UPDATE server_war_participants
       SET status = ?, accepted_at = CASE WHEN ? = 'accepted' THEN ? ELSE accepted_at END,
           declined_at = CASE WHEN ? = 'declined' THEN ? ELSE declined_at END,
           joined_at = CASE WHEN ? = 'accepted' THEN COALESCE(joined_at, ?) ELSE joined_at END,
           updated_at = ?
       WHERE event_id = ? AND server_id = ?`,
    )
    .bind(action, action, now, action, now, action, now, now, challenge.event_id, serverId)
    .run();
  return {
    ok: true as const,
    challenge: await getChallengeById(env, challengeId),
    event: await getPublicServerWarDetailPayload(env, challenge.event_id),
  };
}

async function readServerForWars(env: Env, serverIdOrSlug: string): Promise<ServerWarServerRow | null> {
  return requireDb(env)
    .prepare(
      `SELECT linked_servers.id,
              linked_servers.user_id,
              linked_servers.guild_id,
              linked_servers.server_name,
              linked_servers.display_name,
              linked_servers.hostname,
              linked_servers.nitrado_service_name,
              linked_servers.public_slug,
              linked_servers.server_category,
              linked_servers.server_type,
              linked_servers.server_mode,
              linked_servers.status,
              linked_servers.listing_visibility,
              linked_servers.lifecycle_status,
              server_subscriptions.plan_key,
              server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE (linked_servers.id = ? OR linked_servers.public_slug = ?)
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(serverIdOrSlug, serverIdOrSlug)
    .first<ServerWarServerRow>();
}

async function insertParticipant(env: Env, input: {
  eventId: string;
  serverId: string;
  ownerUserId: string | null;
  categoryAtEntry: string;
  status: "accepted" | "pending" | "joined" | "invited";
  acceptedAt?: string | null;
  joinedAt?: string | null;
}) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO server_war_participants (
        id, event_id, server_id, owner_user_id, category_at_entry, status,
        joined_at, accepted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, server_id) DO UPDATE SET
        category_at_entry = server_war_participants.category_at_entry,
        status = excluded.status,
        joined_at = COALESCE(server_war_participants.joined_at, excluded.joined_at),
        accepted_at = COALESCE(server_war_participants.accepted_at, excluded.accepted_at),
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.eventId,
      input.serverId,
      input.ownerUserId,
      input.categoryAtEntry,
      input.status,
      input.joinedAt ?? null,
      input.acceptedAt ?? null,
      now,
      now,
    )
    .run();
}

async function getEventParticipants(env: Env, eventId: string, options: { publicOnly: boolean }) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT participants.server_id,
              participants.category_at_entry,
              participants.status,
              participants.final_rank,
              participants.final_score,
              COALESCE(linked_servers.display_name, linked_servers.server_name, linked_servers.hostname, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
              linked_servers.public_slug,
              linked_servers.status AS server_status,
              linked_servers.listing_visibility,
              linked_servers.lifecycle_status
       FROM server_war_participants participants
       INNER JOIN linked_servers ON linked_servers.id = participants.server_id
       WHERE participants.event_id = ?
       ORDER BY participants.created_at ASC
       LIMIT 80`,
    )
    .bind(eventId)
    .all<{
      server_id: string;
      category_at_entry: string | null;
      status: string;
      final_rank: number | null;
      final_score: number | null;
      server_name: string | null;
      public_slug: string | null;
      server_status: string | null;
      listing_visibility: string | null;
      lifecycle_status: string | null;
    }>();
  return (rows.results ?? [])
    .filter((row) => !options.publicOnly || isPublicServerWarsEligibleServer({ status: row.server_status, listing_visibility: row.listing_visibility, lifecycle_status: row.lifecycle_status }))
    .map((row) => ({
      serverId: row.server_id,
      serverName: row.server_name ?? "DZN Server",
      serverSlug: row.public_slug,
      categoryAtEntry: row.category_at_entry,
      status: row.status,
      finalRank: row.final_rank,
      finalScore: row.final_score,
    }));
}

async function getEventResults(env: Env, eventId: string, options: { publicOnly: boolean }) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT results.*,
              COALESCE(linked_servers.display_name, linked_servers.server_name, linked_servers.hostname, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
              linked_servers.public_slug,
              linked_servers.status AS server_status,
              linked_servers.listing_visibility,
              linked_servers.lifecycle_status
       FROM server_war_results results
       INNER JOIN linked_servers ON linked_servers.id = results.server_id
       WHERE results.event_id = ?
       ORDER BY results.final_rank ASC
       LIMIT 80`,
    )
    .bind(eventId)
    .all<{
      server_id: string;
      final_rank: number;
      final_score: number;
      metric_breakdown: string;
      top_contributors: string;
      finalized_at: string;
      server_name: string | null;
      public_slug: string | null;
      server_status: string | null;
      listing_visibility: string | null;
      lifecycle_status: string | null;
    }>();
  return (rows.results ?? [])
    .filter((row) => !options.publicOnly || isPublicServerWarsEligibleServer({ status: row.server_status, listing_visibility: row.listing_visibility, lifecycle_status: row.lifecycle_status }))
    .map((row) => ({
      serverId: row.server_id,
      serverName: row.server_name ?? "DZN Server",
      serverSlug: row.public_slug,
      finalRank: row.final_rank,
      finalScore: row.final_score,
      metricBreakdown: parseJsonObject(row.metric_breakdown),
      topContributors: parseJsonObject(row.top_contributors),
      finalizedAt: row.finalized_at,
    }));
}

async function getEventTrophies(env: Env, eventId: string, options: { publicOnly: boolean }) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT trophies.*,
              linked_servers.status AS server_status,
              linked_servers.listing_visibility,
              linked_servers.lifecycle_status,
              linked_servers.public_slug
       FROM server_trophies trophies
       INNER JOIN linked_servers ON linked_servers.id = trophies.server_id
       WHERE trophies.event_id = ?
       ORDER BY trophies.awarded_at DESC
       LIMIT 40`,
    )
    .bind(eventId)
    .all<{
      server_id: string;
      trophy_key: string;
      title: string;
      description: string | null;
      category: string | null;
      reward_type: string;
      awarded_at: string;
      expires_at: string | null;
      is_current_title: number | null;
      metadata: string | null;
      server_status: string | null;
      listing_visibility: string | null;
      lifecycle_status: string | null;
      public_slug: string | null;
    }>();
  return (rows.results ?? [])
    .filter((row) => !options.publicOnly || isPublicServerWarsEligibleServer({ status: row.server_status, listing_visibility: row.listing_visibility, public_slug: row.public_slug, lifecycle_status: row.lifecycle_status }))
    .map(serializeTrophy);
}

async function getServerWarEventsForServer(env: Env, serverId: string, statuses: string[], publicOnly: boolean, options: { skipSchemaEnsure?: boolean } = {}) {
  if (!statuses.length) return [];
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = await requireDb(env)
    .prepare(
      `SELECT events.*
       FROM server_war_events events
       INNER JOIN server_war_participants participants ON participants.event_id = events.id
       WHERE participants.server_id = ?
         AND events.status IN (${placeholders})
       ORDER BY events.starts_at DESC
       LIMIT 30`,
    )
    .bind(serverId, ...statuses)
    .all<WarEventRow>();
  const events: PublicServerWarEvent[] = [];
  for (const row of rows.results ?? []) {
    if (publicOnly && row.visibility !== "public") continue;
    events.push(await eventRowToPublicEvent(env, row, {
      publicOnly,
      standingsLimit: 8,
      skipSchemaEnsure: options.skipSchemaEnsure,
    }));
  }
  return events;
}

async function getPendingChallengesForServer(env: Env, serverId: string) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT challenges.*,
              events.title,
              events.slug,
              events.scoring_ruleset_key,
              events.starts_at,
              events.ends_at
       FROM server_war_challenges challenges
       INNER JOIN server_war_events events ON events.id = challenges.event_id
       WHERE (challenges.opponent_server_id = ? OR challenges.challenger_server_id = ?)
         AND challenges.status = 'pending'
       ORDER BY challenges.created_at DESC
       LIMIT 20`,
    )
    .bind(serverId, serverId)
    .all<Record<string, unknown>>();
  return (rows.results ?? []).map((row) => ({
    ...row,
    challengerServerId: row.challenger_server_id ?? null,
    opponentServerId: row.opponent_server_id ?? null,
    role: row.opponent_server_id === serverId ? "opponent" : "challenger",
    canRespond: row.opponent_server_id === serverId,
  }));
}

async function getServerTrophies(env: Env, serverId: string, publicOnly: boolean) {
  const server = await readServerForWars(env, serverId);
  if (publicOnly && (!server || !isPublicServerWarsEligibleServer(server))) return [];
  const rows = await requireDb(env)
    .prepare(
      `SELECT *
       FROM server_trophies
       WHERE server_id = ?
       ORDER BY awarded_at DESC
       LIMIT 30`,
    )
    .bind(serverId)
    .all<Parameters<typeof serializeTrophy>[0]>();
  return (rows.results ?? []).map(serializeTrophy);
}

async function getServerChampionTitles(env: Env, serverId: string, publicOnly: boolean) {
  const server = await readServerForWars(env, serverId);
  if (publicOnly && (!server || !isPublicServerWarsEligibleServer(server))) return [];
  const rows = await requireDb(env)
    .prepare(
      `SELECT *
       FROM server_champion_titles
       WHERE server_id = ?
         AND active = 1
       ORDER BY awarded_at DESC
       LIMIT 12`,
    )
    .bind(serverId)
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

async function getCurrentChampionTitles(env: Env, options: { limit: number }) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT titles.*,
              COALESCE(linked_servers.display_name, linked_servers.server_name, linked_servers.hostname, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
              linked_servers.public_slug,
              linked_servers.status AS server_status,
              linked_servers.listing_visibility,
              linked_servers.lifecycle_status
       FROM server_champion_titles titles
       INNER JOIN linked_servers ON linked_servers.id = titles.server_id
       WHERE titles.active = 1
       ORDER BY titles.awarded_at DESC
       LIMIT ${Math.max(1, Math.min(options.limit, 20))}`,
    )
    .all<Record<string, unknown>>();
  return (rows.results ?? [])
    .filter((row) => isPublicServerWarsEligibleServer({ status: row.server_status, listing_visibility: row.listing_visibility, lifecycle_status: row.lifecycle_status }))
    .map((row) => ({
      serverId: String(row.server_id ?? ""),
      serverName: String(row.server_name ?? "DZN Server"),
      serverSlug: typeof row.public_slug === "string" ? row.public_slug : null,
      title: String(row.title ?? "Server Wars Champion"),
      category: typeof row.category === "string" ? row.category : null,
      awardedAt: typeof row.awarded_at === "string" ? row.awarded_at : null,
    }));
}

async function publicEligibleServerIds(env: Env, serverIds: string[]) {
  if (!serverIds.length) return new Set<string>();
  const placeholders = serverIds.map(() => "?").join(", ");
  const rows = await requireDb(env)
    .prepare(
      `SELECT id, status, listing_visibility, public_slug, lifecycle_status
       FROM linked_servers
       WHERE id IN (${placeholders})`,
    )
    .bind(...serverIds)
    .all<{ id: string; status: string | null; listing_visibility: string | null; public_slug: string | null; lifecycle_status: string | null }>();
  return new Set((rows.results ?? [])
    .filter(isPublicServerWarsEligibleServer)
    .map((row) => row.id));
}

async function getChallengeById(env: Env, challengeId: string) {
  return requireDb(env)
    .prepare(
      `SELECT challenges.*,
              events.title,
              events.slug,
              events.starts_at,
              events.ends_at,
              events.scoring_ruleset_key
       FROM server_war_challenges challenges
       INNER JOIN server_war_events events ON events.id = challenges.event_id
       WHERE challenges.id = ?
       LIMIT 1`,
    )
    .bind(challengeId)
    .first<{
      id: string;
      event_id: string;
      challenger_server_id: string;
      opponent_server_id: string;
      status: string;
      starts_at: string;
      ends_at: string;
    } & Record<string, unknown>>();
}

async function uniqueWarSlug(env: Env, title: string) {
  const base = slugify(title) || "server-war";
  for (let index = 0; index < 5; index += 1) {
    const suffix = crypto.randomUUID().slice(0, index === 0 ? 6 : 8);
    const slug = `${base}-${suffix}`.slice(0, 96);
    const existing = await requireDb(env)
      .prepare("SELECT id FROM server_war_events WHERE slug = ? LIMIT 1")
      .bind(slug)
      .first<{ id: string }>();
    if (!existing) return slug;
  }
  return `${base}-${Date.now()}`.slice(0, 96);
}

function serializeServer(row: ServerWarServerRow) {
  return {
    id: row.id,
    name: serverName(row),
    publicSlug: row.public_slug,
    category: normalizeWarServerCategory(row),
    status: row.status,
    listingVisibility: row.listing_visibility ?? "public",
  };
}

function serializeTrophy(row: {
  server_id: string;
  trophy_key: string;
  title: string;
  description: string | null;
  category: string | null;
  reward_type: string;
  awarded_at: string;
  expires_at: string | null;
  is_current_title: number | null;
  metadata: string | null;
}) {
  return {
    serverId: row.server_id,
    trophyKey: row.trophy_key,
    title: row.title,
    description: row.description,
    category: row.category,
    rewardType: row.reward_type,
    awardedAt: row.awarded_at,
    expiresAt: row.expires_at,
    isCurrentTitle: Number(row.is_current_title ?? 0) === 1,
    metadata: parseJsonObject(row.metadata),
  };
}

function serverName(row: Pick<ServerWarServerRow, "display_name" | "server_name" | "hostname" | "nitrado_service_name">) {
  return row.display_name || row.server_name || row.hostname || row.nitrado_service_name || "DZN Server";
}

function sanitizeId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 96) : "";
}

function sanitizeTitle(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

function sanitizeNullable(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1200) : null;
}

function safeFutureIso(value: unknown, fallback: string) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function eventStatusForAcceptedChallenge(startsAt: string, endsAt: string) {
  const now = Date.now();
  if (Date.parse(endsAt) <= now) return "finalizing";
  if (Date.parse(startsAt) <= now) return "live";
  return "scheduled";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function parseStringArray(value: string | null | undefined) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function emptyPublicServerWarsPayload(empty: boolean): PublicServerWarsPayload {
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    rulesets: getServerWarRulesetOptions(),
    events: [],
    champions: [],
    empty,
    notes: [
      "Server Wars scores are event-window snapshots from real ADM-derived data.",
      "Plans affect hosting and presentation only, never score formulas.",
    ],
  };
}

function isMissingServerWarsSchemaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table:\s*server_war_|no such column:\s*(event_type|scoring_ruleset_key|eligible_categories)/i.test(message);
}
