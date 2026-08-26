# Player Public Profile Visual Polish Handoff

Branch: `codex/player-public-profile-visual-polish-20260826`

Base branch: `codex/public-community-member-card-preview-polish-20260826`

Base commit: `bb9de504215651042e38c959736fa5be36383381`

## Scope

This slice makes `/players/[handle]` feel more DZN-branded now that public community member cards can preview already-visible profile sections. It is a public viewer presentation slice only.

The slice adds:

- A cinematic DZN public profile background using existing DZN media assets.
- Subtle slow pan/zoom and signal animation with reduced-motion fallbacks.
- A stronger public profile hero with public dossier pills, visible-section count, and presentation-only messaging.
- A richer public identity card with safe public handle and visible-section signal tiles.
- More branded public-safe cards for XP, challenge progress, calling cards, and timeline rows.
- A focused `test:public-player-profile-visual-polish` contract test.

## Public Boundary

`/players/[handle]` still fetches only `GET /api/public/player-profiles/[handle]`.

The page must not:

- Create public profile handles.
- Write profile privacy preferences.
- Expose hidden profile sections.
- Expose private identifiers, Discord IDs, internal DZN user IDs, source IDs, raw award evidence, or exact award timestamps.
- Create checkout sessions.
- Change owner billing, server ownership, rankings, discovery score, reviews, badges, seasons, events, CTF scoring, Server Wars scoring, XP awards, calling-card awards, retained exports, Nitrado state, Discord resources, Cloudflare secrets, or production D1 state.

## Access Matrix

| Surface | Visitor | Free Discord player | Starter trial/active | Pro active or legacy effective Pro | Enforcement |
| --- | --- | --- | --- | --- | --- |
| `/players/[handle]` | Published profiles only | Published profiles only | Published profiles only | Published profiles only | Public-safe read-only viewer; visual shell is presentation-only |
| `GET /api/public/player-profiles/[handle]` | Published profiles only | Published profiles only | Published profiles only | Published profiles only | Read-only public API; saved privacy preferences decide visible sections |
| `/api/player/profile-privacy` | 401 | Own settings only | Own settings only | Own settings only | Private player-owned settings API; unchanged by this slice |
| Billing, owner setup, Nitrado, retained exports, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, competitive eligibility | No access through this slice | No access through this slice | No access through this slice | No access through this slice | No new dependency on visual profile classes or presentation helpers |

## Isolation Proof

The focused static test checks that:

- The public profile viewer contains the DZN-branded shell, animated background classes, identity card, signal pills, and richer section cards.
- `app/globals.css` contains public profile animation, background, panel, and reduced-motion contracts.
- The viewer still uses the public read-only profile API.
- The viewer does not add client-side POST/PATCH/PUT/DELETE behavior, checkout calls, Stripe secrets, Nitrado tokens, or Discord bot wiring.
- The public profile read model and public API do not depend on visual-only classes.
- Protected influence files do not depend on the new public profile visual classes.

## Live Payment Boundary

Live checkout remains disabled. This slice does not change `DZN_LIVE_CHECKOUT_ENABLED`, Stripe products/prices, Stripe secrets, Cloudflare secrets, production D1, Nitrado, Discord, retained exports, or issue #49.

Issue #49 remains reserved for final live payment activation.

## Validation Targets

Run at minimum:

- `npm run test:public-player-profile-visual-polish`
- `npm run test:public-player-profile-viewer`
- `npm run test:public-community-member-card-preview-polish`
- `npm run test:player-profile-privacy-preferences`
- `npm run test:player-profile-progression-showcase`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `git diff --check`

Use rendered desktop, mid-width, mobile, and reduced-motion smoke checks for `/players/[handle]` with a mocked public profile API response before opening the PR.

## Next Recommended Slice

Next should be public profile owner preview/share polish: let logged-in players preview their public profile exactly as visitors will see it from `/player/profile`, improve copy/share affordances and hidden-section warnings there, and keep proving preview/share controls cannot affect billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, retained exports, or competitive eligibility.
