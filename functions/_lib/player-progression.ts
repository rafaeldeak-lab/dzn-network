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

const PROGRESS_HREF = "/events/challenges";

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
    const [challengeRows, participationRows, xpRow, callingCardRows] = await Promise.all([
      readActiveChallenges(env),
      readPlayerChallengeParticipations(env, user),
      readPlayerXpTotal(env, user),
      readPlayerCallingCardAwards(env, user),
    ]);
    const source: PlayerChallengeSource = challengeRows.length ? "live" : "catalog_fallback";
    return buildPayload(
      source,
      challengeRows.length ? challengeRows : FOUNDATION_CHALLENGES,
      participationRows,
      callingCardRows,
      numberOrZero(xpRow?.total_xp),
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

async function resolveJoinableChallenge(env: Env, target: JoinTarget): Promise<PlayerChallengeRow | null> {
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

  const now = new Date().toISOString();
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
): PlayerChallengesPayload {
  const participationByChallenge = new Map(
    participationRows.map((row) => [row.challenge_id, row] as const),
  );
  const challenges = challengeRows.map((row) => toChallengeSummary(row, participationByChallenge.get(row.id) ?? null));
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
      href: PROGRESS_HREF,
    },
    fetched_at: new Date().toISOString(),
  };
}

function toChallengeSummary(row: PlayerChallengeRow, participation: PlayerChallengeParticipationRow | null): PlayerChallengeSummary {
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

function safeTargetValue(value: unknown) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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

function randomProgressionId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
