# DZN Billing Policy Readiness

## Scope

This 2026-09-07 slice prepares public customer information needed before live
Starter and Pro checkout. It is based on production `main` at
`3c57c990a4d23d97b346582743bfea66371795fb` after the billing safety series.
It does not enable checkout, reminders, charge a customer, start a trial, change
Stripe or Cloudflare configuration, or write production D1.

## Public contract

- `/terms` explains free player access, the eligible two-day Starter trial,
  GBP 2 monthly renewal, GBP 10 Pro with no trial, verified Stripe fulfilment,
  cancellation, payment-state restrictions, fair competition, support, and
  preserved statutory rights.
- `/refunds` explains self-service cancellation, the Starter deadline, when a
  scheduled cancellation normally takes effect, private support, individual
  refund review, billing-error correction, original-method refunds, and the
  relationship between refunds or disputes and paid owner access.
- `/privacy` explains the account, Discord, server, ADM, public-profile,
  technical, notification, and billing data boundaries. Stripe handles card
  details; DZN stores only limited billing identifiers and state needed for
  verified access, recovery, duplicate protection, and audit.
- `/pricing` links all three policies and the private billing support email. The
  homepage footer links the policies without changing the DZN visual system.
- Payment FAQ copy now states that refunds are reviewed under the published
  policy and applicable law; it does not invent a blanket no-refund term or say
  prices include tax.

The wording is deliberately conservative. It is product copy and technical
readiness evidence, not a solicitor's certification of every legal obligation.
The owner should obtain professional review when practical, especially before
selling broadly outside the UK or changing tax/VAT status.

## Unresolved public seller disclosure

Live checkout remains blocked until the owner confirms the exact legal seller
name and a geographic business correspondence address that may be published to
customers. DZN Network is a trading name and must not be substituted for an
unconfirmed legal identity. A private or home address must not be inferred from
provider records or published without the owner's explicit decision.

The shared seller-disclosure guard now requires
`DZN_PUBLIC_LEGAL_SELLER_NAME` and `DZN_PUBLIC_LEGAL_CONTACT_ADDRESS` before a
live-mode Checkout Session can be created, even if `DZN_LIVE_CHECKOUT_ENABLED`
is switched on. The terms page shows an honest paused-checkout notice while
either value is absent. Test-mode Checkout remains available for validation.

The support flow identifies an account using the signed-in Discord username and
Discord user ID. The Stripe receipt email is requested separately as a payment
reference because DZN does not store an email address for every Discord account.

## Required Stripe customer-facing updates

The live Stripe products currently have the correct GBP 2 and GBP 10 monthly
Prices, but their short descriptions do not state the complete renewal and fair
access contract. Before checkout activation, update only the descriptions to:

- Starter: `Optional DZN server-owner tools. GBP 0 for an eligible two-day
  trial, then GBP 2/month until cancelled. Payment method required. No
  competitive advantage.`
- Pro: `Optional DZN server-owner tools. GBP 10/month from confirmation, with
  no free trial, until cancelled. No competitive advantage.`

Keep the existing Price objects unchanged. The Starter trial is created by the
verified DZN Checkout Session rather than as a reusable product-level default.
The completed Stripe test Checkout proves the test path only; it did not charge
a live customer or enable production checkout.

After the public policy pages are complete and live, configure Stripe Checkout
to show the Terms and Privacy links and DZN support contact. Enable customer
refund emails as a separate setting. Do not enable the refund-policy checkbox
until Stripe's displayed refund text has been reviewed against `/refunds`.

## Validation

- `npm run test:payment-copy` passed.
- `npm run test:billing-plans` passed, including duplicate/interrupted Checkout,
  exact Price validation, webhook atomicity, payment recovery, renewal,
  cancellation, first-time and returning Starter, private setup reminders, and
  verified trial reminders.
- Nonincremental TypeScript passed.
- ESLint passed with zero errors and five pre-existing warnings.
- `next build --webpack` and the Cloudflare Pages route patch passed. The normal
  Turbopack build cannot follow the external shared `node_modules` junction in
  this isolated Windows worktree; this is an environment limitation, not a
  source failure.
- `npm run qa:billing-policy-readiness` passed `/pricing`, `/terms`, `/privacy`,
  and `/refunds` at 1440x900 and 390x844 with status 200, no page errors, no
  horizontal overflow, expected policy links, and exact payment copy. Sanitized
  screenshots and `results.json` are outside OneDrive at
  `C:/Users/rafae/Desktop/DZN-Audits/evidence/dzn-billing-policy-readiness-20260907`.

## Activation and rollback boundary

Do not release this code as checkout-ready or enable live checkout until the
public legal seller identity and geographic business correspondence address are
confirmed and included in the customer terms. After that blocker is resolved
and the pages are live, Stripe can point its public Terms and Privacy links at
them and display DZN support details. Refund emails can be enabled as a separate
provider setting. Recheck production billing readiness and public plan copy
after those changes.

Live checkout still requires an explicit controlled production flag change.
Enabling `DZN_LIVE_CHECKOUT_ENABLED` permits real Checkout Session creation; it
does not itself charge an existing account. Each owner must personally choose a
plan, review Stripe's hosted terms, enter a payment method, and confirm recurring
billing. The private payment-setup and one-day-left reminders have separate flags
and should be enabled only after their production schema and live Checkout are
confirmed.

Rollback is code/config flag based. Disable new checkout and reminder flags to
stop new attempts and notices. Do not delete trial claims, checkout attempts,
webhook receipts, billing accounts, or existing subscriptions. Turning checkout
off does not cancel subscriptions already confirmed by Stripe.
