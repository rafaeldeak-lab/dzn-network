import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { buildAdmBackfillPlan } from "../functions/_lib/adm-sync";
import {
  classifyFetchError,
  errorCodeForHttpStatus,
  recordNitradoFileReadAttempt,
  sanitizeHeaders,
  sanitizeNitradoUrl,
  sanitizeResponseExcerpt,
} from "../functions/_lib/nitrado-diagnostics";

type RecordedBind = unknown[];

class FakePreparedStatement {
  constructor(private readonly binds: RecordedBind[]) {}

  bind(...values: unknown[]) {
    this.binds.push(values);
    return this;
  }

  async run() {
    return { success: true };
  }
}

class FakeDb {
  public binds: RecordedBind[] = [];

  prepare() {
    return new FakePreparedStatement(this.binds);
  }
}

async function main() {
  assert.equal(sanitizeHeaders({ Authorization: "Bearer secret-token", "content-type": "application/json" }), JSON.stringify({ "content-type": "application/json" }));

  const redactedUrl = sanitizeNitradoUrl("https://files.nitrado.net/download?token=super-secret-token-value&signature=abc123&file=dayzps/config/test.ADM&offset=0&count=4096");
  assert.ok(redactedUrl?.includes("token=REDACTED"));
  assert.ok(redactedUrl?.includes("signature=REDACTED"));
  assert.ok(redactedUrl?.includes("file=dayzps%2Fconfig%2Ftest.ADM"));
  const pathRedactedUrl = sanitizeNitradoUrl(`https://files.nitrado.net/${"a".repeat(100)}/download?short=maybe-sensitive&file=test.ADM`);
  assert.ok(pathRedactedUrl?.includes("/REDACTED/download"));
  assert.ok(pathRedactedUrl?.includes("short=REDACTED"));

  assert.equal(errorCodeForHttpStatus(503), "NITRADO_UPSTREAM_DOWN");
  assert.equal(errorCodeForHttpStatus(429), "NITRADO_RATE_LIMITED");
  assert.equal(errorCodeForHttpStatus(401), "NITRADO_UNAUTHORIZED");
  assert.equal(errorCodeForHttpStatus(403), "NITRADO_FORBIDDEN");
  assert.equal(errorCodeForHttpStatus(404), "NITRADO_FILE_NOT_FOUND");

  const timeout = classifyFetchError(new DOMException("The operation timed out", "AbortError"));
  assert.equal(timeout.status, "timeout");
  assert.equal(timeout.errorCode, "FETCH_TIMEOUT");

  const fetchThrew = classifyFetchError(new Error("connect ECONNRESET token=should-not-leak"));
  assert.equal(fetchThrew.status, "fetch_threw");
  assert.equal(fetchThrew.errorCode, "FETCH_THREW");
  assert.ok(!fetchThrew.errorMessage.includes("should-not-leak"));

  const excerpt = sanitizeResponseExcerpt(`error access_token=${"x".repeat(100)} body`);
  assert.ok(!excerpt?.includes("x".repeat(80)));

  const fakeDb = new FakeDb();
  await recordNitradoFileReadAttempt(fakeDb as unknown as D1Database, {
    serviceId: "17428528",
    serverId: "server-1",
    fileName: "DayZServer.ADM",
    filePath: "dayzps/config/DayZServer.ADM",
    method: "download",
    endpointKind: "nitrado_download",
    status: "non_ok_response",
    httpStatus: 503,
    errorCode: errorCodeForHttpStatus(503),
    requestUrlRedacted: "https://api.nitrado.net/services/17428528/gameservers/file_server/download?file=dayzps/config/DayZServer.ADM&token=secret",
  });
  const recorded = fakeDb.binds[0];
  assert.equal(recorded[8], "non_ok_response");
  assert.equal(recorded[9], 503);
  assert.equal(recorded[11], "NITRADO_UPSTREAM_DOWN");
  assert.ok(!String(recorded[16]).includes("secret"));

  const plan = buildAdmBackfillPlan({
    files: [
      { name: "DayZServer_PS4_x64_2026-05-20_06-02-03.ADM", readable: false, readError: "Nitrado download returned HTTP 503" },
      { name: "DayZServer_PS4_x64_2026-05-20_09-01-27.ADM", readable: true },
    ],
    handledFilenames: [],
    existingJobs: [],
    planKey: "partner",
    nowMs: Date.UTC(2026, 4, 21),
    windowHours: 168,
    maxJobsToCreate: 3,
  });
  assert.deepEqual(plan.unreadableFiles.map((file) => file.filename), ["DayZServer_PS4_x64_2026-05-20_06-02-03.ADM"]);
  assert.ok(plan.createFiles.includes("DayZServer_PS4_x64_2026-05-20_09-01-27.ADM"));

  const migration = readFileSync("migrations/0033_nitrado_file_read_diagnostics.sql", "utf8").toLowerCase();
  assert.ok(!migration.includes("drop table"));
  assert.ok(!migration.includes("truncate"));
  assert.ok(!migration.includes("delete from player_profiles"));

  const nitradoSource = readFileSync("functions/_lib/nitrado.ts", "utf8");
  const diagnosticsSource = readFileSync("functions/_lib/nitrado-diagnostics.ts", "utf8");
  assert.ok(nitradoSource.includes("TOKENIZED_EMPTY_BODY"));
  assert.ok(nitradoSource.includes("recordNitradoFileReadAttempt"));
  assert.ok(diagnosticsSource.includes("NITRADO_UPSTREAM_DOWN"));

  console.log("Nitrado file-read diagnostics tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
