import { getSessionUser, requireDb } from "../../../_lib/db";
import { decryptToken } from "../../../_lib/crypto";
import {
  getNitradoLogSettingsConfirmation,
  recordNitradoLogSettingsVerification,
  updateNitradoLogSettingsConfirmation,
} from "../../../_lib/automation";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { fetchNitradoLogSettingsVerification, NitradoServiceLookupError } from "../../../_lib/nitrado";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

type SaveNitradoLogSettingsBody = {
  nitrado_reduce_log_output_confirmed?: boolean;
  nitrado_log_playerlist_confirmed?: boolean;
};

type NitradoLogSettingsValues = {
  admin_log_enabled: boolean | null;
  server_log_enabled: boolean | null;
  reduce_log_output_disabled: boolean | null;
  log_playerlist_enabled: boolean | null;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  const server = await requireOwnedServer(env, user.id, linkedServerId);
  if (!server) return json({ error: "Server not found" }, { status: 404 });
  if (!server.guild_id) return json({ error: "Selected server has no Discord guild id." }, { status: 409 });

  if (request.method === "GET") {
    const shouldCheck = new URL(request.url).searchParams.get("check") === "1";
    const savedSettings = await getNitradoLogSettingsConfirmation(env, server.guild_id);
    if (!shouldCheck) {
      return json(buildSavedNitradoLogSettingsResponse(savedSettings), { headers: privateLogSettingsHeaders() });
    }

    if (isRecentNitradoLogSettingsCheck(savedSettings.nitrado_log_settings_last_checked_at)) {
      return json({
        ...buildSavedNitradoLogSettingsResponse(savedSettings),
        cached: true,
      }, { headers: privateLogSettingsHeaders() });
    }

    const checkedAt = new Date().toISOString();
    try {
      const token = await getNitradoTokenForLinkedServer(env, server);
      const verification = await fetchNitradoLogSettingsVerification(token, server.nitrado_service_id ?? "");
      const warnings = buildNitradoLogSettingsWarnings(verification.settings);
      const verificationStatus = getLiveVerificationStatus(verification.verified, warnings);
      const savedSettings = await recordNitradoLogSettingsVerification(env, {
        guildId: server.guild_id,
        reduceLogOutputDisabled: verification.settings.reduce_log_output_disabled,
        logPlayerlistEnabled: verification.settings.log_playerlist_enabled,
        adminLogEnabled: verification.settings.admin_log_enabled,
        serverLogEnabled: verification.settings.server_log_enabled,
        source: verification.source,
        checkedAt: verification.checkedAt,
        error: warnings.join(" ") || verification.reason,
      });
      return json({
        ok: true,
        verified: verification.verified,
        valid: verification.verified ? warnings.length === 0 : null,
        verificationStatus,
        settings: verification.settings,
        source: verification.source,
        checked_at: verification.checkedAt,
        reason: verification.reason,
        warnings,
        discovered_setting_keys: verification.discoveredSettingKeys,
        diagnostics: buildNitradoLogSettingsDiagnostics({
          source: verification.source,
          verificationStatus,
          checkedAt: verification.checkedAt,
          lastError: warnings.join(" ") || verification.reason,
          discoveredSettingKeys: verification.discoveredSettingKeys,
          settings: verification.settings,
        }),
        saved_settings: savedSettings,
      }, { headers: privateLogSettingsHeaders() });
    } catch (error) {
      const reason = logSettingsVerificationFallbackReason(error);
      const savedSettings = await recordNitradoLogSettingsVerification(env, {
        guildId: server.guild_id,
        reduceLogOutputDisabled: null,
        logPlayerlistEnabled: null,
        adminLogEnabled: null,
        serverLogEnabled: null,
        source: "manual_required",
        checkedAt,
        error: reason,
      });
      const verificationStatus = savedSettings.nitrado_reduce_log_output_confirmed && savedSettings.nitrado_log_playerlist_confirmed
        ? "manual_confirmed"
        : "manual_required";
      return json({
        ok: true,
        verified: false,
        valid: null,
        verificationStatus,
        settings: {
          admin_log_enabled: null,
          server_log_enabled: null,
          reduce_log_output_disabled: null,
          log_playerlist_enabled: null,
        },
        source: "manual_required",
        checked_at: checkedAt,
        reason,
        warnings: [],
        discovered_setting_keys: [],
        diagnostics: buildNitradoLogSettingsDiagnostics({
          source: "manual_required",
          verificationStatus,
          checkedAt,
          lastError: reason,
          discoveredSettingKeys: [],
          settings: UNKNOWN_NITRADO_LOG_SETTINGS,
        }),
        saved_settings: savedSettings,
      }, { headers: privateLogSettingsHeaders() });
    }
  }
  if (request.method !== "POST") return methodNotAllowed();

  const body = await readJson<SaveNitradoLogSettingsBody>(request);
  const settings = await updateNitradoLogSettingsConfirmation(env, {
    guildId: server.guild_id,
    reduceLogOutputConfirmed: body.nitrado_reduce_log_output_confirmed === true,
    logPlayerlistConfirmed: body.nitrado_log_playerlist_confirmed === true,
    source: "manual",
  });
  return json({ ok: true, settings });
};

const UNKNOWN_NITRADO_LOG_SETTINGS: NitradoLogSettingsValues = {
  admin_log_enabled: null,
  server_log_enabled: null,
  reduce_log_output_disabled: null,
  log_playerlist_enabled: null,
};

type SavedNitradoLogSettings = Awaited<ReturnType<typeof getNitradoLogSettingsConfirmation>>;

function buildSavedNitradoLogSettingsResponse(savedSettings: SavedNitradoLogSettings) {
  const source = savedSettings.nitrado_log_settings_verification_source ?? "not_checked";
  const verificationStatus = getSavedVerificationStatus(savedSettings);
  const settings = getSavedNitradoLogSettingsValues(savedSettings, verificationStatus);
  const warnings = verificationStatus === "verified_wrong" ? buildNitradoLogSettingsWarnings(settings) : [];
  return {
    ok: true,
    verified: verificationStatus === "verified" || verificationStatus === "verified_wrong",
    valid: verificationStatus === "verified" ? true : verificationStatus === "verified_wrong" ? false : null,
    verificationStatus,
    settings,
    source,
    checked_at: savedSettings.nitrado_log_settings_last_checked_at ?? "",
    reason: savedSettings.nitrado_log_settings_last_error,
    warnings,
    discovered_setting_keys: [],
    diagnostics: buildNitradoLogSettingsDiagnostics({
      source,
      verificationStatus,
      checkedAt: savedSettings.nitrado_log_settings_last_checked_at,
      lastError: savedSettings.nitrado_log_settings_last_error,
      discoveredSettingKeys: [],
      settings,
    }),
    saved_settings: savedSettings,
  };
}

function getSavedVerificationStatus(savedSettings: SavedNitradoLogSettings) {
  const source = savedSettings.nitrado_log_settings_verification_source;
  const hasChecked = Boolean(savedSettings.nitrado_log_settings_last_checked_at);
  const requiredConfirmed = savedSettings.nitrado_reduce_log_output_confirmed && savedSettings.nitrado_log_playerlist_confirmed;

  if (source === "nitrado_api") return requiredConfirmed ? "verified" : "verified_wrong";
  if (source === "manual") return requiredConfirmed ? "manual_confirmed" : "manual_required";
  if (source === "manual_required") return requiredConfirmed ? "manual_confirmed" : "manual_required";
  if (hasChecked && savedSettings.nitrado_log_settings_last_error) return "manual_required";
  return "not_checked";
}

function getSavedNitradoLogSettingsValues(
  savedSettings: SavedNitradoLogSettings,
  verificationStatus: string,
) {
  if (verificationStatus === "not_checked" || verificationStatus === "manual_required") {
    return {
      admin_log_enabled: savedSettings.nitrado_admin_log_enabled ?? null,
      server_log_enabled: savedSettings.nitrado_server_log_enabled ?? null,
      reduce_log_output_disabled: null,
      log_playerlist_enabled: null,
    };
  }
  return {
    admin_log_enabled: savedSettings.nitrado_admin_log_enabled ?? null,
    server_log_enabled: savedSettings.nitrado_server_log_enabled ?? null,
    reduce_log_output_disabled: savedSettings.nitrado_reduce_log_output_confirmed,
    log_playerlist_enabled: savedSettings.nitrado_log_playerlist_confirmed,
  };
}

function getLiveVerificationStatus(verified: boolean, warnings: string[]) {
  if (!verified) return "manual_required";
  return warnings.length > 0 ? "verified_wrong" : "verified";
}

function buildNitradoLogSettingsDiagnostics(input: {
  source: string;
  verificationStatus: string;
  checkedAt: string | null;
  lastError: string | null;
  discoveredSettingKeys: string[];
  settings: NitradoLogSettingsValues;
}) {
  return {
    source: input.source,
    verificationStatus: input.verificationStatus,
    last_checked_at: input.checkedAt,
    last_error: input.lastError,
    discovered_setting_keys: input.discoveredSettingKeys,
    parsed_values: input.settings,
  };
}

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;

  const { ensureMockUser } = await import("../../../_lib/db");
  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

async function requireOwnedServer(env: Env, userId: string, linkedServerId: string) {
  return requireDb(env)
    .prepare(
      `SELECT id, user_id, guild_id, nitrado_service_id
       FROM linked_servers
       WHERE id = ?
         AND user_id = ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(linkedServerId, userId)
    .first<{ id: string; user_id: string; guild_id: string | null; nitrado_service_id: string | null }>();
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function isRecentNitradoLogSettingsCheck(value: string | null | undefined) {
  if (!value) return false;
  const checkedAt = Date.parse(value);
  return Number.isFinite(checkedAt) && Date.now() - checkedAt < 15 * 60 * 1000;
}

function privateLogSettingsHeaders() {
  return {
    "cache-control": "private, max-age=30",
  };
}

async function getNitradoTokenForLinkedServer(
  env: Env,
  server: { id: string; user_id: string },
) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const row = await requireDb(env)
    .prepare(
      `SELECT encrypted_token, token_iv, token_auth_tag
       FROM nitrado_connections
       WHERE user_id = ? AND linked_server_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(server.user_id, server.id)
    .first<{ encrypted_token: string; token_iv: string; token_auth_tag: string }>();
  if (!row) throw new Error("No Nitrado token found for this linked server");
  return decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag, env.TOKEN_ENCRYPTION_KEY);
}

function buildNitradoLogSettingsWarnings(settings: {
  reduce_log_output_disabled: boolean | null;
  log_playerlist_enabled: boolean | null;
  admin_log_enabled: boolean | null;
  server_log_enabled: boolean | null;
}) {
  const warnings: string[] = [];
  if (settings.admin_log_enabled === false) warnings.push("Admin Log must be enabled.");
  if (settings.server_log_enabled === false) warnings.push("Server Log must be enabled.");
  if (settings.reduce_log_output_disabled === false) warnings.push("Reduce Log Output must be disabled.");
  if (settings.log_playerlist_enabled === false) warnings.push("Log Playerlist must be enabled.");
  return warnings;
}

function logSettingsVerificationFallbackReason(error: unknown) {
  if (error instanceof NitradoServiceLookupError) {
    if (error.code === "invalid_token" || error.code === "access_denied") return "DZN could not verify these settings because the Nitrado token cannot access this service.";
    if (error.code === "service_not_found") return "DZN could not verify these settings because the Nitrado service was not found.";
    return "DZN could not verify these settings automatically from Nitrado.";
  }
  return error instanceof Error ? error.message : "DZN could not verify these settings automatically from Nitrado.";
}
