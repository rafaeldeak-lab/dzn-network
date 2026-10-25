import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { DZN_COMMS_TYPING_MIN_REFRESH_SECONDS, DZN_COMMS_TYPING_TTL_SECONDS, handleDznCommsTyping, readDznCommsTypingFlags } from "../functions/_lib/dzn-comms-typing";
import type { Env } from "../functions/_lib/types";

const migrationName = "0114_dzn_comms_chat_interactions.sql";
const migration = readFileSync(`migrations/${migrationName}`, "utf8");
const helper = readFileSync("functions/_lib/dzn-comms-typing.ts", "utf8");
const route = readFileSync("functions/api/comms/typing.ts", "utf8");
const shell = readFileSync("components/comms/dzn-comms-shell.tsx", "utf8");
const client = readFileSync("components/comms/comms-history-client.ts", "utf8");
const envExample = readFileSync(".env.example", "utf8");
const envTypes = readFileSync("cloudflare-env.d.ts", "utf8");

assert.ok(readdirSync("migrations").includes(migrationName));
assert.match(migration, /CREATE TABLE IF NOT EXISTS dzn_comms_typing_sessions/i);
assert.match(migration, /PRIMARY KEY\(channel_id, actor_user_id\)/i);
assert.match(migration, /idx_dzn_comms_typing_channel_expiry/i);
assert.doesNotMatch(migration, /discord_id|ip_address|user_agent|route_path|billing_id/i);
for (const flag of ["DZN_COMMS_TYPING_READ_ENABLED", "DZN_COMMS_TYPING_WRITE_ENABLED", "DZN_COMMS_TYPING_SCOPE"]) {
  assert.ok(envExample.includes(`${flag}=false`) || envExample.includes(`${flag}=local_test`), `${flag} must default safely in the environment example.`);
  assert.ok(envTypes.includes(`${flag}?: string`), `${flag} must be typed.`);
}
assert.match(helper, /getSessionUser\(env, request\)/, "Typing writes must use the authenticated Discord session.");
assert.match(helper, /sameOrigin\(request\)/, "Typing writes must be same-origin.");
assert.match(helper, /typing\.expires_at > \?/, "Typing reads must reject expired rows in indexed storage.");
assert.match(helper, /typing\.actor_user_id != \?/, "A user must never see their own typing indicator echoed back.");
assert.doesNotMatch(helper + route, /WebSocket|DurableObject|EventSource|STRIPE_SECRET|OPENAI_API_KEY|AI_GATEWAY|VECTORIZE|R2_BUCKET/i);
assert.match(route, /handleDznCommsTyping/);
assert.match(client, /\/api\/comms\/typing/);
assert.match(shell, /typingCopy\(typingNames\)/);

const baseEnv = {
  DZN_COMMS_LIVE_ENABLED: "true",
  DZN_COMMS_LIVE_SCOPE: "local_test",
  DZN_COMMS_LEDGER_SECRET: "typing-ledger-secret-at-least-32-bytes",
  SESSION_SECRET: "typing-session-secret-at-least-32-bytes",
  DZN_COMMS_TYPING_READ_ENABLED: "true",
  DZN_COMMS_TYPING_WRITE_ENABLED: "true",
  DZN_COMMS_TYPING_SCOPE: "local_test",
} as unknown as Env;

assert.deepEqual(readDznCommsTypingFlags({} as Env), { readEnabled: false, writeEnabled: false, scope: "", localRequest: false, liveEnabled: false });
assert.equal(readDznCommsTypingFlags(baseEnv, new Request("http://localhost/community")).writeEnabled, true);
assert.equal(readDznCommsTypingFlags(baseEnv, new Request("https://dayz-network.com/community")).writeEnabled, false);

type TypingRow = { channelId: string; actorUserId: string; displayName: string; updatedAt: string; expiresAt: string };
class TypingRouteDb {
  rows: TypingRow[] = [];

  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => ({
        first: async () => {
          if (sql.includes("FROM sessions")) return { id: "internal-user-one", discord_id: "discord-one", username: "Discord Display", avatar: null };
          if (sql.includes("FROM dzn_comms_channels")) return { id: "dzn-global-chat" };
          return null;
        },
        all: async () => {
          if (!sql.includes("FROM dzn_comms_typing_sessions")) return { results: [] };
          const [channelSlug, now, excludedUserId] = values;
          assert.equal(channelSlug, "global-chat");
          return {
            results: this.rows
              .filter((row) => row.expiresAt > String(now) && (excludedUserId === null || row.actorUserId !== excludedUserId))
              .map((row) => ({ display_name: row.displayName, expires_at: row.expiresAt })),
          };
        },
        run: async () => {
          if (sql.includes("INSERT INTO dzn_comms_typing_sessions")) {
            const [channelId, actorUserId, displayName, updatedAt, expiresAt, refreshNotBefore] = values.map(String);
            const existing = this.rows.find((row) => row.channelId === channelId && row.actorUserId === actorUserId);
            if (!existing) this.rows.push({ channelId, actorUserId, displayName, updatedAt, expiresAt });
            else if (existing.updatedAt <= refreshNotBefore) Object.assign(existing, { displayName, updatedAt, expiresAt });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("DELETE FROM dzn_comms_typing_sessions")) {
            const [channelId, actorUserId] = values.map(String);
            this.rows = this.rows.filter((row) => row.channelId !== channelId || row.actorUserId !== actorUserId);
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      }),
    };
  }
}

async function main() {
  const db = new TypingRouteDb();
  const env = { ...baseEnv, DB: db } as unknown as Env;
  const disabled = await handleDznCommsTyping(new Request("http://localhost/api/comms/typing"), {} as Env);
  assert.equal(disabled.status, 404);
  const denied = await handleDznCommsTyping(new Request("http://localhost/api/comms/typing", { method: "POST", headers: { origin: "https://example.test" } }), env);
  assert.equal(denied.status, 403);
  const start = await handleDznCommsTyping(new Request("http://localhost/api/comms/typing", {
    method: "POST", headers: { origin: "http://localhost", cookie: "dzn_session=valid" }, body: JSON.stringify({ channelSlug: "global-chat", typing: true }),
  }), env);
  assert.equal(start.status, 200);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0]?.displayName, "Discord Display");
  const publicRead = await handleDznCommsTyping(new Request("http://localhost/api/comms/typing?channel=global-chat"), env);
  const publicPayload = await publicRead.json() as { typers: { display_name: string }[] };
  assert.deepEqual(publicPayload.typers, [{ display_name: "Discord Display", expires_at: db.rows[0]?.expiresAt }]);
  assert.equal(JSON.stringify(publicPayload).includes("internal-user-one"), false);
  const ownRead = await handleDznCommsTyping(new Request("http://localhost/api/comms/typing?channel=global-chat", { headers: { cookie: "dzn_session=valid" } }), env);
  assert.deepEqual((await ownRead.json() as { typers: unknown[] }).typers, []);
  const stop = await handleDznCommsTyping(new Request("http://localhost/api/comms/typing", {
    method: "POST", headers: { origin: "http://localhost", cookie: "dzn_session=valid" }, body: JSON.stringify({ channelSlug: "global-chat", typing: false }),
  }), env);
  assert.equal(stop.status, 200);
  assert.equal(db.rows.length, 0);
  assert.equal(DZN_COMMS_TYPING_TTL_SECONDS, 9);
  assert.equal(DZN_COMMS_TYPING_MIN_REFRESH_SECONDS, 3);
  console.log("DZN Comms typing contract checks passed.");
}

void main();
