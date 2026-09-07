import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { ensureAutomationSchema } from "../../functions/_lib/automation";
import { ensureBillingSchema, ensureStarterTrialClaimSchema } from "../../functions/_lib/plans";
import type { Env } from "../../functions/_lib/types";

type Row = Record<string, unknown>;
type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { run(...values: unknown[]): { changes: number }; get(...values: unknown[]): Row | undefined; all(...values: unknown[]): Row[] };
  close(): void;
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

export class WebhookFixtureDb {
  sqlite = new DatabaseSync(":memory:");
  writes: string[] = [];
  allWrites: string[] = [];
  bindings: unknown[][] = [];
  failNextServerWrite = false;
  failAccountLookup = false;
  failBatchStatement = -1;
  loseBatchResponse = false;
  beforeBatch?: () => Promise<void>;
  afterFirst?: (sql: string) => Promise<void>;
  private batchTail: Promise<void> = Promise.resolve();
  prepare(sql: string) {
    const statement = (values: unknown[] = []) => ({
      bind: (...bindings: unknown[]) => { this.bindings.push(bindings); return statement(bindings); },
      run: async () => {
        if (this.failNextServerWrite && /INSERT INTO server_subscriptions/.test(sql)) {
          this.failNextServerWrite = false;
          throw new Error("Simulated private server write failure");
        }
        const result = this.sqlite.prepare(sql).run(...values);
        if (/^\s*UPDATE (automation_cron_runs|linked_server_allowance_reservations)\b/.test(sql)) assert.equal(result.changes, 0);
        else if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) {
          this.allWrites.push(sql);
          if (!/billing_webhook_(versions|receipts)/.test(sql)) this.writes.push(sql);
        }
        return { success: true, meta: result };
      },
      first: async () => {
        const row = this.sqlite.prepare(sql).get(...values) ?? null;
        await this.afterFirst?.(sql);
        return row;
      },
      all: async () => this.failAccountLookup && /FROM owner_billing_accounts/.test(sql)
        ? { success: false } : { success: true, results: this.sqlite.prepare(sql).all(...values) },
    });
    return statement();
  }
  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    await this.beforeBatch?.();
    const previous = this.batchTail;
    let release!: () => void;
    this.batchTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const start = this.writes.length;
    const allStart = this.allWrites.length;
    try {
      this.sqlite.exec("BEGIN");
      const results = [];
      try {
        for (let index = 0; index < statements.length; index++) {
          if (index === this.failBatchStatement) { this.failBatchStatement = -1; throw new Error("Injected batch failure"); }
          results.push(await statements[index].run());
        }
        this.sqlite.exec("COMMIT");
      } catch (error) {
        this.sqlite.exec("ROLLBACK");
        this.writes.length = start;
        this.allWrites.length = allStart;
        throw error;
      }
      if (this.loseBatchResponse) { this.loseBatchResponse = false; throw new Error("Lost committed response"); }
      return results;
    } finally { release(); }
  }
}

export async function createWebhookFixture(migration = true) {
  const db = new WebhookFixtureDb();
  const env = { DB: db as unknown as D1Database, STRIPE_SECRET_KEY: "sk_test_webhook_fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_webhook_fixture", STRIPE_PRICE_STARTER: "price_starter_fixture", STRIPE_PRICE_PRO: "price_pro_fixture",
    STRIPE_PRICE_PARTNER: "price_legacy_fixture", DZN_LIVE_CHECKOUT_ENABLED: "false" } as Env;
  db.sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT UNIQUE);
    CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT, guild_id TEXT, status TEXT, merged_into_server_id TEXT, listing_visibility TEXT);
    INSERT INTO users VALUES ('user-owner', 'discord-owner'), ('user-other', 'discord-other');
    INSERT INTO linked_servers VALUES ('server-owner', 'user-owner', 'guild-owner', 'pending', NULL, 'private'),
      ('server-other', 'user-other', 'guild-other', 'active', NULL, 'public');`);
  db.sqlite.exec(readFileSync("migrations/0066_billing_checkout_attempts.sql", "utf8"));
  if (migration) db.sqlite.exec(readFileSync("migrations/0067_billing_webhook_reconciliation.sql", "utf8"));
  await ensureBillingSchema(env);
  await ensureStarterTrialClaimSchema(env);
  await ensureAutomationSchema(env);
  db.writes = [];
  db.allWrites = [];
  return { db, env };
}
