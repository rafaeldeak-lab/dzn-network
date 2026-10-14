import type { Env } from "./types";
import {
  getOwnerDiscordAccessRoleRejection,
  type OwnerDiscordAccessRoleRejection,
} from "./owner-discord-role-safety";

type DiscordFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type DiscordRole = {
  id?: string | number;
  name?: string;
  position?: string | number;
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
  type?: string | number;
  name?: string;
  parent_id?: string | number | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

export type OwnerDiscordDeliveryDiscovery = {
  ok: boolean;
  status: "not_configured" | "not_connected" | "discord_error" | "candidates_incomplete" | "ready_to_configure";
  message: string;
  checkedAt: string;
  guildId: string | null;
  checks: {
    botTokenConfigured: boolean;
    botIdentity: boolean;
    botGuildMembership: boolean;
    canManageRoles: boolean;
    botHasAdministrator: boolean;
    botHasUnexpectedGuildPermissions: boolean;
    verifiedOwnerRoleCandidates: number;
    privateInviteChannelCandidates: number;
  };
  verifiedOwnerRoleCandidates: Array<{
    id: string;
    name: string;
    assignable: boolean;
  }>;
  rejectedVerifiedOwnerRoles: Array<{
    id: string;
    name: string;
    reason: OwnerDiscordAccessRoleRejection;
  }>;
  privateInviteChannelCandidates: Array<{
    id: string;
    name: string;
    categoryName: string | null;
    canView: boolean;
    canCreateInvite: boolean;
    privateToEveryone: boolean;
  }>;
};

const DISCORD_API_ROOT = "https://discord.com/api/v10";
const DISCORD_PERMISSION_ONE = BigInt(1);
const DISCORD_CREATE_INSTANT_INVITE = DISCORD_PERMISSION_ONE << BigInt(0);
const DISCORD_ADMINISTRATOR = DISCORD_PERMISSION_ONE << BigInt(3);
const DISCORD_VIEW_CHANNEL = DISCORD_PERMISSION_ONE << BigInt(10);
const DISCORD_MANAGE_ROLES = DISCORD_PERMISSION_ONE << BigInt(28);
const DISCORD_OWNER_DELIVERY_ASSIGNED_GUILD_PERMISSION_ALLOWLIST = DISCORD_MANAGE_ROLES;
const DISCORD_OWNER_DELIVERY_EFFECTIVE_GUILD_PERMISSION_ALLOWLIST = DISCORD_VIEW_CHANNEL | DISCORD_MANAGE_ROLES;
const DISCORD_OWNER_DELIVERY_EFFECTIVE_CHANNEL_PERMISSION_ALLOWLIST = DISCORD_CREATE_INSTANT_INVITE | DISCORD_VIEW_CHANNEL | DISCORD_MANAGE_ROLES;

/**
 * Finds only the identifiers needed for the owner-access delivery diagnostic.
 * This function issues Discord GET requests exclusively; invite and role writes
 * remain unavailable until a separate configuration and diagnostic succeeds.
 */
export async function discoverOwnerDiscordDeliveryCandidates(
  env: Env,
  rawGuildId: unknown,
  fetcher: DiscordFetch = fetch,
): Promise<OwnerDiscordDeliveryDiscovery> {
  const checkedAt = new Date().toISOString();
  const guildId = discordIdValue(rawGuildId);
  const botToken = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (!guildId || !botToken) {
    return discovery("not_configured", "A central Discord server ID and the existing private bot credential are required for discovery.", checkedAt, guildId, {
      botTokenConfigured: Boolean(botToken),
    });
  }

  try {
    const identity = await discordGet(fetcher, botToken, "/users/@me");
    const botId = discordIdValue(recordValue(identity.payload)?.id);
    if (!identity.response.ok || !botId) {
      return discovery(identity.response.status === 401 ? "not_connected" : "discord_error", "DZN could not authenticate the configured Discord bot.", checkedAt, guildId, {
        botTokenConfigured: true,
      });
    }

    const [membership, rolesResponse, channelsResponse] = await Promise.all([
      discordGet(fetcher, botToken, `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(botId)}`),
      discordGet(fetcher, botToken, `/guilds/${encodeURIComponent(guildId)}/roles`),
      discordGet(fetcher, botToken, `/guilds/${encodeURIComponent(guildId)}/channels`),
    ]);
    if (!membership.response.ok) {
      return discovery(membership.response.status === 404 ? "not_connected" : "discord_error", "DZN Bot is not available in the selected central Discord server.", checkedAt, guildId, {
        botTokenConfigured: true,
        botIdentity: true,
      });
    }
    if (!rolesResponse.response.ok || !Array.isArray(rolesResponse.payload) || !channelsResponse.response.ok || !Array.isArray(channelsResponse.payload)) {
      return discovery("discord_error", "DZN could not read the central Discord role and channel configuration.", checkedAt, guildId, {
        botTokenConfigured: true,
        botIdentity: true,
        botGuildMembership: true,
      });
    }

    const roles = rolesResponse.payload as DiscordRole[];
    const channels = channelsResponse.payload as DiscordChannel[];
    const membershipPayload = recordValue(membership.payload);
    const botRoleIds = new Set<string>(Array.isArray(membershipPayload?.roles) ? membershipPayload.roles.map((value) => String(value)) : []);
    const roleById = new Map(roles.map((role) => [String(role.id ?? ""), role]));
    const botHighestPosition = Math.max(0, ...[...botRoleIds].map((roleId) => Number(roleById.get(roleId)?.position ?? 0)));
    const basePermissions = getBotGuildPermissions(roles, botRoleIds, guildId);
    const botAssignedPermissions = getBotAssignedGuildPermissions(roles, botRoleIds, guildId);
    const everyoneBasePermissions = parseBits(roleById.get(guildId)?.permissions);
    const botHasAdministrator = hasPermission(basePermissions, DISCORD_ADMINISTRATOR);
    const botHasUnexpectedGuildPermissions = hasUnexpectedOwnerDeliveryGuildPermissions(botAssignedPermissions, basePermissions);
    const canManageRoles = hasPermission(botAssignedPermissions, DISCORD_MANAGE_ROLES);
    const namedVerifiedOwnerRoles = roles
      .filter((role) => normalizeRoleName(role.name) === "verified server owner");
    const verifiedOwnerRoleCandidates = namedVerifiedOwnerRoles
      .filter((role) => getOwnerDiscordAccessRoleRejection(role, guildId) === null)
      .map((role) => ({
        id: String(role.id ?? ""),
        name: String(role.name ?? "Verified Server Owner"),
        assignable: Boolean(
          role.id &&
          String(role.id) !== guildId &&
          role.managed !== true &&
          Number(role.position ?? -1) < botHighestPosition,
        ),
      }))
      .filter((role) => discordIdValue(role.id));
    const rejectedVerifiedOwnerRoles = namedVerifiedOwnerRoles
      .map((role) => {
        const reason = getOwnerDiscordAccessRoleRejection(role, guildId);
        if (!reason) return null;
        return {
          id: String(role.id ?? "").trim(),
          name: String(role.name ?? "Verified Server Owner"),
          reason,
        };
      })
      .filter((role): role is NonNullable<typeof role> => role !== null);
    const channelById = new Map(channels.map((channel) => [String(channel.id ?? ""), channel]));
    const privateInviteChannelCandidates = channels
      .filter((channel) => [0, 5].includes(Number(channel.type)))
      .map((channel) => {
        const category = channel.parent_id ? channelById.get(String(channel.parent_id)) ?? null : null;
        // Evaluate the @everyone role's effective channel visibility. This fails
        // closed for public channels while supporting private guilds without an
        // explicit channel overwrite.
        const privateToEveryone = everyoneIsDeniedView(everyoneBasePermissions, channel, guildId);
        const channelPermissions = evaluateChannelPermissions(basePermissions, channel, guildId, botRoleIds, botId);
        const channelScopedPermissions = getBotChannelOverwritePermissions(channel, botRoleIds, botId);
        const canView = hasPermission(channelPermissions, DISCORD_VIEW_CHANNEL) && hasPermission(channelScopedPermissions, DISCORD_VIEW_CHANNEL);
        const canCreateInvite = hasPermission(channelPermissions, DISCORD_CREATE_INSTANT_INVITE) && hasPermission(channelScopedPermissions, DISCORD_CREATE_INSTANT_INVITE);
        if (!privateToEveryone || !canView || !canCreateInvite || hasUnexpectedOwnerDeliveryChannelPermissions(channelPermissions)) return null;
        return {
          id: String(channel.id ?? ""),
          name: safeChannelName(channel.name),
          categoryName: category ? safeChannelName(category.name) : null,
          canView,
          canCreateInvite,
          privateToEveryone,
        };
      })
      .filter((channel): channel is NonNullable<typeof channel> => channel !== null && Boolean(discordIdValue(channel.id)))
      .sort((left, right) => left.name.localeCompare(right.name));
    const checks = {
      botTokenConfigured: true,
      botIdentity: true,
      botGuildMembership: true,
      canManageRoles,
      botHasAdministrator,
      botHasUnexpectedGuildPermissions,
      verifiedOwnerRoleCandidates: verifiedOwnerRoleCandidates.length,
      privateInviteChannelCandidates: privateInviteChannelCandidates.length,
    };
    const hasAssignableRole = verifiedOwnerRoleCandidates.some((role) => role.assignable);
    if (botHasAdministrator || botHasUnexpectedGuildPermissions || !canManageRoles || !hasAssignableRole || privateInviteChannelCandidates.length === 0) {
      const missingRequirements = [
        !hasAssignableRole ? "an assignable Verified Server Owner role" : null,
        privateInviteChannelCandidates.length === 0 ? "a private invite channel" : null,
        botHasAdministrator ? "removal of the Administrator permission" : null,
        !botHasAdministrator && botHasUnexpectedGuildPermissions ? "removal of guild permissions outside the owner-delivery allowlist" : null,
        !canManageRoles ? "the explicit Manage Roles permission" : null,
      ].filter((value): value is string => Boolean(value));
      const roleMessage = rejectedVerifiedOwnerRoles.length
        ? "The named Verified Server Owner role is excluded until it is a normal zero-permission Discord role; private channel overwrites provide its access. "
        : "";
      return discovery("candidates_incomplete", `${roleMessage}DZN found the central server, but it still needs ${humanList(missingRequirements)} before configuration can be completed.`, checkedAt, guildId, checks, verifiedOwnerRoleCandidates, rejectedVerifiedOwnerRoles, privateInviteChannelCandidates);
    }
    return discovery("ready_to_configure", "DZN found safe central-server candidates. No Discord invite, role, message, permission, or membership change was made.", checkedAt, guildId, checks, verifiedOwnerRoleCandidates, rejectedVerifiedOwnerRoles, privateInviteChannelCandidates);
  } catch {
    return discovery("discord_error", "DZN could not reach Discord for the read-only central-server discovery.", checkedAt, guildId, {
      botTokenConfigured: true,
    });
  }
}

function discovery(
  status: OwnerDiscordDeliveryDiscovery["status"],
  message: string,
  checkedAt: string,
  guildId: string | null,
  checks: Partial<OwnerDiscordDeliveryDiscovery["checks"]>,
  verifiedOwnerRoleCandidates: OwnerDiscordDeliveryDiscovery["verifiedOwnerRoleCandidates"] = [],
  rejectedVerifiedOwnerRoles: OwnerDiscordDeliveryDiscovery["rejectedVerifiedOwnerRoles"] = [],
  privateInviteChannelCandidates: OwnerDiscordDeliveryDiscovery["privateInviteChannelCandidates"] = [],
): OwnerDiscordDeliveryDiscovery {
  return {
    ok: status === "ready_to_configure",
    status,
    message,
    checkedAt,
    guildId,
    checks: {
      botTokenConfigured: false,
      botIdentity: false,
      botGuildMembership: false,
      canManageRoles: false,
      botHasAdministrator: false,
      botHasUnexpectedGuildPermissions: false,
      verifiedOwnerRoleCandidates: verifiedOwnerRoleCandidates.length,
      privateInviteChannelCandidates: privateInviteChannelCandidates.length,
      ...checks,
    },
    verifiedOwnerRoleCandidates,
    rejectedVerifiedOwnerRoles,
    privateInviteChannelCandidates,
  };
}

async function discordGet(fetcher: DiscordFetch, botToken: string, path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetcher(`${DISCORD_API_ROOT}${path}`, {
      headers: { authorization: `Bot ${botToken}` },
      signal: controller.signal,
    });
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

function getBotAssignedGuildPermissions(roles: DiscordRole[], botRoleIds: Set<string>, guildId: string) {
  return roles.reduce((permissions, role) => {
    const roleId = String(role.id ?? "");
    return roleId !== guildId && botRoleIds.has(roleId) ? permissions | parseBits(role.permissions) : permissions;
  }, BigInt(0));
}

function hasUnexpectedOwnerDeliveryGuildPermissions(assignedPermissions: bigint, effectivePermissions: bigint) {
  return (
    (assignedPermissions & ~DISCORD_OWNER_DELIVERY_ASSIGNED_GUILD_PERMISSION_ALLOWLIST) !== BigInt(0) ||
    (effectivePermissions & ~DISCORD_OWNER_DELIVERY_EFFECTIVE_GUILD_PERMISSION_ALLOWLIST) !== BigInt(0)
  );
}

function hasUnexpectedOwnerDeliveryChannelPermissions(permissions: bigint) {
  return (permissions & ~DISCORD_OWNER_DELIVERY_EFFECTIVE_CHANNEL_PERMISSION_ALLOWLIST) !== BigInt(0);
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

function getBotChannelOverwritePermissions(channel: DiscordChannel, botRoleIds: Set<string>, botId: string) {
  const overwrites = Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites : [];
  let roleAllow = BigInt(0);
  for (const overwrite of overwrites) {
    if (String(overwrite.type) !== "0" || !botRoleIds.has(String(overwrite.id))) continue;
    roleAllow |= parseBits(overwrite.allow);
  }
  // Discord combines all bot-role overwrites before its member-specific overwrite;
  // a role allow wins over a role deny, so only explicit role allows grant access.
  return applyOverwrite(roleAllow, overwrites.find((overwrite) => String(overwrite.type) === "1" && String(overwrite.id) === botId));
}

function everyoneIsDeniedView(basePermissions: bigint, channel: DiscordChannel, guildId: string) {
  if (hasPermission(basePermissions, DISCORD_ADMINISTRATOR)) return false;
  const overwrite = (channel.permission_overwrites ?? []).find((candidate) => String(candidate.type) === "0" && String(candidate.id) === guildId);
  const effectivePermissions = applyOverwrite(basePermissions, overwrite);
  return !hasPermission(effectivePermissions, DISCORD_VIEW_CHANNEL);
}

function applyOverwrite(permissions: bigint, overwrite: DiscordPermissionOverwrite | undefined) {
  if (!overwrite) return permissions;
  return (permissions & ~parseBits(overwrite.deny)) | parseBits(overwrite.allow);
}

function hasPermission(permissions: bigint, permission: bigint) {
  return (permissions & permission) === permission;
}

function parseBits(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^\d+$/.test(text) ? BigInt(text) : BigInt(0);
}

function normalizeRoleName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

function humanList(values: string[]) {
  if (values.length < 2) return values[0] ?? "additional configuration";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function safeChannelName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, " ") : "";
  return name.slice(0, 100) || "Unnamed channel";
}

function discordIdValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{12,24}$/.test(text) ? text : null;
}

function normalizeBotToken(value: unknown) {
  const token = typeof value === "string" ? value.trim() : "";
  return token.length >= 20 && !/\s/.test(token) ? token : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
