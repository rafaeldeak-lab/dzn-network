import assert from "node:assert/strict";
import { deleteOwnedAccountData, deleteOwnedLinkedServerData } from "../functions/_lib/deletion";
import { identityTransactionFixture, identityTestUser } from "./test-player-game-identity-transactions";
import { readPlayerGameIdentityReadModel, reviewPlayerGameIdentityClaim } from "../functions/_lib/player-game-identities";
import { readManagedGameIdentityLinks, revokePlayerGameIdentityLink } from "../functions/_lib/player-game-identity-revocation";
import { readTrustedPlayerGameplayAggregate } from "../functions/_lib/player-stat-bridge";
import { readPlayerRequestSupport } from "../functions/_lib/player-request-support";
import { onRequest as mutate } from "../functions/api/owner/player-game-identity-links/[linkId]";
import { onRequest as list } from "../functions/api/owner/player-game-identity-links";
import { hmacSha256 } from "../functions/_lib/crypto";

const owner = identityTestUser("owner-a", "owner-discord");
const player = identityTestUser("player-a", "discord-a");
const input = { confirm: true, reason: "The supplied proof did not establish this game account. Please contact support." };

async function approvedFixture() {
  const f = identityTransactionFixture();
  const result = await reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action: "approve" });
  assert.ok(result.ok && result.link_id);
  return { ...f, linkId: result.link_id };
}

export async function testPlayerGameIdentityRevocation() {
  const f = await approvedFixture();
  try {
    f.sqlite.exec(`ALTER TABLE player_profiles ADD COLUMN kills INTEGER DEFAULT 7;
      ALTER TABLE player_profiles ADD COLUMN deaths INTEGER DEFAULT 2;
      ALTER TABLE player_profiles ADD COLUMN suicides INTEGER DEFAULT 0;
      ALTER TABLE player_profiles ADD COLUMN longest_kill_distance REAL DEFAULT 80;
      CREATE TABLE kill_events (id TEXT, linked_server_id TEXT, killer_id TEXT, victim_id TEXT, distance REAL, occurred_at TEXT, created_at TEXT);
      INSERT INTO player_profiles (id,linked_server_id,player_id,player_name,discord_id) VALUES ('legacy-independent','server-a','other-game','Other','discord-b');
      INSERT INTO player_game_identity_claims (id,user_id,discord_id,linked_server_id,player_profile_id,player_id)
        VALUES ('claim-stale','player-a','discord-a','server-a','profile-a','game-a');`);
    const before = f.state();
    assert.equal((await readTrustedPlayerGameplayAggregate(f.env.DB, player.discord_id))?.total_kills, 7);
    const ownerList = await readManagedGameIdentityLinks(f.env, owner, new URLSearchParams());
    assert.ok(ownerList.ok && ownerList.items.length === 1 && ownerList.items[0].legacy_conflict === 0);
    const result = await revokePlayerGameIdentityLink(f.env, owner, f.linkId, input);
    assert.equal(result.status, 200);
    assert.equal(f.state().links[0].status, "revoked");
    assert.deepEqual(f.state().profiles, before.profiles, "Revocation must never change gameplay or independent attribution");
    assert.equal(f.state().claim.find(row => row.id === "claim-a")?.status, "approved", "Historical approval must remain recorded");
    assert.equal(f.state().claim.find(row => row.id === "claim-stale")?.status, "cancelled");
    assert.equal((await reviewPlayerGameIdentityClaim(f.env, owner, "claim-stale", { action: "approve" })).status, 409);
    assert.equal((await readTrustedPlayerGameplayAggregate(f.env.DB, player.discord_id))?.linked_game_profiles, 0);
    assert.equal((await readTrustedPlayerGameplayAggregate(f.env.DB, "discord-b"))?.total_kills, 7);
    const personal = await readPlayerGameIdentityReadModel(f.env, player);
    assert.equal(personal.active_links.length, 0);
    assert.equal(personal.revoked_links[0].reason, input.reason);
    assert.equal((await readPlayerGameIdentityReadModel(f.env, identityTestUser("player-b", "discord-b"))).revoked_links.length, 0);
    const history = await readPlayerRequestSupport(f.env.DB, new URLSearchParams({ request: "claim-a" }));
    assert.ok(history.ok && "history" in history && history.history.some(event => event.action === "link_revoked" && event.note === input.reason));
    const notices = f.state().notifications;
    assert.equal(notices.length, 1); assert.equal(notices[0].user_id, player.id);
    assert.equal(notices[0].type, "player_link_revoked");
    assert.doesNotMatch(String(notices[0].body), /discord-a|game-a/);
    assert.ok(String(notices[0].body).includes(input.reason), "The notice retains only the same reason already visible to this player.");
    const after = f.state();
    assert.equal((await revokePlayerGameIdentityLink(f.env, owner, f.linkId, input)).status, 409);
    assert.deepEqual(f.state(), after, "Replayed decisions must not duplicate notices or audit events");
  } finally { f.close(); }

  for (let index = 0; index < 5; index++) {
    const fixture = await approvedFixture();
    try {
      const before = fixture.state(); fixture.failAt(index);
      assert.equal((await revokePlayerGameIdentityLink(fixture.env, owner, fixture.linkId, input)).status, 503);
      assert.deepEqual(fixture.state(), before, `Interruption at statement ${index} must roll back the link, audits and notice`);
    } finally { fixture.close(); }
  }
  for (const change of [
    "UPDATE linked_servers SET user_id='owner-b'",
    "UPDATE linked_servers SET status='merged'",
    "UPDATE linked_servers SET merged_into_server_id='another'",
    "UPDATE player_profiles SET discord_id='discord-a'",
    "UPDATE player_profiles SET discord_id='discord-b'",
    "UPDATE player_game_identity_links SET status='revoked'",
    "UPDATE player_game_identity_links SET discord_id='other-discord'",
    "INSERT INTO player_profiles (id,linked_server_id,player_id,discord_id) VALUES ('duplicate','server-a','game-a','discord-a')",
  ]) {
    const fixture = await approvedFixture();
    try {
      fixture.setBeforeBatch(() => fixture.sqlite.exec(change));
      assert.equal((await revokePlayerGameIdentityLink(fixture.env, owner, fixture.linkId, input)).status, 409, change);
      assert.equal(fixture.state().audit.filter(row => row.action === "link_revoked").length, 0);
      assert.equal(fixture.state().notifications.length, 0);
    } finally { fixture.close(); }
  }
  for (const legacyDiscord of ["discord-a", "discord-b", "  discord-a  "]) {
    const fixture = await approvedFixture();
    try {
      fixture.sqlite.prepare("UPDATE player_profiles SET discord_id=?").run(legacyDiscord);
      const before = fixture.state();
      const result = await revokePlayerGameIdentityLink(fixture.env, owner, fixture.linkId, input);
      assert.equal(result.status, 409); assert.equal("error" in result ? result.error : "", "LEGACY_ASSOCIATION_REVIEW_REQUIRED");
      assert.deepEqual(fixture.state(), before, "Ambiguous legacy associations must remain untouched");
    } finally { fixture.close(); }
  }
  const concurrent = await approvedFixture();
  try {
    const results = await Promise.all([1, 2].map(() => revokePlayerGameIdentityLink(concurrent.env, owner, concurrent.linkId, input)));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(concurrent.state().notifications.length, 1);
  } finally { concurrent.close(); }

  const access = await approvedFixture();
  try {
    for (const actor of [identityTestUser("owner-b"), identityTestUser("admin", "admin-discord"), player]) {
      access.env.MOCK_AUTH = "true";
      const before = access.state();
      const rows = await readManagedGameIdentityLinks(access.env, actor, new URLSearchParams());
      assert.ok(rows.ok && rows.items.length === 0);
      assert.equal((await revokePlayerGameIdentityLink(access.env, actor, access.linkId, input)).status, 403);
      assert.deepEqual(access.state(), before, "Generic admin, mock auth and payments never confer revoke authority");
    }
    for (const invalid of [null, [], {}, { ...input, reason: " " }, { ...input, reason: "x".repeat(241) }, { ...input, confirm: false }]) {
      assert.equal((await revokePlayerGameIdentityLink(access.env, owner, access.linkId, invalid)).status, 400);
    }
    assert.equal((await revokePlayerGameIdentityLink(access.env, owner, "../other", input)).status, 400);
    access.env.DZN_PLATFORM_OWNER_DISCORD_IDS = "123456789001";
    assert.equal((await revokePlayerGameIdentityLink(access.env, identityTestUser("admin", "123456789001"), access.linkId, input)).status, 200);
  } finally { access.close(); }

  const routes = await approvedFixture();
  try {
    routes.env.SESSION_SECRET = "local-revocation-session-secret";
    routes.sqlite.exec("CREATE TABLE sessions (session_token_hash TEXT, user_id TEXT, expires_at TEXT)");
    const token = "local-revocation-test";
    routes.sqlite.prepare("INSERT INTO sessions VALUES (?, 'owner-a','2099-01-01')").run(await hmacSha256(token, routes.env.SESSION_SECRET));
    const invoke = (request: Request, handler = mutate) => handler({ env: routes.env, request, params: { linkId: routes.linkId }, data: {}, waitUntil: () => {}, next: async () => new Response() });
    const url = `https://dzn.test/api/owner/player-game-identity-links/${routes.linkId}`;
    const request = (body: string, extra: Record<string, string> = {}) => new Request(url, { method: "PATCH", headers: {
      cookie: `dzn_session=${token}`, origin: "https://dzn.test", "content-type": "application/json", ...extra }, body });
    const anonymous = await invoke(new Request(url, { method: "PATCH" }));
    assert.equal(anonymous.status, 401); assert.match(anonymous.headers.get("cache-control") ?? "", /private.*no-store/);
    assert.equal((await invoke(new Request(url))).status, 405);
    assert.equal((await invoke(request(JSON.stringify(input), { origin: "https://hostile.test" }))).status, 403);
    assert.equal((await invoke(request(JSON.stringify(input), { origin: "" }))).status, 403);
    assert.equal((await invoke(request("x".repeat(4097)))).status, 413);
    assert.equal((await invoke(request("{"))).status, 400);
    const listReply = await invoke(new Request("https://dzn.test/api/owner/player-game-identity-links", { headers: { cookie: `dzn_session=${token}` } }), list);
    assert.equal(listReply.status, 200); assert.match(listReply.headers.get("cache-control") ?? "", /private.*no-store/);
    const mutationReply = await invoke(request(JSON.stringify(input)));
    assert.equal(mutationReply.status, 200); assert.match(mutationReply.headers.get("cache-control") ?? "", /private.*no-store/);
    const clean = routes.state(); routes.sqlite.exec("DROP TABLE user_notifications");
    routes.sqlite.exec("UPDATE player_game_identity_links SET status='active',revoked_at=NULL");
    assert.equal((await invoke(request(JSON.stringify(input)))).status, 503);
    assert.equal(routes.sqlite.prepare("SELECT status FROM player_game_identity_links").get()?.status, "active");
    assert.equal(routes.sqlite.prepare("SELECT count(*) AS count FROM player_game_identity_audit_log").get()?.count, clean.audit.length);
  } finally { routes.close(); }
  for (const remove of ["player", "server"] as const) {
    const fixture = await approvedFixture();
    try {
      assert.equal((await revokePlayerGameIdentityLink(fixture.env, owner, fixture.linkId, input)).status, 200);
      assert.equal(fixture.state().notifications[0].server_id, null, "Private notice must not prevent server deletion.");
      fixture.sqlite.exec(`CREATE TABLE nitrado_connections (user_id TEXT, linked_server_id TEXT);
        CREATE TABLE sessions (user_id TEXT);
        CREATE TABLE discord_guilds (id TEXT, owner_user_id TEXT);
        ALTER TABLE linked_servers ADD COLUMN discord_guild_id TEXT;
        INSERT INTO user_notifications (id,user_id,type,title,body,dedupe_key)
        VALUES ('unrelated-notice','player-b','news','Other notice','Other private notice','unrelated');`);
      if (remove === "player") {
        assert.equal((await deleteOwnedAccountData(fixture.env, "player-a")).ok, true);
        assert.equal(fixture.sqlite.prepare("SELECT id FROM users WHERE id='player-a'").get(), undefined);
        assert.equal(fixture.sqlite.prepare("SELECT id FROM linked_servers WHERE id='server-a'").get()?.id, "server-a");
        assert.equal(fixture.state().notifications.length, 1);
      } else {
        const before = fixture.state();
        assert.equal((await deleteOwnedLinkedServerData(fixture.env, "owner-b", "server-a")).status, 403);
        assert.deepEqual(fixture.state(), before, "Wrong-owner deletion cannot touch notices or links.");
        assert.equal((await deleteOwnedLinkedServerData(fixture.env, "owner-a", "server-a")).ok, true);
        assert.equal(fixture.sqlite.prepare("SELECT id FROM linked_servers WHERE id='server-a'").get(), undefined);
        assert.equal(fixture.state().notifications.length, 2, "Server removal preserves private recipient notices.");
        const notice = fixture.sqlite.prepare("SELECT body FROM user_notifications WHERE user_id='player-a' AND type='player_link_revoked'").get();
        assert.ok(String(notice?.body).includes(input.reason), "The player-visible reason survives server/link/audit deletion.");
        assert.equal(String(notice?.body).includes("Review the reason in your player profile"), false);
      }
      assert.equal(fixture.sqlite.prepare("SELECT id FROM user_notifications WHERE id='unrelated-notice'").get()?.id, "unrelated-notice");
      assert.deepEqual(fixture.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { fixture.close(); }
  }
  console.log("Game link revocation: permissions, legacy preservation, fresh guards, rollback, races, private notices, deletion compatibility and stats removal passed.");
}
