import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createSession } from "../functions/_lib/db";
import { canAccessOwnerOnboarding, OWNER_ONBOARDING_PLAN_REQUIRED } from "../functions/_lib/owner-onboarding-access";
import { onRequest as validateNitradoToken } from "../functions/api/nitrado/validate-token";
import type { Env, PagesFunction, SessionUser } from "../functions/_lib/types";

type Row = Record<string, unknown>;
type Sqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    run(...values: unknown[]): { changes: number | bigint };
    get(...values: unknown[]): Row | undefined;
    all(...values: unknown[]): Row[];
  };
};

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

class LocalD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  readonly writes: string[] = [];

  prepare(sql: string) {
    const prepare = (bindings: unknown[] = []) => ({
      bind: (...values: unknown[]) => prepare(values),
      first: async <T>() => (this.sqlite.prepare(sql).get(...bindings) ?? null) as T | null,
      all: async <T>() => ({ success: true, results: this.sqlite.prepare(sql).all(...bindings) as T[] }),
      run: async () => {
        this.writes.push(sql);
        const result = this.sqlite.prepare(sql).run(...bindings);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    });
    return prepare();
  }
}

const owner: SessionUser = {
  id: "owner",
  discord_id: "discord-owner",
  username: "Owner",
  avatar: null,
};

function fixture() {
  const db = new LocalD1();
  db.sqlite.exec(readFileSync("migrations/0001_initial_schema.sql", "utf8"));
  db.sqlite.exec(readFileSync("migrations/0012_billing_plans_and_advertising.sql", "utf8"));
  db.sqlite.exec("INSERT INTO users (id, discord_id, username) VALUES ('owner', 'discord-owner', 'Owner')");
  const env = {
    DB: db as unknown as D1Database,
    SESSION_SECRET: "owner-onboarding-access-test-secret",
    MOCK_NITRADO: "true",
  } as Env;
  return { db, env };
}

function setBillingPlan(db: LocalD1, planKey: string, planStatus: string) {
  db.sqlite.exec("DELETE FROM owner_billing_accounts");
  db.sqlite.prepare(
    `INSERT INTO owner_billing_accounts (id, discord_user_id, plan_key, plan_status, created_at, updated_at)
     VALUES ('billing-owner', 'discord-owner', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run(planKey, planStatus);
}

function context(request: Request, env: Env) {
  return {
    request,
    env,
    params: {},
    data: {},
    waitUntil() {},
    next: async () => new Response(null),
  } as Parameters<PagesFunction>[0];
}

async function main() {
  const { db, env } = fixture();
  try {
    assert.equal(await canAccessOwnerOnboarding(env, owner), false, "Accounts without a billing record must not begin owner setup.");

    for (const [planKey, status, allowed] of [
      ["free", "free", false],
      ["starter", "canceled", false],
      ["pro", "incomplete", false],
      ["starter", " TRIALING ", true],
      ["starter", "trialing", true],
      ["pro", "active", true],
      ["premium", "active", true],
    ] as const) {
      setBillingPlan(db, planKey, status);
      assert.equal(await canAccessOwnerOnboarding(env, owner), allowed, `${planKey}/${status} onboarding access`);
    }

    setBillingPlan(db, "free", "free");
    const session = await createSession(env, owner.id);
    db.writes.length = 0;
    let providerCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      providerCalls += 1;
      throw new Error("Owner setup access must be rejected before a provider call.");
    };
    try {
      const response = await validateNitradoToken(context(new Request("https://dzn.test/api/nitrado/validate-token", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `dzn_session=${session.token}` },
        body: JSON.stringify({
          token: "synthetic-token",
          discordGuildId: "123456789012",
          serverType: "PVP",
        }),
      }), env));
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: OWNER_ONBOARDING_PLAN_REQUIRED.message,
        error_code: OWNER_ONBOARDING_PLAN_REQUIRED.code,
      });
      assert.equal(providerCalls, 0);
      assert.equal(db.writes.length, 0, "A denied account must not create a draft server or store a token.");
    } finally {
      globalThis.fetch = originalFetch;
    }

    const guardedRoutes = [
      "functions/api/nitrado/validate-token.ts",
      "functions/api/nitrado/services.ts",
      "functions/api/nitrado/test-adm-path.ts",
      "functions/api/onboarding/save.ts",
      "functions/api/onboarding/test.ts",
      "functions/api/onboarding/go-live.ts",
      "functions/api/onboarding/draft.ts",
      "functions/api/discord/bot-status.ts",
    ];
    for (const route of guardedRoutes) {
      const source = readFileSync(route, "utf8");
      assert.match(source, /canAccessOwnerOnboarding\(env, user\)/, `${route} must enforce the paid owner setup gate.`);
      assert.match(source, /OWNER_ONBOARDING_PLAN_REQUIRED/, `${route} must return the common access error.`);
    }

    const setupSource = readFileSync("components/onboarding/setup-wizard.tsx", "utf8");
    const accessCheck = setupSource.indexOf("if (!canStartOwnerSetup(auth.navigation))");
    const guildLoad = setupSource.indexOf("loadDiscordGuilds(true)");
    assert.ok(accessCheck >= 0 && accessCheck < guildLoad, "Setup must redirect before it loads Discord guilds or onboarding data.");
    assert.match(setupSource, /billingState === "success" \? "confirmation_pending" : "setup_required"/);

    const checkoutSource = readFileSync("components/onboarding/pricing-checkout.tsx", "utf8");
    assert.match(checkoutSource, /cancelReturnTo="\/pricing"/);
    assert.match(checkoutSource, /billing === "setup_required"/);
    assert.match(checkoutSource, /billing === "confirmation_pending"/);

    console.log("Owner onboarding access: inactive plans are denied before setup side effects; active and trialing paid plans remain eligible.");
  } finally {
    db.sqlite.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
