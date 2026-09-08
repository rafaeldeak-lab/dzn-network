// Public descriptions only. Eligibility and payment authority stay server-side.
export const PAYMENT_COPY = {
  player: "Player access is free. Discord login, Player Hub and personal profiles do not require an owner subscription.",
  starterPrice: "\u00a32/month",
  starterOffer: "Eligible accounts: \u00a30 for a 2-day trial, then \u00a32/month",
  starterTerms: "A payment method is required. For eligible accounts, the two-day trial starts when you complete checkout in Stripe. DZN unlocks owner access after verifying the subscription. Starter automatically renews at \u00a32/month unless you cancel before the trial ends.",
  returningStarter: "Already used your Starter trial? There is no second trial. After a separate confirmation, Starter costs \u00a32 when you confirm payment in Stripe, then \u00a32/month until cancelled.",
  proPrice: "\u00a310/month",
  proTerms: "Pro has no free trial. Your first \u00a310 payment is due when you confirm payment in Stripe, then Pro renews at \u00a310/month until cancelled.",
  cancellation: "Open Dashboard > Billing & Plan > Manage Billing to review your subscription, update payment details or cancel. Cancel before your trial deadline to avoid the first subscription payment. Cancelling renewal does not itself refund payments already made.",
  refunds: "Refund requests and billing errors are reviewed under the DZN cancellations and refunds policy and applicable law. This does not limit statutory consumer rights.",
  recovery: "If a payment fails, paid owner tools may be unavailable until payment recovery is confirmed. Update your payment method through Manage Billing. A retry, a website visit or a return from Stripe does not start another trial or grant paid access by itself.",
  consent: "Only the account owner should enter payment details and accept recurring billing in Stripe. Opening this page or signing in does not start a trial or take payment.",
  fairness: "Subscriptions pay for server-owner tools and presentation, not player progress or competitive advantage. They do not buy rankings, review scores, badges, season wins, XP, calling-card awards, Server Wars or CTF results, or competitive eligibility.",
  paused: "Checkout is currently unavailable. No trial starts and no payment is taken from this page while checkout is unavailable.",
} as const;

export const PAYMENT_FAQS = [
  { question: "Do players need to pay?", answer: PAYMENT_COPY.player },
  { question: "When does the Starter trial start?", answer: PAYMENT_COPY.starterTerms },
  { question: "What if I have already used my trial?", answer: PAYMENT_COPY.returningStarter },
  { question: "When is Pro charged?", answer: PAYMENT_COPY.proTerms },
  { question: "How do I cancel or change my payment method?", answer: PAYMENT_COPY.cancellation },
  { question: "Can I request a refund?", answer: PAYMENT_COPY.refunds },
  { question: "What happens if payment fails?", answer: PAYMENT_COPY.recovery },
  { question: "Does paying give a competitive advantage?", answer: PAYMENT_COPY.fairness },
] as const;

export function pricingReturnTo(value: string | null) {
  return value === "/dashboard" ? "/dashboard" : "/setup";
}
