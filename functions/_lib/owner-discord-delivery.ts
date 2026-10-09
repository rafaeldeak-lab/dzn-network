import { getSessionUser, requireDb } from "./db";
import { isPlatformOwnerDiscordId } from "./platform-owner";
import type { Env, SessionUser } from "./types";

type DeliveryOperation = "invite" | "role_grant" | "role_revoke";
type StoredOperation = DeliveryOperation | "diagnostic";
type DeliveryStatus = "started" | "succeeded" | "not_joined" | "retryable_failure" | "failed" | "not_configured";
type DiscordFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type RoleDeliveryConfiguration = {
  botToken: string;
  guildId: string;
  verifiedOwnerRoleId: string;
};

type DeliveryConfiguration = RoleDeliveryConfiguration & {
  inviteChannelId: string;
};

type AttemptConfiguration = RoleDeliveryConfiguration & {
  inviteChannelId?: string | null;
};

type RoleMutationOperation = "role_grant" | "role_revoke" | "revocation_decision" | "account_deletion";

type RoleMutationLease = {
  discordId: string;
  leaseId: string;
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
const ROLE_MUTATION_LEASE_MS = 60 * 1000;
const DISCORD_PERMISSION_ONE = BigInt(1);
const DISCORD_CREATE_INSTANT_INVITE = DISCORD_PERMISSION_ONE << BigInt(0);
const DISCORD_ADMINISTRATOR = DISCORD_PERMISSION_ONE << BigInt(3);
const DISCORD_VIEW_CHANNEL = DISCORD_PERMISSION_ONE << BigInt(10);
const DISCORD_MANAGE_ROLES = DISCORD_PERMISSION_ONE << BigInt(28);

export function isOwnerDiscordDeliveryEnabled(env: Env) {
  return deliveryFlagsEnabled(env) && Boolean(readInviteDeliveryConfiguration(env));
}

export function ownerDiscordDeliveryMessage(env: Env) {
  if (!truthy(env.DZN_OWNER_DISCORD_ACCESS_ENABLED)) {
    return "Owner-access review is not enabled on this environment.";
  }
  if (!truthy(env.DZN_OWNER_DISCORD_DELIVERY_ENABLED)) {
    return "Approval is recorded here. Private Discord delivery remains off until central-server diagnostics pass.";
  }
  if (!readInviteDeliveryConfiguration(env)) {
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
  if (!deliveryFlagsEnabled(env)) {
    return diagnostic("disabled", "Private Discord delivery is disabled.", checkedAt, false);
  }
  const configuration = readInviteDeliveryConfiguration(env);
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
  const configuration = readInviteDeliveryConfiguration(env);
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

  const configuration = readRoleDeliveryConfiguration(env);
  if (!configuration) return problem(503, "Private Discord delivery is not configured yet.");
  const lease = await acquireRoleMutationLease(env, {
    requestId: access.id,
    discordId: user.discord_id,
    operation: "role_grant",
    requiredStatus: "approved",
  });
  if (!lease) return problem(409, "This owner-access request is changing. Refresh the page before finishing Discord access.");
  const attempt = await startAttempt(env, access, "role_grant", configuration, user);
  try {
    const preflight = await checkDiscordRoleConfiguration(configuration, fetcher);
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
      if (!(await requestIsStillApprovedForApplicant(env, access.id, user))) {
        return finishProblem(env, attempt, "failed", "The owner-access decision changed before the Discord role could be assigned.", null, "request_changed");
      }
      const assigned = await discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/members/${encodeURIComponent(user.discord_id)}/roles/${encodeURIComponent(configuration.verifiedOwnerRoleId)}`, { method: "PUT" });
      if (!assigned.response.ok) {
        return finishProblem(env, attempt, deliveryStatusForHttp(assigned.response.status), "DZN could not assign the Verified Server Owner role. You can retry this step.", assigned.response.status, errorCodeForHttp(assigned.response.status));
      }
      if (!(await requestIsStillApprovedForApplicant(env, access.id, user))) {
        const removed = await discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/members/${encodeURIComponent(user.discord_id)}/roles/${encodeURIComponent(configuration.verifiedOwnerRoleId)}`, { method: "DELETE" });
        if (!removed.response.ok && removed.response.status !== 404) {
          return finishProblem(env, attempt, "retryable_failure", "The owner-access decision changed while Discord role delivery was completing. DZN could not confirm role removal; retry the revocation.", removed.response.status, errorCodeForHttp(removed.response.status));
        }
        return finishProblem(env, attempt, "failed", "The owner-access decision changed before role delivery completed, so the role was removed.", removed.response.status, "request_changed");
      }
    }
    const completed = await finishAttempt(env, attempt, "succeeded", null, null, 204);
    return { ok: true, status: 200, message: "Verified Server Owner access is active in DZN Discord.", attempt: completed };
  } catch (error) {
    return finishProblem(env, attempt, "retryable_failure", "DZN could not reach Discord while finishing owner access. You can retry this step.", null, classifyThrownDiscordError(error));
  } finally {
    await releaseRoleMutationLease(env, lease);
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

  const configuration = readRoleDeliveryConfiguration(env);
  if (!configuration) return problem(503, "Private Discord delivery is not configured yet.");
  const lease = await acquireRoleMutationLease(env, {
    requestId: access.id,
    discordId,
    operation: "role_revoke",
    requiredStatus: "revoked",
  });
  if (!lease) return problem(409, "An owner-role delivery is still finishing. Retry the role removal shortly.");
  const attempt = await startAttempt(env, access, "role_revoke", configuration, actor);
  try {
    const preflight = await checkDiscordRoleConfiguration(configuration, fetcher);
    if (!preflight.ok) return finishProblem(env, attempt, preflightToDeliveryStatus(preflight.status), preflight.message, preflight.httpStatus ?? null, preflight.status);
    if (await hasAnotherApprovedRequestForDiscord(env, discordId, access.id)) {
      const completed = await finishAttempt(env, attempt, "succeeded", "other_approved_request", "Another verified owner request for this Discord account remains approved, so the role stays in place.", null);
      return { ok: true, status: 200, message: "Another verified owner request for this Discord account remains approved, so the Verified Server Owner role stays in place.", attempt: completed };
    }
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
  } finally {
    await releaseRoleMutationLease(env, lease);
  }
}

export async function revokeOwnerDiscordRoleForAccountDeletion(env: Env, userId: string, fetcher: DiscordFetch = fetch) {
  const db = requireDb(env);
  if (!(await tableExists(env, "dzn_owner_discord_access_delivery_attempts"))) return { ok: true as const };

  const grants = await db.prepare(`SELECT delivery.request_id, delivery.guild_id, delivery.role_id,
      request.id, request.status, request.requester_user_id, request.requester_discord_id
    FROM dzn_owner_discord_access_delivery_attempts AS delivery
    JOIN dzn_owner_discord_access_requests AS request ON request.id = delivery.request_id
    WHERE delivery.requester_user_id = ?
      AND delivery.operation = 'role_grant'
      AND delivery.status = 'succeeded'
    ORDER BY delivery.completed_at DESC, delivery.created_at DESC, delivery.id DESC`)
    .bind(userId)
    .all<AccessRequestRow & { guild_id: string | null; role_id: string | null }>();
  const successfulGrants = grants.results ?? [];
  if (successfulGrants.length === 0) return { ok: true as const };
  if (!(await hasDeliverySchema(env))) {
    return { ok: false as const, status: 503 as const, message: "DZN cannot safely close this account while its recorded Discord owner role cleanup ledger is incomplete." };
  }

  const account = await db.prepare("SELECT id, discord_id, username, avatar FROM users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<SessionUser>();
  const discordId = discordIdValue(account?.discord_id);
  if (!account || !discordId) {
    return { ok: false as const, status: 409 as const, message: "DZN cannot safely close this account because its recorded Discord owner role identity is unavailable." };
  }
  const configuration = readRoleDeliveryConfiguration(env, false);
  if (!configuration) {
    return { ok: false as const, status: 503 as const, message: "DZN cannot safely close this account until the Discord owner-role configuration is available to remove the recorded role." };
  }
  if (successfulGrants.some((grant) => grant.guild_id !== configuration.guildId || grant.role_id !== configuration.verifiedOwnerRoleId)) {
    return { ok: false as const, status: 503 as const, message: "DZN cannot safely close this account because a recorded Discord owner role does not match the active DZN role configuration." };
  }

  const access = successfulGrants[0];
  const lease = await acquireRoleMutationLease(env, {
    requestId: access.id,
    discordId,
    operation: "account_deletion",
  });
  if (!lease) return { ok: false as const, status: 409 as const, message: "DZN is still changing this account's Discord owner role. Retry account closure shortly." };

  const actor: SessionUser = {
    id: account.id,
    discord_id: discordId,
    username: typeof account.username === "string" ? account.username : "Deleted DZN account",
    avatar: typeof account.avatar === "string" ? account.avatar : null,
  };
  const attempt = await startAttempt(env, access, "role_revoke", configuration, actor);
  try {
    const preflight = await checkDiscordRoleConfiguration(configuration, fetcher);
    if (!preflight.ok) {
      await finishAttempt(env, attempt, preflightToDeliveryStatus(preflight.status), preflight.status, preflight.message, preflight.httpStatus ?? null);
      return { ok: false as const, status: 503 as const, message: "DZN could not verify the Discord owner-role configuration needed before this account can be closed." };
    }
    if (await hasAnotherApprovedRequestForDiscord(env, discordId, access.id, userId)) {
      await finishAttempt(env, attempt, "succeeded", "other_approved_request", "Another verified owner request for this Discord account remains approved, so the role stays in place.", null);
      return { ok: true as const };
    }
    const membership = await discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/members/${encodeURIComponent(discordId)}`);
    if (membership.response.status === 404) {
      await finishAttempt(env, attempt, "succeeded", "member_not_joined", "No DZN Discord membership remained to change before account closure.", 404);
      return { ok: true as const };
    }
    if (!membership.response.ok) {
      await finishAttempt(env, attempt, deliveryStatusForHttp(membership.response.status), errorCodeForHttp(membership.response.status), "DZN could not verify the Discord member before account closure.", membership.response.status);
      return { ok: false as const, status: 503 as const, message: "DZN could not verify the Discord owner role needed before this account can be closed." };
    }
    const membershipPayload = recordValue(membership.payload);
    const roleIds = new Set<string>(Array.isArray(membershipPayload?.roles) ? membershipPayload.roles.map((value) => String(value)) : []);
    if (roleIds.has(configuration.verifiedOwnerRoleId)) {
      const removed = await discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/members/${encodeURIComponent(discordId)}/roles/${encodeURIComponent(configuration.verifiedOwnerRoleId)}`, { method: "DELETE" });
      if (!removed.response.ok && removed.response.status !== 404) {
        await finishAttempt(env, attempt, deliveryStatusForHttp(removed.response.status), errorCodeForHttp(removed.response.status), "DZN could not remove the Discord owner role before account closure.", removed.response.status);
        return { ok: false as const, status: 503 as const, message: "DZN could not remove the Discord owner role, so this account has not been closed." };
      }
    }
    await finishAttempt(env, attempt, "succeeded", null, null, 204);
    return { ok: true as const };
  } catch (error) {
    await finishAttempt(env, attempt, "retryable_failure", classifyThrownDiscordError(error), "DZN could not reach Discord while removing the owner role before account closure.", null);
    return { ok: false as const, status: 503 as const, message: "DZN could not confirm Discord owner-role removal, so this account has not been closed." };
  } finally {
    await releaseRoleMutationLease(env, lease);
  }
}

async function readApplicantAccessRequest(env: Env, requestId: string, user: SessionUser) {
  return requireDb(env).prepare(`SELECT id, status, requester_user_id, requester_discord_id
    FROM dzn_owner_discord_access_requests
    WHERE id = ? AND requester_user_id = ? LIMIT 1`).bind(requestId, user.id).first<AccessRequestRow>();
}

async function startAttempt(env: Env, access: AccessRequestRow, operation: DeliveryOperation, configuration: AttemptConfiguration, actor: SessionUser) {
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
    inviteChannelId: configuration.inviteChannelId ?? null,
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

function readRoleDeliveryConfiguration(env: Env, requireEnabled = true): RoleDeliveryConfiguration | null {
  if (requireEnabled && !deliveryFlagsEnabled(env)) return null;
  const botToken = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  const guildId = discordIdValue(env.DZN_OWNER_DISCORD_GUILD_ID);
  const verifiedOwnerRoleId = discordIdValue(env.DZN_OWNER_DISCORD_VERIFIED_OWNER_ROLE_ID);
  return botToken && guildId && verifiedOwnerRoleId ? { botToken, guildId, verifiedOwnerRoleId } : null;
}

function readInviteDeliveryConfiguration(env: Env): DeliveryConfiguration | null {
  const roleConfiguration = readRoleDeliveryConfiguration(env);
  const inviteChannelId = discordIdValue(env.DZN_OWNER_DISCORD_INVITE_CHANNEL_ID);
  return roleConfiguration && inviteChannelId ? { ...roleConfiguration, inviteChannelId } : null;
}

function deliveryFlagsEnabled(env: Env) {
  return truthy(env.DZN_OWNER_DISCORD_ACCESS_ENABLED) && truthy(env.DZN_OWNER_DISCORD_DELIVERY_ENABLED);
}

type RoleDeliveryPreflight =
  | {
    ok: true;
    status: "ready";
    message: string;
    httpStatus: null;
    checks: DeliveryDiagnostic["checks"];
    botId: string;
    botRoleIds: Set<string>;
    basePermissions: bigint;
  }
  | {
    ok: false;
    status: DeliveryDiagnostic["status"];
    message: string;
    httpStatus: number | null;
    checks: DeliveryDiagnostic["checks"];
  };

async function checkDiscordRoleConfiguration(configuration: RoleDeliveryConfiguration, fetcher: DiscordFetch): Promise<RoleDeliveryPreflight> {
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

    const [membership, rolesResponse] = await Promise.all([
      discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/members/${encodeURIComponent(botId)}`),
      discordRequest(fetcher, configuration, `/guilds/${encodeURIComponent(configuration.guildId)}/roles`),
    ]);
    if (!membership.response.ok) return failedChecks(membership.response.status === 404 ? "not_connected" : "discord_error", "DZN Bot is not available in the configured DZN Discord server.", membership.response.status);
    if (!rolesResponse.response.ok || !Array.isArray(rolesResponse.payload)) return failedChecks("discord_error", "DZN could not read the central Discord role configuration.", rolesResponse.response.status);

    const roles = rolesResponse.payload as DiscordRole[];
    const targetRole = roles.find((role) => String(role.id ?? "") === configuration.verifiedOwnerRoleId);
    const membershipPayload = recordValue(membership.payload);
    const botRoleIds = new Set<string>(Array.isArray(membershipPayload?.roles) ? membershipPayload.roles.map((value) => String(value)) : []);
    const roleById = new Map(roles.map((role) => [String(role.id ?? ""), role]));
    const botHighestPosition = Math.max(0, ...[...botRoleIds].map((roleId) => Number(roleById.get(roleId)?.position ?? 0)));
    const targetRolePosition = Number(targetRole?.position ?? -1);
    const basePermissions = getBotGuildPermissions(roles, botRoleIds, configuration.guildId);
    const hasAdministrator = hasPermission(basePermissions, DISCORD_ADMINISTRATOR);
    const canManageRoles = hasAdministrator || hasPermission(basePermissions, DISCORD_MANAGE_ROLES);
    const checks = {
      botTokenConfigured: true,
      botIdentity: true,
      botGuildMembership: true,
      inviteChannel: false,
      canViewInviteChannel: false,
      canCreateInvite: false,
      canManageRoles,
      targetRole: Boolean(targetRole),
      targetRoleBelowBot: Boolean(targetRole && targetRolePosition < botHighestPosition),
      botHasAdministrator: hasAdministrator,
    };
    if (!targetRole) return { ok: false as const, status: "not_configured" as const, message: "The configured Verified Server Owner role was not found in the central DZN Discord server.", httpStatus: null, checks };
    if (String(targetRole.id ?? "") === configuration.guildId || targetRole.managed === true) return { ok: false as const, status: "not_configured" as const, message: "The configured Verified Server Owner role must be a normal, assignable role in the central DZN Discord server.", httpStatus: null, checks };
    if (!checks.targetRoleBelowBot) return { ok: false as const, status: "role_hierarchy" as const, message: "DZN Bot must remain above the Verified Server Owner role before owner delivery can run.", httpStatus: null, checks };
    if (!canManageRoles) return { ok: false as const, status: "permission_missing" as const, message: "DZN Bot needs Manage Roles for the Verified Server Owner role.", httpStatus: null, checks };
    return { ok: true as const, status: "ready" as const, message: "DZN Bot can manage the Verified Server Owner role.", httpStatus: null, checks, botId, botRoleIds, basePermissions };
  } catch (error) {
    return failedChecks("discord_error", "DZN could not reach Discord for the central-server diagnostic.", null);
  }
}

async function checkDiscordDeliveryConfiguration(configuration: DeliveryConfiguration, fetcher: DiscordFetch) {
  const rolePreflight = await checkDiscordRoleConfiguration(configuration, fetcher);
  if (!rolePreflight.ok) return rolePreflight;
  try {
    const channelResponse = await discordRequest(fetcher, configuration, `/channels/${encodeURIComponent(configuration.inviteChannelId)}`);
    if (!channelResponse.response.ok) {
      return {
        ok: false as const,
        status: channelResponse.response.status === 403 ? "permission_missing" as const : "discord_error" as const,
        message: "DZN could not read the private invite channel.",
        httpStatus: channelResponse.response.status,
        checks: rolePreflight.checks,
      };
    }
    const channel = channelResponse.payload as DiscordChannel;
    if (String(channel.guild_id ?? "") !== configuration.guildId || ![0, 5].includes(Number(channel.type))) {
      return { ok: false as const, status: "not_configured" as const, message: "The configured private invite channel does not belong to the central DZN Discord server.", httpStatus: null, checks: rolePreflight.checks };
    }
    const channelPermissions = evaluateChannelPermissions(rolePreflight.basePermissions, channel, configuration.guildId, rolePreflight.botRoleIds, rolePreflight.botId);
    const canViewInviteChannel = rolePreflight.checks.botHasAdministrator || hasPermission(channelPermissions, DISCORD_VIEW_CHANNEL);
    const canCreateInvite = rolePreflight.checks.botHasAdministrator || hasPermission(channelPermissions, DISCORD_CREATE_INSTANT_INVITE);
    const checks = { ...rolePreflight.checks, inviteChannel: true, canViewInviteChannel, canCreateInvite };
    if (!canViewInviteChannel || !canCreateInvite) {
      return { ok: false as const, status: "permission_missing" as const, message: "DZN Bot needs View Channel and Create Invite on the private invite channel.", httpStatus: null, checks };
    }
    return { ok: true as const, status: "ready" as const, message: "DZN owner Discord delivery is ready for controlled requests.", httpStatus: null, checks };
  } catch (error) {
    return { ok: false as const, status: "discord_error" as const, message: "DZN could not reach Discord for the private-invite diagnostic.", httpStatus: null, checks: rolePreflight.checks };
  }
}

async function discordRequest(fetcher: DiscordFetch, configuration: RoleDeliveryConfiguration, path: string, init: RequestInit = {}) {
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
  const rows = await requireDb(env).prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('dzn_owner_discord_access_requests', 'dzn_owner_discord_access_delivery_attempts', 'dzn_owner_discord_access_role_mutations')").all<{ name: string }>();
  return new Set((rows.results ?? []).map((row) => row.name)).size === 3;
}

export type OwnerDiscordRoleMutationLease = RoleMutationLease;

export async function reserveOwnerDiscordRoleRevocationLease(env: Env, requestId: string, discordId: string) {
  if (!(await hasRoleMutationSchema(env))) return { available: false as const, lease: null };
  return {
    available: true as const,
    lease: await acquireRoleMutationLease(env, {
      requestId,
      discordId,
      operation: "revocation_decision",
      requiredStatus: "approved",
    }),
  };
}

export async function releaseOwnerDiscordRoleMutationLease(env: Env, lease: OwnerDiscordRoleMutationLease | null) {
  if (lease) await releaseRoleMutationLease(env, lease);
}

async function acquireRoleMutationLease(env: Env, input: {
  requestId: string;
  discordId: string;
  operation: RoleMutationOperation;
  requiredStatus?: AccessRequestRow["status"];
}): Promise<RoleMutationLease | null> {
  if (!(await hasRoleMutationSchema(env))) return null;
  const leaseId = crypto.randomUUID();
  const acquiredAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ROLE_MUTATION_LEASE_MS).toISOString();
  const result = await requireDb(env).prepare(`INSERT INTO dzn_owner_discord_access_role_mutations (
    discord_id, request_id, lease_id, operation, expires_at, acquired_at
  )
  SELECT ?, ?, ?, ?, ?, ?
   WHERE EXISTS (
     SELECT 1
       FROM dzn_owner_discord_access_requests
      WHERE id = ?
        AND requester_discord_id = ?
        AND (? IS NULL OR status = ?)
   )
  ON CONFLICT(discord_id) DO UPDATE SET
    request_id = excluded.request_id,
    lease_id = excluded.lease_id,
    operation = excluded.operation,
    expires_at = excluded.expires_at,
    acquired_at = excluded.acquired_at
  WHERE dzn_owner_discord_access_role_mutations.expires_at <= excluded.acquired_at`)
    .bind(input.discordId, input.requestId, leaseId, input.operation, expiresAt, acquiredAt, input.requestId, input.discordId, input.requiredStatus ?? null, input.requiredStatus ?? null)
    .run();
  return Number(result.meta.changes ?? 0) === 1 ? { discordId: input.discordId, leaseId } : null;
}

async function releaseRoleMutationLease(env: Env, lease: RoleMutationLease) {
  await requireDb(env).prepare(`DELETE FROM dzn_owner_discord_access_role_mutations
    WHERE discord_id = ? AND lease_id = ?`).bind(lease.discordId, lease.leaseId).run();
}

async function hasRoleMutationSchema(env: Env) {
  return tableExists(env, "dzn_owner_discord_access_role_mutations");
}

async function tableExists(env: Env, tableName: string) {
  const row = await requireDb(env).prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .bind(tableName)
    .first<{ name: string }>();
  return Boolean(row);
}

async function requestIsStillApprovedForApplicant(env: Env, requestId: string, user: SessionUser) {
  const row = await requireDb(env).prepare(`SELECT 1 AS found
    FROM dzn_owner_discord_access_requests
    WHERE id = ?
      AND requester_user_id = ?
      AND requester_discord_id = ?
      AND status = 'approved'
    LIMIT 1`).bind(requestId, user.id, user.discord_id).first<{ found: number }>();
  return Boolean(row);
}

async function hasAnotherApprovedRequestForDiscord(env: Env, discordId: string, requestId: string, excludeRequesterUserId?: string) {
  const row = await requireDb(env).prepare(`SELECT 1 AS found
    FROM dzn_owner_discord_access_requests
    WHERE requester_discord_id = ?
      AND status = 'approved'
      AND id <> ?
      AND (? IS NULL OR requester_user_id IS NULL OR requester_user_id <> ?)
    LIMIT 1`).bind(discordId, requestId, excludeRequesterUserId ?? null, excludeRequesterUserId ?? null).first<{ found: number }>();
  return Boolean(row);
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
