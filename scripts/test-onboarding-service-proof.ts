import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createSession, ensureLinkedServerMetadataColumns } from "../functions/_lib/db";
import { encryptToken } from "../functions/_lib/crypto";
import { onRequest as goLive } from "../functions/api/onboarding/go-live";
import { onRequest as testSetup } from "../functions/api/onboarding/test";
import { verifyNitradoSetupService, getOnboardingServiceProof, saveOnboardingServiceChecks } from "../functions/_lib/onboarding-service-proof";
import type { Env, PagesFunction } from "../functions/_lib/types";

type Sqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    run(...values: unknown[]): { changes: number | bigint };
    get(...values: unknown[]): Record<string, unknown> | undefined;
    all(...values: unknown[]): Array<Record<string, unknown>>;
  };
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

class LocalD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  readonly writes: string[] = [];
  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  prepare(sql: string) {
    const prepare = (values: unknown[] = []) => ({
      bind: (...bindings: unknown[]) => prepare(bindings),
      run: async () => {
        this.writes.push(sql);
        const result = this.sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      first: async <T>() => (this.sqlite.prepare(sql).get(...values) ?? null) as T | null,
      all: async <T>() => ({ success: true, results: this.sqlite.prepare(sql).all(...values) as T[] }),
    });
    return prepare();
  }
}

async function fixture() {
  const db = new LocalD1();
  db.sqlite.exec(readFileSync("migrations/0001_initial_schema.sql", "utf8"));
  db.sqlite.exec(`
    ALTER TABLE linked_servers ADD COLUMN merged_into_server_id TEXT;
    CREATE TABLE kill_events (linked_server_id TEXT, victim_name TEXT, distance REAL);
    CREATE TABLE server_stats (linked_server_id TEXT, unique_players INTEGER);
    INSERT INTO users (id, discord_id, username) VALUES ('owner', 'discord-owner', 'Owner'), ('other', 'discord-other', 'Other');
    INSERT INTO discord_guilds (id, guild_id, owner_user_id, name) VALUES ('guild', '123456', 'owner', 'Test guild');
    INSERT INTO linked_servers (id, user_id, guild_id, discord_guild_id, server_name, server_type, nitrado_service_id, public_slug)
      VALUES ('server', 'owner', '123456', 'guild', 'Synthetic DayZ', 'PVE', '12345', 'synthetic-dayz');
    INSERT INTO onboarding_checks (id, linked_server_id, token_valid, service_access, dayz_service_detected)
      VALUES ('old-check', 'server', 1, 1, 1);
  `);
  const env = { DB: db as unknown as D1Database, TOKEN_ENCRYPTION_KEY: "synthetic-only-test-key", SESSION_SECRET: "synthetic-session-key" } as Env;
  await ensureLinkedServerMetadataColumns(env);
  const encrypted = await encryptToken("synthetic-private-token", env.TOKEN_ENCRYPTION_KEY!);
  db.sqlite.prepare("INSERT INTO nitrado_connections (id, user_id, linked_server_id, encrypted_token, token_iv, token_auth_tag) VALUES ('connection', 'owner', 'server', ?, ?, ?)")
    .run(encrypted.encryptedToken, encrypted.iv, encrypted.authTag);
  const session = await createSession(env, "owner");
  db.writes.length = 0;
  return { db, env, cookie: `dzn_session=${session.token}` };
}

async function invoke(handler: PagesFunction, env: Env, cookie: string, method = "POST", body?: Record<string, unknown>) {
  return handler({ request: new Request("https://local.test/api/onboarding/check", { method, headers: { cookie }, body: body ? JSON.stringify(body) : undefined }), env } as Parameters<PagesFunction>[0]);
}

function provider(game = "dayzps", extra: Record<string, unknown> = {}) {
  return Response.json({ status: "success", data: { gameserver: { game, service_id: 12345, status: "stopped", ...extra } } });
}

function checkedFetch(response: () => Response | Promise<Response>, calls: string[] = []) {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(url, "https://api.nitrado.net/services/12345/gameservers", "Only the exact service proof GET is allowed");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-private-token");
    assert.ok(init?.signal);
    return response();
  };
}

function assertNoUnrelatedWrites(db: LocalD1) {
  for (const sql of db.writes) {
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) {
      assert.match(sql, /^\s*(UPDATE linked_servers SET status = 'live'|UPDATE onboarding_checks|INSERT INTO onboarding_checks)/i);
    }
  }
}

async function main() {
  const originalFetch = globalThis.fetch;
  let scenarios = 0;
  try {
    const failures: Array<{ label: string; response: () => Response; code: string; access?: boolean }> = [
      ...[401, 403, 404, 429, 500, 503].map((status) => ({
        label: `HTTP ${status}`, response: () => new Response("provider-private-error", { status }),
        code: ({ 401: "invalid_token", 403: "access_denied", 404: "service_not_found" } as Record<number, string>)[status] ?? "nitrado_api_unavailable",
      })),
      { label: "redirect", response: () => new Response(null, { status: 302, headers: { location: "https://foreign.invalid/private" } }), code: "nitrado_api_unavailable" },
      { label: "malformed JSON", response: () => new Response("provider-private-error"), code: "nitrado_api_unavailable" },
      { label: "empty JSON", response: () => Response.json({}), code: "nitrado_api_unavailable" },
      { label: "error envelope", response: () => Response.json({ status: "error", data: { gameserver: { game: "dayzps" } } }), code: "nitrado_api_unavailable" },
      { label: "misplaced game", response: () => Response.json({ status: "success", debug: { gameserver: { game: "dayzps" } } }), code: "nitrado_api_unavailable" },
      { label: "oversized JSON", response: () => provider("dayzps", { padding: "x".repeat(128 * 1024) }), code: "nitrado_api_unavailable" },
      { label: "wrong service", response: () => provider("dayzps", { service_id: 98765 }), code: "nitrado_api_unavailable" },
      { label: "name-only DayZ", response: () => provider("minecraft", { name: "DayZ", game_human: "DayZ", settings: { config: { hostname: "DayZ" } } }), code: "not_dayz", access: true },
      { label: "game missing", response: () => provider("", { name: "DayZ" }), code: "nitrado_api_unavailable" },
      { label: "network failure", response: () => { throw new Error("synthetic-private-token provider-private-error"); }, code: "nitrado_api_unavailable" },
    ];
    for (const failure of failures) {
      for (const handler of [goLive, testSetup]) {
        const { db, env, cookie } = await fixture();
        const calls: string[] = [];
        checkedFetch(failure.response, calls);
        const response = await invoke(handler, env, cookie);
        assert.equal(response.status, handler === goLive ? 400 : 200, failure.label);
        assert.match(response.headers.get("cache-control") ?? "", /no-store/);
        const text = await response.text();
        assert.doesNotMatch(text, /synthetic-private-token|provider-private-error|encrypted_token|token_auth_tag|snapshot|bindings/);
        const payload = JSON.parse(text);
        assert.equal(handler === goLive ? payload.code : payload.checks.tokenErrorCode, failure.code, failure.label);
        if (handler === testSetup) {
          assert.equal(payload.checks.tokenValid, Boolean(failure.access));
          assert.equal(payload.checks.serviceAccess, Boolean(failure.access));
          assert.equal(payload.checks.dayzServiceDetected, false);
          assert.equal(payload.checks.admLogsFound, false);
          assert.equal(payload.checks.metadataSynced, false);
          assert.equal(payload.checks.admBackfill, undefined);
        }
        assert.equal(calls.length, 1, "Failed proof must not refresh metadata or access/import ADM");
        assert.equal(db.sqlite.prepare("SELECT status FROM linked_servers WHERE id = 'server'").get()?.status, "pending");
        assert.equal(db.sqlite.prepare("SELECT dayz_service_detected FROM onboarding_checks").get()?.dayz_service_detected, 0);
        assertNoUnrelatedWrites(db);
        db.sqlite.close();
        scenarios++;
      }
    }

    for (const game of ["dayz", "dayzps", "dayzxb", "dayzstandalone"]) {
      const { db, env, cookie } = await fixture();
      const calls: string[] = [];
      checkedFetch(() => provider(game, { id: 999 }), calls);
      const response = await invoke(goLive, env, cookie, "POST", { user_id: "other", linked_server_id: "foreign", token: "forged", nitrado_service_id: "98765" });
      assert.equal(response.status, 200, "Verified supported service can activate; request fields cannot choose another owner/service");
      assert.equal(calls.length, 1);
      assert.equal(db.sqlite.prepare("SELECT status FROM linked_servers").get()?.status, "live");
      assertNoUnrelatedWrites(db);
      db.sqlite.close();
      scenarios++;
    }

    for (const mutation of [
      "UPDATE linked_servers SET user_id = 'other' WHERE id = 'server'",
      "UPDATE linked_servers SET nitrado_service_id = '98765' WHERE id = 'server'",
      "UPDATE linked_servers SET status = 'deleted' WHERE id = 'server'",
      "UPDATE linked_servers SET merged_into_server_id = 'canonical' WHERE id = 'server'",
      "UPDATE nitrado_connections SET encrypted_token = 'changed' WHERE id = 'connection'",
      "UPDATE nitrado_connections SET token_iv = 'changed' WHERE id = 'connection'",
      "UPDATE nitrado_connections SET token_auth_tag = 'changed' WHERE id = 'connection'",
      "DELETE FROM nitrado_connections WHERE id = 'connection'",
      "INSERT INTO nitrado_connections SELECT 'replacement', user_id, linked_server_id, encrypted_token, token_iv, token_auth_tag, created_at, datetime('now', '+1 day') FROM nitrado_connections",
    ]) {
      for (const handler of [goLive, testSetup]) {
        const { db, env, cookie } = await fixture();
        checkedFetch(() => { db.sqlite.exec(mutation); return provider(); });
        assert.equal((await invoke(handler, env, cookie)).status, 409, mutation);
        assert.notEqual(db.sqlite.prepare("SELECT status FROM linked_servers").get()?.status, "live");
        assert.equal(db.writes.some((sql) => /^(UPDATE|INSERT)/.test(sql)), handler === goLive, "Setup must stop before metadata/ADM; go-live's conditional UPDATE must affect zero rows");
        assertNoUnrelatedWrites(db);
        db.sqlite.close();
        scenarios++;
      }
    }

    for (const handler of [goLive, testSetup]) {
      for (const missing of ["token", "key", "decrypt", "foreign-connection"]) {
        const { db, env, cookie } = await fixture();
        if (missing === "token") db.sqlite.exec("DELETE FROM nitrado_connections");
        if (missing === "key") delete env.TOKEN_ENCRYPTION_KEY;
        if (missing === "decrypt") db.sqlite.exec("UPDATE nitrado_connections SET encrypted_token = 'invalid'");
        if (missing === "foreign-connection") db.sqlite.exec("UPDATE nitrado_connections SET user_id = 'other'");
        let calls = 0;
        globalThis.fetch = async () => { calls++; throw new Error("No provider requests allowed"); };
        const response = await invoke(handler, env, cookie);
        assert.equal(response.status, handler === goLive ? 400 : 200);
        assert.equal(calls, 0);
        assert.equal(db.sqlite.prepare("SELECT token_valid FROM onboarding_checks").get()?.token_valid, 0);
        assertNoUnrelatedWrites(db);
        db.sqlite.close();
        scenarios++;
      }
      const { db, env, cookie } = await fixture();
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error("No provider requests allowed"); };
      assert.equal((await invoke(handler, env, "")).status, 401);
      assert.equal((await invoke(handler, env, cookie, "GET")).status, 405);
      const other = await createSession(env, "other");
      assert.equal((await invoke(handler, env, `dzn_session=${other.token}`, "POST", { linked_server_id: "server" })).status, 400);
      assert.equal(calls, 0);
      db.sqlite.close();
      scenarios += 3;
    }

    {
      const { db, env } = await fixture();
      checkedFetch(() => provider());
      const proof = await getOnboardingServiceProof(env, "owner", "server", "12345");
      db.sqlite.exec("DELETE FROM onboarding_checks");
      assert.equal(await saveOnboardingServiceChecks(env, proof, false), true);
      assert.equal(await saveOnboardingServiceChecks(env, proof, true), true);
      assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM onboarding_checks").get()?.n, 1);
      assert.equal(db.sqlite.prepare("SELECT adm_logs_found FROM onboarding_checks").get()?.adm_logs_found, 1);
      db.sqlite.exec("UPDATE nitrado_connections SET encrypted_token = 'changed'");
      assert.equal(await saveOnboardingServiceChecks(env, proof, false), false, "A stale result cannot overwrite a later connection's checks");
      assert.equal(db.sqlite.prepare("SELECT adm_logs_found FROM onboarding_checks").get()?.adm_logs_found, 1);
      assertNoUnrelatedWrites(db);
      db.sqlite.close();
      scenarios += 3;
    }

    {
      const { db, env, cookie } = await fixture();
      checkedFetch(() => { db.sqlite.exec("UPDATE onboarding_checks SET token_valid = 0"); return provider(); });
      assert.equal((await invoke(goLive, env, cookie)).status, 409, "A concurrent failed check must block activation");
      db.sqlite.close();
      scenarios++;
    }
    {
      const { db, env, cookie } = await fixture();
      env.MOCK_NITRADO = "true";
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error("Mock setup must not contact providers"); };
      const response = await invoke(testSetup, env, cookie);
      assert.equal(response.status, 200);
      const payload = await response.json() as { checks: { tokenValid: boolean; serviceAccess: boolean; dayzServiceDetected: boolean; admLogsFound: boolean } };
      assert.equal(payload.checks.tokenValid, true);
      assert.equal(payload.checks.serviceAccess, true);
      assert.equal(payload.checks.dayzServiceDetected, true);
      assert.equal(payload.checks.admLogsFound, true);
      assert.equal((await invoke(goLive, env, cookie)).status, 200);
      assert.equal(calls, 0);
      db.sqlite.close();
      scenarios++;
    }
    {
      const { db, env, cookie } = await fixture();
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error("No provider requests allowed"); };
      db.sqlite.exec("DELETE FROM onboarding_checks");
      assert.equal((await invoke(goLive, env, cookie)).status, 400, "Saved checks remain a prerequisite");
      assert.equal(calls, 0);
      assert.equal(db.sqlite.prepare("SELECT status FROM linked_servers").get()?.status, "pending");
      db.sqlite.close();
      scenarios++;
    }
    {
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error("No provider request allowed"); };
      assert.equal((await verifyNitradoSetupService("synthetic-private-token", "123/../../foreign")).dayzServiceDetected, false);
      assert.equal(calls, 0);
      scenarios++;
    }
    {
      globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("synthetic-private-token timeout")), { once: true });
      });
      const started = Date.now();
      const proof = await verifyNitradoSetupService("synthetic-private-token", "12345");
      assert.equal(proof.dayzServiceDetected, false);
      assert.equal(proof.errorCode, "nitrado_api_unavailable");
      assert.ok(Date.now() - started < 15000, "Provider verification has a bounded timeout");
      scenarios++;
    }
    console.log(`Onboarding service proof: ${scenarios} synthetic provider, authenticated-route, snapshot-race and isolation scenarios passed.`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
