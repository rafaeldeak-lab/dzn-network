# DZN Store Supporter Card Private Reveal Implementation

## Status And Boundary

This slice implements the approved private reveal contract from `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`.

It adds a disabled-by-default local/test private route and a private `/account/purchases` reveal UI panel. It lets the current authenticated user reveal their own fulfilled DZN Founding Supporter Card serial/status only after server-side ownership proof.

This implementation does not add, enable, create, mutate, or approve:

- No generated card art.
- No public Supporter Card reveal.
- No sharing, screenshot, download, export, or copy-link controls.
- No notification route or notification writes.
- No Store webhook replay route.
- No manual-review operator route.
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

The personal player page/nav button remains a separate player UX slice and is not changed by this Store reveal implementation.

## Implemented Surfaces

- `functions/_lib/dzn-store-supporter-card-reveal.ts`
- `functions/api/account/supporter-cards/[cardRef]/reveal.ts`
- `components/store/dzn-store-account-purchases-page.tsx`
- `functions/_lib/dzn-store-account-purchases.ts`

The route contract is:

- Method: `GET` only.
- Path: `GET /api/account/supporter-cards/[cardRef]/reveal`.
- Caller: authenticated DZN session only.
- Scope: current user only.
- Cache: private/no-store with `Vary: Cookie`.
- Runtime: local/test Store sandbox only.
- Feature gate: `DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED=true`.
- Input reference: display-safe Store purchase reference such as `DZN-STORE-20260831-ABC123`; raw ids and serial probes are rejected before D1 access.
- Output: JSON only.

## Access Gates

The private reveal route requires all of these before returning a reveal payload:

- `DZN_STORE_ENABLED=true`
- `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED=true`
- `DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED=true`
- `DZN_STORE_SANDBOX_RUNTIME=local` or `DZN_STORE_SANDBOX_RUNTIME=test`
- `DZN_LIVE_CHECKOUT_ENABLED` absent/false
- `DZN_STORE_LIVE_CHECKOUT_ENABLED` absent/false
- `DZN_EARNED_SPINS_ENABLED` absent/false
- `DZN_REWARD_WHEEL_ENABLED` absent/false

The route returns:

- `401` when the route is enabled but no authenticated Discord/DZN session exists.
- `404` when the reveal flag is disabled, the card is missing, the card belongs to another account, the ref is invalid, the ref is a raw/private identifier probe, or the row is outside the active local/test ledger scope.
- `409` when the card exists for the current account but is not privately viewable, including suspended, revoked, manual-review, unsafe product flags, missing payment receipt proof, or missing fulfilment proof.
- `503` when D1 is unavailable or the private ledger read fails.
- `200` only for the current user's active/hidden fulfilled Supporter Card.

## Ownership Proof

The implementation proves ownership with prepared D1 statements and bound values. The successful row must satisfy all of these:

- `supporter_cards.user_id` equals the authenticated DZN user id.
- `account_entitlements.user_id` equals `supporter_cards.user_id`.
- `store_orders.purchasing_user_id` equals `supporter_cards.user_id`.
- `supporter_cards.entitlement_id` matches the joined account entitlement.
- `supporter_cards.source_order_id` matches the joined Store order.
- `supporter_cards.source_order_item_id` matches the joined Store order item.
- `account_entitlements.source_order_item_id` matches the joined Store order item.
- `store_payment_events.id` matches `supporter_cards.issued_by_payment_event_id` and is processed.
- `store_fulfilment_attempts.supporter_card_id` matches the Supporter Card and is fulfilled/duplicate.
- Every joined row has `livemode = 0`.
- Every Store/card ledger row belongs to the active local/test sandbox ledger scope.
- The product key is `dzn-founding-supporter-pack`.
- The product type is `supporter_pack`.
- The fulfilment kind is `supporter_card`.
- Product safety flags prove account-bound, guaranteed purchase, no competitive advantage, no spins, no XP, no owner access, no scoring, no discovery, no reviews, no event, no Server Wars, no CTF, and no competitive eligibility grant.

The implementation does not use Discord display name, client-supplied Discord id, email, browser storage, public profile handle, owner Starter/Pro entitlement, server ownership, or Stripe metadata alone as ownership proof.

## Reveal Payload

The successful response may include only:

- Display-safe `card_ref` and `purchase_ref`.
- Product key/name.
- Card type and card type label.
- Card status and visibility state.
- Supporter Card serial.
- Display name snapshot.
- Supporter-since date.
- Selected theme key and theme label.
- Issued/suspended/revoked timestamps.
- A blocked card-art state.
- A blocked public-reveal state.
- Explicit safety booleans.

The response must not include raw `supporter_cards.id`, raw `account_entitlements.id`, raw `store_orders.id`, raw `store_order_items.id`, raw `store_payment_events.id`, raw `users.id`, raw Discord ids, Stripe ids, customer email, payment method data, billing address, webhook raw body, raw provider payload, operator notes, `insignia_seed_hash`, or `generated_insignia_json`.

The general Account Purchases read model is now `2026-08-31.store-account-purchases-read-model-v2`. The read model v2 can advertise `private_reveal_available: true` for a specific current-account card when the reveal flag is enabled, but it still does not return Supporter Card serial numbers or card art.

## UI Contract

`/account/purchases` remains authenticated and private. The page:

- Uses `GET /api/account/purchases` with `credentials: "include"` and `cache: "no-store"`.
- Shows purchase, entitlement, and private Supporter Card status from sanitized ledgers.
- Shows a private reveal panel only for current-account cards that the read model marks as privately revealable.
- Calls `GET /api/account/supporter-cards/[cardRef]/reveal` with `credentials: "include"` and `cache: "no-store"`.
- Displays the Supporter Card serial/status only in the private panel after the reveal response succeeds.
- Shows blocked states for card art and public reveal.

The page does not use `POST`, `PUT`, `PATCH`, `DELETE`, checkout routes, webhook routes, billing routes, wheel routes, admin Store routes, `navigator.share`, `navigator.clipboard`, `sendBeacon`, analytics, tracking, local storage, or session storage.

## Entitlement And Access Matrix

| Surface | Logged-out user | Logged-in player | Owner Starter/Pro entitlement | DZN admin/operator |
| --- | --- | --- | --- | --- |
| `/account/purchases` | Static shell and login redirect behavior only | Own sanitized Store purchases/status only when flags allow | Same as player; owner plan adds no Store reveal scope | Same as player unless a separate operator route is approved |
| `GET /api/account/purchases` | `401` when enabled, otherwise unavailable | Own sanitized local/test Store ledgers only; no serials | Same as player | Same as player |
| `GET /api/account/supporter-cards/[cardRef]/reveal` | `401` when enabled | Own active/hidden fulfilled card only after reveal flag and ledger ownership proof | Same as player; owner entitlement adds no scope | Not through this route; any support access must be separate and audited |
| Supporter Card public reveal | Absent | Absent until separate opt-in public profile/card slice | Absent | Absent |
| Card-art generation | Absent | Absent until separate approval | Absent | Absent |
| Screenshot/export/share controls | Absent | Absent until separate approval | Absent | Absent |
| Webhook replay/manual review/refund workflow | Absent | Absent | Absent | Separate future admin/operator approval only |

Store account entitlements and Supporter Cards remain account-bound cosmetic/supporter recognition only. They do not grant Starter, Pro, owner setup, Nitrado access, server ownership, owner tools, or competitive advantages.

## Protected Surfaces

This implementation does not read from or write to:

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

The private reveal route does not call Store order creation, Store checkout, Store webhook, Store operator, billing, wheel, profile-privacy, progression, review, event, ranking, analytics, tracking, Nitrado, Discord, or AI endpoints.

## Validation Requirements

The focused test `scripts/test-dzn-store-supporter-card-reveal-implementation.ts` proves:

- Private reveal is disabled by default.
- Live checkout flags block reveal.
- Earned-spin and reward-wheel runtime flags block reveal.
- Logged-out users cannot reveal a card when the route is enabled.
- Raw ids, Discord ids, Stripe ids, emails, and serial probes are rejected as card refs.
- Invalid refs fail before D1 access.
- Cross-account refs and wrong ledger scope refs return unavailable without serials.
- Active current-account cards reveal only after payment, fulfilment, entitlement, and Supporter Card proof.
- Suspended, revoked, manual-review, unsafe, or unproven cards do not reveal serials.
- The response is private/no-store and varies by cookie.
- The route performs only a single joined D1 read and no writes.
- The UI has no mutating methods, checkout, webhook, notification, export, share, analytics, tracking, browser-storage, or production-mutation behavior.
- `GET /api/account/purchases` v2 can advertise private reveal availability without listing serials.

## Rollback Plan

Source rollback:

- Disable or remove `DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED` in local/test runtime settings if it was set manually for review.
- Remove `functions/api/account/supporter-cards/[cardRef]/reveal.ts`.
- Remove `functions/_lib/dzn-store-supporter-card-reveal.ts`.
- Revert the private reveal panel changes in `components/store/dzn-store-account-purchases-page.tsx`.
- Revert the read-model v2 reveal-availability additions in `functions/_lib/dzn-store-account-purchases.ts`.
- Remove `scripts/test-dzn-store-supporter-card-reveal-implementation.ts`.
- Remove `test:dzn-store-supporter-card-reveal-implementation` from `package.json`.
- Remove this document and implementation handoff references.

No database rollback, Stripe rollback, Cloudflare rollback, production-data rollback, Nitrado rollback, Discord rollback, AI rollback, card-art rollback, notification rollback, public-profile rollback, or issue #49 rollback is required because this slice is source-only and adds no migration or production mutation.

Paid order, payment event, fulfilment, entitlement, status-history, refund/dispute, and Supporter Card ledger rows must never be deleted as a UI rollback.

## Next Recommended Slice

The Store private Supporter Card reveal visual polish and manual QA slice is now delivered separately in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_VISUAL_QA.md`. It refines the private `/account/purchases` reveal panel styling/states, adds local seeded preview evidence, and keeps card-art generation, public reveal, sharing controls, screenshot/export controls, notifications, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 writes, and issue #49 blocked.

Next should be the personal player page/nav access polish slice: add clearer logged-in access to `/player` and `/player/profile` through the header/account menu or another obvious player-facing route entry, without touching Store payment runtime or Supporter Card reveal safety.

The personal player page/nav button remains a separate player UX slice.
