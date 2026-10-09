import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createSession } from "../functions/_lib/db";
import { claimOwnerDiscordAccessRole, getOwnerDiscordDeliveryDiagnostic, getOwnerDiscordDeliverySummaries, issueOwnerDiscordAccessInvite, revokeOwnerDiscordAccessRole } from "../functions/_lib/owner-discord-delivery";
import { onRequest as applicantDeliveryRoute } from "../functions/api/discord/owner-access-delivery";
import { onRequest as ownerDeliveryRoute } from "../functions/api/owner/discord/owner-access-delivery";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

type Sqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    all(...values: unknown[]): Record<string, unknown>[];
    get(...values: unknown[]): Record<string, unknown> | undefined;
    run(...values: unknown[]): { changes: number | bigint };
  };
};

type LocalStatement = {
  bind(...values: unknown[]): LocalStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[]; success: boolean; meta: { changes: number } }>;
  run(): Promise<{ results: never[]; success: boolean; meta: { changes: number } }>;
  execute(): { results: Record<string, unknown>[]; success: boolean; meta: { changes: number } };
};

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };
const guildId = "900000000000000001";
const inviteChannelId = "900000000000000002";
const verifiedOwnerRoleId = "900000000000000003";
const botRoleId = "900000000000000004";
const botUserId = "900000000000000005";
const owner: SessionUser = { id: "platform_owner", discord_id: "900000000000000006", username: "DZN Owner", avatar: null };
const applicant: SessionUser = { id: "server_owner", discord_id: "900000000000000007", username: "Server Owner", avatar: null };
const outsider: SessionUser = { id: "outsider", discord_id: "900000000000000008", username: "Outsider", avatar: null };
const botPermissions = ((BigInt(1) << BigInt(28)) | (BigInt(1) << BigInt(10)) | (BigInt(1) << BigInt(0))).toString();

function localD1(sqlite: Sqlite) {
  const prepare = (sql: string, bindings: unknown[] = []): LocalStatement => {
    const execute = () => {
      if (/^\s*(SELECT|PRAGMA)/i.test(sql)) return { results: sqlite.prepare(sql).all(...bindings), success: true, meta: { changes: 0 } };
      const result = sqlite.prepare(sql).run(...bindings);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    };
    return {
      bind: (...values) => prepare(sql, values),
      first: async <T>() => (sqlite.prepare(sql).get(...bindings) as T | undefined) ?? null,
      all: async <T>() => execute() as { results: T[]; success: boolean; meta: { changes: number } },
      run: async () => execute() as { results: never[]; success: boolean; meta: { changes: number } },
      execute,
    };
  };
  return {
    prepare,
    batch: async (statements: LocalStatement[]) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try { const results = statements.map((statement) => statement.execute()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
    exec: async (sql: string) => { sqlite.exec(sql); return { count: 0, duration: 0 }; },
  } as unknown as D1Database;
}

function splitSql(sql: string) {
  const statements: string[] = [];
  let buffer = "";
  for (const line of sql.split(/\r?\n/)) {
    if (!buffer && !line.trim()) continue;
    buffer += `${line}\n`;
    if (/;\s*$/.test(line)) { statements.push(buffer.trim().replace(/;\s*$/, "")); buffer = ""; }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

function request(method: "GET" | "POST", body?: unknown, token?: string, origin?: string) {
  const headers = new Headers();
  if (token) headers.set("cookie", `dzn_session=${token}`);
  if (origin) headers.set("origin", origin);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request("https://dzn.test/api/owner-discord-delivery", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function context(env: Env, requestValue: Request): PagesContext {
  return { env, request: requestValue, params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 204 }) };
}

async function run() {
  const migration = readFileSync("migrations/0095_dzn_owner_discord_delivery.sql", "utf8");
  assert.match(migration, /dzn_owner_discord_access_delivery_attempts/);
  assert.match(migration, /operation IN \('diagnostic', 'invite', 'role_grant', 'role_revoke'\)/);
  assert.match(migration, /idx_dzn_owner_discord_delivery_nonce/);
  assert.match(migration, /FOREIGN KEY\(request_id\) REFERENCES dzn_owner_discord_access_requests/);
  assert.doesNotMatch(migration, /discord\.com|DISCORD_BOT_TOKEN|CREATE\s+INVITE/i);
  const helper = readFileSync("functions/_lib/owner-discord-delivery.ts", "utf8");
  assert.match(helper, /max_uses: 1/);
  assert.match(helper, /temporary: false/);
  assert.match(helper, /INVITE_RATE_LIMIT/);
  assert.match(helper, /members\/\$\{encodeURIComponent\(user\.discord_id\)\}\/roles/);
  assert.match(helper, /method: "DELETE"/);
  assert.match(helper, /Verified Server Owner role removed/);
  assert.doesNotMatch(helper, /invite_code|stored invite|INSERT[\s\S]{0,300}code/i, "The delivery ledger must never store a reusable invite code.");
  const envExample = readFileSync(".env.example", "utf8");
  assert.match(envExample, /^DZN_OWNER_DISCORD_DELIVERY_ENABLED=false$/m);
  assert.match(envExample, /^DZN_OWNER_DISCORD_GUILD_ID=$/m);
  assert.match(envExample, /^DZN_OWNER_DISCORD_INVITE_CHANNEL_ID=$/m);
  assert.match(envExample, /^DZN_OWNER_DISCORD_VERIFIED_OWNER_ROLE_ID=$/m);
  const envTypes = readFileSync("cloudflare-env.d.ts", "utf8");
  assert.match(envTypes, /DZN_OWNER_DISCORD_DELIVERY_ENABLED\?: string/);
  assert.match(envTypes, /DZN_OWNER_DISCORD_GUILD_ID\?: string/);
  assert.match(envTypes, /DZN_OWNER_DISCORD_VERIFIED_OWNER_ROLE_ID\?: string/);
  const applicantRouteSource = readFileSync("functions/api/discord/owner-access-delivery.ts", "utf8");
  assert.match(applicantRouteSource, /sameOrigin/);
  assert.match(applicantRouteSource, /issueOwnerDiscordAccessInvite/);
  assert.match(applicantRouteSource, /claimOwnerDiscordAccessRole/);
  const ownerRouteSource = readFileSync("functions/api/owner/discord/owner-access-delivery.ts", "utf8");
  assert.match(ownerRouteSource, /requirePlatformOwner/);
  assert.match(ownerRouteSource, /revokeOwnerDiscordAccessRole/);

  const sqlite = new DatabaseSync(":memory:");
  const db = localD1(sqlite);
  try {
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT, avatar TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id));
      CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT, server_name TEXT, FOREIGN KEY(user_id) REFERENCES users(id));`);
    for (const migrationPath of ["migrations/0094_dzn_owner_discord_access.sql", "migrations/0095_dzn_owner_discord_delivery.sql"]) {
      for (const statement of splitSql(readFileSync(migrationPath, "utf8").replace(/^--.*$/gm, ""))) await db.prepare(statement).run();
    }
    for (const user of [owner, applicant, outsider]) await db.prepare("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)").bind(user.id, user.discord_id, user.username, user.avatar).run();
    await db.prepare("INSERT INTO linked_servers (id, user_id, server_name) VALUES ('server_owner', ?, 'Verified owner server')").bind(applicant.id).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('approved_request', ?, ?, ?, 'server_owner', 'server_owner', 'Verified owner server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(applicant.id, applicant.discord_id, applicant.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('other_request', ?, ?, ?, 'server_owner', 'server_owner', 'Other request', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(outsider.id, outsider.discord_id, outsider.username).run();

    const env = {
      DB: db,
      SESSION_SECRET: "owner-discord-delivery-test",
      DZN_OWNER_DISCORD_ACCESS_ENABLED: "true",
      DZN_OWNER_DISCORD_DELIVERY_ENABLED: "true",
      DZN_OWNER_DISCORD_GUILD_ID: guildId,
      DZN_OWNER_DISCORD_INVITE_CHANNEL_ID: inviteChannelId,
      DZN_OWNER_DISCORD_VERIFIED_OWNER_ROLE_ID: verifiedOwnerRoleId,
      DISCORD_BOT_TOKEN: "bot-token-with-at-least-twenty-characters",
      DZN_PLATFORM_OWNER_DISCORD_IDS: owner.discord_id,
    } as Env;
    const ownerSession = await createSession(env, owner.id);
    const applicantSession = await createSession(env, applicant.id);
    const outsiderSession = await createSession(env, outsider.id);
    let applicantJoined = false;
    let applicantHasRole = false;
    let activeBotPermissions = botPermissions;
    const calls: Array<{ path: string; method: string }> = [];
    const discordFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      calls.push({ path: url.pathname, method });
      if (url.pathname === "/api/v10/users/@me") return Response.json({ id: botUserId });
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${botUserId}`) return Response.json({ roles: [botRoleId] });
      if (url.pathname === `/api/v10/guilds/${guildId}/roles`) return Response.json([
        { id: guildId, position: 0, permissions: "0" },
        { id: verifiedOwnerRoleId, position: 5, permissions: "0" },
        { id: botRoleId, position: 10, permissions: activeBotPermissions },
      ]);
      if (url.pathname === `/api/v10/channels/${inviteChannelId}`) return Response.json({ id: inviteChannelId, guild_id: guildId, type: 0, permission_overwrites: [] });
      if (url.pathname === `/api/v10/channels/${inviteChannelId}/invites` && method === "POST") return Response.json({ code: "owner-private-join" });
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${applicant.discord_id}`) {
        return applicantJoined ? Response.json({ roles: applicantHasRole ? [verifiedOwnerRoleId] : [] }) : new Response(null, { status: 404 });
      }
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${applicant.discord_id}/roles/${verifiedOwnerRoleId}` && method === "PUT") {
        applicantHasRole = true;
        return new Response(null, { status: 204 });
      }
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${applicant.discord_id}/roles/${verifiedOwnerRoleId}` && method === "DELETE") {
        applicantHasRole = false;
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ message: "Unexpected mock Discord request" }), { status: 500, headers: { "content-type": "application/json" } });
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = discordFetch as typeof fetch;
    try {
      const diagnostic = await getOwnerDiscordDeliveryDiagnostic(env, discordFetch);
      assert.equal(diagnostic.ok, true);
      assert.equal(diagnostic.status, "ready");
      assert.equal(diagnostic.checks.targetRoleBelowBot, true);
      assert.equal(diagnostic.checks.canCreateInvite, true);
      assert.equal(diagnostic.checks.botHasAdministrator, false, "The delivery workflow must work with least-privilege role permissions rather than Administrator.");

      activeBotPermissions = (BigInt(1) << BigInt(3)).toString();
      const administratorDiagnostic = await getOwnerDiscordDeliveryDiagnostic(env, discordFetch);
      assert.equal(administratorDiagnostic.ok, true, "The diagnostic must still safely report the current live Administrator grant while the bot is being reduced.");
      assert.equal(administratorDiagnostic.checks.botHasAdministrator, true, "The owner console must expose that the bot still has Administrator.");
      activeBotPermissions = botPermissions;

      assert.equal((await applicantDeliveryRoute(context(env, request("POST", { action: "invite", requestId: "approved_request" }, applicantSession.token)))).status, 403, "Cross-origin invite requests must be refused.");
      assert.equal((await applicantDeliveryRoute(context(env, request("POST", { action: "invite", requestId: "other_request" }, outsiderSession.token, "https://dzn.test")))).status, 200, "A different approved owner may only access their own request.");

      const inviteResponse = await applicantDeliveryRoute(context(env, request("POST", { action: "invite", requestId: "approved_request" }, applicantSession.token, "https://dzn.test")));
      assert.equal(inviteResponse.status, 200);
      const invitePayload = await inviteResponse.json() as { ok: boolean; inviteUrl: string; inviteExpiresAt: string; message: string };
      assert.equal(invitePayload.ok, true);
      assert.equal(invitePayload.inviteUrl, "https://discord.gg/owner-private-join");
      assert.equal(typeof invitePayload.inviteExpiresAt, "string");
      const inviteLedger = await db.prepare("SELECT status, error_message FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = 'approved_request' AND operation = 'invite' ORDER BY created_at DESC LIMIT 1").first<{ status: string; error_message: string | null }>();
      assert.equal(inviteLedger?.status, "succeeded");
      assert.equal(inviteLedger?.error_message, null, "The one-use invite code must not be retained in the D1 ledger.");
      const inviteActor = await db.prepare("SELECT actor_user_id, actor_discord_id FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = 'approved_request' AND operation = 'invite' ORDER BY created_at DESC LIMIT 1").first<{ actor_user_id: string; actor_discord_id: string }>();
      assert.equal(inviteActor?.actor_user_id, applicant.id, "The delivery ledger must identify the signed-in requester that created an invite.");
      assert.equal(inviteActor?.actor_discord_id, applicant.discord_id, "The delivery ledger must retain the requester identity until account deletion.");

      const preJoinClaim = await claimOwnerDiscordAccessRole(env, request("POST", { requestId: "approved_request" }, applicantSession.token, "https://dzn.test"), { requestId: "approved_request" }, discordFetch);
      assert.equal(preJoinClaim.ok, false);
      assert.equal(preJoinClaim.status, 409, "A role must never be granted before the owner joins the DZN Discord server.");
      const preJoinLedger = await db.prepare("SELECT status FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = 'approved_request' AND operation = 'role_grant' ORDER BY created_at DESC LIMIT 1").first<{ status: string }>();
      assert.equal(preJoinLedger?.status, "not_joined");
      assert.equal(calls.some((call) => call.method === "PUT"), false, "DZN must not call Discord role assignment before membership is confirmed.");

      applicantJoined = true;
      const roleResponse = await applicantDeliveryRoute(context(env, request("POST", { action: "claim", requestId: "approved_request" }, applicantSession.token, "https://dzn.test")));
      assert.equal(roleResponse.status, 200);
      assert.equal(applicantHasRole, true);
      assert.equal(calls.some((call) => call.path.endsWith(`/members/${applicant.discord_id}/roles/${verifiedOwnerRoleId}`) && call.method === "PUT"), true, "A joined, approved owner should receive only the configured role.");

      assert.equal((await ownerDeliveryRoute(context(env, request("POST", { action: "revoke_role", requestId: "approved_request" }, applicantSession.token, "https://dzn.test")))).status, 403, "Only platform owners may remove an owner role.");
      const preRevoke = await revokeOwnerDiscordAccessRole(env, owner, { requestId: "approved_request" }, discordFetch);
      assert.equal(preRevoke.ok, false);
      assert.equal(preRevoke.status, 409, "Role removal requires a recorded queue revocation.");
      const outsiderRevoke = await revokeOwnerDiscordAccessRole(env, outsider, { requestId: "approved_request" }, discordFetch);
      assert.equal(outsiderRevoke.ok, false);
      assert.equal(outsiderRevoke.status, 403, "The delivery helper must still reject a non-owner if another route calls it incorrectly.");
      await db.prepare("UPDATE dzn_owner_discord_access_requests SET status = 'revoked' WHERE id = 'approved_request'").run();
      const revokeResponse = await ownerDeliveryRoute(context(env, request("POST", { action: "revoke_role", requestId: "approved_request" }, ownerSession.token, "https://dzn.test")));
      assert.equal(revokeResponse.status, 200);
      assert.equal(applicantHasRole, false);
      assert.equal(calls.some((call) => call.path.endsWith(`/members/${applicant.discord_id}/roles/${verifiedOwnerRoleId}`) && call.method === "DELETE"), true, "Revocation must only remove the configured Verified Server Owner role.");
      const revokeActor = await db.prepare("SELECT actor_user_id, actor_discord_id FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = 'approved_request' AND operation = 'role_revoke' ORDER BY created_at DESC LIMIT 1").first<{ actor_user_id: string; actor_discord_id: string }>();
      assert.equal(revokeActor?.actor_user_id, owner.id, "The delivery ledger must identify the platform owner that removed a role.");
      assert.equal(revokeActor?.actor_discord_id, owner.discord_id, "The delivery ledger must retain the platform owner identity for the role-removal audit.");

      const summaries = await getOwnerDiscordDeliverySummaries(env, ["approved_request"]);
      assert.equal(summaries.get("approved_request")?.operation, "role_revoke");
      assert.equal(summaries.get("approved_request")?.status, "succeeded");
      assert.equal(/owner-private-join/.test(JSON.stringify([...summaries.values()])), false, "Applicant and owner delivery summaries must not expose a reusable invite code.");

      for (let index = 0; index < 3; index += 1) {
        await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
          id, request_id, requester_user_id, requester_discord_id, operation, status, attempt_number, delivery_nonce, created_at, completed_at
        ) VALUES (?, 'other_request', ?, ?, 'invite', 'succeeded', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
          .bind(`invite-rate-${index}`, outsider.id, outsider.discord_id, index + 1, `nonce-rate-${index}`).run();
      }
      const rateLimited = await issueOwnerDiscordAccessInvite(env, request("POST", { requestId: "other_request" }, outsiderSession.token, "https://dzn.test"), { requestId: "other_request" }, discordFetch);
      assert.equal(rateLimited.ok, false);
      assert.equal(rateLimited.status, 429, "Repeated invite creation must be bounded per approved request.");

      const disabledDiagnostic = await getOwnerDiscordDeliveryDiagnostic({ ...env, DZN_OWNER_DISCORD_DELIVERY_ENABLED: "false" }, discordFetch);
      assert.equal(disabledDiagnostic.status, "disabled");
      const callCountBeforeDisabledInvite = calls.length;
      const disabledInvite = await issueOwnerDiscordAccessInvite({ ...env, DZN_OWNER_DISCORD_DELIVERY_ENABLED: "false" }, request("POST", { requestId: "other_request" }, outsiderSession.token, "https://dzn.test"), { requestId: "other_request" }, discordFetch);
      assert.equal(disabledInvite.status, 503, "Delivery must remain unavailable while its runtime flag is off.");
      assert.equal(calls.length, callCountBeforeDisabledInvite, "A disabled delivery flag must prevent every Discord API call.");
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    console.log("Owner Discord delivery checks passed.");
  } finally {
    sqlite.close();
  }
}

void run();
