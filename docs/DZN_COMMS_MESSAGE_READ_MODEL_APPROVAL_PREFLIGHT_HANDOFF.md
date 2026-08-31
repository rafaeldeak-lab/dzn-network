# DZN Comms Message/Read Model Approval Preflight Handoff

## Status

Delivered as a documentation/test-only message/read model approval preflight slice.

Branch:

```text
codex/dzn-comms-message-read-model-approval-preflight-20260831
```

Base:

```text
origin/codex/dzn-comms-reaction-runtime-approval-preflight-20260831
```

The protected OneDrive checkout was not modified.

## Implemented

- Added `docs/DZN_COMMS_MESSAGE_READ_MODEL_APPROVAL_PREFLIGHT.md`.
- Defined the exact future read-only route: `GET /api/dzn-comms/channels/:channelId/messages`.
- Chose the first future runtime shape: disabled-by-default local/test message-history reads only.
- Defined public channel read rules for `global`, `new-players`, `server-owners`, and `events`.
- Defined private group read membership proof using the trusted DZN user ID bridge.
- Defined hidden, deleted, quarantined, expired, staff-only, unavailable, and visible message behavior.
- Defined response shape, public-safe author fields, no-store headers, cursor limits, and no private identifier exposure.
- Defined future local/test storage model candidates without adding a migration.
- Defined feature-flag defaults, mock-to-real transition rules, rollback, and proof matrix.
- Updated the broader Comms preflight docs, master spec, public access policy, and related handoffs to point at this prerequisite.
- Added `npm run test:dzn-comms-message-read-model-approval-preflight`.

## Boundaries Preserved

No runtime message/read behavior.

Still blocked:

- Runtime message-history API.
- Runtime chat send API.
- Runtime reaction API.
- Report routes.
- Moderation mutation routes.
- DZN Assist support bot runtime.
- Message tables.
- Membership tables.
- Moderation tables.
- Reaction tables.
- Report tables.
- Support transcript tables.
- Database migrations.
- Durable Objects.
- WebSockets.
- Message persistence.
- Support history persistence.
- Analytics/tracking.
- AI provider credentials.
- Vector stores.
- Metered model calls.
- Store order creation.
- Store Checkout Session creation.
- Store webhooks.
- Store entitlement writes.
- Supporter Card reveal changes.
- Earned spins.
- Reward wheel runtime.
- Live checkout activation.
- Stripe Product/Price/customer/webhook mutation.
- Cloudflare secret/config mutation.
- Production D1 writes or migration applies.
- Nitrado mutation.
- Discord mutation.
- Retained exports.
- Deployment to `https://dayz-network.com/`.
- Issue `#49`.

## Entitlement And Access Matrix

| Actor | Future public channel reads | Future private group reads | Future message writes |
| --- | --- | --- | --- |
| Visitor | Static mock `/community` shell only in the first runtime plan | Denied | Denied |
| Free Discord player | Visible public-channel messages when local/test flags are enabled | Only with trusted DZN user ID bridge membership | Denied until separate send-runtime approval |
| Starter owner | Same personal read access as free player | Same membership proof required; plan alone is not enough | Denied until separate send-runtime approval |
| Pro owner | Same as Starter; no read advantage | Same membership proof required; no read advantage | Denied until separate send-runtime approval |
| DZN admin/moderator | Same read access unless a separate staff read approval exists | Same membership proof unless a separate staff read approval exists | Denied until separate send-runtime approval |

Starter and Pro must not grant message-read priority, visibility, ordering, larger page size, longer retention, private group access, author display advantage, moderation immunity, safety bypasses, ranking boost, discovery boost, review boost, XP, calling cards, badges, event advantage, CTF advantage, Server Wars advantage, public profile visibility, or competitive eligibility.

## Protected Surfaces

The future message/read contract must not expose:

- Raw DZN user IDs.
- Discord IDs.
- Discord OAuth tokens.
- Private email.
- Hidden profile fields.
- Private profile sections.
- Billing/customer/order/payment fields.
- Owner entitlement state.
- Server ownership state.
- Nitrado identifiers or tokens.
- IP addresses.
- User agents.
- Referrers.
- Route history.
- Raw moderation evidence.
- Report details.
- Rejected or blocked message bodies.
- Support prompts or support answers.
- Retained exports.
- Raw ledger rows.

The future message/read contract must not affect:

- Billing.
- Owner entitlement.
- Server ownership.
- Store purchases.
- Supporter Card state.
- Rankings.
- Discovery score.
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
- Analytics/tracking.
- AI support state.
- Moderation decisions outside separately approved message visibility reads.
- Competitive eligibility.

## Production-Mutation Confirmation

This slice must not mutate:

- Live Stripe products or prices.
- Live checkout configuration.
- Cloudflare secrets.
- Cloudflare config.
- Production D1.
- Nitrado.
- Discord.
- Retained exports.
- Runtime chat services.
- Message storage.
- Reaction storage.
- Moderation tables.
- Report tables.
- Support transcript storage.
- AI provider credentials.
- Vector stores.
- Metered model calls.
- Analytics/tracking systems.
- Deployments.
- Issue `#49`.

Live checkout remains disabled. Issue `#49` remains reserved for final live payment activation.

## Validation To Run

- `npm run test:dzn-comms-message-read-model-approval-preflight`
- `npm run test:dzn-comms-reaction-runtime-approval-preflight`
- `npm run test:dzn-comms-reaction-contract-preflight`
- `npm run test:dzn-comms-interaction-contract-preflight`
- `npm run test:dzn-comms-runtime-approval-preflight`
- `npm run test:dzn-comms-visual-shell`
- `npm run test:dzn-comms-live-presence-counter`
- `npm run test:player-nav-access-polish`
- `npm run test:player-owner-access-foundation`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`
- Changed-file scope check for no runtime files.
- Protected-path check for no migrations, Cloudflare config, workflows, package-lock, public assets, or production deploy files.
- Codex Security diff scan.

## Validation Result

Completed on 2026-08-31:

- `npm run test:dzn-comms-message-read-model-approval-preflight` passed.
- `npm run test:dzn-comms-reaction-runtime-approval-preflight` passed.
- `npm run test:dzn-comms-reaction-contract-preflight` passed.
- `npm run test:dzn-comms-interaction-contract-preflight` passed.
- `npm run test:dzn-comms-runtime-approval-preflight` passed.
- `npm run test:dzn-comms-visual-shell` passed.
- `npm run test:dzn-comms-live-presence-counter` passed.
- `npm run test:player-nav-access-polish` passed.
- `npm run test:player-owner-access-foundation` passed.
- `npm run check:billing-config` passed and reported live checkout disabled/not configured.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with the existing warning set only.
- `npm run build` passed.
- `npm test` passed.
- `git diff --check` passed.
- Changed-file scope check confirmed no runtime files changed.
- Protected-path check confirmed no migration, Cloudflare config, workflow, package-lock, or public asset changes.
- Production-mutation scan found no new runtime mutation behavior. It only matched existing package maintenance scripts and the guard script's own forbidden-pattern list.
- Codex Security diff scan `86fa0785-ae87-4389-b1aa-5f665f7fa8c0` completed with zero findings and complete coverage of the reviewed diff. TAC advisory could not be verified because the Codex Security Access connector is not connected.

## Live-Site Boundary

This PR does not deploy to `https://dayz-network.com/`.

Only report message history as live after a later approved implementation PR is merged, deployed, and verified on the production URL.

## Follow-On Implementation Slice

The DZN Comms Message/Read Model Local/Test Foundation is documented in `docs/DZN_COMMS_MESSAGE_READ_MODEL_LOCAL_TEST_FOUNDATION.md` and `docs/DZN_COMMS_MESSAGE_READ_MODEL_LOCAL_TEST_FOUNDATION_HANDOFF.md`.

This is the approved DZN Comms message/read model local/test implementation foundation.

It adds the approved disabled-by-default local/test read-only route and schema while keeping `/community` on static fallback unless a later UI integration slice enables runtime fetching. It still avoids chat sending, reaction runtime, report routes, moderation mutations, DZN Assist AI runtime, Durable Objects/WebSockets, analytics/tracking, Store/payment changes, live checkout, Stripe/Cloudflare/production D1/Nitrado/Discord mutations, retained exports, deployment, and issue #49 changes.

## Next Recommended Slice

Next should be DZN Comms message-history UI integration approval preflight: define whether `/community` may fetch the local/test read-only route behind `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED`, how fallback/error states should render, and how reviewers prove the UI still cannot send messages, create reactions, report/moderate, call DZN Assist AI, use Durable Objects/WebSockets, track analytics, alter Store/payment/live checkout, mutate production services, change retained exports, or affect competitive systems.
