import { getSessionUser, requireDb } from "./db";
import { isPlatformOwnerDiscordId } from "./platform-owner";
import type { Env, SessionUser } from "./types";

type DeliveryOperation = "invite" | "role_grant" | "role_revoke";
type StoredOperation = DeliveryOperation | "diagnostic";
type DeliveryStatus = "started" | "succeeded" | "not_joined" | "retryable_failure" | "failed" | "not_configured";
type DiscordFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type DeliveryConfiguration = {
  botToken: string;
  guildId: string;
  inviteChannelId: string;
  verifiedOwnerRoleId: string;
};

type AccessRequestRow = {
  id: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  requester_user_id: string | null;
  requester_discord_id: string | null;
};

type DiscordRole = {
  id?: string | number;
  position?: number | string;
  permissions?: string | number;
  managed?: boolean;
};

type DiscordPermissionOverwrite = {
  id?: string | number;
  type?: string | number;
  allow?: string | number;
  deny?: string | number;
};

type DiscordChannel = {
  id?: string | number;
  guild_id?: string | number;
  type?: number;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

export type OwnerDiscordDeliveryAttempt = {
  id: string;
  requestId: string;
  operation: StoredOperation;
  status: DeliveryStatus;
  attemptNumber: number;
  createdAt: string;
  completedAt: string | null;
  message: string;
};

type DeliveryDiagnostic = {
  ok: boolean;
  status: "disabled" | "not_configured" | "ready" | "not_connected" | "permission_missing" | "role_hierarchy" | "discord_error";
  message: string;
  checkedAt: string;
  checks: {
    botTokenConfigured: boolean;
    botIdentity: boolean;
    botGuildMembership: boolean;
    inviteChannel: boolean;
    canViewInviteChannel: boolean;
    canCreateInvite: boolean;
    canManageRoles: boolean;
    targetRole: boolean;
    targetRoleBelowBot: boolean;
    botHasAdministrator: boolean;
  };
};

export type OwnerDiscordDeliveryResult =
  | { ok: true; status: 200; message: string; inviteUrl?: string; inviteExpiresAt?: string; attempt: OwnerDiscordDeliveryAttempt }
  | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 429 | 503; message: string; attempt?: OwnerDiscordDeliveryAttempt };

const DISCORD_API_ROOT = "https://discord.com/api/v10";
const INVITE_MAX_AGE_SECONDS = 15 * 60;
const INVITE_RATE_WINDOW_MS = 15 * 60 * 1000;
const INVITE_RATE_LIMIT = 3;
const DISCORD_PERMISSION_ONE = BigInt(1);
const DISCORD_CREATE_INSTANT_INVITE = DISCORD_PERMISSION_ONE << BigInt(0);
const DISCORD_ADMINISTRATOR = DISCORD_PERMISSION_ONE << BigInt(3);
const DISCORD_VIEW_CHANNEL = DISCORD_PERMISSION_ONE << BigInt(10);
const DISCORD_MANAGE_ROLES = DISCORD_PERMISSION_ONE << BigInt(28);

export function isOwnerDiscordDeliveryEnabled(env: Env) {
  return truthy(env.DZN_OWNER_DISCORD_ACCESS_ENABLED) && truthy(env.DZN_OWNER_DISCORD_DELIVERY_ENABLED) && Boolean(readDeliveryConfiguration(env));
}

export function ownerDiscordDeliveryMessage(env: Env) {
  if (!truthy(env.DZN_OWNER_DISCORD_ACCESS_ENABLED)) {
    return "Owner-access review is not enabled on this environment.";
  }
  if (!truthy(env.DZN_OWNER_DISCORD_DELIVERY_ENABLED)) {
    return "Approval is recorded here. Private Discord delivery remains off until central-server diagnostics pass.";
  }
  if (!readDeliveryConfiguration(env)) {
    return "Private Discord delivery is enabled but its central-server configuration is incomplete.";
  }
  return "Approved owners can request a one-use private invite, then finish access after joining DZN Discord.";
}

export async function getOwnerDiscordDeliverySummaries(env: Env, requestIds: string[]) {
  const ids = [...new Set(requestIds.filter((value) => identifier(value, 100)))];
  const empty = new Map<string, OwnerDiscordDeliveryAttempt>();
  if (ids.length === 0 || !(await hasDeliverySchema(env))) return empty;

  const placeholders = ids.map(() => "?").join(", ");
  const rows = await requireDb(env)
    .prepare(`SELECT id, request_id, operation, status, attempt_number, error_code, error_message, created_at, completed_at
                FROM dzn_owner_discord_access_delivery_attempts
               WHERE request_id IN (${placeholders})
               ORDER BY request_id ASC, created_at DESC, id DESC`)
    .bind(...ids)
    .all<Record<string, unknown>>();
  const summaries = new Map<string, OwnerDiscordDeliveryAttempt>();
  for (const row of rows.results ?? []) {
    const requestId = identifier(row.request_id, 100);
    if (!requestId || summaries.has(requestId)) continue;
    const attempt = safeAttempt(row);
    if (attempt) summaries.set(requestId, attempt);
  }
  return summaries;
}

export async function getOwnerDiscordDeliveryDiagnostic(env: Env, fetcher: DiscordFetch = fetch): Promise<DeliveryDiagnostic> {
  const checkedAt = new Date().toISOString();
  if (!truthy(env.DZN_OWNER_DISCORD_ACCESS_ENABLED) || !truthy(env.DZN_OWNER_DISCORD_DELIVERY_ENABLED)) {
    return diagnostic("disabled", "Private Discord delivery is disabled.", checkedAt, false);
  }
  const configuration = readDeliveryConfiguration(env);
  if (!configuration) {
    return diagnostic("not_configured", "Private Discord delivery needs the central guild, invite channel, Verified Server Owner role, and bot token configured privately.", checkedAt, false, {
      botTokenConfigured: Boolean(normalizeBotToken(env.DISCORD_BOT_TOKEN)),
    });
  }
  const preflight = await checkDiscordDeliveryConfiguration(configuration, fetcher);
  return {
    ok: preflight.ok,
    status: preflight.status,
    message: preflight.message,
    checkedAt,
    checks: preflight.checks,
  };
}

export async function issueOwnerDiscordAccessInvite(env: Env, request: Request, rawInput: unknown, fetcher: DiscordFetch = fetch): Promise<OwnerDiscordDeliveryResult> {
  const user = await getSessionUser(env, request);
  if (!user) return problem(401, "Log in with the Discord account that owns the approved DZN server.");
  const requestId = extractRequestId(rawInput);
  if (!requestId) return problem(400, "Choose the approved owner-access request first.");
  if (!(await hasDeliverySchema(env))) return problem(503, "Private Discord delivery is not available on this environment yet.");

  const access = await readApplicantAccessRequest(env, requestId, user);
  if (!access) return problem(404, "That owner-access request is not available to this Discord account.");
  if (access.status !== "approved") return problem(409, "Only an approved owner-access request can receive a private Discord invite.");
  if (access.requester_discord_id !== user.discord_id) return problem(403, "Use the same Discord account that made this owner-access request.");
  const configuration = readDeliveryConfiguration(env);
  if (!configuration) return problem(503, "Private Discord delivery is not configured yet.");
  const attempt = await startInviteAttempt(env, access, configuration, user);
  if (!attempt) return problem(429, "Too many private invites were requested recently. Wait before requesting another one.");
  try {
    const preflight = await checkDiscordDeliveryConfiguration(configuration, fetcher);
    if (!preflight.ok) return finishProblem(env, attempt, preflightToDeliveryStatus(preflight.status), preflight.message, preflight.httpStatus ?? null, preflight.status);
    const response = await discordRequest(fetcher, configuration, `/channels/${encodeURIComponent(configuration.inviteChannelId)}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ max_age: INVITE_MAX_AGE_SECONDS, max_uses: 1, temporary: false, unique: true }),
    });
    const invitePayload = recordValue(response.payload);
    const code = typeof invitePayload?.code === "string" && /^[A-Za-z0-9_-]{4,128}$/.test(invitePayload.code) ? invitePayload.code : null;
    if (!response.response.ok || !code) {
      return finishProblem(env, attempt, deliveryStatusForHttp(response.response.status), "DZN could not issue a private Discord invite. Retry after the delivery check is fixed.", response.response.status, errorCodeForHttp(response.response.status));
    }
    const completed = await finishAttempt(env, attempt, "succeeded", null, null, response.response.status);
    return {
      ok: true,
      status: 200,
      message: "Your one-use DZN Discord invite is ready. Join DZN Discord, then return here to finish owner-role access.",
      inviteUrl: `https://discord.gg/${code}`,
      inviteExpiresAt: new Date(Date.now() + INVITE_MAX_AGE_SECONDS * 1000).toISOString(),
      attempt: completed,
    };
  } catch (error) {
    return finishProblem(env, attempt, "retryable_failure", "DZN could not reach Discord to issue the private invite. You can retry this step.", null, classifyThrownDiscordError(error));
  }
}

export async function claimOwnerDiscordAccessRole(env: Env, request: Request, rawInput: unknown, fetcher: DiscordFetch = fetch): Promise<OwnerDiscordDeliveryResult> {
  const user = await getSessionUser(env, request);
  if (!user) return problem(401, "Log in with the Discord account that owns the approved DZN server.");
  const requestId = extractRequestId(rawInput);
  if (!requestId) return problem(400, "Choose the approved owner-access request first.");
  if (!(await hasDeliverySchema(env))) return problem(503, "Private Discord delivery is not available on this environment yet.");

  const access = await readApplicantAccessRequest(env, requestId, user);
  if (!access) return problem(404, "That owner-access request is not available to this Discord account.");
  if (access.status !== "approved") return problem(409, "Only an approved owner-access request can receive the Discord owner role.");
  if (access.requester_discord_id !== user.discord_id) return problem(403, "Use the same Discord account that made this owner-access request.");

  const configuration = readDeliveryConfiguration(env);
  if (!configuration) return problem(503, "Private Discord delivery is not configured yet.");
  const attempt = await startAttempt(env, access, "role_grant", configuration, user);
  try {
    const preflight = await checkDiscordDeliveryConfiguration(configuration, fetcher);
    if (!preflight.ok) return finishProblem(env, attempt, preflightToDeliveryStatus(preflight.status), preflight.message, preflight.httpStatus ?? null, preflight.status);
    const membership = await discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/members/${encodeURIComponent(user.discord_id)}`);
    if (membership.response.status === 404) {
      return finishProblem(env, attempt, "not_joined", "Join DZN Discord with the private invite first, then return here to finish owner access.", 404, "member_not_joined");
    }
    if (!membership.response.ok) {
      return finishProblem(env, attempt, deliveryStatusForHttp(membership.response.status), "DZN could not verify your DZN Discord membership. You can retry this step.", membership.response.status, errorCodeForHttp(membership.response.status));
    }
    const membershipPayload = recordValue(membership.payload);
    const roleIds = new Set<string>(Array.isArray(membershipPayload?.roles) ? membershipPayload.roles.map((value) => String(value)) : []);
    if (!roleIds.has(configuration.verifiedOwnerRoleId)) {
      const assigned = await discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/members/${encodeURIComponent(user.discord_id)}/roles/${encodeURIComponent(configuration.verifiedOwnerRoleId)}`, { method: "PUT" });
      if (!assigned.response.ok) {
        return finishProblem(env, attempt, deliveryStatusForHttp(assigned.response.status), "DZN could not assign the Verified Server Owner role. You can retry this step.", assigned.response.status, errorCodeForHttp(assigned.response.status));
      }
    }
    const completed = await finishAttempt(env, attempt, "succeeded", null, null, 204);
    return { ok: true, status: 200, message: "Verified Server Owner access is active in DZN Discord.", attempt: completed };
  } catch (error) {
    return finishProblem(env, attempt, "retryable_failure", "DZN could not reach Discord while finishing owner access. You can retry this step.", null, classifyThrownDiscordError(error));
  }
}

export async function revokeOwnerDiscordAccessRole(env: Env, actor: SessionUser, rawInput: unknown, fetcher: DiscordFetch = fetch): Promise<OwnerDiscordDeliveryResult> {
  if (!isPlatformOwnerDiscordId(env, actor.discord_id)) return problem(403, "Platform-owner access is required to remove a Discord owner role.");
  const requestId = extractRequestId(rawInput);
  if (!requestId) return problem(400, "Choose the revoked owner-access request first.");
  if (!(await hasDeliverySchema(env))) return problem(503, "Private Discord delivery is not available on this environment yet.");
  const access = await requireDb(env).prepare(`SELECT id, status, requester_user_id, requester_discord_id
    FROM dzn_owner_discord_access_requests WHERE id = ? LIMIT 1`).bind(requestId).first<AccessRequestRow>();
  if (!access) return problem(404, "That owner-access request was not found.");
  if (access.status !== "revoked") return problem(409, "Record the revocation in the owner-access queue before removing the Discord role.");
  const discordId = discordIdValue(access.requester_discord_id);
  if (!discordId) return problem(409, "This historical request no longer has a Discord identity to revoke.");

  const configuration = readDeliveryConfiguration(env);
  if (!configuration) return problem(503, "Private Discord delivery is not configured yet.");
  const attempt = await startAttempt(env, access, "role_revoke", configuration, actor);
  try {
    const preflight = await checkDiscordDeliveryConfiguration(configuration, fetcher);
    if (!preflight.ok) return finishProblem(env, attempt, preflightToDeliveryStatus(preflight.status), preflight.message, preflight.httpStatus ?? null, preflight.status);
    const membership = await discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/members/${encodeURIComponent(discordId)}`);
    if (membership.response.status === 404) {
      const completed = await finishAttempt(env, attempt, "succeeded", "member_not_joined", "No DZN Discord membership remained to change.", 404);
      return { ok: true, status: 200, message: "No DZN Discord membership remained to change.", attempt: completed };
    }
    if (!membership.response.ok) {
      return finishProblem(env, attempt, deliveryStatusForHttp(membership.response.status), "DZN could not verify the member before revoking the owner role. You can retry this step.", membership.response.status, errorCodeForHttp(membership.response.status));
    }
    const membershipPayload = recordValue(membership.payload);
    const roleIds = new Set<string>(Array.isArray(membershipPayload?.roles) ? membershipPayload.roles.map((value) => String(value)) : []);
    if (roleIds.has(configuration.verifiedOwnerRoleId)) {
      const removed = await discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/members/${encodeURIComponent(discordId)}/roles/${encodeURIComponent(configuration.verifiedOwnerRoleId)}`, { method: "DELETE" });
      if (!removed.response.ok) {
        return finishProblem(env, attempt, deliveryStatusForHttp(removed.response.status), "DZN could not remove the Verified Server Owner role. You can retry this step.", removed.response.status, errorCodeForHttp(removed.response.status));
      }
    }
    const completed = await finishAttempt(env, attempt, "succeeded", null, null, 204);
    return { ok: true, status: 200, message: "Verified Server Owner access was removed. The Discord membership itself was left unchanged.", attempt: completed };
  } catch (error) {
    return finishProblem(env, attempt, "retryable_failure", "DZN could not reach Discord while revoking the owner role. You can retry this step.", null, classifyThrownDiscordError(error));
  }
}

async function readApplicantAccessRequest(env: Env, requestId: string, user: SessionUser) {
  return requireDb(env).prepare(`SELECT id, status, requester_user_id, requester_discord_id
    FROM dzn_owner_discord_access_requests
    WHERE id = ? AND requester_user_id = ? LIMIT 1`).bind(requestId, user.id).first<AccessRequestRow>();
}

async function startAttempt(env: Env, access: AccessRequestRow, operation: DeliveryOperation, configuration: DeliveryConfiguration, actor: SessionUser) {
  const db = requireDb(env);
  const previous = await db.prepare(`SELECT COALESCE(MAX(attempt_number), 0) AS attempt_number
    FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = ? AND operation = ?`).bind(access.id, operation).first<{ attempt_number: number | string }>();
  const attemptNumber = Number(previous?.attempt_number ?? 0) + 1;
  const createdAt = new Date().toISOString();
  const attempt = {
    id: crypto.randomUUID(),
    requestId: access.id,
    requesterUserId: access.requester_user_id,
    requesterDiscordId: access.requester_discord_id,
    actorUserId: actor.id,
    actorDiscordId: actor.discord_id,
    operation,
    status: "started" as const,
    attemptNumber,
    nonce: crypto.randomUUID(),
    guildId: configuration.guildId,
    inviteChannelId: configuration.inviteChannelId,
    roleId: configuration.verifiedOwnerRoleId,
    createdAt,
  };
  await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
    id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce,
    guild_id, invite_channel_id, role_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'started', ?, ?, ?, ?, ?, ?)`)
    .bind(attempt.id, attempt.requestId, attempt.requesterUserId, attempt.requesterDiscordId, attempt.actorUserId, attempt.actorDiscordId, attempt.operation, attempt.attemptNumber, attempt.nonce, attempt.guildId, attempt.inviteChannelId, attempt.roleId, attempt.createdAt)
    .run();
  return attempt;
}

async function startInviteAttempt(env: Env, access: AccessRequestRow, configuration: DeliveryConfiguration, actor: SessionUser) {
  const db = requireDb(env);
  const attempt = {
    id: crypto.randomUUID(),
    requestId: access.id,
    requesterUserId: access.requester_user_id,
    requesterDiscordId: access.requester_discord_id,
    actorUserId: actor.id,
    actorDiscordId: actor.discord_id,
    operation: "invite" as const,
    status: "started" as const,
    nonce: crypto.randomUUID(),
    guildId: configuration.guildId,
    inviteChannelId: configuration.inviteChannelId,
    roleId: configuration.verifiedOwnerRoleId,
    createdAt: new Date().toISOString(),
    windowStart: new Date(Date.now() - INVITE_RATE_WINDOW_MS).toISOString(),
  };
  // Reserve the rate-window slot atomically so concurrent browser clicks cannot exceed the invite quota.
  const result = await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
    id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce,
    guild_id, invite_channel_id, role_id, created_at
  )
  SELECT ?, ?, ?, ?, ?, ?, 'invite', 'started',
    COALESCE((SELECT MAX(attempt_number) FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = ? AND operation = 'invite'), 0) + 1,
    ?, ?, ?, ?, ?
  WHERE (SELECT COUNT(*) FROM dzn_owner_discord_access_delivery_attempts
         WHERE request_id = ? AND operation = 'invite'
           AND datetime(created_at) >= datetime(?)) < ?`)
    .bind(
      attempt.id,
      attempt.requestId,
      attempt.requesterUserId,
      attempt.requesterDiscordId,
      attempt.actorUserId,
      attempt.actorDiscordId,
      attempt.requestId,
      attempt.nonce,
      attempt.guildId,
      attempt.inviteChannelId,
      attempt.roleId,
      attempt.createdAt,
      attempt.requestId,
      attempt.windowStart,
      INVITE_RATE_LIMIT,
    )
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) return null;
  const previous = await db.prepare(`SELECT attempt_number FROM dzn_owner_discord_access_delivery_attempts WHERE id = ? LIMIT 1`)
    .bind(attempt.id)
    .first<{ attempt_number: number | string }>();
  return { ...attempt, attemptNumber: Number(previous?.attempt_number ?? 1) };
}

async function finishAttempt(env: Env, attempt: Awaited<ReturnType<typeof startAttempt>>, status: DeliveryStatus, errorCode: string | null, errorMessage: string | null, httpStatus: number | null) {
  const completedAt = new Date().toISOString();
  await requireDb(env).prepare(`UPDATE dzn_owner_discord_access_delivery_attempts
    SET status = ?, discord_http_status = ?, error_code = ?, error_message = ?, completed_at = ?
    WHERE id = ? AND status = 'started'`).bind(status, httpStatus, cleanCode(errorCode), safeMessage(errorMessage), completedAt, attempt.id).run();
  return {
    id: attempt.id,
    requestId: attempt.requestId,
    operation: attempt.operation,
    status,
    attemptNumber: attempt.attemptNumber,
    createdAt: attempt.createdAt,
    completedAt,
    message: deliveryMessage(attempt.operation, status, errorMessage),
  } satisfies OwnerDiscordDeliveryAttempt;
}

async function finishProblem(env: Env, attempt: Awaited<ReturnType<typeof startAttempt>>, status: DeliveryStatus, message: string, httpStatus: number | null, errorCode: string): Promise<OwnerDiscordDeliveryResult> {
  const completed = await finishAttempt(env, attempt, status, errorCode, message, httpStatus);
  return { ok: false, status: status === "not_joined" ? 409 : status === "retryable_failure" ? 503 : 409, message, attempt: completed };
}

function readDeliveryConfiguration(env: Env): DeliveryConfiguration | null {
  if (!truthy(env.DZN_OWNER_DISCORD_ACCESS_ENABLED) || !truthy(env.DZN_OWNER_DISCORD_DELIVERY_ENABLED)) return null;
  const botToken = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  const guildId = discordIdValue(env.DZN_OWNER_DISCORD_GUILD_ID);
  const inviteChannelId = discordIdValue(env.DZN_OWNER_DISCORD_INVITE_CHANNEL_ID);
  const verifiedOwnerRoleId = discordIdValue(env.DZN_OWNER_DISCORD_VERIFIED_OWNER_ROLE_ID);
  return botToken && guildId && inviteChannelId && verifiedOwnerRoleId ? { botToken, guildId, inviteChannelId, verifiedOwnerRoleId } : null;
}

async function checkDiscordDeliveryConfiguration(configuration: DeliveryConfiguration, fetcher: DiscordFetch) {
  const failedChecks = (status: DeliveryDiagnostic["status"], message: string, httpStatus: number | null = null) => ({
    ok: false as const,
    status,
    message,
    httpStatus,
    checks: diagnosticChecks(),
  });
  try {
    const identity = await discordRequest(fetcher, configuration, "/users/@me");
    const identityPayload = recordValue(identity.payload);
    const botId = discordIdValue(identityPayload?.id);
    if (!identity.response.ok || !botId) return failedChecks(identity.response.status === 401 ? "not_connected" : "discord_error", "DZN could not authenticate the configured Discord bot.", identity.response.status);

    const [membership, rolesResponse, channelResponse] = await Promise.all([
      discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/members/${encodeURIComponent(botId)}`),
      discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/roles`),
      discordRequest(fetcher, configuration, `/channels/${encodeURIComponent(configuration.inviteChannelId)}`),
    ]);
    if (!membership.response.ok) return failedChecks(membership.response.status === 404 ? "not_connected" : "discord_error", "DZN Bot is not available in the configured DZN Discord server.", membership.response.status);
    if (!rolesResponse.response.ok || !Array.isArray(rolesResponse.payload)) return failedChecks("discord_error", "DZN could not read the central Discord role configuration.", rolesResponse.response.status);
    if (!channelResponse.response.ok) return failedChecks(channelResponse.response.status === 403 ? "permission_missing" : "discord_error", "DZN could not read the private invite channel.", channelResponse.response.status);

    const roles = rolesResponse.payload as DiscordRole[];
    const channel = channelResponse.payload as DiscordChannel;
    if (String(channel.guild_id ?? "") !== configuration.guildId || ![0, 5].includes(Number(channel.type))) {
      return failedChecks("not_configured", "The configured private invite channel does not belong to the central DZN Discord server.");
    }
    const targetRole = roles.find((role) => String(role.id ?? "") === configuration.verifiedOwnerRoleId);
    const membershipPayload = recordValue(membership.payload);
    const botRoleIds = new Set<string>(Array.isArray(membershipPayload?.roles) ? membershipPayload.roles.map((value) => String(value)) : []);
    const roleById = new Map(roles.map((role) => [String(role.id ?? ""), role]));
    const botHighestPosition = Math.max(0, ...[...botRoleIds].map((roleId) => Number(roleById.get(roleId)?.position ?? 0)));
    const targetRolePosition = Number(targetRole?.position ?? -1);
    const basePermissions = getBotGuildPermissions(roles, botRoleIds, configuration.guildId);
    const channelPermissions = evaluateChannelPermissions(basePermissions, channel, configuration.guildId, botRoleIds, botId);
    const hasAdministrator = hasPermission(basePermissions, DISCORD_ADMINISTRATOR);
    const canManageRoles = hasAdministrator || hasPermission(basePermissions, DISCORD_MANAGE_ROLES);
    const canViewInviteChannel = hasAdministrator || hasPermission(channelPermissions, DISCORD_VIEW_CHANNEL);
    const canCreateInvite = hasAdministrator || hasPermission(channelPermissions, DISCORD_CREATE_INSTANT_INVITE);
    const checks = {
      botTokenConfigured: true,
      botIdentity: true,
      botGuildMembership: true,
      inviteChannel: true,
      canViewInviteChannel,
      canCreateInvite,
      canManageRoles,
      targetRole: Boolean(targetRole),
      targetRoleBelowBot: Boolean(targetRole && targetRolePosition < botHighestPosition),
      botHasAdministrator: hasAdministrator,
    };
    if (!targetRole) return { ok: false as const, status: "not_configured" as const, message: "The configured Verified Server Owner role was not found in the central DZN Discord server.", httpStatus: null, checks };
    if (String(targetRole.id ?? "") === configuration.guildId || targetRole.managed === true) return { ok: false as const, status: "not_configured" as const, message: "The configured Verified Server Owner role must be a normal, assignable role in the central DZN Discord server.", httpStatus: null, checks };
    if (!checks.targetRoleBelowBot) return { ok: false as const, status: "role_hierarchy" as const, message: "DZN Bot must remain above the Verified Server Owner role before owner delivery can run.", httpStatus: null, checks };
    if (!canManageRoles || !canViewInviteChannel || !canCreateInvite) return { ok: false as const, status: "permission_missing" as const, message: "DZN Bot needs View Channel and Create Invite on the private invite channel, plus Manage Roles for the Verified Server Owner role.", httpStatus: null, checks };
    return { ok: true as const, status: "ready" as const, message: "DZN owner Discord delivery is ready for controlled requests.", httpStatus: null, checks };
  } catch (error) {
    return failedChecks("discord_error", "DZN could not reach Discord for the central-server diagnostic.", null);
  }
}

async function discordRequest(fetcher: DiscordFetch, configuration: DeliveryConfiguration, path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bot ${configuration.botToken}`);
    const response = await fetcher(`${DISCORD_API_ROOT}${path}`, { ...init, headers, signal: controller.signal });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | Array<unknown> | null;
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function getBotGuildPermissions(roles: DiscordRole[], botRoleIds: Set<string>, guildId: string) {
  return roles.reduce((permissions, role) => {
    const roleId = String(role.id ?? "");
    return roleId === guildId || botRoleIds.has(roleId) ? permissions | parseBits(role.permissions) : permissions;
  }, BigInt(0));
}

function evaluateChannelPermissions(base: bigint, channel: DiscordChannel, guildId: string, botRoleIds: Set<string>, botId: string) {
  if (hasPermission(base, DISCORD_ADMINISTRATOR)) return base;
  const overwrites = Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites : [];
  let value = applyOverwrite(base, overwrites.find((overwrite) => String(overwrite.type) === "0" && String(overwrite.id) === guildId));
  let roleAllow = BigInt(0);
  let roleDeny = BigInt(0);
  for (const overwrite of overwrites) {
    if (String(overwrite.type) !== "0" || !botRoleIds.has(String(overwrite.id))) continue;
    roleAllow |= parseBits(overwrite.allow);
    roleDeny |= parseBits(overwrite.deny);
  }
  value = (value & ~roleDeny) | roleAllow;
  return applyOverwrite(value, overwrites.find((overwrite) => String(overwrite.type) === "1" && String(overwrite.id) === botId));
}

function applyOverwrite(permissions: bigint, overwrite: DiscordPermissionOverwrite | undefined) {
  if (!overwrite) return permissions;
  return (permissions & ~parseBits(overwrite.deny)) | parseBits(overwrite.allow);
}

function parseBits(value: unknown) {
  if (typeof value === "bigint") return value;
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^\d+$/.test(text) ? BigInt(text) : BigInt(0);
}

function hasPermission(permissions: bigint, permission: bigint) {
  return (permissions & permission) === permission;
}

async function hasDeliverySchema(env: Env) {
  const rows = await requireDb(env).prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('dzn_owner_discord_access_requests', 'dzn_owner_discord_access_delivery_attempts')").all<{ name: string }>();
  return new Set((rows.results ?? []).map((row) => row.name)).size === 2;
}

function extractRequestId(value: unknown) {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as { requestId?: unknown; request_id?: unknown } : {};
  return identifier(body.requestId ?? body.request_id, 100);
}

function identifier(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max && /^[A-Za-z0-9_-]+$/.test(text) ? text : null;
}

function discordIdValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{12,24}$/.test(text) ? text : null;
}

function normalizeBotToken(value: unknown) {
  const token = typeof value === "string" ? value.trim() : "";
  return token.length >= 20 && !/\s/.test(token) ? token : null;
}

function truthy(value: unknown) {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function safeMessage(value: unknown) {
  const text = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, " ") : "";
  return text ? text.slice(0, 240) : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanCode(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && /^[a-z0-9_:-]{1,80}$/i.test(text) ? text : null;
}

function deliveryStatusForHttp(status: number): DeliveryStatus {
  return status === 429 || status >= 500 ? "retryable_failure" : "failed";
}

function errorCodeForHttp(status: number) {
  if (status === 401) return "discord_bot_auth";
  if (status === 403) return "discord_permission";
  if (status === 404) return "discord_resource_missing";
  if (status === 429) return "discord_rate_limited";
  return status >= 500 ? "discord_unavailable" : "discord_rejected";
}

function classifyThrownDiscordError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError" ? "discord_timeout" : "discord_network";
}

function preflightToDeliveryStatus(status: DeliveryDiagnostic["status"]): DeliveryStatus {
  return status === "disabled" || status === "not_configured" ? "not_configured" : status === "discord_error" || status === "not_connected" ? "retryable_failure" : "failed";
}

function problem(status: 400 | 401 | 403 | 404 | 409 | 429 | 503, message: string): OwnerDiscordDeliveryResult {
  return { ok: false, status, message };
}

function diagnostic(status: DeliveryDiagnostic["status"], message: string, checkedAt: string, ok: boolean, overrides: Partial<DeliveryDiagnostic["checks"]> = {}): DeliveryDiagnostic {
  return { ok, status, message, checkedAt, checks: { ...diagnosticChecks(), ...overrides } };
}

function diagnosticChecks(): DeliveryDiagnostic["checks"] {
  return { botTokenConfigured: false, botIdentity: false, botGuildMembership: false, inviteChannel: false, canViewInviteChannel: false, canCreateInvite: false, canManageRoles: false, targetRole: false, targetRoleBelowBot: false, botHasAdministrator: false };
}

function safeAttempt(row: Record<string, unknown>): OwnerDiscordDeliveryAttempt | null {
  const id = identifier(row.id, 100);
  const requestId = identifier(row.request_id, 100);
  const operation = row.operation === "invite" || row.operation === "role_grant" || row.operation === "role_revoke" || row.operation === "diagnostic" ? row.operation : null;
  const status = row.status === "started" || row.status === "succeeded" || row.status === "not_joined" || row.status === "retryable_failure" || row.status === "failed" || row.status === "not_configured" ? row.status : null;
  if (!id || !requestId || !operation || !status) return null;
  const createdAt = typeof row.created_at === "string" ? row.created_at : new Date().toISOString();
  const completedAt = typeof row.completed_at === "string" ? row.completed_at : null;
  return { id, requestId, operation, status, attemptNumber: Math.max(1, Number(row.attempt_number ?? 1)), createdAt, completedAt, message: deliveryMessage(operation, status, safeMessage(row.error_message)) };
}

function deliveryMessage(operation: StoredOperation, status: DeliveryStatus, errorMessage: string | null) {
  if (status === "succeeded" && operation === "invite") return "Private invite issued.";
  if (status === "succeeded" && operation === "role_grant") return "Verified Server Owner role granted.";
  if (status === "succeeded" && operation === "role_revoke") return "Verified Server Owner role removed.";
  if (status === "not_joined") return "Waiting for the owner to join DZN Discord.";
  if (status === "started") return "Owner Discord delivery is in progress.";
  return errorMessage ?? "Owner Discord delivery needs another attempt.";
}
