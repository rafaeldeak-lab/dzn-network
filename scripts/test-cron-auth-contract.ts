import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isCronSecretAuthorized, requireCronSecret } from "../functions/_lib/cron-auth";
import type { Env } from "../functions/_lib/types";

const dznEnv = { DZN_CRON_SECRET: "unit-test-secret" } as Env;
const syncEnv = { SYNC_CRON_SECRET: "unit-test-secret" } as Env;

assert.equal(requireCronSecret(new Request("https://dzn.test"), dznEnv)?.status, 401);
assert.equal(requireCronSecret(new Request("https://dzn.test", {
  headers: { "x-dzn-cron-secret": "wrong" },
}), dznEnv)?.status, 401);

const acceptedHeaders: HeadersInit[] = [
  { "x-dzn-cron-secret": "unit-test-secret" },
  { "x-sync-cron-secret": "unit-test-secret" },
  { "x-cron-secret": "unit-test-secret" },
  { authorization: "Bearer unit-test-secret" },
];

for (const headers of acceptedHeaders) {
  assert.equal(isCronSecretAuthorized(new Request("https://dzn.test", { headers }), dznEnv), true);
  assert.equal(isCronSecretAuthorized(new Request("https://dzn.test", { headers }), syncEnv), true);
}

const cronAuthSource = readFileSync("functions/_lib/cron-auth.ts", "utf8");
assert.equal(cronAuthSource.includes("env.DZN_CRON_SECRET || env.SYNC_CRON_SECRET || null"), true);
assert.equal(cronAuthSource.includes("x-dzn-cron-secret"), true);
assert.equal(cronAuthSource.includes("x-sync-cron-secret"), true);
assert.equal(cronAuthSource.includes("x-cron-secret"), true);
assert.equal(cronAuthSource.includes("Bearer"), true);

for (const file of [
  "functions/api/sync/metadata/run.ts",
  "functions/api/sync/adm/run.ts",
  "functions/api/sync/public-snapshots/run.ts",
  "functions/api/sync/discord-posts/run.ts",
  "functions/api/sync/ctf-scorecards/run.ts",
  "functions/api/debug/nitrado-file-read.ts",
  "functions/api/sync/adm/retry-unreadable.ts",
]) {
  const source = readFileSync(file, "utf8");
  assert.equal(source.includes("requireCronSecret"), true, `${file} should use shared cron auth`);
}

const workflowSource = readFileSync(".github/workflows/dzn-adm-sync.yml", "utf8");
assert.equal(workflowSource.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(workflowSource.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(workflowSource.includes('CRON_SECRET="${DZN_CRON_SECRET:-${SYNC_CRON_SECRET:-}}"'), true);
assert.equal(workflowSource.includes("Missing DZN_CRON_SECRET or SYNC_CRON_SECRET"), true);
assert.equal(workflowSource.includes("x-dzn-cron-secret: ${CRON_SECRET}"), true);
assert.equal(workflowSource.includes("x-sync-cron-secret: ${CRON_SECRET}"), true);
assert.equal(workflowSource.includes("x-cron-secret: ${CRON_SECRET}"), true);
assert.equal(workflowSource.includes("Authorization: Bearer ${CRON_SECRET}"), true);
assert.equal(workflowSource.includes("Cron auth failed. Check GitHub secret name/header against DZN endpoint auth helper."), true);
assert.equal(workflowSource.includes("code === 401 || code === 403"), true);
assert.equal(workflowSource.includes("partial_budget_reached"), true);
assert.equal(workflowSource.includes("latest_adm_unreadable"), true);
assert.equal(workflowSource.includes("nitrado_upstream_down"), true);
assert.equal(workflowSource.includes("nitrado_rate_limited"), true);
assert.equal(workflowSource.includes("file_missing_or_rotated"), true);
assert.equal(workflowSource.includes("?cron_secret="), false);
assert.equal(workflowSource.includes("echo \"$CRON_SECRET\""), false);
assert.equal(workflowSource.includes("echo \"${CRON_SECRET}\""), false);

const diagnosticsWorkflowSource = readFileSync(".github/workflows/dzn-nitrado-diagnostics.yml", "utf8");
assert.equal(diagnosticsWorkflowSource.includes("DZN_CRON_SECRET: ${{ secrets.DZN_CRON_SECRET }}"), true);
assert.equal(diagnosticsWorkflowSource.includes("SYNC_CRON_SECRET: ${{ secrets.SYNC_CRON_SECRET }}"), true);
assert.equal(diagnosticsWorkflowSource.includes('CRON_SECRET="${DZN_CRON_SECRET:-${SYNC_CRON_SECRET:-}}"'), true);
assert.equal(diagnosticsWorkflowSource.includes("x-dzn-cron-secret: ${CRON_SECRET}"), true);
assert.equal(diagnosticsWorkflowSource.includes("x-sync-cron-secret: ${CRON_SECRET}"), true);
assert.equal(diagnosticsWorkflowSource.includes("x-cron-secret: ${CRON_SECRET}"), true);
assert.equal(diagnosticsWorkflowSource.includes("Authorization: Bearer ${CRON_SECRET}"), true);
assert.equal(diagnosticsWorkflowSource.includes("?cron_secret="), false);
assert.equal(diagnosticsWorkflowSource.includes("echo \"$CRON_SECRET\""), false);

console.log("Cron auth contract tests passed.");
