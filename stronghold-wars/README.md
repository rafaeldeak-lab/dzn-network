# DZN Stronghold Wars review package

This directory carries the existing Rosebud AI game into the DZN repository for
code and asset review. The playable Rosebud project is
https://rosebud.ai/edit/57892787-5e89-4c9b-bb59-dde128e859ae.

## Current boundary

The game service in `preview/game-service.js` uses fictional communities and
browser local storage. Its owner, admin, member, Pro, and membership checks are
simulation rules for gameplay testing. They are not DZN authentication or
authorization. No result here changes DZN server wars, leaderboards, billing,
DayZ data, or production D1 records.

The separate default-off `GET /api/stronghold/bootstrap?serverId=...` foundation
in this branch reads the real signed-in DZN user, exact session expiry, current
Discord membership evidence, active server, and matching active owner/server Pro
subscription. It returns `readOnly: true`, `gameplayReady: false`, and false
gameplay capabilities. Do not treat that response as permission to write game
state or expose the local preview as a live multiplayer game.

## Local review

Run `npm run test:stronghold-preview` from the repository root for the game
service checks. The exported HTML can be served from `preview/` using a local
static HTTP server. The Three.js import map currently loads its pinned version
from `esm.sh`; the game falls back to Canvas 2D if WebGL is unavailable. Test
identities, balances, building progress and wars are local to each browser.
The asset manifest covers the 20 canonical GLB/PNG level pairs plus the four
ground/audio files. The Rosebud export metadata retains its original asset
count; this review copy omits an unused trial Hall model and a duplicate image.
It also omits three Rosebud editor helper scripts that the standalone game does
not use.

## Land and scenery stage

The review copy adds nine original, reproducible low-poly GLBs under
`preview/assets/models/scenery/`: five pine growth stages, a stump, a log stack,
a boulder and a claim marker. `tools/generate-scenery.mjs` generates them with
project-owned geometry, and `manifest.json` records dimensions and SHA-256
hashes. The existing 20 building levels remain intact. The local scene uses
the new trees and props for a denser, deterministic forest and visible plot
changes; Canvas 2D draws equivalent plot states when WebGL is unavailable.

Hall Levels 2–5 open four districts. Verified connected preview members chop
standing trees for personal Timber. After clearing, owner/admin approval opens
the shared claim; members donate Timber to finish it and may build up to three
barricades per claimed plot. All actions live in the local service, with role
and entitlement checks, bounded costs and replay-safe action IDs. Existing
wars freeze the districts and barricades with the base snapshot. Each frozen
defensive barricade reduces a later local Assault score by three points or
Recon by one point. Local war scores never touch DZN competitive records.

The original Rosebud editor remains on the preceding version until these GLBs
and the reviewed code are imported. An empty `assets/models/scenery` folder was
created there, but the browser extension blocked local file transfer. The
original project and its saved progress were not replaced or published.

## Feasible next game slices

1. **Server-backed shared base:** create D1 state and a ledger for Timber,
   Parts, projects and land. Check current session, membership, owner Pro and
   exact server ownership on every protected operation. Give ordinary members
   construction actions; reserve claim and main-building approvals for the
   owner or a separately verified delegate.
2. **Battle over a real base layout:** snapshot the opponent's approved
   districts and defenses when both servers accept. Allow two verified roster
   members per side to choose a target district and tactic. Resolve from the
   immutable snapshot and a bounded action log; keep seasonal ranking rules
   independent of subscriptions and avoid DayZ location data.
3. **Scenery with purpose:** add roads and supply caches on claimed plots,
   repairable barricades after battles, patrol posts, weather visibility and
   cosmetic server banners. These can build on the existing art and deterministic
   map without paid asset or AI services.

## Production integration gate

Before enabling real play, replace the local service with authenticated,
server-authoritative D1 operations. Every mutation must recheck the same real
access facts as bootstrap, use server-generated identity and role, validate
request shape, defend against cross-site writes, and make resource debits,
project completion, war transitions, attack caps and rewards atomic and
idempotent across concurrent requests. Delegated admin needs a verified DZN
authority contract; the bootstrap currently exposes only owner and member.
Migration from browser demo saves into live community state must be an explicit
reviewed import, never an automatic trust of client balances or levels. A
separate security review and deployment decision are required before changing
the default-off flag or advertising live access.
