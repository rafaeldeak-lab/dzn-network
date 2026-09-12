export const RETURNING_STARTER_OFFER = "starter-gbp-2-month-no-trial-v1";
export const RETURNING_STARTER_COPY = "GBP 2 due when you confirm payment in Stripe, then GBP 2 each month until you cancel. No new free trial.";
export type ReturningStarterOffer = {
  id: typeof RETURNING_STARTER_OFFER;
  confirmation: string;
  price_label: string;
  terms: string;
};
export function returningStarterOffer(confirmation: string): ReturningStarterOffer {
  return { id: RETURNING_STARTER_OFFER, confirmation, price_label: "GBP 2/month", terms: RETURNING_STARTER_COPY };
}
