# DZN Comms Reaction Interaction Contract Preflight Handoff

## Status

Delivered as a documentation/test-only reaction preflight slice.

Branch:

```text
codex/dzn-comms-reaction-contract-preflight-20260831
```

Base:

```text
origin/codex/dzn-player-nav-access-polish-20260831
```

The protected OneDrive checkout was not modified.

## Implemented

- Added `docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT.md`.
- Defined the future allowed emoji set with server-controlled reaction keys and code points.
- Defined future read/add/remove/message-history reaction contracts.
- Defined per-user idempotency and count-integrity requirements.
- Defined public-safe aggregate counts and private current-user reaction state.
- Defined access rules for visitors, free players, Starter/Pro owners, and DZN admins/moderators.
- Defined reaction rate limits, abuse handling, moderation behavior, retention/logging, rollback controls, and proof requirements.
- Kept static `/community` reaction chips as display-only emoji previews.
- Updated the broader Comms contract, public access policy, master spec, and related handoff docs to point at this reaction-specific contract.
- Added `npm run test:dzn-comms-reaction-contract-preflight`.

## Boundaries Preserved

This slice adds no runtime reaction behavior.

No runtime reaction behavior.

Still blocked:

- Runtime reaction APIs.
- Runtime chat send APIs.
- Message tables.
- Reaction tables.
- Chat/support/moderation migrations.
- Durable Objects.
- WebSockets.
- Message persistence.
- Reaction persistence.
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

## Access And Entitlement Matrix

| Actor | Future public-channel reactions | Future private-group reactions | Future reaction moderation |
| --- | --- | --- | --- |
| Visitor | Cannot add/remove; static read-only preview only | Not visible | Denied |
| Free Discord player | Add/remove own allowed reactions when runtime flags are enabled | Only with trusted DZN user ID bridge membership | Denied |
| Starter owner | Same personal reaction ability as free player | Only with trusted membership or scoped owner role | Own server/community scope only after owner entitlement plus linked-server ownership |
| Pro owner | Same as Starter; no extra reaction weight or priority | Same as Starter | Same owner/admin scope rules |
| DZN admin/moderator | Normal reactions plus explicitly scoped moderation | Scoped admin/moderator access only | Allowed only through approved moderation route/action |

Starter and Pro must not grant reaction priority, reaction weight, reaction visibility, moderation immunity, safety bypasses, ranking boost, discovery boost, review boost, XP, calling cards, badges, event advantage, CTF advantage, Server Wars advantage, billing advantage, or competitive eligibility.

## Protected Surfaces

Reaction contracts must not expose or affect:

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

- `npm run test:dzn-comms-reaction-contract-preflight`
- `npm run test:dzn-comms-interaction-contract-preflight`
- `npm run test:dzn-comms-visual-shell`
- `npm run test:dzn-comms-live-presence-counter`
- `npm run test:dzn-comms-runtime-approval-preflight`
- `npm run test:player-nav-access-polish`
- `npm run test:player-owner-access-foundation`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`
- Static production-mutation scans for runtime reaction/chat routes, message/reaction tables, migrations, Durable Objects/WebSockets, provider packages, vector stores, analytics/tracking, live checkout, Stripe/Nitrado/Discord/Cloudflare/D1 mutations, and issue `#49`.
- Codex Security diff scan.

## Validation Result

Completed on 2026-08-31:

- `npm run test:dzn-comms-reaction-contract-preflight` passed.
- `npm run test:dzn-comms-interaction-contract-preflight` passed.
- `npm run test:dzn-comms-visual-shell` passed.
- `npm run test:dzn-comms-live-presence-counter` passed.
- `npm run test:dzn-comms-runtime-approval-preflight` passed.
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
- Codex Security diff scan `aa08dd6e-c24b-424b-870d-ab37bb1f708b` completed with zero findings and complete coverage. TAC advisory could not be verified because the Codex Security Access connector was not connected.

## Live-Site Boundary

This PR does not deploy to `https://dayz-network.com/`.

Only report the feature as live after the normal repository merge/deployment process runs and production verification confirms the live URL.

## Next Recommended Slice

The DZN Comms reaction runtime implementation approval preflight is now captured in `docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md`.

Next should be DZN Comms message/read model approval preflight if no approved DZN Comms message/read runtime exists yet.

If that prerequisite already exists in the chosen base branch, next should be DZN Comms reaction runtime local/test implementation, disabled by default, using only the approved route set, storage model, flags, idempotency/concurrency behavior, rate limits, moderation inheritance, retention model, rollback plan, and proof matrix from `docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md`.
