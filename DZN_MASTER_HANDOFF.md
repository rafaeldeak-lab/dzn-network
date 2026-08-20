# DZN Master Handoff

Last updated: 2026-08-20

Repository: `rafaeldeak-lab/dzn-network`

Canonical remote development branch: `feature/event-platform-performance-foundation`

Canonical clean worktree for this recovery:

`C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-phase0-clean-20260820-155027`

## Branch State

- `main`: production branch. Verified Phase 0 recovery start SHA `71bce2199857093c576935beace91b9f26c20a84`.
- `feature/event-platform-performance-foundation`: active development branch and only source-of-truth branch for this programme. Phase 0 recovery start SHA `75d76f325521d33854974f1f71a07a4fe509bac6`.
- `release/event-platform-phase-2a`: Event Phase 2A release branch. Verified Phase 0 recovery start SHA `b96c755c682a287182c44a6267f0da5a740fff59`.
- PR #15: open and unmerged, base `main`, head `release/event-platform-phase-2a`.
- Divergence at recovery start: `origin/main...origin/feature/event-platform-performance-foundation = 4 46`.
- Divergence at recovery start: `origin/release/event-platform-phase-2a...origin/feature/event-platform-performance-foundation = 0 10`.
- Phase 0 recovery code commit: `96c40f7d648f0b16680dcb80b4d639c4c7157a2e`.
- Phase 0 recovery handoff commit: this document commit.
- Billing Phase 1 linked-server Nitrado integrity code commit: `a9fd8f7be01637fbcd6e6b1f06ffaf23886ceb02`.

Old chat transcripts, interrupted Codex edits, and dirty local worktrees are not Git truth. Use remote branch history and committed files as the source of truth.

The preserved `feature/billing-phase-1-integrity` worktree contains interrupted broader billing-integrity work. It is backed up at:

`C:\Users\rafae\Desktop\DZN-Audits\backups\phase0-dirty-backup-20260820-151344`

Do not apply that preserved patch wholesale. Audit it selectively in a later authorised slice.

## Completed Platform Areas

High-level completed platform work includes ADM ingestion and diagnostics, owner dashboards, billing plan foundations, linked-server allowance reservations, public server and leaderboard presentation, event suggestion Phase 2A foundations, reputation and badge foundations, promotion and visibility systems, DZN Seasons, and Server Wars foundations.

## Billing State

Latest completed billing commits:

- `8db588f8562270ff2eb9a99c94442e9ff68ca639` - linked-server allowance reservation lifecycle.
- `75d76f325521d33854974f1f71a07a4fe509bac6` - reservation-aware linked-server allowance reporting.
- `a9fd8f7be01637fbcd6e6b1f06ffaf23886ceb02` - linked-server Nitrado credential integrity.

Current billing state:

- Reservation lifecycle and reporting are committed on the active feature branch.
- Linked-server Nitrado credential lookup is now exact to authenticated owner and linked-server ID for targeted server-scoped onboarding and Nitrado routes.
- Cross-owner service conflicts are blocked with safe 409 `nitrado_service_already_linked` responses.
- Same-owner duplicate service linking reuses one canonical linked-server ID, safely reassigns same-owner credentials, retires temporary blank drafts as merged, and handles reservations deterministically.
- Client onboarding preserves `validatedLinkedServerId` through direct and browse-services flows and clears stale linked-server state when validation context changes.
- Event Suggestions remains migration `0057_event_suggestions_phase_2a.sql`.
- Billing Integrity is migration `0058_billing_phase_1_integrity.sql`.
- `npm run test:billing-integrity` is the canonical focused billing integrity suite.

## Phase 0 Recovery

This Phase 0 recovery resolved:

- duplicate migration prefix collision between Event Suggestions and Billing Integrity;
- stale Billing Integrity migration filename references;
- missing `test:billing-integrity` package script;
- setup ADM backfill mapper drift against `AdmImportJobProgressResult`;
- missing regression coverage for migration numbering/order/application and setup mapper states;
- absence of a top-level programme handoff.

No deployment, preview workflow dispatch, production workflow dispatch, remote migration, production D1 access, production D1 write, D1 bookmark, secret change, Stripe change, Discord flag change, Discord send, ADM trigger, Nitrado trigger, or scheduler trigger occurred in Phase 0 recovery.

## Production Runtime Warning

Production Pages stable-alias and runtime health must be verified from the deployed runtime, not inferred from Git history. Treat any stable alias, Cloudflare Pages environment, Worker schedule, and runtime secret state as unverified until checked in a separately authorised production-health slice.

## Current Hard Blockers

The repository blockers targeted by Phase 0 are resolved after validation and push. The linked-server Nitrado integrity slice is complete in code commit `a9fd8f7be01637fbcd6e6b1f06ffaf23886ceb02`; the remaining authorized work is the guarded isolated preview slice below.

The canonical clean worktree remains authoritative:

`C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-phase0-clean-20260820-155027`

The older dirty worktree and backups remain frozen and were not modified:

- `C:\Users\rafae\OneDrive\Desktop\DZN-Network`
- `C:\Users\rafae\Desktop\DZN-Audits\backups\phase0-dirty-backup-20260820-151344`
- `C:\Users\rafae\Desktop\DZN-Audits\backups\phase1-linked-server-integrity-20260820-165515`

No preview, deployment, production workflow dispatch, remote migration, production D1 access/write, D1 bookmark, secret/env change, Stripe change, Discord flag/message, ADM trigger, Nitrado trigger, scheduler trigger, or advertising trigger occurred in the linked-server integrity slice.

## Next Authorised Slice

Build and run a guarded Billing Phase 1 isolated preview covering migrations 0057 and 0058, exact linked-server Nitrado credential association, cross-owner conflict protection, same-owner canonical reuse, allowance integrity and onboarding verification. No production deployment or production migration.

## Deferred Areas

- release reconciliation;
- production runtime health;
- final pricing and Stripe contract;
- Discord enablement;
- Operators integration;
- individual movement map;
- Invite Tracker-style visuals;
- cinematic event notifications;
- Server Wars completion.

## Non-Negotiable Rules

- No destructive migrations.
- Do not reset or delete `player_profiles`, kills, deaths, events, sessions, subscriptions, or historical rows.
- Do not create `player_stats`; DZN uses `player_profiles`.
- Do not weaken 401 or 403 endpoint protection.
- Do not expose or copy secrets.
- Do not copy Cloudflare runtime secrets into GitHub.
- Do not make GitHub the primary ADM auto-sync runner.
- Preserve same-category matchmaking enforcement.
- Treat auth, Discord OAuth, Stripe, Nitrado token handling, sync workers, ADM ingestion, and Cloudflare Worker infrastructure as protected systems.
- All changes affecting billing, subscriptions, achievements, reputation, badges, visibility, rankings, or profiles require tests.

## Related Handoffs And Roadmaps

- [DZN Billing Phase 1 Handoff](DZN_BILLING_PHASE_1_HANDOFF.md)
- [Performance Architecture](docs/performance-architecture.md)
- [Event Tournament Roadmap](docs/event-tournament-roadmap.md)
- [Billing Plans](docs/BILLING_PLANS.md)
- [Automation Setup](docs/AUTOMATION_SETUP.md)
- [Sync System Map](docs/SYNC_SYSTEM_MAP.md)
- [Secrets Matrix](docs/SECRETS_MATRIX.md)
- [Dashboard Button Map](docs/DASHBOARD_BUTTON_MAP.md)
- [DZN Seasons System](docs/DZN_SEASONS_SYSTEM.md)
- [Premium Visibility System](docs/PREMIUM_VISIBILITY_SYSTEM.md)
- [Visual Loadout System](docs/VISUAL_LOADOUT_SYSTEM.md)
- [Badge Asset System](docs/BADGE_ASSET_SYSTEM.md)
- [Badge Awarding System](docs/BADGE_AWARDING_SYSTEM.md)
- [Pandora Bot Tracking Review](docs/PANDORA_BOT_TRACKING_REVIEW.md)
