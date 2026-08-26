# DZN Store Sandbox Order And Checkout Approval Preflight

## Status And Boundary

This slice is approval preflight only. It defines the first future sandbox order and one-time Stripe Checkout contract for DZN Store purchases, but it does not implement payment runtime.

This slice does not add, create, mutate, or enable:

- Checkout routes.
- Order tables.
- Payment webhook tables or handlers.
- Account entitlement writes.
- Supporter Card issuance.
- Earned-spin ledgers.
- Reward wheel runtime.
- Stripe Checkout Sessions.
- Stripe Products, Prices, Customers, webhook endpoints, refunds, disputes, or live objects.
- Cloudflare variables, secrets, bindings, Pages config, Workers config, or production D1 state.
- Nitrado, Discord, AI provider credentials, vector stores, analytics, tracking, or metered model calls.
- Live checkout activation.
- Issue #49 changes.

`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false. Issue #49 remains reserved for final live owner-subscription checkout activation unless a later deliberately approved payment-governance slice separates store go-live from owner-subscription go-live.

## Architecture Baseline

DZN already has owner subscription billing:

- `functions/api/billing/create-checkout-session.ts` creates Starter/Pro owner subscription Checkout Sessions with `mode: "subscription"`.
- `functions/api/stripe/webhook.ts` handles subscription-oriented Stripe events.
- `functions/_lib/plans.ts` owns canonical owner billing readiness, checkout safety, Starter trial claims, and entitlement normalization.
- `functions/_lib/stripe.ts` owns Stripe API helpers and raw-body webhook signature verification.
- `functions/_lib/dzn-store-catalog.ts` owns the disabled-by-default DZN Store catalog and preview contract added by the earlier Store slices.
- `/store` is currently a public-safe, read-only preview route. It cannot create checkout sessions, orders, webhooks, entitlements, Supporter Cards, earned spins, or wheel results.

The future DZN Store payment path must stay separate from Starter/Pro owner subscription billing. A Store purchase is a player/account cosmetic purchase only. It is not an owner plan, not server-management access, not Nitrado access, not owner setup access, and not competitive eligibility.

## External References Reviewed On 2026-08-27

The future implementation must re-check provider docs at implementation time, but this preflight is based on the current Stripe contracts:

- Stripe Checkout Session creation supports server-created sessions, `mode=payment`, server-supplied line items, `client_reference_id`, success URL, cancel URL, and metadata: https://docs.stripe.com/api/checkout/sessions/create
- Stripe webhook signature verification depends on the `Stripe-Signature` header and the unmodified raw request body: https://docs.stripe.com/webhooks/signature
- Stripe idempotency keys are intended for retryable `POST` requests and must not contain sensitive data: https://docs.stripe.com/api/idempotent_requests
- Stripe event types include Checkout completion/expiry, refunds, and dispute events relevant to fulfilment and revocation: https://docs.stripe.com/api/events/types
- Stripe refund guidance identifies refund event handling such as `refund.created`, `refund.updated`, `refund.failed`, and `charge.refunded`: https://docs.stripe.com/refunds
- Stripe dispute guidance confirms disputes are notified through webhooks and the API: https://docs.stripe.com/disputes/api

## Approval Gates Before Runtime

The next payment runtime PR must not start until these approvals are recorded in the PR or linked issue:

1. Approval to create local/sandbox Store order/payment ledger migrations.
2. Approval to add sandbox-only order creation and one-time Checkout runtime.
3. Approval of the exact Stripe test-mode Price binding strategy.
4. Approval of tax/receipt record boundaries for one-time digital goods.
5. Approval of webhook event retention and redaction rules.
6. Security review approval for idempotent fulfilment and refund/chargeback revocation.
7. Explicit confirmation that live checkout and issue #49 remain untouched.

No generic "continue" or broad approval is enough for live Stripe, Cloudflare, production D1, or issue #49 mutation.

## Authenticated Order Creation Contract

Future canonical endpoint:

```text
POST /api/store/orders
```

Purpose:

- Create one pending local DZN Store order for the authenticated player.
- Create a sandbox Stripe Checkout Session only after the local order exists.
- Return a redirect URL to Stripe Checkout when all Store checkout flags and sandbox checks pass.

Request body:

```json
{
  "productKey": "dzn-founding-supporter-pack",
  "priceId": "local_store_price_id",
  "supporterCardThemeKey": "signal-crown",
  "returnTo": "/store",
  "clientMutationId": "optional-client-generated-id"
}
```

Rules:

- The caller must be authenticated as a DZN player through the existing session model.
- The backend must derive the purchasing DZN user and Discord identity from the session. Request body account ids, user ids, Discord ids, owner ids, server ids, billing account ids, and entitlement ids are ignored or rejected.
- Only one item may be purchased per order in the first runtime slice. Quantity is fixed to `1`.
- `productKey` and `priceId` must resolve server-side to the active Store catalog and an active Store price row.
- The product must be account-bound, guaranteed-purchase, checkout-enabled, and `no_competitive_advantage = 1`.
- The product must not grant spins, XP, rank, discovery score, review score, event advantage, Server Wars advantage, CTF advantage, owner subscription access, server ownership, Nitrado access, or competitive eligibility.
- The selected price must belong to the selected product, be active at the time of order creation, use GBP unless a later tax/currency review approves more currencies, and have an immutable local amount snapshot.
- The selected Stripe Price id must be a server-side test-mode binding in sandbox. The request body must never be trusted for Stripe Price ids.
- The selected Supporter Card theme must be one of the product's approved previewable themes.
- The response must be no-store JSON and must not expose Stripe secrets, raw Discord ids, raw webhook ids, full payment method data, card data, tax internals, or private address data.

Feature gates before any Stripe call:

- `DZN_STORE_ENABLED=true`
- `DZN_STORE_CHECKOUT_ENABLED=true`
- `DZN_STORE_SANDBOX_CHECKOUT_ENABLED=true`
- `DZN_STORE_LIVE_CHECKOUT_ENABLED=false`
- `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=false` is allowed for checkout-session creation in the first sandbox slice, but then webhook processing must be ledger-only or disabled. Entitlements cannot be granted until the fulfilment flag is separately approved.
- Existing owner-subscription live checkout safety must remain no weaker than the current `DZN_LIVE_CHECKOUT_ENABLED` policy.

Success response:

```json
{
  "orderId": "local_store_order_id",
  "orderNumber": "DZN-STORE-20260827-000001",
  "status": "checkout_created",
  "checkoutSessionId": "cs_test_...",
  "checkoutUrl": "https://checkout.stripe.com/...",
  "expiresAt": "2026-08-27T12:00:00.000Z"
}
```

Required failures:

- `401` when unauthenticated.
- `403` when Store or checkout flags are disabled.
- `403` when a live Stripe mode or live Store checkout flag is requested without later live approval.
- `400` for unsupported product, price, theme, return URL, quantity, or payload shape.
- `409` for an existing unexpired checkout order for the same user/product/theme if the later implementation chooses duplicate-order suppression.
- `422` for any catalog/product/price row that violates the Fair Progression Boundary.
- `503` when Stripe sandbox configuration is incomplete.

## One-Time Stripe Checkout Session Shape

Future Store checkout must create a Stripe Checkout Session server-side only after the local order exists.

Required shape:

```text
mode = payment
line_items[0][price] = server-controlled Stripe test Price id
line_items[0][quantity] = 1
client_reference_id = local DZN Store order id or order number
success_url = DZN success route with opaque order reference only
cancel_url = safe DZN return route with opaque order reference only
metadata[dzn_context] = dzn_store
metadata[dzn_order_id] = local DZN Store order id
metadata[dzn_product_key] = selected product key
metadata[dzn_account_ref] = non-sensitive account reference or hash
payment_intent_data[metadata][dzn_order_id] = local DZN Store order id
payment_intent_data[metadata][dzn_context] = dzn_store
```

Required controls:

- Use `mode=payment`, not subscription mode.
- Use server-controlled Stripe test Price ids or server-calculated line item amounts only after the Stripe binding review approves the exact method.
- Use a Stripe idempotency key derived from the local order id, for example `dzn-store-order:{orderId}:checkout-v1`. Do not use email addresses, Discord ids, raw DZN user ids, names, or private identifiers as idempotency keys.
- Do not create, update, or archive Stripe Products or Prices in the checkout route.
- Do not store card numbers, CVC, bank details, or raw payment method details in DZN.
- Do not fulfil from the Checkout success redirect.
- Do not allow promotion codes unless a later pricing/governance slice explicitly approves how they interact with tax and immutable order snapshots.
- Do not allow a paid product to grant wheel spins or change wheel cooldowns.

## Webhook Event Ledger Contract

Future canonical Store webhook endpoint:

```text
POST /api/stripe/store-webhook
```

This route is not implemented by this preflight. When it is implemented, it must be separate from the existing owner subscription webhook or must route Store events through an explicitly isolated Store handler before side effects.

Required verification:

- Accept `POST` only.
- Require `STRIPE_WEBHOOK_SECRET` or a future store-specific sandbox webhook secret.
- Verify the `Stripe-Signature` header against the unmodified raw request body before parsing.
- Reject unsigned, altered, replayed, malformed, or unparseable events before ledger side effects.
- Never log the full raw webhook body, Stripe secret, signature secret, card data, billing address details, or private payment method details.

Ledger fields for future `store_payment_events`:

- Local event id.
- Unique `stripe_event_id`.
- Event type.
- Stripe API version.
- Livemode boolean.
- Received timestamp.
- Processed timestamp.
- Processing status: `received`, `processed`, `duplicate`, `ignored`, `failed`, `blocked_by_flag`.
- Related local order id when matched.
- Related Stripe Checkout Session id when present.
- Related Stripe PaymentIntent id when present.
- Related Stripe Charge id when present.
- Raw event SHA-256 hash.
- Sanitized summary JSON.
- Failure code/message suitable for owner/admin support without exposing private payment details.

Accepted event classes for the first future review:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `refund.created`
- `refund.updated`
- `refund.failed`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.closed`
- `charge.dispute.funds_withdrawn`
- `charge.dispute.funds_reinstated`

Fulfilment events must be matched to exactly one local Store order and exactly one purchasing DZN account before any entitlement is granted. Subscription events for owner billing must not be fulfilled by the Store handler.

Duplicate Stripe event ids must be side-effect-free. Unknown events may be recorded as ignored, but must not trigger fulfilment.

## Idempotent Fulfilment Rules

Future fulfilment must be server-side and webhook-driven.

Grant conditions:

- The event is verified.
- The event is recorded in `store_payment_events`.
- The event has not already been processed for side effects.
- The event is a fulfilment-approved Store event.
- The Store order exists.
- The Store order is for the same Stripe Checkout Session or PaymentIntent.
- The Store order is for the same purchasing account derived from the local order, not from a request body.
- The order amount, currency, product snapshot, price snapshot, and quantity match the expected local snapshot.
- The order status permits transition to `paid` or `fulfilled`.
- `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=true` in the environment approved for that slice.

Exactly-once controls:

- Insert `store_payment_events.stripe_event_id` under a unique constraint before side effects.
- Transition order states inside a database transaction when D1 transaction support and route shape allow it; otherwise use compare-and-set status updates plus uniqueness constraints.
- Use unique constraints on order id, entitlement source order id, Supporter Card user id, Supporter Card serial number, and any account-entitlement idempotency key.
- Treat already fulfilled orders as successful no-ops.
- Treat already issued Supporter Cards for the same qualifying account as successful no-ops when linked to the same qualifying order.
- Retry serial generation on uniqueness collision.
- Never issue more than one Founding Supporter Card per qualifying account.

Entitlement boundaries:

- Account entitlements are Store/cosmetic entitlements only.
- Store entitlements do not satisfy owner subscription entitlement checks.
- Store entitlements do not unlock `/setup`, Nitrado linking, owner onboarding, owner dashboards, owner APIs, server management, or server ownership.
- Cosmetic calling-card purchases must remain separate from earned calling-card awards.
- Store purchases cannot grant XP, earned challenge progress, badges, seasons, crowns, rankings, discovery, review score, events, CTF scoring, Server Wars scoring, public profile visibility, retained exports, moderation outcomes, or competitive eligibility.

## Refund, Reversal, And Chargeback Revocation Plan

Future revocation must be verified-webhook-driven and tied to the affected order/account only.

Required behavior:

- Full refund of a fulfilled Store order revokes the corresponding Store entitlement and Supporter Card state.
- Chargeback or dispute fund withdrawal immediately marks the affected entitlement/card as disputed or revoked according to the later support policy.
- Dispute closure with funds reinstated may move the entitlement/card back to active only after the same event-ledger and order-matching controls pass.
- Partial refunds require a separate product/refund policy review before automatic entitlement changes. Until then, partial refunds should move the order to admin review or blocked-by-policy.
- Failed refunds update payment-event status only; they must not revoke entitlements without a successful refund/reversal/dispute state.
- Revocation must never delete orders, order items, payment events, entitlement history, tax records, or Supporter Card audit rows.
- Revocation must not alter XP, earned calling cards, rankings, discovery, reviews, review score, badges, seasons, events, Server Wars, CTF, owner entitlement, server ownership, Nitrado access, public profile privacy settings, retained exports, moderation decisions, or competitive eligibility.

## Tax, Receipt, And Private Payment Record Boundaries

Future Store orders must preserve records needed for customer support, tax/VAT review, and payment reconciliation without storing card information.

Store privately:

- Order id and order number.
- Purchasing DZN account id.
- Product snapshot.
- Price snapshot.
- Currency.
- Subtotal, tax, and total minor-unit amounts.
- Checkout Session id.
- PaymentIntent id.
- Stripe customer id when needed for reconciliation.
- Provider receipt/reference ids or receipt URL when available.
- Terms version.
- Fulfilment status.
- Refund/reversal/dispute status.
- Sanitized webhook summaries and raw webhook hash.

Do not store in DZN:

- Card number.
- CVC.
- Full bank details.
- Raw payment method details.
- Raw webhook payload bodies.
- Stripe secret keys.
- Webhook signing secrets.
- Full billing address details unless a later tax review proves a minimum required private record.

Public routes must never expose:

- Stripe customer ids.
- PaymentIntent ids.
- Checkout Session ids.
- Webhook event ids.
- Billing address details.
- Tax internals.
- Private payment status.
- Refund/dispute evidence.
- Raw Discord ids or raw DZN account ids.

## Feature-Flag Defaults

This preflight adds no Cloudflare variables and no `cloudflare-env.d.ts` entries. The later sandbox checkout implementation must introduce flags only with default-disabled behavior.

| Flag | Default | Future purpose |
| --- | --- | --- |
| `DZN_STORE_ENABLED` | `false` | Allows Store read/runtime surfaces. |
| `DZN_STORE_CHECKOUT_ENABLED` | `false` | Allows any Store order-to-checkout path. |
| `DZN_STORE_SANDBOX_CHECKOUT_ENABLED` | `false` | Allows sandbox/test-mode Checkout only. |
| `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED` | `false` | Allows verified Store events to grant/revoke Store entitlements. |
| `DZN_SUPPORTER_CARDS_ENABLED` | `false` | Allows Supporter Card issuance/display code paths. |
| `DZN_EARNED_SPINS_ENABLED` | `false` | Allows trusted non-payment sources to mint earned spins. |
| `DZN_REWARD_WHEEL_ENABLED` | `false` | Allows player wheel spin runtime. |
| `DZN_STORE_ADMIN_ENABLED` | `false` | Allows admin catalog/pricing controls. |
| `DZN_STORE_LIVE_CHECKOUT_ENABLED` | `false` | Allows future Store live checkout only after explicit approval. |
| `NEXT_PUBLIC_DZN_STORE_ENABLED` | `false` | Allows public/client Store navigation and display. |

No flag may allow Store purchases to affect competitive or owner-access systems.

## Rollback Path

Future sandbox checkout rollback must be non-destructive:

1. Disable `DZN_STORE_CHECKOUT_ENABLED`.
2. Disable `DZN_STORE_SANDBOX_CHECKOUT_ENABLED`.
3. Disable `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED`.
4. Mark affected Store products/prices inactive for new orders.
5. Preserve orders, order items, payment events, entitlement rows, Supporter Card rows, tax records, and audit state.
6. Allow verified webhook receipt to continue only if ledger-only processing is explicitly approved; otherwise return a safe retryable or disabled response according to the later webhook policy.
7. Reprocess failed verified events only through an admin-approved replay command with duplicate-event and idempotency proof.
8. Use refunds/revocations for customer-impacting corrections instead of deleting ledger rows.
9. Keep live checkout disabled.
10. Keep issue #49 unchanged.

## Proof Matrix Before Runtime

| Area | Required proof before implementation is accepted |
| --- | --- |
| Authentication | Logged-out users receive `401`; request body user/account ids are ignored or rejected; entitlements attach only to the session-derived purchaser. |
| Feature flags | All Store checkout/write/fulfilment flags default false; disabled flags block before any Stripe call; no live checkout path is reachable. |
| Catalog integrity | Only active, account-bound, guaranteed, no-competitive-advantage products can be ordered; forbidden paid outcomes are rejected server-side. |
| Checkout creation | Local order exists before Stripe call; `mode=payment`; one item; quantity `1`; server-controlled price; safe return URL; no Stripe Product/Price mutation. |
| Stripe idempotency | Retry uses a non-sensitive order-derived idempotency key; repeated retry does not create multiple sessions or orders. |
| Webhook verification | Store webhook verifies `Stripe-Signature` against raw body before parsing and rejects altered payloads. |
| Event ledger | Duplicate Stripe event ids are side-effect-free; unknown events do not fulfil; raw event body is not stored. |
| Fulfilment | Success redirect does not grant; verified paid event fulfils exactly once; repeated events do not duplicate entitlements, cards, serials, cosmetics, notifications, or receipts. |
| Refunds and disputes | Refund/reversal/chargeback events revoke only the affected Store entitlement/card; partial refunds are blocked for policy review until approved. |
| Tax and receipts | Order snapshots preserve subtotal, tax, total, currency, terms version, and private provider references without storing card data. |
| Supporter Card | Serial numbers are unique; one active card per qualifying account; refund/chargeback revokes the correct card; no artificial rarity tiers. |
| Wheel isolation | Purchases cannot grant spins, bypass wheel cooldowns, alter daily spin allowance, alter reward odds, or change wheel outcomes. |
| Fair Progression Boundary | Store purchases cannot alter owner entitlement, server ownership, Nitrado access, XP, earned calling cards, rankings, discovery, reviews, badges, seasons, events, CTF, Server Wars, public profile visibility, retained exports, moderation decisions, or competitive eligibility. |
| Production safety | No Stripe live objects, Cloudflare secrets/config, production D1 writes, deployments, live checkout activation, or issue #49 changes occur in sandbox/runtime PRs unless explicitly approved in the active task. |

## Explicitly Blocked From This Preflight

The following names may appear in documentation and tests only. They must not be implemented by this branch:

- `POST /api/store/orders`
- `POST /api/stripe/store-webhook`
- `store_orders`
- `store_order_items`
- `store_payment_events`
- `account_entitlements`
- `supporter_cards`
- `earned_spins`
- `spin_ledger`
- `wheel_cooldowns`
- one-time Checkout Session creation
- webhook fulfilment
- Supporter Card issuance
- account entitlement writes
- earned spin writes
- wheel result generation
- Stripe object mutation
- Cloudflare secret/config mutation
- production D1 writes
- live checkout activation
- issue #49 mutation

## Next Recommended Slice

Next should be the DZN Store sandbox order ledger schema preflight/implementation slice only if deliberately approved: add local/sandbox-only `store_orders`, `store_order_items`, and `store_payment_events` migration drafts plus validation tests behind disabled-by-default Store checkout flags, with no checkout route, no Stripe Checkout Session creation, no webhook fulfilment, no account entitlement writes, no Supporter Card issuance, no earned-spin ledger, no wheel runtime, no Stripe object mutation, no Cloudflare secret/config mutation, no production D1 write, no live checkout activation, and no issue #49 change.
