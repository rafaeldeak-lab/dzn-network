import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { hmacSha256 } from "../functions/_lib/crypto";
import { onRequest } from "../functions/api/player/hub";
import type { Env, PagesContext } from "../functions/_lib/types";

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { all(...values: unknown[]): Record<string, unknown>[]; get(...values: unknown[]): Record<string, unknown> | undefined };
  close(): void;
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

export async function testPlayerHubProfileState() {
  const sqlite = new DatabaseSync(":memory:");
  let stats: "empty" | "zero" | "populated" | "unavailable" = "empty";
  let reads = 0;
  let attemptedWrites = 0;
  try {
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT, username TEXT, avatar TEXT);
      CREATE TABLE sessions (user_id TEXT, session_token_hash TEXT, expires_at TEXT);
      INSERT INTO users VALUES ('player-a', 'discord-a', 'Same Name', NULL), ('player-b', 'discord-b', 'Same Name', NULL);
    `);
    sqlite.exec(readFileSync("migrations/0062_player_profile_privacy_preferences.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0063_player_public_profiles.sql", "utf8"));
    const sessionHash = await hmacSha256("profile-state-fixture", "fixture-secret");
    sqlite.exec(`INSERT INTO sessions VALUES ('player-a', '${sessionHash}', '2999-01-01');
      INSERT INTO player_profile_privacy_preferences (id, user_id, public_profile_enabled) VALUES ('prefs-b', 'player-b', 1);
      INSERT INTO player_public_profiles (id, user_id, handle) VALUES ('public-b', 'player-b', 'other-player');`);

    // Exercise real session and publishing SQL; gameplay fixtures keep this test independent of ingestion.
    const env = { SESSION_SECRET: "fixture-secret", MOCK_AUTH: "false", DB: {
      prepare(sql: string) {
        reads++;
        if (!/^\s*(SELECT|WITH)\b/i.test(sql)) { attemptedWrites++; throw new Error("Hub must be read-only"); }
        const statement = (values: unknown[]) => ({
          bind: (...bindings: unknown[]) => statement(bindings),
          first: async () => {
            if (sql.includes("FROM trusted_public_player_profile_resolved_stats")) {
              assert.equal(values[0], "discord-a", "Gameplay lookup must use the session, never a query-string account");
              if (stats === "unavailable") throw new Error("fixture gameplay read failure");
              if (!sql.includes("AS linked_game_profiles")) return null;
              return { linked_game_profiles: stats === "empty" ? 0 : 1, linked_public_servers: stats === "empty" ? 0 : 1,
                total_kills: stats === "populated" ? 25 : 0, total_deaths: 0, total_suicides: 0,
                longest_kill_distance: stats === "populated" ? 106.7 : 0, last_seen_at: null };
            }
            return sqlite.prepare(sql).get(...values) ?? null;
          },
          all: async () => ({ results: sqlite.prepare(sql).all(...values), success: true }),
        });
        return statement([]);
      },
    } } as unknown as Env;
    const request = (method = "GET", cookie = "dzn_session=profile-state-fixture") => onRequest({
      request: new Request("https://dzn.test/api/player/hub?user_id=player-b&discord_id=discord-b", { method, headers: { cookie } }),
      env, params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 404 }),
    } as PagesContext) as Promise<Response>;
    const read = async () => {
      const response = await request();
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
      const body = await response.json() as {
        profile_summary: { public_profile_status: string; public_profile_href: string | null; linked_game_profiles: number | null };
        progression_summary: { status: string; gameplay_totals: Record<string, number | null> };
        profile_entries: { key: string; status: string; href: string }[];
      };
      assert.doesNotMatch(JSON.stringify(body), /other-player|discord-a|discord-b|player-b|session_token_hash/);
      return body;
    };
    const beforeAnonymous = reads;
    assert.equal((await request("GET", "")).status, 401);
    assert.equal((await request("POST")).status, 405);
    assert.equal(reads, beforeAnonymous, "Anonymous and unsupported requests must not query private state");

    let body = await read();
    assert.equal(body.profile_summary.public_profile_status, "private");
    assert.equal(body.profile_summary.public_profile_href, null);
    assert.equal(body.progression_summary.status, "empty");
    assert.ok(Object.values(body.progression_summary.gameplay_totals).every(value => value === null));

    sqlite.exec("INSERT INTO player_profile_privacy_preferences (id, user_id, public_profile_enabled) VALUES ('prefs-a', 'player-a', 1)");
    body = await read();
    assert.equal(body.profile_summary.public_profile_status, "not_published", "Opt-in alone cannot invent a handle");
    assert.equal(body.profile_summary.public_profile_href, null);
    sqlite.exec("INSERT INTO player_public_profiles (id, user_id, handle) VALUES ('public-a', 'player-a', 'my-player')");
    body = await read();
    assert.equal(body.profile_summary.public_profile_status, "published");
    assert.equal(body.profile_summary.public_profile_href, "/players/my-player");
    assert.equal(body.profile_entries.find(entry => entry.key === "public_profile")?.href, "/players/my-player");

    sqlite.exec("UPDATE player_profile_privacy_preferences SET public_profile_enabled = 0 WHERE user_id = 'player-a'");
    body = await read();
    assert.equal(body.profile_summary.public_profile_status, "private");
    assert.equal(body.profile_summary.public_profile_href, null, "Turning off publication must hide the saved URL immediately");
    sqlite.exec("UPDATE player_profile_privacy_preferences SET public_profile_enabled = 1 WHERE user_id = 'player-a'; UPDATE player_public_profiles SET status = 'disabled' WHERE user_id = 'player-a'");
    body = await read();
    assert.equal(body.profile_summary.public_profile_status, "not_published");
    assert.equal(body.profile_summary.public_profile_href, null);
    sqlite.exec("UPDATE player_public_profiles SET status = 'active' WHERE user_id = 'player-a'");

    stats = "zero";
    body = await read();
    assert.equal(body.progression_summary.status, "stats_available");
    assert.ok(Object.values(body.progression_summary.gameplay_totals).every(value => value === 0), "A verified zero must stay zero");
    stats = "populated";
    body = await read();
    assert.equal(body.progression_summary.gameplay_totals.kills, 25);
    stats = "unavailable";
    body = await read();
    assert.equal(body.profile_summary.public_profile_status, "published", "Gameplay failure must not erase known publishing state");
    assert.equal(body.profile_summary.linked_game_profiles, null);
    assert.equal(body.progression_summary.status, "unavailable");
    assert.ok(Object.values(body.progression_summary.gameplay_totals).every(value => value === null));

    stats = "populated";
    sqlite.exec("ALTER TABLE player_public_profiles RENAME TO missing_public_profiles");
    body = await read();
    assert.equal(body.profile_summary.public_profile_status, "unavailable");
    assert.equal(body.profile_summary.public_profile_href, null);
    assert.equal(body.progression_summary.gameplay_totals.kills, 25, "Publishing failure must not erase available gameplay data");
    sqlite.exec("ALTER TABLE missing_public_profiles RENAME TO player_public_profiles; ALTER TABLE player_profile_privacy_preferences RENAME TO missing_preferences");
    body = await read();
    assert.equal(body.profile_summary.public_profile_status, "unavailable");
    assert.equal(body.profile_summary.public_profile_href, null);
    assert.equal(attemptedWrites, 0, "No route or helper may attempt a write");
    console.log("Player Hub saved profile state, isolation, null/zero and read-only regression tests passed.");
  } finally { sqlite.close(); }
}
