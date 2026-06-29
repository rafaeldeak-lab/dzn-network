import { getCurrentLinkedServer, getSessionUser, requireDb, saveServerAdmPath } from "../../_lib/db";
import { DiscordChannelFetchError, fetchDiscordPostingChannels } from "../../_lib/discord-posting";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { detectNitradoAdmLogs, getAdmLogStoragePath, mockAdmLogDetection, testExactNitradoAdmPath } from "../../_lib/nitrado";
import { getLatestNitradoToken } from "../../_lib/onboarding";
import { planAdmBackfillJobsForServer } from "../../_lib/adm-sync";
import { refreshNitradoServerMetadata } from "../../_lib/server-metadata";
import type { Env, PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });
  if (!user) return json({ error: "Authenticated user is required" }, { status: 401 });

  const linkedServer = await getCurrentLinkedServer(env, user.id, { includePrivateAdmPath: true });
  if (!linkedServer || typeof linkedServer.id !== "string") {
    return json({ error: "No linked server found" }, { status: 400 });
  }
  if (typeof linkedServer.nitrado_service_id !== "string" || !linkedServer.nitrado_service_id) {
    return json({ error: "No Nitrado service selected" }, { status: 400 });
  }

  let tokenValid = true;
  let tokenErrorCode: string | null = null;
  let tokenErrorMessage: string | null = null;
  let nitradoToken = "";
  if (!isMockNitrado(env.MOCK_NITRADO)) {
    try {
      const latestToken = await getLatestNitradoToken(env, user.id);
      if (!latestToken) {
        tokenValid = false;
        tokenErrorCode = "missing_nitrado_token";
        tokenErrorMessage = "No saved Nitrado token was found. Paste your Nitrado long-life token and validate this service again.";
      } else {
        nitradoToken = latestToken;
      }
    } catch (error) {
      tokenValid = false;
      const classified = classifyNitradoTokenError(error);
      tokenErrorCode = classified.code;
      tokenErrorMessage = classified.message;
    }
  }

  const metadataResult = tokenValid
    ? await refreshNitradoServerMetadata(env, {
        linkedServerId: linkedServer.id,
        userId: user.id,
        force: true,
      }).catch(() => null)
    : null;
  const savedAdmPath = typeof linkedServer.adm_path === "string" ? linkedServer.adm_path : "";
  const admLog = !tokenValid
    ? null
    : isMockNitrado(env.MOCK_NITRADO)
      ? mockAdmLogDetection()
      : savedAdmPath
        ? await testExactNitradoAdmPath(nitradoToken, linkedServer.nitrado_service_id, savedAdmPath)
        : await detectNitradoAdmLogs(nitradoToken, linkedServer.nitrado_service_id);

  const admStoragePath = admLog ? getAdmLogStoragePath(admLog) : null;
  if (admLog?.admFileExists && admStoragePath) {
    await saveServerAdmPath(env, linkedServer.id, admStoragePath.replace(/^\/+/, ""));
  }
  let admBackfill = null;
  if (tokenValid && (admLog?.admFileExists || admLog?.found)) {
    admBackfill = isMockNitrado(env.MOCK_NITRADO)
      ? {
          ok: true,
          status: "mock_adm_ready",
          message: "Mock ADM logs are available for setup verification.",
          files_found: 1,
          newest_available_adm_file: admLog?.newestAdmFileName ?? "mock.ADM",
          newest_readable_adm_file: admLog?.newestAdmFileName ?? "mock.ADM",
          latest_processed_adm_file: null,
          created_jobs: [],
          active_job: null,
        }
      : await planAdmBackfillJobsForServer(env, user.id, linkedServer.id, {
          maxJobsToCreate: 1,
          triggerType: "setup",
          processImmediately: true,
          chunksToProcess: 1,
          scheduledBudgeted: false,
          skipMetadataRefresh: true,
        })
          .then((result) => summarizeAdmBackfillForSetup(result))
          .catch((error) => ({
            ok: false,
            status: "adm_backfill_unavailable",
            message: error instanceof Error ? error.message : "DZN found ADM logs, but the initial import could not start. Try again shortly.",
            files_found: admLog?.found ? 1 : 0,
            newest_available_adm_file: admLog?.newestAdmFileName ?? null,
            newest_readable_adm_file: admLog?.sampleReadSucceeded ? admLog.newestAdmFileName ?? null : null,
            latest_processed_adm_file: null,
            created_jobs: [],
            active_job: null,
          }));
  }
  const discordCheck = await verifyDiscordBotForSetup(env, linkedServer.guild_id);

  const checks = {
    token_valid: tokenValid ? 1 : 0,
    service_access: tokenValid ? 1 : 0,
    adm_logs_found: admLog?.found ? 1 : 0,
    dayz_service_detected: tokenValid ? 1 : 0,
  };

  const db = requireDb(env);
  const existing = await db
    .prepare("SELECT id FROM onboarding_checks WHERE linked_server_id = ? LIMIT 1")
    .bind(linkedServer.id)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE onboarding_checks SET
          token_valid = ?,
          service_access = ?,
          adm_logs_found = ?,
          dayz_service_detected = ?,
          last_tested_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .bind(
        checks.token_valid,
        checks.service_access,
        checks.adm_logs_found,
        checks.dayz_service_detected,
        existing.id,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO onboarding_checks (
          id, linked_server_id, token_valid, service_access, adm_logs_found, dayz_service_detected, last_tested_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        crypto.randomUUID(),
        linkedServer.id,
        checks.token_valid,
        checks.service_access,
        checks.adm_logs_found,
        checks.dayz_service_detected,
      )
      .run();
  }

  return json({
    ok: true,
    checks: {
      tokenValid,
      serviceAccess: tokenValid,
      admLogsFound: Boolean(checks.adm_logs_found),
      dayzServiceDetected: Boolean(checks.dayz_service_detected),
      metadataSynced: Boolean(metadataResult?.ok),
      discordBotConnected: discordCheck.botConnected,
      discordChannelsAvailable: discordCheck.channelsAvailable,
      discordPostableChannelCount: discordCheck.postableChannelCount,
      discordBotGuildId: discordCheck.guildId,
      discordBotCheckedAt: discordCheck.checkedAt,
      discordBotErrorCode: discordCheck.errorCode,
      discordBotErrorMessage: discordCheck.errorMessage,
      tokenErrorCode,
      tokenErrorMessage,
      admLog: admLog ?? undefined,
      admBackfill: admBackfill ?? undefined,
    },
  });
};

function summarizeAdmBackfillForSetup(result: Awaited<ReturnType<typeof planAdmBackfillJobsForServer>>) {
  const completedJob = (result.created_jobs ?? []).find((job) => /complete|caught_up/i.test(String(job.status ?? "")));
  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    files_found: result.files_found,
    newest_available_adm_file: result.newest_available_adm_file ?? null,
    newest_readable_adm_file: result.newest_readable_adm_file ?? null,
    latest_processed_adm_file: completedJob?.adm_file ?? null,
    queued_files: (result.created_jobs ?? []).map((job) => job.adm_file),
    created_jobs: (result.created_jobs ?? []).map((job) => ({
      id: job.id,
      adm_file: job.adm_file,
      status: job.status,
      line_start: job.line_start,
      line_end: job.line_end,
    })),
    active_job: result.active_job
      ? {
          id: result.active_job.id,
          adm_file: result.active_job.adm_file,
          status: result.active_job.status,
          line_start: result.active_job.line_start,
          line_end: result.active_job.line_end,
        }
      : null,
  };
}

async function verifyDiscordBotForSetup(env: Env, guildId: unknown) {
  const checkedAt = new Date().toISOString();
  const normalizedGuildId = typeof guildId === "string" && guildId.trim() ? guildId.trim() : null;
  if (!normalizedGuildId) {
    return {
      guildId: null,
      botConnected: false,
      channelsAvailable: false,
      postableChannelCount: 0,
      errorCode: "missing_guild_id",
      errorMessage: "No Discord server is selected. Please choose a server first.",
      checkedAt,
    };
  }
  if (isMockAuth(env.MOCK_AUTH)) {
    return {
      guildId: normalizedGuildId,
      botConnected: true,
      channelsAvailable: true,
      postableChannelCount: 2,
      errorCode: null,
      errorMessage: null,
      checkedAt,
    };
  }
  try {
    const channels = await fetchDiscordPostingChannels(env, normalizedGuildId);
    return {
      guildId: normalizedGuildId,
      botConnected: true,
      channelsAvailable: channels.length > 0,
      postableChannelCount: channels.filter((channel) => channel.can_post).length,
      errorCode: null,
      errorMessage: null,
      checkedAt,
    };
  } catch (error) {
    const classified = classifyDiscordSetupError(error);
    return {
      guildId: normalizedGuildId,
      botConnected: false,
      channelsAvailable: false,
      postableChannelCount: 0,
      errorCode: classified.code,
      errorMessage: classified.message,
      checkedAt,
    };
  }
}

function classifyDiscordSetupError(error: unknown) {
  if (error instanceof DiscordChannelFetchError) {
    if (error.code === "missing_bot_token") {
      return {
        code: "missing_bot_token",
        message: "DISCORD_BOT_TOKEN is missing from Cloudflare Pages production. Add or rotate it, redeploy Pages, then click Verify Bot Connection. If the bot is already installed, DZN cannot verify or control it until the token is configured.",
      };
    }
    if (error.code === "bot_not_in_guild") {
      return {
        code: "bot_not_in_guild",
        message: "DZN Bot is not installed in the selected Discord server yet.",
      };
    }
    if (error.code === "discord_api_403") {
      return {
        code: "discord_api_403",
        message: "Discord returned 403 while DZN checked bot access. Reconnect the bot or check server permissions.",
      };
    }
    return { code: error.code, message: error.message };
  }
  return {
    code: "discord_api_error",
    message: error instanceof Error ? error.message : "Discord bot verification failed. Try again shortly.",
  };
}

function classifyNitradoTokenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/TOKEN_ENCRYPTION_KEY is not configured/i.test(message)) {
    return {
      code: "missing_token_encryption_key",
      message: "Token encryption key is missing in production. Add TOKEN_ENCRYPTION_KEY in Cloudflare Pages and redeploy.",
    };
  }
  if (/decrypt|operation|authentication|tag|cipher|iv|key/i.test(message)) {
    return {
      code: "token_decrypt_failed",
      message: "Your saved Nitrado token cannot be decrypted. Re-save your Nitrado long-life token.",
    };
  }
  return {
    code: "nitrado_token_unavailable",
    message: "DZN could not read the saved Nitrado token. Re-save your Nitrado long-life token and try again.",
  };
}
