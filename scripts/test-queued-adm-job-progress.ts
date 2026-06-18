import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const admSyncSource = readFileSync("functions/_lib/adm-sync.ts", "utf8");
const verifierSource = readFileSync("scripts/verify-production-adm-live.ts", "utf8");

assert.match(
  admSyncSource,
  /const pendingJobWorkCompleted = Boolean\(pendingJobs && \(pendingJobs\.chunksProcessed > 0 \|\| pendingJobs\.completedJobs > 0\)\)/,
  "ADM Worker must only treat queued job work as completed when an import chunk advances or the job completes.",
);

assert.match(
  admSyncSource,
  /processedJobs: progressedJobs/,
  "Pending ADM import processing must report progressed jobs, not merely selected jobs.",
);

assert.match(
  admSyncSource,
  /attemptedJobs \+= 1/,
  "Pending ADM import processing must separately count attempted jobs.",
);

assert.match(
  admSyncSource,
  /noProgressJobs \+= 1/,
  "Pending ADM import processing must separately count selected jobs that made no line or chunk progress.",
);

assert.match(
  admSyncSource,
  /current_line - previousCurrentLine/,
  "Queued ADM import progression must compare current_line before and after chunk processing.",
);

assert.match(
  admSyncSource,
  /result\.chunks_processed - previousChunksProcessed/,
  "Queued ADM import progression must compare chunks_processed before and after chunk processing.",
);

assert.match(
  admSyncSource,
  /Date\.now\(\) \+ 1_250 >= deadlineMs/,
  "The import chunk guard should leave a real chunk budget instead of silently selecting an impossible job.",
);

assert.match(
  admSyncSource,
  /maxRuntimeMs: Math\.max\(3_250, Math\.min\(4_500, deadlineMs - Date\.now\(\) - 250\)\)/,
  "ADM Worker active import jobs need a reserved chunk budget before optional discovery.",
);

assert.match(
  admSyncSource,
  /const scheduledDiscoveryFileLimit = Math\.max\(1, Math\.min\(3, admBudget\.maxFilesPerInvocation\)\)/,
  "Scheduled ADM discovery must use a narrow file window instead of a broad scan inside the Worker tick.",
);

assert.match(
  admSyncSource,
  /maxFiles: scheduledBudgeted \? scheduledDiscoveryFileLimit/,
  "Scheduled ADM discovery must respect the bounded discovery file limit.",
);

assert.match(
  admSyncSource,
  /lookbackFiles: scheduledBudgeted \? scheduledDiscoveryFileLimit/,
  "Scheduled ADM discovery lookback must stay aligned with the bounded file limit.",
);

assert.match(
  admSyncSource,
  /maxListDirs: scheduledBudgeted \? 1 : 8/,
  "Scheduled ADM discovery must inspect only one directory unit per Worker tick.",
);

assert.match(
  admSyncSource,
  /maxListSearches: scheduledBudgeted \? 1 : 3/,
  "Scheduled ADM discovery must inspect only one search unit per Worker tick.",
);

assert.match(
  admSyncSource,
  /const scheduledUnreadableRetryLimit = Math\.min\(1, admBudget\.maxUnreadableRetriesPerInvocation\)/,
  "Scheduled ADM discovery must not retry multiple unreadable files in one Worker tick.",
);

assert.match(
  admSyncSource,
  /worker_phase_elapsed_ms/,
  "ADM Worker results must include phase timing diagnostics for future CPU attribution.",
);

assert.match(
  admSyncSource,
  /ADM Worker selected active import job .* no import line advanced/,
  "ADM Worker must surface no-progress active import selections instead of treating them as successful work.",
);

assert.match(
  admSyncSource,
  /pending_import_jobs_no_progress/,
  "Scheduled ADM sync results must expose no-progress job attempts for production diagnostics.",
);

assert.match(
  verifierSource,
  /Readable scheduled ADM import jobs are stuck at line 0 beyond the hard threshold/,
  "verify:adm-live must fail stale readable line-0 queued jobs.",
);

assert.match(
  verifierSource,
  /chunks_processed/,
  "verify:adm-live must report chunks_processed for queued job health.",
);

assert.match(
  verifierSource,
  /created_at/,
  "verify:adm-live must use queued job age to detect starvation.",
);

console.log("Queued ADM job progress regression checks passed.");
