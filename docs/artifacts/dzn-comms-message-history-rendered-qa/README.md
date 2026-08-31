# DZN Comms Message-History Rendered Local/Test QA Artifact

This directory contains the local rendered proof package for `/community`.

Captured cases:

- static fallback
- public-channel read
- login-required fallback
- unavailable route fallback
- private-group denial
- support-static/no-request fallback

Each case has desktop and mobile JPEG screenshots plus a sanitized JSON/HTML report. The manifest records the browser inner text checked immediately before each capture, and the focused test scans screenshot files for blocked clear-text markers.

This is a local/test only artifact. It uses actual local rendering, local request interception for the unauthenticated 401 state, and local Cloudflare Pages function responses with temporary local D1 state where needed. It requires no production services.

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

The proof package cannot affect billing, owner entitlement, server ownership, scoring, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, public profile visibility, retained exports, or competitive eligibility.

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.
