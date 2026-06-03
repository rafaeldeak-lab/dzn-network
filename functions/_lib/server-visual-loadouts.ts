import { normalizePlanKey, type NormalizedPlanKey } from "../../lib/billing/plans";
import { getBadgeRule, normalizeBadgeCode, selectShowcaseBadges } from "../../lib/badges/rules";
import {
  getAvailableFrameVisuals,
  getAvailableThemeBannerVisuals,
  toVisualBadge,
  type ProfileFrameVisual,
  type ServerThemeBannerVisual,
  type VisualBadge,
} from "../../lib/badges/visuals";
import { isDznAdminDiscordId } from "./admin";
import { getEarnedServerBadges } from "./badge-awards";
import { ensureMockUser, getSessionUser, requireDb } from "./db";
import { isMockAuth } from "./mock";
import type { Env, SessionUser } from "./types";

export type VisualLoadoutInput = {
  showcaseBadges?: unknown;
  profileFrameKey?: unknown;
  themeBannerKey?: unknown;
  animationEnabled?: unknown;
  reason?: unknown;
};

export type VisualLoadoutPlanLimits = {
  planKey: NormalizedPlanKey;
  maxShowcaseBadges: number;
  animationsAllowed: boolean;
};

export type ServerVisualLoadout = {
  serverId: string;
  showcaseBadges: VisualBadge[];
  showcaseBadgeCodes: string[];
  profileFrame: ProfileFrameVisual;
  profileFrameKey: string;
  themeBanner: ServerThemeBannerVisual;
  themeBannerKey: string;
  animationEnabled: boolean;
  limits: VisualLoadoutPlanLimits;
  updatedAt: string | null;
};

export type OwnerVisualLoadoutServer = {
  id: string;
  user_id: string | null;
  guild_id: string | null;
  nitrado_service_id: string | null;
  public_slug: string | null;
  server_name: string | null;
  server_category: string | null;
  server_type: string | null;
  plan_key: string | null;
  subscription_status: string | null;
};

type VisualLoadoutRow = {
  id: string;
  server_id: string;
  showcase_badges_json: string | null;
  profile_frame_key: string | null;
  theme_banner_key: string | null;
  animation_enabled: number | null;
  updated_by_user_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ValidatedLoadoutSelection = {
  showcaseBadgeCodes: string[];
  profileFrameKey: string;
  themeBannerKey: string;
  animationEnabled: boolean;
  reason: string | null;
  limits: VisualLoadoutPlanLimits;
};

type AuthResolution =
  | { ok: true; user: SessionUser; server: OwnerVisualLoadoutServer; role: "owner" | "admin" | "support" }
  | { ok: false; status: 401 | 403 | 404; errorCode: string; message: string; user?: SessionUser };

const DEFAULT_FRAME_KEY = "bronze";
const DEFAULT_THEME_KEY = "apocalypse";
const PREMIUM_DEFAULT_FRAME_KEY = "premium";
const PREMIUM_DEFAULT_THEME_KEY = "space";
const REPUTATION_FRAME_KEYS = ["bronze", "silver", "gold", "platinum", "diamond", "legendary"];
const STANDARD_THEME_KEYS = ["apocalypse", "chernarus", "winter", "desert", "island", "military", "night_ops"];

export const VISUAL_LOADOUT_PLAN_LIMITS: Record<NormalizedPlanKey, Omit<VisualLoadoutPlanLimits, "planKey">> = {
  free: { maxShowcaseBadges: 3, animationsAllowed: false },
  starter: { maxShowcaseBadges: 3, animationsAllowed: false },
  pro: { maxShowcaseBadges: 5, animationsAllowed: false },
  premium: { maxShowcaseBadges: 8, animationsAllowed: true },
};

export class VisualLoadoutError extends Error {
  status: number;
  errorCode: string;

  constructor(errorCode: string, message: string, status = 400) {
    super(message);
    this.name = "VisualLoadoutError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

export async function resolveOwnerVisualLoadoutServer(env: Env, request: Request, rawServerId: unknown): Promise<AuthResolution> {
  const user = await resolveRequestUser(env, request);
  if (!user) return { ok: false, status: 401, errorCode: "NOT_AUTHENTICATED", message: "Log in to manage this server." };

  const serverId = cleanIdentifier(rawServerId);
  if (!serverId) return { ok: false, status: 404, errorCode: "SERVER_NOT_FOUND", message: "Server not found.", user };

  const server = await findLinkedServer(env, serverId);
  if (!server) return { ok: false, status: 404, errorCode: "SERVER_NOT_FOUND", message: "Server not found.", user };

  const elevatedRole = getElevatedRole(env, user);
  if (server.user_id === user.id) return { ok: true, user, server, role: "owner" };
  if (elevatedRole) return { ok: true, user, server, role: elevatedRole };
  return { ok: false, status: 403, errorCode: "NOT_AUTHORIZED", message: "You do not have access to this server.", user };
}

export async function getServerVisualLoadout(env: Env, serverId: string) {
  await ensureServerVisualLoadoutSchema(env);
  return requireDb(env)
    .prepare("SELECT * FROM server_visual_loadouts WHERE server_id = ? LIMIT 1")
    .bind(serverId)
    .first<VisualLoadoutRow>();
}

export async function resolveServerVisualLoadout(env: Env, serverId: string): Promise<ServerVisualLoadout> {
  await ensureServerVisualLoadoutSchema(env);
  const [server, saved, earned, availableFrames, availableThemes] = await Promise.all([
    findLinkedServer(env, serverId),
    getServerVisualLoadout(env, serverId),
    getEarnedServerBadges(env, serverId).catch(() => []),
    getAvailableFramesForServer(env, serverId),
    getAvailableThemesForServer(env, serverId),
  ]);
  if (!server) throw new VisualLoadoutError("SERVER_NOT_FOUND", "Server not found.", 404);

  const limits = getVisualLoadoutPlanLimits(server.plan_key);
  const availableBadges = earnedAwardsToShowcaseBadges(earned);
  const availableBadgeByCode = new Map(availableBadges.map((badge) => [badge.code, badge]));
  const savedBadgeCodes = parseSavedBadgeCodes(saved?.showcase_badges_json).filter((code) => availableBadgeByCode.has(code));
  const showcaseBadgeCodes = savedBadgeCodes.slice(0, limits.maxShowcaseBadges);
  const frameKey = availableFrames.some((frame) => frame.key === normalizeVisualKey(saved?.profile_frame_key))
    ? normalizeVisualKey(saved?.profile_frame_key)
    : defaultFrameKeyForPlan(limits.planKey, availableFrames);
  const themeKey = availableThemes.some((theme) => theme.key === normalizeVisualKey(saved?.theme_banner_key))
    ? normalizeVisualKey(saved?.theme_banner_key)
    : defaultThemeKeyForPlan(limits.planKey, availableThemes);
  const animationEnabled = limits.animationsAllowed && saved?.animation_enabled !== 0;

  return {
    serverId: server.id,
    showcaseBadges: showcaseBadgeCodes.map((code) => availableBadgeByCode.get(code)).filter(Boolean) as VisualBadge[],
    showcaseBadgeCodes,
    profileFrame: availableFrames.find((frame) => frame.key === frameKey) ?? availableFrames[0],
    profileFrameKey: frameKey,
    themeBanner: availableThemes.find((theme) => theme.key === themeKey) ?? availableThemes[0],
    themeBannerKey: themeKey,
    animationEnabled,
    limits,
    updatedAt: saved?.updated_at ?? null,
  };
}

export async function validateServerVisualLoadout(env: Env, serverId: string, input: VisualLoadoutInput): Promise<ValidatedLoadoutSelection> {
  await ensureServerVisualLoadoutSchema(env);
  const server = await findLinkedServer(env, serverId);
  if (!server) throw new VisualLoadoutError("SERVER_NOT_FOUND", "Server not found.", 404);

  const [saved, availableBadges, availableFrames, availableThemes] = await Promise.all([
    getServerVisualLoadout(env, server.id),
    getAvailableShowcaseBadgesForServer(env, server.id),
    getAvailableFramesForServer(env, server.id),
    getAvailableThemesForServer(env, server.id),
  ]);
  const limits = getVisualLoadoutPlanLimits(server.plan_key);
  const existingCodes = parseSavedBadgeCodes(saved?.showcase_badges_json);
  const requestedCodes = input.showcaseBadges === undefined ? existingCodes : parseInputBadgeCodes(input.showcaseBadges);
  const uniqueCodes = dedupe(requestedCodes);
  if (uniqueCodes.length > limits.maxShowcaseBadges) {
    throw new VisualLoadoutError("SHOWCASE_BADGE_LIMIT_EXCEEDED", `Your plan allows up to ${limits.maxShowcaseBadges} showcase badges.`);
  }

  const availableBadgeCodes = new Set(availableBadges.map((badge) => badge.code));
  const unavailableBadge = uniqueCodes.find((code) => !availableBadgeCodes.has(code));
  if (unavailableBadge) {
    throw new VisualLoadoutError("BADGE_NOT_EARNED", "Showcase badges must be earned before they can be selected.");
  }

  const frameKey = normalizeVisualKey(input.profileFrameKey === undefined ? saved?.profile_frame_key : input.profileFrameKey);
  const selectedFrameKey = frameKey || defaultFrameKeyForPlan(limits.planKey, availableFrames);
  if (!availableFrames.some((frame) => frame.key === selectedFrameKey)) {
    throw new VisualLoadoutError("FRAME_NOT_AVAILABLE", "That profile frame is not available for this server.");
  }

  const themeKey = normalizeVisualKey(input.themeBannerKey === undefined ? saved?.theme_banner_key : input.themeBannerKey);
  const selectedThemeKey = themeKey || defaultThemeKeyForPlan(limits.planKey, availableThemes);
  if (!availableThemes.some((theme) => theme.key === selectedThemeKey)) {
    throw new VisualLoadoutError("THEME_NOT_AVAILABLE", "That theme banner is not available for this server.");
  }

  const requestedAnimation = input.animationEnabled === undefined ? saved?.animation_enabled !== 0 : parseBoolean(input.animationEnabled);
  if (requestedAnimation && !limits.animationsAllowed) {
    throw new VisualLoadoutError("ANIMATION_PLAN_REQUIRED", "Animated loadouts require Premium.");
  }

  return {
    showcaseBadgeCodes: uniqueCodes,
    profileFrameKey: selectedFrameKey,
    themeBannerKey: selectedThemeKey,
    animationEnabled: Boolean(requestedAnimation && limits.animationsAllowed),
    reason: typeof input.reason === "string" ? input.reason.trim().slice(0, 300) || null : null,
    limits,
  };
}

export async function saveServerVisualLoadout(env: Env, serverId: string, actorUserId: string, input: VisualLoadoutInput): Promise<ServerVisualLoadout> {
  await ensureServerVisualLoadoutSchema(env);
  const current = await getServerVisualLoadout(env, serverId);
  const validated = await validateServerVisualLoadout(env, serverId, input);
  const now = new Date().toISOString();
  const id = current?.id ?? crypto.randomUUID();
  const newValue = {
    showcaseBadges: validated.showcaseBadgeCodes,
    profileFrameKey: validated.profileFrameKey,
    themeBannerKey: validated.themeBannerKey,
    animationEnabled: validated.animationEnabled,
  };

  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO server_visual_loadouts (
        id, server_id, showcase_badges_json, profile_frame_key, theme_banner_key,
        animation_enabled, updated_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(server_id) DO UPDATE SET
        showcase_badges_json = excluded.showcase_badges_json,
        profile_frame_key = excluded.profile_frame_key,
        theme_banner_key = excluded.theme_banner_key,
        animation_enabled = excluded.animation_enabled,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      serverId,
      JSON.stringify(validated.showcaseBadgeCodes),
      validated.profileFrameKey,
      validated.themeBannerKey,
      validated.animationEnabled ? 1 : 0,
      actorUserId,
      current?.created_at ?? now,
      now,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO server_customisation_audit_log (
        id, server_id, actor_user_id, action, old_value_json, new_value_json, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      serverId,
      actorUserId,
      "visual_loadout_saved",
      current ? JSON.stringify({
        showcaseBadges: parseSavedBadgeCodes(current.showcase_badges_json),
        profileFrameKey: current.profile_frame_key,
        themeBannerKey: current.theme_banner_key,
        animationEnabled: current.animation_enabled !== 0,
      }) : null,
      JSON.stringify(newValue),
      validated.reason,
      now,
    )
    .run();

  return resolveServerVisualLoadout(env, serverId);
}

export async function getAvailableFramesForServer(env: Env, serverId: string): Promise<ProfileFrameVisual[]> {
  const server = await findLinkedServer(env, serverId);
  const plan = getVisualLoadoutPlanLimits(server?.plan_key).planKey;
  const frames = getAvailableFrameVisuals();
  if (plan === "premium") return Object.values(frames);
  if (plan === "pro") {
    const earnedReputation = await getEarnedReputationBadgeCodes(env, serverId);
    const keys = REPUTATION_FRAME_KEYS.filter((key) => key === DEFAULT_FRAME_KEY || earnedReputation.has(key));
    return keys.map((key) => frames[key]).filter(Boolean);
  }
  return [frames[DEFAULT_FRAME_KEY]].filter(Boolean);
}

export async function getAvailableThemesForServer(env: Env, serverId: string): Promise<ServerThemeBannerVisual[]> {
  const server = await findLinkedServer(env, serverId);
  const plan = getVisualLoadoutPlanLimits(server?.plan_key).planKey;
  const themes = getAvailableThemeBannerVisuals();
  const keys = plan === "premium" ? Object.keys(themes) : plan === "pro" ? STANDARD_THEME_KEYS : [DEFAULT_THEME_KEY];
  return keys.map((key) => themes[key]).filter(Boolean);
}

export async function getAvailableShowcaseBadgesForServer(env: Env, serverId: string): Promise<VisualBadge[]> {
  const earned = await getEarnedServerBadges(env, serverId).catch(() => []);
  return selectShowcaseBadges(earnedAwardsToShowcaseBadges(earned), 50);
}

export function getVisualLoadoutPlanLimits(planKey: unknown): VisualLoadoutPlanLimits {
  const normalized = normalizePlanKey(planKey);
  const limit = VISUAL_LOADOUT_PLAN_LIMITS[normalized] ?? VISUAL_LOADOUT_PLAN_LIMITS.free;
  return { planKey: normalized, ...limit };
}

export async function ensureServerVisualLoadoutSchema(env: Env) {
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_visual_loadouts (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL UNIQUE,
        showcase_badges_json TEXT,
        profile_frame_key TEXT,
        theme_banner_key TEXT,
        animation_enabled INTEGER NOT NULL DEFAULT 1,
        updated_by_user_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_visual_loadouts_server ON server_visual_loadouts(server_id)").run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_customisation_audit_log (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        old_value_json TEXT,
        new_value_json TEXT,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_customisation_audit_log_server ON server_customisation_audit_log(server_id, created_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_customisation_audit_log_action ON server_customisation_audit_log(action, created_at)").run();
}

async function resolveRequestUser(env: Env, request: Request): Promise<SessionUser | null> {
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

async function findLinkedServer(env: Env, rawServerId: unknown): Promise<OwnerVisualLoadoutServer | null> {
  const serverId = cleanIdentifier(rawServerId);
  if (!serverId) return null;
  return requireDb(env)
    .prepare(
      `SELECT linked_servers.id, linked_servers.user_id, linked_servers.guild_id,
              linked_servers.nitrado_service_id, linked_servers.public_slug,
              linked_servers.server_name, linked_servers.server_category, linked_servers.server_type,
              server_subscriptions.plan_key, server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE (linked_servers.id = ? OR linked_servers.nitrado_service_id = ? OR linked_servers.public_slug = ?)
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY CASE lower(COALESCE(server_subscriptions.status, ''))
          WHEN 'active' THEN 0
          WHEN 'trialing' THEN 1
          ELSE 2
        END,
        server_subscriptions.updated_at DESC,
        server_subscriptions.created_at DESC
       LIMIT 1`,
    )
    .bind(serverId, serverId, serverId)
    .first<OwnerVisualLoadoutServer>();
}

async function getEarnedReputationBadgeCodes(env: Env, serverId: string) {
  const awards = await getEarnedServerBadges(env, serverId).catch(() => []);
  return new Set(awards
    .map((award) => normalizeBadgeCode(award.badge_code))
    .filter((code) => getBadgeRule(code)?.category === "reputation"));
}

function earnedAwardsToShowcaseBadges(awards: Array<{ badge_code: string; awarded_at?: string | null }>) {
  return awards
    .map((award) => {
      const code = normalizeBadgeCode(award.badge_code);
      const rule = getBadgeRule(code);
      if (!rule) return null;
      return toVisualBadge({
        key: rule.badgeCode,
        name: rule.name,
        category: rule.category,
        description: rule.requirementDescription,
        permanent: rule.isPermanent,
      }, {
        earnedAt: award.awarded_at ?? null,
        locked: false,
      });
    })
    .filter((badge): badge is VisualBadge => Boolean(badge && badge.isPublic && badge.isShowcaseBadge));
}

function parseSavedBadgeCodes(value: string | null | undefined) {
  if (!value) return [];
  try {
    return parseInputBadgeCodes(JSON.parse(value));
  } catch {
    return [];
  }
}

function parseInputBadgeCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeBadgeCode(item))
    .filter(Boolean);
}

function dedupe(values: string[]) {
  return Array.from(new Set(values));
}

function defaultFrameKeyForPlan(planKey: NormalizedPlanKey, availableFrames: ProfileFrameVisual[]) {
  const preferred = planKey === "premium" ? PREMIUM_DEFAULT_FRAME_KEY : DEFAULT_FRAME_KEY;
  return availableFrames.some((frame) => frame.key === preferred) ? preferred : availableFrames[0]?.key ?? DEFAULT_FRAME_KEY;
}

function defaultThemeKeyForPlan(planKey: NormalizedPlanKey, availableThemes: ServerThemeBannerVisual[]) {
  const preferred = planKey === "premium" ? PREMIUM_DEFAULT_THEME_KEY : DEFAULT_THEME_KEY;
  return availableThemes.some((theme) => theme.key === preferred) ? preferred : availableThemes[0]?.key ?? DEFAULT_THEME_KEY;
}

function normalizeVisualKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return false;
}

function cleanIdentifier(value: unknown) {
  const clean = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9_-]{3,120}$/.test(clean) ? clean : "";
}

function getElevatedRole(env: Env, user: SessionUser): "admin" | "support" | null {
  if (isMockAuth(env.MOCK_AUTH) || isDznAdminDiscordId(env, user.discord_id)) return "admin";
  if (idListIncludes(env.DZN_SUPPORT_DISCORD_IDS, user.discord_id) || idListIncludes(env.DZN_DEV_DISCORD_IDS, user.discord_id)) return "support";
  return null;
}

function idListIncludes(list: string | undefined, value: string | null | undefined) {
  if (!list || !value) return false;
  return list
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(value);
}
