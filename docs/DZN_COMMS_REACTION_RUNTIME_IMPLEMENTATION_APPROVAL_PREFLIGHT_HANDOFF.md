# DZN Comms Reaction Runtime Implementation Approval Preflight Handoff

## Status

Delivered as a documentation/test-only reaction runtime approval preflight slice.

Branch:

```text
codex/dzn-comms-reaction-runtime-approval-preflight-20260831
```

Base:

```text
origin/codex/dzn-comms-reaction-contract-preflight-20260831
```

The protected OneDrive checkout was not modified.

## Implemented

- Added `docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md`.
- Defined the exact future route set for reaction reads, adds, deletes, and message-history embedding.
- Chose the first future runtime shape: disabled-by-default local/test reaction read/write for already-readable messages only.
- Blocked chat sending, first message table creation, private group runtime creation, support bot runtime, WebSockets, Durable Objects, analytics, AI provider work, Store/payment work, production mutation, and issue #49 changes.
- Defined the prerequisite message/read model and authorization dependency.
- Defined the future reaction storage/migration model: `dzn_comms_message_reactions` and `dzn_comms_reaction_mutations`.
- Defined feature-flag defaults, idempotency/concurrency behavior, rate limits, moderation inheritance, retention model, rollout sequence, rollback plan, and proof matrix.
- Updated the broader reaction contract, master spec, public access policy, and related Comms handoffs to point at this approval preflight.
- Added `npm run test:dzn-comms-reaction-runtime-approval-preflight`.

## Boundaries Preserved

No runtime reaction behavior.

Still blocked:

- Runtime reaction APIs.
- Runtime chat send APIs.
- Message tables.
- Reaction tables.
- Database migrations.
- Durable Objects.
- WebSockets.
- Message persistence.
- Reaction persistence.
- Support history persistence.
- Moderation mutation routes.
- Moderation tables.
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

| Actor | Future reaction reads | Future reaction writes | Future reaction moderation |
| --- | --- | --- | --- |
| Visitor | Public static mock presentation only until runtime approval | Denied | Denied |
| Free Discord player | Public readable messages when read flag is enabled | Own allowed reactions on visible public-channel messages when write flag is enabled | Denied |
| Starter owner | Same personal reaction access as free player | Same personal reaction access as free player | Not in first runtime PR; future owner moderation requires entitlement plus linked-server ownership |
| Pro owner | Same as Starter; no reaction advantage | Same as Starter; no reaction advantage | Same owner/admin scope rules |
| DZN admin/moderator | Same read/write as a player unless global scope applies | Same read/write as a player unless global scope applies | Blocked until a separate moderation implementation approval slice |

Starter and Pro must not grant reaction weight, priority, visibility, better limits, moderation immunity, safety bypasses, ranking boost, discovery boost, review boost, XP, calling cards, badges, event advantage, CTF advantage, Server Wars advantage, billing advantage, public profile visibility advantage, or competitive eligibility.

## Protected Surfaces

The future reaction runtime contract must not expose:

- Raw DZN user IDs.
- Discord IDs.
- Discord OAuth tokens.
- Private profile fields.
- Hidden profile sections.
- Public profile handles unless a separate public attribution contract allows them.
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
- Support transcripts.
- Retained exports.
- Raw reaction ledger rows.

The future reaction runtime contract must not affect:

- Billing.
- Owner entitlement.
- Server ownership.
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
- Moderation decisions outside approved reaction abuse handling.
- Competitive eligibility.

## Production-Mutation Confirmation

This slice must not mutate:

- Live Stripe products or prices.
- Live checkout configuration.
- Cloudflare secrets.
- Production D1.
- Nitrado.
- Discord.
- Retained exports.
- Runtime chat services.
- Message storage.
- Reaction storage.
- Moderation tables.
- AI provider credentials.
- Vector stores.
- Metered model calls.
- Analytics/tracking systems.
- Deployments.
- Issue `#49`.

Live checkout remains disabled. Issue `#49` remains reserved for final live payment activation.

## Validation To Run

- `npm run test:dzn-comms-reaction-runtime-approval-preflight`
- `npm run test:dzn-comms-reaction-contract-preflight`
- `npm run test:dzn-comms-interaction-contract-preflight`
- `npm run test:dzn-comms-runtime-approval-preflight`
- `npm run test:dzn-comms-visual-shell`
- `npm run test:dzn-comms-live-presence-counter`
- `npm run test:player-owner-access-foundation`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`
- Changed-file scope check for no runtime files.
- Protected-path check for no migrations, Cloudflare config, workflows, package-lock, or public assets.
- Codex Security diff scan.

## Validation Result

Completed on 2026-08-31:

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
- Codex Security diff scan `a6890cb7-209d-42e6-8551-04d5f1d9384e` completed with zero findings and complete coverage of the 15 changed files. TAC advisory could not be verified because the Codex Security Access connector is not connected.

## Live-Site Boundary

This PR does not deploy to `https://dayz-network.com/`.

Only report reaction runtime as live after a later approved implementation PR is merged, deployed, and verified on the production URL.

## Next Recommended Slice

Next should be DZN Comms message/read model approval preflight if no approved DZN Comms message/read runtime exists yet.

If that prerequisite already exists in the chosen base branch, next should be the DZN Comms reaction runtime local/test implementation slice, disabled by default, using only the approved route set, storage model, flags, idempotency/concurrency behavior, rate limits, moderation inheritance, retention model, rollback plan, and proof matrix.
