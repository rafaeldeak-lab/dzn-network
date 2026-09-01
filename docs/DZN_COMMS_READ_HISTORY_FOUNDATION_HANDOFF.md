# DZN Comms Read-History Foundation

Date: 2026-09-01
Branch: `codex/dzn-comms-read-history-foundation-20260901`

## Scope

This slice adds the first DZN Comms foundation only:

- Disabled-by-default local/test read-history flags.
- Additive local/test schema for channels, read-history messages, and private group membership proof.
- `GET /api/comms/message-history` read-only route.
- Static `/community` page shell with a disabled composer and fallback mock history.
- Focused tests proving public-channel reads, private-group membership denial, support-history blocking, no write paths, no AI/runtime hooks, and no payment/competitive-system coupling.

## Feature Flags

The API route only enables when both flags are set:

- `DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED=true`
- `DZN_COMMS_MESSAGE_HISTORY_READ_SCOPE=local_test`

The UI fetch is also disabled by default:

- `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=false`

When the UI flag is off, `/community` renders the static read-only fallback. When the UI flag is on but the route is disabled or unavailable, `/community` falls back to the same static read-only state.

## Read Contract

`GET /api/comms/message-history?channel=global-chat&limit=30`

Public channels:

- May be read when local/test route flags are enabled.
- Return public-safe author display labels and sanitized message body only.
- Return hidden/deleted/quarantined rows as safety placeholders.
- Omit expired rows.

Private groups:

- Require a logged-in Discord session.
- Require `dzn_comms_private_group_members.membership_state = 'active'`.
- Return `401` when logged out and `403` when the current user is not a member.

Support history:

- Remains blocked in this slice.
- Returns `SUPPORT_HISTORY_BLOCKED`.

## Boundaries

This slice does not add:

- Chat sending.
- Emoji reaction runtime.
- Report routes.
- Moderation mutations.
- DZN Assist AI runtime.
- Durable Objects.
- WebSockets.
- Analytics/tracking calls.
- Message send persistence.
- Store/payment/live checkout changes.
- Stripe or Cloudflare secret/config changes.
- Production D1 writes.
- Retained exports.
- Issue `#49` changes.

The route/helper do not write SQL and do not read or write billing, ownership, rankings, discovery, reviews, events, XP/calling-card awards, Server Wars, CTF, retained-export, profile-privacy, or competitive eligibility tables.

## Validation

Run:

```bash
npm run test:dzn-comms-read-history
npm run test
npm run lint
npm run build
git diff --check
```

Recommended focused safety checks:

```bash
npm run test:billing-plans
npm run test:stripe-live-readiness
npm run test:public-access-gating
npm run test:nav-access-visibility
npm run test:server-wars
npm run test:server-war-scoring
npm run test:ctf-tournament-engine
```

## Next Slice

After this is reviewed/merged/released, the next Comms slice should be the message sending contract preflight, not runtime sending. That preflight should define send attempt payloads, rate limits, profanity filtering, warning/timeout state, moderation review hooks, private-group membership proofs, retention/logging rules, rollback, and the same proof matrix before any send route or message write path exists.
