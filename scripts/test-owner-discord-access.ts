import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

import { createSession } from "../functions/_lib/db";
import { createOwnerDiscordAccessRequest, decideOwnerDiscordAccessRequest, listOwnerDiscordAccessRequests } from "../functions/_lib/owner-discord-access";
import { onRequest as applicantRoute } from "../functions/api/discord/owner-access";
import { onRequest as ownerRoute } from "../functions/api/owner/discord/owner-access-requests";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

const owner: SessionUser = { id: "platform_owner", discord_id: "831243159785701398", username: "DZN Owner", avatar: null };
const applicant: SessionUser = { id: "server_owner", discord_id: "111111111111111111", username: "Server Owner", avatar: "owneravatar" };
const outsider: SessionUser = { id: "outsider", discord_id: "222222222222222222", username: "Outsider", avatar: null };

async function run() {
  const migration = readFileSync("migrations/0093_dzn_owner_discord_access.sql", "utf8");
  assert.match(migration, /dzn_owner_discord_access_requests/);
  assert.match(migration, /idx_dzn_owner_discord_access_one_pending/);
  assert.match(migration, /dzn_owner_discord_access_audit/);
  assert.match(migration, /linked_server_id TEXT,/);
  assert.match(migration, /linked_server_id_snapshot TEXT NOT NULL/);
  assert.match(migration, /FOREIGN KEY\(linked_server_id\) REFERENCES linked_servers\(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(migration, /discord\.com|DISCORD_BOT_TOKEN|CREATE\s+INVITE/i);
  const accessSource = readFileSync("functions/_lib/owner-discord-access.ts", "utf8");
  assert.match(accessSource, /DZN_OWNER_DISCORD_ACCESS_ENABLED/);
  assert.match(accessSource, /linked_servers[\s\S]*user_id = \?/);
  assert.match(accessSource, /isActiveRequestConflict/);
  assert.match(accessSource, /status IN \('pending', 'approved'\)/);
  assert.match(accessSource, /No Discord invite, message, or role change/);
  assert.doesNotMatch(accessSource, /DISCORD_BOT_TOKEN|fetch\s*\(/);
  assert.match(accessSource, /WHERE changes\(\) = 1/, "Decision audits must be written only when the immediately preceding status update succeeds.");
  assert.match(accessSource, /result\[1\]\?\.meta\?\.changes/, "A decision must fail closed if its audit row was not written.");
  const envExample = readFileSync(".env.example", "utf8");
  assert.match(envExample, /^DZN_OWNER_DISCORD_ACCESS_ENABLED=false$/m);
  assert.match(envExample, /^NEXT_PUBLIC_DZN_OWNER_DISCORD_ACCESS_UI_ENABLED=false$/m);
  assert.match(readFileSync("cloudflare-env.d.ts", "utf8"), /DZN_OWNER_DISCORD_ACCESS_ENABLED\?: string/);
  const wrangler = readFileSync("wrangler.toml", "utf8");
  assert.doesNotMatch(wrangler, /^DZN_OWNER_DISCORD_ACCESS_ENABLED = "true"$/m);
  const dashboard = readFileSync("components/onboarding/dashboard.tsx", "utf8");
  assert.match(dashboard, /NEXT_PUBLIC_DZN_OWNER_DISCORD_ACCESS_UI_ENABLED/, "The dashboard link must require an explicit public activation flag.");
  assert.match(dashboard, /ownerDiscordAccessUiEnabled \? <Link href="\/discord-owner-access"/, "The dashboard must not expose owner Discord navigation while the feature is inactive.");
  const ownerAccessPage = readFileSync("app/discord-owner-access/page.tsx", "utf8");
  assert.match(ownerAccessPage, /process\.env\.DZN_OWNER_DISCORD_ACCESS_ENABLED !== "true"\) notFound\(\)/, "The destination route must remain unavailable until the server feature is enabled.");
  assert.match(ownerAccessPage, /OwnerDiscordAccessPage/, "The protected route must render the owner access page only after activation.");

  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-05-08", d1Databases: ["DB"], d1Persist: false });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT, avatar TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id));
      CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, guild_id TEXT NOT NULL, server_name TEXT NOT NULL, display_name TEXT, hostname TEXT, public_slug TEXT, status TEXT, lifecycle_status TEXT, merged_into_server_id TEXT, created_at TEXT, updated_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id));`);
    for (const statement of splitSql(readFileSync("migrations/0093_dzn_owner_discord_access.sql", "utf8").replace(/^--.*$/gm, ""))) await db.prepare(statement).run();
    for (const user of [owner, applicant, outsider]) await db.prepare("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)").bind(user.id, user.discord_id, user.username, user.avatar).run();
    await db.prepare("INSERT INTO linked_servers (id, user_id, guild_id, server_name, status, created_at, updated_at) VALUES ('server_owned', ?, 'guild_owned', 'Verified Owner Server', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(applicant.id).run();
    await db.prepare("INSERT INTO linked_servers (id, user_id, guild_id, server_name, status, created_at, updated_at) VALUES ('server_other', ?, 'guild_other', 'Other Server', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(outsider.id).run();
    const env = { DB: db as unknown as D1Database, SESSION_SECRET: "owner-discord-access-test", DZN_OWNER_DISCORD_ACCESS_ENABLED: "true", DZN_PLATFORM_OWNER_DISCORD_IDS: owner.discord_id } as Env;
    const applicantSession = await createSession(env, applicant.id);
    const ownerSession = await createSession(env, owner.id);

    assert.equal((await applicantRoute(context(env, request("GET")))).status, 401);
    assert.equal((await applicantRoute(context({ ...env, DZN_OWNER_DISCORD_ACCESS_ENABLED: "false" }, request("GET", undefined, applicantSession.token)))).status, 404);
    assert.equal((await applicantRoute(context(env, request("POST", { linkedServerId: "server_owned" }, applicantSession.token)))).status, 403);
    const created = await applicantRoute(context(env, request("POST", { linkedServerId: "server_owned", note: "I own this verified DZN server." }, applicantSession.token, "https://dzn.test")));
    assert.equal(created.status, 201);
    const createdPayload = await created.json() as { ok: boolean; duplicate: boolean; request: { id: string; status: string } };
    assert.equal(createdPayload.ok, true); assert.equal(createdPayload.duplicate, false); assert.equal(createdPayload.request.status, "pending");
    const duplicate = await createOwnerDiscordAccessRequest(env, request("POST", { linkedServerId: "server_owned" }, applicantSession.token, "https://dzn.test"), { linkedServerId: "server_owned" });
    assert.equal(duplicate.ok, true); if (duplicate.ok) assert.equal(duplicate.duplicate, true);
    const forbidden = await createOwnerDiscordAccessRequest(env, request("POST", { linkedServerId: "server_other" }, applicantSession.token, "https://dzn.test"), { linkedServerId: "server_other" });
    assert.equal(forbidden.ok, false); if (!forbidden.ok) assert.equal(forbidden.status, 403);

    assert.equal((await ownerRoute(context(env, request("GET", undefined, applicantSession.token)))).status, 403);
    const queue = await ownerRoute(context(env, request("GET", undefined, ownerSession.token)));
    assert.equal(queue.status, 200);
    const queuePayload = await queue.json() as { requests: Array<{ id: string; linkedServerId?: string; requester: { discordId?: string } }> };
    assert.equal(queuePayload.requests.length, 1); assert.equal(queuePayload.requests[0]?.linkedServerId, "server_owned"); assert.equal(queuePayload.requests[0]?.requester.discordId, applicant.discord_id);
    assert.equal((await ownerRoute(context(env, request("POST", { requestId: createdPayload.request.id, action: "approved", reason: "Exact linked server ownership checked.", decisionNonce: "decision_one" }, ownerSession.token)))).status, 403);
    const approved = await ownerRoute(context(env, request("POST", { requestId: createdPayload.request.id, action: "approved", reason: "Exact linked server ownership checked.", decisionNonce: "decision_one" }, ownerSession.token, "https://dzn.test")));
    assert.equal(approved.status, 200);
    const activeDuplicate = await createOwnerDiscordAccessRequest(env, request("POST", { linkedServerId: "server_owned" }, applicantSession.token, "https://dzn.test"), { linkedServerId: "server_owned" });
    assert.equal(activeDuplicate.ok, true); if (activeDuplicate.ok) assert.equal(activeDuplicate.duplicate, true);
    const replay = await decideOwnerDiscordAccessRequest(env, owner, { requestId: createdPayload.request.id, action: "approved", reason: "Exact linked server ownership checked.", decisionNonce: "decision_two" });
    assert.equal(replay.ok, true); if (replay.ok) assert.equal(replay.duplicate, true);
    const conflicting = await decideOwnerDiscordAccessRequest(env, owner, { requestId: createdPayload.request.id, action: "rejected", reason: "Conflicting decision should be refused.", decisionNonce: "decision_three" });
    assert.equal(conflicting.ok, false); if (!conflicting.ok) assert.equal(conflicting.status, 409);

    const concurrentRequest = await createOwnerDiscordAccessRequest(env, request("POST", { linkedServerId: "server_other" }, await createSession(env, outsider.id).then((session) => session.token), "https://dzn.test"), { linkedServerId: "server_other" });
    assert.equal(concurrentRequest.ok, true);
    if (concurrentRequest.ok) {
      const concurrentInput = { requestId: concurrentRequest.request.id, action: "approved" as const, reason: "Concurrent review audit must remain singular.", decisionNonce: "decision_concurrent" };
      const concurrentResults = await Promise.all([
        decideOwnerDiscordAccessRequest(env, owner, concurrentInput),
        decideOwnerDiscordAccessRequest(env, owner, concurrentInput),
      ]);
      assert.equal(concurrentResults.some((result) => result.ok && !result.duplicate), true, "One concurrent decision must apply.");
      const concurrentAudit = await db.prepare("SELECT COUNT(*) AS count FROM dzn_owner_discord_access_audit WHERE request_id = ? AND action = 'approved'").bind(concurrentRequest.request.id).first<{ count: number }>();
      assert.equal(Number(concurrentAudit?.count ?? 0), 1, "Concurrent decision retries must write exactly one approval audit entry.");
    }
    const revoked = await decideOwnerDiscordAccessRequest(env, owner, { requestId: createdPayload.request.id, action: "revoked", reason: "The linked server is no longer verified.", decisionNonce: "decision_four" });
    assert.equal(revoked.ok, true); if (revoked.ok) assert.equal(revoked.status, "revoked");
    const replacement = await createOwnerDiscordAccessRequest(env, request("POST", { linkedServerId: "server_owned" }, applicantSession.token, "https://dzn.test"), { linkedServerId: "server_owned" });
    assert.equal(replacement.ok, true); if (replacement.ok) assert.equal(replacement.duplicate, false);
    if (replacement.ok) {
      await db.prepare("UPDATE linked_servers SET user_id = ?, status = 'merged' WHERE id = 'server_owned'").bind(outsider.id).run();
      const staleApproval = await decideOwnerDiscordAccessRequest(env, owner, { requestId: replacement.request.id, action: "approved", reason: "Current ownership checked before approval.", decisionNonce: "decision_five" });
      assert.equal(staleApproval.ok, false); if (!staleApproval.ok) assert.equal(staleApproval.status, 409);
    }
    const audit = await listOwnerDiscordAccessRequests(env);
    assert.equal(audit.ok, true); if (audit.ok) assert.deepEqual(audit.audit.map((entry) => entry.action).sort(), ["approved", "approved", "requested", "requested", "requested", "revoked"]);

    await db.prepare("DELETE FROM linked_servers WHERE id = 'server_owned'").run();
    const preservedRequest = await db.prepare("SELECT linked_server_id, linked_server_id_snapshot, server_name FROM dzn_owner_discord_access_requests WHERE id = ?").bind(createdPayload.request.id).first<{ linked_server_id: string | null; linked_server_id_snapshot: string; server_name: string }>();
    assert.equal(preservedRequest?.linked_server_id, null, "Server deletion must preserve the owner-access request as a tombstone.");
    assert.equal(preservedRequest?.linked_server_id_snapshot, "server_owned", "A tombstone must retain its immutable linked-server identifier.");
    assert.equal(preservedRequest?.server_name, "Verified Owner Server", "The audit trail must retain the original server name after deletion.");
    const preservedAudit = await db.prepare("SELECT COUNT(*) AS count FROM dzn_owner_discord_access_audit WHERE request_id = ?").bind(createdPayload.request.id).first<{ count: number }>();
    assert.equal(Number(preservedAudit?.count ?? 0) > 0, true, "Server deletion must not erase owner-access decision audit history.");
    const retainedAuditList = await listOwnerDiscordAccessRequests(env);
    assert.equal(retainedAuditList.ok, true);
    if (retainedAuditList.ok) {
      assert.equal(retainedAuditList.audit.some((entry) => entry.requestId === createdPayload.request.id), true, "The owner console must continue to list a preserved audit after server deletion.");
      assert.equal(retainedAuditList.requests.find((entry) => entry.id === createdPayload.request.id)?.linkedServerId, "server_owned", "The owner console must show the immutable server ID after deletion.");
    }
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    console.log("Owner Discord access queue checks passed.");
  } finally { await mf.dispose(); }
}

function request(method: "GET" | "POST", body?: unknown, token?: string, origin?: string) { const headers = new Headers(); if (token) headers.set("cookie", `dzn_session=${token}`); if (origin) headers.set("origin", origin); if (body !== undefined) headers.set("content-type", "application/json"); return new Request("https://dzn.test/api/test", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
function context(env: Env, request: Request): PagesContext { return { env, request, params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 204 }) }; }
function splitSql(sql: string) { const statements: string[] = []; let buffer = ""; for (const line of sql.split(/\r?\n/)) { if (!buffer && !line.trim()) continue; buffer += `${line}\n`; if (/;\s*$/.test(line)) { statements.push(buffer.trim().replace(/;\s*$/, "")); buffer = ""; } } if (buffer.trim()) statements.push(buffer.trim()); return statements; }
void run();
