type OperatorsEnv = Record<string, string | undefined>;

export type DznOperatorsFeatureFlags = {
  enabled: boolean;
  demoMode: boolean;
  engagementEnabled: boolean;
};

export function isDznOperatorsEnabled(env: OperatorsEnv = process.env): boolean {
  return env.NEXT_PUBLIC_DZN_OPERATORS_ENABLED === "true";
}

export function isDznOperatorsDemoModeEnabled(env: OperatorsEnv = process.env): boolean {
  return env.NEXT_PUBLIC_DZN_OPERATORS_DEMO_MODE === "true";
}

export function isDznOperatorsEngagementEnabled(env: OperatorsEnv = process.env): boolean {
  return env.NEXT_PUBLIC_DZN_OPERATORS_ENGAGEMENT_ENABLED === "true";
}

export function getDznOperatorsFeatureFlags(env: OperatorsEnv = process.env): DznOperatorsFeatureFlags {
  const flags = {
    enabled: isDznOperatorsEnabled(env),
    demoMode: isDznOperatorsDemoModeEnabled(env),
  } as DznOperatorsFeatureFlags;

  Object.defineProperty(flags, "engagementEnabled", {
    enumerable: false,
    value: isDznOperatorsEngagementEnabled(env),
  });

  return flags;
}
