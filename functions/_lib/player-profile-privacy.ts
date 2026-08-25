import type { Env, SessionUser } from "./types";

export const PLAYER_PROFILE_PRIVACY_SETTINGS_HREF = "/api/player/profile-privacy";
export const PLAYER_PUBLIC_PROFILE_HREF_PREFIX = "/players";
export const PLAYER_PUBLIC_PROFILE_API_HREF_PREFIX = "/api/public/player-profiles";

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
  public_handle: string | null;
  public_href: string | null;
  public_api_href: string | null;
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
  public_handle?: unknown;
  user_id?: unknown;
  discord_id?: unknown;
};

type PlayerProfilePrivacyPreferenceRow = {
  public_handle?: string | null;
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
    const row = await readPlayerProfilePrivacyPreferenceRow(env, user.id);

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
  let next = mergePlayerProfilePrivacyPreferences(current, safePatch);

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
    if (next.public_profile_enabled && !next.public_handle) {
      next = withPublicProfileHandle(next, await createUniquePublicProfileHandle(env, user));
    }

    await env.DB
      .prepare(
        `INSERT INTO player_profile_privacy_preferences (
           user_id,
           public_handle,
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
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           public_handle = COALESCE(player_profile_privacy_preferences.public_handle, excluded.public_handle),
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
        next.public_handle,
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
    public_handle: null,
    public_href: null,
    public_api_href: null,
    public_profile_enabled: false,
    persistence,
    settings_href: PLAYER_PROFILE_PRIVACY_SETTINGS_HREF,
    updated_at: null,
    controls: { ...DEFAULT_CONTROLS },
    public_safe_preview: publicSafePreview(DEFAULT_CONTROLS),
  };
}

export function normalizePublicProfileHandle(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/.test(text) ? text : null;
}

export function publicPlayerProfileHref(handle: unknown) {
  const safeHandle = normalizePublicProfileHandle(handle);
  return safeHandle ? `${PLAYER_PUBLIC_PROFILE_HREF_PREFIX}/${encodeURIComponent(safeHandle)}` : null;
}

export function publicPlayerProfileApiHref(handle: unknown) {
  const safeHandle = normalizePublicProfileHandle(handle);
  return safeHandle ? `${PLAYER_PUBLIC_PROFILE_API_HREF_PREFIX}/${encodeURIComponent(safeHandle)}` : null;
}

async function readPlayerProfilePrivacyPreferenceRow(env: Env, userId: string) {
  try {
    return await env.DB
      ?.prepare(
        `SELECT
           public_handle,
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
      .bind(userId)
      .first<PlayerProfilePrivacyPreferenceRow>();
  } catch {
    return env.DB
      ?.prepare(
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
      .bind(userId)
      .first<PlayerProfilePrivacyPreferenceRow>();
  }
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
  const publicHandle = normalizePublicProfileHandle(row.public_handle);

  return {
    public_handle: publicHandle,
    public_href: publicPlayerProfileHref(publicHandle),
    public_api_href: publicPlayerProfileApiHref(publicHandle),
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
    public_handle: current.public_handle,
    public_href: current.public_href,
    public_api_href: current.public_api_href,
    public_profile_enabled: patchedBoolean(patch.public_profile_enabled, current.public_profile_enabled),
    persistence: current.persistence,
    settings_href: PLAYER_PROFILE_PRIVACY_SETTINGS_HREF,
    updated_at: current.updated_at,
    controls,
    public_safe_preview: publicSafePreview(controls),
  };
}

function withPublicProfileHandle(
  preferences: PlayerProfilePrivacyPreferences,
  publicHandle: string,
): PlayerProfilePrivacyPreferences {
  return {
    ...preferences,
    public_handle: publicHandle,
    public_href: publicPlayerProfileHref(publicHandle),
    public_api_href: publicPlayerProfileApiHref(publicHandle),
  };
}

async function createUniquePublicProfileHandle(env: Env, user: SessionUser) {
  const base = publicProfileHandleBase(user.username);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = normalizePublicProfileHandle(`${base}-${randomHandleSuffix(attempt === 0 ? 5 : 7)}`);
    if (!candidate) continue;
    const existing = await env.DB
      ?.prepare("SELECT user_id FROM player_profile_privacy_preferences WHERE public_handle = ? LIMIT 1")
      .bind(candidate)
      .first<{ user_id: string }>();
    if (!existing || existing.user_id === user.id) return candidate;
  }
  return normalizePublicProfileHandle(`dzn-player-${randomHandleSuffix(12)}`) ?? `dzn-player-${Date.now().toString(36)}`;
}

function publicProfileHandleBase(value: unknown) {
  const base = typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : "";
  const clipped = (base || "dzn-player").slice(0, 40).replace(/^-+|-+$/g, "");
  return normalizePublicProfileHandle(clipped.length >= 3 ? clipped : "dzn-player") ?? "dzn-player";
}

function randomHandleSuffix(length: number) {
  const boundedLength = Math.max(4, Math.min(Math.trunc(length), 16));
  const bytes = new Uint8Array(boundedLength);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
  }
  return Math.random().toString(36).slice(2, 2 + boundedLength).padEnd(boundedLength, "0");
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
