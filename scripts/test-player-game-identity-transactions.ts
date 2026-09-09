import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createPlayerGameIdentityClaim, reviewPlayerGameIdentityClaim } from "../functions/_lib/player-game-identities";
import type { Env, SessionUser } from "../functions/_lib/types";

type Row = Record<string, unknown>;
type Sqlite = { exec(sql: string): void; close(): void; prepare(sql: string): {
  all(...values: unknown[]): Row[]; get(...values: unknown[]): Row | undefined;
  run(...values: unknown[]): { changes: number | bigint };
} };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };
export const identityTestUser = (id: string, discordId = id): SessionUser => ({ id, discord_id: discordId, username: id, avatar: null });

export function identityTransactionFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT, username TEXT, avatar TEXT);
    CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT, guild_id TEXT, status TEXT,
      listing_visibility TEXT, merged_into_server_id TEXT, display_name TEXT, hostname TEXT,
      server_name TEXT, nitrado_service_name TEXT, public_slug TEXT);
    CREATE TABLE player_profiles (id TEXT PRIMARY KEY, linked_server_id TEXT, player_id TEXT,
      player_name TEXT, discord_id TEXT, last_seen_at TEXT, updated_at TEXT, created_at TEXT);
    INSERT INTO users VALUES ('owner-a','owner-discord','Owner A',NULL), ('owner-b','other-owner','Owner B',NULL),
      ('player-a','discord-a','Player A',NULL), ('player-b','discord-b','Player B',NULL), ('admin','admin-discord','Admin',NULL);
    INSERT INTO linked_servers (id,user_id,guild_id,status,listing_visibility,server_name,public_slug)
      VALUES ('server-a','owner-a','guild-a','active','public','Server A','server-a');
    INSERT INTO player_profiles (id,linked_server_id,player_id,player_name) VALUES ('profile-a','server-a','game-a','Survivor');
  `);
  sqlite.exec(readFileSync("migrations/0064_player_game_identity_links.sql", "utf8"));
  sqlite.exec("CREATE TABLE competitive_events (id TEXT PRIMARY KEY)");
  sqlite.exec(readFileSync("migrations/0052_dzn_pulse.sql", "utf8"));
  sqlite.exec(`INSERT INTO player_game_identity_claims
    (id,user_id,discord_id,linked_server_id,player_profile_id,player_id,player_name)
    VALUES ('claim-a','player-a','discord-a','server-a','profile-a','game-a','Survivor')`);
  let beforeBatch: (() => void) | undefined;
  let failAt = -1;
  let writes = 0;
  const prepare = (sql: string, bindings: unknown[] = []) => {
    const execute = () => {
      if (/^\s*SELECT/i.test(sql)) return { results: sqlite.prepare(sql).all(...bindings), success: true, meta: { changes: 0 } };
      writes++;
      const result = sqlite.prepare(sql).run(...bindings);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    };
    return { bind: (...values: unknown[]) => prepare(sql, values), first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
      all: async () => execute(), run: async () => execute(), execute };
  };
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      const hook = beforeBatch; beforeBatch = undefined; hook?.();
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement, index) => {
          if (index === failAt) throw new Error("Injected interruption");
          return statement.execute();
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, env: { DB: db, DZN_ADMIN_DISCORD_IDS: "admin-discord", DZN_PLATFORM_OWNER_DISCORD_IDS: "platform-discord" } as unknown as Env,
    setBeforeBatch: (hook: () => void) => { beforeBatch = hook; }, failAt: (index: number) => { failAt = index; },
    writes: () => writes, close: () => sqlite.close(),
    state: () => ({ claim: sqlite.prepare("SELECT * FROM player_game_identity_claims").all(),
      links: sqlite.prepare("SELECT * FROM player_game_identity_links").all(),
      profiles: sqlite.prepare("SELECT * FROM player_profiles").all(),
      audit: sqlite.prepare("SELECT * FROM player_game_identity_audit_log").all(),
      notifications: sqlite.prepare("SELECT * FROM user_notifications").all() }),
  };
}

export async function testPlayerGameIdentityTransactions() {
  const owner = identityTestUser("owner-a");
  for (const action of ["approve", "reject"] as const) {
    const f = identityTransactionFixture();
    try {
      const result = await reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action, note: "Owner evidence checked" });
      assert.equal(result.ok, true);
      const state = f.state();
      assert.equal(state.claim[0].status, action === "approve" ? "approved" : "rejected");
      assert.equal(state.audit.length, action === "approve" ? 2 : 1);
      assert.equal(state.links.length, action === "approve" ? 1 : 0);
      assert.equal(state.profiles[0].discord_id, null, "New links must not overwrite legacy attribution");
      if (result.ok && action === "approve") assert.equal(result.link_id, state.links[0].id);
      const before = f.state();
      const repeat = await reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action });
      assert.equal(repeat.status, 409);
      assert.deepEqual(f.state(), before);
    } finally { f.close(); }
  }
  for (const action of ["approve", "reject"] as const) {
    for (let failure = 0; failure < (action === "approve" ? 5 : 2); failure++) {
      const f = identityTransactionFixture();
      try {
        const before = f.state(); f.failAt(failure);
        assert.equal((await reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action })).status, 503);
        assert.deepEqual(f.state(), before, `${action} interruption at ${failure} must roll back every write`);
      } finally { f.close(); }
    }
  }
  for (const concurrentChange of [
    "UPDATE player_game_identity_claims SET status = 'rejected' WHERE id = 'claim-a'",
    "UPDATE linked_servers SET user_id = 'owner-b' WHERE id = 'server-a'",
    "UPDATE linked_servers SET status = 'deleted' WHERE id = 'server-a'",
    "UPDATE player_profiles SET discord_id = 'discord-b' WHERE id = 'profile-a'",
    "UPDATE player_profiles SET player_id = 'changed-game' WHERE id = 'profile-a'",
  ]) {
    const f = identityTransactionFixture();
    try {
      f.setBeforeBatch(() => f.sqlite.exec(concurrentChange));
      assert.equal((await reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action: "approve" })).status, 409);
      assert.equal(f.state().links.length, 0); assert.equal(f.state().audit.length, 0);
    } finally { f.close(); }
  }
  for (const actions of [["approve", "reject"], ["reject", "approve"], ["approve", "approve"]]) {
    const f = identityTransactionFixture();
    try {
      const results = await Promise.all(actions.map(action => reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action })));
      assert.equal(results.filter(r => r.ok).length, 1, "Only one concurrent decision may commit");
      assert.equal(results.filter(r => r.status === 409).length, 1);
      const state = f.state();
      assert.equal(state.links.length, state.claim[0].status === "approved" ? 1 : 0);
      assert.equal(state.audit.filter(row => row.action === "claim_approved" || row.action === "claim_rejected").length, 1);
    } finally { f.close(); }
  }
  const denied = identityTransactionFixture();
  try {
    assert.equal((await reviewPlayerGameIdentityClaim(denied.env, identityTestUser("owner-b"), "claim-a", { action: "approve" })).status, 403);
    assert.equal(denied.writes(), 0);
  } finally { denied.close(); }
  for (const mockAuth of [undefined, "false", "true", "1"]) {
    for (const action of ["approve", "reject"]) {
      const f = identityTransactionFixture();
      try {
        f.env.MOCK_AUTH = mockAuth;
        const before = f.state();
        const result = await reviewPlayerGameIdentityClaim(f.env, identityTestUser("owner-b"), "claim-a", { action });
        assert.equal(result.status, mockAuth === "true" || mockAuth === "1" ? 200 : 403);
        if (!result.ok) assert.deepEqual(f.state(), before, "Disabled mock access must preserve real tenant isolation");
      } finally { f.close(); }
    }
  }
  const conflict = identityTransactionFixture();
  try {
    conflict.sqlite.exec("UPDATE player_profiles SET discord_id='discord-b'");
    assert.equal((await reviewPlayerGameIdentityClaim(conflict.env, owner, "claim-a", { action: "approve" })).status, 409);
    assert.equal(conflict.state().links.length, 0);
    assert.equal(conflict.state().profiles[0].discord_id, "discord-b");
  } finally { conflict.close(); }
  for (const existingOwner of ["player-a", "player-b"]) {
    const f = identityTransactionFixture();
    try {
      f.setBeforeBatch(() => f.sqlite.prepare(`INSERT INTO player_game_identity_links
        (id,user_id,discord_id,linked_server_id,player_profile_id,player_id,status,verified_source,verified_by_user_id)
        VALUES ('existing-link', ?, ?, 'server-a','profile-a','game-a','active','owner_approved','owner-a')`)
        .run(existingOwner, existingOwner === "player-a" ? "discord-a" : "discord-b"));
      const result = await reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action: "approve" });
      assert.equal(result.status, existingOwner === "player-a" ? 200 : 409);
      assert.equal(f.state().links.length, 1);
      if (result.ok) {
        assert.equal(result.link_id, "existing-link");
        assert.equal(f.state().audit.find(row => row.action === "link_created")?.result, "already_linked");
      } else assert.equal(f.state().audit.length, 0);
    } finally { f.close(); }
  }
  const rejectAccessChanged = identityTransactionFixture();
  try {
    rejectAccessChanged.setBeforeBatch(() => rejectAccessChanged.sqlite.exec("UPDATE linked_servers SET user_id='owner-b'"));
    assert.equal((await reviewPlayerGameIdentityClaim(rejectAccessChanged.env, owner, "claim-a", { action: "reject" })).status, 409);
    assert.equal(rejectAccessChanged.state().claim[0].status, "pending");
    assert.equal(rejectAccessChanged.state().audit.length, 0);
  } finally { rejectAccessChanged.close(); }
  for (const shouldFail of [false, true]) {
    const f = identityTransactionFixture();
    try {
      f.sqlite.exec("DELETE FROM player_game_identity_claims");
      const before = f.state(); if (shouldFail) f.failAt(1);
      const result = await createPlayerGameIdentityClaim(f.env, identityTestUser("player-a", "discord-a"), { server_slug: "server-a", player_id: "game-a" });
      assert.equal(result.status, shouldFail ? 503 : 201);
      if (shouldFail) assert.deepEqual(f.state(), before);
      else { assert.equal(f.state().claim.length, 1); assert.equal(f.state().audit.length, 1); }
    } finally { f.close(); }
  }
  console.log("Identity claim transactions: rollback, conflicts, fresh ownership and concurrent decisions passed.");
}
