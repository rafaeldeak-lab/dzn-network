# DZN Timberline Lumber Yard: Meshy asset brief

The reference `dzn-timberline-l01-reference.png` is an original DZN concept
generated for this game's Level 1 yard. SHA-256:
`823a3c4eb95e6cdaeecbfe87358c7239cab33d5592c43fffc14b8bb5ae91b2adb`.
It is a design reference, not a playable 3D model. The Level 1 Meshy shell
has been normalized with separate moving machinery and checked in the running
game. The existing `timberline_v4` kit remains the load fallback for Level 1
and the active art for Levels 2-5 until each replacement passes review.

## Original concept prompt

> Create a single production concept image for a game-ready 3D asset: DZN
> Timberline Lumber Yard level 1, a compact military-industrial forest sawmill
> outpost, isolated on transparent background. Isometric three-quarter view
> from slightly above, showing the FRONT and RIGHT sides clearly, entire
> structure fully within frame with generous transparent margin. Distinctive
> high-quality realistic game art, detailed PBR-like textures, rugged but
> restrained design: dark graphite weathered steel frame, charcoal corrugated
> sloped roof with subtle purple edge panels, olive green utility panels,
> lime-green work lamps and discreet DZN insignia on a metal fascia, heavy
> timber posts, open front and rear bay, concrete plinth, stacked rough pine
> logs to one side, lumber pallets, restrained orange hazard stripes.
> Functional bay with visible open space to insert a separate animated saw and
> conveyor later. Strong silhouette legible when viewed small from above.
> Original DZN military sci-fi design, no fantasy/cartoony/blocky style, no
> environment, no trees, no terrain, no people, no vehicles, no weapons, no
> extra buildings, no background, no perspective distortion, no cut off parts,
> no captions or signage other than small DZN marking. One structure only.

## Pilot settings and acceptance

- Target: the existing Three.js Rosebud game, glTF/GLB, Y up. Size after
  normalization: approximately 6.5 m wide, 6.1 m deep, at most 3.5 m high.
- Meshy image-to-3D Smart Topology, Meshy T2.5, 15,000 target polygons,
  texture on, private, one input image. The workspace quoted 15 credits at
  submission, within the owner's 25-credit ceiling for one pilot.
- Keep the open front bay clear. The existing separate saw, rollers, carriage,
  and hook must keep visibly moving after integration. If the result merges or
  obstructs them, reject it or use only suitable parts.
- Check face count, actual GLB size, embedded texture count, front/back/roof
  geometry, legibility at the base camera, materials, footprint, and browser
  performance. Never ship a model based on its thumbnail alone.
- Do not submit Levels 2-5 as separate paid generations until this first model
  passes visual and runtime review. Upgrade levels should add visible equipment
  and protection to the same architectural family: L2 powered log feed; L3
  enclosed cutting station; L4 reinforced loading crane and armoured roof;
  L5 elite DZN processing core with the strongest safety rails and lights.
- Character production is a separate track: reuse the owner's reference
  portraits, require a skinned 3D mesh, walk and idle clips, hand-held equipment
  bound to the correct hand, stable feet, and an in-game patrol check before
  replacing any currently working squad.

The community candidates inspected for this yard were unsuitable: one rustic
mill had about 988,000 faces and a lighter RTS mill had about 9,800 faces but
unfinished flat materials and a style that did not match DZN. These were not
downloaded or used.

## Pilot result

The first generated Meshy model had 14,115 faces. The accepted game GLB is
`preview/assets/models/facilities/timberline_meshy_l01.glb`. A fresh browser
game reached Hall L2, cleared three trees, approved and funded the land claim,
and built this yard at Level 1. The saw carriage, rotor and rollers remain
separate scene nodes so the existing game motion can drive them. The first
runtime pass exposed a pale reflective machinery slab; rougher, lower-metal
materials corrected it in the game. The final Blender review image is
`review/meshy-yard-l01-final.png`.

The quick no-credit Level 2-5 derivatives failed visual review because the
added equipment looked like plain boxes. They are rejected. Give each later
level its own distinct reference and model after a new credit limit is agreed.

## Level 2-5 reference set (concepts only)

These original image references are ready for image-guided modeling. They are
not playable meshes, and no further Meshy generation is implied by their
presence. Each keeps the Level 1 roof, colour language, and open cutting bay
while adding a readable, mechanically plausible upgrade:

| Level | Reference | SHA-256 | New visible equipment |
| --- | --- | --- | --- |
| 2 | `dzn-timberline-l02-reference.png` | `df574680c836036e9e0fbf2d8bcf67d6ef29a52ba604c688612ece024dec5ab0` | Powered log feed, left motor and rollers |
| 3 | `dzn-timberline-l03-reference.png` | `b9a4ae3c2546d31ca4f3d92378879bb4efd9a990a5ef15a72e8d985b76b3d5f6` | Guarded cutting station and extraction duct |
| 4 | `dzn-timberline-l04-reference.png` | `b585adf257e733de0c01a9de9ad65852097efcb893dc05df5a913bb8c8c88058` | Braced log-loading crane and armoured roof |
| 5 | `dzn-timberline-l05-reference.png` | `041c92680d7dc11c243941861b59ec229361c827390376a7e7b3f886f0e1d28c` | Twin exhaust stacks, crane safety platform and control core |

The generated concept art is a geometry reference. Some small fascia lettering
is malformed, so remove that lettering from any accepted mesh and apply an
accurate DZN badge during Blender normalization. Keep the powered feed,
guarded saw and crane as separate moving pieces if they are represented in
the game. A static generated mesh alone does not satisfy those animations.

For each level, use its matching image with Meshy image-to-3D Smart Topology,
texturing on, roughly 15,000 target polygons and a private generation. Keep
the initial result only if its visible shape matches the reference and its
real game-camera view passes inspection. Normalize to the existing Timberline
plot, retain the original yard as a load fallback, and replace one level at a
time after the owner approves an additional numeric credit ceiling.
