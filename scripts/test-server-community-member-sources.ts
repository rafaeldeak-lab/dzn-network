import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import {
  createCommunityMemberCandidate,
  decideCommunityMemberCandidate,
  listCommunityMemberSourceQueue,
} from "../functions/_lib/server-community-member-sources";
import { eraseOrRetainAccountUser } from "../functions/_lib/deletion";
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
  beforeNextBatch: (() => void) | null = null;
  afterNextBatchStatement: (() => void) | null = null;
  prepare(query: string) { return new SqliteD1PreparedStatement(this.sqlite, query); }
  async batch(statements: SqliteD1PreparedStatement[]) {
    this.beforeNextBatch?.();
    this.beforeNextBatch = null;
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
        if (this.afterNextBatchStatement) {
          const callback = this.afterNextBatchStatement;
          this.afterNextBatchStatement = null;
          callback();
        }
      }
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
  assert.match(helper, /imported\.imported_member_id !== memberId/, "Only the request that created the exact member may report import success.");
  assert.match(helper, /imported_member_id = \?/, "Import audit writes must be fenced to the request's exact member ID.");
  assert.match(helper, /decision_nonce = \?/, "Decision responses and audit writes must be fenced to the winning request.");
  assert.match(helper, /candidates\.status = 'pending'[\s\S]*recent\.status != 'pending'[\s\S]*LIMIT 100/, "Every pending candidate must remain reachable while decided history stays bounded.");
  assert.match(helper, /WHERE users\.id = \? AND users\.discord_id = \?/, "Candidate insertion must recheck the exact account identity at write time.");
  assert.match(migration, /UNIQUE INDEX[\s\S]*linked_server_id, matched_user_id[\s\S]*status = 'pending'/, "The database must enforce one pending candidate per server and matched player.");
  assert.match(helper, /INNER JOIN users[\s\S]*users\.discord_id = candidates\.candidate_discord_id[\s\S]*profiles\.status = 'active'[\s\S]*privacy\.public_profile_enabled = 1/, "The import write must recheck identity and profile consent atomically.");
  assert.match(helper, /Candidate remains pending because the player's public-profile eligibility changed/, "Revoked eligibility must remain retryable instead of being mislabeled as a duplicate.");
  assert.match(helper, /status = 'duplicate'[\s\S]*EXISTS \([\s\S]*server_community_members/, "Duplicate decisions must require a current server member.");
  assert.match(helper, /latest_status[\s\S]*source request was already processed/, "A lost pending-candidate race must report the current decision instead of a false no-match.");
  assert.match(helper, /SELECT \?, \?, \?, matched_user_id/, "Decision audits must use the candidate's current write-time identity.");
  assert.match(helper, /CASE WHEN EXISTS \([\s\S]*server_community_members[\s\S]*THEN 'duplicate' ELSE 'pending'/, "Candidate status must use write-time directory membership.");
  assert.match(helper, /'no_match'[\s\S]*WHERE NOT EXISTS \(SELECT 1 FROM users WHERE discord_id = \?\)/, "No-match creation must be fenced against a concurrent account link.");
  assert.match(helper, /created_by_user_id[\s\S]*SELECT id FROM users WHERE id = \? AND discord_id = \?/, "Candidate actor links must be fenced to the current authenticated identity.");
  assert.match(helper, /existingMember[\s\S]*candidate_duplicate[\s\S]*PUBLIC_PROFILE_REQUIRED/, "Existing members must be reconciled before public-profile eligibility is checked.");
  assert.match(component, /player still decides/i, "The UI must explain the separate player consent boundary.");
  assert.match(deletion, /candidate_discord_id = NULL/, "Account deletion must erase retained source identifiers.");
  assert.match(deletion, /created_by_user_id = CASE[\s\S]*reviewed_by_user_id = CASE/, "Retained Store accounts must be unlinked from candidate creator and reviewer fields.");
  assert.match(deletion, /UPDATE server_community_member_source_audit[\s\S]*member_user_id[\s\S]*actor_user_id/, "Retained Store accounts must be unlinked from both source-audit identity columns.");
  assert.match(deletion, /UPDATE server_community_member_audit[\s\S]*member_user_id[\s\S]*actor_user_id/, "Retained Store accounts must be unlinked from both member-audit identity columns.");

  const db = new SqliteD1Database();
  db.sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT, avatar TEXT);
    CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE player_public_profiles (user_id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, status TEXT NOT NULL);
    CREATE TABLE player_profile_privacy_preferences (user_id TEXT PRIMARY KEY, public_profile_enabled INTEGER NOT NULL, show_display_name INTEGER NOT NULL);
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
  seed("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run("player-four", "10000000000000005", "Player Four");
  seed("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run("player-five", "10000000000000006", "Player Five");
  seed("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run("player-six", "10000000000000007", "Player Six");
  seed("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run("player-seven", "10000000000000008", "Player Seven");
  seed("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run("player-eight", "10000000000000009", "Player Eight");
  seed("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run("player-ten", "10000000000000011", "Player Ten");
  seed("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run("player-eleven", "10000000000000012", "Player Eleven");
  seed("INSERT INTO linked_servers (id, user_id) VALUES (?, ?)").run("server", "owner");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player", "player-one");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player-two", "player-two");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player-three", "player-three");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player-four", "player-four");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player-five", "player-five");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player-six", "player-six");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player-seven", "player-seven");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player-eight", "player-eight");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player-ten", "player-ten");
  seed("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").run("player-eleven", "player-eleven");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled, show_display_name) VALUES (?, 1, 1)").run("player");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled, show_display_name) VALUES (?, 1, 1)").run("player-two");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled, show_display_name) VALUES (?, 1, 1)").run("player-three");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled, show_display_name) VALUES (?, 1, 1)").run("player-four");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled, show_display_name) VALUES (?, 1, 1)").run("player-five");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled, show_display_name) VALUES (?, 1, 1)").run("player-six");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled, show_display_name) VALUES (?, 1, 1)").run("player-seven");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled, show_display_name) VALUES (?, 1, 1)").run("player-eight");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled, show_display_name) VALUES (?, 1, 1)").run("player-ten");
  seed("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled, show_display_name) VALUES (?, 1, 1)").run("player-eleven");

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
  const repeated = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000002", username: "Player", roleLabel: "Builder" });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.candidate_status, "pending");
  assert.equal(seed("SELECT COUNT(*) AS count FROM server_community_member_candidates WHERE status = 'pending'").get()?.count, 1, "Repeated checks must reuse one pending candidate.");
  const numericId = await createCommunityMemberCandidate(env, owner, "server", { discordId: 10000000000000002, username: "Rounded", roleLabel: null });
  assert.equal(numericId.status, 400, "Numeric Discord snowflakes must be rejected before JavaScript precision can alter them.");

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
  queue = await listCommunityMemberSourceQueue(env, "server");
  let thirdCandidate = queue.candidates.find((candidate) => candidate.candidate_username === "Player Three");
  assert.ok(thirdCandidate);
  db.beforeNextBatch = () => {
    seed("UPDATE player_profile_privacy_preferences SET public_profile_enabled = 0 WHERE user_id = 'player-three'").run();
  };
  const revokedDuringImport = await decideCommunityMemberCandidate(env, owner, "server", thirdCandidate.id, "import", null);
  assert.equal(revokedDuringImport.status, 200);
  assert.match(revokedDuringImport.message, /remains pending.*eligibility changed/i);
  assert.equal(seed("SELECT status FROM server_community_member_candidates WHERE id = ?").get(thirdCandidate.id)?.status, "pending", "Revoked consent must leave the candidate retryable.");
  assert.equal(seed("SELECT COUNT(*) AS count FROM server_community_members WHERE user_id = 'player-three'").get()?.count, 0);
  queue = await listCommunityMemberSourceQueue(env, "server");
  thirdCandidate = queue.candidates.find((candidate) => candidate.candidate_username === "Player Three");
  assert.ok(thirdCandidate);
  assert.equal(thirdCandidate.can_import, false, "Disabled public profiles must not be advertised as importable.");
  assert.equal(thirdCandidate.public_handle, null, "Disabled public profile handles must remain private.");
  assert.equal(thirdCandidate.matched_username, null, "Disabled profile usernames must remain private.");
  seed("UPDATE player_profile_privacy_preferences SET public_profile_enabled = 1, show_display_name = 0 WHERE user_id = 'player-three'").run();
  queue = await listCommunityMemberSourceQueue(env, "server");
  thirdCandidate = queue.candidates.find((candidate) => candidate.public_handle === "player-three");
  assert.ok(thirdCandidate);
  assert.equal(thirdCandidate.matched_username, "DZN Player", "Hidden display names must use the public redaction label.");
  const retriedImport = await decideCommunityMemberCandidate(env, owner, "server", thirdCandidate.id, "import", null);
  assert.equal(retriedImport.status, 200);
  assert.match(retriedImport.message, /imported privately/i);
  assert.equal(seed("SELECT status FROM server_community_member_candidates WHERE id = ?").get(thirdCandidate.id)?.status, "imported");

  const fourth = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000005", username: "Player Four", roleLabel: "Member" });
  assert.equal(fourth.candidate_status, "pending");
  queue = await listCommunityMemberSourceQueue(env, "server");
  const fourthCandidate = queue.candidates.find((candidate) => candidate.public_handle === "player-four");
  assert.ok(fourthCandidate);
  db.beforeNextBatch = () => {
    seed("UPDATE users SET discord_id = '10000000000000995' WHERE id = 'player-four'").run();
  };
  const identityChanged = await decideCommunityMemberCandidate(env, owner, "server", fourthCandidate.id, "import", null);
  assert.equal(identityChanged.status, 200);
  assert.match(identityChanged.message, /identity changed.*No source identifier was retained/i);
  const scrubbed = seed("SELECT status, candidate_discord_id, candidate_username, matched_user_id FROM server_community_member_candidates WHERE id = ?").get(fourthCandidate.id);
  assert.equal(scrubbed?.status, "no_match");
  assert.equal(scrubbed?.candidate_discord_id, null);
  assert.equal(scrubbed?.candidate_username, null);
  assert.equal(scrubbed?.matched_user_id, null);
  assert.equal(seed("SELECT result_status FROM server_community_member_source_audit WHERE candidate_id = ? AND action = 'candidate_no_match'").get(fourthCandidate.id)?.result_status, "skipped");
  assert.equal(seed("SELECT COUNT(*) AS count FROM server_community_member_source_audit").get()?.count, 10);

  db.beforeNextBatch = () => {
    seed(`INSERT INTO server_community_member_candidates
          (id, linked_server_id, candidate_discord_id, candidate_username, role_label, status, matched_user_id, reason, created_by_user_id, created_at, updated_at)
          VALUES ('racing-candidate', 'server', '10000000000000006', 'Player Five', 'Member', 'pending', 'player-five', 'Concurrent request', 'owner', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z')`).run();
  };
  db.afterNextBatchStatement = () => {
    seed("UPDATE server_community_member_candidates SET status = 'rejected', reviewed_at = '2026-10-05T00:00:01.000Z' WHERE id = 'racing-candidate'").run();
  };
  const lostCreateRace = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000006", username: "Player Five", roleLabel: "Member" });
  assert.equal(lostCreateRace.status, 200);
  assert.equal(lostCreateRace.candidate_status, "rejected");
  assert.match(lostCreateRace.message, /already processed as rejected/i);
  assert.equal(seed("SELECT COUNT(*) AS count FROM server_community_member_candidates WHERE matched_user_id = 'player-five' AND status = 'no_match'").get()?.count, 0, "A decided uniqueness-race winner must not create a false no-match.");

  const sixth = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000007", username: "Player Six", roleLabel: "Member" });
  assert.equal(sixth.candidate_status, "pending");
  queue = await listCommunityMemberSourceQueue(env, "server");
  const sixthCandidate = queue.candidates.find((candidate) => candidate.public_handle === "player-six");
  assert.ok(sixthCandidate);
  db.beforeNextBatch = () => {
    seed("UPDATE users SET discord_id = 'deleted-player-six' WHERE id = 'player-six'").run();
    seed("UPDATE server_community_member_candidates SET matched_user_id = NULL, created_by_user_id = NULL, reviewed_by_user_id = NULL WHERE id = ?").run(sixthCandidate.id);
  };
  const rejectedAfterErasure = await decideCommunityMemberCandidate(env, owner, "server", sixthCandidate.id, "reject", "Identity was erased during review.");
  assert.equal(rejectedAfterErasure.status, 200);
  assert.equal(seed("SELECT member_user_id FROM server_community_member_source_audit WHERE candidate_id = ? AND action = 'candidate_rejected'").get(sixthCandidate.id)?.member_user_id, null, "A rejection audit must not restore a user link cleared during erasure.");
  assert.equal(seed("SELECT COUNT(*) AS count FROM server_community_member_source_audit").get()?.count, 12);

  db.beforeNextBatch = () => {
    seed(`INSERT INTO server_community_members
          (id, linked_server_id, user_id, role_label, public_member_enabled, member_approved_at, source, created_by_user_id, created_at, updated_at)
          VALUES ('concurrent-member', 'server', 'player-seven', 'Existing', 0, NULL, 'owner_public_handle', 'owner', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z')`).run();
  };
  const membershipAdded = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000008", username: "Player Seven", roleLabel: "Member" });
  assert.equal(membershipAdded.candidate_status, "duplicate", "A membership added after the read must produce a duplicate candidate.");
  assert.equal(seed("SELECT action FROM server_community_member_source_audit WHERE candidate_id = (SELECT id FROM server_community_member_candidates WHERE matched_user_id = 'player-seven')").get()?.action, "candidate_duplicate");

  seed(`INSERT INTO server_community_members
        (id, linked_server_id, user_id, role_label, public_member_enabled, member_approved_at, source, created_by_user_id, created_at, updated_at)
        VALUES ('removed-member', 'server', 'player-eight', 'Existing', 0, NULL, 'owner_public_handle', 'owner', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z')`).run();
  db.beforeNextBatch = () => {
    seed("DELETE FROM server_community_members WHERE id = 'removed-member'").run();
  };
  const membershipRemoved = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000009", username: "Player Eight", roleLabel: "Member" });
  assert.equal(membershipRemoved.candidate_status, "pending", "A membership removed after the read must produce a pending candidate.");
  assert.equal(seed("SELECT action FROM server_community_member_source_audit WHERE candidate_id = (SELECT id FROM server_community_member_candidates WHERE matched_user_id = 'player-eight')").get()?.action, "candidate_created");

  db.beforeNextBatch = () => {
    seed("INSERT INTO users (id, discord_id, username) VALUES ('player-nine', '10000000000000010', 'Player Nine')").run();
  };
  const accountLinked = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000010", username: "Player Nine", roleLabel: "Member" });
  assert.equal(accountLinked.status, 409, "A concurrently linked account must make the caller refresh instead of recording a false no-match.");
  assert.equal(seed("SELECT COUNT(*) AS count FROM server_community_member_candidates WHERE candidate_username = 'Player Nine'").get()?.count, 0);

  const eleventh = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000012", username: "Player Eleven", roleLabel: "Member" });
  assert.equal(eleventh.candidate_status, "pending");
  seed(`INSERT INTO server_community_members
        (id, linked_server_id, user_id, role_label, public_member_enabled, member_approved_at, source, created_by_user_id, created_at, updated_at)
        VALUES ('existing-eleven', 'server', 'player-eleven', 'Existing', 0, NULL, 'owner_public_handle', 'owner', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z')`).run();
  seed("UPDATE player_profile_privacy_preferences SET public_profile_enabled = 0 WHERE user_id = 'player-eleven'").run();
  queue = await listCommunityMemberSourceQueue(env, "server");
  const eleventhCandidate = queue.candidates.find((candidate) => candidate.candidate_username === "Player Eleven");
  assert.ok(eleventhCandidate);
  assert.equal(eleventhCandidate.has_existing_member, true);
  assert.equal(eleventhCandidate.can_import, true, "An existing member must remain reconcilable after public-profile consent is disabled.");
  const reconciledExisting = await decideCommunityMemberCandidate(env, owner, "server", eleventhCandidate.id, "import", null);
  assert.equal(reconciledExisting.status, 200);
  assert.match(reconciledExisting.message, /already in this server directory/i);
  assert.equal(seed("SELECT status FROM server_community_member_candidates WHERE id = ?").get(eleventhCandidate.id)?.status, "duplicate");

  db.beforeNextBatch = () => {
    seed("UPDATE users SET discord_id = 'deleted-owner' WHERE id = 'owner'").run();
    seed("UPDATE server_community_member_candidates SET created_by_user_id = NULL, reviewed_by_user_id = NULL WHERE created_by_user_id = 'owner' OR reviewed_by_user_id = 'owner'").run();
    seed("UPDATE server_community_member_source_audit SET actor_user_id = NULL WHERE actor_user_id = 'owner'").run();
    seed("UPDATE server_community_member_audit SET actor_user_id = NULL WHERE actor_user_id = 'owner'").run();
  };
  const erasedActorCreate = await createCommunityMemberCandidate(env, owner, "server", { discordId: "10000000000000011", username: "Player Ten", roleLabel: "Member" });
  assert.equal(erasedActorCreate.candidate_status, "pending");
  const erasedActorCandidate = seed("SELECT id, created_by_user_id FROM server_community_member_candidates WHERE matched_user_id = 'player-ten'").get();
  assert.equal(erasedActorCandidate?.created_by_user_id, null, "A stale session must not restore an anonymized candidate creator link.");
  assert.equal(seed("SELECT actor_user_id FROM server_community_member_source_audit WHERE candidate_id = ?").get(erasedActorCandidate?.id)?.actor_user_id, null, "A stale session must not restore an anonymized source-audit actor link.");

  seed("CREATE TABLE store_orders (id TEXT PRIMARY KEY, purchasing_user_id TEXT)").run();
  seed("INSERT INTO store_orders (id, purchasing_user_id) VALUES ('retained-order', 'player-four')").run();
  seed("UPDATE server_community_member_candidates SET created_by_user_id = 'player-four', reviewed_by_user_id = 'player-four' WHERE id = ?").run(fourthCandidate.id);
  seed(`INSERT INTO server_community_member_source_audit
        (id, linked_server_id, candidate_id, member_user_id, actor_user_id, action, result_status, reason, created_at)
        VALUES ('retained-audit', 'server', NULL, 'player-four', 'player-four', 'candidate_created', 'accepted', NULL, '2026-10-05T00:00:00.000Z')`).run();
  seed(`INSERT INTO server_community_member_audit
        (id, linked_server_id, member_user_id, actor_user_id, action, role_label, public_member_enabled, created_at)
        VALUES ('retained-member-audit', 'server', 'player-four', 'player-four', 'add', 'Member', 0, '2026-10-05T00:00:00.000Z')`).run();
  assert.equal(await eraseOrRetainAccountUser(db as unknown as D1Database, "player-four"), 1);
  const retainedAudit = seed("SELECT member_user_id, actor_user_id FROM server_community_member_source_audit WHERE id = 'retained-audit'").get();
  assert.equal(retainedAudit?.member_user_id, null, "A retained account must not remain linked as the candidate member.");
  assert.equal(retainedAudit?.actor_user_id, null, "A retained account must not remain linked as the audit actor.");
  const retainedMemberAudit = seed("SELECT member_user_id, actor_user_id FROM server_community_member_audit WHERE id = 'retained-member-audit'").get();
  assert.equal(retainedMemberAudit?.member_user_id, null, "A retained account must not remain linked in the member audit.");
  assert.equal(retainedMemberAudit?.actor_user_id, null, "A retained account must not remain linked as the member-audit actor.");
  const retainedCandidate = seed("SELECT created_by_user_id, reviewed_by_user_id FROM server_community_member_candidates WHERE id = ?").get(fourthCandidate.id);
  assert.equal(retainedCandidate?.created_by_user_id, null, "A retained account must not remain linked as the candidate creator.");
  assert.equal(retainedCandidate?.reviewed_by_user_id, null, "A retained account must not remain linked as the candidate reviewer.");
  assert.match(String(seed("SELECT discord_id FROM users WHERE id = 'player-four'").get()?.discord_id), /^deleted-/, "The Store ledger account should be retained only in anonymized form.");

  db.sqlite.close();
  console.log("Server community member source checks passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
