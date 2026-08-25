# DZN Reviews Moderation Dashboard Handoff

## Scope

This slice adds the owner/admin moderation dashboard for the Reviews foundation. It creates a private queue for reported and pending reviews, adds owner reply management from the dashboard, supports report triage actions, and adds internal DZN Pulse notification hooks.

It is stacked on `codex/reviews-foundation-20260825`. Production merge/deploy/migration application: not included.

## Branching

- Base dependency: `codex/reviews-foundation-20260825` / PR #54.
- Slice branch: `codex/reviews-moderation-dashboard-20260825`.
- Production D1 migration application, deployment, and live payment activation: not included.

## Product Contract

Player review submission remains a free logged-in player feature through `/api/player/reviews`.

Moderation is owner/admin tooling:

- `/dashboard/reviews` is the normal owner dashboard route and stays behind the existing `/dashboard` owner entitlement boundary.
- `/owner/reviews` is the DZN admin console entry route. Non-admin owners who reach it still receive only their own entitled server-owner queue from the same API.
- `GET /api/reviews/moderation` returns a private queue of pending, reported, approved, replied, or all reviews.
- `POST /api/reviews/moderation/[reviewId]` handles approve, hold, remove, dismiss reports, save reply, and remove reply.

Normal owners must have active/trialing owner entitlement and can only act on reviews for linked servers they own. Configured DZN admins can triage across servers.

## Notification Hooks

The slice uses `createNotification` only. It does not call Discord dispatch, Discord bot send paths, Nitrado, Stripe, checkout creation, Cloudflare secret writes, or production D1.

Notifications can be created when:

- A public review report threshold moves a review into pending moderation.
- A configured DZN admin updates a server owner's review moderation queue.

DZN Pulse still controls whether notification rows are inserted. If DZN Pulse is disabled, the helper returns without a write.

## Fairness Contract

Reviews and moderation must remain separate from:

- Starter, Pro, legacy effective-Pro normalization, checkout state, Stripe, billing entitlement, and issue #49.
- Server ownership grants, Nitrado linking, Discord guild ownership, Discord bot permissions, or Discord sends.
- Rankings, discovery score, leaderboard rank, server score, K/D, ADM stats, player profiles, kill events, or player events.
- Events, tournaments, Server Wars, seasons, crowns, badges, challenges, XP, calling cards, or competitive eligibility.

Moderation may change public review visibility by approving, holding, or removing a review. It must not turn reviews into paid-plan, ranking, discovery, badge, season, event, or eligibility inputs.

## Validation Checklist

- `git diff --check`
- `npm run test:reviews-moderation-dashboard`
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

## Production Mutation Status

No Stripe, Cloudflare, production D1, Nitrado, Discord, or issue #49 mutation is included.
