# ADM Fixture Coverage

The full raw ADM bundle uploaded for the advanced showcase review was extracted locally from:

`C:\Users\rafae\Downloads\dzn_adm_raw_fixtures_bundle.zip`

The archive contained the requested raw files:

- `9724824-log (2).ADM` through `9724824-log (14).ADM`
- `17428528-log (7).ADM` through `17428528-log (23).ADM`
- `DayZServer_PS4_x64_2026-06-06_13-02-07.ADM`

The raw files are intentionally not committed because they are production-style logs and are larger than the regression tests need. The committed fixtures below are trimmed directly from that bundle and preserve the parser patterns needed for deterministic tests.

## Committed trimmed fixtures

- `raw-bundle-combat-survival.ADM`
  - Source lines from `9724824-log (10).ADM` and `17428528-log (10).ADM`
  - Covers killed-by-player lines, normal hit lines, post-death `DEAD` hit lines, Head and Brain hits, environmental `died. Stats>` deaths, unconscious/regained-consciousness lines, connect/disconnect lines, repeated PlayerList snapshots, and position samples.

- `raw-bundle-build-pve.ADM`
  - Source lines from `17428528-log (10).ADM`, `17428528-log (11).ADM`, `17428528-log (12).ADM`, and `17428528-log (13).ADM`
  - Covers `Built wall_base_up`, `Built wall_metal_down`, `Built wall_gate`, `Built level_1_base`, `placed Fence Kit`, `placed Watchtower Kit`, `placed Wooden Crate`, `placed Sea Chest`, `placed Barrel`, `placed Land Mine`, `placed Bear Trap`, `placed Improvised Explosive`, `repaired Fence`, `Dismantled Upper Frame`, `Mounted BarbedWire`, `Unmounted BarbedWire`, `destroyed Gate`, and `folded Fence`.

Synthetic travel and map-exploration tests remain in their dedicated scripts because the public product deliberately stores and exposes only aggregate movement/exploration outputs, not raw routes.
