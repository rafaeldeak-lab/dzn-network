# DZN Comms Live Presence Counter Foundation Handoff

## Slice

This slice implements the first approved DZN Comms runtime piece: a public-safe aggregate online counter on `/community` and the Global Chat shell.

The counter is presence-only. It does not implement chat message sending, message persistence, message history, private group messages, reports, moderation mutations, DZN Assist AI runtime, bot prompts, vector stores, AI provider credentials, metered model calls, analytics/tracking events, retained exports, live checkout changes, or production service mutations.

## Architecture Found

- `/community` renders `components/community/dzn-comms-visual-shell.tsx`.
- The Comms shell uses local mock channel/member/message data and keeps the composer disabled.
- The previous runtime approval preflight selected the public-safe aggregate DZN online counter as the first allowed runtime slice.
- Existing project APIs use Cloudflare Pages Functions under `functions/api/*`, shared helpers under `functions/_lib/*`, and `json()` from `functions/_lib/http.ts` for no-store JSON responses.
- Existing plan/entitlement code is separate from player/community presentation surfaces; Starter/Pro and legacy effective-Pro normalization remain untouched.

## Implementation

- `functions/_lib/dzn-comms-presence.ts`
  - Adds the canonical presence helper.
  - Normalizes allowed scopes to `site`, `community`, or `global_chat`.
  - Keeps read/write behavior behind disabled-by-default flags.
  - Generates a short-lived opaque presence-session key, hashes it server-side, and stores only the hash.
  - Enforces a 45-second presence TTL and 90-second short-lived cookie maximum age.
  - Returns aggregate-only payloads with `label: "DZN online"`, `onlineCount`, `precision`, `updatedAt`, `ttlSeconds`, and `status`.

- `functions/api/dzn-comms/presence.ts`
  - Adds `GET /api/dzn-comms/presence?scope=site|community|global_chat`.
  - Adds `POST /api/dzn-comms/presence?scope=site|community|global_chat`.
  - Uses bounded JSON parsing for heartbeat requests.
  - Returns no-store public aggregate JSON.
  - Ignores client-supplied count or identity fields.
  - Returns fallback status when disabled or unavailable.

- `migrations/0070_dzn_comms_presence_counter.sql`
  - Adds `dzn_comms_presence_sessions`.
  - Stores only `presence_key_hash`, `scope`, `first_seen_at`, `last_seen_at`, and `expires_at`.
  - Adds a scope/expiry index.
  - Does not store IPs, user agents, referrers, routes, Discord IDs, raw DZN user IDs, profile handles, billing state, owner entitlement, server ownership, review IDs, event IDs, challenge IDs, scoring IDs, or competitive IDs.

- `components/community/dzn-live-presence-counter.tsx`
  - Adds the DZN-branded counter UI.
  - Shows static fallback counts unless `NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED=true`.
  - Starts bounded heartbeat refresh only when the client display flag is enabled.
  - Avoids browser storage, beacons, WebSockets, EventSource, analytics/tracking, checkout calls, and provider calls.

- `components/community/dzn-comms-visual-shell.tsx`
  - Replaces mock online pills on public Comms areas with `DznLivePresenceCounter`.
  - Keeps private group mock member count static.
  - Keeps the static prototype marker and disabled/non-sending composer.

- `docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md`
  - Adds the Safe Monetisation and Supporter System backlog contract.
  - Records that the decision supersedes the earlier paid-spin idea.
  - Locks spins to earned-only website activity.
  - Records future DZN Store, Founding Supporter Pack, payment, UI, and acceptance criteria.
  - Keeps the store/supporter system backlog-only in this slice.

- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md` and `docs/PUBLIC_ACCESS_POLICY.md`
  - Wire in the Safe Monetisation backlog.
  - Mark the DZN Comms live presence counter foundation as the delivered first runtime slice.
  - Add the public access policy for `/api/dzn-comms/presence` and the `/community` counter.

- `scripts/test-dzn-comms-live-presence-counter.ts`
  - Adds focused runtime and static safety tests.
  - Proves disabled-by-default read/write behavior.
  - Proves aggregate-only output, TTL expiry, hashed presence keys, route count ownership, invalid-scope fallback, no-store headers, and static UI fallback.
  - Proves no chat APIs, moderation tables, support-bot runtime, AI/provider dependencies, analytics/tracking, store/payment runtime, live checkout, Stripe, Nitrado, Discord mutation, billing, ranking, scoring, XP, calling-card, review, event, Server Wars, CTF, public profile visibility, retained export, moderation, or competitive-eligibility coupling.

- `scripts/test-dzn-comms-interaction-contract-preflight.ts` and `scripts/test-dzn-comms-runtime-approval-preflight.ts`
  - Updated to allow only the approved presence counter route/table while continuing to block actual chat/support/moderation/provider runtime.

## Feature Flags

All runtime behavior remains disabled unless flags are explicitly enabled:

- `DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED`
- `DZN_COMMS_PRESENCE_READ_ENABLED`
- `DZN_COMMS_PRESENCE_WRITE_ENABLED`
- `NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED`

No `wrangler.toml`, Cloudflare secret, production variable, or deployment configuration is changed in this slice.

## Access And Entitlement Matrix

| Surface | Boundary |
| --- | --- |
| `/community` counter | Static fallback by default; public aggregate count only when client and server flags are enabled |
| `GET /api/dzn-comms/presence` | Public aggregate read when `DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED=true` and `DZN_COMMS_PRESENCE_READ_ENABLED=true` |
| `POST /api/dzn-comms/presence` | Short-lived heartbeat write when `DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED=true` and `DZN_COMMS_PRESENCE_WRITE_ENABLED=true` |
| Free Discord players | No Starter/Pro required for the aggregate counter |
| Starter/Pro owners | Same public aggregate as everyone else; no owner or billing effect |
| Future message sending | Still blocked |
| Future private groups | Still blocked |
| Future moderation runtime | Still blocked |
| Future DZN Assist AI runtime | Still blocked |
| Future DZN Store/supporter system | Backlog/spec only in this slice |

## Protected Surfaces

The counter must not expose or store:

- Names.
- Discord IDs.
- Raw DZN user IDs.
- Profile handles.
- IP addresses.
- User agents.
- Referrers.
- Routes.
- Page history.
- Journey history.
- Billing state.
- Owner entitlement.
- Server ownership.
- Nitrado identifiers.
- Review identifiers.
- Event identifiers.
- Challenge identifiers.
- Scoring identifiers.
- Competitive identifiers.

## Fair Progression Boundary

The presence counter cannot affect billing, owner entitlement, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

The Safe Monetisation and Supporter System backlog preserves the same boundary: future store purchases may buy guaranteed account-bound cosmetics/supporter recognition only and must never buy spins, XP, ranking advantages, better reward odds, tournament advantages, review/discovery advantages, Server War scoring advantages, or competitive eligibility.

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
- Moderation tables.
- AI provider credentials.
- Vector stores.
- Metered model calls.
- Analytics/tracking systems.
- Deployments.
- Issue #49.

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.

## Validation Targets

- `npm run test:dzn-comms-live-presence-counter`
- `npm run test:dzn-comms-runtime-approval-preflight`
- `npm run test:dzn-comms-interaction-contract-preflight`
- `npm run test:dzn-comms-visual-shell`
- `npm run test:dzn-chat-support-architecture-preflight`
- `npm run test:player-owner-access-foundation`
- `npm run test:player-hub-foundation`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`
- Static production-mutation scans.
- Codex Security diff review.

## Next Recommended Slice

Next should be the DZN Safe Monetisation and Supporter System implementation preflight: define the real production store/catalog/order/payment/spin-ledger/supporter-card architecture, migrations, feature flags, webhook verification, idempotent fulfilment, refund/chargeback handling, admin pricing controls, tax/receipt record boundaries, rollback plan, and security proof before any one-time Stripe Checkout Sessions, store routes, payment webhook fulfilment, supporter card issuance, earned-spin ledgers, wheel runtime, account entitlement writes, live checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, or issue #49 changes.
