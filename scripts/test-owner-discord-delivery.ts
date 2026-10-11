import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createSession } from "../functions/_lib/db";
import {
  claimOwnerDiscordAccessRole,
  getOwnerDiscordDeliveryDiagnostic,
  getOwnerDiscordDeliverySummaries,
  issueOwnerDiscordAccessInvite,
  releaseOwnerDiscordRoleMutationLease,
  renewOwnerDiscordAccountDeletionLease,
  renewOwnerDiscordLinkedServerDeletionLease,
  reserveOwnerDiscordAccountDeletionLease,
  reserveOwnerDiscordLinkedServerDeletionLease,
  reserveOwnerDiscordRoleRevocationLease,
  revokeOwnerDiscordAccessRole,
} from "../functions/_lib/owner-discord-delivery";
import { deleteOwnedAccountData, deleteOwnedLinkedServerData } from "../functions/_lib/deletion";
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
const resolvedOwner: SessionUser = { id: "resolved_closure_owner", discord_id: "900000000000000011", username: "Resolved Closure Owner", avatar: null };
const retainedRoleOwner: SessionUser = { id: "retained_role_closure_owner", discord_id: "900000000000000012", username: "Retained Role Closure Owner", avatar: null };
const preflightFailedOwner: SessionUser = { id: "preflight_failed_owner", discord_id: "900000000000000013", username: "Preflight Failed Owner", avatar: null };
const inFlightInviteOwner: SessionUser = { id: "in_flight_invite_owner", discord_id: "900000000000000014", username: "In-flight Invite Owner", avatar: null };
const leaseRaceOwner: SessionUser = { id: "lease_race_owner", discord_id: "900000000000000016", username: "Lease Race Owner", avatar: null };
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
  assert.match(migration, /operation IN \('invite_issue', 'role_grant', 'role_revoke', 'revocation_decision', 'account_deletion'\)/);
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
  assert.match(helper, /ACCOUNT_DELETION_LEASE_MS/);
  assert.match(helper, /LINKED_SERVER_DELETION_LEASE_MS/);
  assert.match(helper, /renewRoleMutationLease/);
  assert.match(helper, /role_revoke_lease_lost/);
  assert.doesNotMatch(helper, /invite_code|stored invite|INSERT[\s\S]{0,300}code/i, "The delivery ledger must never store a reusable invite code.");
  const deletionHelper = readFileSync("functions/_lib/deletion.ts", "utf8");
  assert.match(deletionHelper, /revokeOwnerDiscordRoleForLinkedServerDeletion/);
  assert.match(deletionHelper, /renewOwnerDiscordAccountDeletionLease/);
  assert.match(deletionHelper, /renewOwnerDiscordLinkedServerDeletionLease/);
  assert.match(deletionHelper, /accountDeletionDiscordRoleLease/);
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
    for (const user of [owner, applicant, outsider, deletingOwner, blockedOwner, resolvedOwner, retainedRoleOwner, preflightFailedOwner, inFlightInviteOwner, leaseRaceOwner]) await db.prepare("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)").bind(user.id, user.discord_id, user.username, user.avatar).run();
    const seedEligibleServer = async (id: string, userId: string, serverName: string) => {
      await db.prepare("INSERT INTO linked_servers (id, user_id, server_name, status, lifecycle_status) VALUES (?, ?, ?, 'live', 'active_live')").bind(id, userId, serverName).run();
      await db.prepare("INSERT INTO nitrado_connections (id, user_id, linked_server_id, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')").bind(`connection-${id}`, userId, id).run();
      await db.prepare("INSERT INTO onboarding_checks (id, linked_server_id, token_valid, service_access, dayz_service_detected, last_tested_at) VALUES (?, ?, 1, 1, 1, '2026-01-01T00:01:00.000Z')").bind(`check-${id}`, id).run();
    };
    await seedEligibleServer("server_owner", applicant.id, "Verified owner server");
    await seedEligibleServer("server_outsider", outsider.id, "Other verified owner server");
    await seedEligibleServer("server_closing_owner", deletingOwner.id, "Closing owner server");
    await seedEligibleServer("server_blocked_closure_owner", blockedOwner.id, "Blocked closing owner server");
    await seedEligibleServer("server_resolved_closure_owner", resolvedOwner.id, "Resolved closing owner server");
    await seedEligibleServer("server_retained_role_closure_owner", retainedRoleOwner.id, "Retained role closing owner server");
    await seedEligibleServer("server_preflight_failed_owner", preflightFailedOwner.id, "Preflight failed owner server");
    await seedEligibleServer("server_in_flight_invite", inFlightInviteOwner.id, "In-flight invite owner server");
    await seedEligibleServer("server_lease_race_owner", leaseRaceOwner.id, "Lease race owner server");
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('approved_request', ?, ?, ?, 'server_owner', 'server_owner', 'Verified owner server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(applicant.id, applicant.discord_id, applicant.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
      ) VALUES ('other_request', ?, ?, ?, 'server_outsider', 'server_outsider', 'Other request', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(outsider.id, outsider.discord_id, outsider.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('account_closure_request', ?, ?, ?, 'server_closing_owner', 'server_closing_owner', 'Closing owner server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(deletingOwner.id, deletingOwner.discord_id, deletingOwner.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('blocked_account_closure_request', ?, ?, ?, 'server_blocked_closure_owner', 'server_blocked_closure_owner', 'Blocked closing owner server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(blockedOwner.id, blockedOwner.discord_id, blockedOwner.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('resolved_account_closure_request', ?, ?, ?, 'server_resolved_closure_owner', 'server_resolved_closure_owner', 'Resolved closing owner server', 'revoked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(resolvedOwner.id, resolvedOwner.discord_id, resolvedOwner.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('retained_role_account_closure_request', ?, ?, ?, 'server_retained_role_closure_owner', 'server_retained_role_closure_owner', 'Retained role closing owner server', 'revoked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(retainedRoleOwner.id, retainedRoleOwner.discord_id, retainedRoleOwner.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('preflight_failed_account_closure_request', ?, ?, ?, 'server_preflight_failed_owner', 'server_preflight_failed_owner', 'Preflight failed owner server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(preflightFailedOwner.id, preflightFailedOwner.discord_id, preflightFailedOwner.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('in_flight_invite_request', ?, ?, ?, 'server_in_flight_invite', 'server_in_flight_invite', 'In-flight invite owner server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(inFlightInviteOwner.id, inFlightInviteOwner.discord_id, inFlightInviteOwner.username).run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
    ) VALUES ('lease_race_request', ?, ?, ?, 'server_lease_race_owner', 'server_lease_race_owner', 'Lease race owner server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(leaseRaceOwner.id, leaseRaceOwner.discord_id, leaseRaceOwner.username).run();

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
    const preflightFailedOwnerSession = await createSession(env, preflightFailedOwner.id);
    const inFlightInviteOwnerSession = await createSession(env, inFlightInviteOwner.id);
    let applicantJoined = false;
    let applicantHasRole = false;
    let deletingOwnerHasRole = true;
    let roleRemovalSawAccount = false;
    let blockedOwnerHasRole = true;
    let blockedOwnerRoleRemovalAttempted = false;
    let leaseRaceOwnerHasRole = true;
    let stealLeaseRaceOwnerDuringPreflight = false;
    let leaseRaceOwnerRoleDeleteCalls = 0;
    const failBlockedOwnerRemoval = true;
    let inviteChannelAvailable = true;
    let pendingApplicantRoleGrant: { started: () => void; wait: Promise<void> } | null = null;
    let pendingInvitePreflight: { started: () => void; wait: Promise<void> } | null = null;
    let failBotIdentityPreflight = false;
    let activeBotPermissions = botPermissions;
    const calls: Array<{ path: string; method: string }> = [];
    const discordFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      calls.push({ path: url.pathname, method });
      if (url.pathname === "/api/v10/users/@me") {
        if (failBotIdentityPreflight) throw new Error("Simulated Discord preflight outage");
        if (stealLeaseRaceOwnerDuringPreflight) {
          stealLeaseRaceOwnerDuringPreflight = false;
          await db.prepare(`UPDATE dzn_owner_discord_access_role_mutations
            SET lease_id = 'stolen-lease', expires_at = '2099-01-01T00:00:00.000Z'
            WHERE discord_id = ?`).bind(leaseRaceOwner.discord_id).run();
        }
        return Response.json({ id: botUserId });
      }
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${botUserId}`) return Response.json({ roles: [botRoleId] });
      if (url.pathname === `/api/v10/guilds/${guildId}/roles`) return Response.json([
        { id: guildId, position: 0, permissions: "0" },
        { id: verifiedOwnerRoleId, position: 5, permissions: "0" },
        { id: botRoleId, position: 10, permissions: activeBotPermissions },
      ]);
      if (url.pathname === `/api/v10/channels/${inviteChannelId}`) {
        if (pendingInvitePreflight) {
          const gate = pendingInvitePreflight;
          pendingInvitePreflight = null;
          gate.started();
          await gate.wait;
        }
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
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${leaseRaceOwner.discord_id}`) {
        return Response.json({ roles: leaseRaceOwnerHasRole ? [verifiedOwnerRoleId] : [] });
      }
      if (url.pathname === `/api/v10/guilds/${guildId}/members/${leaseRaceOwner.discord_id}/roles/${verifiedOwnerRoleId}` && method === "DELETE") {
        leaseRaceOwnerRoleDeleteCalls += 1;
        leaseRaceOwnerHasRole = false;
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

      failBotIdentityPreflight = true;
      const preflightFailure = await claimOwnerDiscordAccessRole(env, request("POST", { requestId: "preflight_failed_account_closure_request" }, preflightFailedOwnerSession.token, "https://dzn.test"), { requestId: "preflight_failed_account_closure_request" }, discordFetch);
      failBotIdentityPreflight = false;
      assert.equal(preflightFailure.ok, false, "A Discord preflight outage must stop before any role mutation.");
      assert.equal(preflightFailure.status, 503);
      const preflightFailureLedger = await db.prepare("SELECT status, error_code FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = 'preflight_failed_account_closure_request' AND operation = 'role_grant' ORDER BY created_at DESC LIMIT 1").first<{ status: string; error_code: string | null }>();
      assert.equal(preflightFailureLedger?.status, "retryable_failure");
      assert.equal(preflightFailureLedger?.error_code, "discord_error", "Preflight failures must not be recorded as an ambiguous role mutation.");
      const preflightClosureMemberCalls = calls.filter((call) => call.path.includes(`/members/${preflightFailedOwner.discord_id}`)).length;
      const preflightClosure = await deleteOwnedAccountData({
        ...env,
        DZN_OWNER_DISCORD_GUILD_ID: "900000000000000014",
        DZN_OWNER_DISCORD_VERIFIED_OWNER_ROLE_ID: "900000000000000015",
      }, preflightFailedOwner.id);
      assert.equal(preflightClosure.ok, true, "A failed preflight must not block account closure after Discord configuration changes.");
      assert.equal(calls.filter((call) => call.path.includes(`/members/${preflightFailedOwner.discord_id}`)).length, preflightClosureMemberCalls, "Account closure must not call Discord for a role grant that never reached the mutation boundary.");
      assert.equal(await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(preflightFailedOwner.id).first(), null, "A preflight-only failure must not leave account deletion blocked.");

      await seedEligibleServer("server_stale_delivery", applicant.id, "Stale delivery server");
      await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
      ) VALUES ('stale_delivery_request', ?, ?, ?, 'server_stale_delivery', 'server_stale_delivery', 'Stale delivery server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(applicant.id, applicant.discord_id, applicant.username).run();
      await db.prepare("UPDATE linked_servers SET lifecycle_status = 'pending' WHERE id = 'server_stale_delivery'").run();
      const staleDeliveryCallCount = calls.length;
      const staleInvite = await issueOwnerDiscordAccessInvite(env, request("POST", { requestId: "stale_delivery_request" }, applicantSession.token, "https://dzn.test"), { requestId: "stale_delivery_request" }, discordFetch);
      assert.equal(staleInvite.ok, false, "A previously approved request must not create a private invite after its linked server is no longer live and verified.");
      assert.equal(staleInvite.status, 409);
      const staleClaim = await claimOwnerDiscordAccessRole(env, request("POST", { requestId: "stale_delivery_request" }, applicantSession.token, "https://dzn.test"), { requestId: "stale_delivery_request" }, discordFetch);
      assert.equal(staleClaim.ok, false, "A previously approved request must not grant a Discord owner role after its linked server is no longer live and verified.");
      assert.equal(staleClaim.status, 409);
      assert.equal(calls.length, staleDeliveryCallCount, "Invalidated owner requests must not call Discord for invite or role delivery.");
      const staleAttempts = await db.prepare("SELECT COUNT(*) AS count FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = 'stale_delivery_request'").first<{ count: number | string }>();
      assert.equal(Number(staleAttempts?.count ?? 0), 0, "Invalidated owner requests must not create a delivery attempt.");

      await seedEligibleServer("server_invite_lease", outsider.id, "Invite lease server");
      await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
      ) VALUES ('invite_lease_request', ?, ?, ?, 'server_invite_lease', 'server_invite_lease', 'Invite lease server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(outsider.id, outsider.discord_id, outsider.username).run();
      let invitePreflightStarted: (() => void) | null = null;
      const invitePreflightStartedPromise = new Promise<void>((resolve) => { invitePreflightStarted = resolve; });
      let releaseInvitePreflight: () => void = () => { throw new Error("The gated invite preflight was not initialised."); };
      const invitePreflightReleasePromise = new Promise<void>((resolve) => { releaseInvitePreflight = resolve; });
      pendingInvitePreflight = { started: () => invitePreflightStarted?.(), wait: invitePreflightReleasePromise };
      const inFlightInvite = issueOwnerDiscordAccessInvite(env, request("POST", { requestId: "invite_lease_request" }, outsiderSession.token, "https://dzn.test"), { requestId: "invite_lease_request" }, discordFetch);
      await invitePreflightStartedPromise;
      const blockedInviteRevocation = await decideOwnerDiscordAccessRequest(env, owner, {
        requestId: "invite_lease_request",
        action: "revoked",
        reason: "Private invite issuance must finish before access is revoked.",
        decisionNonce: "invite-lease-revocation-blocked",
      });
      assert.equal(blockedInviteRevocation.ok, false, "A revocation must not race an in-flight private invite issuance.");
      if (!blockedInviteRevocation.ok) assert.equal(blockedInviteRevocation.status, 409);
      releaseInvitePreflight();
      const completedInvite = await inFlightInvite;
      assert.equal(completedInvite.ok, true, "The existing invite may complete before the serialized revocation is recorded.");
      const completedInviteRevocation = await decideOwnerDiscordAccessRequest(env, owner, {
        requestId: "invite_lease_request",
        action: "revoked",
        reason: "Private invite access is no longer required.",
        decisionNonce: "invite-lease-revocation-complete",
      });
      assert.equal(completedInviteRevocation.ok, true, "The invitation lease must release before a later revocation can be recorded.");

      await seedEligibleServer("server_invite_recheck", outsider.id, "Invite recheck server");
      await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
      ) VALUES ('invite_recheck_request', ?, ?, ?, 'server_invite_recheck', 'server_invite_recheck', 'Invite recheck server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(outsider.id, outsider.discord_id, outsider.username).run();
      let inviteRecheckStarted: (() => void) | null = null;
      const inviteRecheckStartedPromise = new Promise<void>((resolve) => { inviteRecheckStarted = resolve; });
      let releaseInviteRecheck: () => void = () => { throw new Error("The gated invite recheck was not initialised."); };
      const inviteRecheckReleasePromise = new Promise<void>((resolve) => { releaseInviteRecheck = resolve; });
      const invitePostsBeforeRecheck = calls.filter((call) => call.path === `/api/v10/channels/${inviteChannelId}/invites` && call.method === "POST").length;
      pendingInvitePreflight = { started: () => inviteRecheckStarted?.(), wait: inviteRecheckReleasePromise };
      const inFlightRecheckedInvite = issueOwnerDiscordAccessInvite(env, request("POST", { requestId: "invite_recheck_request" }, outsiderSession.token, "https://dzn.test"), { requestId: "invite_recheck_request" }, discordFetch);
      await inviteRecheckStartedPromise;
      await db.prepare("UPDATE dzn_owner_discord_access_requests SET status = 'revoked' WHERE id = 'invite_recheck_request'").run();
      releaseInviteRecheck();
      const rejectedRecheckedInvite = await inFlightRecheckedInvite;
      assert.equal(rejectedRecheckedInvite.ok, false, "A final approval check must stop invite creation after a concurrent decision change.");
      assert.equal(rejectedRecheckedInvite.status, 409);
      assert.equal(calls.filter((call) => call.path === `/api/v10/channels/${inviteChannelId}/invites` && call.method === "POST").length, invitePostsBeforeRecheck, "A revoked request must not create a private Discord invite after preflight.");

      let accountDeletionInviteStarted: (() => void) | null = null;
      const accountDeletionInviteStartedPromise = new Promise<void>((resolve) => { accountDeletionInviteStarted = resolve; });
      let releaseAccountDeletionInvite: () => void = () => { throw new Error("The account-deletion invite gate was not initialised."); };
      const accountDeletionInviteReleasePromise = new Promise<void>((resolve) => { releaseAccountDeletionInvite = resolve; });
      pendingInvitePreflight = { started: () => accountDeletionInviteStarted?.(), wait: accountDeletionInviteReleasePromise };
      const inFlightAccountDeletionInvite = issueOwnerDiscordAccessInvite(env, request("POST", { requestId: "in_flight_invite_request" }, inFlightInviteOwnerSession.token, "https://dzn.test"), { requestId: "in_flight_invite_request" }, discordFetch);
      await accountDeletionInviteStartedPromise;
      const blockedAccountDeletion = await deleteOwnedAccountData(env, inFlightInviteOwner.id);
      assert.equal(blockedAccountDeletion.ok, false, "Account deletion must not race a private invite that is already in flight.");
      if (!blockedAccountDeletion.ok) assert.equal(blockedAccountDeletion.status, 409);
      assert.notEqual(await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(inFlightInviteOwner.id).first(), null, "An account must remain intact while an invite lease is active.");
      releaseAccountDeletionInvite();
      const completedAccountDeletionInvite = await inFlightAccountDeletionInvite;
      assert.equal(completedAccountDeletionInvite.ok, true, "The already-started private invite may finish before account closure is retried.");
      const completedAccountDeletion = await deleteOwnedAccountData(env, inFlightInviteOwner.id);
      assert.equal(completedAccountDeletion.ok, true, "Account deletion may proceed once the private invite lease has finished.");
      assert.equal(await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(inFlightInviteOwner.id).first(), null, "A completed account deletion must remove the account after its invite lease is released.");

      await seedEligibleServer("server_race", applicant.id, "Role mutation race server");
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

      await seedEligibleServer("server_same_discord", applicant.id, "Same Discord verified server");
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
      const roleOnlyRevoke = await revokeOwnerDiscordAccessRole({ ...env, DZN_OWNER_DISCORD_DELIVERY_ENABLED: "false" }, owner, { requestId: "same_discord_approved_request" }, discordFetch);
      assert.equal(roleOnlyRevoke.ok, true, "Role revocation must work even when new Discord delivery is disabled and the private invite channel is unavailable.");
      assert.equal(applicantHasRole, false, "Role-only revocation must remove the configured owner role.");
      assert.equal(calls.filter((call) => call.path === `/api/v10/channels/${inviteChannelId}`).length, channelCheckCountBeforeRoleOnlyRevoke, "Role revocation must not depend on reading the private invite channel.");
      inviteChannelAvailable = true;

      await seedEligibleServer("server_approval_lease", outsider.id, "Approval lease server");
      await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
      ) VALUES ('approval_lease_request', ?, ?, ?, 'server_approval_lease', 'server_approval_lease', 'Approval lease server', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(outsider.id, outsider.discord_id, outsider.username).run();
      const heldRevocationLease = await reserveOwnerDiscordRoleRevocationLease(env, "other_request", outsider.discord_id);
      assert.notEqual(heldRevocationLease.lease, null, "An in-progress role cleanup must reserve the Discord identity before the decision changes.");
      const blockedApproval = await decideOwnerDiscordAccessRequest(env, owner, {
        requestId: "approval_lease_request",
        action: "approved",
        reason: "Approval must wait for current Discord role cleanup.",
        decisionNonce: "approval-lease-blocked",
      });
      assert.equal(blockedApproval.ok, false, "Approval must not race a role revocation that is still deciding whether to remove the shared Discord role.");
      if (!blockedApproval.ok) assert.equal(blockedApproval.status, 409);
      assert.equal((await db.prepare("SELECT status FROM dzn_owner_discord_access_requests WHERE id = 'approval_lease_request'").first<{ status: string }>())?.status, "pending", "A blocked approval must not publish a new owner-access decision.");
      await releaseOwnerDiscordRoleMutationLease(env, heldRevocationLease.lease);
      const completedApproval = await decideOwnerDiscordAccessRequest(env, owner, {
        requestId: "approval_lease_request",
        action: "approved",
        reason: "Discord cleanup has completed and this server remains verified.",
        decisionNonce: "approval-lease-complete",
      });
      assert.equal(completedApproval.ok, true, "Approval may proceed after the concurrent Discord role cleanup lease releases.");

      await seedEligibleServer("server_delete_role", applicant.id, "Server removal role cleanup");
      await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
      ) VALUES ('server_delete_role_request', ?, ?, ?, 'server_delete_role', 'server_delete_role', 'Server removal role cleanup', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(applicant.id, applicant.discord_id, applicant.username).run();
      const accountDeletionLease = await reserveOwnerDiscordAccountDeletionLease(env, applicant.id);
      assert.equal(accountDeletionLease.required, true, "An owner-access account must reserve its Discord identity before account cleanup.");
      assert.notEqual(accountDeletionLease.lease, null, "The account-deletion reservation must acquire the Discord identity lease.");
      if (accountDeletionLease.lease) {
        const initialLease = await db.prepare("SELECT expires_at FROM dzn_owner_discord_access_role_mutations WHERE lease_id = ?").bind(accountDeletionLease.lease.leaseId).first<{ expires_at: string }>();
        assert.ok(Date.parse(initialLease?.expires_at ?? "") - Date.now() > 4 * 60 * 1000, "Account deletion must begin with a longer-lived owner-role reservation.");
        await db.prepare("UPDATE dzn_owner_discord_access_role_mutations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE lease_id = ?").bind(accountDeletionLease.lease.leaseId).run();
        assert.equal(await renewOwnerDiscordAccountDeletionLease(env, accountDeletionLease.lease), true, "Account cleanup must renew its held Discord identity lease before destructive work continues.");
        const renewedLease = await db.prepare("SELECT expires_at FROM dzn_owner_discord_access_role_mutations WHERE lease_id = ?").bind(accountDeletionLease.lease.leaseId).first<{ expires_at: string }>();
        assert.ok(Date.parse(renewedLease?.expires_at ?? "") - Date.now() > 4 * 60 * 1000, "A renewed account-deletion reservation must remain valid for the cleanup window.");
      }
      await releaseOwnerDiscordRoleMutationLease(env, accountDeletionLease.lease);

      await seedEligibleServer("server_account_lease_child", applicant.id, "Account lease child cleanup");
      await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
      ) VALUES ('account_lease_child_request', ?, ?, ?, 'server_account_lease_child', 'server_account_lease_child', 'Account lease child cleanup', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(applicant.id, applicant.discord_id, applicant.username).run();
      const accountChildLease = await reserveOwnerDiscordAccountDeletionLease(env, applicant.id);
      assert.notEqual(accountChildLease.lease, null, "Account child cleanup must inherit an owned Discord role-mutation reservation.");
      if (accountChildLease.lease) {
        await db.prepare("UPDATE dzn_owner_discord_access_role_mutations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE lease_id = ?").bind(accountChildLease.lease.leaseId).run();
        const accountChildDeletion = await deleteOwnedLinkedServerData(env, applicant.id, "server_account_lease_child", {
          skipOwnerDiscordRoleCleanup: true,
          accountDeletionDiscordRoleLease: accountChildLease.lease,
        });
        assert.equal(accountChildDeletion.ok, true, "Nested account cleanup must renew the inherited Discord reservation before destructive server work.");
        const inheritedLease = await db.prepare("SELECT lease_id, expires_at FROM dzn_owner_discord_access_role_mutations WHERE discord_id = ? LIMIT 1").bind(applicant.discord_id).first<{ lease_id: string; expires_at: string }>();
        assert.equal(inheritedLease?.lease_id, accountChildLease.lease.leaseId, "Nested server cleanup must not release the account-level Discord reservation.");
        assert.ok(Date.parse(inheritedLease?.expires_at ?? "") - Date.now() > 4 * 60 * 1000, "Nested server cleanup must renew the inherited account reservation through destructive phases.");
      }
      await releaseOwnerDiscordRoleMutationLease(env, accountChildLease.lease);

      const linkedServerDeletionLease = await reserveOwnerDiscordLinkedServerDeletionLease(env, applicant.id, "server_delete_role");
      assert.equal(linkedServerDeletionLease.required, true, "Deleting a verified server must reserve its Discord identity before cleanup.");
      assert.notEqual(linkedServerDeletionLease.lease, null, "The linked-server deletion reservation must acquire the Discord identity lease.");
      if (linkedServerDeletionLease.lease) {
        const initialLease = await db.prepare("SELECT expires_at FROM dzn_owner_discord_access_role_mutations WHERE lease_id = ?").bind(linkedServerDeletionLease.lease.leaseId).first<{ expires_at: string }>();
        assert.ok(Date.parse(initialLease?.expires_at ?? "") - Date.now() > 4 * 60 * 1000, "Linked-server deletion must begin with a longer-lived owner-role reservation.");
        await db.prepare("UPDATE dzn_owner_discord_access_role_mutations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE lease_id = ?").bind(linkedServerDeletionLease.lease.leaseId).run();
        assert.equal(await renewOwnerDiscordLinkedServerDeletionLease(env, linkedServerDeletionLease.lease), true, "Linked-server cleanup must renew its held Discord identity lease before destructive work continues.");
        const renewedLease = await db.prepare("SELECT expires_at FROM dzn_owner_discord_access_role_mutations WHERE lease_id = ?").bind(linkedServerDeletionLease.lease.leaseId).first<{ expires_at: string }>();
        assert.ok(Date.parse(renewedLease?.expires_at ?? "") - Date.now() > 4 * 60 * 1000, "A renewed linked-server reservation must remain valid for the cleanup window.");
      }
      await releaseOwnerDiscordRoleMutationLease(env, linkedServerDeletionLease.lease);
      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, created_at, completed_at
      ) VALUES ('server-delete-role-grant', 'server_delete_role_request', ?, ?, ?, ?, 'role_grant', 'succeeded', 1, 'server-delete-role-grant-nonce', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
        .bind(applicant.id, applicant.discord_id, owner.id, owner.discord_id, guildId, verifiedOwnerRoleId).run();
      applicantHasRole = true;
      const directServerDeletion = await deleteOwnedLinkedServerData(env, applicant.id, "server_delete_role");
      assert.equal(directServerDeletion.ok, true, "Deleting the last verified server must remove the corresponding Discord owner role first.");
      assert.equal(applicantHasRole, false, "Removing the final qualifying server must not leave the Verified Server Owner role active.");
      assert.equal(await db.prepare("SELECT id FROM linked_servers WHERE id = 'server_delete_role'").first(), null, "The server may be removed after Discord owner-role cleanup succeeds.");
      const directServerDeletionLedger = await db.prepare("SELECT status, actor_user_id FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = 'server_delete_role_request' AND operation = 'role_revoke' ORDER BY created_at DESC LIMIT 1").first<{ status: string; actor_user_id: string | null }>();
      assert.equal(directServerDeletionLedger?.status, "succeeded", "Server deletion must record the role-removal result in the protected delivery ledger.");
      assert.equal(directServerDeletionLedger?.actor_user_id, applicant.id, "A server owner deleting their own server must remain attributable in the role-removal audit.");

      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, created_at, completed_at
      ) VALUES ('lease-race-role-grant', 'lease_race_request', ?, ?, ?, ?, 'role_grant', 'succeeded', 1, 'lease-race-role-grant-nonce', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
        .bind(leaseRaceOwner.id, leaseRaceOwner.discord_id, owner.id, owner.discord_id, guildId, verifiedOwnerRoleId).run();
      stealLeaseRaceOwnerDuringPreflight = true;
      const lostLeaseServerDeletion = await deleteOwnedLinkedServerData(env, leaseRaceOwner.id, "server_lease_race_owner");
      assert.equal(lostLeaseServerDeletion.ok, false, "Server deletion must stop when its Discord owner-role reservation is lost during the preflight.");
      if (!lostLeaseServerDeletion.ok) assert.equal(lostLeaseServerDeletion.status, 409);
      assert.equal(leaseRaceOwnerHasRole, true, "A lost reservation must not remove an owner role after another operation has reclaimed it.");
      assert.equal(leaseRaceOwnerRoleDeleteCalls, 0, "A lost reservation must stop before the Discord role-delete request.");
      assert.notEqual(await db.prepare("SELECT id FROM linked_servers WHERE id = 'server_lease_race_owner'").first(), null, "A lost reservation must preserve the linked server for a safe retry.");
      const lostLeaseLedger = await db.prepare("SELECT status, error_code FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = 'lease_race_request' AND operation = 'role_revoke' ORDER BY created_at DESC LIMIT 1").first<{ status: string; error_code: string | null }>();
      assert.equal(lostLeaseLedger?.status, "retryable_failure", "The protected audit must record a reservation-loss retry state.");
      assert.equal(lostLeaseLedger?.error_code, "role_revoke_lease_lost");
      await db.prepare("DELETE FROM dzn_owner_discord_access_role_mutations WHERE discord_id = ?").bind(leaseRaceOwner.discord_id).run();

      await seedEligibleServer("server_delete_keep", applicant.id, "Deleted verified server");
      await seedEligibleServer("server_delete_keep_other", applicant.id, "Remaining verified server");
      await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
      ) VALUES ('server_delete_keep_request', ?, ?, ?, 'server_delete_keep', 'server_delete_keep', 'Deleted verified server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(applicant.id, applicant.discord_id, applicant.username).run();
      await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, status, created_at, updated_at
      ) VALUES ('server_delete_keep_other_request', ?, ?, ?, 'server_delete_keep_other', 'server_delete_keep_other', 'Remaining verified server', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(applicant.id, applicant.discord_id, applicant.username).run();
      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, created_at, completed_at
      ) VALUES ('server-delete-keep-role-grant', 'server_delete_keep_request', ?, ?, ?, ?, 'role_grant', 'succeeded', 1, 'server-delete-keep-role-grant-nonce', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
        .bind(applicant.id, applicant.discord_id, owner.id, owner.discord_id, guildId, verifiedOwnerRoleId).run();
      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, created_at, completed_at
      ) VALUES ('server-delete-keep-other-role-grant', 'server_delete_keep_other_request', ?, ?, ?, ?, 'role_grant', 'succeeded', 1, 'server-delete-keep-other-role-grant-nonce', ?, ?, '2099-02-01T00:00:00.000Z', '2099-02-01T00:00:01.000Z')`)
        .bind(applicant.id, applicant.discord_id, owner.id, owner.discord_id, guildId, verifiedOwnerRoleId).run();
      applicantHasRole = true;
      const roleDeletesBeforeOtherServer = calls.filter((call) => call.path.endsWith(`/members/${applicant.discord_id}/roles/${verifiedOwnerRoleId}`) && call.method === "DELETE").length;
      const retainedServerRole = await deleteOwnedLinkedServerData(env, applicant.id, "server_delete_keep");
      assert.equal(retainedServerRole.ok, true, "A server may be removed while another currently verified server still qualifies the same Discord owner.");
      assert.equal(applicantHasRole, true, "Another qualifying verified server must preserve the shared Verified Server Owner role.");
      assert.equal(calls.filter((call) => call.path.endsWith(`/members/${applicant.discord_id}/roles/${verifiedOwnerRoleId}`) && call.method === "DELETE").length, roleDeletesBeforeOtherServer, "DZN must not send a role-delete request while another qualifying server remains.");
      const retainedServerRoleLedger = await db.prepare("SELECT status, error_code FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = 'server_delete_keep_other_request' AND operation = 'role_revoke' ORDER BY created_at DESC LIMIT 1").first<{ status: string; error_code: string | null }>();
      assert.equal(retainedServerRoleLedger?.status, "succeeded");
      assert.equal(retainedServerRoleLedger?.error_code, "other_approved_request", "The audit must explain why the shared owner role remained active.");
      const finalServerRole = await deleteOwnedLinkedServerData(env, applicant.id, "server_delete_keep_other");
      assert.equal(finalServerRole.ok, true, "Deleting the final qualifying server must reconcile a role grant recorded for an earlier deleted server.");
      assert.equal(applicantHasRole, false, "The Verified Server Owner role must be removed after the last qualifying server is gone.");
      assert.equal(calls.filter((call) => call.path.endsWith(`/members/${applicant.discord_id}/roles/${verifiedOwnerRoleId}`) && call.method === "DELETE").length, roleDeletesBeforeOtherServer + 1, "The final server deletion must send exactly one Discord role-delete request.");
      assert.equal(await db.prepare("SELECT id FROM linked_servers WHERE id = 'server_delete_keep_other'").first(), null, "The final qualifying server may be removed after shared-role cleanup succeeds.");
      const finalServerRoleLedger = await db.prepare("SELECT status, error_code FROM dzn_owner_discord_access_delivery_attempts WHERE request_id = 'server_delete_keep_other_request' AND operation = 'role_revoke' ORDER BY attempt_number DESC, created_at DESC, id DESC LIMIT 1").first<{ status: string; error_code: string | null }>();
      assert.equal(finalServerRoleLedger?.status, "succeeded");
      assert.equal(finalServerRoleLedger?.error_code, null, "The final cleanup must replace the prior retained-role audit outcome with a confirmed removal.");

      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, error_code, created_at, completed_at
      ) VALUES ('account-closure-role-grant', 'account_closure_request', ?, ?, ?, ?, 'role_grant', 'started', 1, 'account-closure-role-grant-nonce', ?, ?, 'role_grant_may_have_reached', CURRENT_TIMESTAMP, NULL)`)
        .bind(deletingOwner.id, deletingOwner.discord_id, owner.id, owner.discord_id, guildId, verifiedOwnerRoleId).run();
      const closureResult = await deleteOwnedAccountData(env, deletingOwner.id);
      assert.equal(closureResult.ok, true, "Account closure must reconcile an in-progress role grant before anonymising the account.");
      assert.equal(deletingOwnerHasRole, false, "Account closure must remove a role that may have been granted before its delivery record completed.");
      assert.equal(roleRemovalSawAccount, true, "Discord owner-role reconciliation must happen before the account identity is deleted.");
      assert.equal(await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(deletingOwner.id).first(), null, "Account closure may anonymise only after uncertain role delivery has been reconciled.");

      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, created_at, completed_at
      ) VALUES ('resolved-account-closure-role-grant', 'resolved_account_closure_request', ?, ?, ?, ?, 'role_grant', 'succeeded', 1, 'resolved-account-closure-role-grant-nonce', 'retired-guild', 'retired-role', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z')`)
        .bind(resolvedOwner.id, resolvedOwner.discord_id, owner.id, owner.discord_id).run();
      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, created_at, completed_at
      ) VALUES ('resolved-account-closure-role-revoke', 'resolved_account_closure_request', ?, ?, ?, ?, 'role_revoke', 'succeeded', 1, 'resolved-account-closure-role-revoke-nonce', 'retired-guild', 'retired-role', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:01.000Z')`)
        .bind(resolvedOwner.id, resolvedOwner.discord_id, owner.id, owner.discord_id).run();
      const resolvedClosure = await deleteOwnedAccountData(env, resolvedOwner.id);
      assert.equal(resolvedClosure.ok, true, "A confirmed historical role removal must not block account closure after Discord role configuration changes.");
      assert.equal(await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(resolvedOwner.id).first(), null, "Account closure must ignore grants that a confirmed role removal has already resolved.");

      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, created_at, completed_at
      ) VALUES ('retained-role-account-closure-grant', 'retained_role_account_closure_request', ?, ?, ?, ?, 'role_grant', 'succeeded', 1, 'retained-role-account-closure-grant-nonce', 'retired-guild', 'retired-role', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z')`)
        .bind(retainedRoleOwner.id, retainedRoleOwner.discord_id, owner.id, owner.discord_id).run();
      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, error_code, created_at, completed_at
      ) VALUES ('retained-role-account-closure-role-revoke', 'retained_role_account_closure_request', ?, ?, ?, ?, 'role_revoke', 'succeeded', 1, 'retained-role-account-closure-role-revoke-nonce', 'retired-guild', 'retired-role', 'other_approved_request', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:01.000Z')`)
        .bind(retainedRoleOwner.id, retainedRoleOwner.discord_id, owner.id, owner.discord_id).run();
      const retainedRoleClosure = await deleteOwnedAccountData(env, retainedRoleOwner.id);
      assert.equal(retainedRoleClosure.ok, false, "A retained role outcome must not be mistaken for a confirmed Discord role removal.");
      if (!retainedRoleClosure.ok) assert.equal(retainedRoleClosure.status, 503);
      assert.notEqual(await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(retainedRoleOwner.id).first(), null, "Account closure must preserve an account while a recorded Discord role may still be active.");

      await db.prepare(`INSERT INTO dzn_owner_discord_access_delivery_attempts (
        id, request_id, requester_user_id, requester_discord_id, actor_user_id, actor_discord_id, operation, status, attempt_number, delivery_nonce, guild_id, role_id, error_code, created_at, completed_at
      ) VALUES ('blocked-account-closure-role-grant', 'blocked_account_closure_request', ?, ?, ?, ?, 'role_grant', 'retryable_failure', 1, 'blocked-account-closure-role-grant-nonce', ?, ?, 'role_grant_may_have_reached', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
        .bind(blockedOwner.id, blockedOwner.discord_id, owner.id, owner.discord_id, guildId, verifiedOwnerRoleId).run();
      const blockedClosure = await deleteOwnedAccountData(env, blockedOwner.id);
      assert.equal(blockedClosure.ok, false, "Account closure must stop when Discord owner-role removal fails.");
      if (!blockedClosure.ok) assert.equal(blockedClosure.status, 503);
      assert.equal(blockedOwnerRoleRemovalAttempted, true, "Account closure must reconcile a retryable role grant rather than assuming that Discord rejected it.");
      assert.equal(blockedOwnerHasRole, true, "A failed account closure must not leave the cleanup path pretending the role was removed.");
      assert.notEqual(await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(blockedOwner.id).first(), null, "A failed owner-role removal must preserve the account for a safe retry.");
      const blockedServerDeletion = await deleteOwnedLinkedServerData(env, blockedOwner.id, "server_blocked_closure_owner");
      assert.equal(blockedServerDeletion.ok, false, "Server deletion must stop when DZN cannot confirm Discord owner-role removal.");
      if (!blockedServerDeletion.ok) assert.equal(blockedServerDeletion.status, 503);
      assert.notEqual(await db.prepare("SELECT id FROM linked_servers WHERE id = 'server_blocked_closure_owner'").first(), null, "A failed Discord role removal must preserve the linked server for a safe retry.");

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
