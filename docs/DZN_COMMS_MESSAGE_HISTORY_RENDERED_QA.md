# DZN Comms Message-History Rendered Local/Test QA

## Scope

This slice captures rendered local/test proof for the guarded `/community` message-history UI integration.

It does not change runtime chat behavior. The only purpose is to prove that the page renders the approved states safely:

- static fallback when `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED` is disabled
- public-channel read when the client flag is enabled and a seeded local/test route response is available
- unavailable route fallback when the read route cannot supply usable history
- private-group denial when the user lacks the trusted private membership bridge

The screenshots and manifest are stored under:

```text
docs/artifacts/dzn-comms-message-history-rendered-qa/
```

## Rendered States

| State | Client flag | Route behavior | Expected render |
| --- | --- | --- | --- |
| Static fallback | Disabled | Not called | Static DZN Comms prototype remains visible |
| Public-channel read | Enabled | Local Pages route with seeded public local/test D1 rows | Global Chat shows read-only saved history |
| Unavailable route fallback | Enabled | Local Pages route with no usable local D1 message store | Static Global Chat fallback remains visible |
| Private-group denial | Enabled | Local Pages route with no trusted private membership row | Static Pandora Squad fallback remains visible without private bodies |

Each state has desktop and mobile screenshots.

## QA Method

The QA run uses local browser rendering against `/community`.

The client flag is tested both disabled and enabled. Enabled route outcomes are captured through the actual local Cloudflare Pages function route with local/test bindings only. The seeded public success response follows the approved `GET /api/dzn-comms/channels/:channelId/messages` payload contract and includes only public-safe author and message fields.

Private-group denial intentionally omits trusted `pandora-squad` membership for the mock user. The rendered output must show only fallback messaging and static private-group preview content. It must not render denied private message bodies or identifiers.

## Safety Boundary

No chat sending.
No runtime reactions.
No report routes.
No moderation mutations.
No DZN Assist AI runtime.
No Durable Objects/WebSockets.
No analytics/tracking.
No Store/payment/live checkout changes.
No production mutations.
No retained exports.

This QA slice creates no message rows, reactions, reports, moderation records, support transcripts, AI calls, analytics events, browser storage, Store orders, Store entitlements, Supporter Cards, earned spins, reward-wheel state, Stripe objects, Cloudflare config, production D1 writes, Nitrado mutations, Discord mutations, deployment, or issue #49 changes.

The rendered message-history UI cannot affect billing, owner entitlement, server ownership, scoring, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, public profile visibility, retained exports, or competitive eligibility.

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.

## Proof Artifact

The durable proof package includes:

- `dzn-comms-message-history-rendered-qa.json`
- `index.html`
- `README.md`
- desktop and mobile JPEG screenshots for the four requested states

The focused guard is:

```text
npm run test:dzn-comms-message-history-rendered-qa
```

It verifies artifact coverage, screenshot dimensions, non-placeholder JPEG data, static fallback behavior, public-channel read proof, unavailable fallback proof, private-group denial proof, route-request shape, disabled composer state, static reaction-only state, docs, package wiring, and no blocked runtime/provider/production patterns.

## Next Recommended Slice

Next should be DZN Comms message-history QA review and approval: inspect the rendered local/test artifact, decide whether the disabled-by-default UI integration is acceptable for merge, and only then approve a separate merge/deploy path. Runtime reactions, chat sending, report routes, moderation mutations, DZN Assist AI runtime, Durable Objects/WebSockets, analytics/tracking, Store/payment/live checkout, production mutations, retained exports, and competitive-system effects remain blocked until separately approved.
