# DZN Safe Monetisation And Supporter System Backlog

## Decision

This backlog item supersedes the earlier paid-spin idea.

DZN may add a real production store and supporter system in a later approved implementation slice, but spins must never be sold directly or indirectly. The Fair Progression Boundary remains the controlling rule: money may buy guaranteed account-bound presentation items, never competitive power, reward odds, XP, ranking, scoring, discovery, eligibility, or earned progression.

The implementation preflight for this backlog is `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`. That preflight defines the safe production implementation sequence, migration shapes, feature flags, webhook verification, idempotent fulfilment, refund and chargeback handling, admin pricing controls, tax/receipt boundaries, rollback path, and proof requirements before runtime work starts.

This document and the implementation preflight do not implement store routes, payment routes, checkout sessions, webhook handlers, product tables, order tables, entitlement tables, supporter cards, spin ledgers, price changes, Stripe product changes, Cloudflare secret changes, production D1 writes, or live checkout activation.

## Implementation Preflight

The approved preflight is documentation and test guard work only. It keeps `DZN_LIVE_CHECKOUT_ENABLED` unset/false, keeps issue #49 reserved for final live checkout activation, and blocks one-time Stripe Checkout Sessions, store runtime, webhook fulfilment, account entitlement writes, Supporter Card issuance, earned-spin ledgers, reward wheel runtime, Stripe live object changes, Cloudflare secret changes, production D1 writes, Nitrado changes, Discord changes, AI provider credentials, vector stores, analytics/tracking, and metered model calls.

The first future runtime step after the preflight should be the DZN Store catalog and admin product/price draft model with disabled-by-default migrations and local validation only. Checkout creation, payment webhook fulfilment, Supporter Card issuance, earned spins, wheel runtime, account entitlement writes, and live checkout remain out of scope for that next safe step.

## Wheel Rules

Players must never be able to purchase spins with:

- Real money.
- Credits bought with money.
- Supporter Packs.
- Subscriptions.
- Indirect bundles.

Spins may only be earned through legitimate website activity:

- Daily activity.
- Challenges.
- Community missions.
- Events.
- Account milestones.
- Occasional free promotional awards.

Required server-side controls:

- Maximum three total spins in any rolling 24-hour period.
- Minimum four-hour cooldown between spins.
- Purchases cannot bypass either restriction.
- Every spin provides a reward; there are no empty, failed, or lost spins.
- Display the complete reward pool and probabilities before spinning.
- No cash, gift cards, physical prizes, or cash-equivalent rewards.
- Rewards cannot be transferred, sold, traded, redeemed, or exchanged.
- No fake near-misses, jackpots, spending prompts, or spin-again pressure.
- Spin results are generated and recorded server-side.
- An auditable spin ledger records player, source, outcome, and timestamp.

Allowed reward types:

- Account-bound cosmetics.
- Calling cards.
- Profile decorations.
- Other non-monetary DZN items.

## One-Off DZN Store

DZN may add a store for guaranteed one-time digital purchases. Every product must show exactly what the customer receives before payment.

Suitable product families:

- DZN Supporter Pack.
- Profile theme packs.
- Calling-card packs.
- Chat and profile cosmetic packs.
- Group banner and insignia packs.
- Event presentation themes.

Purchases must never provide:

- XP.
- Ranking advantages.
- Better reward odds.
- Additional spins.
- Tournament advantages.
- Review or discovery advantages.
- Server War scoring advantages.
- Competitive eligibility.

## DZN Founding Supporter Pack

The first planned supporter product is:

```text
DZN FOUNDING SUPPORTER PACK
```

It must not be marketed as a charitable donation. It is a supporter purchase that helps fund DZN development.

Pricing:

- The price must be configurable by an administrator.
- A pay-what-you-want option above a defined minimum may be added later.

Included items:

- One permanent, unique DZN Supporter Card.
- Unique serial number, for example `DZN-SUP-002481`.
- Player display name.
- `Supporter Since` date.
- Customer-selected card theme shown before payment.
- Unique generated insignia and cosmetic detailing.
- Permanent Supporter profile badge.
- Optional Supporter chat badge.
- Supporter profile frame.
- Ability to hide the badge publicly.
- No competitive or gameplay advantages.

Supporter Card rules:

- Issued only once per qualifying account.
- Permanently attached for the life of that account and the DZN service.
- Non-transferable.
- Non-tradeable.
- Non-resellable.
- Non-redeemable for money or account credit.
- Protected against duplicate serial numbers.
- Recoverable when the same owner regains access to their account.
- Revoked if the payment is refunded, reversed, or charged back.
- No artificial rarity tiers based on payment amount; every supporter receives equal recognition.

## Payment Implementation Requirements

Future implementation must use the existing payment provider and architecture. If Stripe remains the configured provider, one-time Stripe Checkout Sessions are the expected path.

Required flow:

1. An authenticated player chooses a guaranteed product.
2. The backend creates an order and Checkout Session.
3. The payment page displays the exact product, price, and account receiving it.
4. A verified payment webhook confirms successful payment.
5. The server fulfils the order exactly once.
6. The entitlement and Supporter Card attach to that account.
7. The customer receives a receipt and can view the purchase in Account Purchases.

Never grant an entitlement from only the success-page redirect.

Required payment controls:

- Signed webhook verification.
- Idempotent fulfilment.
- Duplicate-event protection.
- Order and entitlement ledgers.
- Refund and chargeback handling.
- Tax/VAT-compatible records.
- Clear purchase and refund terms.
- Admin-configurable product availability and pricing.
- No storage of card information in DZN.

Suggested future data entities:

- `products`.
- `prices`.
- `orders`.
- `order_items`.
- `payment_events`.
- `account_entitlements`.
- `supporter_cards`.
- `earned_spins`.
- `spin_ledger`.
- `wheel_cooldowns`.

## User Interface Requirements

Future implementation should add:

- Premium DZN Store page.
- Guaranteed-purchase labels.
- Account-bound labels.
- No competitive advantage explanation.
- Supporter Card preview before checkout.
- Purchase confirmation screen.
- Supporter Card reveal after confirmed payment.
- Account Purchases and Entitlements section.
- Wheel cooldown countdown.
- Remaining daily spin allowance.
- Clear explanation that spins are earned and cannot be purchased.

## Tests And Acceptance Criteria

Future implementation must prove:

- Users cannot buy spins directly or indirectly.
- Purchases cannot bypass wheel limits.
- Cooldowns are enforced server-side.
- Concurrent requests cannot create additional spins.
- Payment webhooks cannot fulfil the same order twice.
- Entitlements attach only to the purchasing account.
- Private payment information is never exposed.
- Supporter serial numbers are unique.
- Refunds and chargebacks revoke the correct entitlement.
- Cosmetic purchases never change XP, rankings, scoring, or eligibility.
- Wheel outcomes and probabilities match the configured reward pool.
- Admin price changes cannot alter completed orders.

## Implementation Boundary

The Safe Monetisation and Supporter System must be built as a real production feature when selected for implementation, not as a visual-only mockup. Because it introduces payments, order fulfilment, refund handling, entitlements, and player cosmetics, it must be implemented in dedicated high-risk payment slices with explicit approval, sandbox evidence, rollback rules, security review, tax/receipt review, and live-checkout activation review.

Until then:

- Live checkout remains disabled.
- Issue #49 remains reserved for final live payment activation unless a later approved payment governance slice deliberately splits owner-subscription go-live from store go-live.
- No Stripe products, prices, checkout sessions, webhook endpoints, Cloudflare secrets, production D1 data, Nitrado resources, Discord resources, AI provider credentials, vector stores, metered model calls, analytics/tracking systems, retained exports, rankings, scoring, Server Wars, CTF, XP awards, calling-card awards, reviews, discovery score, seasons, events, or competitive eligibility are changed by this backlog item.
