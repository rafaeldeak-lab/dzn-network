type OperatorsEnv = Record<string, string | undefined>;

export type DznOperatorsFeatureFlags = {
  enabled: boolean;
  demoMode: boolean;
};

export function isDznOperatorsEnabled(env: OperatorsEnv = process.env): boolean {
  return env.NEXT_PUBLIC_DZN_OPERATORS_ENABLED === "true";
}

export function isDznOperatorsDemoModeEnabled(env: OperatorsEnv = process.env): boolean {
  return env.NEXT_PUBLIC_DZN_OPERATORS_DEMO_MODE === "true";
}

export function getDznOperatorsFeatureFlags(env: OperatorsEnv = process.env): DznOperatorsFeatureFlags {
  return {
    enabled: isDznOperatorsEnabled(env),
    demoMode: isDznOperatorsDemoModeEnabled(env),
  };
}
