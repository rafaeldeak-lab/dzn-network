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
  const permissions = permissionBits(role?.permissions);
  return isRemovableOwnerDiscordAccessRole(role, guildId) && permissions === BigInt(0);
}

/**
 * Cleanup must be able to remove an already-issued role if it later gains
 * guild-wide permissions. Grants remain restricted to the zero-permission
 * role above; removals only require a normal role that the bot can manage.
 */
export function isRemovableOwnerDiscordAccessRole(role: OwnerDiscordRoleSafetyInput | null | undefined, guildId: string) {
  const roleId = discordIdValue(role?.id);
  return Boolean(roleId && roleId !== guildId && role?.managed !== true);
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
