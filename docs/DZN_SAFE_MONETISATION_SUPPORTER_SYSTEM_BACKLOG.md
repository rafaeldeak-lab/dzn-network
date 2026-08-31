# DZN Safe Monetisation And Supporter System Backlog

## Decision

This backlog item supersedes the earlier paid-spin idea.

DZN may add a real production store and supporter system in a later approved implementation slice, but spins must never be sold directly or indirectly. The Fair Progression Boundary remains the controlling rule: money may buy guaranteed account-bound presentation items, never competitive power, reward odds, XP, ranking, scoring, discovery, eligibility, or earned progression.

The implementation preflight for this backlog is `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`. That preflight defines the safe production implementation sequence, migration shapes, feature flags, webhook verification, idempotent fulfilment, refund and chargeback handling, admin pricing controls, tax/receipt boundaries, rollback path, and proof requirements before runtime work starts.

The original implementation preflight did not itself implement payment routes, checkout sessions, webhook handlers, order tables, entitlement tables, supporter cards, spin ledgers, Stripe product changes, Cloudflare secret changes, production D1 writes, or live checkout activation. Follow-on slices now add the bounded local/test schema and disabled-by-default sandbox route pieces described below. None of those slices enable live checkout, Store webhook fulfilment, Supporter Card issuance, earned-spin ledgers, reward wheel runtime, Stripe product changes, Cloudflare secret changes, production D1 writes, or issue #49 changes.

The DZN Store sandbox order and checkout approval preflight is `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`. It defines future `POST /api/store/orders` and `POST /api/stripe/store-webhook` contracts, one-time Stripe Checkout Session shape, webhook event ledger, idempotent fulfilment, refund/chargeback revocation, tax/receipt records, feature flags, rollback, and proof requirements. It creates no checkout route, order table, payment webhook, entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change.

The DZN Store sandbox order ledger schema is `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`. It adds `migrations/0072_dzn_store_order_ledger_schema.sql` as a local/sandbox-only schema step for `store_orders`, `store_order_items`, and `store_payment_events`. It stores sandbox-only order headers, one-item order snapshots, and provider event ledger rows with unique Stripe event ids, raw event hashes, sanitized summaries, and no-fulfilment blockers. No checkout route, Stripe Checkout Session creation, Store webhook handler, webhook fulfilment, account entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, Stripe mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change is added.

The DZN Store Sandbox Webhook Event Ledger Receipt slice is `docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md`. It adds a disabled-by-default, receipt-only `POST /api/stripe/store-webhook` route that verifies Stripe signatures and records sanitized test-mode `store_payment_events` rows only. No Store webhook fulfilment, account entitlement write, Supporter Card issuance, earned-spin ledger, reward wheel runtime, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change is added.

## DZN Store Webhook Fulfilment Approval Preflight

The DZN Store webhook fulfilment approval preflight is `docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md`.

It defines the future verified test-mode fulfilment contract before any runtime side effects exist:

- Eligible fulfilment events: `checkout.session.completed` first, and `checkout.session.async_payment_succeeded` only if delayed payment methods are separately approved.
- PaymentIntent events remain receipt/corroboration only for the first fulfilment runtime.
- Success-page redirects must never fulfil purchases.
- Store order transitions are explicitly bounded through `checkout_created`, `payment_pending`, `paid`, `payment_failed`, `checkout_expired`, `disputed`, `refunded`, `revoked`, `manual_review`, and `blocked_by_flag`.
- Exactly one account entitlement per fulfilled source order.
- Exactly one Founding Supporter Card per qualifying account.
- Full refunds, reversals, chargebacks, and lost disputes revoke only the affected Store entitlement/card.
- Partial refunds require `manual_review` unless a later policy deliberately handles them.
- Future schema work must be separately approved before entitlement/supporter-card tables or fulfilment-attempt writes exist.

The current `POST /api/stripe/store-webhook` route remains receipt-only. Current `store_payment_events` fulfilment blockers remain fixed to `0`. This preflight adds no fulfilment route writes, account entitlement table, Supporter Card table, earned-spin ledger, reward wheel runtime, live checkout activation, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 write, or issue #49 change.

## DZN Store Fulfilment Ledger Schema Migration Approval Preflight

The DZN Store fulfilment ledger schema migration approval preflight is `docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT.md`.

It defines the future local/test-only schema contract before any migration is added:

- `account_entitlements` as private account-bound cosmetic/supporter entitlements only.
- `supporter_cards` as one serial-unique DZN Founding Supporter Card per qualifying account.
- `store_fulfilment_attempts` as the idempotent verified-event processing boundary.
- `store_order_status_history` and `store_entitlement_status_history` as non-destructive audit trails.
- `store_refund_dispute_audit` as sanitized refund, reversal, chargeback, and dispute reconciliation.
- Uniqueness constraints for source order item fulfilment, payment-event processing, Supporter Card serials, and one Founding Supporter Card per user.
- Rollback rules that suspend, restore, or revoke only the affected Store entitlement/card and never delete ledger rows.

This preflight adds no migration file, account entitlement table, Supporter Card table, fulfilment-attempt table, refund/dispute table, Store fulfilment runtime, Store webhook fulfilment write, earned-spin ledger, reward wheel runtime, live checkout activation, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 write, or issue #49 change.

## DZN Store Fulfilment Ledger Schema Migration Implementation

The DZN Store fulfilment ledger schema migration implementation is `docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION.md`.

It adds `migrations/0073_dzn_store_fulfilment_ledger_schema.sql` as a local/test-only private Store fulfilment ledger schema step for:

- `account_entitlements`
- `supporter_cards`
- `store_fulfilment_attempts`
- `store_order_status_history`
- `store_entitlement_status_history`
- `store_refund_dispute_audit`

Store fulfilment runtime remains disabled. No Store webhook fulfilment write, Supporter Card issuance, earned-spin ledger, reward wheel runtime, live checkout activation, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 write, or issue #49 change is added.

The new schema cannot affect billing, owner entitlement, server ownership, rankings, discovery score, reviews, badges, seasons, events, CTF scoring, Server Wars scoring, XP awards, earned calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

## DZN Store Fulfilment Runtime Implementation Approval Preflight

The DZN Store fulfilment runtime implementation approval preflight is `docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT.md`.

It defines the future disabled-by-default local/test fulfilment runtime contract before any runtime side effects exist:

- Exact local/test feature flag requirements for receipt, fulfilment, Supporter Cards, earned spins, reward wheel, Store live checkout, and owner live checkout.
- Exact future write scope for `store_fulfilment_attempts`, `store_orders`, `store_order_status_history`, `account_entitlements`, `store_entitlement_status_history`, optional `supporter_cards`, and `store_refund_dispute_audit`.
- Verified `checkout.session.completed` grant flow using raw-body Stripe signature verification and server-side order reconciliation.
- `checkout.session.async_payment_succeeded` as delayed-payment future-only until separately approved.
- PaymentIntent events as receipt/corroboration only, not fulfilment triggers.
- Idempotency rules using `store_payment_events`, `store_fulfilment_attempts`, source order item uniqueness, and Supporter Card uniqueness.
- Account entitlement and optional Supporter Card issuance boundaries.
- Full refund, reversal, chargeback, and dispute rollback rules.
- Proof that Store payments cannot mint spins, run the wheel, unlock owner access, affect rankings, affect discovery, affect reviews, affect events, affect XP/calling-card awards, or affect competitive eligibility.

The current Store webhook remains receipt-only. This preflight adds no Store fulfilment runtime, account entitlement write, Supporter Card issuance, earned-spin ledger, reward wheel runtime, live checkout activation, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 write, or issue #49 change.

## Implementation Preflight

The approved preflight is documentation and test guard work only. It keeps `DZN_LIVE_CHECKOUT_ENABLED` unset/false, keeps issue #49 reserved for final live checkout activation, and blocks one-time Stripe Checkout Sessions, store runtime, webhook fulfilment, account entitlement writes, Supporter Card issuance, earned-spin ledgers, reward wheel runtime, Stripe live object changes, Cloudflare secret changes, production D1 writes, Nitrado changes, Discord changes, AI provider credentials, vector stores, analytics/tracking, and metered model calls.

The first runtime step after the preflight is the DZN Store catalog and admin product/price draft model with disabled-by-default migrations and local validation only. Checkout creation, payment webhook fulfilment, Supporter Card issuance, earned spins, wheel runtime, account entitlement writes, and live checkout remain out of scope for that safe step.

## DZN Store Catalog And Admin Product/Price Draft Model

The catalog slice adds only `store_products` and `store_prices` through `migrations/0071_dzn_store_catalog_admin_draft.sql`, plus local validation in `functions/_lib/dzn-store-catalog.ts`.

Product validation rejects any paid spin, XP, rank, discovery, review, event, Server Wars, CTF, owner setup, Nitrado, or competitive eligibility benefit. Product rows are account-bound guaranteed purchase metadata only, default inactive, and include fixed no-competitive-advantage constraints.

Price validation keeps Stripe Price IDs unbound in this slice, keeps pay-what-you-want future-only, requires GBP local draft prices, and rejects active prices until a later approved catalog-admin surface deliberately enables activation rules.

Checkout creation, payment webhook fulfilment, account entitlement writes, Supporter Card issuance, earned spins, wheel runtime, Stripe product/Price changes, Cloudflare secret changes, production D1 writes, live checkout, and issue #49 remain out of scope.

## DZN Store Public Browse And Supporter Card Preview Contract

The public preview slice adds a disabled-by-default, read-only `/store` surface backed by the static preview contract in `functions/_lib/dzn-store-catalog.ts`.

The preview surface may show:

- Safe catalog product names and descriptions.
- Guaranteed-purchase labels.
- Account-bound labels.
- No-competitive-advantage labels.
- The planned `DZN FOUNDING SUPPORTER PACK` Supporter Card preview copy.
- Sample-only card fields such as `DZN-SUP-002481`, display name, Supporter Since, selected theme, and generated insignia.
- The list of runtime actions that remain blocked.

The preview surface must not show products as active or checkoutable. Every preview product remains `catalogStatus: "preview_only"`, `active: false`, `checkoutAvailable: false`, `accountBound: true`, `guaranteedPurchase: true`, and `noCompetitiveAdvantage: true`.

Checkout creation, order creation, webhook fulfilment, account entitlement writes, Supporter Card issuance, earned spins, wheel runtime, Stripe product/Price changes, Cloudflare secret changes, production D1 writes, live checkout, and issue #49 remain out of scope.

## DZN Store Sandbox Order And Checkout Approval Preflight

The sandbox order and checkout approval preflight is documentation and test guard work only. It defines:

- Authenticated `POST /api/store/orders` for a future sandbox order-to-checkout flow.
- Session-derived purchaser identity only; request body user, Discord, owner, server, billing, or entitlement ids are ignored or rejected.
- One active Store product and one active Store price per order, quantity fixed to `1`.
- One-time Stripe Checkout Session shape using `mode=payment`.
- Non-sensitive order-derived Stripe idempotency keys.
- Future `POST /api/stripe/store-webhook` event-ledger verification and retention rules.
- Exactly-once fulfilment rules for account entitlements and Supporter Cards.
- Refund, reversal, chargeback, tax, receipt, and private payment-record boundaries.
- Feature flags that default disabled and keep live checkout blocked.
- Non-destructive rollback and proof matrix before runtime.

This preflight still does not implement checkout routes, order tables, Store payment webhooks, entitlement writes, Supporter Card issuance, earned-spin ledgers, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 writes, live checkout activation, or issue #49 changes.

## DZN Store Sandbox Order Ledger Schema

The sandbox order ledger schema slice adds only:

- `migrations/0072_dzn_store_order_ledger_schema.sql`
- `store_orders`
- `store_order_items`
- `store_payment_events`

`store_orders` is fixed to local/sandbox scope with `livemode = 0`, one product per order, immutable product/price/tax/flag snapshots, private hashed Discord/customer references, and lifecycle states that stop before entitlement fulfilment.

`store_order_items` stores the immutable product/price/item snapshot for exactly one item per order. It keeps account-bound, guaranteed-purchase, and no-competitive-advantage checks plus hard false fields for spins, XP, ranking, discovery, review, event, Server Wars, CTF, owner subscription access, and competitive eligibility.

`store_payment_events` stores unique Stripe event ids, provider references, processing status, raw event SHA-256 hash, sanitized summary JSON, and failure metadata. It also fixes fulfilment, entitlement-write, and Supporter Card write attempts to `0`.

This schema does not add Store APIs, checkout routes, Stripe Checkout Sessions, Store webhook handlers, webhook fulfilment, account entitlement tables or writes, Supporter Card tables or issuance, earned-spin ledgers, spin ledgers, wheel cooldowns, reward wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 writes, live checkout activation, or issue #49 changes.

## DZN Store Sandbox Order Creation Route Approval

The order route slice adds a disabled-by-default authenticated `POST /api/store/orders` route plus the guarded helper in `functions/_lib/dzn-store-orders.ts`.

It writes only pending local/test `store_orders` and `store_order_items`, and only when:

- The caller is authenticated through the existing DZN session model.
- `DZN_STORE_SANDBOX_RUNTIME=local` or `test`.
- `DZN_STORE_ENABLED=true`.
- `DZN_STORE_CHECKOUT_ENABLED=true`.
- `DZN_STORE_SANDBOX_CHECKOUT_ENABLED=true`.
- Store live checkout and existing `DZN_LIVE_CHECKOUT_ENABLED` are both false.
- Webhook fulfilment, Supporter Card runtime, earned-spin runtime, and reward wheel runtime are all false.
- The selected approved/active product and price preserve the Fair Progression Boundary.

It creates no Stripe Checkout Session, processes no Store webhook, writes no `store_payment_events`, grants no account entitlement, issues no Supporter Card, mints no earned spin, runs no wheel, mutates no Stripe object, mutates no Cloudflare secret/config, writes no production D1, enables no live checkout, and changes no issue #49.

## DZN Store Sandbox Checkout Session Approval

The checkout slice is `docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md`.

It creates a test-mode only Stripe Checkout Session after a pending local/test order exists and belongs to the authenticated player. It uses:

- `POST /api/store/orders/:orderId/checkout`
- `functions/api/store/orders/[orderId]/checkout.ts`
- `functions/_lib/dzn-store-checkout.ts`
- a server-controlled `store_prices.stripe_price_id`
- an order-derived Stripe idempotency key
- safe success/cancel URLs
- one `mode=payment` line item

It updates only `store_orders` to `checkout_created`.

It creates no Store webhook fulfilment, entitlements, Supporter Cards, earned spins, wheel runtime, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change.

## DZN Store Sandbox Webhook Event Ledger Receipt

The webhook receipt slice adds a disabled-by-default signed Store webhook endpoint:

- `POST /api/stripe/store-webhook`
- `functions/api/stripe/store-webhook.ts`
- `functions/_lib/dzn-store-webhook.ts`

It is receipt-only. It verifies the `Stripe-Signature` header against the unmodified raw request body, accepts only `livemode=false` test events, and records sanitized `store_payment_events` rows with a raw event SHA-256 hash, event class, optional safe provider references, and no-fulfilment blockers fixed to `0`.

It creates no Store webhook fulfilment, account entitlement write, Supporter Card issuance, earned-spin ledger, reward wheel runtime, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change.

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

## DZN Store Fulfilment Runtime Implementation

Delivered in `docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md`.

This slice adds disabled-by-default local/test Store fulfilment runtime for verified `checkout.session.completed` receipts. It writes idempotent `store_fulfilment_attempts`, `store_order_status_history`, exactly one safe `account_entitlements` row per fulfilled source item, optional `supporter_cards` issuance only when `DZN_SUPPORTER_CARDS_ENABLED=true`, and sanitized refund/dispute audit and rollback records.

PaymentIntent events remain no-grant. Success redirects remain no-grant. Store fulfilment remains separate from owner Starter/Pro billing and cannot unlock `/setup`, Nitrado linking, owner dashboards, server management, server ownership, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

This delivered slice still adds no earned-spin ledger, reward wheel runtime, live checkout activation, Stripe Product/Price mutation, Cloudflare config mutation, production D1 write, or issue #49 change.

## DZN Store Fulfilment Reconciliation/Read-Model Preflight

Delivered in `docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md`.

This preflight defines future private Account Purchases and Entitlements read models, private Supporter Card reveal/status UI, admin-only webhook replay controls, admin-only manual-review controls, and admin-only refund/dispute operator workflow.

It is documentation/test-guard work only. It adds no public card reveal, Account Purchases route, Entitlements route, admin replay route, manual-review route, refund/dispute operator route, notification, migration, production D1 apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe Product/Price/customer/refund/dispute/webhook endpoint mutation, Cloudflare config mutation, production D1 write, or issue #49 change.

The next Store payment step should be the Store private Account Purchases and Entitlements read-model implementation approval slice, only if deliberately approved.

## DZN Store Account Purchases Read-Model Implementation

Delivered in `docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md`.

This slice adds the disabled-by-default authenticated private read-only `GET /api/account/purchases` route for the current user's Store purchases, entitlements, and private Supporter Card status. It uses only sanitized local/test Store ledgers and returns no raw Stripe ids, payment method details, billing address, raw Discord ids, raw internal DZN user/order/item/entitlement/card ids, Supporter Card serial numbers, webhook raw bodies, raw provider payloads, operator notes, or other users' Store records.

The route remains behind `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED=false` by default, requires `DZN_STORE_SANDBOX_RUNTIME=local` or `test`, and blocks live checkout, earned-spin runtime, and reward-wheel runtime flags.

This read-model slice itself added no Account Purchases UI, no public Supporter Card reveal, no private Supporter Card reveal component, no Entitlements route, no webhook replay route, no manual-review route, no refund/dispute operator route, no notification, no migration, no production D1 apply, no live checkout activation, no earned-spin ledger, no reward wheel runtime, no Stripe Product/Price/customer/refund/dispute/webhook endpoint mutation, no Cloudflare config mutation, no production D1 write, and no issue #49 change.

## DZN Store Account Purchases UI Shell

Delivered in `docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md`.

This slice adds `/account/purchases` as an authenticated private read-only account page that consumes only `GET /api/account/purchases` with included session credentials and no-store caching. The Store preview also links to this private Account Purchases shell.

The UI may show purchase, entitlement, and private Supporter Card status returned by the sanitized current-user read model. It must not show Supporter Card serial numbers, generated card art, raw Stripe IDs, payment method data, billing details, raw Discord IDs, raw internal DZN IDs, webhook raw bodies, raw provider payloads, operator notes, or any other user's Store records.

This delivered UI shell still adds no public Supporter Card reveal, no private Supporter Card reveal component, no Entitlements route, no webhook replay route, no manual-review route, no refund/dispute operator route, no notification, no migration, no production D1 apply, no live checkout activation, no earned-spin ledger, no reward wheel runtime, no Stripe Product/Price/customer/refund/dispute/webhook endpoint mutation, no Cloudflare config mutation, no production D1 write, and no issue #49 change.

The next Store payment step should be Store private Supporter Card reveal approval preflight only if deliberately approved.

## Implementation Boundary

The Safe Monetisation and Supporter System must be built as a real production feature when selected for implementation, not as a visual-only mockup. Because it introduces payments, order fulfilment, refund handling, entitlements, and player cosmetics, it must be implemented in dedicated high-risk payment slices with explicit approval, sandbox evidence, rollback rules, security review, tax/receipt review, and live-checkout activation review.

Until then:

- Live checkout remains disabled.
- Issue #49 remains reserved for final live payment activation unless a later approved payment governance slice deliberately splits owner-subscription go-live from store go-live.
- No Stripe products, prices, checkout sessions, webhook endpoints, Cloudflare secrets, production D1 data, Nitrado resources, Discord resources, AI provider credentials, vector stores, metered model calls, analytics/tracking systems, retained exports, rankings, scoring, Server Wars, CTF, XP awards, calling-card awards, reviews, discovery score, seasons, events, or competitive eligibility are changed by this backlog item.
