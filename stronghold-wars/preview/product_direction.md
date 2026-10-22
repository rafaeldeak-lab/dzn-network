# DZN: Stronghold Wars — product direction

- The intended product is for eligible servers whose owner has active DZN Pro and their verified connected members.
- A server shares one community base; individual members do not each purchase Pro.
- Members contribute/craft Parts to fund shared upgrades and participate in wars against sufficiently developed eligible Pro servers.
- Members clear trees, keep personal Timber, fund owner-approved land claims, and build limited shared barricades. Hall Levels 2–5 unlock four districts in order.
- Each claimed district has a five-tier original DZN facility: Timberline yields personal Timber daily, Ridgewatch supports Assault, Signal Marsh supports Recon, and Highland Works protects against both. Leadership approves every tier; verified members supply Parts and Timber.
- Salvage recycling keeps Timber renewable after the finite trees are cut. District upgrades use distinct 3D art and a short completion burst with a reduced-motion path.
- Each claimed district can grow a five-tier DZN Supply Route from the Command Hall. Leadership approves each tier, verified members fund it, and the visible route moves from marked dirt to timber, stone, reinforced and illuminated construction. Each tier adds five local personal daily Salvage; routes have no competitive war score effect.
- A five-stage DZN Chronicle Beacon grows with the Hall. The cosmetic Server Chronicle records completed builds, land, routes and local war results for the eligible community, including earlier work from old saves when timestamps are available.
- The World Map uses an original DZN texture and illustrative pins for three fictional preview communities. Visitors may inspect public building levels, land clearing and approved construction scaffolding; private inventories, donations, rosters and precise server positions stay out of this projection.
- During an accepted local war, verified members can send scouts. Scouts take 30 seconds to bring back fixed defensive intel and return after 90 seconds. A squad away from home creates a bounded counterattack advantage; barricades reduce it. Recalling a war squad closes that exposure but trades 25% of its attack points. Timers, scores and recalls survive refresh.
- Original DZN Warden, Ghost and Fixer GLB soldiers have five visible gear tiers each. Patrols, training and war attacks use the equipped models and animated limbs. Hall and the relevant support building control the visual gear tier; the Squads panel and World Map disclose the public tier. Gear is cosmetic and does not add a second battle modifier.
- Current access, communities, balances, and the War Table encounter in this prototype are local demonstrations only.
- Do not add real billing, Discord authentication, account connections, or live multiplayer without a separate explicit product request and appropriate implementation plan.
- Preserve the existing single-player base-builder, assets, local save, and training encounter while repairing or extending the prototype.
- Keep permanent base growth separate from seasonal score, DZN rankings, and real DayZ coordinates.

## Next buildable slices

1. **Battle wear and repairs:** a resolved war creates a bounded, cosmetic damage state for the attacked districts. Members repair it with Timber and Parts; leadership chooses the repair priority. This makes wars leave visible history without permanently destroying paid work.
2. **Community blueprints:** verified members propose one of several cosmetic district arrangements; leadership chooses the approved version. Finished buildings and resource balances stay intact when a layout changes.
3. **Signal convoys:** a short cooperative route event lets members escort local Parts or Timber to an approved project. The route tier changes its visual checkpoints; one-time action IDs and a bounded reward ledger prevent repeated grants.
4. **Server identity:** earned banner cloth, insignia and lighting palettes based on the DZN server's public identity. Cosmetic only, with no ranking or plan advantage.
5. **Targeted raids:** once the DZN server-authoritative layer is reviewed, each verified roster member chooses an opponent district and one tactic within a fixed attack cap. The defender's approved layout is snapshotted at acceptance; no raw DayZ coordinates or client-submitted battle outcomes.

## Globe and live-service integration gate

The existing DZN operational globe supplies public server nodes, but it does not supply Stronghold bases. A live version needs a reviewed server-owned base projection keyed to an approved linked server, with published construction status and coarse locations only. Mutations must check that the acting player is verified and connected to that server and that its owner Pro entitlement is active; main infrastructure approvals must check owner/admin authority. War and scout clocks, action IDs, travel state, caps, scores and rewards must be committed by the server in atomic transactions, never accepted from a browser save. A defending community needs a visible alert and a fair return window before a counterattack resolves. Keep this local World Map explicitly illustrative until those gates exist.

The next technical gate is that reviewed server-side state and transaction design. The local prototype must not be mistaken for a secure live service.
