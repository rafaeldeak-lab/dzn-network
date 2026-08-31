# DZN Store Supporter Card Reveal Visual QA

## Status And Boundary

This slice polishes the private `/account/purchases` Supporter Card reveal panel that was delivered by `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md`.

It is a visual and local QA slice only. It refines the private account page presentation, empty state, loading state, reveal unavailable/error state, and current-account reveal state. It also adds durable seeded local preview evidence so reviewers can inspect the intended states without using production services.

This slice does not add, enable, create, mutate, or approve:

- No generated card art.
- No public Supporter Card reveal.
- No sharing controls.
- No screenshot, download, export, print, or copy-link controls.
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

The personal player page/nav button remains a separate player UX slice and is not changed by this Store visual QA slice.

## Implemented UI Polish

The private `/account/purchases` panel now has:

- A stronger DZN Founding Supporter frame using existing CSS-only styling.
- A masked `DZN-SUP-******` serial placeholder before a private reveal succeeds.
- A clearer "Private serial reveal" success state after `GET /api/account/supporter-cards/[cardRef]/reveal` returns a current-account proofed payload.
- Clear badges for "Current-account proof", "Local/test only", and "No share/export".
- A richer empty state for accounts with no private Supporter Card status.
- A clearer loading state while the private reveal route checks ownership proof.
- A clearer unavailable/error state for blocked reveal attempts.

The page still consumes only:

- `GET /api/account/purchases`
- `GET /api/account/supporter-cards/[cardRef]/reveal`

Both calls keep `credentials: "include"` and `cache: "no-store"`. The page still does not call Store checkout, Store order creation, Store webhook, Store operator, billing, wheel, notification, profile-privacy, progression, review, event, ranking, Nitrado, Discord, AI, analytics, or tracking routes.

## Local Seeded Preview Evidence

The durable local QA artifact is:

- `docs/artifacts/dzn-store-supporter-card-reveal-visual-qa/supporter-card-reveal-visual-qa.json`
- `docs/artifacts/dzn-store-supporter-card-reveal-visual-qa/README.md`

The artifact records sanitized local/test preview states for:

- Read model disabled/unavailable.
- No purchases/no Supporter Card.
- Private card listed but serial still masked.
- Private card revealed after current-account proof.
- Private reveal unavailable.
- Cross-account denied.

The artifact uses fake local/test references only. It contains no raw DZN user ids, Discord ids, Stripe ids, payment methods, billing addresses, internal order ids, internal entitlement ids, internal Supporter Card ids, webhook raw bodies, provider payloads, operator notes, real customer data, or production data.

## DZN Comms Reaction Polish

This slice also fixes the static DZN Comms visual shell reaction chips so the visible reactions are actual emoji plus count, rather than text labels such as "Boost 14" or "Heart 12".

The change is limited to `components/community/dzn-comms-visual-shell.tsx` static local mock data and presentation:

- Visible chips render emoji plus count.
- Reaction names remain available through `aria-label`.
- The shell remains static local mock data.
- No chat route, message sending, message persistence, moderation table, Durable Object, WebSocket, AI support runtime, analytics, tracking, or production mutation is added.

## Entitlement And Access Matrix

| Surface | Logged-out user | Logged-in player | Owner Starter/Pro entitlement | DZN admin/operator |
| --- | --- | --- | --- | --- |
| `/account/purchases` | Static shell and login redirect behavior only | Own sanitized purchases and private Supporter Card status only when flags allow | Same as player; owner plan adds no Store reveal scope | Same as player unless a separate operator route is approved |
| Supporter Card masked frame | No private data | May see masked status for own card from read model | Same as player | Same as player |
| Private serial reveal | `401` when enabled | Own active/hidden fulfilled card only after local/test flags and ownership proof | Same as player; owner entitlement adds no scope | Not through this route |
| Public reveal/card page | Absent | Absent | Absent | Absent |
| Card-art generation | Absent | Absent | Absent | Absent |
| Sharing/export/screenshot controls | Absent | Absent | Absent | Absent |
| DZN Comms reactions | Static visual emoji chips only | Static visual emoji chips only | Static visual emoji chips only | Static visual emoji chips only |

Store account entitlements and Supporter Cards remain account-bound cosmetic/supporter recognition only. They do not grant Starter, Pro, owner setup, Nitrado access, server ownership, owner tools, chat privileges, moderation privileges, or competitive advantages.

## Protected Surfaces

This slice does not read from or write to:

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
- Chat messages or support sessions.
- Competitive eligibility.

## Validation Requirements

The focused test `scripts/test-dzn-store-supporter-card-reveal-visual-qa.ts` proves:

- The private Account Purchases page declares the visual QA contract.
- The polished panel still uses the approved private read and reveal endpoints only.
- The serial is masked before reveal.
- The serial appears only in the existing current-account private reveal success panel.
- Empty, loading, unavailable, and blocked states remain visible.
- Card art, public reveal, sharing, screenshot/export, notifications, live checkout, earned spins, reward wheel runtime, Stripe mutation, Cloudflare mutation, production D1 writes, and issue #49 remain blocked.
- The local seeded QA artifact is sanitized and bounded.
- The DZN Comms visual shell renders emoji reaction chips while preserving accessible reaction labels.
- The DZN Comms shell remains static local mock data with no sending, persistence, backend routes, tracking, AI runtime, or production mutation.

## Rollback Plan

Source rollback:

- Revert the visual-only changes in `components/store/dzn-store-account-purchases-page.tsx`.
- Revert the static reaction-chip change in `components/community/dzn-comms-visual-shell.tsx`.
- Remove `scripts/test-dzn-store-supporter-card-reveal-visual-qa.ts`.
- Remove `test:dzn-store-supporter-card-reveal-visual-qa` from `package.json`.
- Remove this document, the visual QA handoff, and the local seeded QA artifact files.

No database rollback, Stripe rollback, Cloudflare rollback, production-data rollback, Nitrado rollback, Discord rollback, AI rollback, card-art rollback, notification rollback, public-profile rollback, retained-export rollback, chat-message rollback, or issue #49 rollback is required because this slice is source-only and adds no migration or production mutation.

## Next Recommended Slice

Next should be the personal player page/nav access polish slice: add a clearer logged-in Player Hub/Profile button or account-menu entry for individual players so people can reach `/player` and `/player/profile` easily after Discord login, without mixing that player UX work into Store payment/reveal safety work.

After that, if deliberately approved, the Store track can move to a separate Supporter Card card-art generation preflight. That future slice must design art generation, storage, redaction, ownership, public visibility, screenshot/export, sharing, cost controls, and rollback before any generated card art or public reveal is implemented.
