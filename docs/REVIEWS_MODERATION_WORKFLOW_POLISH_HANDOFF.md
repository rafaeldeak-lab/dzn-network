# DZN Reviews Moderation Workflow Polish Handoff

## Scope

This slice builds on the Reviews Moderation Dashboard foundation. It adds clearer owner/admin review workflow signals without changing the public review model, billing, checkout, discovery, rankings, events, badges, seasons, Server Wars, challenges, XP, calling cards, or competitive eligibility.

Production merge/deploy/migration application: not included.

## Branching

- Base dependency: `codex/reviews-moderation-dashboard-20260825` / PR #55.
- Slice branch: `codex/review-notifications-polish-20260825`.
- Production D1 migration application, deployment, and live payment activation: not included.

## Product Contract

Player review submission remains a free logged-in player feature through `/api/player/reviews`.

The owner/admin moderation workflow now includes:

- Protected queue-wide counts for needs-review, pending, reported, approved, replied, and total reviews.
- Protected notification badges from DZN Pulse unread counts and review-queue-specific unread entries.
- Per-review status history from `server_review_moderation_actions`.
- Admin-only repeated report pattern summaries.
- Admin-only bulk triage for repeated report patterns through `POST /api/reviews/moderation/bulk`.
- A Reviews tab in the normal `/dashboard` owner dashboard.
- Review Control badges and queue metrics in the `/owner` command centre.

## Authorization

- Logged-out users receive the existing login boundary.
- Free logged-in players receive the owner-plan-required boundary for owner moderation.
- Starter trial/active and Pro/effective-Pro owners can read their own queue, badges, and history after entitlement checks.
- Owners can only act on reviews attached to linked servers where `linked_servers.user_id` matches the session user.
- Configured DZN admins can read repeated report patterns and run bulk triage across servers.
- Bulk triage is denied to non-admin owners even when their owner entitlement is active.

## Mutation Scope

Allowed writes:

- `server_reviews` for moderation state changes.
- `server_review_moderation_actions` for audit/history rows.
- `user_notifications` for internal DZN Pulse owner notifications when DZN Pulse is enabled.

Allowed reads:

- `server_reviews`
- `server_review_reports`
- `server_review_moderation_actions`
- `linked_servers`
- `user_notifications`

Not included:

- Stripe checkout activation or Stripe product/price mutation.
- Cloudflare secret updates.
- Production D1 migrations or production data writes.
- Nitrado calls.
- Discord bot sends or Discord resource mutation.
- Issue/PR #49 merge or mutation.

## Privacy

Queue status history exposes action, actor role, reason, and timestamp only. It must not expose reviewer Discord IDs, actor user IDs, actor Discord IDs, owner reply author user IDs, tokens, secrets, webhook URLs, or encrypted blobs.

## Fairness Contract

Review notifications, dashboard badges, status history, owner replies, report patterns, and bulk moderation must remain separate from:

- Starter, Pro, legacy effective-Pro normalization, checkout state, Stripe, and billing entitlements.
- Server ownership grants, Nitrado linking, Discord guild ownership, Discord bot permissions, or Discord sends.
- Rankings, discovery score, leaderboard rank, server score, K/D, ADM stats, player profiles, kill events, or player events.
- Events, tournaments, Server Wars, seasons, crowns, badges, challenges, XP, calling cards, or competitive eligibility.

Moderation may change review visibility by approving, holding, removing, or dismissing reports. It must not turn reviews or moderation into paid-plan, ranking, discovery, badge, season, event, or eligibility inputs.

## Validation Checklist

- `git diff --check`
- `npm run test:reviews-moderation-workflow-polish`
- `npm run test:reviews-moderation-dashboard`
- `npm run test:reviews-foundation`
- `npm run test:public-listing-reviews`
- `npm run test:public-access-gating`
- `npm run test:player-owner-access-foundation`
- `npm run test:player-hub-foundation`
- `npm run test:player-saved-servers`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`

## Production Mutation Status

No Stripe, Cloudflare, production D1, Nitrado, Discord, or issue #49 mutation is included.
