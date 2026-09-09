import assert from "node:assert/strict";
import { readPlayerRequestSupport } from "../functions/_lib/player-request-support";
import { onRequest } from "../functions/api/owner/player-requests";
import { hmacSha256 } from "../functions/_lib/crypto";
import { identityTransactionFixture } from "./test-player-game-identity-transactions";

export async function testPlayerRequestSupport() {
  const f = identityTransactionFixture();
  try {
    f.sqlite.exec(`ALTER TABLE users ADD COLUMN password TEXT;
      UPDATE users SET password='never-return-account-secret';
      ALTER TABLE linked_servers ADD COLUMN nitrado_token TEXT;
      UPDATE linked_servers SET nitrado_token='never-return-provider-token';
      UPDATE player_game_identity_claims SET review_note='token=private-note-secret https://example.com/private-key';
      INSERT INTO player_game_identity_audit_log
        (id,claim_id,user_id,actor_user_id,linked_server_id,action,result,note)
        VALUES ('audit-a','claim-a','player-a','owner-a','server-a','claim_requested','accepted','whsec_hidden-token');`);
    const before = f.state();
    const list = await readPlayerRequestSupport(f.env.DB, new URLSearchParams());
    assert.ok(list.ok && "items" in list);
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].discord_id, "discord-a");
    assert.equal(list.items[0].guild_id, "guild-a");
    assert.equal(list.items[0].owner_user_id, "owner-a");
    assert.doesNotMatch(JSON.stringify(list), /private-note-secret|private-key|never-return/);
    const detail = await readPlayerRequestSupport(f.env.DB, new URLSearchParams({ request: "claim-a" }));
    assert.ok(detail.ok && "history" in detail);
    assert.equal(detail.history[0].actor_name, "Owner A");
    assert.equal(detail.history[0].note, "[redacted]");
    assert.equal(detail.request.imported_profile_present, 1);
    const invalidQueries: Record<string, string>[] = [{ status: "invalid" }, { q: "a".repeat(101) }, { request: "../other" }, { cursor: "garbage" }];
    for (const query of invalidQueries) {
      const invalid = await readPlayerRequestSupport(f.env.DB, new URLSearchParams(query));
      assert.ok(!invalid.ok && invalid.status === 400);
    }
    for (const q of ["%", "' OR 1=1 --", "no-such-server"]) {
      const empty = await readPlayerRequestSupport(f.env.DB, new URLSearchParams({ q }));
      assert.ok(empty.ok && "items" in empty); assert.equal(empty.items.length, 0);
    }
    const missing = await readPlayerRequestSupport(f.env.DB, new URLSearchParams({ request: "absent" }));
    assert.ok(!missing.ok && missing.status === 404);
    assert.deepEqual(f.state(), before);
    assert.equal(f.writes(), 0, "Support reads must not mutate state");

    const invoke = (request: Request) => onRequest({ env: f.env, request, params: {}, data: {},
      waitUntil: () => {}, next: async () => new Response() });
    const anonymous = await invoke(new Request("https://dzn.test/api/owner/player-requests"));
    assert.equal(anonymous.status, 401); assert.match(anonymous.headers.get("cache-control") ?? "", /private.*no-store/);
    assert.equal((await invoke(new Request("https://dzn.test/api/owner/player-requests", { method: "POST" }))).status, 405);
    f.sqlite.exec("CREATE TABLE sessions (session_token_hash TEXT, user_id TEXT, expires_at TEXT)");
    f.env.SESSION_SECRET = "local-fixture-secret";
    const session = async (id: string, token: string) => {
      const hash = await hmacSha256(token, "local-fixture-secret");
      f.sqlite.prepare("INSERT INTO sessions VALUES (?, ?, '2099-01-01')").run(hash, id);
      return new Request("https://dzn.test/api/owner/player-requests?request=claim-a", { headers: { cookie: `dzn_session=${token}` } });
    };
    const ownerRequest = await session("owner-a", "local-owner-session");
    const normalOwner = await invoke(ownerRequest);
    assert.equal(normalOwner.status, 403);
    const dznAdmin = await invoke(await session("admin", "local-admin-session"));
    assert.equal(dznAdmin.status, 403, "DZN admin is not automatically a platform owner");
    f.env.DZN_PLATFORM_OWNER_DISCORD_IDS = "123456789001";
    f.sqlite.exec("UPDATE users SET discord_id='123456789001' WHERE id='owner-a'");
    const allowed = await invoke(ownerRequest);
    assert.equal(allowed.status, 200); assert.match(allowed.headers.get("cache-control") ?? "", /private.*no-store/);
    assert.doesNotMatch(await allowed.text(), /never-return|private-note-secret|hidden-token/);

    for (let i = 0; i < 60; i++) {
      f.sqlite.prepare(`INSERT INTO player_game_identity_claims
        (id,user_id,discord_id,linked_server_id,player_profile_id,player_id,status)
        VALUES (?,'player-a','discord-a','server-a','profile-a','game-a','rejected')`).run(`claim-${i.toString().padStart(3, "0")}`);
      f.sqlite.prepare(`INSERT INTO player_game_identity_audit_log
        (id,claim_id,user_id,linked_server_id,action,result) VALUES (?,'claim-a','player-a','server-a','claim_requested','accepted')`).run(`event-${i.toString().padStart(3, "0")}`);
    }
    const seen = new Set<string>(); let cursor: string | null = null;
    do {
      const page = await readPlayerRequestSupport(f.env.DB, new URLSearchParams(cursor ? { cursor } : {}));
      assert.ok(page.ok && "items" in page); assert.ok(page.items.length <= 25);
      for (const row of page.items) { assert.equal(seen.has(row.id), false); seen.add(row.id); }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(seen.size, 61);
    const events = new Set<string>(); cursor = null;
    do {
      const page = await readPlayerRequestSupport(f.env.DB, new URLSearchParams({ request: "claim-a", ...(cursor ? { cursor } : {}) }));
      assert.ok(page.ok && "history" in page); assert.ok(page.history.length <= 50);
      for (const row of page.history) { assert.equal(events.has(row.id), false); events.add(row.id); }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(events.size, 61);
    f.sqlite.exec("DROP TABLE player_game_identity_audit_log");
    const unavailable = await invoke(ownerRequest);
    assert.equal(unavailable.status, 503);
    assert.doesNotMatch(await unavailable.text(), /SQL|no such table|player_game_identity_audit_log/);
    console.log("Player support API: platform-owner authorization, private reads, redaction, search, pagination and failure states passed.");
  } finally { f.close(); }
}
