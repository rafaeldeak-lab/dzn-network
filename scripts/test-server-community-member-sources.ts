import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import {
  createCommunityMemberCandidate,
  decideCommunityMemberCandidate,
  listCommunityMemberSourceQueue,
} from "../functions/_lib/server-community-member-sources";
import type { Env, SessionUser } from "../functions/_lib/types";

type SqliteStatement = {
  run(...values: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...values: unknown[]): Record<string, unknown> | undefined;
  all(...values: unknown[]): Array<Record<string, unknown>>;
};
type SqliteDatabase = { exec(sql: string): void; prepare(sql: string): SqliteStatement; close(): void };

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => SqliteDatabase };

class SqliteD1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  prepare(query: string) { return new SqliteD1PreparedStatement(this.sqlite, query); }
  async batch(statements: SqliteD1PreparedStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

class SqliteD1PreparedStatement {
  constructor(private readonly sqlite: SqliteDatabase, private readonly query: string, private readonly bindings: unknown[] = []) {}
  bind(...values: unknown[]) { return new SqliteD1PreparedStatement(this.sqlite, this.query, values); }
  async run() {
    const result = this.sqlite.prepare(this.query).run(...this.bindings);
    return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }
  async first<T = Record<string, unknown>>() { return (this.sqlite.prepare(this.query).get(...this.bindings) ?? null) as T | null; }
  async all<T = Record<string, unknown>>() { return { success: true, meta: {}, results: this.sqlite.prepare(this.query).all(...this.bindings) as T[] }; }
}

async function main() {
  const migration = readFileSync("migrations/0090_server_community_member_sources.sql", "utf8");
  const helper = readFileSync("functions/_lib/server-community-member-sources.ts", "utf8");
  const api = readFileSync("functions/api/servers/[serverId]/community-member-candidates.ts", "utf8");
  const component = readFileSync("components/community/community-source-queue.tsx", "utf8");
  const deletion = readFileSync("functions/_lib/deletion.ts", "utf8");

  assert.match(migration, /ON DELETE CASCADE/, "Server deletion must remove its private source queue.");
  assert.match(migration, /ON DELETE SET NULL/, "Account deletion must not break the retained decision audit.");
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i, "The migration must be additive.");
  assert.match(api, /requireServerOwnerOrDznAdmin/, "The queue must remain server-owner or platform-admin scoped.");
  assert.match(api, /sameOrigin\(request\)/, "Candidate writes must reject cross-origin requests.");
  assert.match(helper, /public_member_enabled, source[\s\S]*0, 'owner_public_handle'/, "Imports must create a private directory invitation.");
  assert.match(component, /player still decides/i, "The UI must explain the separate player consent boundary.");
  assert.match(deletion, /candidate_discord_id = NULL/, "Account deletion must erase retained source identifiers.");

  const db = new SqliteD1Database();
  db.sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT, avatar TEXT);
    CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE player_public_profiles (user_id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, status TEXT NOT NULL);
    CREATE TABLE player_profile_privacy_preferences (user_id TEXT PRIMARY KEY, public_profile_enabled INTEGER NOT NULL);
    CREATE TABLE server_community_members (
      id TEXT PRIMARY KEY, linked_server_id TEXT NOT NULL, user_id TEXT NOT NULL, role_label TEXT,
      display_order INTEGER NOT NULL DEFAULT 0, public_member_enabled INTEGER NOT NULL DEFAULT 0,
      member_approved_at TEXT, source TEXT NOT NULL DEFAULT 'owner_public_handle', created_by_user_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(linked_server_id, user_id),
      FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE server_community_member_audit (
      id TEXT PRIMARY KEY, linked_server_id TEXT NOT NULL, member_user_id TEXT, actor_user_id TEXT,
      action TEXT NOT NULL, role_label TEXT, public_member_enabled INTEGER, created_at TEXT NOT NULL
    );
    ${migration}
  `);
  const seed = db.sqlite.prepare.bind(db.sqlite);
  seed("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run("owner", "10000000000000001", "Owner");
  seed("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run("player", "10000000000000002", "Player");
  seed("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run("player-two", "10000000000000003", "Player Two");
  seed("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run("player-three", "10000000000000004", "Player Three");
  seed("INSERT INTO linked_servers (id, user_id) VALUES (?, ?)").run("server", "owner");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player", "player-one");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player-two", "player-two");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player-three", "player-three");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled) VALUES (?, 1)").run("player");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled) VALUES (?, 1)").run("player-two");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled) VALUES (?, 1)").run("player-three");

  const env = { DB: db as unknown as D1Database } as Env;
  const owner: SessionUser = { id: "owner", discord_id: "10000000000000001", username: "Owner", avatar: null };

  const created = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000002", username: "Player", roleLabel: "Builder" });
  assert.equal(created.status, 201);
  assert.equal(created.candidate_status, "pending");
  let queue = await listCommunityMemberSourceQueue(env, "server");
  assert.equal(queue.candidates.length, 1);
  assert.equal("candidate_discord_id" in queue.candidates[0], false, "Raw Discord IDs must not leave the private helper.");
  assert.equal("matched_user_id" in queue.candidates[0], false, "Internal user IDs must not leave the private helper.");
  assert.equal(queue.candidates[0].candidate_discord_id_masked, "1000...0002");
  assert.equal(queue.candidates[0].can_import, true);

  const imported = await decideCommunityMemberCandidate(env, owner, "server", queue.candidates[0].id, "import", null);
  assert.equal(imported.status, 200);
  const member = seed("SELECT public_member_enabled, member_approved_at, role_label FROM server_community_members WHERE linked_server_id = ? AND user_id = ?").get("server", "player");
  assert.equal(member?.public_member_enabled, 0, "Source import must remain private by default.");
  assert.equal(member?.member_approved_at, null, "Source import must not impersonate player approval.");
  assert.equal(member?.role_label, "Builder");

  const duplicate = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000002", username: "Player", roleLabel: "Builder" });
  assert.equal(duplicate.candidate_status, "duplicate");
  const missing = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000999", username: "Missing", roleLabel: null });
  assert.equal(missing.candidate_status, "no_match");
  assert.equal(seed("SELECT candidate_discord_id FROM server_community_member_candidates WHERE status = 'no_match'").get()?.candidate_discord_id, null, "Unmatched Discord IDs must not be retained.");

  const second = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000003", username: "Player Two", roleLabel: "Member" });
  assert.equal(second.candidate_status, "pending");
  queue = await listCommunityMemberSourceQueue(env, "server");
  const secondCandidate = queue.candidates.find((candidate) => candidate.public_handle === "player-two");
  assert.ok(secondCandidate);
  seed(`INSERT INTO server_community_members (id, linked_server_id, user_id, role_label, public_member_enabled, member_approved_at, source, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, 'owner_public_handle', ?, ?, ?)`).run("existing-member", "server", "player-two", "Existing role", "2026-10-05T00:00:00.000Z", "owner", "2026-10-05T00:00:00.000Z", "2026-10-05T00:00:00.000Z");
  const staleImport = await decideCommunityMemberCandidate(env, owner, "server", secondCandidate.id, "import", null);
  assert.equal(staleImport.status, 200);
  assert.match(staleImport.message, /existing member was not changed/i);
  const existingMember = seed("SELECT role_label, public_member_enabled, member_approved_at FROM server_community_members WHERE id = 'existing-member'").get();
  assert.equal(existingMember?.role_label, "Existing role", "A stale import must not overwrite an existing member role.");
  assert.equal(existingMember?.public_member_enabled, 1, "A stale import must not change existing publication.");
  assert.equal(existingMember?.member_approved_at, "2026-10-05T00:00:00.000Z", "A stale import must not change player approval.");
  assert.equal(seed("SELECT status FROM server_community_member_candidates WHERE id = ?").get(secondCandidate.id)?.status, "duplicate");

  const third = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000004", username: "Player Three", roleLabel: "Member" });
  assert.equal(third.candidate_status, "pending");
  seed("UPDATE player_profile_privacy_preferences SET public_profile_enabled = 0 WHERE user_id = 'player-three'").run();
  queue = await listCommunityMemberSourceQueue(env, "server");
  const thirdCandidate = queue.candidates.find((candidate) => candidate.public_handle === "player-three");
  assert.ok(thirdCandidate);
  assert.equal(thirdCandidate.can_import, false, "Disabled public profiles must not be advertised as importable.");
  seed("UPDATE player_profile_privacy_preferences SET public_profile_enabled = 1 WHERE user_id = 'player-three'").run();
  const rejected = await decideCommunityMemberCandidate(env, owner, "server", thirdCandidate.id, "reject", "Not yet verified by the owner.");
  assert.equal(rejected.status, 200);
  assert.equal(seed("SELECT status FROM server_community_member_candidates WHERE id = ?").get(thirdCandidate.id)?.status, "rejected");
  assert.equal(seed("SELECT COUNT(*) AS count FROM server_community_member_source_audit").get()?.count, 8);

  db.sqlite.close();
  console.log("Server community member source checks passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
