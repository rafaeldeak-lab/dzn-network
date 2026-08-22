import { getCurrentLinkedServer, getLinkedServerForUserById, getSessionUser, requireDb, saveServerAdmPath } from "../../_lib/db";
import { DiscordChannelFetchError, fetchDiscordPostingChannels } from "../../_lib/discord-posting";
import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { detectNitradoAdmLogs, getAdmLogStoragePath, mockAdmLogDetection, testExactNitradoAdmPath } from "../../_lib/nitrado";
import { getNitradoTokenForLinkedServer } from "../../_lib/onboarding";
import { planAdmBackfillJobsForServer } from "../../_lib/adm-sync";
import { refreshNitradoServerMetadata } from "../../_lib/server-metadata";
import type { Env, PagesFunction } from "../../_lib/types";

type OnboardingTestBody = {
  linkedServerId?: unknown;
};

export const ONBOARDING_VERIFICATION_STAGES = [
  "request_parse",
  "linked_server_lookup",
  "credential_resolution",
  "metadata_refresh",
  "adm_discovery",
  "adm_path_persist",
  "adm_backfill_plan",
  "discord_verification",
  "checks_read",
  "checks_write",
  "response_build",
] as const;

type OnboardingVerificationStage = typeof ONBOARDING_VERIFICATION_STAGES[number];

const BILLING_PHASE_1_PREVIEW_HOST = "dzn-network-owner-console-preview-billing-phase-1.pages.dev";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });
  if (!user) return json({ error: "Authenticated user is required" }, { status: 401 });

  let stage: OnboardingVerificationStage = "request_parse";
  try {
    const parsedBody = await readBoundedJson<OnboardingTestBody>(request, 1024);
    if (!parsedBody.ok) {
      return json({ error: parsedBody.message, error_code: parsedBody.error.toLowerCase() }, { status: parsedBody.status });
    }
    const requestedLinkedServerId = sanitizeRequestedLinkedServerId(parsedBody.value);
    stage = "linked_server_lookup";
    const linkedServer = requestedLinkedServerId.supplied
      ? await getLinkedServerForUserById(env, user.id, requestedLinkedServerId.value ?? "", { includePrivateAdmPath: true })
      : await getCurrentLinkedServer(env, user.id, { includePrivateAdmPath: true });
    if (requestedLinkedServerId.supplied && (!requestedLinkedServerId.value || !linkedServer)) {
      return json({ error: "Linked server not found", error_code: "linked_server_not_found" }, { status: 404 });
    }
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
    stage = "credential_resolution";
    if (!isMockNitrado(env.MOCK_NITRADO)) {
      try {
        const exactToken = await getNitradoTokenForLinkedServer(env, user.id, linkedServer.id);
        if (!exactToken) {
          tokenValid = false;
          tokenErrorCode = "missing_nitrado_token";
          tokenErrorMessage = "No saved Nitrado token was found. Paste your Nitrado long-life token and validate this service again.";
        } else {
          nitradoToken = exactToken;
        }
      } catch (error) {
        tokenValid = false;
        const classified = classifyNitradoTokenError(error);
        tokenErrorCode = classified.code;
        tokenErrorMessage = classified.message;
      }
    }

    stage = "metadata_refresh";
    const metadataResult = tokenValid
      ? await refreshNitradoServerMetadata(env, {
          linkedServerId: linkedServer.id,
          userId: user.id,
          force: true,
          softFail: true,
          skipPublicCacheSideEffects: true,
        }).catch(() => null)
      : null;
    const savedAdmPath = typeof linkedServer.adm_path === "string" ? linkedServer.adm_path : "";
    stage = "adm_discovery";
    const admLog = !tokenValid
      ? null
      : isMockNitrado(env.MOCK_NITRADO)
        ? mockAdmLogDetection()
        : savedAdmPath
          ? await testExactNitradoAdmPath(nitradoToken, linkedServer.nitrado_service_id, savedAdmPath)
          : await detectNitradoAdmLogs(nitradoToken, linkedServer.nitrado_service_id);

    const admStoragePath = admLog ? getAdmLogStoragePath(admLog) : null;
    stage = "adm_path_persist";
    if (admLog?.admFileExists && admStoragePath) {
      await saveServerAdmPath(env, linkedServer.id, admStoragePath.replace(/^\/+/, ""));
    }
    let admBackfill = null;
    stage = "adm_backfill_plan";
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
    stage = "discord_verification";
    const discordCheck = await verifyDiscordBotForSetup(env, linkedServer.guild_id);

    const checks = {
      token_valid: tokenValid ? 1 : 0,
      service_access: tokenValid ? 1 : 0,
      adm_logs_found: admLog?.found ? 1 : 0,
      dayz_service_detected: tokenValid ? 1 : 0,
    };

    const db = requireDb(env);
    stage = "checks_read";
    const existing = await db
      .prepare("SELECT id FROM onboarding_checks WHERE linked_server_id = ? LIMIT 1")
      .bind(linkedServer.id)
      .first<{ id: string }>();

    stage = "checks_write";
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

    stage = "response_build";
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
  } catch (error) {
    if (shouldExposeBillingPreviewDiagnostics(env, request)) {
      console.log({
        event: "billing_preview_onboarding_verification_failed",
        stage,
      });
      return json(
        {
          error: "Setup verification failed",
          error_code: "onboarding_verification_failed",
          failure_stage: stage,
        },
        { status: 500 },
      );
    }
    throw error;
  }
};

function shouldExposeBillingPreviewDiagnostics(env: Env, request: Request) {
  const envRecord = env as unknown as Record<string, string | undefined>;
  if (envRecord.DZN_BILLING_PREVIEW_DIAGNOSTICS !== "true") return false;
  if (!isMockAuth(env.MOCK_AUTH) || !isMockNitrado(env.MOCK_NITRADO)) return false;
  if (env.DZN_DISCORD_NOTIFICATIONS_ENABLED === "true") return false;
  if (env.DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED === "true") return false;
  let hostname = "";
  try {
    hostname = new URL(request.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hostname === BILLING_PHASE_1_PREVIEW_HOST || hostname.endsWith(`.${BILLING_PHASE_1_PREVIEW_HOST}`);
}

function sanitizeRequestedLinkedServerId(body: OnboardingTestBody) {
  if (!Object.prototype.hasOwnProperty.call(body, "linkedServerId")) {
    return { supplied: false as const, value: null };
  }
  const id = typeof body.linkedServerId === "string" ? body.linkedServerId.trim() : "";
  return {
    supplied: true as const,
    value: id && id.length <= 120 ? id : null,
  };
}

export function summarizeAdmBackfillForSetup(result: Awaited<ReturnType<typeof planAdmBackfillJobsForServer>>) {
  const createdJobs = result.created_jobs ?? [];
  const completedJob = createdJobs.find(isCompletedAdmBackfillJobForSetup);
  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    files_found: result.files_found,
    newest_available_adm_file: result.newest_available_adm_file ?? null,
    newest_readable_adm_file: result.newest_readable_adm_file ?? null,
    latest_processed_adm_file: completedJob?.filename ?? result.completed_files[0] ?? null,
    queued_files: result.queued_files,
    created_jobs: createdJobs.map(summarizeAdmBackfillJobForSetup),
    active_job: result.active_job ? summarizeAdmBackfillJobForSetup(result.active_job) : null,
  };
}

function summarizeAdmBackfillJobForSetup(job: Awaited<ReturnType<typeof planAdmBackfillJobsForServer>>["created_jobs"][number]) {
  return {
    id: job.job_id,
    adm_file: job.filename,
    status: job.status,
    line_start: null,
    line_end: null,
    total_lines: job.total_lines,
    current_line: job.current_line,
    chunk_size: job.chunk_size,
    total_chunks: job.total_chunks,
    chunks_processed: job.chunks_processed,
    display_current_chunk: job.display_current_chunk,
    progress: job.progress,
  };
}

function isCompletedAdmBackfillJobForSetup(job: Awaited<ReturnType<typeof planAdmBackfillJobsForServer>>["created_jobs"][number]) {
  if (job.status === "completed" || job.status === "completed_with_warnings") return true;
  const fileResultStatus = job.file_result?.status;
  return Boolean(job.file_result?.ok && (
    fileResultStatus === "imported"
    || fileResultStatus === "completed_with_warnings"
    || fileResultStatus === "completed_duplicate_only"
    || fileResultStatus === "duplicate_only"
  ));
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
