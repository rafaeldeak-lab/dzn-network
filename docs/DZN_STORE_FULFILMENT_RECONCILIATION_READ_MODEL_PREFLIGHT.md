# DZN Store Fulfilment Reconciliation/Read-Model Preflight

## Status And Boundary

This slice is approval preflight only.

It defines the future private Store fulfilment reconciliation, Account Purchases and Entitlements read model, Supporter Card reveal/status UI contract, webhook replay/manual-review controls, and refund/dispute operator workflow before any of those runtime surfaces are implemented.

This slice adds no customer or operator route.

No Account Purchases route is added.
No Entitlements route is added.
No Supporter Card reveal UI is added.
No public Supporter Card reveal UI is added.
No webhook replay route is added.
No manual-review operator route is added.
No refund/dispute operator route is added.
No notification is added.
No migration is added.
No production D1 migration apply is authorized.

The existing disabled-by-default local/test Store fulfilment runtime in `functions/_lib/dzn-store-fulfilment.ts` remains the latest implemented payment runtime boundary. This preflight does not widen that boundary.

This slice does not add, enable, create, mutate, or approve:

- No public card reveal.
- No account purchases route.
- No admin replay route.
- No notification.
- No production migration apply.
- No live checkout activation.
- No earned-spin ledger.
- No reward wheel runtime.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, or webhook endpoint mutation.
- No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.
- No Nitrado, Discord, analytics, tracking, AI provider credentials, vector stores, or metered model calls.
- No issue #49 change.

`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false. `DZN_STORE_LIVE_CHECKOUT_ENABLED` remains unset/false. Issue #49 remains reserved for final live checkout activation.

## Sources Checked

This preflight follows the same payment safety model as the existing Store checkout/webhook slices:

- Stripe webhook signature verification requires the unmodified raw body, `Stripe-Signature` header, and endpoint secret: https://docs.stripe.com/webhooks/signature
- Stripe Checkout fulfilment must be webhook-backed and idempotent because success-page redirects are not reliable fulfilment triggers: https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
- Stripe event types evolve over time and must be explicitly allowlisted before runtime handling: https://docs.stripe.com/api/events/types
- Refunds can be full or partial and need local reconciliation rather than broad entitlement deletion: https://docs.stripe.com/refunds
- Disputes and chargebacks have state changes that require local audit and reversible status handling: https://docs.stripe.com/disputes/how-disputes-work
- Future D1 reads and writes must use prepared statements and bound parameters: https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Any future local/test proof must stay in local D1 development until a separate production migration/apply approval exists: https://developers.cloudflare.com/d1/best-practices/local-development/

## Current Architecture Found

The Store payment sequence is currently split into isolated slices:

- Catalog/admin draft data and public Store preview exist separately from payment runtime.
- Sandbox order creation can create pending local/test Store orders only behind explicit flags.
- Sandbox Checkout Session creation can create only test-mode one-time Stripe Checkout Sessions after a pending owned order exists.
- Store webhook receipt handling verifies Stripe signatures and records sanitized test-mode `store_payment_events` receipt rows.
- Store fulfilment runtime can process verified local/test receipts only when `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=true`.

The latest runtime may write only Store fulfilment ledgers:

- `store_fulfilment_attempts`
- `store_order_status_history`
- `account_entitlements`
- `store_entitlement_status_history`
- Optional `supporter_cards`
- `store_refund_dispute_audit`

Store fulfilment remains separate from owner Starter/Pro billing, `/setup`, Nitrado linking, owner dashboards, server ownership, rankings, discovery, reviews, events, CTF, Server Wars, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, and competitive eligibility.

## Future Feature Flags

These are proposed future runtime flags only. This preflight must not add them to `cloudflare-env.d.ts`, `wrangler.toml`, Pages config, Workers config, or production secrets.

| Future flag | Default | Purpose |
| --- | --- | --- |
| `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED` | false | Allows an authenticated private account read model for purchases and entitlements. |
| `DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED` | false | Allows an authenticated private Supporter Card reveal/status UI after confirmed fulfilment. |
| `DZN_STORE_WEBHOOK_REPLAY_ENABLED` | false | Allows admin-only replay of already-recorded sanitized Store payment receipts. |
| `DZN_STORE_MANUAL_REVIEW_ENABLED` | false | Allows admin-only manual-review decisions for Store fulfilment exceptions. |
| `DZN_STORE_OPERATOR_REFUND_WORKFLOW_ENABLED` | false | Allows admin/operator workflow for refund/dispute reconciliation decisions. |

None of these flags may enable live checkout. None may bypass Stripe webhook verification, order reconciliation, or idempotent fulfilment. None may write earned spins or run the reward wheel.

## Private Account Purchases Read Model

The future private Account Purchases and Entitlements read model should be an authenticated user-owned read surface. A likely route is `GET /api/account/purchases`, with `GET /api/account/entitlements` considered only if splitting the read model makes the UI clearer.

The route must be private, no-store, and scoped by the current authenticated DZN user:

- Query `store_orders` where `purchasing_user_id` equals the authenticated user id.
- Join only the user's own `store_order_items`.
- Join only `account_entitlements` attached to those source order items or to the same user.
- Join `supporter_cards` only for the same user and source order item.
- Join status history only for displayable private state.
- Join sanitized payment-event state only where it belongs to the user's own order.

The read model may return:

- Purchase id or short public-safe reference.
- Product display name and product key.
- Product type and fulfilment kind.
- Guaranteed-purchase/account-bound/no-competitive-advantage labels.
- Order status such as draft, checkout_created, payment_pending, paid, manual_review, refunded, disputed, revoked, cancelled, or blocked.
- Entitlement status such as active, suspended, revoked, restored, or manual_review.
- Supporter Card status when relevant.
- Purchase time, fulfilled time, refund/dispute status, and terms version.
- Safe receipt availability such as "receipt available through Stripe email" or "DZN order recorded".

The read model must not return:

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
- Webhook raw bodies.
- Raw provider payload JSON.
- Operator notes that are not explicitly display-safe.
- Other users' purchases, entitlements, Supporter Cards, orders, or payment events.

The future API response should include an explicit `private: true`, `cache: "no-store"`, and `scope: "current_user"` style marker so UI tests can prove it is not a public profile or marketing surface.

## Supporter Card Reveal/Status UI Contract

The future Supporter Card reveal/status UI must be private first.

It may show a Supporter Card only when all of these are true:

- The viewer is authenticated as the same user attached to the card.
- `DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED=true`.
- The card came from a verified fulfilled Store order.
- The source product is the DZN Founding Supporter Pack.
- The related Store entitlement is active or restored.
- The Supporter Card is active or restored.

The private reveal may show:

- `DZN-SUP-######` serial number.
- Player display name.
- Supporter since date.
- Selected card theme.
- Generated insignia/cosmetic detailing.
- Account-bound label.
- Non-transferable/non-tradeable/non-resellable/non-redeemable label.
- No competitive advantage label.
- Current card and entitlement status.

The private reveal must not show:

- Payment amount as an artificial rarity signal.
- Payment method details.
- Billing address or tax internals.
- Raw Stripe identifiers.
- Refund/dispute provider payloads.
- Raw Discord ids.
- Any other player's Store records.

Public Supporter Card publishing remains out of scope. Badge visibility controls remain out of scope. A future public reveal must be a separate slice that proves player opt-in, privacy settings, hidden-state behavior, and no competitive impact.

## Webhook Replay Control Contract

Webhook replay is an admin-only recovery tool, not a customer action.

The future replay control may re-run the local Store fulfilment function against an already-recorded sanitized `store_payment_events` row only when:

- `DZN_STORE_WEBHOOK_REPLAY_ENABLED=true`.
- The actor has configured DZN admin/operator scope.
- The original receipt was test-mode or separately approved for live only after issue #49/live activation governance.
- The event passed original Stripe signature verification before it was recorded.
- The replay target has not been superseded by a newer refund, dispute, revocation, or manual-review block.
- The replay is idempotent and cannot duplicate entitlements or Supporter Cards.

The replay control must not invent webhook events, edit payment payloads, call Stripe to mutate resources, or grant based on a success-page redirect.

Because the raw webhook body is not stored, replay must be based on sanitized recorded facts and local order reconciliation unless a later approved design adds a secure Stripe retrieval step. Any future Stripe retrieval must be read-only, test-mode first, secret-gated, and separately reviewed.

Every future replay attempt must append an operator audit row with:

- Actor scope.
- Target payment event id or internal safe reference.
- Reason code.
- Attempted action.
- Result.
- Timestamp.
- Sanitized before/after status summary.

The audit row must not store raw payment provider payloads or card data.

## Manual Review Control Contract

Manual review handles Store fulfilment exceptions such as:

- Partial refunds.
- Amount/currency mismatch.
- Product snapshot mismatch.
- Selected theme mismatch.
- Existing one-time account-bound entitlement conflict.
- Suspicious repeated webhook retry failures.
- Dispute states that need operator judgement.
- Local order stuck in payment_pending or manual_review after verified receipts.

Future manual-review controls must be admin/operator-only, no-store, and isolated from public/player surfaces.

Allowed future actions may include:

- Hold in manual_review.
- Dismiss duplicate retry as already fulfilled.
- Mark as blocked with a safe reason.
- Restore only after a verified refund/dispute/order-state basis.
- Re-run fulfilment through the same idempotent runtime, never through a bespoke grant path.

Manual review must not:

- Create entitlements directly from a browser-only success redirect.
- Edit Stripe Products or Prices.
- Create refunds or close disputes in Stripe.
- Change owner Starter/Pro entitlements.
- Grant server ownership.
- Mint spins.
- Change reward odds.
- Award XP or calling cards.
- Affect competitive eligibility.

## Refund/Dispute Operator Workflow

The future refund/dispute operator workflow must build on `store_refund_dispute_audit` and status history. It must be a private admin/operator surface.

Recommended queue groupings:

- Full refund applied.
- Partial refund needs review.
- Chargeback/dispute opened.
- Dispute lost and entitlement revoked.
- Dispute won and eligible for restoration review.
- Local state conflict.
- Missing local order reference.

The workflow may show sanitized context:

- Internal order reference.
- Product display name.
- Order status.
- Entitlement/card status.
- Refund or dispute event type.
- Event timestamp.
- Safe amount/currency summary when displayable.
- Current automated decision.
- Required operator next step.

The workflow must not expose:

- Full provider payloads.
- Payment method data.
- Customer billing data.
- Raw Stripe identifiers in the browser.
- Other unrelated Store orders.
- Owner billing internals.
- Competitive/player scoring data.

Refund/dispute actions must append history and never delete ledger rows.

## Customer UX Contract

The future customer Account Purchases page should explain purchase state without implying that the success redirect is the source of truth.

Success-page redirects must remain read-only customer convenience surfaces. They must never grant, reveal, replay, restore, revoke, or manually approve Store entitlements by themselves.

Recommended customer states:

- `checkout_created`: Checkout has been started.
- `payment_pending`: Waiting for verified payment receipt.
- `paid`: Payment confirmed and entitlement active.
- `manual_review`: DZN is checking the Store order.
- `refunded`: Purchase refunded and entitlement/card revoked.
- `disputed`: Payment dispute opened and entitlement/card suspended.
- `revoked`: Entitlement/card revoked after refund, chargeback, or reversal.
- `blocked`: Store order blocked by safety rules.

The UI must keep these labels clear:

- Guaranteed purchase.
- Account-bound.
- No competitive advantage.
- Not transferable.
- Not redeemable for cash or account credit.
- Store cosmetics do not grant spins, XP, rankings, Server Wars advantage, event advantage, review/discovery advantage, owner access, or eligibility advantage.

The future customer page must remain private. It is not a public profile, not a Store marketing page, and not a public Supporter Card page.

## Operator UX Contract

The future operator queue should be built for traceability:

- Filter by order status.
- Filter by entitlement/card status.
- Filter by refund/dispute state.
- Filter by product key.
- Filter by fulfilment attempt status.
- Filter by created/updated date.
- Show safe status history.
- Show last automated reason code.
- Show next available operator action.
- Require a reason for any manual override.

Every operator action must be audit-backed and reversible only through a later audited status transition.

Owner users must not receive Store operator access through Starter or Pro. Store operator access requires configured DZN admin/operator authority, not owner billing entitlement.

## Testing Matrix For Future Implementation

A future implementation must prove:

- Logged-out users cannot read Account Purchases.
- A user cannot read another user's Store orders, entitlements, Supporter Cards, payment events, or status history.
- Account Purchases responses are private/no-store.
- Account Purchases responses do not include raw Stripe ids, customer email, billing address, payment method data, webhook raw body, raw Discord ids, or raw internal DZN user ids.
- The private Supporter Card reveal is hidden until card reveal is separately enabled.
- A revoked/suspended card is not shown as active.
- Public Supporter Card reveal is absent until a later approved public publishing slice.
- Webhook replay is admin-only and disabled by default.
- Manual review is admin-only and disabled by default.
- Refund/dispute operator workflow is admin-only and disabled by default.
- Replay/manual review uses the same idempotent fulfilment runtime and cannot duplicate entitlements/cards.
- Refund/dispute operator actions affect only Store entitlement/card rows for the linked source order item.
- Store reconciliation cannot alter owner billing, `/setup`, Nitrado linking, server ownership, rankings, discovery score, reviews, badges, seasons, events, Server Wars scoring, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.
- Store reconciliation cannot mint earned spins, grant spins, improve reward odds, bypass cooldowns, or run the reward wheel.
- Live checkout remains disabled and issue #49 remains untouched.

## Rollback Plan

This preflight is documentation and test-guard work only. Rollback is removal of:

- `docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md`
- `docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT_HANDOFF.md`
- `scripts/test-dzn-store-fulfilment-reconciliation-read-model-preflight.ts`
- The package script wiring for `test:dzn-store-fulfilment-reconciliation-read-model-preflight`
- The integration-document references added by this slice

No database rollback, Stripe rollback, Cloudflare rollback, Nitrado rollback, Discord rollback, or production data rollback is required because this slice performs no external service mutation and adds no migration.

## Next Recommended Slice

Next should be the Store private Account Purchases and Entitlements read-model implementation approval slice, only if deliberately approved: add a disabled-by-default authenticated private read-only route for the current user's Store purchases, entitlements, and private Supporter Card status using sanitized ledgers only, while still adding no public Supporter Card reveal, no webhook replay route, no manual-review route, no refund/dispute operator route, no notifications, no production migration apply, no live checkout activation, no earned-spin ledger, no reward wheel runtime, no Stripe mutation, no Cloudflare config mutation, no production D1 write, and no issue #49 change.

## Follow-On Implementation Status

The Store private Account Purchases and Entitlements read-model implementation is now delivered separately in `docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md`.

That follow-on slice adds `GET /api/account/purchases` behind `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED=false` by default. It is authenticated, private/no-store, current-user scoped, sanitized, local/test sandbox only, and read-only.

The follow-on implementation still adds no public Supporter Card reveal, no private Supporter Card reveal component, no webhook replay route, no manual-review route, no refund/dispute operator route, no notifications, no production migration apply, no live checkout activation, no earned-spin ledger, no reward wheel runtime, no Stripe mutation, no Cloudflare config mutation, no production D1 write, and no issue #49 change.
