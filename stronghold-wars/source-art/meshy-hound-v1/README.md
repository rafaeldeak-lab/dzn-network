# DZN Hound, levels 1–5

These five models follow the owner's armoured robotic Hound concept. Each level has a separate transparent reference, image-guided Meshy source mesh, and textured game model. The armour, optics, and silhouette grow progressively heavier through Level 5.

The models were generated with Meshy T2.5, Smart Topology, and a 15,000-polygon target, then normalized, skinned, and animated in Blender. The game GLBs contain four articulated legs, head and tail bones, and Idle, Walk, Run, Alert, and Pounce actions. The proof renders show three poses at every level; the actual Level 5 game preview was also visually checked.

Meshy used 85 existing credits: 15 per level plus an optional 10-credit Level 1 texture refinement. No credits were purchased. The [manifest](../../preview/assets/models/defenders-v5/manifest.json) records hashes, triangle counts, animation names, and source references. `tools/rig-meshy-hound.py` reproduces the rigs; `tools/package-meshy-hound.py` validates the exports.

These models are for the browser-local Stronghold preview. They do not enable real account access or server battles.
