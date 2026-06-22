import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverMetadata = readFileSync("functions/_lib/server-metadata.ts", "utf8");
const metadataRoute = readFileSync("functions/api/sync/metadata/run.ts", "utf8");
const automation = readFileSync("functions/_lib/automation.ts", "utf8");
const autoUpdateWorker = readFileSync("workers/dzn-auto-update-worker.ts", "utf8");

assert.equal(autoUpdateWorker.includes('cadence: "every-minute"'), true, "Metadata should remain on the one-minute Worker cadence.");
assert.equal(autoUpdateWorker.includes("max_servers: 1"), true, "Scheduled metadata must attempt one bounded server per tick.");
assert.equal(autoUpdateWorker.includes("player_count_stale_ms: 60_000"), true, "Metadata should be due every minute.");

assert.equal(serverMetadata.includes("skipScheduledMaintenance"), true, "Scheduled metadata should use the CPU-safe fast path.");
assert.equal(serverMetadata.includes("if (!skipScheduledMaintenance)"), true, "Schema maintenance must not run on every scheduled tick.");
assert.equal(serverMetadata.includes("candidateLimit"), true, "Scheduler should inspect extra candidates so a valid lock cannot create a false no-op.");
assert.equal(serverMetadata.includes("if (processed >= maxServers) break;"), true, "Candidate scanning must still process at most one real server.");
assert.equal(serverMetadata.includes("markStatusCheckStarted(env, row.guild_id"), true, "Lock acquisition should remain atomic per selected candidate.");
assert.equal(serverMetadata.includes("phase: \"lock_active\""), true, "Fresh locks should be recorded as explicit skipped candidates.");
assert.equal(serverMetadata.includes("metadata_lock_cleanup_after_incomplete_run"), true, "Incomplete attempts should clear their lock in finally.");

assert.equal(serverMetadata.includes("unavailableRetryCutoff"), true, "Unavailable servers need bounded retry backoff.");
assert.equal(serverMetadata.includes("lower(COALESCE(linked_servers.player_count_status, 'unknown')) != 'unavailable'"), true);
assert.equal(serverMetadata.includes("CASE WHEN linked_servers.player_count_last_checked_at IS NULL THEN 0 ELSE 1 END ASC"), true, "Never-attempted servers should sort first.");
assert.equal(serverMetadata.includes("COALESCE(linked_servers.player_count_last_checked_at, linked_servers.metadata_last_checked_at, '1970-01-01T00:00:00.000Z') ASC"), true, "Oldest attempted server should sort first.");

assert.equal(serverMetadata.includes("recordStatusCheckResult(env, {"), true);
assert.equal(serverMetadata.includes("{ skipSchemaEnsure: skipScheduledMaintenance }"), true, "Scheduled status recording should avoid per-run schema/index maintenance.");
assert.equal(serverMetadata.includes("upsertServerPublicCache(env, {"), true);
assert.equal(serverMetadata.includes("shouldPatchHomeStats"), true, "Scheduled route should avoid broad home-stats snapshot rewrites.");

assert.equal(metadataRoute.includes("patchHomeStats: false"), true, "Protected metadata route should not rebuild cached home stats every minute.");
assert.equal(metadataRoute.includes("stale_over_slo_count"), true, "Route diagnostics should expose five-minute SLO failures.");
assert.equal(metadataRoute.includes("stale_lock_count"), true, "Route diagnostics should expose stale lock failures.");
assert.equal(metadataRoute.includes("health_status"), true, "Route diagnostics should expose production health status.");

assert.equal(automation.includes("options: { skipSchemaEnsure?: boolean } = {}"), true, "Automation helpers should keep schema maintenance by default.");
assert.equal(automation.includes("if (options.skipSchemaEnsure !== true)"), true, "Fast path must be explicit.");

console.log("Metadata fairness tests passed.");
