import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createSession } from "../functions/_lib/db";
import { deleteOwnedAccountData } from "../functions/_lib/deletion";
import { createOwnerDiscordAccessRequest, decideOwnerDiscordAccessRequest, getOwnerDiscordAccessApplicant, listOwnerDiscordAccessRequests } from "../functions/_lib/owner-discord-access";
import { onRequest as applicantRoute } from "../functions/api/discord/owner-access";
import { onRequest as ownerRoute } from "../functions/api/owner/discord/owner-access-requests";
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
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    exec: async (sql: string) => { sqlite.exec(sql); return { count: 0, duration: 0 }; },
  } as unknown as D1Database;
}

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
  assert.match(migration, /requester_user_id TEXT,/);
  assert.match(migration, /FOREIGN KEY\(requester_user_id\) REFERENCES users\(id\) ON DELETE SET NULL/);
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
  assert.match(accessSource, /OWNER_ACCESS_PAGE_SIZE/, "The owner-access queue must use a bounded page size.");
  assert.match(accessSource, /OWNER_ACCESS_AUDIT_PAGE_SIZE/, "The owner-access audit must use its own bounded page size.");
  assert.match(accessSource, /APPLICANT_OWNER_ACCESS_PAGE_SIZE/, "Applicant request history must use a bounded page size.");
  assert.match(accessSource, /encodeOwnerAccessCursor/, "The owner-access queue must expose stable continuation cursors.");
  assert.match(accessSource, /encodeOwnerAccessAuditCursor/, "The owner-access audit must expose a stable independent continuation cursor.");
  assert.match(accessSource, /encodeApplicantOwnerAccessCursor/, "Applicant request history must expose a stable continuation cursor.");
  assert.match(accessSource, /COALESCE\(status, 'pending'\)\) = 'live'/, "Owner approval must require a live server.");
  assert.match(accessSource, /COALESCE\(lifecycle_status, 'active_live'\)\) = 'active_live'/, "Owner approval must reject a server with a known unhealthy lifecycle state.");
  assert.match(accessSource, /latest_check\.token_valid = 1/, "Owner approval must require current onboarding verification evidence.");
  assert.match(accessSource, /datetime\(current_check\.last_tested_at\) >= datetime\(/, "Owner approval must require a check made after the current Nitrado connection was saved.");
  assert.match(accessSource, /FROM nitrado_connections AS current_connection/, "Owner approval must bind verification to the current Nitrado connection.");
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
  const ownerConsoleRoute = readFileSync("app/owner/page.tsx", "utf8");
  assert.match(ownerConsoleRoute, /ownerDiscordAccessEnabled=\{process\.env\.DZN_OWNER_DISCORD_ACCESS_ENABLED === "true"\}/, "The owner console must receive the private server activation state.");
  const ownerConsoleAccessRoute = readFileSync("app/owner/discord-access/page.tsx", "utf8");
  assert.match(ownerConsoleAccessRoute, /process\.env\.DZN_OWNER_DISCORD_ACCESS_ENABLED !== "true"\) notFound\(\)/, "The private owner route must be unavailable until the server feature is enabled.");
  const applicantAccessPage = readFileSync("components/discord/owner-discord-access-page.tsx", "utf8");
  assert.match(applicantAccessPage, /servers\.some\(\(server\) => server\.id === current\)/, "A refreshed owner request form must keep a selection only while the server remains eligible.");
  assert.match(applicantAccessPage, /servers\[0\]\?\.id \?\? ""/, "A refreshed owner request form must select the first current eligible server or clear the field.");
  assert.doesNotMatch(applicantAccessPage, /if \(!append\) setServerId/, "Paginated history loads must revalidate a selected server against the latest eligible server list.");
  assert.match(applicantAccessPage, /requestController\.current\?\.abort\(\)/, "Applicant history refreshes must cancel superseded reads.");
  assert.match(applicantAccessPage, /requestController\.current !== controller/, "Applicant history must discard stale response state.");
  assert.match(applicantAccessPage, /Load older requests/, "Applicants must be able to continue through older request decisions.");
  const ownerQueuePage = readFileSync("components/owner/owner-discord-access-page.tsx", "utf8");
  assert.match(ownerQueuePage, /requestController\.current\?\.abort\(\)/, "The owner queue must cancel superseded reads.");
  assert.match(ownerQueuePage, /signal: controller\.signal/, "The owner queue must bind reads to the active request controller.");
  assert.match(ownerQueuePage, /requestController\.current !== controller/, "The owner queue must discard stale response state.");
  const ownerConsole = readFileSync("components/owner/owner-console.tsx", "utf8");
  assert.match(ownerConsole, /ownerDiscordAccessEnabled \? <Link href="\/owner\/discord-access"/, "The owner console must hide the owner-access link until the private feature is enabled.");

  const sqlite = new DatabaseSync(":memory:");
  const db = localD1(sqlite);
  try {
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT, avatar TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id));
      CREATE TABLE discord_guilds (id TEXT PRIMARY KEY, owner_user_id TEXT, FOREIGN KEY(owner_user_id) REFERENCES users(id));
      CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, guild_id TEXT NOT NULL, discord_guild_id TEXT, server_name TEXT NOT NULL, display_name TEXT, hostname TEXT, public_slug TEXT, status TEXT, lifecycle_status TEXT, merged_into_server_id TEXT, created_at TEXT, updated_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id));
      CREATE TABLE nitrado_connections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, linked_server_id TEXT NOT NULL, created_at TEXT, updated_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id));
      CREATE TABLE onboarding_checks (id TEXT PRIMARY KEY, linked_server_id TEXT NOT NULL, token_valid INTEGER DEFAULT 0, service_access INTEGER DEFAULT 0, dayz_service_detected INTEGER DEFAULT 0, last_tested_at TEXT, FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id));`);
    for (const statement of splitSql(readFileSync("migrations/0093_dzn_owner_discord_access.sql", "utf8").replace(/^--.*$/gm, ""))) await db.prepare(statement).run();
    for (const user of [owner, applicant, outsider]) await db.prepare("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)").bind(user.id, user.discord_id, user.username, user.avatar).run();
    await db.prepare("INSERT INTO linked_servers (id, user_id, guild_id, server_name, status, lifecycle_status, created_at, updated_at) VALUES ('server_owned', ?, 'guild_owned', 'Verified Owner Server', 'live', 'active_live', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(applicant.id).run();
    await db.prepare("INSERT INTO linked_servers (id, user_id, guild_id, server_name, status, lifecycle_status, created_at, updated_at) VALUES ('server_other', ?, 'guild_other', 'Other Server', 'live', 'active_live', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(outsider.id).run();
    await db.prepare("INSERT INTO linked_servers (id, user_id, guild_id, server_name, status, lifecycle_status, created_at, updated_at) VALUES ('server_unverified', ?, 'guild_unverified', 'Unverified Draft', 'pending', 'active_live', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(applicant.id).run();
    for (const serverId of ["server_owned", "server_other"]) {
      await db.prepare("INSERT INTO nitrado_connections (id, user_id, linked_server_id, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(`connection-${serverId}`, serverId === "server_owned" ? applicant.id : outsider.id, serverId).run();
      await db.prepare("INSERT INTO onboarding_checks (id, linked_server_id, token_valid, service_access, dayz_service_detected, last_tested_at) VALUES (?, ?, 1, 1, 1, CURRENT_TIMESTAMP)").bind(`check-${serverId}`, serverId).run();
    }
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
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot,
      server_name, status, created_at, updated_at
    ) VALUES ('unverified-request', ?, ?, ?, 'server_unverified', 'server_unverified', 'Unverified Draft', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(applicant.id, applicant.discord_id, applicant.username).run();
    const unverifiedApproval = await decideOwnerDiscordAccessRequest(env, owner, { requestId: "unverified-request", action: "approved", reason: "This server has not completed verification.", decisionNonce: "decision_unverified" });
    assert.equal(unverifiedApproval.ok, false, "A saved but unverified server must not be approved for owner Discord access.");
    if (!unverifiedApproval.ok) assert.equal(unverifiedApproval.status, 409);
    await db.prepare("INSERT INTO linked_servers (id, user_id, guild_id, server_name, status, lifecycle_status, created_at, updated_at) VALUES ('server_lifecycle_stale', ?, 'guild_lifecycle_stale', 'Known bad token', 'live', 'token_needs_resave', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(applicant.id).run();
    await db.prepare("INSERT INTO nitrado_connections (id, user_id, linked_server_id, created_at, updated_at) VALUES ('connection-lifecycle-stale', ?, 'server_lifecycle_stale', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(applicant.id).run();
    await db.prepare("INSERT INTO onboarding_checks (id, linked_server_id, token_valid, service_access, dayz_service_detected, last_tested_at) VALUES ('check-lifecycle-stale', 'server_lifecycle_stale', 1, 1, 1, CURRENT_TIMESTAMP)").run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot,
      server_name, status, created_at, updated_at
    ) VALUES ('lifecycle-stale-request', ?, ?, ?, 'server_lifecycle_stale', 'server_lifecycle_stale', 'Known bad token', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(applicant.id, applicant.discord_id, applicant.username).run();
    const lifecycleStaleApproval = await decideOwnerDiscordAccessRequest(env, owner, { requestId: "lifecycle-stale-request", action: "approved", reason: "Known invalid token must block owner access.", decisionNonce: "decision_lifecycle_stale" });
    assert.equal(lifecycleStaleApproval.ok, false, "A server flagged for token re-save must not be approved for owner Discord access.");
    if (!lifecycleStaleApproval.ok) assert.equal(lifecycleStaleApproval.status, 409);
    await db.prepare("INSERT INTO linked_servers (id, user_id, guild_id, server_name, status, lifecycle_status, created_at, updated_at) VALUES ('server_connection_changed', ?, 'guild_connection_changed', 'Connection changed', 'live', 'active_live', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(applicant.id).run();
    await db.prepare("INSERT INTO nitrado_connections (id, user_id, linked_server_id, created_at, updated_at) VALUES ('connection-before-change', ?, 'server_connection_changed', datetime('now', '-2 minutes'), datetime('now', '-2 minutes'))").bind(applicant.id).run();
    await db.prepare("INSERT INTO onboarding_checks (id, linked_server_id, token_valid, service_access, dayz_service_detected, last_tested_at) VALUES ('check-before-change', 'server_connection_changed', 1, 1, 1, datetime('now', '-1 minute'))").run();
    await db.prepare("UPDATE nitrado_connections SET updated_at = CURRENT_TIMESTAMP WHERE id = 'connection-before-change'").run();
    await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
      id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot,
      server_name, status, created_at, updated_at
    ) VALUES ('connection-stale-request', ?, ?, ?, 'server_connection_changed', 'server_connection_changed', 'Connection changed', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(applicant.id, applicant.discord_id, applicant.username).run();
    const connectionStaleApproval = await decideOwnerDiscordAccessRequest(env, owner, { requestId: "connection-stale-request", action: "approved", reason: "Changed connection requires a fresh verification check.", decisionNonce: "decision_connection_stale" });
    assert.equal(connectionStaleApproval.ok, false, "Changing the Nitrado connection must invalidate older owner-access proof.");
    if (!connectionStaleApproval.ok) assert.equal(connectionStaleApproval.status, 409);
    const audit = await listOwnerDiscordAccessRequests(env);
    assert.equal(audit.ok, true); if (audit.ok) assert.deepEqual(audit.audit.map((entry) => entry.action).sort(), ["approved", "approved", "requested", "requested", "requested", "revoked"]);

    for (let index = 0; index < 101; index += 1) {
      const id = `queue-page-${String(index).padStart(3, "0")}`;
      const updatedAt = new Date(Date.UTC(2026, 8, 1, 0, index, 0)).toISOString();
      await db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot,
        server_name, request_note, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'server_owned', 'server_owned', 'Verified Owner Server', 'Pagination coverage', 'rejected', ?, ?)`)
        .bind(id, applicant.id, applicant.discord_id, applicant.username, updatedAt, updatedAt).run();
    }
    const firstRejectedPage = await listOwnerDiscordAccessRequests(env, { status: "rejected" });
    assert.equal(firstRejectedPage.ok, true);
    if (firstRejectedPage.ok) {
      assert.equal(firstRejectedPage.requests.length, 50, "The owner-access queue must return a bounded first page.");
      assert.equal(firstRejectedPage.page.has_more, true);
      assert.equal(typeof firstRejectedPage.page.next_cursor, "string");
      const secondRejectedPage = await listOwnerDiscordAccessRequests(env, { status: "rejected", cursor: firstRejectedPage.page.next_cursor });
      assert.equal(secondRejectedPage.ok, true);
      if (secondRejectedPage.ok) {
        assert.equal(secondRejectedPage.requests.length, 50, "The owner-access cursor must return the next stable page.");
        assert.equal(secondRejectedPage.page.has_more, true);
        const thirdRejectedPage = await listOwnerDiscordAccessRequests(env, { status: "rejected", cursor: secondRejectedPage.page.next_cursor });
        assert.equal(thirdRejectedPage.ok, true);
        if (thirdRejectedPage.ok) {
          assert.equal(thirdRejectedPage.requests.length, 1, "The final owner-access page must expose records beyond the initial 100.");
          assert.equal(thirdRejectedPage.page.has_more, false);
          const ids = [...firstRejectedPage.requests, ...secondRejectedPage.requests, ...thirdRejectedPage.requests].map((entry) => entry.id);
          assert.equal(new Set(ids).size, 101, "Owner-access pagination must not duplicate or omit requests.");
        }
      }
    }
    const applicantPages: string[] = [];
    let applicantCursor: string | null = null;
    do {
      const applicantHistory = await getOwnerDiscordAccessApplicant(env, request("GET", undefined, applicantSession.token), { cursor: applicantCursor });
      assert.equal(applicantHistory.ok, true);
      if (!applicantHistory.ok) break;
      assert.equal(applicantHistory.requests.length <= 20, true, "Applicant history must remain bounded.");
      applicantPages.push(...applicantHistory.requests.map((entry) => entry.id));
      applicantCursor = applicantHistory.page.next_cursor;
    } while (applicantCursor);
    assert.equal(applicantPages.length > 100, true, "Applicant history pagination must reach decisions beyond the first page.");
    assert.equal(new Set(applicantPages).size, applicantPages.length, "Applicant history pagination must not duplicate decisions.");
    const invalidApplicantCursor = await applicantRoute(context(env, request("GET", undefined, applicantSession.token, undefined, "?cursor=invalid")));
    assert.equal(invalidApplicantCursor.status, 400);
    const invalidCursor = await listOwnerDiscordAccessRequests(env, { cursor: "invalid" });
    assert.equal(invalidCursor.ok, false);
    if (!invalidCursor.ok) assert.equal(invalidCursor.status, 400);

    for (let index = 0; index < 21; index += 1) {
      const id = `audit-page-${String(index).padStart(3, "0")}`;
      const createdAt = new Date(Date.UTC(2026, 8, 2, 0, index, 0)).toISOString();
      await db.prepare(`INSERT INTO dzn_owner_discord_access_audit (
        id, request_id, actor_user_id, actor_discord_id, actor_username, action, previous_status, next_status, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, 'requested', NULL, 'pending', 'Independent audit pagination coverage.', ?)`)
        .bind(id, createdPayload.request.id, owner.id, owner.discord_id, owner.username, createdAt).run();
    }
    const firstAuditPage = await listOwnerDiscordAccessRequests(env, { status: "rejected" });
    assert.equal(firstAuditPage.ok, true);
    if (firstAuditPage.ok) {
      assert.equal(firstAuditPage.audit.length, 20, "The owner-access audit must return a bounded first page.");
      assert.equal(firstAuditPage.auditPage.has_more, true);
      assert.equal(typeof firstAuditPage.auditPage.next_cursor, "string");
      const secondAuditPage = await listOwnerDiscordAccessRequests(env, { status: "rejected", auditCursor: firstAuditPage.auditPage.next_cursor });
      assert.equal(secondAuditPage.ok, true);
      if (secondAuditPage.ok) {
        assert.equal(secondAuditPage.audit.length > 0, true, "The independent audit cursor must expose older decisions.");
        const ids = [...firstAuditPage.audit, ...secondAuditPage.audit].map((entry) => entry.id);
        assert.equal(new Set(ids).size, ids.length, "Audit pagination must not duplicate decisions.");
      }
    }
    const invalidAuditCursor = await listOwnerDiscordAccessRequests(env, { auditCursor: "invalid" });
    assert.equal(invalidAuditCursor.ok, false);
    if (!invalidAuditCursor.ok) assert.equal(invalidAuditCursor.status, 400);

    await db.prepare("DELETE FROM onboarding_checks WHERE linked_server_id = 'server_owned'").run();
    await db.prepare("DELETE FROM nitrado_connections WHERE linked_server_id = 'server_owned'").run();
    await db.prepare("DELETE FROM linked_servers WHERE id = 'server_owned'").run();
    const preservedRequest = await db.prepare("SELECT linked_server_id, linked_server_id_snapshot, server_name FROM dzn_owner_discord_access_requests WHERE id = ?").bind(createdPayload.request.id).first<{ linked_server_id: string | null; linked_server_id_snapshot: string; server_name: string }>();
    assert.equal(preservedRequest?.linked_server_id, null, "Server deletion must preserve the owner-access request as a tombstone.");
    assert.equal(preservedRequest?.linked_server_id_snapshot, "server_owned", "A tombstone must retain its immutable linked-server identifier.");
    assert.equal(preservedRequest?.server_name, "Verified Owner Server", "The audit trail must retain the original server name after deletion.");
    const preservedAudit = await db.prepare("SELECT COUNT(*) AS count FROM dzn_owner_discord_access_audit WHERE request_id = ?").bind(createdPayload.request.id).first<{ count: number }>();
    assert.equal(Number(preservedAudit?.count ?? 0) > 0, true, "Server deletion must not erase owner-access decision audit history.");
    const retainedAuditList = await listOwnerDiscordAccessRequests(env, { status: "revoked" });
    assert.equal(retainedAuditList.ok, true);
    if (retainedAuditList.ok) {
      assert.equal(retainedAuditList.audit.some((entry) => entry.requestId === createdPayload.request.id), true, "The owner console must continue to list a preserved audit after server deletion.");
      assert.equal(retainedAuditList.requests.find((entry) => entry.id === createdPayload.request.id)?.linkedServerId, "server_owned", "The owner console must show the immutable server ID after deletion.");
    }
    await db.prepare("DELETE FROM onboarding_checks WHERE linked_server_id IN ('server_unverified', 'server_lifecycle_stale', 'server_connection_changed')").run();
    await db.prepare("DELETE FROM nitrado_connections WHERE linked_server_id IN ('server_lifecycle_stale', 'server_connection_changed')").run();
    await db.prepare("DELETE FROM linked_servers WHERE id IN ('server_unverified', 'server_lifecycle_stale', 'server_connection_changed')").run();
    assert.equal((await deleteOwnedAccountData(env, applicant.id)).ok, true);
    const accountDeletedRequest = await db.prepare("SELECT requester_user_id, requester_discord_id, requester_username FROM dzn_owner_discord_access_requests WHERE id = ?").bind(createdPayload.request.id).first<{ requester_user_id: string | null; requester_discord_id: string | null; requester_username: string | null }>();
    assert.equal(accountDeletedRequest?.requester_user_id, null, "Applicant account deletion must retain the decision record without its user foreign key.");
    assert.equal(accountDeletedRequest?.requester_discord_id, null, "Applicant account deletion must remove the Discord identity snapshot.");
    assert.equal(accountDeletedRequest?.requester_username, null, "Applicant account deletion must remove the username snapshot.");
    const accountDeletedAuditIdentity = await db.prepare("SELECT actor_user_id, actor_discord_id, actor_username FROM dzn_owner_discord_access_audit WHERE request_id = ? AND action = 'requested' LIMIT 1").bind(createdPayload.request.id).first<{ actor_user_id: string | null; actor_discord_id: string | null; actor_username: string | null }>();
    assert.equal(accountDeletedAuditIdentity?.actor_user_id, null, "Applicant account deletion must detach the request audit actor.");
    assert.equal(accountDeletedAuditIdentity?.actor_discord_id, null, "Applicant account deletion must remove Discord identity from the request audit.");
    assert.equal(accountDeletedAuditIdentity?.actor_username, null, "Applicant account deletion must remove the username from the request audit.");
    const accountDeletedAudit = await db.prepare("SELECT COUNT(*) AS count FROM dzn_owner_discord_access_audit WHERE request_id = ?").bind(createdPayload.request.id).first<{ count: number }>();
    assert.equal(Number(accountDeletedAudit?.count ?? 0) > 0, true, "Applicant account deletion must preserve private owner-access decision audits.");
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    console.log("Owner Discord access queue checks passed.");
  } finally { sqlite.close(); }
}

function request(method: "GET" | "POST", body?: unknown, token?: string, origin?: string, search = "") { const headers = new Headers(); if (token) headers.set("cookie", `dzn_session=${token}`); if (origin) headers.set("origin", origin); if (body !== undefined) headers.set("content-type", "application/json"); return new Request(`https://dzn.test/api/test${search}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
function context(env: Env, request: Request): PagesContext { return { env, request, params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 204 }) }; }
function splitSql(sql: string) { const statements: string[] = []; let buffer = ""; for (const line of sql.split(/\r?\n/)) { if (!buffer && !line.trim()) continue; buffer += `${line}\n`; if (/;\s*$/.test(line)) { statements.push(buffer.trim().replace(/;\s*$/, "")); buffer = ""; } } if (buffer.trim()) statements.push(buffer.trim()); return statements; }
void run();
