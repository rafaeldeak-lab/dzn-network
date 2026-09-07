import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Env } from "../../functions/_lib/types";

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { run(...values: unknown[]): { changes: number }; get(...values: unknown[]): Record<string, unknown> | undefined; all(...values: unknown[]): Record<string, unknown>[] };
  close(): void;
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

export class CheckoutFixtureDb {
  sqlite = new DatabaseSync(":memory:");
  failNextSessionSave = false;
  failNextClaimRelease = false;
  constructor(readonly statements: string[] = [], readonly bindings: unknown[][] = []) {}
  prepare(sql: string) {
    this.statements.push(sql);
    const statement = (values: unknown[] = []) => ({
      bind: (...args: unknown[]) => { this.bindings.push(args); return statement(args); },
      run: async () => {
        if (this.failNextClaimRelease && /DELETE FROM owner_starter_trial_claims/.test(sql)) {
          this.failNextClaimRelease = false;
          throw new Error("Simulated private claim cleanup failure");
        }
        if (this.failNextSessionSave && /SET stripe_session_id =/.test(sql)) {
          this.failNextSessionSave = false;
          throw new Error("Simulated private DB failure");
        }
        return { success: true, meta: this.sqlite.prepare(sql).run(...values) };
      },
      first: async () => this.sqlite.prepare(sql).get(...values) ?? null,
      all: async () => ({ success: true, results: this.sqlite.prepare(sql).all(...values) }),
    });
    return statement();
  }
  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

export function createCheckoutFixture(options: { statements?: string[]; bindings?: unknown[][]; migration?: boolean } = {}) {
  const db = new CheckoutFixtureDb(options.statements, options.bindings);
  db.sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT UNIQUE, username TEXT, avatar TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT, session_token_hash TEXT, expires_at TEXT, created_at TEXT);
    CREATE TABLE discord_guilds (id TEXT PRIMARY KEY, guild_id TEXT UNIQUE, owner_user_id TEXT, name TEXT, icon TEXT,
      icon_url TEXT, permissions TEXT, is_owner INTEGER, created_at TEXT, updated_at TEXT);
  `);
  if (options.migration !== false) db.sqlite.exec(readFileSync("migrations/0066_billing_checkout_attempts.sql", "utf8"));
  return { db, env: {
    DB: db as unknown as D1Database, STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    STRIPE_PRICE_STARTER: "price_starter_fixture", STRIPE_PRICE_PRO: "price_pro_fixture",
    DZN_APP_URL: "https://local.test", DZN_LIVE_CHECKOUT_ENABLED: "false",
  } as Env };
}

export function checkoutResponseFromRequest(init?: RequestInit, overrides: Record<string, unknown> = {}) {
  const params = new URLSearchParams(String(init?.body ?? ""));
  return {
    id: "cs_fixture", url: "https://checkout.stripe.com/c/pay/cs_fixture", mode: "subscription", status: "open",
    livemode: String(new Headers(init?.headers).get("authorization")).includes("sk_live_"),
    client_reference_id: params.get("client_reference_id"), customer: params.get("customer"),
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    metadata: { discord_user_id: params.get("metadata[discord_user_id]"), plan_key: params.get("metadata[plan_key]"),
      dzn_checkout_attempt_id: params.get("metadata[dzn_checkout_attempt_id]") }, ...overrides,
  };
}

export function checkoutPriceFixture(id: string, livemode = false) {
  if (!["price_starter_fixture", "price_pro_fixture"].includes(id)) throw new Error("Unexpected synthetic Price ID");
  return { id, object: "price", active: true, livemode, currency: "gbp", unit_amount: id === "price_starter_fixture" ? 200 : 1000,
    type: "recurring", billing_scheme: "per_unit", custom_unit_amount: null, transform_quantity: null,
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } };
}
