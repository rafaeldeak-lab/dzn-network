# NukeTown Owner-Supplied ADM Recovery Bundle

This folder is for the one-time audited historical recovery bundle:

`dzn_nuketown_missing_adm_backfill_2026-06-15_to_2026-06-18.zip`

The follow-up backlog evidence bundle adds:

`dzn_nuketown_adm_backlog_2026-06-15_to_2026-06-18_plus_17-02-14.zip`

Raw production ADM logs are intentionally local-only and ignored by git. Extract the owner-supplied files into:

`tests/fixtures/adm/recovery-june-2026/raw/`

The recovery CLI prints SHA-256 hashes during dry run. These hashes identify the owner-supplied local raw files without committing the raw logs.

## Expected Parser Counts

| Source filename | SHA-256 | Expected killed-by-player events | Raw file committed? |
| --- | --- | ---: | --- |
| `DayZServer_PS4_x64_2026-06-15_15-02-23.ADM` | `49c833a133337c15a73651b29760ed94877ab95c563595aa9e80ec3a26798907` | 9 | no |
| `DayZServer_PS4_x64_2026-06-15_16-02-40.ADM` | `ddb9be14120ce1983bd00beb2f269b1f1e7365b882173dfb479396e8231e4033` | 1 | no |
| `DayZServer_PS4_x64_2026-06-15_18-02-40.ADM` | `e7e91d896b9ccd3bf824c6adce62c27713fbd90371a6a0181879b2dd207bcca4` | 5 | no |
| `DayZServer_PS4_x64_2026-06-17_16-01-50.ADM` | `6ce134d9bd68f3f12fb2ce4c43d8f78232b6362f7fb74c352a84a56340f49fe0` | 7 | no |
| `DayZServer_PS4_x64_2026-06-18_10-02-23.ADM` | `677accdbb79962f89ea6616cf8e7fa3b4da5c62746b254fadbb29c6b5cba8952` | 3 | no |
| `DayZServer_PS4_x64_2026-06-18_12-02-41.ADM` | `c2967bac2419e85d5457fe5d4072b13f31f9ff4aff750aac03f1f013f1a114ec` | 21 | no |
| `DayZServer_PS4_x64_2026-06-18_17-02-14.ADM` | `97838ff460f6f6af821fcb166a2c79aa0d00a3e7eb0c7b0423feaf829ea3a90f` | 31 | no |

Expected combined killed-by-player parser count: 46.

Expected combined killed-by-player parser count when the optional `17-02-14` backlog fixture is present locally: 77.

The parser test treats hit lines, post-death hit lines, and environmental `died. Stats>` lines as non-PvP-kill events.
