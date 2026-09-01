# Public Profile Owner Preview Share Rendered QA - 2026-09-01

This local artifact proves the private `/player/profile` owner preview/share panel renders published, disabled, hidden-response, unavailable, desktop, and mobile states. It uses a headless browser against the local Next app and intercepts only `/api/auth/me`, `/api/dzn-pulse/config`, `/api/player/hub`, `/api/player/profile/privacy`, `/api/player/community-memberships/refresh`, and `/api/public/players/*` with sanitized representative JSON.

No production D1, Stripe, Cloudflare secret/config, Nitrado, Discord runtime, Store/payment, live checkout, retained export, analytics/tracking, DZN Comms runtime, DZN Assist AI, scoring, ranking, discovery, review, progression, award, event, Server Wars, CTF, or competitive-system mutation is used by this QA harness.

## Captures

| Scenario | Viewport | Screenshot | Proof |
| --- | --- | --- | --- |
| published | desktop | [screenshots/published-desktop.png](screenshots/published-desktop.png) | 29 text/boundary/overlap/interaction checks |
| published | mobile | [screenshots/published-mobile.png](screenshots/published-mobile.png) | 26 text/boundary/overlap checks |
| disabled | desktop | [screenshots/disabled-desktop.png](screenshots/disabled-desktop.png) | 13 text/boundary/overlap checks |
| hiddenResponse | desktop | [screenshots/hiddenResponse-desktop.png](screenshots/hiddenResponse-desktop.png) | 12 text/boundary/overlap checks |
| unavailable | desktop | [screenshots/unavailable-desktop.png](screenshots/unavailable-desktop.png) | 12 text/boundary/overlap checks |

## Verified States

- Published current-owner profile renders the same public-safe profile payload a visitor receives, including public handle, safe gameplay totals, and featured server.
- Mobile published profile renders the owner preview/share panel without obvious interactive-element overlap.
- Disabled public profile keeps sharing locked and does not call private identifiers or public visitor data into the rendered text.
- Stale hidden public response keeps sharing locked until the public visitor response is visible again.
- Unavailable public response keeps sharing locked until the public visitor response can be verified.
- Copy controls report current-page-session feedback only, the share control is available for verified public previews, and the interaction proof checks browser storage remains empty.
- The harness asserts no raw Discord IDs, DZN user IDs, player IDs, raw award evidence, checkout events, Store ledgers, or Supporter Card serials appear in rendered text.

## Console And Network Notes

### published / desktop

Console warnings/errors: none captured.

Network failures: none captured.

Interaction proof: {"copyFeedback":true,"handleCopyFeedback":true,"shareControlEnabled":true,"browserStorageWrites":0}.

### published / mobile

Console warnings/errors: none captured.

Network failures: none captured.

Interaction proof: not required for this state.

### disabled / desktop

Console warnings/errors: none captured.

Network failures: none captured.

Interaction proof: not required for this state.

### hiddenResponse / desktop

Console warnings/errors: none captured.

Network failures: none captured.

Interaction proof: not required for this state.

### unavailable / desktop

Console warnings/errors: none captured.

Network failures: none captured.

Interaction proof: not required for this state.
