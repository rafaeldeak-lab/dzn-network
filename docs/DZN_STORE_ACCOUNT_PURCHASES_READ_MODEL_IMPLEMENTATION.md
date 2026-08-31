# DZN Store Account Purchases Read-Model Implementation

## Status And Boundary

This slice implements the approved private Account Purchases and Entitlements read model.

It adds:

- `GET /api/account/purchases`
- `functions/_lib/dzn-store-account-purchases.ts`
- `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED` as a runtime-only feature flag read from the request environment
- A focused implementation test in `scripts/test-dzn-store-account-purchases-read-model.ts`

The route is disabled by default. It returns no customer data unless all of these are true:

- `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED=true`
- `DZN_STORE_ENABLED=true`
- `DZN_STORE_SANDBOX_RUNTIME=local` or `test`
- `DZN_STORE_LIVE_CHECKOUT_ENABLED` is unset/false
- `DZN_LIVE_CHECKOUT_ENABLED` is unset/false
- `DZN_EARNED_SPINS_ENABLED` is unset/false
- `DZN_REWARD_WHEEL_ENABLED` is unset/false
- The caller has a valid DZN session

This route is private/no-store, authenticated, read-only, and scoped to the current authenticated user plus the active local/test sandbox ledger scope.

This slice does not add, enable, create, mutate, or approve:

- No public Supporter Card reveal.
- No private Supporter Card reveal component.
- No Account Purchases page.
- No `GET /api/account/entitlements`.
- No webhook replay route.
- No manual-review route.
- No refund/dispute operator route.
- No notification.
- No migration.
- No production migration apply.
- no live checkout activation.
- No earned-spin ledger.
- No reward wheel runtime.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, webhook endpoint, or API mutation.
- No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.
- No Nitrado, Discord, analytics, tracking, AI provider credentials, vector stores, or metered model calls.
- no issue #49 change.

`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false. `DZN_STORE_LIVE_CHECKOUT_ENABLED` remains unset/false. Issue #49 remains reserved for final live checkout activation.

## Sources Checked

This implementation keeps the same payment and Cloudflare safety assumptions used by the previous Store slices:

- Stripe webhook fulfilment must be webhook-backed and not based on success-page redirects: https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
- Stripe webhook signatures require the raw body and Stripe-Signature header before event trust: https://docs.stripe.com/webhooks/signature
- Stripe event handling must remain explicitly allowlisted as event types evolve: https://docs.stripe.com/api/events/types
- Refund and dispute state needs local reconciliation and audit rather than broad entitlement deletion: https://docs.stripe.com/refunds and https://docs.stripe.com/disputes/how-disputes-work
- D1 access should use prepared statements with bound parameters: https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Local/test D1 proof stays separate from production migration apply approval: https://developers.cloudflare.com/d1/best-practices/local-development/

## Architecture Found

The repository already has a staged Store payment architecture:

- Read-only Store preview and catalog drafts exist separately from payment writes.
- Sandbox order creation can create pending local/test orders only when Store sandbox flags are enabled.
- Sandbox Checkout Session creation can create only test-mode one-time Stripe Checkout Sessions for an owned pending order.
- Store webhook receipt handling verifies Stripe signatures and records sanitized `store_payment_events`.
- Store fulfilment can process verified local/test `checkout.session.completed` receipts behind `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED`.
- The fulfilment schema already contains `account_entitlements`, `supporter_cards`, `store_fulfilment_attempts`, `store_order_status_history`, `store_entitlement_status_history`, and `store_refund_dispute_audit`.

This slice reads those existing sanitized local/test ledgers. It adds no new schema and no new payment state transitions.

## Route Contract

`GET /api/account/purchases` returns a current-user private read model only after the feature flag and login checks pass, and every Store order read is constrained to `livemode = 0` plus the active local/test sandbox ledger scope.

Disabled/default response:

- Status `404`
- `ok: false`
- `private: true`
- `cache: "no-store"`
- `scope: "current_user"`
- `error: "STORE_ACCOUNT_PURCHASES_READ_MODEL_DISABLED"`
- `live_checkout_enabled: false`

Unauthenticated enabled response:

- Status `401`
- `error: "Unauthorized"`
- No Store ledger reads when no DZN session is present.

Successful response:

- Status `200`
- `private: true`
- `cache: "no-store"`
- `scope: "current_user"`
- `route: "/api/account/purchases"`
- `schema_version: "2026-08-29.store-account-purchases-read-model-v1"`
- `purchases`
- `entitlements`
- `supporter_cards`
- Explicit safety markers proving no payment, Store, progression, ranking, or competitive mutation happened.

## Sanitized Fields

The route may return:

- Customer-facing Store order number as `purchase_ref`.
- Order status.
- Product display name, product key, product type, and fulfilment kind.
- Price snapshot amounts in minor units and currency.
- Selected Supporter Card theme key.
- Guaranteed-purchase, account-bound, and no-competitive-advantage labels.
- Sanitized payment receipt state from `store_payment_events` such as event type, event class, processing status, and timestamps.
- Fulfilment attempt status.
- Entitlement status.
- Private Supporter Card status only.
- Display-safe status history reason codes.
- Refund/dispute local decision summaries.

The route must not return:

- Raw Stripe event ids.
- Raw Checkout Session ids.
- Raw PaymentIntent ids.
- Raw Charge ids.
- Raw Refund ids.
- Raw Dispute ids.
- Stripe customer ids.
- Customer email, billing address, tax address, payment method, card brand, card last four, bank details, or card token details.
- Raw Discord ids.
- Raw internal DZN user ids.
- Raw internal Store order ids.
- Raw internal order item ids.
- Raw entitlement ids.
- Raw Supporter Card ids.
- Supporter Card serial numbers.
- Webhook raw bodies.
- Raw provider payload JSON.
- Operator notes.
- Other users' purchases, entitlements, Supporter Cards, orders, or payment events.

## Supporter Card Boundary

This route can say whether a private Supporter Card status exists for the current user. It does not reveal the card itself.

Returned Supporter Card status is limited to:

- Purchase reference.
- Product key.
- Status.
- Visibility state.
- Supporter since timestamp.
- Selected theme key.
- Issued/suspended/revoked timestamps.
- `private_reveal_available: false`
- `public_reveal_available: false`
- `reveal_blocked_reason: "supporter_card_reveal_requires_future_approved_slice"`

Private Supporter Card reveal, public Supporter Card reveal, badge visibility controls, and card-sharing controls remain separate future slices.

## Entitlement And Access Matrix

| Surface | Logged-out user | Logged-in player | Owner Starter/Pro entitlement | DZN admin/operator |
| --- | --- | --- | --- | --- |
| `GET /api/account/purchases` flag off | `404`, no ledger read | `404`, no ledger read | Same as player | Same as player |
| `GET /api/account/purchases` flag on | `401`, no Store purchase data | Can read only own sanitized Store ledgers | Same as player; owner plan adds no Store read advantage | Same as player unless a separate admin route is approved |
| `GET /api/account/entitlements` | Absent | Absent | Absent | Absent |
| Supporter Card private reveal UI | Absent | Absent | Absent | Absent |
| Supporter Card public reveal | Absent | Absent | Absent | Absent |
| Webhook replay/manual review/refund workflow | Absent | Absent | Absent | Absent |

Owner Starter/Pro billing does not unlock this route. The route is a private account surface for the current authenticated Store purchaser only.

## Protected Surfaces

The read model does not read from or write to:

- Owner billing accounts.
- Owner plan entitlements.
- Server ownership.
- `/setup`.
- Nitrado linking.
- Public discovery ranking.
- Leaderboards.
- Reviews or review score.
- Badges.
- Seasons.
- Events.
- CTF scoring.
- Server Wars scoring.
- XP awards.
- Calling-card awards.
- Public profile visibility.
- Retained exports.
- Moderation decisions.
- Competitive eligibility.
- Earned spins or reward wheel tables.

The response includes explicit false safety markers for those systems so UI tests can prove the route is presentation-only.

## Implementation Notes

`functions/_lib/dzn-store-account-purchases.ts` performs only prepared-statement `SELECT` reads with bound values:

- Purchases are read from `store_orders` where `purchasing_user_id` equals the authenticated user id and `livemode = 0`.
- Items are joined through `store_order_items`.
- Entitlements are joined only when `account_entitlements.user_id` matches the order purchaser and `livemode = 0`.
- Supporter Cards are joined only when `supporter_cards.user_id` matches the order purchaser and `livemode = 0`.
- Payment events, fulfilment attempts, status history, and refund/dispute audit rows are loaded only for the current user's already-selected order ids.

The helper deliberately does not import Stripe helpers, call `fetch`, call Wrangler, create checkout sessions, update ledgers, issue Supporter Cards, or run fulfilment.

## Validation

Required validation for this slice:

- `npm run test:dzn-store-account-purchases-read-model`
- `npm run test:dzn-store-fulfilment-reconciliation-read-model-preflight`
- `npm run test:dzn-store-fulfilment-runtime-implementation`
- `npm run test:dzn-store-fulfilment-runtime-implementation-preflight`
- `npm run test:dzn-store-fulfilment-ledger-schema-migration`
- `npm run test:dzn-store-fulfilment-ledger-schema-preflight`
- `npm run test:dzn-store-webhook-fulfilment-approval-preflight`
- `npm run test:dzn-store-sandbox-webhook-ledger-receipt`
- `npm run test:dzn-store-sandbox-checkout-session-approval`
- `npm run test:dzn-store-sandbox-order-route-approval`
- `npm run test:dzn-store-order-ledger-schema`
- `npm run test:dzn-safe-monetisation-supporter-preflight`
- `npm run check:billing-config`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Codex Security diff scan

## Follow-On Delivered

The follow-on Account Purchases UI shell is delivered separately in `docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md`. It adds `/account/purchases` as an authenticated private read-only page that consumes only `GET /api/account/purchases`, keeps Supporter Card reveal blocked, and adds no webhook replay route, manual-review route, refund/dispute operator route, notifications, production migration apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change.

## Next Recommended Slice

Next should be Store private Supporter Card reveal approval preflight only if deliberately approved: define the exact private reveal contract, serial/art redaction boundaries, account ownership proof, visibility controls, screenshot/export rules, audit requirements, rollback path, and security proof before any card reveal route, card-art generation, public reveal, sharing controls, notifications, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change is implemented.

The personal player page/nav button remains a separate player UX slice.
