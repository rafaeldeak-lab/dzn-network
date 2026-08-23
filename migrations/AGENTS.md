# Migration Rules

Migrations default to additive and data-preserving.

- Before editing migrations, inspect the latest migration number and relevant deployment history.
- Do not renumber migrations that may already be deployed.
- Do not create duplicate migration prefixes.
- Production migration application is a separate release operation and is never implied by merging source.
- Hard stop for destructive protected-data operations, `player_stats`, protected stat resets, or manual ledger rewriting.
- Do not reset/delete `player_profiles`, kills, deaths, events, sessions, subscriptions, or server subscription state.
