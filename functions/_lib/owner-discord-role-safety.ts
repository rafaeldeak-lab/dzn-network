export type OwnerDiscordRoleSafetyInput = {
  id?: string | number;
  managed?: boolean;
  permissions?: string | number;
};

/**
 * Verified owner access is granted by private channel overwrites. The role
 * itself must not grant guild-wide Discord permissions.
 */
export function isSafeOwnerDiscordAccessRole(role: OwnerDiscordRoleSafetyInput | null | undefined, guildId: string) {
  const roleId = discordIdValue(role?.id);
  const permissions = permissionBits(role?.permissions);
  return Boolean(roleId && roleId !== guildId && role?.managed !== true && permissions === BigInt(0));
}

function discordIdValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{12,24}$/.test(text) ? text : null;
}

function permissionBits(value: unknown) {
  if (typeof value === "bigint") return value >= BigInt(0) ? value : null;
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^\d+$/.test(text) ? BigInt(text) : null;
}
