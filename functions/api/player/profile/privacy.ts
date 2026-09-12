import { ensureMockUser, getSessionUser, requireDb } from "../../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import {
  ensureCurrentPublicProfileHandle,
  readCurrentPublicProfileHandle,
  type PlayerPublicProfileHandle,
} from "../../../_lib/player-public-profiles";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

const preferenceFields = [
  {
    key: "public_profile_enabled",
    label: "Public profile",
    description: "Allow a future public-safe profile route to show approved sections after a handle exists.",
    defaultValue: false,
  },
  {
    key: "show_display_name",
    label: "Display name",
    description: "Show your chosen DZN display name on approved public profile surfaces.",
    defaultValue: true,
  },
  {
    key: "show_gameplay_summary",
    label: "Gameplay summary",
    description: "Show safe aggregate gameplay totals, never raw identifiers or raw evidence.",
    defaultValue: true,
  },
  {
    key: "show_featured_server",
    label: "Featured server",
    description: "Show a public-safe linked server highlight when one is available.",
    defaultValue: true,
  },
  {
    key: "show_xp_progress",
    label: "XP progress",
    description: "Show earned XP progress after trusted award rules exist.",
    defaultValue: true,
  },
  {
    key: "show_challenge_progress",
    label: "Challenge progress",
    description: "Show earned challenge progress after challenge participation exists.",
    defaultValue: true,
  },
  {
    key: "show_calling_cards",
    label: "Calling cards",
    description: "Show earned account-bound calling cards after that runtime exists.",
    defaultValue: true,
  },
  {
    key: "show_award_dates",
    label: "Award dates",
    description: "Show public-safe earned award dates. Raw award evidence stays private.",
    defaultValue: false,
  },
] as const;

type PreferenceField = (typeof preferenceFields)[number];
type PreferenceKey = PreferenceField["key"];
type PrivacyPreferences = Record<PreferenceKey, boolean>;
type PreferenceRow = Record<PreferenceKey, number | null> & {
  updated_at: string | null;
};

type PreferencePatchBody = {
  settings?: unknown;
};

const preferenceKeySet = new Set<PreferenceKey>(preferenceFields.map((field) => field.key));

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method === "GET") return handleGet(request, env);
  if (request.method === "PATCH") return handlePatch(request, env);
  return methodNotAllowed();
};

async function handleGet(request: Request, env: Env) {
  const user = await resolveUser(env, request);
  if (!user) {
    return json(
      { ok: false, error: "UNAUTHORIZED", message: "Log in with Discord to view profile privacy settings." },
      { status: 401, headers: privateNoStoreHeaders() },
    );
  }

  const result = await readPreferences(env, user.id);
  const publicProfile = result.source === "unavailable" ? null : await readPublicProfileHandleForPayload(env, user.id);
  return json(preferencePayload(result.preferences, result.source, result.updatedAt, publicProfile), {
    headers: privateNoStoreHeaders(),
  });
}

async function handlePatch(request: Request, env: Env) {
  const user = await resolveUser(env, request);
  if (!user) {
    return json(
      { ok: false, error: "UNAUTHORIZED", message: "Log in with Discord to update profile privacy settings." },
      { status: 401, headers: privateNoStoreHeaders() },
    );
  }
  if (!isSameOriginMutation(request)) {
    return json(
      { ok: false, error: "FORBIDDEN", message: "Cross-origin profile privacy updates are not allowed." },
      { status: 403, headers: privateNoStoreHeaders() },
    );
  }

  const bodyResult = await readBoundedJson<PreferencePatchBody>(request, 4096);
  if (!bodyResult.ok) {
    return json(
      { ok: false, error: bodyResult.error, message: bodyResult.message },
      { status: bodyResult.status, headers: privateNoStoreHeaders() },
    );
  }

  const parsed = parsePreferencePatch(bodyResult.value);
  if (!parsed.ok) {
    return json(
      { ok: false, error: "INVALID_SETTINGS", message: parsed.message },
      { status: 400, headers: privateNoStoreHeaders() },
    );
  }

  try {
    const current = await readPreferences(env, user.id);
    if (current.source === "unavailable") {
      return json(
        { ok: false, error: "SETTINGS_UNAVAILABLE", message: "Profile privacy settings are unavailable in this environment." },
        { status: 503, headers: privateNoStoreHeaders() },
      );
    }
    const next = { ...current.preferences, ...parsed.settings };
    const publicProfile = next.public_profile_enabled
      ? await ensureCurrentPublicProfileHandle(env, user)
      : await readPublicProfileHandleForPayload(env, user.id);
    await writePreferences(env, user.id, next);
    return json(preferencePayload(next, "player_profile_privacy_preferences", new Date().toISOString(), publicProfile), {
      headers: privateNoStoreHeaders(),
    });
  } catch {
    return json(
      { ok: false, error: "SETTINGS_UNAVAILABLE", message: "Profile privacy settings are unavailable in this environment." },
      { status: 503, headers: privateNoStoreHeaders() },
    );
  }
}

async function readPublicProfileHandleForPayload(env: Env, userId: string) {
  try {
    return await readCurrentPublicProfileHandle(env, userId);
  } catch {
    return null;
  }
}

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;

  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

async function readPreferences(env: Env, userId: string) {
  try {
    const db = requireDb(env);
    const row = await db
      .prepare(
        `SELECT
          public_profile_enabled,
          show_display_name,
          show_gameplay_summary,
          show_featured_server,
          show_xp_progress,
          show_challenge_progress,
          show_calling_cards,
          show_award_dates,
          updated_at
         FROM player_profile_privacy_preferences
         WHERE user_id = ?
         LIMIT 1`,
      )
      .bind(userId)
      .first<PreferenceRow>();

    return {
      preferences: rowToPreferences(row),
      source: row ? "player_profile_privacy_preferences" as const : "defaults" as const,
      updatedAt: row?.updated_at ?? null,
    };
  } catch {
    return {
      preferences: defaultPreferences(),
      source: "unavailable" as const,
      updatedAt: null,
    };
  }
}

async function writePreferences(env: Env, userId: string, preferences: PrivacyPreferences) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO player_profile_privacy_preferences (
        id,
        user_id,
        public_profile_enabled,
        show_display_name,
        show_gameplay_summary,
        show_featured_server,
        show_xp_progress,
        show_challenge_progress,
        show_calling_cards,
        show_award_dates,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        public_profile_enabled = excluded.public_profile_enabled,
        show_display_name = excluded.show_display_name,
        show_gameplay_summary = excluded.show_gameplay_summary,
        show_featured_server = excluded.show_featured_server,
        show_xp_progress = excluded.show_xp_progress,
        show_challenge_progress = excluded.show_challenge_progress,
        show_calling_cards = excluded.show_calling_cards,
        show_award_dates = excluded.show_award_dates,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      boolToInt(preferences.public_profile_enabled),
      boolToInt(preferences.show_display_name),
      boolToInt(preferences.show_gameplay_summary),
      boolToInt(preferences.show_featured_server),
      boolToInt(preferences.show_xp_progress),
      boolToInt(preferences.show_challenge_progress),
      boolToInt(preferences.show_calling_cards),
      boolToInt(preferences.show_award_dates),
      now,
      now,
    )
    .run();
}

function preferencePayload(
  preferences: PrivacyPreferences,
  source: "player_profile_privacy_preferences" | "defaults" | "unavailable",
  updatedAt: string | null,
  publicProfile: PlayerPublicProfileHandle | null,
) {
  const activePublicProfile = preferences.public_profile_enabled && publicProfile?.status === "active" ? publicProfile : null;
  return {
    ok: true,
    settings: preferences,
    sections: preferenceFields.map(({ key, label, description, defaultValue }) => ({
      key,
      label,
      description,
      default_value: defaultValue,
      enabled: preferences[key],
    })),
    public_profile_status: activePublicProfile
      ? "published"
      : preferences.public_profile_enabled
        ? "preferences_saved"
        : "private_by_default",
    public_profile_handle: activePublicProfile?.handle ?? null,
    public_profile_href: activePublicProfile?.href ?? null,
    source,
    updated_at: updatedAt,
    private: true,
    presentation_only: true,
    message: activePublicProfile
      ? `Your public profile is live at ${activePublicProfile.href}. Only the sections enabled here can appear there.`
      : preferences.public_profile_enabled
        ? "Your public profile display choices are saved, but a generated profile handle is not available in this environment yet."
        : "Your profile is private by default. Turn on public profile only when you want approved sections to appear on your DZN profile link.",
    fairness_boundary: [
      "Profile privacy preferences are player-owned display settings only.",
      "Generated profile handles are presentation-only and do not bypass saved visibility controls.",
      "These settings and handles do not write awards, billing, rankings, discovery, reviews, events, Server Wars, CTF, or competitive eligibility.",
    ],
  };
}

function parsePreferencePatch(body: PreferencePatchBody): { ok: true; settings: Partial<PrivacyPreferences> } | { ok: false; message: string } {
  if (!isPlainRecord(body.settings)) {
    return { ok: false, message: "Request body must include a settings object." };
  }

  const entries = Object.entries(body.settings);
  if (!entries.length) return { ok: false, message: "At least one profile privacy setting is required." };

  const settings: Partial<PrivacyPreferences> = {};
  for (const [key, value] of entries) {
    if (!isPreferenceKey(key)) return { ok: false, message: `Unsupported profile privacy setting: ${key}.` };
    if (typeof value !== "boolean") return { ok: false, message: `Profile privacy setting must be boolean: ${key}.` };
    settings[key] = value;
  }

  return { ok: true, settings };
}

function rowToPreferences(row: PreferenceRow | null): PrivacyPreferences {
  const defaults = defaultPreferences();
  if (!row) return defaults;

  return preferenceFields.reduce((next, field) => {
    next[field.key] = Number(row[field.key] ?? boolToInt(defaults[field.key])) === 1;
    return next;
  }, { ...defaults });
}

function defaultPreferences(): PrivacyPreferences {
  return preferenceFields.reduce((preferences, field) => {
    preferences[field.key] = field.defaultValue;
    return preferences;
  }, {} as PrivacyPreferences);
}

function isPreferenceKey(value: string): value is PreferenceKey {
  return preferenceKeySet.has(value as PreferenceKey);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boolToInt(value: boolean) {
  return value ? 1 : 0;
}

function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
