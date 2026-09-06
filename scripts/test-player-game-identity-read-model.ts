import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  readOwnerPlayerGameIdentityClaims,
  readPlayerGameIdentityReadModel,
  reviewPlayerGameIdentityClaim,
} from "../functions/_lib/player-game-identities";
import type { Env, SessionUser } from "../functions/_lib/types";

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...values: unknown[]): Record<string, unknown>[];
    get(...values: unknown[]): Record<string, unknown> | undefined;
  };
  close(): void;
};
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

export async function testPlayerGameIdentityReadModels() {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
      CREATE TABLE linked_servers (
        id TEXT PRIMARY KEY, user_id TEXT, guild_id TEXT, status TEXT, merged_into_server_id TEXT,
        display_name TEXT, hostname TEXT, server_name TEXT, nitrado_service_name TEXT, public_slug TEXT
      );
      CREATE TABLE player_profiles (id TEXT PRIMARY KEY);
      INSERT INTO users VALUES ('player-a', 'Player A'), ('player-b', 'Player B'), ('owner-a', 'Owner A'), ('owner-b', 'Owner B');
      INSERT INTO linked_servers (id, user_id, status, server_name, public_slug) VALUES
        ('server-a', 'owner-a', 'active', 'Server A', 'server-a'), ('server-b', 'owner-b', 'active', 'Server B', 'server-b');
      INSERT INTO player_profiles VALUES ('profile-a'), ('profile-b');
    `);
    sqlite.exec(readFileSync("migrations/0064_player_game_identity_links.sql", "utf8"));
    sqlite.exec(`
      INSERT INTO player_game_identity_claims (id, user_id, discord_id, linked_server_id, player_profile_id, player_id) VALUES
        ('claim-a', 'player-a', 'discord-a', 'server-a', 'profile-a', '76561198000000001'),
        ('claim-b', 'player-b', 'discord-b', 'server-b', 'profile-b', '76561198000000002');
      INSERT INTO player_game_identity_links (id, user_id, discord_id, linked_server_id, player_profile_id, player_id, verified_source, verified_by_user_id) VALUES
        ('link-a', 'player-a', 'discord-a', 'server-a', 'profile-a', '76561198000000001', 'owner_approved', 'owner-a'),
        ('link-b', 'player-b', 'discord-b', 'server-b', 'profile-b', '76561198000000002', 'owner_approved', 'owner-b');
    `);
    let attemptedWrites = 0;
    const env = {
      DZN_ADMIN_DISCORD_IDS: "admin-discord",
      DB: {
        prepare(sql: string) {
          if (!/^\s*SELECT\b/i.test(sql)) {
            attemptedWrites++;
            throw new Error("Read-model tests forbid database writes");
          }
          const statement = (bindings: unknown[]) => ({
            bind: (...values: unknown[]) => statement(values),
            all: async () => ({ results: sqlite.prepare(sql).all(...bindings), success: true }),
            first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
          });
          return statement([]);
        },
      },
    } as unknown as Env;
    const user = (id: string, discordId = id): SessionUser => ({ id, discord_id: discordId, username: id, avatar: null });
    const before = JSON.stringify(sqlite.prepare("SELECT * FROM player_game_identity_claims ORDER BY id").all());
    const ownerA = await readOwnerPlayerGameIdentityClaims(env, user("owner-a"));
    assert.equal(ownerA.source, "player_game_identity_claims");
    assert.deepEqual(ownerA.claims.map(row => row.id), ["claim-a"]);
    assert.equal((ownerA.claims[0] as { submitted_player_id?: string }).submitted_player_id, "76561198000000001");
    assert.notEqual(ownerA.claims[0].player_id, "76561198000000001");
    const ownerB = await readOwnerPlayerGameIdentityClaims(env, user("owner-b"));
    assert.deepEqual(ownerB.claims.map(row => row.id), ["claim-b"]);
    const stranger = await readOwnerPlayerGameIdentityClaims(env, user("stranger"));
    assert.deepEqual(stranger.claims, []);
    const admin = await readOwnerPlayerGameIdentityClaims(env, user("admin", "admin-discord"));
    assert.deepEqual(admin.claims.map(row => row.id).sort(), ["claim-a", "claim-b"]);
    assert.equal((admin.claims[1] as { submitted_player_id?: string }).submitted_player_id, "76561198000000002");

    const player = await readPlayerGameIdentityReadModel(env, user("player-a", "discord-a"));
    assert.equal(player.source, "player_game_identity_links");
    assert.deepEqual(player.claims.map(row => row.id), ["claim-a"]);
    assert.deepEqual(player.active_links.map(row => row.id), ["link-a"]);
    assert.doesNotMatch(JSON.stringify(player), /7656119800000000[12]|submitted_player_id|review_context|claim-b|link-b/);
    const mismatchedDiscord = await readPlayerGameIdentityReadModel(env, user("player-a", "discord-b"));
    assert.deepEqual(mismatchedDiscord.claims, []);
    assert.deepEqual(mismatchedDiscord.active_links, []);
    const denial = await reviewPlayerGameIdentityClaim(env, user("owner-b"), "claim-a", { action: "approve" });
    assert.equal(denial.status, 403);
    assert.equal(attemptedWrites, 0, "Reads and cross-owner denial must perform no writes");
    assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM player_game_identity_claims ORDER BY id").all()), before);
    sqlite.exec("DROP TABLE player_game_identity_claims");
    const unavailable = await readOwnerPlayerGameIdentityClaims(env, user("owner-a"));
    assert.equal(unavailable.source, "unavailable");
    assert.deepEqual(unavailable.claims, []);
  } finally {
    sqlite.close();
  }
}
