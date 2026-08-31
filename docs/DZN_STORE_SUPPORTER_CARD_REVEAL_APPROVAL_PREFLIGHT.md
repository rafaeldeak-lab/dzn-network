# DZN Store Supporter Card Reveal Approval Preflight

## Status And Boundary

This slice is approval preflight only. It defines the private Supporter Card reveal contract that a later deliberately approved implementation must satisfy before any card reveal route or card reveal UI is added.

This slice adds no runtime reveal surface. It does not add, enable, create, mutate, or approve:

- No card reveal route.
- No private Supporter Card reveal component.
- No public Supporter Card reveal.
- No card-art generation.
- No generated card-art storage.
- No sharing controls.
- No screenshot/download/export action.
- No notification route or notification writes.
- No Store webhook replay route.
- No manual-review route.
- No refund/dispute operator route.
- No migration.
- No production migration apply.
- No live checkout activation.
- No earned-spin ledger.
- No reward wheel runtime.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, webhook endpoint, or API mutation.
- No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.
- No Nitrado, Discord, analytics, tracking, AI provider credentials, vector stores, or metered model calls.
- No issue #49 change.

`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false. `DZN_STORE_LIVE_CHECKOUT_ENABLED` remains unset/false. Issue #49 remains reserved for final live checkout activation.

The personal player page/nav button remains a separate player UX slice and is not changed by this Store reveal preflight.

## Architecture Found

The Store payment track currently has these relevant pieces:

- `migrations/0072_dzn_store_order_ledger_schema.sql` defines local/sandbox Store order and payment-event ledgers.
- `migrations/0073_dzn_store_fulfilment_ledger_schema.sql` defines local/test-only account entitlement, Supporter Card, fulfilment attempt, order-status-history, entitlement-status-history, and refund/dispute audit schema.
- `functions/_lib/dzn-store-fulfilment.ts` can issue one sandbox Supporter Card row only after verified test-mode Store fulfilment and only when `DZN_SUPPORTER_CARDS_ENABLED=true`.
- `GET /api/account/purchases` is the only current private customer Store read model. It is disabled by default, authenticated, private/no-store, current-user scoped, local/test only, sanitized, and read-only.
- `/account/purchases` consumes only `GET /api/account/purchases` and declares `data-supporter-card-reveal="blocked"`.

The current read model intentionally returns private Supporter Card status only:

- `private_reveal_available: false`
- `public_reveal_available: false`
- `reveal_blocked_reason: "supporter_card_reveal_requires_future_approved_slice"`

It does not return Supporter Card serial numbers, raw Supporter Card ids, raw entitlement ids, raw order ids, Stripe ids, payment method details, raw webhook payloads, raw Discord ids, `insignia_seed_hash`, or `generated_insignia_json`.

The existing schema contains sensitive card fields such as `serial_number`, `insignia_seed_hash`, and `generated_insignia_json`. A future reveal implementation must never expose those through the general Account Purchases read model. It must use a separate account-owned reveal contract with explicit redaction, visibility, audit, and rollback proof.

## Official References

The future implementation must continue to follow the same primary-source payment and storage boundaries already used by the Store payment track:

- Stripe webhook signatures: https://docs.stripe.com/webhooks/signature
- Stripe Checkout fulfilment guidance: https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
- Stripe idempotent requests: https://docs.stripe.com/api/idempotent_requests
- Stripe refunds: https://docs.stripe.com/refunds
- Stripe disputes: https://docs.stripe.com/disputes/how-disputes-work
- Cloudflare D1 prepared statements: https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Cloudflare D1 local development: https://developers.cloudflare.com/d1/best-practices/local-development/

The important implementation consequences are:

- Webhook-confirmed fulfilment remains the only source of card issuance.
- Success-page redirects must never grant, reveal, or repair purchases by themselves.
- Idempotency and unique ledger constraints must remain the source of duplicate-event safety.
- D1 queries that locate private card rows must use prepared statements with bound account/card references.

## Future Private Reveal Contract

The first future reveal implementation, if deliberately approved later, should add a private current-user reveal path only. The proposed route contract is:

- Method: `GET` only.
- Proposed path: `GET /api/account/supporter-cards/[cardRef]/reveal`.
- Caller: authenticated DZN session only.
- Scope: current user only.
- Cache: `Cache-Control: private, no-store`.
- Cookie behavior: `Vary: Cookie`.
- Runtime: local/test Store sandbox only until live Store activation is separately approved.
- Input reference: an opaque, display-safe `cardRef` or existing `purchase_ref`, never raw `supporter_cards.id`, raw `account_entitlements.id`, raw `store_orders.id`, raw `store_order_items.id`, raw `users.id`, raw Discord id, Stripe id, email, or serial number.
- Output: JSON only.

The future route must require all of these runtime gates before returning any reveal payload:

- `DZN_STORE_ENABLED=true`
- `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED=true`
- `DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED=true`
- `DZN_STORE_SANDBOX_RUNTIME=local` or `DZN_STORE_SANDBOX_RUNTIME=test`
- `DZN_LIVE_CHECKOUT_ENABLED` absent/false
- `DZN_STORE_LIVE_CHECKOUT_ENABLED` absent/false
- `DZN_EARNED_SPINS_ENABLED` absent/false
- `DZN_REWARD_WHEEL_ENABLED` absent/false

The future route must return:

- `401` for no authenticated session.
- `404` for a missing card, a card owned by another account, a raw/private identifier probe, or a card outside the active local/test ledger scope.
- `403` or `409` for disabled flags, suspended/revoked/manual-review card status, unsafe Store runtime flags, or live-checkout blockers.
- `200` only when the authenticated user owns the order, order item, entitlement, and Supporter Card row, and the card is active or hidden but still privately viewable by that same owner.

The future successful response may include only:

- A display-safe card reference.
- The formatted Supporter Card serial number.
- Card type label, such as `DZN Founding Supporter`.
- Display name snapshot chosen for the card.
- Supporter-since date.
- Selected theme key and theme display label.
- Visibility state.
- Issued/suspended/revoked timestamps where relevant.
- Card status.
- Renderer-safe visual tokens that cannot be reversed into raw seeds or payment data.
- An approved static or generated card image URL only if a later card-art storage/generation slice has separately approved that asset contract.
- A card-image alt text string that contains only already-visible card display fields.
- Explicit safety booleans proving no billing, ranking, scoring, XP, event, review, badge, season, Server Wars, CTF, public-profile, wheel, notification, analytics, tracking, or eligibility effect.

The future successful response must not include:

- Raw `supporter_cards.id`.
- Raw `account_entitlements.id`.
- Raw `store_orders.id`.
- Raw `store_order_items.id`.
- Raw `store_payment_events.id`.
- Raw `users.id`.
- Raw Discord ids.
- Stripe ids.
- Payment method data.
- Customer email.
- Billing address.
- Webhook raw body.
- Raw provider payload.
- Operator notes.
- `insignia_seed_hash`.
- `generated_insignia_json`.
- Any other user's purchase, entitlement, payment, fulfilment, or Supporter Card rows.

## Serial And Card-Art Redaction Boundaries

Supporter Card serial numbers are private reveal fields, not list fields.

The serial number may appear only in the future private reveal response after account ownership is proven. It must remain absent from:

- `/account/purchases` list/status responses.
- `/store`.
- Public profile metadata.
- Public profile rendered HTML.
- Public Supporter Card pages.
- Open Graph/Twitter metadata.
- Reviews.
- Leaderboards.
- Events.
- Community directories.
- Owner dashboards.
- Admin export-safe rows.
- Notification payloads.
- Browser storage.
- Analytics or tracking events.
- Server logs and error bodies.

Error messages must use redacted wording such as `supporter_card_unavailable` or, only if absolutely needed for private support workflows, `DZN-SUP-******`. They must not echo a submitted card reference, raw id, or serial number.

Card art is more sensitive than status because it can include unique visual details tied to the Supporter Card. The first reveal implementation must not generate new card art unless a separate card-art generation/storage slice is deliberately approved first. Until then, reveal UI may show:

- Existing public-safe theme label.
- Existing status.
- Existing supporter-since date.
- A blocked/unavailable card-art state.
- A future approved static placeholder.

If a later approved card-art implementation exists, the private reveal route may return only a renderer-safe card-art DTO or asset URL. It must never return raw `generated_insignia_json`, `insignia_seed_hash`, payment identifiers, raw user ids, or Stripe metadata.

## Account Ownership Proof

The future route must prove ownership with database joins, not with client claims.

Required proof:

- `supporter_cards.user_id` equals the authenticated DZN user id.
- `account_entitlements.user_id` equals the authenticated DZN user id.
- `store_orders.purchasing_user_id` equals the authenticated DZN user id.
- `supporter_cards.entitlement_id` equals the entitlement row used for the same purchase.
- `supporter_cards.source_order_id` equals the Store order used for the same purchase.
- `supporter_cards.source_order_item_id` equals the Store order item used for the same purchase.
- `account_entitlements.source_order_item_id` equals the Store order item used for the same purchase.
- Every row has `livemode = 0` until live Store activation is separately approved.
- Every row belongs to the active local/test sandbox ledger scope.
- The product key and fulfilment kind match the DZN Founding Supporter product contract.

The future route must not use these as ownership proof:

- Discord display name.
- Discord id supplied by the client.
- Email address.
- Browser storage.
- Public profile handle.
- Owner Starter/Pro entitlement.
- Server ownership.
- Admin role, except through a separate audited support/operator route that is not this private player route.
- Stripe metadata without the local Store order and entitlement joins.

The future route must use prepared D1 statements with bound values for user id, card reference, and ledger scope.

## Visibility Controls

Private reveal and public visibility are separate decisions.

The future private reveal may show the current card `visibility_state` to the owning player, but it must not write visibility preferences. It must not publish the card, badge, serial, or art to a public profile.

Changing public visibility must remain a separate player-owned settings slice. A future public Supporter Card or public badge reveal must require all of these:

- Existing private card reveal implementation.
- Existing player profile privacy preferences.
- Explicit player opt-in for public Supporter recognition.
- Generated public profile handle or equivalent public-safe account route.
- Separate tests proving hidden cards/badges remain hidden.
- Separate tests proving visibility choices cannot affect billing, rankings, discovery score, reviews, badges, seasons, events, Server Wars scoring, CTF scoring, XP awards, calling-card awards, reward-wheel state, or competitive eligibility.

Owner Starter/Pro plans must not force a Supporter Card public, hide it, reveal it, or use it as an owner entitlement.

## Screenshot And Export Rules

The first private reveal implementation must not add screenshot, download, export, print-to-image, share-link, copy-link, or public-share controls.

Manual browser screenshots are unavoidable, but the UI must make the privacy boundary clear:

- The card is private to the signed-in account.
- The page must not show payment details.
- The page must not show raw ids.
- The page must not store share history.
- The page must not create tracking events or analytics calls.

Any future screenshot or export feature requires a separate approval slice that defines:

- Whether the action is client-only or server-generated.
- Whether card art is embedded or redacted.
- Whether serial numbers are included.
- Whether files are stored or download-only.
- Expiry and deletion if storage is introduced.
- Screenshot/export audit needs.
- Copy/share controls and public publishing boundaries.
- Tests proving no public exposure without opt-in.

Until that later approval exists, downloads and exports stay blocked.

## Audit Requirements

This preflight adds no audit table and no reveal-view logging.

The future private reveal implementation must prove that every revealed card is backed by existing payment and fulfilment ledgers:

- `store_payment_events` verified the source payment event.
- `store_fulfilment_attempts` recorded the idempotent fulfilment attempt.
- `store_order_status_history` recorded the order transition.
- `account_entitlements` recorded the account-bound Store entitlement.
- `store_entitlement_status_history` recorded entitlement/card status transitions.
- `store_refund_dispute_audit` recorded any refund/dispute revocation or manual-review decision.

Reveal errors, application logs, and test snapshots must not include serial numbers, raw ids, Stripe ids, raw Discord ids, raw webhook payloads, or `generated_insignia_json`.

If DZN later wants security audit rows for reveal views, that must be separately approved before implementation. The default should remain no analytics, no tracking, no share history, and no public event stream. Any later reveal-audit model must be private, retention-bound, scoped to the account and security reviewers, and must not expose payment or raw card-art fields.

## Entitlement And Access Matrix

| Surface | Logged-out user | Logged-in player | Owner Starter/Pro entitlement | DZN admin/operator |
| --- | --- | --- | --- | --- |
| `/account/purchases` | Static shell and login redirect behavior only | Own sanitized Store purchases/status only when flags allow | Same as player; owner plan adds no Store reveal scope | Same as player unless a separate operator route is approved |
| `GET /api/account/purchases` | `401` when enabled, otherwise unavailable | Own sanitized local/test Store ledgers only | Same as player | Same as player |
| Future `GET /api/account/supporter-cards/[cardRef]/reveal` | `401` | Own active/hidden card only, after reveal flag and account-ownership proof | Same as player; owner entitlement adds no scope | Not through this route; any support access must be separate and audited |
| Supporter Card public reveal | Absent | Absent until separate opt-in public profile/card slice | Absent | Absent |
| Card-art generation | Absent | Absent until separate approval | Absent | Absent |
| Screenshot/export/share controls | Absent | Absent until separate approval | Absent | Absent |
| Webhook replay/manual review/refund workflow | Absent | Absent | Absent | Separate future admin/operator approval only |

Store account entitlements and Supporter Cards remain account-bound cosmetic/supporter recognition only. They must never grant Starter, Pro, owner setup, Nitrado access, server ownership, owner tools, or competitive advantages.

The future private reveal must remain separate from owner billing and owner entitlement checks. It must never promote a player into an owner role or alter any owner subscription state.

## Protected Surfaces

This preflight and any future private reveal implementation must not read from or write to:

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
- Earned spins or reward wheel tables.
- Competitive eligibility.

The future route must not call Store order creation, Store checkout, Store webhook, Store operator, billing, wheel, profile-privacy, progression, review, event, ranking, analytics, or tracking endpoints.

## Security Proof Required Before Implementation

A future private reveal implementation must add tests proving:

- Logged-out users cannot reveal a Supporter Card.
- A user cannot reveal another user's Supporter Card by card ref, purchase ref, serial number, order number, guessed id, or raw id.
- Raw/private identifier probes return `404`, not field-specific confirmation.
- Disabled reveal flag returns unavailable without ledger data.
- Live checkout flags block the reveal route until a separate go-live approval exists.
- Earned-spin and reward-wheel runtime flags are not required and cannot be written by reveal.
- Suspended, revoked, refunded, disputed, or manual-review cards do not reveal active serial/art content.
- Active and hidden cards can be privately viewed only by the owning account.
- The response is private/no-store and varies by cookie.
- The response includes no raw internal ids, Discord ids, Stripe ids, payment method data, customer email, billing address, webhook raw body, raw provider payload, operator notes, `insignia_seed_hash`, or `generated_insignia_json`.
- The route performs only bound D1 reads unless a separately approved reveal-audit model exists.
- The UI has no POST, PATCH, PUT, DELETE, checkout, webhook, notification, export, share, analytics, tracking, browser-storage, or production-mutation behavior.
- The Account Purchases read model remains status-only unless a separate schema-versioned extension is approved.
- Public profiles, Open Graph/Twitter metadata, reviews, leaderboards, events, community directories, owner dashboards, and export-safe rows do not expose serials or art without a later public opt-in slice.
- Revealing a private card cannot affect billing, owner entitlement, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, CTF scoring, Server Wars scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, earned spins, reward wheel state, or competitive eligibility.

Current preflight tests must prove:

- This document and handoff exist.
- Package scripts include the focused guard.
- Integration docs point to this delivered preflight.
- No reveal route, reveal UI, card-art route, share/export route, notification route, migration, source config flag, live checkout flag, earned-spin runtime, reward-wheel runtime, Stripe mutation, Cloudflare mutation, production D1 write, or issue #49 change is added.
- `/account/purchases` still declares Supporter Card reveal blocked.

## Rollback Plan

Rollback for this preflight is source-only:

- Remove `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`.
- Remove `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT_HANDOFF.md`.
- Remove `scripts/test-dzn-store-supporter-card-reveal-approval-preflight.ts`.
- Remove `test:dzn-store-supporter-card-reveal-approval-preflight` from `package.json`.
- Remove the integration-document references added by this slice.

No database rollback, Stripe rollback, Cloudflare rollback, Nitrado rollback, Discord rollback, card-art rollback, notification rollback, public profile rollback, or production data rollback is required because this slice performs no external service mutation and adds no migration.

If a later implementation exists, rollback must first disable `DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED`, then remove the reveal route/UI while preserving immutable payment, entitlement, status-history, refund/dispute, and Supporter Card ledger rows. Paid ledger rows must never be deleted as a UI rollback.

## Next Recommended Slice

Next should be Store private Supporter Card reveal implementation only if deliberately approved: add a disabled-by-default local/test private route and private `/account/purchases` reveal UI panel from this preflight, proving current-account ownership before showing a Supporter Card serial/status and keeping card-art generation, public reveal, sharing controls, screenshot/export controls, notifications, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 writes, and issue #49 blocked.

The personal player page/nav button remains a separate player UX slice.
