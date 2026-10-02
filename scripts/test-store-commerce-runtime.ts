import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

import {
  createOrResumeStoreCheckout,
  listPublishedStore,
  listStorePurchases,
  publishStoreProduct,
  reconcileStoreWebhook,
} from "../functions/_lib/store-commerce";
import type { Env, SessionUser } from "../functions/_lib/types";
import type { StripeEvent } from "../functions/_lib/stripe";

const owner: SessionUser = { id: "owner", discord_id: "100000000000000001", username: "owner", avatar: null };
const buyer: SessionUser = { id: "buyer", discord_id: "100000000000000002", username: "buyer", avatar: null };

async function run() {
  const migration = readFileSync("migrations/0084_store_commerce_runtime.sql", "utf8");
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE|ALTER TABLE/i);
  assert.match(migration, /trg_store_commerce_order_stock_guard/);
  assert.match(migration, /trg_store_commerce_events_immutable/);
  assert.match(migration, /trg_store_commerce_order_lifetime_limit/);
  assert.match(migration, /trg_store_commerce_order_release_stock/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS store_commerce_entitlements/);
  assert.match(migration, /no_competitive_advantage INTEGER NOT NULL DEFAULT 1 CHECK \(no_competitive_advantage = 1\)/);

  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-08", d1Databases: ["DB"], d1Persist: false });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.prepare("CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT, username TEXT, avatar TEXT)").run();
    await db.prepare("INSERT INTO users (id, discord_id, username) VALUES ('owner','100000000000000001','owner'),('buyer','100000000000000002','buyer')").run();
    for (const name of ["0081_store_catalog_foundation.sql", "0082_store_order_inventory_foundation.sql",
      "0083_store_fulfilment_receipt_foundation.sql", "0084_store_commerce_runtime.sql"]) await apply(db, name);
    const env = { DB: db as unknown as D1Database, DZN_STORE_ENABLED: "true", DZN_STORE_ADMIN_ENABLED: "true",
      DZN_STORE_COMMERCE_ENABLED: "true", DZN_STORE_PUBLIC_ENABLED: "true", DZN_STORE_CHECKOUT_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_store_test_key", DZN_APP_URL: "https://dayz-network.com",
      DZN_BILLING_SELLER_NAME: "DZN Network", DZN_BILLING_SUPPORT_EMAIL: "support@example.test" } as unknown as Env;

    await db.prepare(`INSERT INTO store_products (id, product_key, name, description, product_type, fulfilment_kind,
      created_by_user_id, updated_by_user_id) VALUES ('product','founding-supporter','Founding Supporter',
      'Permanent account-bound supporter recognition.', 'supporter_pack', 'supporter_card', 'owner', 'owner')`).run();
    await db.prepare("INSERT INTO store_prices (id, product_id, unit_amount_minor, created_by_user_id) VALUES ('price','product',1200,'owner')").run();

    const published = await publishStoreProduct(env, owner, { productId: "product", priceId: "price",
      stripePriceId: "price_test_supporter", stockLimit: 1, lifetimeLimit: 1, publish: true }, {
        retrievePrice: async () => ({ id: "price_test_supporter", active: true, currency: "gbp",
          unit_amount: 1200, livemode: false, type: "one_time" }),
      });
    assert.equal(published.ok, true);
    if (!published.ok) throw new Error("Publication failed");
    const catalog = await listPublishedStore(env);
    assert.equal(catalog.ok, true);
    if (!catalog.ok) throw new Error("Catalog failed");
    assert.equal(catalog.products.length, 1);

    let checkoutCreates = 0;
    const expiresAt = Math.floor(Date.now() / 1000) + 1800;
    const checkout = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), buyer,
      { publicationId: published.publication.id, requestKey: "buyer-request-0001" }, {
        createId: sequence(["orderid", "itemid", "numberid"]),
        createCheckout: async (params) => {
          checkoutCreates += 1;
          assert.equal(params["line_items[0][price]"], "price_test_supporter");
          assert.equal(params["payment_method_types[0]"], "card");
          assert.equal(params["adaptive_pricing[enabled]"], "false");
          assert.equal(params.payment_method_collection, "always");
          return { id: "cs_test_checkout001", url: "https://checkout.stripe.com/c/pay/test_checkout001", status: "open",
            mode: "payment", livemode: false, client_reference_id: "store_order_orderid", expires_at: expiresAt,
            metadata: { dzn_store_order_id: "store_order_orderid", dzn_store_user_id: buyer.id } };
        },
      });
    assert.equal(checkout.ok, true);
    assert.equal(checkoutCreates, 1);
    assert.equal((await db.prepare("SELECT reserved_quantity FROM store_catalog_publications").first<{ reserved_quantity: number }>())?.reserved_quantity, 1);

    const resumed = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), buyer,
      { publicationId: published.publication.id, requestKey: "buyer-request-0001" }, {
        retrieveCheckout: async () => ({ id: "cs_test_checkout001", url: "https://checkout.stripe.com/c/pay/test_checkout001",
          status: "open", mode: "payment", livemode: false, client_reference_id: "store_order_orderid", expires_at: expiresAt,
          metadata: { dzn_store_order_id: "store_order_orderid" } }),
      });
    assert.equal(resumed.ok, true);
    assert.equal(checkoutCreates, 1);

    const completed = event("evt_completed", "checkout.session.completed", {
      id: "cs_test_checkout001", object: "checkout.session", client_reference_id: "store_order_orderid",
      payment_intent: "pi_test_001", payment_status: "paid", amount_total: 1200, currency: "gbp",
      metadata: { dzn_store_order_id: "store_order_orderid" },
    });
    assert.deepEqual(await reconcileStoreWebhook(env, completed, JSON.stringify(completed)), { duplicate: false, processingStatus: "processed" });
    assert.deepEqual(await reconcileStoreWebhook(env, completed, JSON.stringify(completed)), { duplicate: true });
    assert.equal((await db.prepare("SELECT status FROM store_commerce_orders").first<{ status: string }>())?.status, "fulfilled");
    assert.deepEqual(await db.prepare("SELECT reserved_quantity, sold_quantity FROM store_catalog_publications").first(), { reserved_quantity: 0, sold_quantity: 1 });
    assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM store_commerce_receipts").first<{ total: number }>())?.total, 1);
    assert.deepEqual(await db.prepare("SELECT entitlement_key, status FROM store_commerce_entitlements").first(), {
      entitlement_key: "dzn_store_founding-supporter_store_order_orderid", status: "active",
    });
    assert.equal((await listStorePurchases(env, buyer)).purchases.length, 1);

    const second = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), buyer,
      { publicationId: published.publication.id, requestKey: "buyer-request-0002" });
    assert.equal(second.ok, false);
    if (second.ok) throw new Error("Purchase limit was not enforced");
    assert.equal(second.error, "PRODUCT_NOT_AVAILABLE");

    const partialRefund = event("evt_partial_refund", "charge.refunded", {
      id: "ch_test_001", object: "charge", payment_intent: "pi_test_001", refunded: false, amount_refunded: 600,
      metadata: { dzn_store_order_id: "store_order_orderid" },
    });
    assert.deepEqual(await reconcileStoreWebhook(env, partialRefund, JSON.stringify(partialRefund)), {
      duplicate: false, processingStatus: "manual_review",
    });
    assert.equal((await db.prepare("SELECT status FROM store_commerce_orders").first<{ status: string }>())?.status, "manual_review");
    assert.equal((await db.prepare("SELECT status FROM store_commerce_entitlements").first<{ status: string }>())?.status, "active");

    const refunded = event("evt_refunded", "charge.refunded", {
      id: "ch_test_001", object: "charge", payment_intent: "pi_test_001", refunded: true, amount_refunded: 1200,
      metadata: { dzn_store_order_id: "store_order_orderid" },
    });
    await reconcileStoreWebhook(env, refunded, JSON.stringify(refunded));
    assert.equal((await db.prepare("SELECT status FROM store_commerce_orders").first<{ status: string }>())?.status, "refunded");
    assert.equal((await db.prepare("SELECT status FROM store_commerce_fulfilments").first<{ status: string }>())?.status, "reversed");
    assert.equal((await db.prepare("SELECT status FROM store_commerce_entitlements").first<{ status: string }>())?.status, "reversed");
    assert.equal((await db.prepare("SELECT status FROM store_commerce_receipts").first<{ status: string }>())?.status, "refunded");

    await testAtomicLimitAndReservationExpiry(db, env, published.publication.id);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    console.log("Store commerce runtime checks passed.");
  } finally { await mf.dispose(); }
}

async function testAtomicLimitAndReservationExpiry(db: D1Database, env: Env, publicationId: string) {
  await db.prepare("UPDATE store_catalog_publications SET stock_limit = 3, sold_quantity = 0 WHERE id = ?").bind(publicationId).run();
  await db.prepare("UPDATE store_commerce_orders SET status = 'refunded' WHERE purchasing_user_id = 'buyer'").run();
  const first = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), buyer,
    { publicationId, requestKey: "buyer-expiring-0001" }, {
      now: new Date("2026-10-02T00:00:00.000Z"), createId: sequence(["expiryorder", "expiryitem", "expirynumber"]),
      createCheckout: async () => { throw new Error("provider unavailable"); },
    });
  assert.equal(first.ok, false);
  assert.equal((await db.prepare("SELECT reserved_quantity FROM store_catalog_publications").first<{ reserved_quantity: number }>())?.reserved_quantity, 1);
  const blocked = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), buyer,
    { publicationId, requestKey: "buyer-expiring-0002" }, { now: new Date("2026-10-02T00:10:00.000Z") });
  assert.equal(blocked.ok, false);
  if (blocked.ok) throw new Error("Atomic lifetime limit was not enforced");
  assert.equal(blocked.error, "PURCHASE_LIMIT_REACHED");
  await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), buyer,
    { publicationId, requestKey: "buyer-expiring-0003" }, { now: new Date("2026-10-02T00:31:00.000Z"),
      createId: sequence(["afterexpiry", "afteritem", "afternumber"]), createCheckout: async () => { throw new Error("stop"); } });
  assert.equal((await db.prepare("SELECT status FROM store_commerce_orders WHERE request_key = 'buyer-expiring-0001'").first<{ status: string }>())?.status, "expired");
}

async function apply(db: D1Database, name: string) {
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
function sequence(values: string[]) { let index = 0; return () => values[index++] ?? `extra${index}`; }
function event(id: string, type: string, object: Record<string, unknown>): StripeEvent {
  return { id, type, livemode: false, data: { object } };
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
