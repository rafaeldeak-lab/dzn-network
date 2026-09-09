# Player Hub Truthful State

## Scope

Step 1 of the product follow-up backlog. Base: `412eb02b5de63fd82f7c067367fbbbf723748bcb`.

- Read the current session user's saved profile opt-in and existing handle in one bounded SELECT.
- Report `published`, `private`, `not_published`, or `unavailable` rather than a hardcoded `not_configured`.
- Return a public URL only when opt-in is enabled and the existing handle is active. Reads never create/reactivate handles or update privacy settings.
- Keep publishing-state and gameplay-read failures independent.
- Return null gameplay totals for absent/unavailable linked data, retain genuine zeros, and display unavailable totals as `--` with explanatory text.
- Offer Edit profile, Game account and (only when published) View public profile actions. Existing preview/share and identity-approval components remain authoritative.
- Refresh the summary after a successful privacy save, clearing the old summary during the cancellable refresh. Failed saves do not produce a new public link.
- Replace internal wording in this summary and reduce the unavailable progression display to a compact list. This does not implement XP, challenges or calling-card awards.

## Validation

- Full `npm test` passed, including payment, identity-linking, public privacy, scoring and competition boundaries.
- New profile-state regression suite executes actual publishing SQL against in-memory SQLite with the existing privacy/handle migrations. It exercises a real signed-session lookup, another account with the same display name, ignored identity query parameters, private/default/disabled/missing-handle states, publication changes, missing tables, independent stats failure, true zero totals and zero attempted writes.
- Existing Player Hub, privacy preferences, owner preview/share and identity-linking tests passed.
- Non-incremental TypeScript passed. Full lint passed with five unchanged baseline warnings; targeted changed-file lint was clean.
- AutoDev audit: all checks passed.
- Scoped security review found no reportable issue. Scan `dbc3c562-587f-41ec-bcd6-4f145a025769` is sealed with partial coverage: its original snapshot preceded final native-anchor/QA refinements and this handoff. The parent separately reviewed the final source delta; do not represent the scan as an immutable review of the final commit or an independent architecture review. Production verification remains excluded.
- Built browser QA: 48 combinations across `/player` and `/player/profile`, six publishing/stat states and widths 1440, 900, 390 and 320. Includes native-anchor navigation, privacy-save refresh, failed-save preservation, no mutations during reads, no page-width overflow, and reduced-motion mobile configurations.
- Rendered QA uses synthetic accounts/API responses and compiled local assets only. No live login, owner claim, provider call, customer charge or database mutation is performed.

## Local Build Notes

This isolated worktree shares an unchanged dependency installation through a junction to avoid duplicating a large generated folder. The normal Turbopack build rejects a dependency junction outside its root. Removing that junction was denied by local tool policy, and no alternate deletion method was attempted.

The explicit Webpack production build passed. A later build encountered the known TypeScript incremental-cache stack overflow; the existing `prebuild` cache helper plus non-incremental TypeScript resolved it, and the final Webpack build passed. The normal Turbopack build must be verified by fresh-checkout CI; do not describe the local default build or complete quality wrapper as passing.

The first QA run exposed repeated URL fragments in Next's same-page fragment navigation. The two profile-section shortcuts now use native anchors, and the compiled-browser checks verify the destination and scroll position. The QA server maps Windows-exported segment files and the existing public-profile shell route to actual built assets. Expected 503 responses occur only in the deliberately failed privacy-save fixture.

Run the optional browser harness after a compiled export with `node scripts/qa-player-hub-profile-state.mjs`. It requires Playwright/Chromium in the local development installation. Set `DZN_PROFILE_QA_PORT` to an unused loopback port and `DZN_PROFILE_QA_OUTPUT` for the evidence directory. `--serve` provides a synthetic, GET-only local preview; it is not a backend emulator or production account.

## Remaining Work And Release Gate

No new migration is needed. No merge or production deployment is part of this implementation. Existing identity claims, billing state, server data, scoring, discovery, rankings and eligibility are unchanged.

This fixes the summary, not proof that the user's real game account is linked. That still requires the separate verified-account reconciliation and live post-release check. The mobile leaderboard/card artwork, map display, beta banner, server labels, Server Wars opponent selector, customer setup and later Comms work remain on the saved product backlog.

The existing fixed beta banner remains visible near the bottom of some narrow-screen captures. Its layout is not changed by this slice; do not describe the whole site's mobile layout as fixed.
