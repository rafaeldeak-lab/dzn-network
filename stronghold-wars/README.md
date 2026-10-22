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

The scenery GLBs and land-clearing code were imported into the existing Rosebud
project in the preceding stage. The editor's embedded preview stayed blank,
while the direct game preview rendered and passed the local service checks.

## District facilities and upgrade reveal

Four original facility families now have five GLB models each under
`preview/assets/models/facilities/`: Timberline Lumber Yard, Ridgewatch
Training Range, Signal Marsh Relay and Highland Defence Works. The reproducible
`tools/generate-facilities.mjs` script creates the assets without paid credits;
the facility manifest records each model's dimensions and SHA-256 hash.

After a plot is claimed, an owner or admin approves each facility tier. Verified
members contribute personal Parts and Timber until both costs are met; the
shared model advances once. The Hall level caps facility levels. Timberline
provides daily per-member Timber (20 at Level 1, then 10 more per level).
Members can also recycle 50 daily renewable Salvage into 30 Timber, so an old
save that spent its tree harvest on barricades can still progress. Ridgewatch
adds 2 Assault score per level, Signal Marsh adds 2 Recon score per level, and
Highland Works reduces incoming scores by 2 per level. War snapshots lock those
bonuses alongside the base and barricades when a challenge is made. Existing
war records default missing facility bonuses to zero.

Completed Hall/support and district upgrades trigger a brief DZN reveal banner,
sound cadence, world rings, spark burst and light beam. The banner stays visible
in Canvas 2D, and reduced-motion settings disable the new motion effects.
The local service tests cover funding, replay, entitlement, cooldown, reload and
frozen battle scores; `test-assets.mjs` validates all 20 new GLBs.

## DZN supply routes

The original `tools/generate-routes.mjs` script builds five low-poly GLB tiers
under `preview/assets/models/routes/`, with a manifest of dimensions and
SHA-256 hashes. Routes grow from marked dirt through timber, stone and
reinforcement into illuminated DZN network paths. Claimed districts can each
have one route to the Hall. The camera-facing route corridor avoids the
Command Compound buildings so construction stays visible.

Owner and admin preview roles approve each route tier. Verified members donate
personal Parts and Timber, and the completed route advances exactly once. The
Hall caps route levels. Every built route tier adds five Salvage to each
eligible member's next once-daily local resupply; an entirely level-five route
network adds 100. It changes only this game inventory. Routes do not affect
war scores, existing DZN leaderboards, server events or DayZ data. The
service and asset checks cover roles, replay safety, reload persistence,
cross-community isolation, daily claims and the five distinct GLBs.

## Server Chronicle and beacon

`tools/generate-chronicle.mjs` creates five original DZN Chronicle Beacon GLBs
under `preview/assets/models/chronicle/` before they are used in gameplay. The
manifest records file hashes and bounds, and `test-assets.mjs` checks every GLB.
The in-world beacon follows the saved Command Hall level. Hall upgrades also
trigger a second reveal burst at the beacon; Canvas 2D has a tiered fallback.

The Server Chronicle records completed Hall/support projects, land claims,
district facilities, supply routes and resolved local wars in a bounded,
replay-safe per-community log. Verified preview members can view their own
community's history while owner Pro is active. Older saves display completed
work without fabricating dates. The Chronicle is cosmetic and never changes
funding, war scores, DZN rankings or live server data.

## DZN equipped squads

`tools/generate-squads.mjs` creates 25 original low-poly GLBs: DZN Warden
(Assault), Ghost (Recon), Fixer (construction patrol), Sentinel (heavy tactical)
and Lifeline (field medic), each at five visibly different gear tiers. The
Sentinel follows the supplied recording's black uniform, green optics,
progressive armour and late purple detailing; these are original project models,
not exports from the recording. Every model has named arm and leg pivots for
walking motion. `tools/render-squad-portraits.mjs` renders them into 25 transparent
400px close-up PNGs for the Armoury, so each gear tier can be inspected. The
manifests record dimensions, mesh counts and SHA-256; `test-assets.mjs` checks
all 50 files and the models' animatable limbs.

Base patrols, practice raiders and local war squads now load the actual models.
The Squads panel explains the current equipment; the World Map shows the
opponent's visual gear tier from its public building levels. Command Hall caps
gear, while Watchtower, Communications and Workshop set specialist tiers.
Sentinel unlocks at Hall 4 and Watchtower 3; Lifeline unlocks at Hall 4 and
Workshop 3. An upgrade that raises a tier or unlocks a specialist triggers the
existing reveal burst. Each tier has explicit health, damage, armour and ability
stats. In local preview wars, upgraded kit damage adds a bounded score bonus;
health, armour and Lifeline support reduce casualties. The kit values are frozen
with the pre-war base snapshot. They do not grant access or change live DZN
competition, and preview gear never supplies ownership, membership or
entitlement evidence. A simple silhouette
keeps the local scene usable while GLBs load or if one fails.

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
3. **Scenery with purpose:** add repairable barricades after battles, patrol
   posts, weather visibility and cosmetic server banners. These can build on
   the existing art and deterministic map without paid asset or AI services.

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
