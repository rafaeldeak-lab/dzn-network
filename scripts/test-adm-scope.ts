import assert from "node:assert/strict";

import { assertAdmWriteScope, type AdmSyncContext } from "../functions/_lib/adm-sync";

const context: AdmSyncContext = {
  linkedServerId: "pandora-linked-server",
  nitradoServiceId: "111",
  serverName: "Pandora DayZ",
  admFileName: "Pandora.ADM",
  syncRunId: "sync-1",
};

assert.doesNotThrow(() => {
  assertAdmWriteScope(context, {
    linkedServerId: "pandora-linked-server",
    sourceServiceId: "111",
    sourceAdmFile: "Pandora.ADM",
  }, "kill_events");
});

assert.throws(() => {
  assertAdmWriteScope(context, {
    linkedServerId: "nuketown-linked-server",
    sourceServiceId: "111",
    sourceAdmFile: "Pandora.ADM",
  }, "kill_events");
}, /wrong linked_server_id/);

assert.throws(() => {
  assertAdmWriteScope(context, {
    linkedServerId: null,
    sourceServiceId: "111",
    sourceAdmFile: "Pandora.ADM",
  }, "kill_events");
}, /without linked_server_id/);

assert.throws(() => {
  assertAdmWriteScope(context, {
    linkedServerId: "pandora-linked-server",
    sourceServiceId: "222",
    sourceAdmFile: "Pandora.ADM",
  }, "kill_events");
}, /wrong Nitrado service id/);

assert.throws(() => {
  assertAdmWriteScope(context, {
    linkedServerId: "pandora-linked-server",
    sourceServiceId: "111",
    sourceAdmFile: "NukeTown.ADM",
  }, "kill_events");
}, /wrong ADM file/);

console.log("ADM server scope guard tests passed.");
