import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { createSession, SESSION_COOKIE } from "../functions/_lib/db";
import type { Env, PagesFunction } from "../functions/_lib/types";
import { onRequest as playerDirectory } from "../functions/api/player/community-directory";
import { onRequest as publicDirectory } from "../functions/api/public/servers/[slug]/community-members";
import { onRequest as candidateDirectory } from "../functions/api/servers/[serverId]/community-member-candidates";
import { onRequest as ownerDirectory } from "../functions/api/servers/[serverId]/community-members";

type SqliteStatement = {
  run(...values: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...values: unknown[]): Record<string, unknown> | undefined;
  all(...values: unknown[]): Array<Record<string, unknown>>;
};
type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
};

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => SqliteDatabase };

class SqliteD1Database {
  readonly sqlite = new DatabaseSync(":memory:");

  prepare(query: string) {
    return new SqliteD1PreparedStatement(this.sqlite, query);
  }

  async batch(statements: SqliteD1PreparedStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class SqliteD1PreparedStatement {
  constructor(
    private readonly sqlite: SqliteDatabase,
    private readonly query: string,
    private readonly bindings: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new SqliteD1PreparedStatement(this.sqlite, this.query, values);
  }

  async run() {
    const result = this.sqlite.prepare(this.query).run(...this.bindings);
    return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }

  async first<T = Record<string, unknown>>() {
    return (this.sqlite.prepare(this.query).get(...this.bindings) ?? null) as T | null;
  }

  async all<T = Record<string, unknown>>() {
    return { success: true, meta: {}, results: this.sqlite.prepare(this.query).all(...this.bindings) as T[] };
  }
}

async function main() {
const db = new SqliteD1Database();
db.sqlite.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL UNIQUE,
    username TEXT,
    avatar TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE discord_guilds (
    id TEXT PRIMARY KEY,
    name TEXT,
    icon_url TEXT
  );
  CREATE TABLE linked_servers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    discord_guild_id TEXT,
    public_slug TEXT,
    display_name TEXT,
    hostname TEXT,
    server_name TEXT,
    status TEXT,
    listing_visibility TEXT,
    lifecycle_status TEXT,
    merged_into_server_id TEXT
  );
  CREATE TABLE player_public_profiles (
    user_id TEXT PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL
  );
  CREATE TABLE player_profile_privacy_preferences (
    user_id TEXT PRIMARY KEY,
    public_profile_enabled INTEGER NOT NULL,
    show_display_name INTEGER NOT NULL
  );
  CREATE TABLE player_public_discord_identity_preferences (
    user_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL
  );
  ${require("node:fs").readFileSync("migrations/0080_server_community_directory.sql", "utf8")}
  ${require("node:fs").readFileSync("migrations/0090_server_community_member_sources.sql", "utf8")}
`);

const seed = db.sqlite.prepare.bind(db.sqlite);
seed("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)").run("owner", "100000000000000001", "Owner", null);
seed("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)").run("other-owner", "100000000000000002", "Other", null);
seed("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)").run("player", "100000000000000003", "Private Name", "avatar-hash");
seed("INSERT INTO discord_guilds (id, name, icon_url) VALUES (?, ?, ?)").run("guild", "DZN Test Community", null);
seed(`INSERT INTO linked_servers (
  id, user_id, guild_id, discord_guild_id, public_slug, display_name, server_name, status, listing_visibility, lifecycle_status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("server", "owner", "guild-external", "guild", "test-server", "Test Server", "Test Server", "live", "public", "active_live");
seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, ?)").run("player", "hidden-player", "active");
seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled, show_display_name) VALUES (?, ?, ?)").run("player", 1, 0);
seed("INSERT INTO player_public_discord_identity_preferences (user_id, enabled) VALUES (?, ?)").run("player", 1);
assert.ok(
  db.sqlite.prepare("PRAGMA index_list('server_community_members')").all().some((row) => row.name === "idx_server_community_members_user_updated"),
  "The runtime schema must expose the player consent lookup index.",
);

const env = { DB: db as unknown as D1Database, SESSION_SECRET: "community-runtime-test" } as Env;
const ownerSession = await createSession(env, "owner");
const otherSession = await createSession(env, "other-owner");
const playerSession = await createSession(env, "player");

const unsupportedCandidates = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/server/community-member-candidates", {
  method: "DELETE",
}), env, { serverId: "server" });
assert.equal(unsupportedCandidates.status, 405, "The private candidate endpoint must reject unsupported methods.");

const anonymousCandidates = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/server/community-member-candidates"), env, { serverId: "server" });
assert.equal(anonymousCandidates.status, 401, "The private candidate queue must require authentication.");
assert.match(anonymousCandidates.headers.get("cache-control") ?? "", /private.*no-store/, "Private candidate responses must never be cached.");

const forbiddenCandidates = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/server/community-member-candidates", {
  headers: cookie(otherSession.token),
}), env, { serverId: "server" });
assert.equal(forbiddenCandidates.status, 403, "Another server owner must not read the private candidate queue.");

const missingServerCandidates = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/missing/community-member-candidates", {
  headers: cookie(ownerSession.token),
}), env, { serverId: "missing" });
assert.equal(missingServerCandidates.status, 404, "Unknown servers must not expose a candidate queue.");

const crossOriginCandidate = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/server/community-member-candidates", {
  method: "POST",
  headers: { ...cookie(ownerSession.token), "content-type": "application/json", origin: "https://attacker.test" },
  body: JSON.stringify({ discord_id: "100000000000000003", username: "Private Name" }),
}), env, { serverId: "server" });
assert.equal(crossOriginCandidate.status, 403, "Candidate writes must require the website's exact origin.");

const oversizedCandidate = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/server/community-member-candidates", {
  method: "POST",
  headers: { ...cookie(ownerSession.token), "content-type": "application/json", origin: "https://dzn.test" },
  body: JSON.stringify({ discord_id: "100000000000000003", username: "x".repeat(5000) }),
}), env, { serverId: "server" });
assert.equal(oversizedCandidate.status, 413, "Candidate request bodies must remain bounded.");

const invalidCandidate = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/server/community-member-candidates", {
  method: "POST",
  headers: { ...cookie(ownerSession.token), "content-type": "application/json", origin: "https://dzn.test" },
  body: JSON.stringify({ discord_id: "not-a-discord-id", username: "Private Name" }),
}), env, { serverId: "server" });
assert.equal(invalidCandidate.status, 400, "Helper validation status must propagate through the candidate endpoint.");

const nullCandidate = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/server/community-member-candidates", {
  method: "POST",
  headers: { ...cookie(ownerSession.token), "content-type": "application/json", origin: "https://dzn.test" },
  body: "null",
}), env, { serverId: "server" });
assert.equal(nullCandidate.status, 400, "JSON primitives must be rejected as invalid request bodies rather than reported as unavailable infrastructure.");

const createCandidateResponse = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/server/community-member-candidates", {
  method: "POST",
  headers: { ...cookie(ownerSession.token), "content-type": "application/json", origin: "https://dzn.test" },
  body: JSON.stringify({ discord_id: "100000000000000003", username: "Private Name", role_label: "Member" }),
}), env, { serverId: "server" });
assert.equal(createCandidateResponse.status, 201, "The current server owner must be able to queue an exact Discord account match.");

const candidateQueueResponse = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/server/community-member-candidates", {
  headers: cookie(ownerSession.token),
}), env, { serverId: "server" });
assert.equal(candidateQueueResponse.status, 200);
const candidateQueue = await candidateQueueResponse.json() as { candidates: Array<{ id: string; status: string }> };
assert.equal(candidateQueue.candidates.length, 1);
assert.equal(candidateQueue.candidates[0].status, "pending");

const rejectCandidateResponse = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/server/community-member-candidates", {
  method: "PATCH",
  headers: { ...cookie(ownerSession.token), "content-type": "application/json", origin: "https://dzn.test" },
  body: JSON.stringify({ id: candidateQueue.candidates[0].id, action: "reject", reason: "Runtime route proof" }),
}), env, { serverId: "server" });
assert.equal(rejectCandidateResponse.status, 200, "Decision helper status must propagate through the candidate endpoint.");
assert.equal(db.sqlite.prepare("SELECT status FROM server_community_member_candidates WHERE id = ?").get(candidateQueue.candidates[0].id)?.status, "rejected");

const anonymousPlayer = await invoke(playerDirectory, new Request("https://dzn.test/api/player/community-directory"), env);
assert.equal(anonymousPlayer.status, 401, "Player directory reads must require authentication.");

const anonymousOwner = await invoke(ownerDirectory, new Request("https://dzn.test/api/servers/server/community-members"), env, { serverId: "server" });
assert.equal(anonymousOwner.status, 401, "Owner directory reads must require authentication.");

const forbiddenOwner = await invoke(ownerDirectory, new Request("https://dzn.test/api/servers/server/community-members", {
  headers: cookie(otherSession.token),
}), env, { serverId: "server" });
assert.equal(forbiddenOwner.status, 403, "A different server owner must not manage this directory.");

const addResponse = await invoke(ownerDirectory, new Request("https://dzn.test/api/servers/server/community-members", {
  method: "POST",
  headers: { ...cookie(ownerSession.token), "content-type": "application/json", origin: "https://dzn.test" },
  body: JSON.stringify({ handle: "hidden-player", role_label: "Community member", publish: true }),
}), env, { serverId: "server" });
assert.equal(addResponse.status, 201, "The owning account must be able to add a published-profile candidate.");

const editResponse = await invoke(ownerDirectory, new Request("https://dzn.test/api/servers/server/community-members", {
  method: "POST",
  headers: { ...cookie(ownerSession.token), "content-type": "application/json", origin: "https://dzn.test" },
  body: JSON.stringify({ handle: "hidden-player", role_label: "Squad leader", publish: true }),
}), env, { serverId: "server" });
assert.equal(editResponse.status, 201, "Submitting an existing handle must update its managed membership.");
assert.deepEqual(
  db.sqlite.prepare("SELECT action FROM server_community_member_audit ORDER BY rowid ASC").all().map((row) => row.action),
  ["add", "update"],
  "Membership creation and later edits must remain distinguishable in the audit history.",
);

let publicPayload = await jsonPayload(await invoke(publicDirectory, new Request("https://dzn.test/api/public/servers/test-server/community-members"), env, { slug: "test-server" }));
assert.deepEqual(publicPayload.members, [], "Owner publication alone must never make a player public.");

const invitationsBefore = await jsonPayload(await invoke(playerDirectory, new Request("https://dzn.test/api/player/community-directory", {
  headers: cookie(playerSession.token),
}), env));
assert.equal(invitationsBefore.invitations.length, 1, "The player must receive the owner-created invitation.");
const memberId = String(invitationsBefore.invitations[0].id);

const approveResponse = await invoke(playerDirectory, new Request("https://dzn.test/api/player/community-directory", {
  method: "PATCH",
  headers: { ...cookie(playerSession.token), "content-type": "application/json", origin: "https://dzn.test" },
  body: JSON.stringify({ id: memberId, approve: true }),
}), env);
assert.equal(approveResponse.status, 200, "The invited player must be able to approve their own listing.");

publicPayload = await jsonPayload(await invoke(publicDirectory, new Request("https://dzn.test/api/public/servers/test-server/community-members"), env, { slug: "test-server" }));
assert.equal(publicPayload.members.length, 1, "Two-party consent must publish the member.");
assert.equal(publicPayload.members[0].display_name, "DZN Player", "A hidden display name must remain redacted after approval.");

const revokeResponse = await invoke(playerDirectory, new Request("https://dzn.test/api/player/community-directory", {
  method: "PATCH",
  headers: { ...cookie(playerSession.token), "content-type": "application/json", origin: "https://dzn.test" },
  body: JSON.stringify({ id: memberId, approve: false }),
}), env);
assert.equal(revokeResponse.status, 200, "The player must be able to revoke a listing.");

publicPayload = await jsonPayload(await invoke(publicDirectory, new Request("https://dzn.test/api/public/servers/test-server/community-members"), env, { slug: "test-server" }));
assert.deepEqual(publicPayload.members, [], "Revocation must remove the member from the public response immediately.");

const invitationsAfter = await jsonPayload(await invoke(playerDirectory, new Request("https://dzn.test/api/player/community-directory", {
  headers: cookie(playerSession.token),
}), env));
assert.equal(invitationsAfter.invitations.length, 1, "Revocation must not hide the record from the player's consent controls.");
assert.equal(invitationsAfter.invitations[0].member_approved_at, null, "The revoked invitation must remain visibly unapproved.");

db.sqlite.prepare("UPDATE linked_servers SET lifecycle_status = 'archived_hidden' WHERE id = 'server'").run();
const archivedResponse = await invoke(publicDirectory, new Request("https://dzn.test/api/public/servers/test-server/community-members"), env, { slug: "test-server" });
assert.equal(archivedResponse.status, 404, "An archived server directory must not remain accessible through its direct public URL.");

db.sqlite.exec("DROP TABLE server_community_member_source_audit; DROP TABLE server_community_member_candidates;");
const unavailableCandidates = await invoke(candidateDirectory, new Request("https://dzn.test/api/servers/server/community-member-candidates", {
  headers: cookie(ownerSession.token),
}), env, { serverId: "server" });
assert.equal(unavailableCandidates.status, 503, "An unavailable candidate schema must fail closed with the sanitized endpoint response.");

db.sqlite.close();
console.log("Server community directory runtime checks passed.");
}

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE}=${token}` };
}

function invoke(handler: PagesFunction, request: Request, requestEnv: Env, params: Record<string, string> = {}) {
  return handler({ request, env: requestEnv, params, waitUntil: () => undefined, next: async () => new Response(null, { status: 404 }), data: {} }) as Promise<Response>;
}

async function jsonPayload(response: Response) {
  assert.equal(response.status, 200);
  return response.json() as Promise<{
    members: Array<{ display_name: string }>;
    invitations: Array<{ id: string; member_approved_at: string | null }>;
  }>;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
