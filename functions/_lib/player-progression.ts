import {
  readPublicProfileAttributionForSessionUser,
  type PublicProfileAttribution,
} from "./public-profile-attribution";
import type { Env, SessionUser } from "./types";

export type PlayerChallengeSource = "live" | "catalog_fallback" | "display_fallback" | "not_configured";

export type PlayerChallengeSummary = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  reward: {
    xp: number;
    calling_card: {
      code: string;
      name: string;
      description: string | null;
      rarity: string;
    } | null;
  };
  target_value: number;
  player_state: {
    status: "not_joined" | "joined" | "completed" | "abandoned";
    joined_at: string | null;
    completed_at: string | null;
    progress_value: number;
    target_value: number;
    progress_percent: number;
    xp_awarded: number;
    calling_card_awarded: string | null;
    public_profile: PublicProfileAttribution | null;
  };
};

export type PlayerCallingCardAwardSummary = {
  code: string;
  name: string;
  description: string | null;
  rarity: string;
  awarded_at: string;
};

export type PlayerProgressSummary = {
  source: PlayerChallengeSource;
  total_xp: number;
  available_challenges: number;
  joined_challenges: number;
  completed_challenges: number;
  calling_cards: PlayerCallingCardAwardSummary[];
  recent_challenges: PlayerChallengeSummary[];
  public_profile: PublicProfileAttribution | null;
  href: string;
};

export type PlayerChallengesPayload = {
  ok: true;
  source: PlayerChallengeSource;
  challenges: PlayerChallengeSummary[];
  player_progress: PlayerProgressSummary;
  fetched_at: string;
};

export type PlayerChallengeJoinInput = {
  challenge_id?: unknown;
  challenge_slug?: unknown;
  slug?: unknown;
  action?: unknown;
};

export const TRUSTED_PROGRESSION_SOURCE_TYPES = [
  "adm_gameplay",
  "challenge_rule",
  "community_activity",
  "event_participation",
  "verified_activity",
] as const;

export type TrustedProgressionSourceType = typeof TRUSTED_PROGRESSION_SOURCE_TYPES[number];

export const TRUSTED_PROGRESSION_SOURCE_ADAPTERS = [
  "adm_player_event",
  "adm_kill_event",
  "event_entry",
  "approved_review",
] as const;

export type TrustedProgressionSourceAdapter = typeof TRUSTED_PROGRESSION_SOURCE_ADAPTERS[number];

export type TrustedProgressionAwardSourceInput = {
  source_type?: unknown;
  sourceType?: unknown;
  source_id?: unknown;
  sourceId?: unknown;
  linked_server_id?: unknown;
  linkedServerId?: unknown;
  source_table?: unknown;
  sourceTable?: unknown;
  adapter_key?: unknown;
  adapterKey?: unknown;
  user_id?: unknown;
  userId?: unknown;
  challenge_id?: unknown;
  challengeId?: unknown;
  challenge_slug?: unknown;
  challengeSlug?: unknown;
  slug?: unknown;
  progress_value?: unknown;
  progressValue?: unknown;
  verified?: unknown;
  verified_at?: unknown;
  verifiedAt?: unknown;
  evidence?: unknown;
  evidence_json?: unknown;
};

export type PlayerProgressionAwardJobOptions = {
  limit?: number | null;
  sources?: TrustedProgressionAwardSourceInput[] | null;
  collectSources?: boolean | null;
  adapters?: Array<TrustedProgressionSourceAdapter | string> | null;
  retryFailed?: boolean | null;
  source?: string | null;
  now?: string | null;
};

export type PlayerProgressionAwardOutcomeStatus = "accepted" | "progressed" | "awarded" | "duplicate" | "skipped" | "failed";

export type PlayerProgressionAwardOutcome = {
  status: PlayerProgressionAwardOutcomeStatus;
  source_type: string | null;
  source_id: string | null;
  user_id: string | null;
  challenge_id: string | null;
  message: string;
  progress_value?: number;
  target_value?: number;
  xp_awarded?: number;
  calling_card_awarded?: string | null;
};

export type PlayerProgressionAwardJobResult = {
  ok: boolean;
  taskStatus: "success" | "no_op" | "warning" | "failed";
  task_status: "success" | "no_op" | "warning" | "failed";
  source: string;
  acceptedSources: number;
  accepted_sources: number;
  duplicateSources: number;
  duplicate_sources: number;
  collectedSources: number;
  collected_sources: number;
  retriedSources: number;
  retried_sources: number;
  processed: number;
  progressed: number;
  awardedXp: number;
  awarded_xp: number;
  awardedCards: number;
  awarded_cards: number;
  completedChallenges: number;
  completed_challenges: number;
  skipped: PlayerProgressionAwardOutcome[];
  failed: PlayerProgressionAwardOutcome[];
  warnings: string[];
};

type PlayerChallengeRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string | null;
  reward_xp: number | null;
  calling_card_code: string | null;
  calling_card_name: string | null;
  calling_card_description: string | null;
  calling_card_rarity: string | null;
  target_value: number | null;
  sort_order: number | null;
  starts_at: string | null;
  ends_at: string | null;
};

type PlayerChallengeParticipationRow = {
  challenge_id: string;
  status: string | null;
  progress_value: number | null;
  target_value: number | null;
  xp_awarded: number | null;
  calling_card_awarded: string | null;
  joined_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
};

type PlayerCallingCardAwardRow = {
  calling_card_code: string;
  calling_card_name: string | null;
  calling_card_description: string | null;
  calling_card_rarity: string | null;
  awarded_at: string | null;
};

type JoinTarget = {
  challengeId: string | null;
  challengeSlug: string | null;
};

type NormalizedTrustedProgressionSource = {
  sourceType: TrustedProgressionSourceType;
  sourceId: string;
  userId: string;
  challengeId: string | null;
  challengeSlug: string | null;
  linkedServerId: string | null;
  sourceTable: string | null;
  adapterKey: TrustedProgressionSourceAdapter | null;
  progressValue: number;
  verifiedAt: string;
  evidenceJson: string | null;
};

type PlayerProgressionAwardSourceRow = {
  id: string;
  user_id: string;
  challenge_id: string;
  linked_server_id: string | null;
  source_type: TrustedProgressionSourceType | string;
  source_id: string;
  source_table: string | null;
  adapter_key: TrustedProgressionSourceAdapter | string | null;
  progress_value: number | null;
  verification_status: string | null;
  verified_at: string | null;
  evidence_json: string | null;
  processed_at: string | null;
  result_status: string | null;
  result_message: string | null;
  attempt_count: number | null;
  last_attempted_at: string | null;
  retry_count: number | null;
  last_retried_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ProgressionAdapterSourceCandidate = {
  sourceType: TrustedProgressionSourceType;
  sourceId: string;
  sourceTable: string;
  adapterKey: TrustedProgressionSourceAdapter;
  userId: string;
  linkedServerId: string | null;
  challengeSlug: string;
  progressValue: number;
  verifiedAt: string | null;
  evidence: Record<string, unknown>;
};

type ProgressionAdapterSourceResult = {
  acceptedSources: number;
  duplicateSources: number;
  skipped: PlayerProgressionAwardOutcome[];
  failed: PlayerProgressionAwardOutcome[];
  warnings: string[];
};

const PROGRESS_HREF = "/events/challenges";
const AWARD_JOB_DEFAULT_LIMIT = 10;
const AWARD_JOB_MAX_LIMIT = 25;
const CHALLENGE_COMPLETION_SOURCE_TYPE = "challenge_completion";
const DEFAULT_AWARD_ADAPTERS: TrustedProgressionSourceAdapter[] = [
  "adm_player_event",
  "adm_kill_event",
  "event_entry",
  "approved_review",
];

const FOUNDATION_CHALLENGES: PlayerChallengeRow[] = [
  {
    id: "foundation-survivor-spark",
    slug: "survivor-spark",
    title: "Survivor Spark",
    description: "Join the foundation survival track. Verified gameplay progress can award XP and the Survivor Spark calling card once challenge rules are connected.",
    category: "survival",
    status: "active",
    reward_xp: 50,
    calling_card_code: "survivor_spark",
    calling_card_name: "Survivor Spark",
    calling_card_description: "Joined the first DZN player challenge track.",
    calling_card_rarity: "foundation",
    target_value: 1,
    sort_order: 10,
    starts_at: null,
    ends_at: null,
  },
  {
    id: "foundation-community-scout",
    slug: "community-scout",
    title: "Community Scout",
    description: "Follow the player discovery path across DZN communities. This is a player preference/progression track, not a discovery boost.",
    category: "community",
    status: "active",
    reward_xp: 75,
    calling_card_code: "community_scout",
    calling_card_name: "Community Scout",
    calling_card_description: "Started exploring DZN-connected communities.",
    calling_card_rarity: "foundation",
    target_value: 1,
    sort_order: 20,
    starts_at: null,
    ends_at: null,
  },
  {
    id: "foundation-arena-rookie",
    slug: "arena-rookie",
    title: "Arena Rookie",
    description: "Enter the player challenge lane for combat-focused progress. Server Wars scores, rankings, and event outcomes stay untouched.",
    category: "combat",
    status: "active",
    reward_xp: 100,
    calling_card_code: "arena_rookie",
    calling_card_name: "Arena Rookie",
    calling_card_description: "Entered the player-side combat challenge queue.",
    calling_card_rarity: "foundation",
    target_value: 1,
    sort_order: 30,
    starts_at: null,
    ends_at: null,
  },
];

export async function getPlayerChallengesPayload(env: Env, user: SessionUser): Promise<PlayerChallengesPayload> {
  if (!env.DB) return buildPayload("display_fallback", FOUNDATION_CHALLENGES, [], [], 0);

  try {
    const [challengeRows, participationRows, xpRow, callingCardRows, publicProfileAttribution] = await Promise.all([
      readActiveChallenges(env),
      readPlayerChallengeParticipations(env, user),
      readPlayerXpTotal(env, user),
      readPlayerCallingCardAwards(env, user),
      readPublicProfileAttributionForSessionUser(env, user),
    ]);
    const source: PlayerChallengeSource = challengeRows.length ? "live" : "catalog_fallback";
    return buildPayload(
      source,
      challengeRows.length ? challengeRows : FOUNDATION_CHALLENGES,
      participationRows,
      callingCardRows,
      numberOrZero(xpRow?.total_xp),
      publicProfileAttribution,
    );
  } catch {
    return buildPayload("not_configured", FOUNDATION_CHALLENGES, [], [], 0);
  }
}

export async function joinPlayerChallenge(env: Env, user: SessionUser, input: PlayerChallengeJoinInput): Promise<{
  status: 200 | 400 | 404 | 503;
  payload: unknown;
}> {
  if (!env.DB) {
    return {
      status: 503,
      payload: {
        ok: false,
        error: "PLAYER_CHALLENGES_UNAVAILABLE",
        message: "Player challenge participation is not available right now.",
      },
    };
  }

  const action = normalizeAction(input.action);
  if (action !== "join") {
    return {
      status: 400,
      payload: {
        ok: false,
        error: "PLAYER_CHALLENGE_ACTION_UNSUPPORTED",
        message: "Only player challenge join is available in this foundation slice.",
      },
    };
  }

  const target = normalizeChallengeTarget(input);
  if (!target.challengeId && !target.challengeSlug) {
    return {
      status: 400,
      payload: {
        ok: false,
        error: "PLAYER_CHALLENGE_TARGET_REQUIRED",
        message: "Choose a DZN player challenge to join.",
      },
    };
  }

  let challenge: PlayerChallengeRow | null = null;
  try {
    challenge = await resolveJoinableChallenge(env, target);
  } catch {
    return {
      status: 503,
      payload: {
        ok: false,
        error: "PLAYER_CHALLENGES_UNAVAILABLE",
        message: "Player challenge participation is not available right now.",
      },
    };
  }

  if (!challenge) {
    return {
      status: 404,
      payload: {
        ok: false,
        error: "PLAYER_CHALLENGE_NOT_FOUND",
        message: "That active DZN player challenge could not be found.",
      },
    };
  }

  const now = new Date().toISOString();
  try {
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO player_challenge_participations (
          id, user_id, challenge_id, status, progress_value, target_value,
          xp_awarded, calling_card_awarded, joined_at, completed_at, updated_at
        ) VALUES (?, ?, ?, 'joined', 0, ?, 0, NULL, ?, NULL, ?)`,
      )
      .bind(randomProgressionId("pcp"), user.id, challenge.id, safeTargetValue(challenge.target_value), now, now)
      .run();
  } catch {
    return {
      status: 503,
      payload: {
        ok: false,
        error: "PLAYER_CHALLENGES_UNAVAILABLE",
        message: "Player challenge participation could not be saved right now.",
      },
    };
  }

  const payload = await getPlayerChallengesPayload(env, user);
  const summary = payload.challenges.find((item) => item.id === challenge.id) ?? toChallengeSummary(challenge, null);
  return {
    status: 200,
    payload: {
      ok: true,
      joined: true,
      challenge: summary,
      player_progress: payload.player_progress,
      fetched_at: new Date().toISOString(),
    },
  };
}

export async function runPlayerProgressionAwardJob(env: Env, options: PlayerProgressionAwardJobOptions = {}): Promise<PlayerProgressionAwardJobResult> {
  if (!env.DB) {
    return buildAwardJobResult({
      source: awardJobSource(options.source),
      failed: [
        awardOutcome({
          status: "failed",
          message: "Player progression awards require the D1 database binding.",
        }),
      ],
    });
  }

  const now = normalizeIsoDate(options.now) ?? new Date().toISOString();
  const source = awardJobSource(options.source);
  const limit = clampAwardLimit(options.limit);
  const skipped: PlayerProgressionAwardOutcome[] = [];
  const failed: PlayerProgressionAwardOutcome[] = [];
  const warnings: string[] = [];
  let acceptedSources = 0;
  let duplicateSources = 0;
  let collectedSources = 0;
  let retriedSources = 0;

  if (options.retryFailed) {
    try {
      retriedSources = await retryFailedProgressionAwardSources(env, limit, now);
    } catch (error) {
      const message = errorMessage(error, "Failed progression sources could not be scheduled for retry.");
      failed.push(awardOutcome({ status: "failed", message }));
      warnings.push(message);
    }
  }

  if (options.collectSources) {
    const collected = await collectVerifiedProgressionAwardSources(env, {
      adapters: options.adapters,
      limit,
      now,
    });
    acceptedSources += collected.acceptedSources;
    duplicateSources += collected.duplicateSources;
    collectedSources += collected.acceptedSources + collected.duplicateSources;
    skipped.push(...collected.skipped);
    failed.push(...collected.failed);
    warnings.push(...collected.warnings);
  }

  for (const input of trustedSourceInputs(options.sources, limit)) {
    try {
      const recorded = await recordVerifiedProgressionAwardSource(env, input, now);
      if (recorded.status === "accepted") acceptedSources += 1;
      if (recorded.status === "duplicate") duplicateSources += 1;
      if (recorded.status === "skipped") skipped.push(recorded);
    } catch (error) {
      const outcome = awardOutcome({
        status: "failed",
        source_type: sourceTypeFromUnknown(input.source_type ?? input.sourceType),
        source_id: cleanSourceId(input.source_id ?? input.sourceId),
        user_id: cleanIdentifier(input.user_id ?? input.userId),
        message: errorMessage(error, "Verified player progression source could not be recorded."),
      });
      failed.push(outcome);
      warnings.push(outcome.message);
    }
  }

  let pending: PlayerProgressionAwardSourceRow[] = [];
  try {
    pending = await readPendingVerifiedProgressionAwardSources(env, limit);
  } catch (error) {
    const message = errorMessage(error, "Verified player progression sources could not be loaded.");
    failed.push(awardOutcome({ status: "failed", message }));
    warnings.push(message);
    return buildAwardJobResult({ source, acceptedSources, duplicateSources, skipped, failed, warnings });
  }

  let processed = 0;
  let progressed = 0;
  let awardedXp = 0;
  let awardedCards = 0;
  let completedChallenges = 0;

  for (const row of pending) {
    try {
      await markProgressionAwardSourceAttempt(env, row, now);
      const outcome = await processVerifiedProgressionAwardSource(env, row, now);
      processed += 1;
      if (outcome.status === "progressed") progressed += 1;
      if (outcome.status === "awarded") completedChallenges += 1;
      awardedXp += Math.max(0, Math.trunc(outcome.xp_awarded ?? 0));
      if (outcome.calling_card_awarded) awardedCards += 1;
      if (outcome.status === "skipped" || outcome.status === "duplicate") skipped.push(outcome);
    } catch (error) {
      const message = errorMessage(error, "Verified player progression source could not be processed.");
      await markProgressionAwardSource(env, row, "failed", message, now).catch(() => undefined);
      failed.push(sourceRowOutcome(row, "failed", message));
      warnings.push(message);
    }
  }

  return buildAwardJobResult({
    source,
    acceptedSources,
    duplicateSources,
    collectedSources,
    retriedSources,
    processed,
    progressed,
    awardedXp,
    awardedCards,
    completedChallenges,
    skipped,
    failed,
    warnings,
  });
}

export async function collectVerifiedProgressionAwardSources(
  env: Env,
  options: {
    adapters?: Array<TrustedProgressionSourceAdapter | string> | null;
    limit?: number | null;
    now?: string | null;
  } = {},
): Promise<ProgressionAdapterSourceResult> {
  if (!env.DB) {
    return {
      acceptedSources: 0,
      duplicateSources: 0,
      skipped: [],
      failed: [awardOutcome({ status: "failed", message: "Player progression awards require the D1 database binding." })],
      warnings: ["Player progression awards require the D1 database binding."],
    };
  }

  const now = normalizeIsoDate(options.now) ?? new Date().toISOString();
  const limit = clampAwardLimit(options.limit);
  const adapterKeys = normalizeAwardAdapters(options.adapters);
  const result: ProgressionAdapterSourceResult = {
    acceptedSources: 0,
    duplicateSources: 0,
    skipped: [],
    failed: [],
    warnings: [],
  };

  for (const adapterKey of adapterKeys) {
    let candidates: ProgressionAdapterSourceCandidate[] = [];
    try {
      candidates = await readProgressionAdapterSources(env, adapterKey, limit);
    } catch (error) {
      const message = errorMessage(error, `Progression adapter ${adapterKey} could not read trusted sources.`);
      result.failed.push(awardOutcome({ status: "failed", message }));
      result.warnings.push(message);
      continue;
    }

    for (const candidate of candidates.slice(0, limit)) {
      try {
        const recorded = await recordVerifiedProgressionAwardSource(env, adapterCandidateToInput(candidate, now), now);
        if (recorded.status === "accepted") result.acceptedSources += 1;
        if (recorded.status === "duplicate") result.duplicateSources += 1;
        if (recorded.status === "skipped") result.skipped.push(recorded);
      } catch (error) {
        const message = errorMessage(error, `Progression adapter ${adapterKey} could not record a trusted source.`);
        result.failed.push(awardOutcome({
          status: "failed",
          source_type: candidate.sourceType,
          source_id: candidate.sourceId,
          user_id: candidate.userId,
          message,
        }));
        result.warnings.push(message);
      }
    }
  }

  return result;
}

async function readProgressionAdapterSources(
  env: Env,
  adapterKey: TrustedProgressionSourceAdapter,
  limit: number,
): Promise<ProgressionAdapterSourceCandidate[]> {
  if (adapterKey === "adm_player_event") return readAdmPlayerEventAwardSources(env, limit);
  if (adapterKey === "adm_kill_event") return readAdmKillEventAwardSources(env, limit);
  if (adapterKey === "event_entry") return readEventEntryAwardSources(env, limit);
  return readApprovedReviewAwardSources(env, limit);
}

async function readAdmPlayerEventAwardSources(env: Env, limit: number): Promise<ProgressionAdapterSourceCandidate[]> {
  const rows = await env.DB
    .prepare(
      `SELECT
         users.id AS user_id,
         player_events.id AS source_row_id,
         player_events.linked_server_id,
         player_events.event_type,
         player_events.player_name,
         player_events.player_id,
         player_events.source_service_id,
         player_events.source_adm_file,
         player_events.source_line_number,
         player_events.occurred_at,
         player_events.created_at
       FROM player_events
       INNER JOIN player_profiles ON player_profiles.id = player_events.player_profile_id
       INNER JOIN users ON users.discord_id = player_profiles.discord_id
       WHERE player_profiles.discord_id IS NOT NULL
         AND player_profiles.discord_id != ''
         AND player_events.event_type IN ('player_connected', 'playerlist_entry', 'plain_player_state')
       ORDER BY datetime(COALESCE(player_events.occurred_at, player_events.created_at)) DESC
       LIMIT ?`,
    )
    .bind(clampAwardLimit(limit))
    .all<{
      user_id: string;
      source_row_id: string;
      linked_server_id: string | null;
      event_type: string | null;
      player_name: string | null;
      player_id: string | null;
      source_service_id: string | null;
      source_adm_file: string | null;
      source_line_number: number | null;
      occurred_at: string | null;
      created_at: string | null;
    }>();

  return (rows.results ?? []).map((row) => ({
    sourceType: "adm_gameplay",
    sourceId: `adm:player_events:${row.source_row_id}`,
    sourceTable: "player_events",
    adapterKey: "adm_player_event",
    userId: row.user_id,
    linkedServerId: nullableString(row.linked_server_id),
    challengeSlug: "survivor-spark",
    progressValue: 1,
    verifiedAt: row.occurred_at ?? row.created_at,
    evidence: {
      adapter: "adm_player_event",
      event_type: row.event_type,
      player_name: row.player_name,
      player_id: row.player_id,
      source_service_id: row.source_service_id,
      source_adm_file: row.source_adm_file,
      source_line_number: row.source_line_number,
    },
  }));
}

async function readAdmKillEventAwardSources(env: Env, limit: number): Promise<ProgressionAdapterSourceCandidate[]> {
  const rows = await env.DB
    .prepare(
      `SELECT
         users.id AS user_id,
         kill_events.id AS source_row_id,
         kill_events.linked_server_id,
         kill_events.killer_name,
         kill_events.killer_id,
         kill_events.victim_name,
         kill_events.weapon,
         kill_events.distance,
         kill_events.source_service_id,
         kill_events.source_adm_file,
         kill_events.source_line_number,
         kill_events.occurred_at,
         kill_events.created_at
       FROM kill_events
       INNER JOIN player_profiles ON player_profiles.id = kill_events.killer_profile_id
       INNER JOIN users ON users.discord_id = player_profiles.discord_id
       WHERE player_profiles.discord_id IS NOT NULL
         AND player_profiles.discord_id != ''
       ORDER BY datetime(COALESCE(kill_events.occurred_at, kill_events.created_at)) DESC
       LIMIT ?`,
    )
    .bind(clampAwardLimit(limit))
    .all<{
      user_id: string;
      source_row_id: string;
      linked_server_id: string | null;
      killer_name: string | null;
      killer_id: string | null;
      victim_name: string | null;
      weapon: string | null;
      distance: number | null;
      source_service_id: string | null;
      source_adm_file: string | null;
      source_line_number: number | null;
      occurred_at: string | null;
      created_at: string | null;
    }>();

  return (rows.results ?? []).map((row) => ({
    sourceType: "adm_gameplay",
    sourceId: `adm:kill_events:${row.source_row_id}`,
    sourceTable: "kill_events",
    adapterKey: "adm_kill_event",
    userId: row.user_id,
    linkedServerId: nullableString(row.linked_server_id),
    challengeSlug: "arena-rookie",
    progressValue: 1,
    verifiedAt: row.occurred_at ?? row.created_at,
    evidence: {
      adapter: "adm_kill_event",
      killer_name: row.killer_name,
      killer_id: row.killer_id,
      victim_name: row.victim_name,
      weapon: row.weapon,
      distance: row.distance,
      source_service_id: row.source_service_id,
      source_adm_file: row.source_adm_file,
      source_line_number: row.source_line_number,
    },
  }));
}

async function readEventEntryAwardSources(env: Env, limit: number): Promise<ProgressionAdapterSourceCandidate[]> {
  const rows = await env.DB
    .prepare(
      `SELECT
         users.id AS user_id,
         server_event_entries.id AS source_row_id,
         server_event_entries.linked_server_id,
         server_event_entries.event_id,
         server_event_entries.status,
         server_event_entries.entered_at,
         server_event_entries.completed_at,
         competitive_events.slug AS event_slug,
         competitive_events.name AS event_name
       FROM server_event_entries
       INNER JOIN users ON users.id = server_event_entries.owner_user_id
       LEFT JOIN competitive_events ON competitive_events.id = server_event_entries.event_id
       WHERE server_event_entries.owner_user_id IS NOT NULL
         AND server_event_entries.status IN ('entered', 'completed')
       ORDER BY datetime(COALESCE(server_event_entries.completed_at, server_event_entries.entered_at, server_event_entries.created_at)) DESC
       LIMIT ?`,
    )
    .bind(clampAwardLimit(limit))
    .all<{
      user_id: string;
      source_row_id: string;
      linked_server_id: string | null;
      event_id: string | null;
      status: string | null;
      entered_at: string | null;
      completed_at: string | null;
      event_slug: string | null;
      event_name: string | null;
    }>();

  return (rows.results ?? []).map((row) => ({
    sourceType: "event_participation",
    sourceId: `event:server_event_entries:${row.source_row_id}`,
    sourceTable: "server_event_entries",
    adapterKey: "event_entry",
    userId: row.user_id,
    linkedServerId: nullableString(row.linked_server_id),
    challengeSlug: "community-scout",
    progressValue: 1,
    verifiedAt: row.completed_at ?? row.entered_at,
    evidence: {
      adapter: "event_entry",
      event_id: row.event_id,
      event_slug: row.event_slug,
      event_name: row.event_name,
      entry_status: row.status,
    },
  }));
}

async function readApprovedReviewAwardSources(env: Env, limit: number): Promise<ProgressionAdapterSourceCandidate[]> {
  const rows = await env.DB
    .prepare(
      `SELECT
         users.id AS user_id,
         server_reviews.id AS source_row_id,
         server_reviews.linked_server_id,
         server_reviews.rating,
         server_reviews.title,
         server_reviews.created_at,
         server_reviews.updated_at
       FROM server_reviews
       INNER JOIN users ON users.discord_id = server_reviews.reviewer_discord_id
       WHERE server_reviews.status = 'approved'
       ORDER BY datetime(COALESCE(server_reviews.last_edited_at, server_reviews.updated_at, server_reviews.created_at)) DESC
       LIMIT ?`,
    )
    .bind(clampAwardLimit(limit))
    .all<{
      user_id: string;
      source_row_id: string;
      linked_server_id: string | null;
      rating: number | null;
      title: string | null;
      created_at: string | null;
      updated_at: string | null;
    }>();

  return (rows.results ?? []).map((row) => ({
    sourceType: "community_activity",
    sourceId: `community:server_reviews:${row.source_row_id}`,
    sourceTable: "server_reviews",
    adapterKey: "approved_review",
    userId: row.user_id,
    linkedServerId: nullableString(row.linked_server_id),
    challengeSlug: "community-scout",
    progressValue: 1,
    verifiedAt: row.updated_at ?? row.created_at,
    evidence: {
      adapter: "approved_review",
      review_id: row.source_row_id,
      rating: row.rating,
      title: row.title,
      moderation_status: "approved",
    },
  }));
}

function adapterCandidateToInput(
  candidate: ProgressionAdapterSourceCandidate,
  now: string,
): TrustedProgressionAwardSourceInput {
  return {
    source_type: candidate.sourceType,
    source_id: candidate.sourceId,
    linked_server_id: candidate.linkedServerId,
    source_table: candidate.sourceTable,
    adapter_key: candidate.adapterKey,
    user_id: candidate.userId,
    challenge_slug: candidate.challengeSlug,
    progress_value: candidate.progressValue,
    verified: true,
    verified_at: candidate.verifiedAt ?? now,
    evidence: candidate.evidence,
  };
}

async function recordVerifiedProgressionAwardSource(
  env: Env,
  input: TrustedProgressionAwardSourceInput,
  now: string,
): Promise<PlayerProgressionAwardOutcome> {
  const normalized = normalizeTrustedProgressionSourceInput(input, now);
  if (!normalized.ok) return normalized.outcome;

  const challenge = await resolveJoinableChallenge(env, {
    challengeId: normalized.value.challengeId,
    challengeSlug: normalized.value.challengeSlug,
  }, now);
  if (!challenge) {
    return awardOutcome({
      status: "skipped",
      source_type: normalized.value.sourceType,
      source_id: normalized.value.sourceId,
      user_id: normalized.value.userId,
      message: "Verified source did not match an active DZN player challenge.",
    });
  }

  const insert = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO player_progression_award_sources (
        id, user_id, challenge_id, linked_server_id, source_type, source_id,
        source_table, adapter_key, progress_value, verification_status, verified_at,
        evidence_json, processed_at, result_status, result_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, NULL, 'pending', NULL, ?, ?)`,
    )
    .bind(
      randomProgressionId("pas"),
      normalized.value.userId,
      challenge.id,
      normalized.value.linkedServerId,
      normalized.value.sourceType,
      normalized.value.sourceId,
      normalized.value.sourceTable,
      normalized.value.adapterKey,
      normalized.value.progressValue,
      normalized.value.verifiedAt,
      normalized.value.evidenceJson,
      now,
      now,
    )
    .run();

  const status = d1Changes(insert) > 0 ? "accepted" : "duplicate";
  return awardOutcome({
    status,
    source_type: normalized.value.sourceType,
    source_id: normalized.value.sourceId,
    user_id: normalized.value.userId,
    challenge_id: challenge.id,
    message: status === "accepted"
      ? "Verified source accepted for trusted progression processing."
      : "Verified source was already recorded and will not be duplicated.",
    progress_value: normalized.value.progressValue,
    target_value: safeTargetValue(challenge.target_value),
  });
}

async function readPendingVerifiedProgressionAwardSources(env: Env, limit: number) {
  const rows = await env.DB
    .prepare(
      `SELECT
         id,
         user_id,
         challenge_id,
         linked_server_id,
         source_type,
         source_id,
         source_table,
         adapter_key,
         progress_value,
         verification_status,
         verified_at,
         evidence_json,
         processed_at,
         result_status,
         result_message,
         attempt_count,
         last_attempted_at,
         retry_count,
         last_retried_at,
         created_at,
         updated_at
       FROM player_progression_award_sources
       WHERE verification_status = 'verified'
         AND result_status = 'pending'
       ORDER BY datetime(verified_at) ASC, datetime(created_at) ASC
       LIMIT ?`,
    )
    .bind(clampAwardLimit(limit))
    .all<PlayerProgressionAwardSourceRow>();
  return rows.results ?? [];
}

async function processVerifiedProgressionAwardSource(
  env: Env,
  row: PlayerProgressionAwardSourceRow,
  now: string,
): Promise<PlayerProgressionAwardOutcome> {
  if (row.verification_status !== "verified") {
    const message = "Progression source is not verified.";
    await markProgressionAwardSource(env, row, "skipped", message, now);
    return sourceRowOutcome(row, "skipped", message);
  }

  const challenge = await resolveJoinableChallenge(env, { challengeId: row.challenge_id, challengeSlug: null }, now);
  if (!challenge) {
    const message = "Progression source challenge is not active.";
    await markProgressionAwardSource(env, row, "skipped", message, now);
    return sourceRowOutcome(row, "skipped", message);
  }

  const participation = await readPlayerChallengeParticipation(env, row.user_id, row.challenge_id);
  if (!participation || normalizeParticipationStatus(participation.status) === "abandoned") {
    const message = "Player has not joined this challenge.";
    await markProgressionAwardSource(env, row, "skipped", message, now);
    return sourceRowOutcome(row, "skipped", message, {
      progress_value: Math.max(0, Math.trunc(numberOrZero(row.progress_value))),
      target_value: safeTargetValue(challenge.target_value),
    });
  }

  const targetValue = safeTargetValue(participation.target_value ?? challenge.target_value);
  const progressValue = Math.max(
    Math.max(0, Math.trunc(numberOrZero(participation.progress_value))),
    Math.max(0, Math.trunc(numberOrZero(row.progress_value))),
  );
  const completed = progressValue >= targetValue;
  if (!completed) {
    await updatePlayerChallengeParticipationAwardState(env, {
      userId: row.user_id,
      challengeId: row.challenge_id,
      status: normalizeParticipationStatus(participation.status) === "completed" ? "completed" : "joined",
      progressValue,
      targetValue,
      xpAwarded: Math.max(0, Math.trunc(numberOrZero(participation.xp_awarded))),
      callingCardAwarded: nullableString(participation.calling_card_awarded),
      completedAt: nullableString(participation.completed_at),
      now,
    });
    const message = "Verified source updated challenge progress but did not meet the target yet.";
    await markProgressionAwardSource(env, row, "progressed", message, now);
    return sourceRowOutcome(row, "progressed", message, { progress_value: progressValue, target_value: targetValue });
  }

  const rewardXp = Math.max(0, Math.trunc(numberOrZero(challenge.reward_xp)));
  const completionSourceId = challenge.id;
  const xpAwarded = rewardXp > 0
    ? await insertPlayerChallengeXpAward(env, row.user_id, completionSourceId, rewardXp, challenge.title, now)
    : 0;
  const callingCardCode = nullableString(challenge.calling_card_code);
  const hasCallingCardCatalogRow = Boolean(callingCardCode && challenge.calling_card_name);
  const callingCardAwarded = hasCallingCardCatalogRow
    ? await insertPlayerChallengeCallingCardAward(env, row.user_id, callingCardCode!, completionSourceId, now)
    : null;
  const participationXpAwarded = Math.max(
    Math.max(0, Math.trunc(numberOrZero(participation.xp_awarded))),
    rewardXp,
  );
  const participationCallingCard = nullableString(participation.calling_card_awarded) ?? (hasCallingCardCatalogRow ? callingCardCode : null);

  await updatePlayerChallengeParticipationAwardState(env, {
    userId: row.user_id,
    challengeId: row.challenge_id,
    status: "completed",
    progressValue,
    targetValue,
    xpAwarded: participationXpAwarded,
    callingCardAwarded: participationCallingCard,
    completedAt: nullableString(participation.completed_at) ?? now,
    now,
  });

  const status: "awarded" | "duplicate" = xpAwarded > 0 || Boolean(callingCardAwarded) ? "awarded" : "duplicate";
  const message = status === "awarded"
    ? "Verified source completed the challenge and wrote earned progression awards."
    : "Challenge completion awards were already present and were not duplicated.";
  await markProgressionAwardSource(env, row, status, message, now);
  return sourceRowOutcome(row, status, message, {
    progress_value: progressValue,
    target_value: targetValue,
    xp_awarded: xpAwarded,
    calling_card_awarded: callingCardAwarded,
  });
}

async function readActiveChallenges(env: Env) {
  const now = new Date().toISOString();
  const rows = await env.DB
    .prepare(
      `SELECT
         player_challenges.id,
         player_challenges.slug,
         player_challenges.title,
         player_challenges.description,
         player_challenges.category,
         player_challenges.status,
         player_challenges.reward_xp,
         player_challenges.calling_card_code,
         player_calling_cards.name AS calling_card_name,
         player_calling_cards.description AS calling_card_description,
         player_calling_cards.rarity AS calling_card_rarity,
         player_challenges.target_value,
         player_challenges.sort_order,
         player_challenges.starts_at,
         player_challenges.ends_at
       FROM player_challenges
       LEFT JOIN player_calling_cards ON player_calling_cards.code = player_challenges.calling_card_code
       WHERE player_challenges.status = 'active'
         AND (player_challenges.starts_at IS NULL OR datetime(player_challenges.starts_at) <= datetime(?))
         AND (player_challenges.ends_at IS NULL OR datetime(player_challenges.ends_at) >= datetime(?))
       ORDER BY player_challenges.sort_order ASC, player_challenges.title ASC
       LIMIT 50`,
    )
    .bind(now, now)
    .all<PlayerChallengeRow>();
  return rows.results ?? [];
}

async function readPlayerChallengeParticipations(env: Env, user: SessionUser) {
  const rows = await env.DB
    .prepare(
      `SELECT
         challenge_id,
         status,
         progress_value,
         target_value,
         xp_awarded,
         calling_card_awarded,
         joined_at,
         completed_at,
         updated_at
       FROM player_challenge_participations
       WHERE user_id = ?
       ORDER BY datetime(COALESCE(updated_at, joined_at)) DESC
       LIMIT 100`,
    )
    .bind(user.id)
    .all<PlayerChallengeParticipationRow>();
  return rows.results ?? [];
}

async function readPlayerChallengeParticipation(env: Env, userId: string, challengeId: string) {
  return env.DB
    .prepare(
      `SELECT
         challenge_id,
         status,
         progress_value,
         target_value,
         xp_awarded,
         calling_card_awarded,
         joined_at,
         completed_at,
         updated_at
       FROM player_challenge_participations
       WHERE user_id = ?
         AND challenge_id = ?
       LIMIT 1`,
    )
    .bind(userId, challengeId)
    .first<PlayerChallengeParticipationRow>();
}

async function insertPlayerChallengeXpAward(
  env: Env,
  userId: string,
  challengeId: string,
  xpAmount: number,
  challengeTitle: string | null,
  now: string,
) {
  const insert = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO player_xp_ledger (
        id, user_id, source_type, source_id, xp_amount, reason, awarded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      randomProgressionId("pxp"),
      userId,
      CHALLENGE_COMPLETION_SOURCE_TYPE,
      challengeId,
      Math.max(0, Math.trunc(xpAmount)),
      `Completed ${stringOrDefault(challengeTitle, "DZN Challenge")}`,
      now,
    )
    .run();
  return d1Changes(insert) > 0 ? Math.max(0, Math.trunc(xpAmount)) : 0;
}

async function insertPlayerChallengeCallingCardAward(
  env: Env,
  userId: string,
  callingCardCode: string,
  challengeId: string,
  now: string,
) {
  const insert = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO player_calling_card_awards (
        id, user_id, calling_card_code, source_type, source_id, awarded_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      randomProgressionId("pcc"),
      userId,
      callingCardCode,
      CHALLENGE_COMPLETION_SOURCE_TYPE,
      challengeId,
      now,
    )
    .run();
  return d1Changes(insert) > 0 ? callingCardCode : null;
}

async function updatePlayerChallengeParticipationAwardState(
  env: Env,
  input: {
    userId: string;
    challengeId: string;
    status: "joined" | "completed" | "abandoned";
    progressValue: number;
    targetValue: number;
    xpAwarded: number;
    callingCardAwarded: string | null;
    completedAt: string | null;
    now: string;
  },
) {
  await env.DB
    .prepare(
      `UPDATE player_challenge_participations
       SET status = ?,
           progress_value = ?,
           target_value = ?,
           xp_awarded = ?,
           calling_card_awarded = ?,
           completed_at = ?,
           updated_at = ?
       WHERE user_id = ?
         AND challenge_id = ?
         AND status <> 'abandoned'`,
    )
    .bind(
      input.status,
      Math.max(0, Math.trunc(input.progressValue)),
      safeTargetValue(input.targetValue),
      Math.max(0, Math.trunc(input.xpAwarded)),
      input.callingCardAwarded,
      input.completedAt,
      input.now,
      input.userId,
      input.challengeId,
    )
    .run();
}

async function retryFailedProgressionAwardSources(env: Env, limit: number, now: string) {
  const result = await env.DB
    .prepare(
      `UPDATE player_progression_award_sources
       SET result_status = 'pending',
           result_message = 'Retry scheduled by protected progression award job.',
           processed_at = NULL,
           retry_count = COALESCE(retry_count, 0) + 1,
           last_retried_at = ?,
           updated_at = ?
       WHERE id IN (
         SELECT id
         FROM player_progression_award_sources
         WHERE verification_status = 'verified'
           AND result_status = 'failed'
         ORDER BY datetime(COALESCE(processed_at, updated_at, created_at)) ASC
         LIMIT ?
       )`,
    )
    .bind(now, now, clampAwardLimit(limit))
    .run();
  return d1Changes(result);
}

async function markProgressionAwardSourceAttempt(env: Env, row: PlayerProgressionAwardSourceRow, now: string) {
  await env.DB
    .prepare(
      `UPDATE player_progression_award_sources
       SET attempt_count = COALESCE(attempt_count, 0) + 1,
           last_attempted_at = ?,
           updated_at = ?
       WHERE id = ?
         AND result_status = 'pending'`,
    )
    .bind(now, now, row.id)
    .run();
}

async function markProgressionAwardSource(
  env: Env,
  row: PlayerProgressionAwardSourceRow,
  status: "progressed" | "awarded" | "duplicate" | "skipped" | "failed",
  message: string,
  now: string,
) {
  await env.DB
    .prepare(
      `UPDATE player_progression_award_sources
       SET result_status = ?,
           result_message = ?,
           processed_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(status, message.slice(0, 240), now, now, row.id)
    .run();
}

async function readPlayerXpTotal(env: Env, user: SessionUser) {
  return env.DB
    .prepare(
      `SELECT COALESCE(SUM(xp_amount), 0) AS total_xp
       FROM player_xp_ledger
       WHERE user_id = ?`,
    )
    .bind(user.id)
    .first<{ total_xp: number | null }>();
}

async function readPlayerCallingCardAwards(env: Env, user: SessionUser) {
  const rows = await env.DB
    .prepare(
      `SELECT
         player_calling_card_awards.calling_card_code,
         player_calling_cards.name AS calling_card_name,
         player_calling_cards.description AS calling_card_description,
         player_calling_cards.rarity AS calling_card_rarity,
         player_calling_card_awards.awarded_at
       FROM player_calling_card_awards
       LEFT JOIN player_calling_cards ON player_calling_cards.code = player_calling_card_awards.calling_card_code
       WHERE player_calling_card_awards.user_id = ?
       ORDER BY datetime(player_calling_card_awards.awarded_at) DESC
       LIMIT 24`,
    )
    .bind(user.id)
    .all<PlayerCallingCardAwardRow>();
  return rows.results ?? [];
}

async function resolveJoinableChallenge(env: Env, target: JoinTarget, nowIso?: string): Promise<PlayerChallengeRow | null> {
  const clauses: string[] = [];
  const values: string[] = [];
  if (target.challengeId) {
    clauses.push("player_challenges.id = ?");
    values.push(target.challengeId);
  }
  if (target.challengeSlug) {
    clauses.push("lower(player_challenges.slug) = lower(?)");
    values.push(target.challengeSlug);
  }
  if (!clauses.length) return null;

  const now = nowIso ?? new Date().toISOString();
  return env.DB
    .prepare(
      `SELECT
         player_challenges.id,
         player_challenges.slug,
         player_challenges.title,
         player_challenges.description,
         player_challenges.category,
         player_challenges.status,
         player_challenges.reward_xp,
         player_challenges.calling_card_code,
         player_calling_cards.name AS calling_card_name,
         player_calling_cards.description AS calling_card_description,
         player_calling_cards.rarity AS calling_card_rarity,
         player_challenges.target_value,
         player_challenges.sort_order,
         player_challenges.starts_at,
         player_challenges.ends_at
       FROM player_challenges
       LEFT JOIN player_calling_cards ON player_calling_cards.code = player_challenges.calling_card_code
       WHERE (${clauses.join(" OR ")})
         AND player_challenges.status = 'active'
         AND (player_challenges.starts_at IS NULL OR datetime(player_challenges.starts_at) <= datetime(?))
         AND (player_challenges.ends_at IS NULL OR datetime(player_challenges.ends_at) >= datetime(?))
       LIMIT 1`,
    )
    .bind(...values, now, now)
    .first<PlayerChallengeRow>();
}

function buildPayload(
  source: PlayerChallengeSource,
  challengeRows: PlayerChallengeRow[],
  participationRows: PlayerChallengeParticipationRow[],
  callingCardRows: PlayerCallingCardAwardRow[],
  totalXp: number,
  publicProfileAttribution: PublicProfileAttribution | null = null,
): PlayerChallengesPayload {
  const participationByChallenge = new Map(
    participationRows.map((row) => [row.challenge_id, row] as const),
  );
  const challenges = challengeRows.map((row) => toChallengeSummary(row, participationByChallenge.get(row.id) ?? null, publicProfileAttribution));
  const joinedChallenges = participationRows.filter((row) => ["joined", "completed"].includes(normalizeParticipationStatus(row.status))).length;
  const completedChallenges = participationRows.filter((row) => normalizeParticipationStatus(row.status) === "completed").length;
  const recentChallenges = challenges
    .filter((challenge) => Boolean(challenge.player_state.joined_at))
    .sort((a, b) => stringDateValue(b.player_state.joined_at) - stringDateValue(a.player_state.joined_at))
    .slice(0, 4);

  return {
    ok: true,
    source,
    challenges,
    player_progress: {
      source,
      total_xp: Math.max(0, Math.trunc(totalXp)),
      available_challenges: challenges.length,
      joined_challenges: joinedChallenges,
      completed_challenges: completedChallenges,
      calling_cards: callingCardRows.map(toCallingCardAward),
      recent_challenges: recentChallenges,
      public_profile: publicProfileAttribution,
      href: PROGRESS_HREF,
    },
    fetched_at: new Date().toISOString(),
  };
}

function toChallengeSummary(
  row: PlayerChallengeRow,
  participation: PlayerChallengeParticipationRow | null,
  publicProfileAttribution: PublicProfileAttribution | null = null,
): PlayerChallengeSummary {
  const targetValue = safeTargetValue(participation?.target_value ?? row.target_value);
  const progressValue = Math.max(0, Math.trunc(numberOrZero(participation?.progress_value)));
  const status = normalizeParticipationStatus(participation?.status);
  const progressPercent = status === "completed"
    ? 100
    : Math.max(0, Math.min(100, Math.round((progressValue / targetValue) * 100)));
  const cardCode = nullableString(row.calling_card_code);

  return {
    id: stringOrDefault(row.id, "foundation-challenge"),
    slug: stringOrDefault(row.slug, "foundation-challenge"),
    title: stringOrDefault(row.title, "DZN Challenge"),
    description: nullableString(row.description),
    category: stringOrDefault(row.category, "community"),
    status: stringOrDefault(row.status, "active"),
    reward: {
      xp: Math.max(0, Math.trunc(numberOrZero(row.reward_xp))),
      calling_card: cardCode
        ? {
            code: cardCode,
            name: stringOrDefault(row.calling_card_name, titleFromCode(cardCode)),
            description: nullableString(row.calling_card_description),
            rarity: stringOrDefault(row.calling_card_rarity, "earned"),
          }
        : null,
    },
    target_value: safeTargetValue(row.target_value),
    player_state: {
      status,
      joined_at: nullableString(participation?.joined_at),
      completed_at: nullableString(participation?.completed_at),
      progress_value: progressValue,
      target_value: targetValue,
      progress_percent: progressPercent,
      xp_awarded: Math.max(0, Math.trunc(numberOrZero(participation?.xp_awarded))),
      calling_card_awarded: nullableString(participation?.calling_card_awarded),
      public_profile: participation ? publicProfileAttribution : null,
    },
  };
}

function toCallingCardAward(row: PlayerCallingCardAwardRow): PlayerCallingCardAwardSummary {
  const code = stringOrDefault(row.calling_card_code, "calling_card");
  return {
    code,
    name: stringOrDefault(row.calling_card_name, titleFromCode(code)),
    description: nullableString(row.calling_card_description),
    rarity: stringOrDefault(row.calling_card_rarity, "earned"),
    awarded_at: stringOrDefault(row.awarded_at, new Date(0).toISOString()),
  };
}

function normalizeChallengeTarget(input: PlayerChallengeJoinInput): JoinTarget {
  return {
    challengeId: cleanIdentifier(input.challenge_id),
    challengeSlug: cleanSlug(input.challenge_slug) ?? cleanSlug(input.slug),
  };
}

function normalizeAction(value: unknown) {
  const action = typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "join";
  return action === "join" ? "join" : "unsupported";
}

function normalizeTrustedProgressionSourceInput(
  input: TrustedProgressionAwardSourceInput,
  now: string,
): { ok: true; value: NormalizedTrustedProgressionSource } | { ok: false; outcome: PlayerProgressionAwardOutcome } {
  const sourceType = sourceTypeFromUnknown(input.source_type ?? input.sourceType);
  const sourceId = cleanSourceId(input.source_id ?? input.sourceId);
  const linkedServerId = cleanIdentifier(input.linked_server_id ?? input.linkedServerId);
  const sourceTable = cleanSourceTable(input.source_table ?? input.sourceTable);
  const adapterKey = adapterKeyFromUnknown(input.adapter_key ?? input.adapterKey);
  const userId = cleanIdentifier(input.user_id ?? input.userId);
  const challengeId = cleanIdentifier(input.challenge_id ?? input.challengeId);
  const challengeSlug = cleanSlug(input.challenge_slug ?? input.challengeSlug ?? input.slug);
  const progressValue = safeProgressValue(input.progress_value ?? input.progressValue);

  if (input.verified !== true) {
    return {
      ok: false,
      outcome: awardOutcome({
        status: "skipped",
        source_type: sourceType,
        source_id: sourceId,
        user_id: userId,
        challenge_id: challengeId,
        message: "Progression award source must be explicitly verified by a trusted server-side rule.",
      }),
    };
  }
  if (!sourceType) {
    return {
      ok: false,
      outcome: awardOutcome({
        status: "skipped",
        source_id: sourceId,
        user_id: userId,
        challenge_id: challengeId,
        message: "Progression award source type is not trusted.",
      }),
    };
  }
  if (!sourceId || !userId || (!challengeId && !challengeSlug)) {
    return {
      ok: false,
      outcome: awardOutcome({
        status: "skipped",
        source_type: sourceType,
        source_id: sourceId,
        user_id: userId,
        challenge_id: challengeId,
        message: "Progression award source must include source, player, and challenge identifiers.",
      }),
    };
  }

  return {
    ok: true,
    value: {
      sourceType,
      sourceId,
      userId,
      challengeId,
      challengeSlug,
      linkedServerId,
      sourceTable,
      adapterKey,
      progressValue,
      verifiedAt: normalizeIsoDate(input.verified_at ?? input.verifiedAt) ?? now,
      evidenceJson: safeEvidenceJson(input.evidence_json ?? input.evidence),
    },
  };
}

function sourceTypeFromUnknown(value: unknown): TrustedProgressionSourceType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (TRUSTED_PROGRESSION_SOURCE_TYPES as readonly string[]).includes(normalized)
    ? normalized as TrustedProgressionSourceType
    : null;
}

function adapterKeyFromUnknown(value: unknown): TrustedProgressionSourceAdapter | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (TRUSTED_PROGRESSION_SOURCE_ADAPTERS as readonly string[]).includes(normalized)
    ? normalized as TrustedProgressionSourceAdapter
    : null;
}

function normalizeAwardAdapters(value: Array<TrustedProgressionSourceAdapter | string> | null | undefined) {
  const keys = Array.isArray(value)
    ? value.map(adapterKeyFromUnknown).filter((key): key is TrustedProgressionSourceAdapter => Boolean(key))
    : DEFAULT_AWARD_ADAPTERS;
  return keys.length ? [...new Set(keys)].slice(0, DEFAULT_AWARD_ADAPTERS.length) : DEFAULT_AWARD_ADAPTERS;
}

function trustedSourceInputs(value: TrustedProgressionAwardSourceInput[] | null | undefined, limit: number) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object").slice(0, limit) : [];
}

function normalizeParticipationStatus(value: unknown): "not_joined" | "joined" | "completed" | "abandoned" {
  if (value === "joined" || value === "completed" || value === "abandoned") return value;
  return "not_joined";
}

function cleanIdentifier(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9_-]{3,96}$/.test(trimmed) ? trimmed : null;
}

function cleanSlug(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,95}$/.test(trimmed) ? trimmed : null;
}

function cleanSourceId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9:_.-]{2,159}$/.test(trimmed) ? trimmed : null;
}

function cleanSourceTable(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z][a-z0-9_]{1,63}$/.test(trimmed) ? trimmed : null;
}

function safeTargetValue(value: unknown) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function safeProgressValue(value: unknown) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 1;
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function titleFromCode(code: string) {
  return code
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || "Calling Card";
}

function stringDateValue(value: string | null) {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeIsoDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeEvidenceJson(value: unknown) {
  if (value === null || value === undefined) return null;
  try {
    const json = typeof value === "string" ? value : JSON.stringify(value);
    const trimmed = json.trim();
    return trimmed ? trimmed.slice(0, 2048) : null;
  } catch {
    return null;
  }
}

function clampAwardLimit(value: unknown) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(parsed, AWARD_JOB_MAX_LIMIT))
    : AWARD_JOB_DEFAULT_LIMIT;
}

function awardJobSource(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : "cron";
}

function d1Changes(result: unknown) {
  const changes = Number((result as { meta?: { changes?: unknown } } | null)?.meta?.changes ?? 0);
  return Number.isFinite(changes) ? changes : 0;
}

function buildAwardJobResult(input: Partial<PlayerProgressionAwardJobResult> & { source: string }): PlayerProgressionAwardJobResult {
  const acceptedSources = Math.max(0, Math.trunc(input.acceptedSources ?? 0));
  const duplicateSources = Math.max(0, Math.trunc(input.duplicateSources ?? 0));
  const collectedSources = Math.max(0, Math.trunc(input.collectedSources ?? 0));
  const retriedSources = Math.max(0, Math.trunc(input.retriedSources ?? 0));
  const processed = Math.max(0, Math.trunc(input.processed ?? 0));
  const progressed = Math.max(0, Math.trunc(input.progressed ?? 0));
  const awardedXp = Math.max(0, Math.trunc(input.awardedXp ?? 0));
  const awardedCards = Math.max(0, Math.trunc(input.awardedCards ?? 0));
  const completedChallenges = Math.max(0, Math.trunc(input.completedChallenges ?? 0));
  const skipped = input.skipped ?? [];
  const failed = input.failed ?? [];
  const warnings = input.warnings ?? [];
  const taskStatus = failed.length
    ? "failed"
    : skipped.length || warnings.length
      ? "warning"
      : processed || acceptedSources || duplicateSources || collectedSources || retriedSources
        ? "success"
        : "no_op";

  return {
    ok: failed.length === 0,
    taskStatus,
    task_status: taskStatus,
    source: input.source,
    acceptedSources,
    accepted_sources: acceptedSources,
    duplicateSources,
    duplicate_sources: duplicateSources,
    collectedSources,
    collected_sources: collectedSources,
    retriedSources,
    retried_sources: retriedSources,
    processed,
    progressed,
    awardedXp,
    awarded_xp: awardedXp,
    awardedCards,
    awarded_cards: awardedCards,
    completedChallenges,
    completed_challenges: completedChallenges,
    skipped,
    failed,
    warnings,
  };
}

function awardOutcome(input: Partial<PlayerProgressionAwardOutcome> & { status: PlayerProgressionAwardOutcomeStatus; message: string }): PlayerProgressionAwardOutcome {
  return {
    status: input.status,
    source_type: input.source_type ?? null,
    source_id: input.source_id ?? null,
    user_id: input.user_id ?? null,
    challenge_id: input.challenge_id ?? null,
    message: input.message,
    progress_value: input.progress_value,
    target_value: input.target_value,
    xp_awarded: input.xp_awarded,
    calling_card_awarded: input.calling_card_awarded,
  };
}

function sourceRowOutcome(
  row: PlayerProgressionAwardSourceRow,
  status: PlayerProgressionAwardOutcomeStatus,
  message: string,
  extras: Partial<PlayerProgressionAwardOutcome> = {},
) {
  return awardOutcome({
    status,
    source_type: row.source_type,
    source_id: row.source_id,
    user_id: row.user_id,
    challenge_id: row.challenge_id,
    message,
    ...extras,
  });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message.slice(0, 240) : fallback;
}

function randomProgressionId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
