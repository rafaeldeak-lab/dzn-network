# DZN Review Notification Read State Handoff

## Scope

This slice builds on the Reviews Moderation Workflow Polish branch. It adds an explicit review-alert read/unread flow for owner/admin moderation surfaces and makes DZN Pulse review alerts easier to distinguish from general alerts.

Production merge/deploy/migration application: not included.

## Branching

- Base dependency: `codex/review-notifications-polish-20260825` / PR #56.
- Slice branch: `codex/review-notification-read-state-20260825`.
- Production D1 migration application, deployment, live checkout activation, and issue/PR #49 merge: not included.

## Product Contract

DZN Pulse can now classify review moderation alerts separately from general Pulse notifications.

The owner/admin workflow now includes:

- Dedicated review notification types: `review_needs_moderation`, `review_moderation_alert`, and `review_bulk_triage`.
- A `Reviews` DZN Pulse filter/category with a visible owner-review-alert treatment.
- `POST /api/reviews/moderation/notifications/read` for marking only unread review alerts read.
- A review-alert read button on `/dashboard/reviews`.
- A matching review-alert read button on the normal owner dashboard Reviews panel.

The general DZN Pulse read-all action remains separate. Clearing review alerts must not clear general Pulse alerts.

## Authorization

- Logged-out users receive `401`.
- Free logged-in players receive the owner-plan-required boundary and cannot clear owner moderation alert state.
- Starter trial/active and Pro/effective-Pro owners can clear their own review alert rows after the canonical owner entitlement check.
- Configured DZN admins can clear their own admin review alert rows without requiring an owner plan.
- The endpoint is scoped to the authenticated user's `user_notifications` rows. It cannot clear another owner/admin user's rows.

## Mutation Scope

Allowed writes:

- `user_notifications.read_at` for unread, unexpired review-alert rows owned by the authenticated owner/admin user.

Allowed reads:

- `user_notifications` unread counts for the authenticated owner/admin user.
- Existing authentication/entitlement reads needed by the moderation authorization boundary.

Not included:

- `server_reviews`, `server_review_reports`, or `server_review_moderation_actions` mutation.
- Stripe checkout activation, Stripe product/price mutation, or billing-table mutation.
- Cloudflare secret updates.
- Production D1 migrations or production data writes.
- Nitrado calls.
- Discord bot sends or Discord resource mutation.
- Ranking, discovery, leaderboard, badge, season, event, Server Wars, challenge, XP, calling-card, or competitive eligibility mutation.
- Issue/PR #49 merge or mutation.

## Delivery Audit

Review moderation notifications remain internal DZN Pulse rows in this slice. The code classifies and displays them more clearly, but it does not introduce Discord notification dispatch or external delivery.

If a later slice enables Discord delivery, it must separately audit recipient scoping, opt-out behavior, rate limits, retry behavior, and secret handling before any production send path is enabled.

## Fairness Contract

Review notification read state is private operational metadata. It must never affect:

- Starter, Pro, legacy effective-Pro normalization, checkout state, Stripe, or billing entitlements.
- Server ownership grants, Nitrado linking, Discord guild ownership, Discord bot permissions, or Discord sends.
- Review score, rating average, review count, review visibility, or moderation outcome.
- Rankings, discovery score, leaderboard rank, server score, K/D, ADM stats, player profiles, kill events, or player events.
- Events, tournaments, Server Wars, seasons, crowns, badges, challenges, XP, calling cards, or competitive eligibility.

## Validation Checklist

- `git diff --check`
- `npm run test:review-notification-read-state`
- `npm run test:reviews-moderation-workflow-polish`
- `npm run test:reviews-moderation-dashboard`
- `npm run test:dzn-pulse`
- `npm run test:owner-console`
- `npm run test:dashboard-loading`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`

## Production Mutation Status

No Stripe, Cloudflare, production D1, Nitrado, Discord, or issue #49 mutation is included.
