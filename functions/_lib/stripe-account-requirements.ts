export type StripeAccountRequirements = {
  disabled_reason?: string | null;
  currently_due?: unknown[];
  past_due?: unknown[];
} | null | undefined;

/**
 * Stripe can omit an empty requirements object from a healthy Account response.
 * Explicit requirements remain a hard checkout and readiness failure.
 */
export function hasClearStripeAccountRequirements(requirements: StripeAccountRequirements) {
  if (requirements == null) return true;
  const emptyList = (value: unknown) => value === undefined || (Array.isArray(value) && value.length === 0);
  return requirements.disabled_reason == null && emptyList(requirements.currently_due) && emptyList(requirements.past_due);
}
