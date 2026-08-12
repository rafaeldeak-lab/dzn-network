type OperatorsEnv = Record<string, string | undefined>;

const BUILD_OPERATORS_ENABLED = process.env.NEXT_PUBLIC_DZN_OPERATORS_ENABLED === "true";
const BUILD_OPERATORS_DEMO_MODE = process.env.NEXT_PUBLIC_DZN_OPERATORS_DEMO_MODE === "true";
const BUILD_OPERATORS_ENGAGEMENT_ENABLED = process.env.NEXT_PUBLIC_DZN_OPERATORS_ENGAGEMENT_ENABLED === "true";
const BUILD_OPERATORS_FULL_STUDIO_ENABLED = process.env.NEXT_PUBLIC_DZN_OPERATORS_FULL_STUDIO_ENABLED === "true";

export type DznOperatorsFeatureFlags = {
  enabled: boolean;
  demoMode: boolean;
  engagementEnabled: boolean;
  fullStudioEnabled: boolean;
};

export function isDznOperatorsEnabled(env?: OperatorsEnv): boolean {
  if (env) return env.NEXT_PUBLIC_DZN_OPERATORS_ENABLED === "true";
  return BUILD_OPERATORS_ENABLED;
}

export function isDznOperatorsDemoModeEnabled(env?: OperatorsEnv): boolean {
  if (env) return env.NEXT_PUBLIC_DZN_OPERATORS_DEMO_MODE === "true";
  return BUILD_OPERATORS_DEMO_MODE;
}

export function isDznOperatorsEngagementEnabled(env?: OperatorsEnv): boolean {
  if (env) return env.NEXT_PUBLIC_DZN_OPERATORS_ENGAGEMENT_ENABLED === "true";
  return BUILD_OPERATORS_ENGAGEMENT_ENABLED;
}

export function isDznOperatorsFullStudioEnabled(env?: OperatorsEnv): boolean {
  if (env) return env.NEXT_PUBLIC_DZN_OPERATORS_FULL_STUDIO_ENABLED === "true";
  return BUILD_OPERATORS_FULL_STUDIO_ENABLED;
}

export function getDznOperatorsFeatureFlags(env?: OperatorsEnv): DznOperatorsFeatureFlags {
  const flags = {
    enabled: isDznOperatorsEnabled(env),
    demoMode: isDznOperatorsDemoModeEnabled(env),
  } as DznOperatorsFeatureFlags;

  Object.defineProperty(flags, "engagementEnabled", {
    enumerable: false,
    value: isDznOperatorsEngagementEnabled(env),
  });

  Object.defineProperty(flags, "fullStudioEnabled", {
    enumerable: false,
    value: isDznOperatorsFullStudioEnabled(env),
  });

  return flags;
}
