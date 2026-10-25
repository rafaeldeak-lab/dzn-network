# DZN Stronghold Wars review package

This directory carries the existing Rosebud AI game into the DZN repository for
code and asset review. The playable Rosebud project is
https://rosebud.ai/edit/57892787-5e89-4c9b-bb59-dde128e859ae.

## Current boundary

The [user-supplied Apex expansion addendum](briefs/apex-expansion.md) is appended to the existing shared-base plan. [Gameplay coverage](GAMEPLAY_COVERAGE.md) tracks the playable local loops and the remaining milestones. The current local preview includes an Operations Board with three selectable DZN commanders, a bounded PvE salvage extraction with a rapid pickup or hazardous full-cargo hold, temporary Field Upgrades, finite recovery, community signals, saved after-action field records and an evidence-backed personal showcase. It reuses the existing army and resources. A spatial mission arena remains separate work. These missions are browser-local and never submit live war, membership or reward records.

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

The newest local-preview stage adds an owner-controlled base layout, five-tier
wall segments, timed war objectives, and revised 3D Lumber Yard and squad
models. These remain fictional browser-saved gameplay. The real DZN bootstrap
below is still read-only; no live server member can change a base or start a
war through the DZN backend yet.

## Base layout and timed war objectives

`preview/layout-grid.js` defines the two-metre grid, four district boundaries,
building footprints, collision checks, and wall tier costs. The owner preview
role can move structures within unlocked land, place individual walls or a
straight row, move wall segments, and upgrade a single segment or a row.
Actions spend personal Parts and Timber atomically, reject overlap and locked
plots, and use action IDs so retries do not double charge. The Hall caps wall
count and tiers. Building positions and wall tiers persist with older V3 saves,
and war snapshots freeze the defended layout when a challenge is accepted.
Canvas 2D retains usable layout controls when WebGL is unavailable.

War deployments now open a tactical order before committing the one-use squad.
Players pick west, south or east entry; a Command Hall, Arc Battery or Comms
objective; and a direct breach or covered flank. `preview/war-tactics.js`
calculates route, wall pressure, score and casualty changes from the accepted
defender snapshot. The 3D replay follows those waypoints, opens the selected
wall segments and shows troops withdrawing under counterfire. The after-action
record retains the choice across save reloads; old attacks without an order
keep their original score and replay compatibility. This remains deterministic
browser-local scoring, not a live player-controlled combat server.

During the replay, the deployed member can issue one contact order and one
withdrawal order. Focus fire and pressing the target earn bounded points with
extra squad risk; smoke and covered withdrawal protect troops at a score
tradeoff. Orders visibly change counterfire, smoke, casualties and the final
attack score. The service allows only the deployed squad owner to issue each
phase once, records action IDs for safe retries, and persists both orders in
the war timeline, save and resolved replay. The command window closes after
the fight; older attacks remain readable. These commands are still local
preview mechanics and do not grant real DZN server access.
If the page reloads during a recent deployment, War Table offers Resume
attack for up to 45 seconds while either field order remains unused. The
recorded orders and result remain intact, and the resumed fight cannot spend
a second deployment.

The active war's ten-minute attack period has three one-time objectives:
Forge Convoy, Relay Capture, and Tower Stand. Each opens in a timed stage,
requires the corresponding support building and personal resources, and can be
completed by an eligible member on the frozen roster. Both sides see stage
progress and scores. War resolution waits for the full attack period, even if
the attack cap is reached early. This is local preview scoring only.

`tools/generate-walls.mjs` produces five original tiered wall GLBs under
`preview/assets/models/walls/`. The updated facility generator produces five
`timberline_v4` models with rounded, textured roofs and moving saw, conveyor,
carriage and crane machinery; the updated
squad generator produces 25 `squads-v5` models with curved armour and role
equipment. These are procedural interpretations of the supplied concepts, not
fully scanned or rigged character meshes. Their held weapons and tools now
follow the animated arm pivots. Patrols commute directly between assigned
buildings and camp, pause for role-specific work at stops, and path
around occupied grid cells and walls. The generators and asset checks are
reproducible without paid services.

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

The review copy has fourteen original, reproducible scenery GLBs under
`preview/assets/models/scenery/`: five revised pine growth stages with separate
3D boughs and needle sprays, a stump,
log stack, boulder, claim marker, fallen trunk, ferns, mossy rock cluster,
brush pile and lumber pallet. `tools/generate-scenery.mjs` creates them with
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

The five Timberline Lumber Yard GLBs now have distinct tier machinery, sawing
equipment, log handling, roofs and embedded wood/metal textures. The model
files are larger because the textures are packed into each GLB for Rosebud.
Rosebud retained the previous asset names when the upgraded files were
uploaded and assigned numbered suffixes (`-2` for the yards and some props,
`-3` for the final revised pines). The preview loads those new variants; the
review copy includes identical aliases so the same paths work locally. No
paid model generation or credits were used.

## World routes and First Edition cards

The existing world texture now sits in a draggable, keyboard-accessible zoom
viewport with smaller map pins. Search filters the fictional Pro server roster,
and selecting another base opens a read-only construction and equipment view.
The route briefing uses illustrative regional markers to estimate great-circle
distance, mobilisation and travel time. It also shows a bounded risk tier.
Winning a local preview war grants participating players on the winning side
up to 1.6 times the usual preview Parts reward, with the same once-only ledger
IDs and immutable war snapshots. Travel is a planning estimate; preview attacks
still use accelerated timers. Neither coordinates nor the Pro roster come from
live DZN accounts.

Guardian, Ghost and Fixer First Edition artwork is stored under
`preview/assets/cards/` with checksums. The Cards panel ties its three local
collection marks to existing base milestones. The art and milestones are real
preview content; no globally scarce number, ownership, trade or card buff has
been issued. A production card system would need a reviewed server-side ledger
with explicit issuance rules and abuse controls.

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

The Server Chronicle records completed Hall/support projects, defender upgrades,
land claims, district facilities, supply routes and resolved local wars in a bounded,
replay-safe per-community log. Verified preview members can view their own
community's history while owner Pro is active. Older saves display completed
work without fabricating dates. The Chronicle is cosmetic and never changes
funding, war scores, DZN rankings or live server data.

## DZN equipped squads

`node tools/import-squad-sheets.mjs` extracts the owner's final
transparent five-stage Warden, Ghost, Fixer, Sentinel and Lifeline lineups into
25 individual 768px PNGs under `preview/assets/portraits/squads-final/`.
The corrected final Sentinel and Fixer sheets are the selected sources. A
transparent-seam extraction keeps weapons and packs in frame, and the manifest
records source names, source and output SHA-256, pixel bounds and image sizes.
`test-assets.mjs` validates each final portrait. The owner-supplied sheets are
stored unchanged under `source-art/squads/` for reproducibility; this process
does not redraw the characters. `review/squad-progression-contact.png` shows
all 25 exported stages together.

Base patrols, practice raiders and local war squads use 25 articulated 3D
GLBs in WebGL, with role equipment and visual changes from Level 1 to 5.
Patrols walk along paths between the compound buildings and squad camp,
pause at assigned stops, and turn toward their next destination. The exact
owner-supplied artwork remains in the Armoury; Canvas 2D uses flat portraits
as a compatibility fallback. The active WebGL folders are `squads-v6` for
Warden, `squads-v7` for Ghost, `squads-v12` for Fixer, `squads-v9` for
Lifeline and `squads-v11` for Sentinel. These Rosebud image-guided models
are textured 3D interpretations of the single-view concept sheets. The
earlier procedural models remain under
`preview/assets/models/squads/`, `preview/assets/models/squads-v2/`, and
`preview/assets/models/squads-v3/` for comparison and are no longer selected
in WebGL. `tools/generate-squads.mjs` creates the older `squads-v5` kit.

The Fixer's five `squads-v12` GLBs reuse the retained image-guided static
sources from `squads-v8`. `tools/rig-rosebud-operative.py` places the axe-side
hand bone at the visible glove, weights the axe and glove to that hand, and
steadies it during the walk. `tools/package-steady-fixer.mjs` records the
unchanged source hashes and the revised output hashes. This local rig pass
used no additional generation credits. The Rosebud editor contains all five
new GLBs and selects this folder for Fixer patrols.

Warden Levels 1–5 now use five distinct textured models generated with
Rosebud's Create > 3D Model tool. The static Rosebud source GLBs remain in
`source-art/squads/`; `tools/rig-rosebud-warden.py` binds each to a skeleton and
adds a walking clip with Blender. The rigged files live in
`preview/assets/models/squads-v6/`, whose manifest records Rosebud job IDs,
source and output hashes, mesh sizes, skins and animation names. A separate
textured Rosebud carbine is also stored there and carried at the Warden's
right side; its source and checksum are in the same manifest. The game
clones the skinned models per soldier, plays the walk clip while travelling,
and falls back to the previous Warden model if a new model fails to load.
The real Rosebud editor has the same five files and game mapping. Its saved
WebGL preview loaded with no game-console errors and reported all 25 local
service checks passing. `review/rosebud-rig-l1-frame7.png` through
`review/rosebud-rig-l5-frame7.png` show one walking frame for every tier;
`review/rosebud-warden-carbine-webgl-preview.png` captures the current direct
Rosebud game preview. This improves Warden body, outfit and weapon detail;
the carbine is carried at the hip while walking rather than gripped by both
hands. A matching shield and combat-ready carry animation still need a 3D
gear pass. The other four classes and base defenders
still use their earlier procedural 3D interpretations.

The Operations Board now has three Rosebud-generated, textured 3D commanders:
Rivet, Signal and Remedy. Their original GLBs are retained in
`source-assets/operatives/`; the game-ready GLBs are in
`preview/assets/models/operatives/`. `tools/rig-rosebud-operative.py` binds each
mesh to a 17-bone rig and exports walk and idle clips. At home, the selected
commander follows its role route between the bivouac and a useful building,
using the existing obstacle-aware patrol grid. It leaves the visible base for
an active expedition and returns when the attempt ends. The three characters
are local-preview operatives; their 3D appearance does not grant membership or
change combat statistics. `test-assets.mjs` verifies the meshes, textures,
rigs, clips and hashes. Blender frame proofs are in `proof/`, and
`review/operative-rosebud-board.png` and `review/operative-rosebud-live.png`
show the published Rosebud Operations Board and base. These are a first 3D
asset pass, with simpler outfit and motion detail
than the owner's full concept sheets. The ordinary squad roles still use their
existing levelled models.

Four more supplied concepts (Guardian, Aegis, Trapper and Hound) are stored
unchanged under `preview/assets/portraits/defenders/`. The 20 procedural GLBs
in `preview/assets/models/defenders/` cover their five appearance levels.
The Armoury lets leadership approve a shared Level 1–5 defender upgrade and
assign its post once members fund it with personal Parts. Each role requires
Command Hall and its specialist building at the appropriate level. Assigned
3D defenders walk between camp and their post; reserve units stay out of
combat. Guardian weakens Assault, Aegis weakens Recon, Trapper delays either
tactic, and Hound reduces the advantage from squads away from home. These
bounded local-preview effects use the accepted-war base snapshot. The Armoury
also lets players inspect any 3D tier at camp without equipping it. The World
Map shows public defender tiers, posts and funding progress.
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
entitlement evidence.

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
4. **Travel with consequences:** stage supply convoys and return trips using
   coarse server regions, visible departure and arrival times, recall rules,
   defence exposure, and one-time reward settlement. Keep travel estimates
   independent of private DayZ coordinates and account locations.
5. **DZN collectibles:** award card appearances for Chronicle milestones, then
   consider numbered seasonal editions only after server-side issuance,
   ownership and transfer rules have been reviewed. Cosmetic flair can include
   a reveal animation and a display case beside the Command Hall.

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
