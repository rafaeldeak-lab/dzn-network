# DZN Badge Awarding System

Phase 4C connects badge unlock rules to persisted server awards without changing ADM ingestion, Nitrado reads, sync workers, or Stripe webhook processing.

## Automatic Badge Evaluation

Automatic evaluation reads existing stored server data only:

- linked server metadata
- server stats
- current subscription plan key
- public listing state
- existing badge awards and crown holders

It does not import ADM files, call Nitrado, edit kill/death/event/session rows, or run sync workers.

Safe helpers live in:

```text
functions/_lib/badge-evaluation.ts
```

Core helpers:

- `evaluateServerBadgesSafely(env, serverId)`
- `evaluateBadgeBatch(env, options)`
- `evaluateBadgeBatchForAllServers(env, limit)`
- `refreshServerBadgeShowcase(env, serverId)`
- `refreshAllCrownHolders(env, options)`
- `rebuildBadgeProgressForServer(env, serverId)`

Batches are capped to a small safe limit. They are idempotent: permanent awards are not duplicated, and progress rows are updated rather than recreated.

## Admin Evaluation

Protected endpoint:

```text
POST /api/admin/badges/evaluate
```

Body:

```json
{
  "serverId": "optional-linked-server-id",
  "mode": "single",
  "limit": 10,
  "includeCrowns": true
}
```

Allowed roles are configured admin/support/dev users. Normal owners cannot call this endpoint.

Responses include:

- evaluated server count
- new awards
- updated progress count
- crown changes
- skipped servers
- warnings
- public profile refresh status

## Cron Evaluation

Protected endpoint:

```text
POST /api/cron/badges/evaluate
```

This requires the existing cron secret header or bearer token. It evaluates a small batch only, defaulting to 10 servers, and can refresh crown holders. It is intentionally not an unlimited all-server loop.

## Manual Protected Awards

Protected endpoint:

```text
POST /api/admin/badges/award
```

Manual awards are for badges that cannot safely be earned automatically yet, such as:

- founder
- early adopter
- beta veteran
- pioneer
- DZN legend
- exclusive
- top pick
- helping hand
- event champion
- loot master
- seasonal champion badges

Normal owners cannot grant themselves badges. Public owner UI is preview/status only.

## Crown Transfers

Protected endpoint:

```text
POST /api/admin/badges/crown
```

Crown transfers use the existing crown holder helper. When a new server receives a crown, the old holder loses the active crown badge and the new holder receives it. Crown badges are live prestige badges, not permanent achievements.

## Seasonal Badges

Seasonal badges are permanent once awarded. Phase 4C supports admin/event assignment, while future season engines can call the same protected awarding helpers.

## Audit Log

Migration:

```text
migrations/0046_badge_audit_log.sql
```

Table:

```text
badge_audit_log
```

Logged actions:

- `badge_awarded`
- `badge_revoked`
- `crown_transferred`
- `badge_progress_updated`
- `evaluation_ran`
- `evaluation_failed`

Audit rows record the server, badge, previous crown holder when applicable, actor user/role, reason, metadata, and timestamp.

## Owner Dashboard

Owners can see:

- earned badge preview
- locked badge preview and progress
- reputation tier
- current frame
- current theme
- public card preview
- badge evaluation status

Owners cannot manually grant crowns, founder, seasonal, support, or other protected badges.

## Public Profiles

Public server APIs return earned, locked, showcase, crown, and reputation badge fields. The public UI displays the persisted awards with Phase 4A SVG assets and Phase 4B visual mappings.

## Safety Boundary

Badge awarding is separate from:

- ADM discovery
- ADM imports
- ADM parser/build parser
- Nitrado token handling
- Cloudflare sync workers
- player profiles
- kill/death/event/session storage
- Stripe webhooks

Badge evaluation may read existing stats, but it must not rewrite the tracking pipeline.
