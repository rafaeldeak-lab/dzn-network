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
  return requirements.disabled_reason == null &&
    Array.isArray(requirements.currently_due) && requirements.currently_due.length === 0 &&
    Array.isArray(requirements.past_due) && requirements.past_due.length === 0;
}
