import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backfillScript = readFileSync("scripts/backfill-adm-files.ts", "utf8");
const admSyncSource = readFileSync("functions/_lib/adm-sync.ts", "utf8");
const packageJson = readFileSync("package.json", "utf8");

assert.match(packageJson, /"adm:backfill": "tsx scripts\/backfill-adm-files\.ts"/);
assert.match(packageJson, /"test:adm-backfill": "tsx scripts\/test-adm-backfill\.ts"/);
assert.match(packageJson, /"test:latest-adm-fixtures": "tsx scripts\/test-latest-adm-fixtures\.ts"/);

assert.match(backfillScript, /const mode: Mode = args\.flags\.has\("apply"\) \? "apply" : "dry-run"/);
assert.match(backfillScript, /Production apply requires --remote --apply and --confirm-service-id/);
assert.match(backfillScript, /confirmServiceId !== serviceId/);
assert.match(backfillScript, /OWNER_SUPPLIED_ADM_RECOVERY_SOURCE/);
assert.match(backfillScript, /INSERT INTO adm_import_jobs/);
assert.doesNotMatch(backfillScript, /INSERT INTO kill_events/i);
assert.doesNotMatch(backfillScript, /INSERT INTO player_events/i);
assert.doesNotMatch(backfillScript, /INSERT INTO build_events/i);
assert.doesNotMatch(backfillScript, /INSERT INTO adm_sync_state/i);
assert.doesNotMatch(backfillScript, /INSERT INTO adm_sync_file_state/i);
assert.doesNotMatch(backfillScript, /frontend_token|websocket_token|cookie/i);
assert.match(backfillScript, /source_sha256/);
assert.match(backfillScript, /fallbackKillMatchesPresent/);
assert.match(backfillScript, /Dry run only\. No database changes made\./);

assert.match(admSyncSource, /export const OWNER_SUPPLIED_ADM_RECOVERY_SOURCE = "owner_supplied_adm_recovery"/);
assert.match(admSyncSource, /values\.source === OWNER_SUPPLIED_ADM_RECOVERY_SOURCE[\s\S]*owner_supplied_adm_recovery/);
assert.match(admSyncSource, /const isOwnerSuppliedRecoveryImport = row\.source === OWNER_SUPPLIED_ADM_RECOVERY_SOURCE/);
assert.match(admSyncSource, /cursorAdvanced: !isOwnerSuppliedRecoveryImport/);
assert.match(admSyncSource, /if \(!isOwnerSuppliedRecoveryImport\) \{[\s\S]*await upsertSyncState/);
assert.match(admSyncSource, /if \(!isOwnerSuppliedRecoveryImport\) \{[\s\S]*await recordAdmFileAttempt/);
assert.match(admSyncSource, /source: OWNER_SUPPLIED_ADM_RECOVERY_SOURCE/);
assert.match(admSyncSource, /adm_import_jobs\.source IN \(\?, \?\)/);

console.log("ADM backfill recovery safeguards passed.");
