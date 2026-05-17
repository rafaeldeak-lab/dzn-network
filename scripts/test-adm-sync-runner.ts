import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classifyAdmSyncOutcome, isAdmSyncErrorStatus } from "../functions/_lib/adm-sync";
import { parseAdmLines } from "../functions/_lib/adm-parser";
import { isCronAuthorized } from "../functions/api/sync/adm/run";
import type { Env } from "../functions/_lib/types";

assert.equal(classifyAdmSyncOutcome({
  pendingLineCount: 0,
  eventsCreated: 0,
  killsCreated: 0,
  buildEventsStored: 0,
}), "no_new_lines");

assert.equal(classifyAdmSyncOutcome({
  pendingLineCount: 4,
  eventsCreated: 0,
  killsCreated: 0,
  buildEventsStored: 0,
}), "no_supported_events");

assert.equal(classifyAdmSyncOutcome({
  pendingLineCount: 4,
  eventsCreated: 2,
  killsCreated: 0,
  buildEventsStored: 0,
}), "completed");

const connectionOnlyLines = parseAdmLines([
  "AdminLog started on 2026-05-17 at 16:02:20",
  "16:02:25 | Player \"SyncTester\" (id=test-player-1) is connecting",
  "16:02:30 | Player \"SyncTester\" (id=test-player-1 pos=<120.0, 450.0, 22.0>) is connected",
  "16:04:30 | Player \"SyncTester\" (id=test-player-1 pos=<122.0, 451.0, 22.0>) has been disconnected",
]);
assert.deepEqual(connectionOnlyLines.map((line) => line.eventType), [
  "admin_log_started",
  "player_connecting",
  "player_connected",
  "player_disconnected",
]);

assert.equal(isAdmSyncErrorStatus("nitrado_error"), true);
assert.equal(isAdmSyncErrorStatus("write_error"), true);
assert.equal(isAdmSyncErrorStatus("no_new_lines"), false);

const env = { SYNC_CRON_SECRET: "unit-test-secret" } as Env;
assert.equal(isCronAuthorized(new Request("https://dzn.test/api/sync/adm/run", {
  method: "POST",
  headers: { authorization: "Bearer unit-test-secret" },
}), env), true);
assert.equal(isCronAuthorized(new Request("https://dzn.test/api/sync/adm/run", {
  method: "POST",
  headers: { authorization: "Bearer wrong" },
}), env), false);
assert.equal(isCronAuthorized(new Request("https://dzn.test/api/sync/adm/run", { method: "POST" }), {} as Env), false);

const dashboardApi = readFileSync("components/onboarding/api.ts", "utf8");
assert.equal(dashboardApi.includes("/api/sync/adm/run"), true);

console.log("ADM sync runner tests passed.");
