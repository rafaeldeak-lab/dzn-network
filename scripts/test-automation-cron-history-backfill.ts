import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...values: unknown[]): Record<string, unknown> | undefined;
  };
  close(): void;
};

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => Sqlite;
};

const db = new DatabaseSync(":memory:");
try {
  db.exec(`CREATE TABLE automation_cron_runs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    endpoint TEXT,
    job_type TEXT,
    started_at TEXT,
    finished_at TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  INSERT INTO automation_cron_runs VALUES
    ('legacy-adm', 'cloudflare', 'adm', NULL, NULL, NULL, 'completed', '2026-10-15T00:00:00.000Z'),
    ('legacy-default', 'github', NULL, NULL, NULL, NULL, 'manual', '2026-10-14T00:00:00.000Z'),
    ('current', 'cloudflare', 'metadata', 'metadata', '2026-10-13T00:00:00.000Z', '2026-10-13T00:01:00.000Z', 'success', '2026-10-13T00:00:00.000Z');`);

  const migration = readFileSync("migrations/0103_automation_cron_history_backfill.sql", "utf8");
  db.exec(migration);

  assert.deepEqual({ ...db.prepare("SELECT job_type, started_at, finished_at, status FROM automation_cron_runs WHERE id = 'legacy-adm'").get() }, {
    job_type: "adm",
    started_at: "2026-10-15T00:00:00.000Z",
    finished_at: "2026-10-15T00:00:00.000Z",
    status: "success",
  });
  assert.deepEqual({ ...db.prepare("SELECT job_type, started_at, finished_at, status FROM automation_cron_runs WHERE id = 'legacy-default'").get() }, {
    job_type: "metadata",
    started_at: "2026-10-14T00:00:00.000Z",
    finished_at: "2026-10-14T00:00:00.000Z",
    status: "success",
  });
  assert.deepEqual({ ...db.prepare("SELECT job_type, started_at, finished_at, status FROM automation_cron_runs WHERE id = 'current'").get() }, {
    job_type: "metadata",
    started_at: "2026-10-13T00:00:00.000Z",
    finished_at: "2026-10-13T00:01:00.000Z",
    status: "success",
  });

  // A retry after an interrupted migration is safe and finishes the same repair.
  db.exec(migration);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_cron_runs WHERE job_type IS NULL OR started_at IS NULL OR finished_at IS NULL OR status IN ('completed', 'manual')").get()?.count, 0);
  console.log("Automation cron history backfill is retry-safe and preserves current rows.");
} finally {
  db.close();
}
