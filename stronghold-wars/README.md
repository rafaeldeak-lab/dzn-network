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
