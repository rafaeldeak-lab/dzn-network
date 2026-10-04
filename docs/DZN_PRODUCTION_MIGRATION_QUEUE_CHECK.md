# DZN Production Migration Queue Check

`npm run check:production-migration-queue` is a read-only production preflight. It reads only migration names from the production `d1_migrations` ledger, compares them with the repository's numbered SQL files, rejects duplicate local prefixes, and prints the exact ordered pending queue.

The command is intentionally guarded:

```powershell
$env:DZN_CONFIRM_PRODUCTION_READ_ONLY = "RUN_READ_ONLY_PRODUCTION_MIGRATION_QUEUE_CHECK"
$env:DZN_EXPECTED_PENDING_MIGRATIONS = "0085_games_hub_trivia.sql,0086_games_hub_word_chain.sql,0087_games_hub_hide_seek.sql,0088_store_manual_review_audit.sql"
npm run check:production-migration-queue
```

The optional expected queue makes the check fail when production or the repository has moved. Set it to the literal `NONE` to assert that no migrations are pending; this non-empty sentinel works on Windows PowerShell versions that remove environment variables assigned an empty string. The check also fails when the production ledger contains a migration absent from the current checkout. The checker cannot apply migrations, execute SQL files, edit the ledger, create a recovery bookmark, change Cloudflare configuration, deploy, or enable feature switches.

The read-only check on 4 October 2026 found this production queue, in order:

1. `0085_games_hub_trivia.sql`
2. `0086_games_hub_word_chain.sql`
3. `0087_games_hub_hide_seek.sql`
4. `0088_store_manual_review_audit.sql`

All four ledger rows and all schema objects owned by those migrations were absent. `PRAGMA foreign_key_check` returned zero rows before any activation operation. Each migration still requires its own recovery bookmark, isolated application, ledger/schema/index/constraint/foreign-key verification, zero-row baseline, private flag activation, and authenticated live proof. Do not use the repository's broad `db:migrate:remote` command while more than one migration is pending.
