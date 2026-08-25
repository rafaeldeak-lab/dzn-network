# DZN Reviews Foundation Handoff

## Scope

This slice makes reviews a free logged-in player feature, fixes the player review submission path so it no longer posts through owner-gated server-management APIs, and adds owner reply plus moderation audit hooks.

It is stacked on the pricing visual upgrade branch. Production merge/deploy/migration application: not included.

## Branching

- Base dependency: `codex/pricing-visual-upgrade-20260825` / PR #53.
- Slice branch: `codex/reviews-foundation-20260825`.
- Production D1 migration application, deployment, and live payment activation: not included.

## Product Contract

Reviews are a free logged-in player feature. A normal Discord player can submit or update one active review per public server without choosing Starter or Pro.

Owner replies are owner tooling. They are allowed only through the existing owner entitlement boundary plus server owner/admin checks. Owner replies are displayed publicly with approved reviews, but they do not change rating values or competitive outcomes.

Reports are moderation hooks. Reports can move a repeatedly reported review to pending review and record audit actions for later moderation UI.

## Implementation Notes

- `POST /api/player/reviews` handles free player review submission.
- `/api/public/server-reviews?slug=...` remains the read path for approved reviews and viewer state.
- `POST /api/public/server-reviews/[reviewId]/report` records report moderation actions and the auto-pending threshold hook.
- `PUT`/`DELETE /api/servers/[serverId]/reviews/[reviewId]/reply` stores or removes owner replies behind server owner/admin access.
- `server_review_moderation_actions` records player review creation/update, reports, auto-pending, and owner reply actions.
- Public review output includes safe owner reply text/timestamps but does not expose reviewer Discord IDs or owner reply author user IDs.

## Fairness Contract

Reviews must not affect:

- Billing entitlement, checkout state, Stripe, Starter/Pro plan state, or issue #49.
- Server ownership, Nitrado linking, Discord guild ownership, or Discord bot permissions.
- Rankings, discovery score, leaderboard rank, server score, K/D, ADM stats, player profiles, kill events, or player events.
- Events, tournaments, Server Wars, seasons, crowns, badges, challenges, XP, calling cards, or competitive eligibility.

Paid plans must not buy reviews, hide reviews, suppress reviews, boost review scores, alter review averages, or change review ordering for competitive/discovery outcomes.

## Validation Checklist

- `git diff --check`
- `npm run test:reviews-foundation`
- `npm run test:public-listing-reviews`
- `npm run test:public-access-gating`
- `npm run test:player-owner-access-foundation`
- `npm run test:player-hub-foundation`
- `npm run test:player-saved-servers`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run check:billing-config`
- Typecheck, lint, and build when dependencies are installed.
