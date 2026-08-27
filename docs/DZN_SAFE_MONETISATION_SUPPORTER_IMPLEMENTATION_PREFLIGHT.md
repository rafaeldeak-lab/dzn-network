# DZN Safe Monetisation And Supporter System Implementation Preflight

## Status And Boundary

This slice is implementation preflight only. It defines the real production sequence for the DZN Store, guaranteed supporter purchases, earned-only wheel spins, payment ledgers, webhook fulfilment, refund handling, admin pricing controls, rollback, and security proof.

This slice does not implement or mutate:

- One-time Stripe Checkout Sessions.
- Store, supporter, purchase, account-entitlement, or wheel routes.
- Payment webhook fulfilment for store orders.
- Supporter Card issuance.
- Earned-spin ledgers or wheel runtime.
- Account entitlement writes.
- Store/product/order/payment/spin database migrations.
- Stripe products, Prices, customers, sessions, refunds, or webhook endpoints.
- Cloudflare variables, secrets, bindings, Pages config, Workers config, or production D1.
- Nitrado, Discord, AI provider credentials, vector stores, analytics, tracking, or metered model calls.
- Live checkout activation or issue #49.

`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false. Issue #49 remains reserved for final live owner-subscription checkout activation unless a later explicitly approved payment-governance slice deliberately separates store go-live from owner-subscription go-live.

## Follow-On Store Slice Status

The follow-on DZN Store catalog and admin product/price draft model slice may add only `store_products`, `store_prices`, and local admin draft validation. The follow-on DZN Store public browse and Supporter Card preview contract may add only a disabled-by-default, read-only `/store` preview route backed by safe catalog metadata. These slices still must not add checkout creation, webhook fulfilment, Store purchase routes, account entitlement writes, Supporter Card issuance, earned spins, wheel runtime, Stripe product/Price mutation, Cloudflare secret mutation, production D1 writes, live checkout activation, or issue #49 changes.

The DZN Store sandbox order and checkout approval preflight is delivered as a documentation/test-guard slice in `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`. It narrows the future authenticated `POST /api/store/orders` contract, one-time Stripe Checkout Session shape, Store webhook event ledger, idempotent fulfilment rules, refund/chargeback revocation plan, tax/receipt records, feature-flag defaults, rollback path, and proof matrix. No checkout route, order table, payment webhook, entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change is added by the approval preflight.

The DZN Store sandbox order ledger schema slice is delivered in `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`. It adds `migrations/0072_dzn_store_order_ledger_schema.sql` as a local/sandbox-only schema step that allows only `store_orders`, `store_order_items`, and `store_payment_events`. The ledger schema remains fixed to `livemode = 0`, includes one-item order constraints, sanitized payment-event summaries, raw event hashes, and explicit no-fulfilment blockers. It still adds no checkout route, Stripe Checkout Session creation, Store webhook handler, webhook fulfilment, account entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change.

## Current DZN Architecture Found

DZN already has a subscription-oriented billing boundary for owner/server-management access:

- `lib/billing/plans.ts` is the public Starter/Pro plan contract and preserves legacy plan normalization.
- `functions/_lib/plans.ts` owns canonical billing readiness, checkout safety, entitlement normalization, Starter trial claims, and owner entitlement helpers.
- `functions/_lib/stripe.ts` contains the current Stripe API helpers, fixed API version, raw-body webhook verification, and timing-safe signature comparison.
- `functions/api/billing/create-checkout-session.ts` creates owner subscription checkout sessions for Starter/Pro only. Starter is a two-day trial then GBP 2/month. Pro is GBP 10/month.
- `functions/api/stripe/webhook.ts` verifies the Stripe webhook signature and updates owner billing/subscription state from subscription-oriented events.
- `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md` keeps live payment activation manual, explicit, and tied to issue #49.

The Safe Monetisation system must not weaken this owner billing boundary. Store entitlements are player/account cosmetics and supporter recognition only. They are not owner subscription plans and must not be read as proof of server-management access, Nitrado access, owner setup access, leaderboard advantage, discovery advantage, review advantage, event advantage, Server Wars advantage, XP award eligibility, calling-card award eligibility, or competitive eligibility.

## External Contract References

Future implementation should follow these current platform contracts:

- Stripe Checkout Sessions are created server-side and the server controls product inventory, availability, price, currency, and order metadata. Store checkout must use `mode=payment`, not subscription mode.
- Stripe webhook verification must use the `Stripe-Signature` header and the unmodified raw request body.
- Stripe idempotency keys apply to retryable `POST` requests and must not contain sensitive information.
- Stripe Tax or equivalent tax/VAT records must be considered before live checkout for one-time digital purchases.
- Cloudflare Workers/Pages implementation must keep request handling bounded, avoid leaking secrets in logs or responses, and retain enough safe observability to debug fulfilment without storing card data or private payment details.

References used for this preflight:

- https://docs.stripe.com/checkout/quickstart
- https://docs.stripe.com/webhooks/signature
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/tax
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/

## Product Decision

This design supersedes the earlier paid-spin idea.

Players must never be able to purchase spins directly or indirectly with real money, bought credits, Supporter Packs, subscriptions, bundles, or any other paid product. Spins are earned from legitimate DZN activity only.

Money may buy guaranteed, account-bound, non-transferable digital presentation items:

- DZN Founding Supporter Pack.
- Profile theme packs.
- Calling-card cosmetic packs.
- Chat and profile cosmetic packs.
- Group banner and insignia packs.
- Event presentation themes.

Purchases must never grant or influence:

- XP.
- Earned progression awards.
- Ranking, leaderboard, discovery, or review score.
- Better wheel reward odds.
- Additional spins.
- Tournament, bracket, event, CTF, or Server Wars advantage.
- Badge, season, crown, or competitive eligibility.
- Server ownership or owner subscription entitlement.

## Implementation Sequence

The later real production feature should be split into explicit high-risk payment PRs. Each step must preserve disabled-by-default flags until its own review proves the boundary.

1. Approval and sandbox preconditions:
   - Open a dedicated payment implementation issue or PR that names this preflight.
   - Confirm whether issue #49 still owns all live checkout activation or whether a new store-specific live activation issue is deliberately created.
   - Confirm Stripe test-mode account, webhook endpoint, and local/sandbox D1 target.
   - Confirm no production D1 migration, Cloudflare secret, Stripe live object, deployment, or checkout enablement is authorized by the implementation PR itself.

2. Catalog and admin draft schema:
   - Add migrations for product, price, and order metadata only.
   - Add admin-only draft catalog management behind disabled flags.
   - Seed no live products automatically.
   - Keep prices immutable once referenced by an order.
   - Keep product copy explicit: guaranteed purchase, account-bound, no competitive advantage.

3. Store browse and preview UI:
   - Add a premium `/store` read surface as a disabled-by-default preview contract first, and only later convert it to flag-enabled catalog browsing after payment runtime has separate approval.
   - Show exact product contents, price, currency, account receiving the item, account-bound label, no-competitive-advantage label, and purchase/refund terms.
   - Add Supporter Card preview theme selection before checkout.
   - Do not create checkout sessions yet unless the checkout flag is enabled in sandbox.

4. Order creation and one-time Checkout:
   - Add an authenticated order creation route after catalog tests pass.
   - Create a local `store_orders` record before requesting Stripe Checkout.
   - Create Stripe Checkout with `mode=payment`, server-side line items or server-controlled Price IDs, and a Stripe idempotency key derived from the local order id.
   - Redirect to Checkout only after the order is recorded.
   - Never grant an entitlement from the success-page redirect.
   - Live-mode Checkout remains blocked unless a future explicit store go-live approval enables the store live flag and the owner-subscription `DZN_LIVE_CHECKOUT_ENABLED` policy remains satisfied.

5. Webhook event ledger:
   - Verify the raw Stripe request body with `STRIPE_WEBHOOK_SECRET` before parsing.
   - Insert each provider event by unique `stripe_event_id` before side effects.
   - Record event type, livemode, API version, receive time, processing state, related order id, raw event hash, and sanitized summary.
   - Treat duplicate events as already received and side-effect-free.
   - Use bounded logs that never include secret values, card details, full customer payment information, raw payload bodies, or personally unnecessary identifiers.

6. Idempotent fulfilment:
   - Fulfil only from verified payment events and only after the local order matches the Stripe session/payment intent and expected account.
   - Attach account entitlements exactly once using database uniqueness and idempotent update logic.
   - Issue the Supporter Card exactly once per qualifying account.
   - If the order was already fulfilled, return success without duplicating entitlements, serials, cosmetics, emails, or notifications.
   - Save immutable product and price snapshots on the order so later admin price changes cannot rewrite completed purchases.

7. Supporter Card issuance:
   - Generate unique serials in the `DZN-SUP-######` format.
   - Use a database uniqueness constraint and retry on collision.
   - Store display name snapshot, supporter-since date, selected theme, insignia seed/hash or generated insignia metadata, visibility state, and revocation state.
   - Keep one active card per qualifying account.
   - Do not create artificial rarity tiers from payment amount.
   - Allow public badge hiding through profile display settings without removing the private entitlement.

8. Earned-spin award ledger:
   - Add `earned_spins` only from trusted, non-payment activity sources.
   - Reject any paid product, order item, subscription, bundle, admin pricing action, refund event, or checkout event that attempts to grant spins.
   - Add source deduplication keys so the same challenge/event/activity fact cannot mint repeated spins.
   - Keep spins account-bound and non-transferable.

9. Wheel runtime:
   - Enforce maximum three total spins in any rolling 24-hour period server-side.
   - Enforce minimum four-hour cooldown server-side.
   - Generate spin results server-side from the active reward pool.
   - Record reward pool version, outcome, probability snapshot, source, timestamp, and earned-spin id in `spin_ledger`.
   - Every spin returns a configured account-bound reward. No empty or lost spins.
   - Display the complete reward pool and probabilities before spinning.
   - Do not use fake near misses, jackpots, spending prompts, pressure copy, cash-equivalent rewards, or redeemable prizes.

10. Account purchases and entitlements:
   - Add a private account section that shows purchase status, order numbers, product snapshots, fulfilment state, receipts/reference ids, entitlement state, Supporter Card state, and refund/chargeback state.
   - Public profile or chat display reads only visibility-safe cosmetic state.
   - Private payment details, Stripe customer ids, payment intent ids, raw event ids, billing address details, and tax internals must not appear in public routes.

11. Refund, reversal, and chargeback handling:
   - Handle refund/dispute/reversal provider events through the same verified event ledger.
   - Revoke the correct account entitlement and Supporter Card state without deleting the immutable order/payment audit.
   - Preserve tax/accounting records required for reconciliation.
   - Do not revoke unrelated earned progression, challenge progress, rankings, reviews, public profile privacy settings, or owner subscription state.

12. Admin pricing and availability:
   - Restrict catalog/price/product availability controls to configured DZN admins.
   - Price changes create new active price rows and end-date old rows; they do not mutate completed order snapshots.
   - Admins may pause products and disable checkout through flags or product status.
   - Product validation must reject any fulfilment kind that grants spins, XP, ranking, discovery score, review score, badge/season awards, event outcomes, CTF outcomes, Server Wars scoring, or owner subscription access.

13. Live activation review:
   - Run sandbox checkout, webhook, fulfilment, refund, duplicate-event, and rollback tests.
   - Complete a security review and tax/receipt review.
   - Confirm issue #49 remains reserved for owner-subscription live checkout or explicitly open a separate store live activation issue.
   - Only then consider live Stripe object creation, Cloudflare secret setup, production D1 migration apply, deployment, and store checkout enablement.

## Feature-Flag Defaults

No new Cloudflare variables or `cloudflare-env.d.ts` entries are added by this preflight. The later implementation should introduce these flags with default disabled behavior:

| Flag | Default | Purpose |
| --- | --- | --- |
| `DZN_STORE_ENABLED` | `false` | Allows public/private store read surfaces. |
| `DZN_STORE_CHECKOUT_ENABLED` | `false` | Allows any store checkout creation path. |
| `DZN_STORE_SANDBOX_CHECKOUT_ENABLED` | `false` | Allows test-mode store checkout in sandbox only. |
| `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED` | `false` | Allows verified payment events to fulfil store orders. |
| `DZN_SUPPORTER_CARDS_ENABLED` | `false` | Allows Supporter Card display and issuance code paths. |
| `DZN_EARNED_SPINS_ENABLED` | `false` | Allows trusted non-payment sources to mint earned spins. |
| `DZN_REWARD_WHEEL_ENABLED` | `false` | Allows player wheel spin runtime. |
| `DZN_STORE_ADMIN_ENABLED` | `false` | Allows admin catalog/pricing controls. |
| `DZN_STORE_LIVE_CHECKOUT_ENABLED` | `false` | Allows future store live checkout only after explicit live approval. |
| `NEXT_PUBLIC_DZN_STORE_ENABLED` | `false` | Allows client navigation/display for the store. |

Flag rules:

- Disabling `DZN_STORE_CHECKOUT_ENABLED` must block order-to-Checkout creation before any Stripe call.
- Disabling `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED` may still record verified payment events for sandbox audit, but must not grant entitlements.
- Disabling `DZN_REWARD_WHEEL_ENABLED` must block spin consumption before any result is generated.
- No flag may make purchases affect competitive systems.
- Store live checkout must be separate from and no weaker than the existing `DZN_LIVE_CHECKOUT_ENABLED` policy.

## Canonical Data Model

These are migration shapes for later review only. Do not add or apply them in this preflight.

### `store_products`

- `id TEXT PRIMARY KEY`
- `product_key TEXT NOT NULL UNIQUE`
- `name TEXT NOT NULL`
- `description TEXT NOT NULL`
- `product_type TEXT NOT NULL CHECK (product_type IN ('supporter_pack','profile_theme','calling_card_pack','chat_cosmetic_pack','group_branding_pack','event_presentation_theme'))`
- `fulfilment_kind TEXT NOT NULL CHECK (fulfilment_kind IN ('supporter_card','cosmetic_entitlement','profile_frame','chat_badge','theme_pack','event_theme'))`
- `active INTEGER NOT NULL DEFAULT 0`
- `metadata_json TEXT NOT NULL DEFAULT '{}'`
- `created_by TEXT`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

No product type or fulfilment kind may grant spins, XP, ranking advantage, discovery advantage, review advantage, event advantage, Server Wars advantage, CTF advantage, owner subscription access, or competitive eligibility.

### `store_prices`

- `id TEXT PRIMARY KEY`
- `product_id TEXT NOT NULL REFERENCES store_products(id)`
- `currency TEXT NOT NULL DEFAULT 'gbp'`
- `unit_amount_minor INTEGER NOT NULL CHECK (unit_amount_minor >= 0)`
- `min_amount_minor INTEGER`
- `allow_pay_what_you_want INTEGER NOT NULL DEFAULT 0`
- `stripe_price_id TEXT UNIQUE`
- `effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `effective_to TEXT`
- `active INTEGER NOT NULL DEFAULT 0`
- `created_by TEXT`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

Recommended indexes: active product/price lookup by `product_id`, `active`, `effective_from`; unique active Stripe Price id where present. Referenced price rows are immutable.

### `store_orders`

- `id TEXT PRIMARY KEY`
- `order_number TEXT NOT NULL UNIQUE`
- `purchasing_user_id TEXT NOT NULL`
- `purchasing_discord_id TEXT`
- `status TEXT NOT NULL CHECK (status IN ('draft','checkout_created','paid','fulfilled','refunded','revoked','cancelled','expired','failed'))`
- `currency TEXT NOT NULL DEFAULT 'gbp'`
- `subtotal_amount_minor INTEGER NOT NULL DEFAULT 0`
- `tax_amount_minor INTEGER NOT NULL DEFAULT 0`
- `total_amount_minor INTEGER NOT NULL DEFAULT 0`
- `selected_theme_key TEXT`
- `stripe_checkout_session_id TEXT UNIQUE`
- `stripe_payment_intent_id TEXT UNIQUE`
- `stripe_customer_id TEXT`
- `immutable_price_snapshot_json TEXT NOT NULL`
- `terms_version TEXT NOT NULL`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `paid_at TEXT`
- `fulfilled_at TEXT`
- `refunded_at TEXT`
- `revoked_at TEXT`

Recommended indexes: `purchasing_user_id`, `status`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `created_at`.

### `store_order_items`

- `id TEXT PRIMARY KEY`
- `order_id TEXT NOT NULL REFERENCES store_orders(id)`
- `product_id TEXT NOT NULL REFERENCES store_products(id)`
- `price_id TEXT NOT NULL REFERENCES store_prices(id)`
- `quantity INTEGER NOT NULL CHECK (quantity = 1)`
- `unit_amount_minor INTEGER NOT NULL`
- `tax_amount_minor INTEGER NOT NULL DEFAULT 0`
- `total_amount_minor INTEGER NOT NULL`
- `item_snapshot_json TEXT NOT NULL`

Recommended indexes: `order_id`, `product_id`, `price_id`.

### `store_payment_events`

- `id TEXT PRIMARY KEY`
- `stripe_event_id TEXT NOT NULL UNIQUE`
- `event_type TEXT NOT NULL`
- `api_version TEXT`
- `livemode INTEGER NOT NULL DEFAULT 0`
- `received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `processed_at TEXT`
- `processing_status TEXT NOT NULL CHECK (processing_status IN ('received','processed','duplicate','ignored','failed'))`
- `related_order_id TEXT REFERENCES store_orders(id)`
- `raw_event_sha256 TEXT NOT NULL`
- `sanitized_summary_json TEXT NOT NULL`

Recommended indexes: `event_type`, `processing_status`, `related_order_id`, `received_at`.

### `account_entitlements`

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `entitlement_key TEXT NOT NULL`
- `source_order_id TEXT NOT NULL REFERENCES store_orders(id)`
- `source_product_key TEXT NOT NULL`
- `status TEXT NOT NULL CHECK (status IN ('active','hidden','revoked'))`
- `granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `revoked_at TEXT`
- `revoke_reason TEXT`
- `visibility_state TEXT NOT NULL DEFAULT 'visible' CHECK (visibility_state IN ('visible','hidden'))`
- `UNIQUE(user_id, entitlement_key, source_order_id)`

These are store/account cosmetics only. They are not owner subscription entitlements.

### `supporter_cards`

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL UNIQUE`
- `entitlement_id TEXT NOT NULL UNIQUE REFERENCES account_entitlements(id)`
- `serial_number TEXT NOT NULL UNIQUE`
- `display_name_snapshot TEXT NOT NULL`
- `supporter_since TEXT NOT NULL`
- `selected_theme_key TEXT NOT NULL`
- `insignia_seed_hash TEXT NOT NULL`
- `generated_insignia_json TEXT NOT NULL`
- `visibility_state TEXT NOT NULL DEFAULT 'visible' CHECK (visibility_state IN ('visible','hidden'))`
- `issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `revoked_at TEXT`

The serial format should be `DZN-SUP-######`. Issuance must retry on uniqueness collisions and must be idempotent per account.

### `earned_spins`

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `source_type TEXT NOT NULL CHECK (source_type IN ('daily_activity','challenge','community_mission','event','account_milestone','free_promotion'))`
- `source_id TEXT NOT NULL`
- `available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `expires_at TEXT`
- `consumed_at TEXT`
- `source_deduplication_key TEXT NOT NULL UNIQUE`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

Paid source types are not allowed.

### `spin_ledger`

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `earned_spin_id TEXT NOT NULL UNIQUE REFERENCES earned_spins(id)`
- `source_type TEXT NOT NULL`
- `reward_key TEXT NOT NULL`
- `reward_pool_version TEXT NOT NULL`
- `probability_snapshot_json TEXT NOT NULL`
- `result_seed_hash TEXT NOT NULL`
- `spun_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

Recommended indexes: `user_id`, `spun_at`, `reward_key`.

### `wheel_cooldowns`

- `user_id TEXT PRIMARY KEY`
- `rolling_24h_window_started_at TEXT NOT NULL`
- `spin_count_24h INTEGER NOT NULL DEFAULT 0`
- `last_spin_at TEXT`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

The write path must enforce the rolling 24-hour cap and four-hour cooldown with database-backed checks so concurrent requests cannot bypass limits.

## Payment And Webhook Contract

Future one-time checkout must be distinct from owner subscription checkout:

- Owner setup billing remains Starter/Pro subscription billing.
- Store checkout is account/player purchase billing with `mode=payment`.
- Store orders do not unlock `/setup`, Nitrado linking, owner onboarding, server management APIs, or owner dashboards.
- Owner subscription entitlements do not mint spins or store cosmetics.

Webhook processing rules:

- Accept only `POST`.
- Require `STRIPE_WEBHOOK_SECRET`.
- Verify signature before parsing.
- Preserve raw body for signature verification.
- Reject unsigned, altered, or unparseable events.
- Record a unique payment event before side effects.
- Match every fulfilment event to one local order and one purchasing account.
- Ignore or record-but-do-not-fulfil unrelated subscription events in the store handler.
- Revoke on refund, reversal, or chargeback events only for the affected order/account entitlement.

Relevant future Stripe events for review:

- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.closed`

The exact accepted event set should be confirmed during implementation against the Stripe Checkout configuration used for one-time digital goods.

## Admin Pricing Rules

Admin product/pricing controls must be private and scoped to configured DZN admins:

- Completed orders keep immutable product/price snapshots.
- Price updates create new rows; they do not rewrite historic order rows.
- Product availability can pause new purchases without deleting prior entitlements or audit rows.
- A product cannot be configured to grant XP, spins, rank, discovery score, review score, badges, seasons, event outcomes, Server Wars scoring, CTF scoring, owner subscription access, or competitive eligibility.
- The Founding Supporter price is admin-configurable before purchase.
- Pay-what-you-want above a minimum is future-only and must not create artificial rarity tiers or better recognition based on amount paid.

## Tax, Receipts, And Payment Data Boundaries

Future implementation must be tax/VAT compatible before live checkout:

- Store amount, currency, tax amount, total amount, order status, product snapshot, price snapshot, terms version, and provider receipt/reference ids.
- Do not store card numbers, CVC, bank details, raw payment method details, or full raw provider payload bodies in DZN.
- Keep public routes free of Stripe customer ids, payment intent ids, webhook event ids, invoice internals, address details, and private payment state.
- Keep receipt and purchase history private to the purchasing account and authorized DZN admins.
- Tax handling must be reviewed before production activation, especially for digital goods and UK/EU VAT handling.

## Fair Progression Boundary

The implementation must prove that Store, Supporter, and Wheel systems cannot write or influence:

- `owner_billing_accounts`
- `owner_plan_entitlements`
- `server_subscriptions`
- `server_owners`
- server rankings
- discovery score
- reviews or review score
- badges, seasons, crowns, or earned reputation
- events, tournaments, brackets, join decisions, or CTF scoring
- Server Wars scoring
- ADM stats, leaderboard formulas, or player rankings
- XP awards
- earned calling-card awards
- public profile privacy settings
- retained exports
- competitive eligibility

Cosmetic calling-card packs must remain separate from earned calling-card awards. A paid cosmetic pack may grant only display cosmetics explicitly advertised before purchase.

## Rollback Plan

Rollback must be non-destructive:

- Disable `DZN_STORE_CHECKOUT_ENABLED` first to stop new sessions.
- Disable `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED` to stop new fulfilment while preserving event receipt if needed.
- Mark affected products inactive.
- Leave orders, payment events, entitlement history, and tax records intact.
- Reprocess failed verified events only through an approved replay command with idempotency proof.
- Use refunds/revocations for customer-impacting reversals instead of deleting ledger rows.
- Keep migrations forward-compatible; do not drop audit tables in emergency rollback.
- Keep live checkout disabled until a separate go-live review confirms recovery.

## Security Proof Required Before Runtime

Before any runtime payment or wheel implementation ships, tests must prove:

- Players cannot buy spins directly.
- Paid products, subscriptions, bundles, refunds, and admin price changes cannot mint spins.
- Purchases cannot bypass the three-per-24-hour spin cap.
- Purchases cannot bypass the four-hour spin cooldown.
- Concurrent spin requests cannot consume extra spins or create duplicate ledger rows.
- Wheel outcomes are generated server-side and recorded once.
- Displayed reward probabilities match the active server reward pool.
- Payment webhooks cannot fulfil the same order twice.
- Duplicate Stripe events are side-effect-free.
- Store entitlements attach only to the purchasing account.
- Success-page redirects do not grant entitlements.
- Supporter serial numbers are unique and idempotent.
- Refunds, reversals, and chargebacks revoke only the correct entitlement/card.
- Private payment information is never exposed publicly.
- Admin price changes cannot alter completed orders.
- Store purchases cannot alter XP, rankings, scoring, reviews, discovery, badges, seasons, events, Server Wars, CTF scoring, public profile visibility, retained exports, owner entitlement, server ownership, or competitive eligibility.

## This Slice's Test Contract

This preflight branch should include a focused test that proves:

- The preflight doc exists and contains the implementation sequence, migration shapes, flags, webhook contract, rollback plan, and proof matrix.
- The master platform spec, public access policy, and Safe Monetisation backlog point to this preflight.
- No store/supporter/wheel runtime route, component, library, or migration file is added.
- No store/supporter/wheel feature flag is added to `cloudflare-env.d.ts` or wrangler config yet.
- Existing Stripe webhook verification still uses the raw request body and signature helper.
- Package scripts wire the focused preflight guard into the full test chain.

After the follow-on catalog, public preview, checkout approval, and sandbox order ledger schema slices, that guard should remain active but explicitly allow only the catalog migration/helper files named above, `app/store/page.tsx`, `components/store/dzn-store-preview-page.tsx`, and the local/sandbox-only `migrations/0072_dzn_store_order_ledger_schema.sql`. It must continue to reject Store APIs, checkout routes, Stripe Checkout Session creation, Store webhook handlers, webhook fulfilment, account entitlements, supporter-card issuance, earned spins, wheel cooldowns, purchase Store UI, Stripe product/Price mutation, Cloudflare config changes, production D1 writes, live checkout activation, and issue #49 changes.

## Next Recommended Slice

DZN Store public browse and Supporter Card preview contract: delivered as a read-only preview contract slice that may show safe catalog metadata and Supporter Card preview copy while checkout stays disabled.

The next payment-facing step must be a DZN Store sandbox order and checkout approval preflight: define the exact authenticated order-creation route contract, one-time Stripe Checkout Session shape, webhook event ledger, idempotent fulfilment rules, refund/chargeback revocation plan, tax/receipt records, feature-flag defaults, rollback path, and proof matrix before any checkout route, order table, payment webhook, entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change is implemented.

That approval preflight is now delivered in `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`. The next implementation step should be the DZN Store sandbox order ledger schema preflight/implementation slice only if deliberately approved: add local/sandbox-only `store_orders`, `store_order_items`, and `store_payment_events` migration drafts plus validation tests behind disabled-by-default Store checkout flags, with no checkout route, no Stripe Checkout Session creation, no webhook fulfilment, no account entitlement writes, no Supporter Card issuance, no earned-spin ledger, no wheel runtime, no Stripe object mutation, no Cloudflare secret/config mutation, no production D1 write, no live checkout activation, and no issue #49 change.

That ledger schema slice is now delivered in `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md` and `migrations/0072_dzn_store_order_ledger_schema.sql`. The next Store payment step should be the DZN Store sandbox order creation route approval slice only if deliberately approved: define and, after approval, add a disabled-by-default authenticated route that can write pending sandbox order rows only in local/test when Store sandbox flags are explicitly enabled. It must still create no Stripe Checkout Sessions, process no Store webhooks, grant no entitlements, issue no Supporter Cards, mint no earned spins, run no wheel, mutate no Stripe objects, mutate no Cloudflare secrets/config, write no production D1, enable no live checkout, and change no issue #49.
