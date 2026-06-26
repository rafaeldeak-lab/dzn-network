import type { Env } from "./types";

export type DznFeatureFlags = {
  dznPulseEnabled: boolean;
  discordNotificationsEnabled: boolean;
};

export function readDznFeatureFlags(env: Partial<Env> | Record<string, unknown> = {}): DznFeatureFlags {
  return {
    dznPulseEnabled: parseBooleanFlag((env as Record<string, unknown>).DZN_PULSE_ENABLED),
    discordNotificationsEnabled: parseBooleanFlag((env as Record<string, unknown>).DZN_DISCORD_NOTIFICATIONS_ENABLED),
  };
}

export function isDznPulseEnabled(env: Partial<Env> | Record<string, unknown> = {}) {
  return readDznFeatureFlags(env).dznPulseEnabled;
}

export function isDiscordNotificationsEnabled(env: Partial<Env> | Record<string, unknown> = {}) {
  return readDznFeatureFlags(env).discordNotificationsEnabled;
}

function parseBooleanFlag(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
