import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createSession } from "../../functions/_lib/db";
import type { Env } from "../../functions/_lib/types";

type Row = Record<string, unknown>;
type Sqlite = { exec(sql: string): void; close(): void; prepare(sql: string): {
  run(...args: unknown[]): { changes: number }; get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[];
} };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

export class GamesLocalD1 {
  sqlite = new DatabaseSync(":memory:");
  beforeBatch: (() => void) | null = null;
  prepare(sql: string) {
    const statement = (values: unknown[] = []) => ({
      bind: (...args: unknown[]) => statement(args),
      run: async () => ({ success: true, results: [], meta: this.sqlite.prepare(sql).run(...values) }),
      first: async () => this.sqlite.prepare(sql).get(...values) ?? null,
      all: async () => ({ success: true, results: this.sqlite.prepare(sql).all(...values) }),
    });
    return statement();
  }
  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    this.beforeBatch?.(); this.sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

export async function gamesFixture(migrate = true) {
  const db = new GamesLocalD1();
  db.sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT, username TEXT, avatar TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT, session_token_hash TEXT, expires_at TEXT, created_at TEXT);`);
  if (migrate) db.sqlite.exec(readFileSync("migrations/0070_games_hub.sql", "utf8"));
  db.sqlite.exec(`INSERT INTO users VALUES ('local-player', '100000000000001', 'Local preview player', NULL),
    ('other-player', '100000000000002', 'Other test player', NULL);`);
  const env = { DB: db as unknown as D1Database, SESSION_SECRET: "isolated-games-test-only", DZN_GAMES_HUB_ENABLED: "true" } as Env;
  const session = await createSession(env, "local-player");
  const otherSession = await createSession(env, "other-player");
  return { db, env, cookie: `dzn_session=${session.token}`, otherCookie: `dzn_session=${otherSession.token}` };
}
