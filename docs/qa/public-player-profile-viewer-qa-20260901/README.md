# Public Player Profile Viewer Rendered QA - 2026-09-01

This local artifact proves the rendered public profile shell for published, hidden, unavailable, no-handle, desktop, and mobile states. Because this repo uses `output: export`, local Next dev renders the prebuilt `/players/preview` shell; the production `/players/*` Pages function rewrite is covered by build output and guardrail tests. The harness intercepts only `/api/auth/me`, `/api/dzn-pulse/config`, and `/api/public/players/*` with sanitized JSON.

No production D1, Stripe, Cloudflare secret/config, Nitrado, Discord runtime, Store/payment, live checkout, retained export, analytics, DZN Assist AI, chat route, message persistence, scoring, ranking, discovery, review, progression, or competitive-system mutation is used by this QA harness.

## Captures

| Scenario | Viewport | Screenshot | Proof |
| --- | --- | --- | --- |
| published | desktop | [screenshots/published-desktop.png](screenshots/published-desktop.png) | 16 text/boundary/overlap checks |
| published | mobile | [screenshots/published-mobile.png](screenshots/published-mobile.png) | 16 text/boundary/overlap checks |
| hidden | desktop | [screenshots/hidden-desktop.png](screenshots/hidden-desktop.png) | 9 text/boundary/overlap checks |
| unavailable | desktop | [screenshots/unavailable-desktop.png](screenshots/unavailable-desktop.png) | 7 text/boundary/overlap checks |
| invalidHandle | desktop | [screenshots/invalidHandle-desktop.png](screenshots/invalidHandle-desktop.png) | 8 text/boundary/overlap checks |

## Verified States

- Published profile renders public-safe display name, aggregate gameplay totals, featured server, visible-section badges, future earned-progression copy, and the fair boundary.
- Mobile profile renders the same public-safe contract without obvious interactive-element overlaps.
- Hidden profiles return a generic hidden/not-found state without revealing whether the handle exists.
- Unavailable API responses render the public-safe unavailable fallback.
- Invalid handles show the local profile-link-needed fallback without calling private data.
- The harness asserts no raw Discord IDs, user IDs, player IDs, raw evidence fields, checkout events, or Supporter Card serials appear in rendered text.

## Console And Network Notes

### published / desktop

Console warnings/errors: none captured.

Network failures: none captured.

### published / mobile

Console warnings/errors: none captured.

Network failures: none captured.

### hidden / desktop

Console warnings/errors: none captured.

Network failures: none captured.

### unavailable / desktop

Console warnings/errors: none captured.

Network failures: none captured.

### invalidHandle / desktop

Console warnings/errors: none captured.

Network failures: none captured.
