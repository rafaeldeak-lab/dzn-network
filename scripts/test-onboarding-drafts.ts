import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createSession } from "../functions/_lib/db";
import { onRequest as draftRoute } from "../functions/api/onboarding/draft";
import type { Env, PagesFunction } from "../functions/_lib/types";

type Row = Record<string, unknown>;
type Sqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    all(...values: unknown[]): Row[];
    get(...values: unknown[]): Row | undefined;
    run(...values: unknown[]): { changes: number | bigint };
  };
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };
const setupWizardSource = readFileSync("components/onboarding/setup-wizard.tsx", "utf8");

function d1(sqlite: Sqlite) {
  const prepare = (sql: string, bindings: unknown[] = []) => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    first: async <T>() => (sqlite.prepare(sql).get(...bindings) ?? null) as T | null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...bindings) as T[], success: true, meta: { changes: 0 } }),
    run: async () => {
      const result = sqlite.prepare(sql).run(...bindings);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    },
  });
  return { prepare } as unknown as D1Database;
}

async function invoke(env: Env, cookie: string | null, method: string, body?: Record<string, unknown>) {
  return draftRoute({
    request: new Request("https://dzn.test/api/onboarding/draft", {
      method,
      headers: cookie ? { cookie, "content-type": "application/json" } : { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    params: {},
    data: {},
    waitUntil() {},
    next: async () => new Response(null),
  } as Parameters<PagesFunction>[0]);
}

async function main() {
  const reviewBranch = setupWizardSource.indexOf("if (reviewRequested && linkedServer) {");
  const draftBranch = setupWizardSource.indexOf("else if (draftResult.available && draft) {");
  assert.ok(reviewBranch >= 0 && draftBranch > reviewBranch, "Setup-guide links must take precedence over saved drafts.");
  assert.equal(setupWizardSource.includes("loadOnboardingDraftWithRetry()"), true, "Transient draft reads must be retried before setup continues.");
  assert.equal(setupWizardSource.includes("result: { ok: false, available: false, draft: null }, failed: true"), true, "A failed draft read must keep autosave disabled so unseen progress cannot be overwritten.");
  assert.equal(setupWizardSource.includes("setDraftAvailable(!draftLoadFailed && draftResult.available)"), true, "Autosave availability must require a successful hydration read.");
  const draftRouteSource = readFileSync("functions/api/onboarding/draft.ts", "utf8");
  const schemaProbe = draftRouteSource.slice(draftRouteSource.indexOf("async function hasDraftSchema"), draftRouteSource.indexOf("function serializeDraft"));
  assert.equal(schemaProbe.includes("catch"), false, "Transient D1 errors must not be reported as a missing migration.");

  const unavailableSqlite = new DatabaseSync(":memory:");
  unavailableSqlite.exec(readFileSync("migrations/0001_initial_schema.sql", "utf8"));
  unavailableSqlite.exec("INSERT INTO users (id,discord_id,username) VALUES ('user-a','111111111111111111','Owner A')");
  const unavailableEnv = { DB: d1(unavailableSqlite), SESSION_SECRET: "draft-test-secret" } as Env;
  const unavailableSession = await createSession(unavailableEnv, "user-a");
  const unavailable = await invoke(unavailableEnv, `dzn_session=${unavailableSession.token}`, "GET");
  assert.equal(unavailable.status, 200);
  assert.deepEqual(await unavailable.json(), { ok: true, available: false, draft: null });
  const unavailableWrite = await invoke(unavailableEnv, `dzn_session=${unavailableSession.token}`, "PUT", { currentStep: 1 });
  assert.equal(unavailableWrite.status, 503, "Draft writes must fail closed before migration activation.");
  unavailableSqlite.close();

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync("migrations/0001_initial_schema.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0074_onboarding_drafts.sql", "utf8"));
  sqlite.exec(`
    INSERT INTO users (id,discord_id,username) VALUES
      ('user-a','111111111111111111','Owner A'),
      ('user-b','222222222222222222','Owner B');
    INSERT INTO discord_guilds (id,guild_id,owner_user_id,name) VALUES
      ('guild-a','333333333333333333','user-a','Owner A Guild'),
      ('guild-b','444444444444444444','user-b','Owner B Guild');
    INSERT INTO linked_servers (id,user_id,guild_id,discord_guild_id,server_name,server_type,status)
      VALUES ('server-a','user-a','333333333333333333','guild-a','Draft Server','PVE','pending');
    INSERT INTO nitrado_connections (id,user_id,linked_server_id,encrypted_token,token_iv,token_auth_tag)
      VALUES ('connection-a','user-a','server-a','encrypted','iv','tag');
  `);
  const env = { DB: d1(sqlite), SESSION_SECRET: "draft-test-secret" } as Env;
  const sessionA = await createSession(env, "user-a");
  const sessionB = await createSession(env, "user-b");
  const cookieA = `dzn_session=${sessionA.token}`;
  const cookieB = `dzn_session=${sessionB.token}`;

  const unauthorized = await invoke(env, null, "GET");
  assert.equal(unauthorized.status, 401);

  const saved = await invoke(env, cookieA, "PUT", {
    currentStep: 4,
    discordGuildId: "333333333333333333",
    serverType: "PVE",
    server_category: "pve",
    tags: ["Survival", "Active Admins", "not-allowed"],
    public_short_description: "Private owner draft",
    linkedServerId: "server-a",
    nitradoServiceId: "17571334",
    directServiceValidated: true,
    token: "must-never-be-stored",
  });
  assert.equal(saved.status, 200);
  const savedPayload = await saved.json() as { draft: { currentStep: number; completionPercent: number; tags: string[] } };
  assert.equal(savedPayload.draft.currentStep, 4);
  assert.equal(savedPayload.draft.completionPercent, 57);
  assert.deepEqual(savedPayload.draft.tags, ["Survival", "Active Admins"]);
  assert.equal(JSON.stringify(savedPayload).includes("must-never-be-stored"), false);
  assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM onboarding_drafts").get()).includes("must-never-be-stored"), false);

  const ownerRead = await invoke(env, cookieA, "GET");
  assert.equal(ownerRead.status, 200);
  assert.equal((await ownerRead.json() as { draft: { linkedServerId: string } }).draft.linkedServerId, "server-a");
  const otherRead = await invoke(env, cookieB, "GET");
  assert.deepEqual(await otherRead.json(), { ok: true, available: true, draft: null }, "Drafts must be private to the authenticated owner.");

  const crossOwner = await invoke(env, cookieB, "PUT", {
    currentStep: 4,
    discordGuildId: "444444444444444444",
    serverType: "PVE",
    linkedServerId: "server-a",
  });
  assert.equal(crossOwner.status, 403);

  const cleared = await invoke(env, cookieA, "DELETE");
  assert.equal(cleared.status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM onboarding_drafts").get()?.n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM linked_servers WHERE id='server-a'").get()?.n, 1, "Restart must not delete the linked server.");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM nitrado_connections WHERE id='connection-a'").get()?.n, 1, "Restart must not delete the saved token record.");
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  sqlite.close();
  console.log("Onboarding draft privacy, resume, migration fallback and non-destructive restart tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
