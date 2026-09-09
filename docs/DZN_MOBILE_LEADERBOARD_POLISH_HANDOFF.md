# Mobile Leaderboard Presentation

## Scope

- Based on main b95efef86dcb55e490a6cefa9cef9977a38520d8 after PR #170.
- Mobile tables retain all metrics and links as labelled rows without horizontal scrolling. Desktop tables remain tables.
- Mobile record art uses a full-width band above the text. The projectile effects and reduced-motion fallback remain intact.
- Beta notice is in normal page flow below the header, not fixed above page content. Dismissal persists when storage is available and still works for the current visit when storage is blocked. Owner-route exclusion remains.
- Last-good leaderboard data is restored after hydration, preserving cached fallback without a mismatched first browser render.
- No migration, API schema, auth, scoring, plan entitlement, payment, import or production configuration changes.

## Verification

- Full npm test passed; final dashboard-loading regression passed after cache-timing change.
- Non-incremental TypeScript passed; Webpack production export passed.
- One repeated build hit the existing TypeScript incremental-cache stack overflow. Existing prebuild cache repair and non-incremental typecheck restored a successful build. No dependency directory was deleted or reinstalled.
- Full lint: zero errors, five pre-existing warnings. Changed-file lint clean.
- `node scripts/qa-mobile-leaderboards.mjs`: 10 built fixture cases at 320, 390, 760, 900, 1440 pixels, each with reduced motion on/off. Long names, all cell labels, no mobile sideways scrolling, loaded art, no browser errors, notice placement/dismissal/reload and no mutations verified. Cached reload is included.
- QA output is untracked under artifacts/mobile-leaderboards; it contains only synthetic data.
- `git diff --check` passed. Human release approval remains separate.

## Follow-ups

Map labels/presentation, advanced plan labels, Server Wars named opponent selection, public-profile empty-stat placeholders, and initial cross-page profile-anchor scrolling are separate changes. No real game identity claim has been fabricated or approved.
