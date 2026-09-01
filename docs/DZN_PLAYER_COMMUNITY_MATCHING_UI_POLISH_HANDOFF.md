# DZN Player Community Matching UI Polish Handoff

Date: 2026-08-31

Branch: `codex/player-community-matching-ui-polish-20260831`

Base: stacked on `codex/player-community-matching-bridge-20260831` / PR `#127`.

## Scope

This slice polishes the `/player` matched-community panel only.

- Adds a clearer DZN-styled matched-community panel.
- Separates `Member`, `Admin`, and `Owner` relationship presentation.
- Adds compact summary counters for matched communities, connected public server profiles, and owner/admin relationship rows.
- Adds visible boundary labels: private to the current player, presentation only, and not owner access.
- Adds source-aware empty states for unavailable matching, legacy manageable-guild fallback, and no public DZN matches.
- Keeps linked public server chips as the only action in the panel.

## UI/Read-Only Only

This slice does not add migrations, API routes, backend writes, runtime refresh actions, owner workflows, public directories, profile publication changes, billing, Store, checkout, Nitrado, Discord posting, moderation, analytics, or competitive-system code.

The polished panel consumes the existing private `/api/player/hub` payload and does not change that read model.

## Privacy And Fairness Boundary

- Matched communities are shown only inside the current user's private Player Hub.
- The panel must not expose hidden, unmatched, revoked, or other-user Discord communities.
- The panel must not expose raw Discord guild lists.
- Public profile handles and profile visibility preferences are not read or written.
- Relationship labels are presentation context only and do not grant setup access.
- Owner setup remains behind `/pricing` and the canonical entitlement gate.
- Billing, rankings, discovery score, reviews, events, progression, scoring, Server Wars, CTF, XP awards, calling-card awards, badges, seasons, and competitive eligibility remain isolated.

## Validation

Completed locally in this isolated worktree on 2026-08-31:

- `npm run test:player-community-matching-ui` passed.
- `npm run test:player-community-matching` passed.
- `npm run test:player-hub-real-data` passed.
- `npm run test:player-saved-servers` passed.
- `npm run test:public-access-gating` passed.
- `npm run check:billing-config` passed and reported live checkout remains disabled/not configured.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint -- --ignore-pattern .wrangler/**` passed with existing warnings only.
- `npm run build` passed.
- `npm test` passed.
- `git diff --check` passed.

`npm ci` reported dependency audit warnings in the existing dependency tree; this slice does not change package versions.

## Manual QA Notes

Expected rendered behavior:

- `/player` still requires login before private hub data loads.
- The matched-community panel shows clearer relationship cards for member/admin/owner rows.
- Empty states explain whether matching is unavailable, using the legacy fallback, or simply has no public DZN matches.
- Relationship labels do not offer setup or owner-management actions.
- The only links inside matched-community cards go to public server profiles already present in the private hub payload.

## Next Slice

Recommended next step:

- Review/merge/release PR `#127` first, then retarget/review this stacked UI polish PR. After release, consider a player-controlled Discord membership refresh/status UX slice if players need clearer account refresh feedback.
