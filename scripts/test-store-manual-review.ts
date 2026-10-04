import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

import { createSession } from "../functions/_lib/db";
import { eraseOrRetainAccountUser } from "../functions/_lib/deletion";
import { listStoreManualReviewOrders, readStoreManualReviewAvatarSource, recordStoreManualReviewAction } from "../functions/_lib/store-manual-review";
import { onRequestGet, onRequestPost } from "../functions/api/owner/store/manual-review";
import { onRequestGet as onPageGet } from "../functions/owner/store/reconciliation";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

const owner: SessionUser = { id: "review_owner", discord_id: "831243159785701398", username: "Owner", avatar: null };
const buyer: SessionUser = { id: "review_buyer", discord_id: "111111111111111111", username: "Buyer", avatar: "buyer_avatar" };
const outsider: SessionUser = { id: "review_outsider", discord_id: "222222222222222222", username: "Outsider", avatar: null };

async function run() {
  const migration = readFileSync("migrations/0088_store_manual_review_audit.sql", "utf8");
  assert.match(migration, /store_commerce_manual_review_actions/);
  assert.match(migration, /BEFORE UPDATE ON store_commerce_manual_review_actions/);
  assert.match(migration, /BEFORE DELETE ON store_commerce_manual_review_actions/);
  assert.match(migration, /sequence INTEGER PRIMARY KEY AUTOINCREMENT/);
  assert.doesNotMatch(migration, /UPDATE\s+store_commerce_orders/i);

  const component = readFileSync("components/owner/store-manual-review-page.tsx", "utf8");
  assert.match(component, /Store review queue/);
  assert.match(component, /note[\s\S]*hold[\s\S]*escalate/);
  assert.match(component, /cannot fulfil, refund, dispute, or charge/);
  assert.match(component, /pendingActionKeys/);
  assert.match(component, /pendingActionKeys\.current\.get\(fingerprint\) \?\? crypto\.randomUUID\(\)/);
  assert.match(component, /payload && response\.status < 500/);
  assert.doesNotMatch(component, /stripe_payment_intent|stripe_checkout_session|refunds\.create|checkout\.sessions/);
  const avatarRoute = readFileSync("functions/api/owner/store/manual-review-avatar/[orderId].ts", "utf8");
  assert.match(avatarRoute, /redirect:\s*"error"/);
  assert.match(avatarRoute, /AbortSignal\.timeout\(5_000\)/);
  assert.match(avatarRoute, /MAX_AVATAR_BYTES/);

  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-05-08", d1Databases: ["DB"], d1Persist: false });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.prepare(`CREATE TABLE users (
      id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT, avatar TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).run();
    await db.prepare(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`).run();
    for (const user of [owner, buyer, outsider]) {
      await db.prepare("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)")
        .bind(user.id, user.discord_id, user.username, user.avatar).run();
    }
    for (const name of ["0081_store_catalog_foundation.sql", "0084_store_commerce_runtime.sql", "0088_store_manual_review_audit.sql"]) {
      await applyMigration(db as unknown as D1Database, name);
    }
    await seed(db as unknown as D1Database);

    const env = {
      DB: db as unknown as D1Database,
      DZN_STORE_ENABLED: "true",
      DZN_STORE_ADMIN_ENABLED: "true",
      DZN_PLATFORM_OWNER_DISCORD_IDS: owner.discord_id,
      SESSION_SECRET: "store-review-test-secret",
    } as Env;
    const ownerSession = await createSession(env, owner.id);
    const outsiderSession = await createSession(env, outsider.id);

    const anonymousPage = await onPageGet(context(env, request("GET")));
    assert.equal(anonymousPage.status, 302);
    const ownerPage = await onPageGet(context(env, request("GET", undefined, ownerSession.token), async () => new Response(null, { status: 204 })));
    assert.equal(ownerPage.status, 204);

    const anonymous = await onRequestGet(context(env, request("GET")));
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get("cache-control") ?? "", /private,\s*no-store/);
    assert.equal((await onRequestGet(context(env, request("GET", undefined, outsiderSession.token)))).status, 403);
    assert.equal((await onRequestGet(context({ ...env, DZN_STORE_ADMIN_ENABLED: "false" }, request("GET", undefined, ownerSession.token)))).status, 404);

    const response = await onRequestGet(context(env, request("GET", undefined, ownerSession.token)));
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.doesNotMatch(text, /pi_|cs_|evt_review_001|discord_id|stripe_payment_intent|stripe_checkout_session/);
    const payload = JSON.parse(text) as { items: Array<Record<string, unknown>>; safety: Record<string, boolean> };
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0]?.customer_username, "Buyer");
    assert.equal(payload.items[0]?.customer_avatar, "/api/owner/store/manual-review-avatar/order_review_001");
    assert.equal(await readStoreManualReviewAvatarSource(env, "order_review_001"), "https://cdn.discordapp.com/avatars/111111111111111111/buyer_avatar.webp?size=128");
    assert.equal(payload.items[0]?.latest_event_type, "checkout.session.completed");
    assert.deepEqual(payload.safety, {
      platformOwnerOnly: true,
      paymentStateMutable: false,
      fulfilmentStateMutable: false,
      providerCalls: false,
      rawStripeReferencesExposed: false,
    });

    const search = await listStoreManualReviewOrders(env, { query: "Founding", mode: "test", limit: 1 });
    assert.equal(search.ok, true);
    if (!search.ok) throw new Error("Expected Store review search to pass");
    assert.equal(search.items.length, 1);
    assert.equal((await listStoreManualReviewOrders(env, { query: "x".repeat(81) })).status, 400);
    assert.equal((await listStoreManualReviewOrders(env, { mode: "production" })).status, 400);
    assert.equal((await listStoreManualReviewOrders(env, { cursor: "invalid" })).status, 400);

    const body = { orderId: "order_review_001", requestKey: "review-request-0001", action: "hold", reason: "Waiting for provider evidence.", evidenceCategory: "payment_state_mismatch" };
    assert.equal((await recordStoreManualReviewAction(env, owner, { ...body, requestKey: "review-sensitive-01", reason: "Provider pi_12345 must be checked." })).status, 400);
    assert.equal((await recordStoreManualReviewAction(env, owner, { ...body, requestKey: "review-sensitive-02", reason: "Discord account 111111111111111111 needs checking." })).status, 400);
    assert.equal((await recordStoreManualReviewAction(env, owner, { ...body, requestKey: "review-sensitive-03", reason: "Dispute dp_12345 must be checked." })).status, 400);
    assert.equal((await recordStoreManualReviewAction(env, owner, { ...body, requestKey: "review-sensitive-04", reason: "Refund re_12345 must be checked." })).status, 400);
    assert.equal((await onRequestPost(context(env, request("POST", body, ownerSession.token)))).status, 403);
    assert.equal((await onRequestPost(context(env, request("POST", body, ownerSession.token, "https://evil.example")))).status, 403);
    const recorded = await onRequestPost(context(env, request("POST", body, ownerSession.token, "https://dzn.test")));
    assert.equal(recorded.status, 201);
    assert.doesNotMatch(await recorded.text(), /actor_user_id|review_owner/);
    assert.equal((await db.prepare("SELECT status FROM store_commerce_orders WHERE id = ?").bind(body.orderId).first<{ status: string }>())?.status, "manual_review");
    assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM store_commerce_manual_review_actions").first<{ total: number }>())?.total, 1);
    const duplicate = await recordStoreManualReviewAction(env, owner, body);
    assert.equal(duplicate.ok, true);
    if (!duplicate.ok) throw new Error("Expected idempotent review replay");
    assert.equal(duplicate.duplicate, true);
    assert.equal((await recordStoreManualReviewAction(env, owner, { ...body, action: "escalate" })).status, 409);

    const second = await recordStoreManualReviewAction(env, owner, { ...body, requestKey: "review-request-0002", action: "note", reason: "Second same-second action is newest." });
    assert.equal(second.status, 201);
    const ordered = await listStoreManualReviewOrders(env);
    assert.equal(ordered.ok, true);
    if (!ordered.ok) throw new Error("Expected ordered Store review queue");
    assert.equal(ordered.items[0]?.latest_action_reason, "Second same-second action is newest.");

    const retainedActor = await recordStoreManualReviewAction(env, outsider, { ...body, requestKey: "review-request-actor", action: "note", reason: "Independent operator annotation." });
    assert.equal(retainedActor.status, 201);
    assert.equal(await eraseOrRetainAccountUser(db as unknown as D1Database, outsider.id), 1);
    const anonymizedActor = await db.prepare("SELECT discord_id, username, avatar FROM users WHERE id = ?").bind(outsider.id)
      .first<{ discord_id: string; username: string | null; avatar: string | null }>();
    assert.match(anonymizedActor?.discord_id ?? "", /^deleted-[0-9a-f-]{36}$/);
    assert.equal(anonymizedActor?.username, null);
    assert.equal(anonymizedActor?.avatar, null);
    assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM store_commerce_manual_review_actions WHERE actor_user_id = ?").bind(outsider.id)
      .first<{ total: number }>())?.total, 1);

    await assert.rejects(() => db.prepare("UPDATE store_commerce_manual_review_actions SET reason = 'Changed' WHERE request_key = ?").bind(body.requestKey).run(), /immutable/i);
    await assert.rejects(() => db.prepare("DELETE FROM store_commerce_manual_review_actions WHERE request_key = ?").bind(body.requestKey).run(), /immutable/i);
    await db.prepare("UPDATE store_commerce_orders SET status = 'refunded' WHERE id = ?").bind(body.orderId).run();
    const stale = await recordStoreManualReviewAction(env, owner, { ...body, requestKey: "review-request-0003", action: "note" });
    assert.equal(stale.status, 409);
    assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM store_commerce_manual_review_actions").first<{ total: number }>())?.total, 3);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    console.log("Store manual-review queue checks passed.");
  } finally {
    await mf.dispose();
  }
}

async function seed(db: D1Database) {
  await db.prepare(`INSERT INTO store_products (id, product_key, name, description, product_type, fulfilment_kind, created_by_user_id, updated_by_user_id)
    VALUES ('product_review','founding-supporter','Founding Supporter','Account-bound supporter recognition.','supporter_pack','supporter_card',?,?)`).bind(owner.id, owner.id).run();
  await db.prepare("INSERT INTO store_prices (id, product_id, unit_amount_minor, created_by_user_id) VALUES ('price_review','product_review',1200,?)").bind(owner.id).run();
  await db.prepare(`INSERT INTO store_catalog_publications (id, product_id, price_id, stripe_price_id, stripe_mode, livemode, status, active, published_by_user_id, published_at)
    VALUES ('publication_review','product_review','price_review','price_test_review','test',0,'published',1,?,CURRENT_TIMESTAMP)`).bind(owner.id).run();
  await db.prepare(`INSERT INTO store_commerce_orders (id, order_number, purchasing_user_id, publication_id, request_key, status, stripe_mode, livemode, subtotal_amount_minor, total_amount_minor, reservation_expires_at, immutable_item_snapshot_json)
    VALUES ('order_review_001','DZN-REVIEW-001',?,'publication_review','buyer-review-0001','manual_review','test',0,1200,1200,'2026-10-05T00:00:00.000Z','{}')`).bind(buyer.id).run();
  await db.prepare(`INSERT INTO store_commerce_order_items (id, order_id, product_id, price_id, product_key, product_name, fulfilment_kind, unit_amount_minor, total_amount_minor)
    VALUES ('item_review_001','order_review_001','product_review','price_review','founding-supporter','Founding Supporter','supporter_card',1200,1200)`).run();
  await db.prepare(`INSERT INTO store_commerce_events (id, stripe_event_id, order_id, event_type, livemode, raw_body_sha256, processing_status, safe_summary_json)
    VALUES ('event_review_001','evt_review_001','order_review_001','checkout.session.completed',0,?,'manual_review','{"eventType":"checkout.session.completed","orderLinked":true,"livemode":false}')`).bind("a".repeat(64)).run();
}

function request(method: "GET" | "POST", body?: unknown, token?: string, origin?: string) {
  const headers = new Headers();
  if (token) headers.set("cookie", `dzn_session=${token}`);
  if (origin) headers.set("origin", origin);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request("https://dzn.test/api/owner/store/manual-review", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function context(env: Env, requestValue: Request, next: PagesContext["next"] = async () => new Response(null, { status: 404 })): PagesContext {
  return { env, request: requestValue, params: {}, waitUntil: () => undefined, next, data: {} };
}

async function applyMigration(db: D1Database, name: string) {
  const sql = readFileSync(`migrations/${name}`, "utf8").replace(/^--.*$/gm, "");
  for (const statement of splitSql(sql)) await db.prepare(statement).run();
}

function splitSql(sql: string) {
  const statements: string[] = [];
  let buffer = "";
  let trigger = false;
  for (const line of sql.split(/\r?\n/)) {
    if (!buffer && !line.trim()) continue;
    buffer += `${line}\n`;
    if (/^\s*CREATE\s+TRIGGER\b/i.test(buffer)) trigger = true;
    if (trigger ? /^\s*END;\s*$/i.test(line) : /;\s*$/.test(line)) {
      statements.push(buffer.trim().replace(/;\s*$/, ""));
      buffer = "";
      trigger = false;
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
