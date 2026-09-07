import { getCurrentLinkedServer, getSessionUser, saveServerAdmPath } from "../../_lib/db";
import { DiscordChannelFetchError, fetchDiscordPostingChannels } from "../../_lib/discord-posting";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { detectNitradoAdmLogs, getAdmLogStoragePath, mockAdmLogDetection, testExactNitradoAdmPath } from "../../_lib/nitrado";
import { getOnboardingServiceProof, onboardingProofStillCurrent, saveOnboardingServiceChecks } from "../../_lib/onboarding-service-proof";
import { planAdmBackfillJobsForServer, type AdmImportJobProgressResult } from "../../_lib/adm-sync";
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

  const proof = await getOnboardingServiceProof(env, user.id, linkedServer.id, linkedServer.nitrado_service_id);
  const { tokenValid, serviceAccess, dayzServiceDetected, errorCode: tokenErrorCode, errorMessage: tokenErrorMessage } = proof.checks;
  const serviceVerified = tokenValid && serviceAccess && dayzServiceDetected;
  const nitradoToken = proof.token;
  if (!await onboardingProofStillCurrent(env, proof)) {
    return json({ error: "Your server connection changed during the check. Run setup checks again." }, { status: 409 });
  }

  const metadataResult = serviceVerified
    ? await refreshNitradoServerMetadata(env, {
        linkedServerId: linkedServer.id,
        userId: user.id,
        force: true,
      }).catch(() => null)
    : null;
  const savedAdmPath = typeof linkedServer.adm_path === "string" ? linkedServer.adm_path : "";
  const admLog = !serviceVerified
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
  if (serviceVerified && (admLog?.admFileExists || admLog?.found)) {
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

  if (!await saveOnboardingServiceChecks(env, proof, Boolean(admLog?.found))) {
    return json({ error: "Your server connection changed during the check. Run setup checks again." }, { status: 409 });
  }

  return json({
    ok: true,
    checks: {
      tokenValid,
      serviceAccess,
      admLogsFound: Boolean(admLog?.found),
      dayzServiceDetected,
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
    latest_processed_adm_file: completedJob?.filename ?? null,
    queued_files: (result.created_jobs ?? []).map((job) => job.filename),
    created_jobs: (result.created_jobs ?? []).map(summarizeAdmImportJobForSetup),
    active_job: result.active_job ? summarizeAdmImportJobForSetup(result.active_job) : null,
  };
}

function summarizeAdmImportJobForSetup(job: AdmImportJobProgressResult) {
  return {
    job_id: job.job_id,
    filename: job.filename,
    status: job.status,
    current_line: job.current_line,
    total_lines: job.total_lines,
    chunks_processed: job.chunks_processed,
    total_chunks: job.total_chunks,
    progress: job.progress,
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
