import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { DZN_COMMS_PRESENCE_TTL_SECONDS, handleDznCommsPresence, readDznCommsPresenceFlags, readPresence, refreshPresence } from "../functions/_lib/dzn-comms-presence";
import type { Env } from "../functions/_lib/types";

const migrationName = "0089_dzn_comms_presence.sql";
const migration = readFileSync(`migrations/${migrationName}`, "utf8");
const helper = readFileSync("functions/_lib/dzn-comms-presence.ts", "utf8");
const route = readFileSync("functions/api/comms/presence.ts", "utf8");
const component = readFileSync("components/comms/dzn-live-presence-counter.tsx", "utf8");
const shell = readFileSync("components/comms/dzn-comms-shell.tsx", "utf8");
const envExample = readFileSync(".env.example", "utf8");
const envTypes = readFileSync("cloudflare-env.d.ts", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
const migrations = readdirSync("migrations").filter((name) => /^\d{4}_.+\.sql$/.test(name));
const executableMigration = migration.replace(/^\s*--.*$/gm, "");

assert.ok(migrations.includes(migrationName));
assert.equal(new Set(migrations.map((name) => name.slice(0, 4))).size, migrations.length, "Migration prefixes must remain unique.");
assert.match(migration, /CREATE TABLE IF NOT EXISTS dzn_comms_presence_sessions/i);
assert.match(migration, /PRIMARY KEY\(actor_key_hash, scope\)/i);
assert.match(migration, /CHECK\(scope IN \('global_chat'\)\)/i);
assert.match(migration, /idx_dzn_comms_presence_scope_expiry/i);
assert.doesNotMatch(executableMigration, /discord_id|user_id|ip_address|user_agent|route_path|billing_id|location|latitude|longitude/i);

for (const flag of [
  "DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED",
  "DZN_COMMS_PRESENCE_READ_ENABLED",
  "DZN_COMMS_PRESENCE_WRITE_ENABLED",
  "DZN_COMMS_PRESENCE_SCOPE",
  "DZN_COMMS_PRESENCE_SECRET",
  "NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED",
]) {
  assert.ok(envExample.includes(`${flag}=`), `${flag} must be documented.`);
  assert.ok(envTypes.includes(`${flag}?: string`), `${flag} must be typed.`);
}
assert.match(envExample, /DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED=false/);
assert.match(envExample, /DZN_COMMS_PRESENCE_READ_ENABLED=false/);
assert.match(envExample, /DZN_COMMS_PRESENCE_WRITE_ENABLED=false/);
assert.match(envExample, /NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED=false/);
assert.match(helper, /getSessionUser\(env, request\)/, "Presence writes must use the Discord session.");
assert.match(helper, /sameOrigin\(request\)/, "Presence writes must be same-origin.");
assert.match(helper, /HMAC/, "Presence actor keys must use a keyed digest.");
assert.match(helper, /dzn-comms-presence:/, "Presence must have an isolated digest domain.");
assert.match(route, /handleDznCommsPresence/);
assert.match(component, /NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED/);
assert.match(component, /fetch\("\/api\/auth\/me"/);
assert.match(component, /method: "POST"/);
assert.match(component, /method: "GET"/);
assert.match(component, /if \(!enabled\) return null/, "Disabled presence UI must not render an unavailable placeholder.");
assert.doesNotMatch(component, /localStorage|sessionStorage|sendBeacon|WebSocket|EventSource/);
assert.match(shell, /DznLivePresenceCounter/);
assert.match(shell, /presenceUiEnabled \? <DznLivePresenceCounter \/>/);
assert.equal(typeof packageJson.scripts?.["test:dzn-comms-presence"], "string");

assert.deepEqual(readDznCommsPresenceFlags({} as Env), {
  readEnabled: false, writeEnabled: false, scope: "", secretReady: false, localRequest: false,
});
const localEnv = {
  DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED: "true",
  DZN_COMMS_PRESENCE_READ_ENABLED: "true",
  DZN_COMMS_PRESENCE_WRITE_ENABLED: "true",
  DZN_COMMS_PRESENCE_SCOPE: "local_test",
  DZN_COMMS_PRESENCE_SECRET: "presence-secret-at-least-32-bytes-long",
} as unknown as Env;
assert.equal(readDznCommsPresenceFlags(localEnv, new Request("http://localhost/community")).readEnabled, true);
assert.equal(readDznCommsPresenceFlags(localEnv, new Request("https://dayz-network.com/community")).readEnabled, false);
assert.equal(readDznCommsPresenceFlags({ ...localEnv, DZN_COMMS_PRESENCE_SECRET: "short" }, new Request("http://localhost/community")).writeEnabled, false);

class MemoryPresenceStorage {
  rows = new Map<string, { expiresAt: string }>();
  async refresh(actorKeyHash: string, _nowIso: string, expiresAt: string) { this.rows.set(actorKeyHash, { expiresAt }); }
  async countActive(nowIso: string) { return [...this.rows.values()].filter((row) => row.expiresAt > nowIso).length; }
}

class RouteD1 {
  actorHashes = new Set<string>();

  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => ({
        first: async () => {
          if (sql.includes("FROM sessions")) {
            return { id: "internal-user-one", discord_id: "discord-one", username: "Tester", avatar: null };
          }
          if (sql.includes("COUNT(*) AS online_count")) return { online_count: this.actorHashes.size };
          return null;
        },
        run: async () => {
          if (sql.includes("INSERT INTO dzn_comms_presence_sessions")) this.actorHashes.add(String(values[0]));
          return { success: true };
        },
      }),
    };
  }
}

async function main() {
  const disabledResponse = await handleDznCommsPresence(new Request("https://dayz-network.com/api/comms/presence"), {} as Env);
  assert.equal(disabledResponse.status, 404, "Presence must remain unavailable without explicit flags.");
  const methodResponse = await handleDznCommsPresence(new Request("https://dayz-network.com/api/comms/presence", { method: "DELETE" }), {} as Env);
  assert.equal(methodResponse.status, 405, "Presence must reject unsupported methods.");

  const productionEnv = {
    ...localEnv,
    DB: {} as D1Database,
    DZN_COMMS_PRESENCE_SCOPE: "production",
  } as unknown as Env;
  const invalidScopeResponse = await handleDznCommsPresence(new Request("https://dayz-network.com/api/comms/presence?scope=server"), productionEnv);
  assert.equal(invalidScopeResponse.status, 400, "Only the aggregate Global Chat scope is supported.");
  const crossOriginResponse = await handleDznCommsPresence(new Request("https://dayz-network.com/api/comms/presence", {
    method: "POST",
    headers: { origin: "https://example.test" },
  }), productionEnv);
  assert.equal(crossOriginResponse.status, 403, "Cross-origin heartbeats must be rejected.");
  const signedOutResponse = await handleDznCommsPresence(new Request("https://dayz-network.com/api/comms/presence", {
    method: "POST",
    headers: { origin: "https://dayz-network.com" },
  }), productionEnv);
  assert.equal(signedOutResponse.status, 401, "Signed-out visitors must not create presence slots.");

  const routeDb = new RouteD1();
  const authenticatedEnv = { ...productionEnv, DB: routeDb as unknown as D1Database, SESSION_SECRET: "session-test-secret" } as unknown as Env;
  const authenticatedResponse = await handleDznCommsPresence(new Request("https://dayz-network.com/api/comms/presence", {
    method: "POST",
    headers: { cookie: "dzn_session=valid-test-session", origin: "https://dayz-network.com" },
  }), authenticatedEnv);
  assert.equal(authenticatedResponse.status, 200);
  const authenticatedPayload = await authenticatedResponse.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(authenticatedPayload).sort(), ["generated_at", "label", "ok", "online_count", "precision", "scope", "ttl_seconds"]);
  assert.equal(authenticatedPayload.online_count, 1);
  assert.equal(routeDb.actorHashes.size, 1);
  assert.equal([...routeDb.actorHashes].some((value) => value.includes("internal-user-one") || value.includes("discord-one")), false);

  const storage = new MemoryPresenceStorage();
  const now = new Date("2026-10-04T09:00:00.000Z");
  await refreshPresence(storage, "internal-user-one", localEnv.DZN_COMMS_PRESENCE_SECRET!, now);
  await refreshPresence(storage, "internal-user-one", localEnv.DZN_COMMS_PRESENCE_SECRET!, new Date(now.getTime() + 1_000));
  assert.equal(storage.rows.size, 1, "One account must occupy one aggregate presence slot.");
  assert.equal([...storage.rows.keys()].some((key) => key.includes("internal-user-one")), false, "Raw user IDs must never be stored.");
  await refreshPresence(storage, "internal-user-two", localEnv.DZN_COMMS_PRESENCE_SECRET!, now);
  assert.equal((await readPresence(storage, now)).online_count, 2);
  assert.equal((await readPresence(storage, new Date(now.getTime() + (DZN_COMMS_PRESENCE_TTL_SECONDS + 2) * 1_000))).online_count, 0, "Expired heartbeats must not count.");

  console.log("DZN Comms presence foundation checks passed.");
}

void main();
