# Cipher Grid Specialist Release

This source release adds a harder six-letter Cipher Grid variant alongside the
existing five-letter field cipher. It does not change the current public game
until both operations below have completed.

## Controlled rollout

1. Record a private D1 recovery point.
2. Apply `0106_games_hub_cipher_grid_specialist.sql` by itself.
3. Verify the migration ledger entry, the rebuilt session table, its primary
   key and unique identifier constraint, the five-or-six-character answer
   constraint, foreign-key integrity, and the preserved row count.
4. Only after that verification, enable
   `DZN_GAMES_CIPHER_GRID_SPECIALIST_ENABLED=true`.

The specialist flag is deliberately absent from production configuration until
the database operation succeeds. With the flag absent or false, Cipher Grid
continues serving only its existing five-letter, five-attempt field ciphers.

## Gameplay boundary

- Five-letter field ciphers keep five attempts.
- Six-letter specialist ciphers have four attempts.
- The selected answer, attempt limit, win decision, and daily XP/parts reward
  remain server-authoritative.
- Old five-letter sessions, including historic six-attempt records, remain
  readable and restartable.
