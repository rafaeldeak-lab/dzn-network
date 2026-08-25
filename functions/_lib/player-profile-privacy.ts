import type { Env, SessionUser } from "./types";

export const PLAYER_PROFILE_PRIVACY_SETTINGS_HREF = "/api/player/profile-privacy";

export type PlayerProfilePrivacyPersistence = "saved" | "default" | "not_configured" | "unavailable";

export type PlayerProfilePrivacyControls = {
  show_xp: boolean;
  show_challenge_progress: boolean;
  show_calling_cards: boolean;
  show_award_dates: boolean;
  show_discord_identity: false;
  show_source_details: false;
};

export type PlayerProfilePrivacyPreferences = {
  public_profile_enabled: boolean;
  persistence: PlayerProfilePrivacyPersistence;
  settings_href: string;
  updated_at: string | null;
  controls: PlayerProfilePrivacyControls;
  public_safe_preview: {
    exposes_discord_id: false;
    exposes_user_id: false;
    exposes_source_ids: false;
    exposes_raw_evidence: false;
    hides_exact_award_times: boolean;
  };
};

export type PlayerProfilePrivacyPreferencePatch = {
  public_profile_enabled?: unknown;
  controls?: Partial<Record<keyof PlayerProfilePrivacyControls, unknown>>;
  show_xp?: unknown;
  show_challenge_progress?: unknown;
  show_calling_cards?: unknown;
  show_award_dates?: unknown;
  show_discord_identity?: unknown;
  show_source_details?: unknown;
  user_id?: unknown;
  discord_id?: unknown;
};

type PlayerProfilePrivacyPreferenceRow = {
  public_profile_enabled: number | boolean | null;
  show_xp: number | boolean | null;
  show_challenge_progress: number | boolean | null;
  show_calling_cards: number | boolean | null;
  show_award_dates: number | boolean | null;
  show_discord_identity: number | boolean | null;
  show_source_details: number | boolean | null;
  updated_at: string | null;
};

export type SavePlayerProfilePrivacyPreferencesResult = {
  status: 200 | 503;
  payload: {
    ok: boolean;
    privacy: PlayerProfilePrivacyPreferences;
    error?: string;
    message?: string;
    fairness: PlayerProfilePrivacyFairness;
  };
};

export type PlayerProfilePrivacyFairness = {
  paid_plan_influence: false;
  ranking_influence: false;
  discovery_score_influence: false;
  review_score_influence: false;
  badge_influence: false;
  season_influence: false;
  event_influence: false;
  server_wars_influence: false;
  xp_award_influence: false;
  calling_card_award_influence: false;
  competitive_eligibility_influence: false;
};

const DEFAULT_CONTROLS: PlayerProfilePrivacyControls = {
  show_xp: true,
  show_challenge_progress: true,
  show_calling_cards: true,
  show_award_dates: false,
  show_discord_identity: false,
  show_source_details: false,
};

export function playerProfilePrivacyFairness(): PlayerProfilePrivacyFairness {
  return {
    paid_plan_influence: false,
    ranking_influence: false,
    discovery_score_influence: false,
    review_score_influence: false,
    badge_influence: false,
    season_influence: false,
    event_influence: false,
    server_wars_influence: false,
    xp_award_influence: false,
    calling_card_award_influence: false,
    competitive_eligibility_influence: false,
  };
}

export async function getPlayerProfilePrivacyPreferences(
  env: Env,
  user: SessionUser,
): Promise<PlayerProfilePrivacyPreferences> {
  if (!env.DB) return defaultPlayerProfilePrivacyPreferences("unavailable");

  try {
    const row = await env.DB
      .prepare(
        `SELECT
           public_profile_enabled,
           show_xp,
           show_challenge_progress,
           show_calling_cards,
           show_award_dates,
           show_discord_identity,
           show_source_details,
           updated_at
         FROM player_profile_privacy_preferences
         WHERE user_id = ?
         LIMIT 1`,
      )
      .bind(user.id)
      .first<PlayerProfilePrivacyPreferenceRow>();

    if (!row) return defaultPlayerProfilePrivacyPreferences("default");
    return preferencesFromRow(row);
  } catch {
    return defaultPlayerProfilePrivacyPreferences("not_configured");
  }
}

export async function savePlayerProfilePrivacyPreferences(
  env: Env,
  user: SessionUser,
  patch: PlayerProfilePrivacyPreferencePatch,
): Promise<SavePlayerProfilePrivacyPreferencesResult> {
  const current = await getPlayerProfilePrivacyPreferences(env, user);
  const safePatch = normalizePreferencePatch(patch);
  const next = mergePlayerProfilePrivacyPreferences(current, safePatch);

  if (!env.DB) {
    return {
      status: 503,
      payload: {
        ok: false,
        error: "PLAYER_PROFILE_PRIVACY_UNAVAILABLE",
        message: "Player profile privacy preferences could not be saved right now.",
        privacy: defaultPlayerProfilePrivacyPreferences("unavailable"),
        fairness: playerProfilePrivacyFairness(),
      },
    };
  }

  const now = new Date().toISOString();
  try {
    await env.DB
      .prepare(
        `INSERT INTO player_profile_privacy_preferences (
           user_id,
           public_profile_enabled,
           show_xp,
           show_challenge_progress,
           show_calling_cards,
           show_award_dates,
           show_discord_identity,
           show_source_details,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           public_profile_enabled = excluded.public_profile_enabled,
           show_xp = excluded.show_xp,
           show_challenge_progress = excluded.show_challenge_progress,
           show_calling_cards = excluded.show_calling_cards,
           show_award_dates = excluded.show_award_dates,
           show_discord_identity = 0,
           show_source_details = 0,
           updated_at = excluded.updated_at`,
      )
      .bind(
        user.id,
        boolToDb(next.public_profile_enabled),
        boolToDb(next.controls.show_xp),
        boolToDb(next.controls.show_challenge_progress),
        boolToDb(next.controls.show_calling_cards),
        boolToDb(next.controls.show_award_dates),
        now,
        now,
      )
      .run();
  } catch {
    return {
      status: 503,
      payload: {
        ok: false,
        error: "PLAYER_PROFILE_PRIVACY_UNAVAILABLE",
        message: "Player profile privacy preferences could not be saved right now.",
        privacy: defaultPlayerProfilePrivacyPreferences("not_configured"),
        fairness: playerProfilePrivacyFairness(),
      },
    };
  }

  return {
    status: 200,
    payload: {
      ok: true,
      privacy: {
        ...next,
        persistence: "saved",
        updated_at: now,
      },
      fairness: playerProfilePrivacyFairness(),
    },
  };
}

export function defaultPlayerProfilePrivacyPreferences(
  persistence: PlayerProfilePrivacyPersistence = "default",
): PlayerProfilePrivacyPreferences {
  return {
    public_profile_enabled: false,
    persistence,
    settings_href: PLAYER_PROFILE_PRIVACY_SETTINGS_HREF,
    updated_at: null,
    controls: { ...DEFAULT_CONTROLS },
    public_safe_preview: publicSafePreview(DEFAULT_CONTROLS),
  };
}

function preferencesFromRow(row: PlayerProfilePrivacyPreferenceRow): PlayerProfilePrivacyPreferences {
  const controls = {
    show_xp: dbBool(row.show_xp, true),
    show_challenge_progress: dbBool(row.show_challenge_progress, true),
    show_calling_cards: dbBool(row.show_calling_cards, true),
    show_award_dates: dbBool(row.show_award_dates, false),
    show_discord_identity: false,
    show_source_details: false,
  } satisfies PlayerProfilePrivacyControls;

  return {
    public_profile_enabled: dbBool(row.public_profile_enabled, false),
    persistence: "saved",
    settings_href: PLAYER_PROFILE_PRIVACY_SETTINGS_HREF,
    updated_at: nullableString(row.updated_at),
    controls,
    public_safe_preview: publicSafePreview(controls),
  };
}

function normalizePreferencePatch(patch: PlayerProfilePrivacyPreferencePatch): PlayerProfilePrivacyPreferencePatch {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};
  return patch;
}

function mergePlayerProfilePrivacyPreferences(
  current: PlayerProfilePrivacyPreferences,
  patch: PlayerProfilePrivacyPreferencePatch,
): PlayerProfilePrivacyPreferences {
  const controlsPatch = patch && typeof patch.controls === "object" && patch.controls ? patch.controls : {};
  const controls = {
    show_xp: patchedBoolean(controlsPatch.show_xp ?? patch.show_xp, current.controls.show_xp),
    show_challenge_progress: patchedBoolean(
      controlsPatch.show_challenge_progress ?? patch.show_challenge_progress,
      current.controls.show_challenge_progress,
    ),
    show_calling_cards: patchedBoolean(
      controlsPatch.show_calling_cards ?? patch.show_calling_cards,
      current.controls.show_calling_cards,
    ),
    show_award_dates: patchedBoolean(controlsPatch.show_award_dates ?? patch.show_award_dates, current.controls.show_award_dates),
    show_discord_identity: false,
    show_source_details: false,
  } satisfies PlayerProfilePrivacyControls;

  return {
    public_profile_enabled: patchedBoolean(patch.public_profile_enabled, current.public_profile_enabled),
    persistence: current.persistence,
    settings_href: PLAYER_PROFILE_PRIVACY_SETTINGS_HREF,
    updated_at: current.updated_at,
    controls,
    public_safe_preview: publicSafePreview(controls),
  };
}

function publicSafePreview(controls: PlayerProfilePrivacyControls): PlayerProfilePrivacyPreferences["public_safe_preview"] {
  void controls;
  return {
    exposes_discord_id: false,
    exposes_user_id: false,
    exposes_source_ids: false,
    exposes_raw_evidence: false,
    hides_exact_award_times: true,
  };
}

function patchedBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function dbBool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  return fallback;
}

function boolToDb(value: boolean) {
  return value ? 1 : 0;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
