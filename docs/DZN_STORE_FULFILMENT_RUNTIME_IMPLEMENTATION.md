# DZN Store Fulfilment Runtime Implementation

## Status And Boundary

This slice implements the deliberately approved disabled-by-default local/test DZN Store fulfilment runtime.

The runtime is disabled by default and remains unavailable unless every local/test Store flag is deliberately enabled for the current environment.

Runtime fulfilment is available only after a verified Stripe test-mode event has already passed the signed Store webhook receipt boundary at `POST /api/stripe/store-webhook`. The route still verifies the `Stripe-Signature` header against the unmodified raw body before parsing and still writes the immutable sanitized `store_payment_events` receipt row first.

The implementation adds:

- `functions/_lib/dzn-store-fulfilment.ts`
- A conditional call from `functions/_lib/dzn-store-webhook.ts` into the fulfilment helper only when `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=true`
- Focused runtime tests in `scripts/test-dzn-store-fulfilment-runtime-implementation.ts`

The default remains disabled. With `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED` absent or false, the Store webhook records only the sanitized receipt and returns `fulfilment: null`.

Only `checkout.session.completed` can grant a Store entitlement in this local/test runtime. PaymentIntent events do not fulfil alone.

This slice does not add, enable, create, mutate, or approve:

- No earned spins.
- No reward wheel runtime.
- No live checkout.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, or webhook endpoint mutation.
- No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.
- No Nitrado, Discord, analytics, tracking, AI provider credentials, vector stores, or metered model calls.
- No Account Purchases UI.
- No public Supporter Card reveal UI.
- No issue #49 change.

No Stripe Product/Price mutation, No Cloudflare config mutation, and No production D1 writes are allowed in this slice.

`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false. `DZN_STORE_LIVE_CHECKOUT_ENABLED` remains unset/false. Issue #49 remains reserved for final live checkout activation.

## Runtime Flag Contract

Fulfilment can process a verified Store receipt only when all required local/test conditions pass:

| Flag or condition | Required value |
| --- | --- |
| `DZN_STORE_SANDBOX_RUNTIME` | `local` or `test` |
| `DZN_STORE_ENABLED` | `true` |
| `DZN_STORE_CHECKOUT_ENABLED` | `true` |
| `DZN_STORE_SANDBOX_CHECKOUT_ENABLED` | `true` |
| `DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED` | `true` |
| `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED` | `true` |
| `DZN_SUPPORTER_CARDS_ENABLED` | `true` only when Supporter Card issuance is allowed |
| `DZN_EARNED_SPINS_ENABLED` | false or absent |
| `DZN_REWARD_WHEEL_ENABLED` | false or absent |
| `DZN_STORE_LIVE_CHECKOUT_ENABLED` | false or absent |
| `DZN_LIVE_CHECKOUT_ENABLED` | false or absent |
| `STRIPE_SECRET_KEY` | absent or `sk_test_...` only; no live secret accepted |
| `STRIPE_WEBHOOK_SECRET` | bounded `whsec_...` signing secret |

If the fulfilment flag is disabled, no fulfilment attempt row is created. If live checkout, a live Stripe secret, earned spins, or reward wheel runtime is enabled, fulfilment is blocked before account entitlements or Supporter Cards can be written.

## Write Scope

The implementation may write only these local/test Store fulfilment ledgers after a verified test-mode Store webhook event:

| Table | Runtime write |
| --- | --- |
| `store_payment_events` | Existing signed receipt insert only. The receipt blockers remain fixed to `0`. |
| `store_fulfilment_attempts` | One idempotent attempt row per payment event. |
| `store_orders` | Status/timestamp updates only for the matched local/test order. |
| `store_order_status_history` | Append-only status history. |
| `account_entitlements` | Exactly one account-bound cosmetic/supporter entitlement per fulfilled source order item. |
| `store_entitlement_status_history` | Append-only entitlement/card status history. |
| `supporter_cards` | Optional one Founding Supporter Card when product rules and `DZN_SUPPORTER_CARDS_ENABLED=true` qualify. |
| `store_refund_dispute_audit` | One sanitized refund/dispute audit row per relevant verified payment event. |

The runtime must not write:

- `store_products` or `store_prices`.
- `owner_billing_accounts`, `owner_plan_entitlements`, `server_subscriptions`, `server_owners`, `linked_servers`, or Nitrado tables.
- `earned_spins`, `spin_ledger`, `wheel_cooldowns`, or any reward wheel table.
- Ranking, discovery, review score, badges, seasons, events, CTF, Server Wars, XP, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility tables.

## Grant Event

`checkout.session.completed` is the only Store grant event in this slice.

It can fulfil only when:

- The Stripe signature is valid.
- `event.livemode === false`.
- The Checkout Session id starts with `cs_test_`.
- The object type is `checkout.session`.
- `mode === "payment"`.
- `status === "complete"`.
- `payment_status === "paid"`.
- The order resolves through Store receipt metadata or stored local/test provider references.
- The stored order is `checkout_created`, `payment_pending`, or already safely `paid`.
- The stored Checkout Session id matches.
- PaymentIntent id, when present on both sides, matches.
- Amount and currency match the immutable order/item snapshots.
- Product key, product type, fulfilment kind, selected Supporter theme, and terms version match the ledger.
- The source item is account-bound, guaranteed-purchase, and no-competitive-advantage.
- All paid-outcome flags remain zero.

`payment_intent.succeeded` remains a no-grant corroboration event. `checkout.session.async_payment_succeeded` remains disabled until delayed payment methods are separately approved.

## Entitlement And Card Rules

The runtime creates exactly one `account_entitlements` row per fulfilled `store_order_items.id`. The row attaches only to `store_orders.purchasing_user_id`, copies only safe product/type/fulfilment snapshots, stores the granting Store payment-event row, and keeps every no-advantage column fixed to zero.

Store account entitlements remain separate from owner Starter/Pro entitlements. They do not unlock owner setup, `/setup`, Nitrado linking, owner dashboards, owner APIs, server management, server ownership, or owner billing plans.

For one-time account-bound products, an existing non-revoked entitlement for the same purchasing user and entitlement key blocks any second entitlement/card grant. The affected order moves to `manual_review` and the runtime records the attempted duplicate rather than granting again.

For the DZN Founding Supporter Pack, the runtime may issue one `supporter_cards` row only when `DZN_SUPPORTER_CARDS_ENABLED=true`, the order item is the `dzn-founding-supporter-pack`, the fulfilment kind is `supporter_card`, a valid selected theme exists, and the account has no existing Founding Supporter Card. Generated serials use `DZN-SUP-######`, are retried on collision, and are never based on payment amount.

With `DZN_SUPPORTER_CARDS_ENABLED=false`, the order can still receive the safe private Store account entitlement, but no Supporter Card row is created.

## Refund And Dispute Rollback

The runtime handles these verified non-grant events without creating new entitlements:

- `charge.refunded`
- `refund.created`
- `refund.updated`
- `charge.dispute.created`
- `charge.dispute.closed`

Full refunds revoke only the affected Store account entitlement and linked Supporter Card and move the affected order to `refunded`. Partial refunds move the affected order to `manual_review` and do not silently revoke unrelated records.

`charge.dispute.created` moves only the affected Store order to `disputed` and suspends the affected Store entitlement/card. `charge.dispute.closed` with `status='lost'` revokes only the affected Store entitlement/card and moves the order to `revoked`. `status='won'` can restore only the affected Store item when the local order is still disputed and no local refund or revocation marker exists.

Rollback never deletes ledger rows and never touches earned progression, owner subscriptions, linked servers, rankings, discovery, reviews, events, Server Wars, CTF, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

## Privacy And Public Output

Webhook responses expose only receipt status, fulfilment status, reason codes, and boolean safety markers. They do not expose raw Stripe ids, customer ids, PaymentIntent ids, charge ids, refund ids, dispute ids, customer email, billing address, tax internals, payment method details, raw Discord ids, or internal DZN user ids.

The webhook records the sanitized receipt row before fulfilment runs. If fulfilment throws after the receipt write, the route returns `503 STORE_FULFILMENT_RUNTIME_FAILED` with `receipt_recorded: true` so the Stripe retry path remains explicit and no false success is reported.

The stored fulfilment summaries are sanitized JSON with provider-reference presence booleans, not raw payloads. The raw webhook body is not stored; only the existing SHA-256 hash remains in `store_payment_events`.

## Fair Progression Boundary

This runtime cannot affect:

- Owner billing plan status.
- Starter or Pro entitlement.
- `/setup`.
- Nitrado linking.
- Server ownership.
- Rankings.
- Discovery score.
- Reviews or review score.
- Badges, seasons, crowns, or earned reputation.
- Events, tournaments, brackets, joins, approvals, or CTF scoring.
- Server Wars scoring.
- ADM stats.
- Leaderboard formulas.
- Player XP awards.
- Earned calling-card awards.
- Public profile visibility.
- Retained exports.
- Moderation decisions.
- Competitive eligibility.

Store payments still cannot mint spins, improve wheel odds, bypass wheel cooldowns, or run the reward wheel.

## Validation Requirements

The required proof for this slice is:

- Disabled defaults: receipt-only and no fulfilment rows when fulfilment is off.
- Local/test-only gate: missing runtime, live checkout flags, live Stripe secret, earned-spins flag, or reward-wheel flag blocks fulfilment.
- Signature verification: invalid webhook signatures create no receipt or fulfilment writes.
- Eligible grant event: verified `checkout.session.completed` creates one safe account entitlement.
- Supporter Card gate: card is issued only when `DZN_SUPPORTER_CARDS_ENABLED=true`.
- Account-bound duplicate guard: an existing non-revoked same-account entitlement blocks a second one-time grant and moves the order to `manual_review`.
- Idempotency: duplicate Stripe retries do not duplicate attempts, order history, entitlements, or cards.
- Retry signal: fulfilment failure after a receipt insert returns a retryable `503` and does not silently report webhook success.
- Manual review: mismatched provider/order facts do not grant.
- PaymentIntent no-grant: `payment_intent.succeeded` cannot fulfil alone.
- Rollback: full refund and lost dispute revoke only the affected Store entitlement/card; dispute created suspends only the affected Store entitlement/card.
- Boundary scan: no earned-spin, reward-wheel, owner billing, Nitrado, Discord, analytics/tracking, live checkout, production D1, or issue #49 mutation path is added.

## Delivered Follow-On Preflight

The DZN Store fulfilment reconciliation/read-model preflight is now delivered in `docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md`. It defines future private Account Purchases and Entitlements read models, Supporter Card reveal/status UI contract, webhook replay/manual-review controls, and refund/dispute operator workflow.

It adds no public card reveal, account purchases route, admin replay route, manual-review route, refund/dispute operator route, notification, production migration apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change.

## Next Recommended Slice

Next should be the Store private Account Purchases and Entitlements read-model implementation approval slice, only if deliberately approved: add a disabled-by-default authenticated private read-only route for the current user's Store purchases, entitlements, and private Supporter Card status using sanitized ledgers only, while still adding no public Supporter Card reveal, no webhook replay route, no manual-review route, no refund/dispute operator route, no notifications, no production migration apply, no live checkout activation, no earned-spin ledger, no reward wheel runtime, no Stripe mutation, no Cloudflare config mutation, no production D1 write, and no issue #49 change.
