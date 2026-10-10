import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createSession } from "../functions/_lib/db";
import { claimOwnerDiscordAccessRole, getOwnerDiscordDeliveryDiagnostic, getOwnerDiscordDeliverySummaries, issueOwnerDiscordAccessInvite, revokeOwnerDiscordAccessRole } from "../functions/_lib/owner-discord-delivery";
import { deleteOwnedAccountData } from "../functions/_lib/deletion";
import { decideOwnerDiscordAccessRequest } from "../functions/_lib/owner-discord-access";
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
const deletingOwner: SessionUser = { id: "closing_owner", discord_id: "900000000000000009", username: "Closing Owner", avatar: null };
const blockedOwner: SessionUser = { id: "blocked_closure_owner", discord_id: "900000000000000010", username: "Blocked Closure Owner", avatar: null };
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
      CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT, server_name TEXT, public_slug TEXT, status TEXT, lifecycle_status TEXT, merged_into_server_id TEXT, discord_guild_id TEXT, FOREIGN KEY(user_id) REFERENCES users(id));
      CREATE TABLE nitrado_connections (id TEXT PRIMARY KEY, user_id TEXT, linked_server_id TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE onboarding_checks (id TEXT PRIMARY KEY, linked_server_id TEXT, token_valid INTEGER, service_access INTEGER, dayz_service_detected INTEGER, last_tested_at TEXT);
      CREATE TABLE discord_guilds (id TEXT PRIMARY KEY, owner_user_id TEXT);`);
    for (const migrationPath of ["migrations/0094_dzn_owner_discord_access.sql", "migrations/0095_dzn_owner_discord_delivery.sql"]) {
      for (const statement of splitSql(readFileSync(migrationPath, "utf8").replace(/^--.*$/gm, ""))) await db.prepare(statement).run();
    }
    const deliveryBaseline = await db.prepare("SELECT COUNT(*) AS count FROM dzn_owner_discord_access_delivery_attempts").first<{ count: number | string }>();
    assert.equal(Number(deliveryBaseline?.count ?? 0), 0, "The additive delivery ledger must begin empty.");
    const roleMutationBaseline = await db.prepare("SELECT COUNT(*) AS count FROM dzn_owner_discord_access_role_mutations").first<{ count: number | string }>();
    assert.equal(Number(roleMutationBaseline?.count ?? 0), 0, "The additive role-mutation lease table must begin empty.");
    const deliveryIndexes = new Set(((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'dzn_owner_discord_access_delivery_attempts'").all<{ name: string }>()).results ?? []).map((row) => row.name));
    for (const index of [
      "idx_dzn_owner_discord_delivery_nonce",
      "idx_dzn_owner_discord_delivery_request",
      "idx_dzn_owner_discord_delivery_request_operation",
      "idx_dzn_owner_discord_delivery_requester",
      "idx_dzn_owner_discord_delivery_actor",
      "idx_dzn_owner_discord_delivery_status",
    ]) assert.equal(deliveryIndexes.has(index), true, `The delivery ledger must create ${index}.`);
    const deliveryForeignKeys = (await db.prepare("PRAGMA foreign_key_list(dzn_owner_discord_access_delivery_attempts)").all<{ table: string; from: string; on_delete: string }>()).results ?? [];
    assert.equal(deliveryForeignKeys.some((key) => key.table === "dzn_owner_discord_access_requests" && key.from === "request_id" && key.on_delete === "CASCADE"), true, "Delivery records must be tied to their reviewed request.");
    assert.equal(deliveryForeignKeys.some((key) => key.table === "users" && key.from === "requester_user_id" && key.on_delete === "SET NULL"), true, "Delivery requester records must be privacy-deletable.");
    assert.equal(deliveryForeignKeys.some((key) => key.table === "users" && key.from === "actor_user_id" && key.on_delete === "SET NULL"), true, "Delivery actor records must be privacy-deletable.");
    const roleMutationIndexes = new Set(((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'dzn_owner_discord_access_role_mutations'").all<{ name: string }>()).results ?? []).map((row) => row.name));
    for (const index of [
      "idx_dzn_owner_discord_role_mutation_request",
      "idx_dzn_owner_discord_role_mutation_expiry",
    ]) assert.equal(roleMutationIndexes.has(index), true, `The role-mutation lease table must create ${index}.`);
    const roleMutationForeignKeys = (await db.prepare("PRAGMA foreign_key_list(dzn_owner_discord_access_role_mutations)").all<{ table: string; from: string; on_delete: string }>()).results ?? [];
    assert.equal(roleMutationForeignKeys.some((key) => key.table === "dzn_owner_discord_access_requests" && key.from === "request_id" && key.on_delete === "CASCADE"), true, "Role mutation leases must be tied to a reviewed request.");
    for (const user of [owner, applicant, outsider, deletingOwner, blockedOwner]) await db.prepare("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)").bind(user.id, user.discord_id, user.username, user.avatar).run();
    await db.prepare("INSERT INTO linked_servers (id, user_id, server_name) VALUES ('server_owner', ?, 'Verified owner server')").bind(applicant.id).run();
    await db.prepare("INSERT INTO linked_servers (id, user_id, server_name) VALUES ('server_closing_owner', ?, 'Closing owner server')").bind(deletingOwner.id).run();
    await db.prepare("INSERT INTO linked_servers (id, user_id, server_name) VALUES ('server_blocked_closure_owner', ?, 'Blocked closing owner server')").bind(blockedOwner.id).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('approved_request', ?, ?, ?, 'server_owner', 'server_owner', 'Verified owner server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(applicant.id, applicant.discord_id, applicant.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('other_request', ?, ?, ?, 'server_owner', 'server_owner', 'Other request', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(outsider.id, outsider.discord_id, outsider.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('account_closure_request', ?, ?, ?, 'server_closing_owner', 'server_closing_owner', 'Closing owner server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(deletingOwner.id, deletingOwner.discord_id, deletingOwner.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('blocked_account_closure_request', ?, ?, ?, 'server_blocked_closure_owner', 'server_blocked_closure_owner', 'Blocked closing owner server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(blockedOwner.id, blockedOwner.discord_id, blockedOwner.username).run();

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
    let deletingOwnerHasRole = true;
    let roleRemovalSawAccount = false;
    let blockedOwnerHasRole = true;
    let blockedOwnerRoleRemovalAttempted = false;
    const failBlockedOwnerRemoval = true;
    let inviteChannelAvailable = true;
    let pendingApplicantRoleGrant: { started: () => void; wait: Promise<void> } | null = null;
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
      if (url.pathname === `/api/v10/channels/${inviteChannelId}`) {
        return inviteChannelAvailable
          ? Response.json({ id: inviteChannelId, guild_id: guildId, type: 0, permission_overwrites: [] })
          : new Response(null, { status: 404 });
      }
      if (url.pathname === `/api/v10/channels/${inviteChannelId}/invites` && method === "POST") return Response.json({ code: "owner-private-join" });
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${applicant.discord_id}`) {
        return applicantJoined ? Response.json({ roles: applicantHasRole ? [verifiedOwnerRoleId] : [] }) : new Response(null, { status: 404 });
      }
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${applicant.discord_id}/roles/${verifiedOwnerRoleId}` && method === "PUT") {
        if (pendingApplicantRoleGrant) {
          const gate = pendingApplicantRoleGrant;
          pendingApplicantRoleGrant = null;
          gate.started();
          await gate.wait;
        }
        applicantHasRole = true;
        return new Response(null, { status: 204 });
      }
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${applicant.discord_id}/roles/${verifiedOwnerRoleId}` && method === "DELETE") {
        applicantHasRole = false;
        return new Response(null, { status: 204 });
      }
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${deletingOwner.discord_id}`) {
        return Response.json({ roles: deletingOwnerHasRole ? [verifiedOwnerRoleId] : [] });
      }
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${deletingOwner.discord_id}/roles/${verifiedOwnerRoleId}` && method === "DELETE") {
        roleRemovalSawAccount = Boolean(await db.prepare("SELECT 1 AS found FROM users WHERE id = ? LIMIT 1").bind(deletingOwner.id).first<{ found: number }>());
        deletingOwnerHasRole = false;
        return new Response(null, { status: 204 });
      }
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${blockedOwner.discord_id}`) {
        return Response.json({ roles: blockedOwnerHasRole ? [verifiedOwnerRoleId] : [] });
      }
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${blockedOwner.discord_id}/roles/${verifiedOwnerRoleId}` && method === "DELETE") {
        blockedOwnerRoleRemovalAttempted = true;
        if (failBlockedOwnerRemoval) return new Response(null, { status: 500 });
        blockedOwnerHasRole = false;
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

      const everyoneRoleDiagnostic = await getOwnerDiscordDeliveryDiagnostic({ ...env, DZN_OWNER_DISCORD_VERIFIED_OWNER_ROLE_ID: guildId }, discordFetch);
      assert.equal(everyoneRoleDiagnostic.ok, false, "The central guild's @everyone role must never be accepted as the owner role.");
      assert.equal(everyoneRoleDiagnostic.status, "not_configured");

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

      await db.prepare("INSERT INTO linked_servers (id, user_id, server_name) VALUES ('server_race', ?, 'Role mutation race server')").bind(applicant.id).run();
      await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
      ) VALUES ('race_request', ?, ?, ?, 'server_race', 'server_race', 'Role mutation race server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(applicant.id, applicant.discord_id, applicant.username).run();
      let grantStarted: (() => void) | null = null;
      const grantStartedPromise = new Promise<void>((resolve) => { grantStarted = resolve; });
      let releaseGrant: () => void = () => { throw new Error("The gated role grant was not initialised."); };
      const grantReleasePromise = new Promise<void>((resolve) => { releaseGrant = resolve; });
      pendingApplicantRoleGrant = {
        started: () => grantStarted?.(),
        wait: grantReleasePromise,
      };
      const inFlightClaim = claimOwnerDiscordAccessRole(env, request("POST", { requestId: "race_request" }, applicantSession.token, "https://dzn.test"), { requestId: "race_request" }, discordFetch);
      await grantStartedPromise;
      const blockedRevocation = await decideOwnerDiscordAccessRequest(env, owner, {
        requestId: "race_request",
        action: "revoked",
        reason: "Access must be removed after the delivery finishes.",
        decisionNonce: "race-revocation-blocked",
      });
      assert.equal(blockedRevocation.ok, false, "A revocation must not race an in-flight Discord role grant.");
      if (!blockedRevocation.ok) assert.equal(blockedRevocation.status, 409);
      releaseGrant();
      const completedClaim = await inFlightClaim;
      assert.equal(completedClaim.ok, true, "The existing grant may finish before its serialized revocation is recorded.");
      const completedRevocation = await decideOwnerDiscordAccessRequest(env, owner, {
        requestId: "race_request",
        action: "revoked",
        reason: "Access must be removed after the delivery finishes.",
        decisionNonce: "race-revocation-complete",
      });
      assert.equal(completedRevocation.ok, true, "The revocation must succeed once the in-flight grant releases its lease.");
      const completedRoleRemoval = await revokeOwnerDiscordAccessRole(env, owner, { requestId: "race_request" }, discordFetch);
      assert.equal(completedRoleRemoval.ok, true, "A serialized revocation must remove the role after the grant completes.");
      assert.equal(applicantHasRole, false, "The completed revocation must leave no owner role behind.");

      await db.prepare("INSERT INTO linked_servers (id, user_id, server_name) VALUES ('server_same_discord', ?, 'Same Discord verified server')").bind(applicant.id).run();
      await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
      ) VALUES ('same_discord_approved_request', ?, ?, ?, 'server_same_discord', 'server_same_discord', 'Same Discord verified server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(applicant.id, applicant.discord_id, applicant.username).run();
      applicantHasRole = true;
      const deleteCountBeforeOtherApproval = calls.filter((call) => call.path.endsWith(`/members/${applicant.discord_id}/roles/${verifiedOwnerRoleId}`) && call.method === "DELETE").length;
      const retainedForOtherApproval = await revokeOwnerDiscordAccessRole(env, owner, { requestId: "race_request" }, discordFetch);
      assert.equal(retainedForOtherApproval.ok, true, "Revoking one request must preserve the role while another verified owner request is approved.");
      assert.equal(applicantHasRole, true, "Another active owner approval must keep the shared Discord owner role.");
      assert.equal(calls.filter((call) => call.path.endsWith(`/members/${applicant.discord_id}/roles/${verifiedOwnerRoleId}`) && call.method === "DELETE").length, deleteCountBeforeOtherApproval, "No role-delete request may be sent while another owner approval remains active.");

      await db.prepare("UPDATE dzn_owner_discord_access_requests SET status = 'revoked' WHERE id = 'same_discord_approved_request'").run();
      inviteChannelAvailable = false;
      const channelCheckCountBeforeRoleOnlyRevoke = calls.filter((call) => call.path === `/api/v10/channels/${inviteChannelId}`).length;
      const roleOnlyRevoke = await revokeOwnerDiscordAccessRole(env, owner, { requestId: "same_discord_approved_request" }, discordFetch);
      assert.equal(roleOnlyRevoke.ok, true, "Role revocation must work even if the private invite channel is unavailable.");
      assert.equal(applicantHasRole, false, "Role-only revocation must remove the configured owner role.");
      assert.equal(calls.filter((call) => call.path === `/api/v10/channels/${inviteChannelId}`).length, channelCheckCountBeforeRoleOnlyRevoke, "Role revocation must not depend on reading the private invite channel.");
      inviteChannelAvailable = true;

      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, created_at, completed_at
      ) VALUES ('account-closure-role-grant', 'account_closure_request', ?, ?, ?, ?, 'role_grant', 'started', 1, 'account-closure-role-grant-nonce', ?, ?, CURRENT_TIMESTAMP, NULL)`)
        .bind(deletingOwner.id, deletingOwner.discord_id, owner.id, owner.discord_id, guildId, verifiedOwnerRoleId).run();
      const closureResult = await deleteOwnedAccountData(env, deletingOwner.id);
      assert.equal(closureResult.ok, true, "Account closure must reconcile an in-progress role grant before anonymising the account.");
      assert.equal(deletingOwnerHasRole, false, "Account closure must remove a role that may have been granted before its delivery record completed.");
      assert.equal(roleRemovalSawAccount, true, "Discord owner-role reconciliation must happen before the account identity is deleted.");
      assert.equal(await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(deletingOwner.id).first(), null, "Account closure may anonymise only after uncertain role delivery has been reconciled.");

      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, created_at, completed_at
      ) VALUES ('blocked-account-closure-role-grant', 'blocked_account_closure_request', ?, ?, ?, ?, 'role_grant', 'retryable_failure', 1, 'blocked-account-closure-role-grant-nonce', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
        .bind(blockedOwner.id, blockedOwner.discord_id, owner.id, owner.discord_id, guildId, verifiedOwnerRoleId).run();
      const blockedClosure = await deleteOwnedAccountData(env, blockedOwner.id);
      assert.equal(blockedClosure.ok, false, "Account closure must stop when Discord owner-role removal fails.");
      if (!blockedClosure.ok) assert.equal(blockedClosure.status, 503);
      assert.equal(blockedOwnerRoleRemovalAttempted, true, "Account closure must reconcile a retryable role grant rather than assuming that Discord rejected it.");
      assert.equal(blockedOwnerHasRole, true, "A failed account closure must not leave the cleanup path pretending the role was removed.");
      assert.notEqual(await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(blockedOwner.id).first(), null, "A failed owner-role removal must preserve the account for a safe retry.");

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
