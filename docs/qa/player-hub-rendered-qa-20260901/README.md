# Player Hub Rendered QA - 2026-09-01

This local artifact proves the rendered `/player` Player Hub states for the profile/progression entry-point polish slice. It uses a headless browser against the local Next app and intercepts only `/api/auth/me`, `/api/dzn-pulse/config`, `/api/player/hub`, and `/api/player/community-memberships/refresh` with sanitized representative JSON.

No production D1, Stripe, Cloudflare secret/config, Nitrado, Discord runtime, Store/payment, live checkout, retained export, analytics, scoring, ranking, discovery, review, progression, or competitive-system mutation is used by this QA harness.

## Captures

| Scenario | Viewport | Screenshot | Proof |
| --- | --- | --- | --- |
| rich | desktop | [screenshots/rich-desktop.png](screenshots/rich-desktop.png) | 25 text/boundary/overlap checks |
| rich | mobile | [screenshots/rich-mobile.png](screenshots/rich-mobile.png) | 25 text/boundary/overlap checks |
| empty | desktop | [screenshots/empty-desktop.png](screenshots/empty-desktop.png) | 10 text/boundary/overlap checks |
| unavailable | desktop | [screenshots/unavailable-desktop.png](screenshots/unavailable-desktop.png) | 7 text/boundary/overlap checks |
| storageFallback | desktop | [screenshots/storageFallback-desktop.png](screenshots/storageFallback-desktop.png) | 11 text/boundary/overlap checks |

## Verified States

- Rich current-player data: followed servers, matched Discord communities, suggested events, relevance badges, profile entry points, and private profile/progression summaries render from the private Player Hub payload.
- Profile/progression proof: safe current-user gameplay summary metrics render without raw player names, raw player ids, public profile handles, privacy-setting writes, or award runtime writes.
- Crowded-event proof: the matched-community event renders as `451/512 servers` and still shows `Matched community`, proving irrelevant registered servers do not hide a relevant private match.
- Empty state proof: followed servers, matched communities, and suggested events show useful empty states.
- Unavailable state proof: a failed Player Hub API response renders the `Player Hub Data Unavailable` fallback.
- Storage fallback proof: unavailable saved-server, community, and event sources render explicit local fallback notices.

## Isolation

- Current-user API responses are browser-intercepted local JSON only.
- Suggested event relevance remains private and presentation-only.
- The screenshots do not include raw Discord guild IDs or owner identifiers.
- The harness asserts no obvious visible interactive-element overlaps in each capture.
- The harness does not send messages, add reactions, report/moderate, call DZN Assist AI, use Durable Objects/WebSockets, or write data.

## Console And Network Notes

### rich / desktop

Console warnings/errors: none captured.

Network failures: none captured.

### rich / mobile

Console warnings/errors: none captured.

Network failures: none captured.

### empty / desktop

Console warnings/errors: none captured.

Network failures: none captured.

### unavailable / desktop

Console warnings/errors: none captured.

Network failures: none captured.

### storageFallback / desktop

Console warnings/errors: none captured.

Network failures: none captured.
