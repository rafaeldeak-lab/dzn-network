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
  assert.match(migration, /trg_store_commerce_reserved_stock_guard/);
  assert.match(migration, /trg_store_commerce_reserved_stock_sale/);
  assert.match(migration, /trg_store_commerce_dispute_restoration_stock_guard/);
  assert.match(migration, /trg_store_commerce_dispute_restoration_stock_sale/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS store_commerce_entitlements/);
  assert.match(migration, /no_competitive_advantage INTEGER NOT NULL DEFAULT 1 CHECK \(no_competitive_advantage = 1\)/);

  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-08", d1Databases: ["DB"], d1Persist: false });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.prepare("CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT, username TEXT, avatar TEXT)").run();
    await db.prepare(`INSERT INTO users (id, discord_id, username) VALUES
      ('owner','100000000000000001','owner'),('buyer','100000000000000002','buyer'),
      ('buyer-two','100000000000000003','buyer-two'),('buyer-three','100000000000000004','buyer-three'),
      ('buyer-four','100000000000000005','buyer-four'),('buyer-five','100000000000000006','buyer-five')`).run();
    for (const name of ["0081_store_catalog_foundation.sql", "0082_store_order_inventory_foundation.sql",
      "0083_store_fulfilment_receipt_foundation.sql", "0084_store_commerce_runtime.sql"]) await apply(db, name);
    const env = { DB: db as unknown as D1Database, DZN_STORE_ENABLED: "true", DZN_STORE_ADMIN_ENABLED: "true",
      DZN_STORE_COMMERCE_ENABLED: "true", DZN_STORE_PUBLIC_ENABLED: "true", DZN_STORE_CHECKOUT_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_store_test_key", DZN_APP_URL: "https://dayz-network.com",
      STRIPE_STORE_WEBHOOK_SECRET: "whsec_store_test", DZN_BILLING_SELLER_NAME: "DZN Network",
      DZN_BILLING_SUPPORT_EMAIL: "support@example.test" } as unknown as Env;

    await db.prepare(`INSERT INTO store_products (id, product_key, name, description, product_type, fulfilment_kind,
      created_by_user_id, updated_by_user_id) VALUES ('product','founding-supporter','Founding Supporter',
      'Permanent account-bound supporter recognition.', 'supporter_pack', 'supporter_card', 'owner', 'owner')`).run();
    await db.prepare("INSERT INTO store_prices (id, product_id, unit_amount_minor, created_by_user_id) VALUES ('price','product',1200,'owner')").run();

    const approved = await publishStoreProduct(env, owner, { productId: "product", priceId: "price",
      stripePriceId: "price_test_supporter", stockLimit: 1, lifetimeLimit: 1, publish: false }, {
        retrievePrice: async () => ({ id: "price_test_supporter", active: true, currency: "gbp",
          unit_amount: 1200, livemode: false, type: "one_time" }),
      });
    assert.equal(approved.ok, true);
    if (!approved.ok) throw new Error("Approval failed");
    assert.equal(approved.publication.active, false);
    const published = await publishStoreProduct(env, owner, { productId: "product", priceId: "price",
      stripePriceId: "price_test_supporter", stockLimit: 1, lifetimeLimit: 1, publish: true }, {
        retrievePrice: async () => ({ id: "price_test_supporter", active: true, currency: "gbp",
          unit_amount: 1200, livemode: false, type: "one_time" }),
      });
    assert.equal(published.ok, true);
    if (!published.ok) throw new Error("Publication failed");
    assert.equal(published.status, 200);
    assert.equal(published.publication.id, approved.publication.id);
    assert.deepEqual(await db.prepare("SELECT stripe_mode, livemode FROM store_catalog_publications").first(), {
      stripe_mode: "test", livemode: 0,
    });
    const catalog = await listPublishedStore(env);
    assert.equal(catalog.ok, true);
    if (!catalog.ok) throw new Error("Catalog failed");
    assert.equal(catalog.products.length, 1);
    const noWebhookCatalog = await listPublishedStore({ ...env, STRIPE_STORE_WEBHOOK_SECRET: undefined } as unknown as Env);
    assert.equal(noWebhookCatalog.ok, true);
    if (!noWebhookCatalog.ok) throw new Error("Catalog without webhook failed");
    assert.equal(noWebhookCatalog.checkoutEnabled, false);

    let checkoutCreates = 0;
    const checkoutNow = new Date();
    const expiresAt = Math.floor(checkoutNow.getTime() / 1000) + 1800;
    const checkout = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), buyer,
      { publicationId: published.publication.id, requestKey: "buyer-request-0001" }, {
        createId: sequence(["orderid", "itemid", "numberid"]),
        now: checkoutNow,
        createCheckout: async (params) => {
          checkoutCreates += 1;
          assert.equal(params["line_items[0][price]"], "price_test_supporter");
          assert.equal(params["payment_method_types[0]"], "card");
          assert.equal(params["adaptive_pricing[enabled]"], "false");
          assert.equal(params.payment_method_collection, "always");
          assert.equal(params.expires_at, expiresAt);
          assert.equal(params["payment_intent_data[metadata][dzn_store_order_id]"], "store_order_orderid");
          assert.equal(params.success_url, "https://dayz-network.com/store?store=success&order=store_order_orderid");
          return { id: "cs_test_checkout001", url: "https://checkout.stripe.com/c/pay/test_checkout001", status: "open",
            mode: "payment", livemode: false, client_reference_id: "store_order_orderid", expires_at: expiresAt,
            metadata: { dzn_store_order_id: "store_order_orderid", dzn_store_user_id: buyer.id } };
        },
      });
    assert.equal(checkout.ok, true);
    assert.equal(checkoutCreates, 1);
    assert.deepEqual(await db.prepare(`SELECT reservation_expires_at, checkout_url_expires_at
      FROM store_commerce_orders WHERE id = 'store_order_orderid'`).first(), {
      reservation_expires_at: new Date(expiresAt * 1000).toISOString(),
      checkout_url_expires_at: new Date(expiresAt * 1000).toISOString(),
    });
    assert.equal((await db.prepare("SELECT reserved_quantity FROM store_catalog_publications").first<{ reserved_quantity: number }>())?.reserved_quantity, 1);

    const resumed = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), buyer,
      { publicationId: published.publication.id, requestKey: "buyer-request-0001" }, {
        retrieveCheckout: async () => ({ id: "cs_test_checkout001", url: "https://checkout.stripe.com/c/pay/test_checkout001",
          status: "open", mode: "payment", livemode: false, client_reference_id: "store_order_orderid", expires_at: expiresAt,
          metadata: { dzn_store_order_id: "store_order_orderid" } }),
      });
    assert.equal(resumed.ok, true);
    assert.equal(checkoutCreates, 1);

    await db.prepare("UPDATE store_commerce_orders SET status = 'expired' WHERE id = 'store_order_orderid'").run();
    assert.equal((await db.prepare("SELECT reserved_quantity FROM store_catalog_publications").first<{ reserved_quantity: number }>())?.reserved_quantity, 0);

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

    const disputed = event("evt_dispute_created", "charge.dispute.created", {
      id: "dp_test_001", object: "dispute", payment_intent: "pi_test_001", status: "needs_response", amount: 1200,
    });
    assert.deepEqual(await reconcileStoreWebhook(env, disputed, JSON.stringify(disputed)), {
      duplicate: false, processingStatus: "processed",
    });
    assert.equal((await db.prepare("SELECT status FROM store_commerce_orders").first<{ status: string }>())?.status, "disputed");
    assert.equal((await db.prepare("SELECT status FROM store_commerce_entitlements").first<{ status: string }>())?.status, "reversed");

    const disputeWon = event("evt_dispute_won", "charge.dispute.closed", {
      id: "dp_test_001", object: "dispute", payment_intent: "pi_test_001", status: "won",
    });
    assert.deepEqual(await reconcileStoreWebhook(env, disputeWon, JSON.stringify(disputeWon)), {
      duplicate: false, processingStatus: "processed",
    });
    assert.equal((await db.prepare("SELECT status FROM store_commerce_orders").first<{ status: string }>())?.status, "fulfilled");
    assert.equal((await db.prepare("SELECT status, reversed_at FROM store_commerce_entitlements").first<{ status: string; reversed_at: string | null }>())?.status, "active");
    assert.equal((await db.prepare("SELECT reversed_at FROM store_commerce_entitlements").first<{ reversed_at: string | null }>())?.reversed_at, null);
    assert.equal((await db.prepare("SELECT status FROM store_commerce_receipts").first<{ status: string }>())?.status, "issued");

    const partialDispute = event("evt_partial_dispute", "charge.dispute.created", {
      id: "dp_test_partial", object: "dispute", payment_intent: "pi_test_001", status: "needs_response", amount: 600,
    });
    assert.deepEqual(await reconcileStoreWebhook(env, partialDispute, JSON.stringify(partialDispute)), {
      duplicate: false, processingStatus: "manual_review",
    });
    assert.equal((await db.prepare("SELECT status FROM store_commerce_orders").first<{ status: string }>())?.status, "manual_review");
    assert.equal((await db.prepare("SELECT status FROM store_commerce_entitlements").first<{ status: string }>())?.status, "active");
    assert.equal((await db.prepare("SELECT status FROM store_commerce_receipts").first<{ status: string }>())?.status, "issued");

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

    await testRefundBeforeCompletion(db, env, published.publication.id);

    await testEarlyDisputeWon(db, env, published.publication.id);

    await testWarningClosedRestoresPurchase(db, env, published.publication.id);

    await testFavorableCloseBeforeDisputeCreated(db, env, published.publication.id);

    await testWonDisputeCapacityConflict(db, env, published.publication.id);

    await testLatePaymentStockConflict(db, env, published.publication.id);

    await testAtomicLimitAndReservationExpiry(db, env, published.publication.id);

    await testMismatchedPaidSessionReview(db, env, published.publication.id);

    await testPublicationModeIsolation(db, env);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    console.log("Store commerce runtime checks passed.");
  } finally { await mf.dispose(); }
}

async function testEarlyDisputeWon(db: D1Database, env: Env, publicationId: string) {
  const thirdBuyer: SessionUser = { id: "buyer-three", discord_id: "100000000000000004", username: "buyer-three", avatar: null };
  await db.prepare("UPDATE store_catalog_publications SET stock_limit = 5, sold_quantity = 0 WHERE id = ?").bind(publicationId).run();
  const expiresAt = Math.floor(Date.now() / 1000) + 1800;
  const checkout = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), thirdBuyer,
    { publicationId, requestKey: "early-dispute-won-0001" }, {
      createId: sequence(["disputeorder", "disputeitem", "disputenumber"]),
      createCheckout: async () => ({ id: "cs_test_earlydispute", url: "https://checkout.stripe.com/c/pay/test_earlydispute",
        status: "open", mode: "payment", livemode: false, client_reference_id: "store_order_disputeorder", expires_at: expiresAt,
        metadata: { dzn_store_order_id: "store_order_disputeorder", dzn_store_user_id: thirdBuyer.id } }),
    });
  assert.equal(checkout.ok, true);
  const disputed = event("evt_early_dispute", "charge.dispute.created", {
    id: "dp_test_early", object: "dispute", payment_intent: "pi_test_earlydispute", status: "needs_response", amount: 1200,
    metadata: { dzn_store_order_id: "store_order_disputeorder" },
  });
  assert.deepEqual(await reconcileStoreWebhook(env, disputed, JSON.stringify(disputed)), {
    duplicate: false, processingStatus: "processed",
  });
  assert.equal((await db.prepare("SELECT status FROM store_commerce_orders WHERE id = 'store_order_disputeorder'").first<{ status: string }>())?.status, "disputed");
  assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM store_commerce_fulfilments WHERE order_id = 'store_order_disputeorder'").first<{ total: number }>())?.total, 0);
  const won = event("evt_early_dispute_won", "charge.dispute.closed", {
    id: "dp_test_early", object: "dispute", payment_intent: "pi_test_earlydispute", status: "won",
  });
  assert.deepEqual(await reconcileStoreWebhook(env, won, JSON.stringify(won)), {
    duplicate: false, processingStatus: "processed",
  });
  assert.equal((await db.prepare("SELECT status FROM store_commerce_orders WHERE id = 'store_order_disputeorder'").first<{ status: string }>())?.status, "fulfilled");
  assert.equal((await db.prepare("SELECT status FROM store_commerce_fulfilments WHERE order_id = 'store_order_disputeorder'").first<{ status: string }>())?.status, "completed");
  assert.equal((await db.prepare("SELECT status FROM store_commerce_entitlements WHERE order_id = 'store_order_disputeorder'").first<{ status: string }>())?.status, "active");
  assert.equal((await db.prepare("SELECT status FROM store_commerce_receipts WHERE order_id = 'store_order_disputeorder'").first<{ status: string }>())?.status, "issued");
  assert.equal((await db.prepare("SELECT sold_quantity FROM store_catalog_publications WHERE id = ?").bind(publicationId).first<{ sold_quantity: number }>())?.sold_quantity, 1);
}

async function testWarningClosedRestoresPurchase(db: D1Database, env: Env, publicationId: string) {
  const user: SessionUser = { id: "buyer-four", discord_id: "100000000000000005", username: "buyer-four", avatar: null };
  await db.prepare("UPDATE store_catalog_publications SET stock_limit = 5, sold_quantity = 0 WHERE id = ?").bind(publicationId).run();
  const expiresAt = Math.floor(Date.now() / 1000) + 1800;
  const checkout = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), user,
    { publicationId, requestKey: "warning-closed-0001" }, {
      createId: sequence(["warningorder", "warningitem", "warningnumber"]),
      createCheckout: async () => ({ id: "cs_test_warningclosed", url: "https://checkout.stripe.com/c/pay/test_warningclosed",
        status: "open", mode: "payment", livemode: false, client_reference_id: "store_order_warningorder", expires_at: expiresAt,
        metadata: { dzn_store_order_id: "store_order_warningorder", dzn_store_user_id: user.id } }),
    });
  assert.equal(checkout.ok, true);
  const completion = event("evt_warning_completion", "checkout.session.completed", {
    id: "cs_test_warningclosed", object: "checkout.session", client_reference_id: "store_order_warningorder",
    payment_intent: "pi_test_warningclosed", payment_status: "paid", amount_total: 1200, currency: "gbp",
    metadata: { dzn_store_order_id: "store_order_warningorder" },
  });
  assert.equal((await reconcileStoreWebhook(env, completion, JSON.stringify(completion))).processingStatus, "processed");
  const disputed = event("evt_warning_dispute", "charge.dispute.created", {
    id: "dp_test_warningclosed", object: "dispute", payment_intent: "pi_test_warningclosed", status: "warning_needs_response", amount: 1200,
  });
  assert.equal((await reconcileStoreWebhook(env, disputed, JSON.stringify(disputed))).processingStatus, "processed");
  const warningClosed = event("evt_warning_closed", "charge.dispute.closed", {
    id: "dp_test_warningclosed", object: "dispute", payment_intent: "pi_test_warningclosed", status: "warning_closed",
  });
  assert.deepEqual(await reconcileStoreWebhook(env, warningClosed, JSON.stringify(warningClosed)), {
    duplicate: false, processingStatus: "processed",
  });
  assert.equal((await db.prepare("SELECT status FROM store_commerce_orders WHERE id = 'store_order_warningorder'")
    .first<{ status: string }>())?.status, "fulfilled");
  assert.equal((await db.prepare("SELECT status FROM store_commerce_entitlements WHERE order_id = 'store_order_warningorder'")
    .first<{ status: string }>())?.status, "active");
  assert.equal((await db.prepare("SELECT status FROM store_commerce_receipts WHERE order_id = 'store_order_warningorder'")
    .first<{ status: string }>())?.status, "issued");
}

async function testFavorableCloseBeforeDisputeCreated(db: D1Database, env: Env, publicationId: string) {
  const user: SessionUser = { id: "buyer-five", discord_id: "100000000000000006", username: "buyer-five", avatar: null };
  await db.prepare("UPDATE store_catalog_publications SET stock_limit = 5, sold_quantity = 0 WHERE id = ?").bind(publicationId).run();
  const expiresAt = Math.floor(Date.now() / 1000) + 1800;
  const checkout = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), user,
    { publicationId, requestKey: "out-of-order-dispute-0001" }, {
      createId: sequence(["outoforder", "outoforderitem", "outofordernumber"]),
      createCheckout: async () => ({ id: "cs_test_outoforder", url: "https://checkout.stripe.com/c/pay/test_outoforder",
        status: "open", mode: "payment", livemode: false, client_reference_id: "store_order_outoforder", expires_at: expiresAt,
        metadata: { dzn_store_order_id: "store_order_outoforder", dzn_store_user_id: user.id } }),
    });
  assert.equal(checkout.ok, true);
  const completion = event("evt_outoforder_completion", "checkout.session.completed", {
    id: "cs_test_outoforder", object: "checkout.session", client_reference_id: "store_order_outoforder",
    payment_intent: "pi_test_outoforder", payment_status: "paid", amount_total: 1200, currency: "gbp",
    metadata: { dzn_store_order_id: "store_order_outoforder" },
  });
  assert.equal((await reconcileStoreWebhook(env, completion, JSON.stringify(completion))).processingStatus, "processed");
  const closed = event("evt_outoforder_closed", "charge.dispute.closed", {
    id: "dp_test_outoforder", object: "dispute", payment_intent: "pi_test_outoforder", status: "won",
  });
  assert.equal((await reconcileStoreWebhook(env, closed, JSON.stringify(closed))).processingStatus, "processed");
  const created = event("evt_outoforder_created", "charge.dispute.created", {
    id: "dp_test_outoforder", object: "dispute", payment_intent: "pi_test_outoforder", status: "needs_response", amount: 1200,
  });
  assert.equal((await reconcileStoreWebhook(env, created, JSON.stringify(created))).processingStatus, "processed");
  assert.equal((await db.prepare("SELECT status FROM store_commerce_orders WHERE id = 'store_order_outoforder'")
    .first<{ status: string }>())?.status, "fulfilled");
  assert.equal((await db.prepare("SELECT status FROM store_commerce_entitlements WHERE order_id = 'store_order_outoforder'")
    .first<{ status: string }>())?.status, "active");
  assert.equal((await db.prepare("SELECT status FROM store_commerce_receipts WHERE order_id = 'store_order_outoforder'")
    .first<{ status: string }>())?.status, "issued");
  const summary = await db.prepare("SELECT safe_summary_json FROM store_commerce_events WHERE stripe_event_id = 'evt_outoforder_closed'")
    .first<{ safe_summary_json: string }>();
  assert.deepEqual(JSON.parse(summary?.safe_summary_json ?? "{}"), {
    eventType: "charge.dispute.closed", orderLinked: true, livemode: false,
    dispute: { id: "dp_test_outoforder", outcome: "won" },
    providerReferences: { session: true, paymentIntent: true },
  });
}

async function testLatePaymentStockConflict(db: D1Database, env: Env, publicationId: string) {
  const secondBuyer: SessionUser = { id: "buyer-two", discord_id: "100000000000000003", username: "buyer-two", avatar: null };
  await db.prepare("UPDATE store_catalog_publications SET stock_limit = 2, sold_quantity = 0 WHERE id = ?").bind(publicationId).run();
  const expiresAt = Math.floor(Date.now() / 1000) + 1800;
  const checkout = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), secondBuyer,
    { publicationId, requestKey: "late-stock-conflict-0001" }, {
      createId: sequence(["lateorder", "lateitem", "latenumber"]),
      createCheckout: async () => ({ id: "cs_test_lateconflict", url: "https://checkout.stripe.com/c/pay/test_lateconflict",
        status: "open", mode: "payment", livemode: false, client_reference_id: "store_order_lateorder", expires_at: expiresAt,
        metadata: { dzn_store_order_id: "store_order_lateorder", dzn_store_user_id: secondBuyer.id } }),
    });
  assert.equal(checkout.ok, true);
  await db.prepare("UPDATE store_commerce_orders SET status = 'expired' WHERE id = 'store_order_lateorder'").run();
  await db.prepare("UPDATE store_catalog_publications SET stock_limit = 1, sold_quantity = 1 WHERE id = ?").bind(publicationId).run();
  const completed = event("evt_late_stock_conflict", "checkout.session.completed", {
    id: "cs_test_lateconflict", object: "checkout.session", client_reference_id: "store_order_lateorder",
    payment_intent: "pi_test_lateconflict", payment_status: "paid", amount_total: 1200, currency: "gbp",
    metadata: { dzn_store_order_id: "store_order_lateorder" },
  });
  assert.deepEqual(await reconcileStoreWebhook(env, completed, JSON.stringify(completed)), {
    duplicate: false, processingStatus: "manual_review",
  });
  assert.deepEqual(await db.prepare("SELECT status, stripe_payment_intent_id FROM store_commerce_orders WHERE id = 'store_order_lateorder'").first(), {
    status: "manual_review", stripe_payment_intent_id: "pi_test_lateconflict",
  });
  assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM store_commerce_entitlements WHERE order_id = 'store_order_lateorder'").first<{ total: number }>())?.total, 0);
}

async function testWonDisputeCapacityConflict(db: D1Database, env: Env, publicationId: string) {
  await db.prepare("UPDATE store_catalog_publications SET stock_limit = 2, sold_quantity = 0 WHERE id = ?").bind(publicationId).run();
  const expiresAt = Math.floor(Date.now() / 1000) + 1800;
  const checkout = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), owner,
    { publicationId, requestKey: "won-capacity-conflict-0001" }, {
      createId: sequence(["woncapacityorder", "woncapacityitem", "woncapacitynumber"]),
      createCheckout: async () => ({ id: "cs_test_woncapacity", url: "https://checkout.stripe.com/c/pay/test_woncapacity",
        status: "open", mode: "payment", livemode: false, client_reference_id: "store_order_woncapacityorder", expires_at: expiresAt,
        metadata: { dzn_store_order_id: "store_order_woncapacityorder", dzn_store_user_id: owner.id } }),
    });
  assert.equal(checkout.ok, true);
  const disputed = event("evt_won_capacity_dispute", "charge.dispute.created", {
    id: "dp_test_woncapacity", object: "dispute", payment_intent: "pi_test_woncapacity", status: "needs_response", amount: 1200,
    metadata: { dzn_store_order_id: "store_order_woncapacityorder" },
  });
  assert.equal((await reconcileStoreWebhook(env, disputed, JSON.stringify(disputed))).processingStatus, "processed");
  await db.prepare("UPDATE store_catalog_publications SET stock_limit = 1, sold_quantity = 1 WHERE id = ?").bind(publicationId).run();
  const won = event("evt_won_capacity_closed", "charge.dispute.closed", {
    id: "dp_test_woncapacity", object: "dispute", payment_intent: "pi_test_woncapacity", status: "won",
  });
  assert.deepEqual(await reconcileStoreWebhook(env, won, JSON.stringify(won)), {
    duplicate: false, processingStatus: "manual_review",
  });
  assert.equal((await db.prepare("SELECT status FROM store_commerce_orders WHERE id = 'store_order_woncapacityorder'")
    .first<{ status: string }>())?.status, "manual_review");
  assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM store_commerce_fulfilments WHERE order_id = 'store_order_woncapacityorder'")
    .first<{ total: number }>())?.total, 0);
}

async function testMismatchedPaidSessionReview(db: D1Database, env: Env, publicationId: string) {
  await db.prepare("UPDATE store_catalog_publications SET stock_limit = 5, sold_quantity = 0 WHERE id = ?").bind(publicationId).run();
  const expiresAt = Math.floor(Date.now() / 1000) + 1800;
  const checkout = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), buyer,
    { publicationId, requestKey: "mismatched-paid-0001" }, {
      createId: sequence(["mismatchorder", "mismatchitem", "mismatchnumber"]),
      createCheckout: async () => ({ id: "cs_test_mismatch", url: "https://checkout.stripe.com/c/pay/test_mismatch",
        status: "open", mode: "payment", livemode: false, client_reference_id: "store_order_mismatchorder", expires_at: expiresAt,
        metadata: { dzn_store_order_id: "store_order_mismatchorder", dzn_store_user_id: buyer.id } }),
    });
  assert.equal(checkout.ok, true);
  const completed = event("evt_mismatched_paid", "checkout.session.completed", {
    id: "cs_test_mismatch", object: "checkout.session", client_reference_id: "store_order_mismatchorder",
    payment_intent: "pi_test_mismatch", payment_status: "paid", amount_total: 1199, currency: "gbp",
    metadata: { dzn_store_order_id: "store_order_mismatchorder" },
  });
  assert.deepEqual(await reconcileStoreWebhook(env, completed, JSON.stringify(completed)), {
    duplicate: false, processingStatus: "manual_review",
  });
  const order = await db.prepare(`SELECT status, stripe_payment_intent_id, paid_at
    FROM store_commerce_orders WHERE id = 'store_order_mismatchorder'`).first<{
      status: string; stripe_payment_intent_id: string | null; paid_at: string | null;
    }>();
  assert.equal(order?.status, "manual_review");
  assert.equal(order?.stripe_payment_intent_id, "pi_test_mismatch");
  assert.ok(order?.paid_at);
}

async function testPublicationModeIsolation(db: D1Database, env: Env) {
  const liveEnv = { ...env, STRIPE_SECRET_KEY: "sk_live_store_live_key" } as unknown as Env;
  const livePublication = await publishStoreProduct(liveEnv, owner, { productId: "product", priceId: "price",
    stripePriceId: "price_live_supporter", stockLimit: 5, lifetimeLimit: 1, publish: true }, {
      retrievePrice: async () => ({ id: "price_live_supporter", active: true, currency: "gbp",
        unit_amount: 1200, livemode: true, type: "one_time" }),
    });
  assert.equal(livePublication.ok, true);
  assert.deepEqual(await db.prepare("SELECT stripe_mode, livemode FROM store_catalog_publications WHERE stripe_price_id = 'price_live_supporter'").first(), {
    stripe_mode: "live", livemode: 1,
  });
  const testCatalog = await listPublishedStore(env);
  const liveCatalog = await listPublishedStore(liveEnv);
  assert.equal(testCatalog.ok && testCatalog.products.length, 1);
  assert.equal(liveCatalog.ok && liveCatalog.products.length, 1);
}

async function testRefundBeforeCompletion(db: D1Database, env: Env, publicationId: string) {
  const secondBuyer: SessionUser = { id: "buyer-two", discord_id: "100000000000000003", username: "buyer-two", avatar: null };
  await db.prepare("UPDATE store_catalog_publications SET stock_limit = 3, sold_quantity = 0 WHERE id = ?").bind(publicationId).run();
  const expiresAt = Math.floor(Date.now() / 1000) + 1800;
  const checkout = await createOrResumeStoreCheckout(env, new Request("https://dayz-network.com/api/store/orders"), secondBuyer,
    { publicationId, requestKey: "refund-first-0001" }, {
      createId: sequence(["refundorder", "refunditem", "refundnumber"]),
      createCheckout: async () => ({ id: "cs_test_refundfirst", url: "https://checkout.stripe.com/c/pay/test_refundfirst",
        status: "open", mode: "payment", livemode: false, client_reference_id: "store_order_refundorder", expires_at: expiresAt,
        metadata: { dzn_store_order_id: "store_order_refundorder", dzn_store_user_id: secondBuyer.id } }),
    });
  assert.equal(checkout.ok, true);
  const refunded = event("evt_refund_before_completion", "charge.refunded", {
    id: "ch_test_refundfirst", object: "charge", payment_intent: "pi_test_refundfirst", refunded: true,
    amount_refunded: 1200, metadata: { dzn_store_order_id: "store_order_refundorder" },
  });
  assert.deepEqual(await reconcileStoreWebhook(env, refunded, JSON.stringify(refunded)), {
    duplicate: false, processingStatus: "processed",
  });
  assert.equal((await db.prepare("SELECT status FROM store_commerce_orders WHERE id = 'store_order_refundorder'").first<{ status: string }>())?.status, "refunded");
  const completion = event("evt_completion_after_refund", "checkout.session.completed", {
    id: "cs_test_refundfirst", object: "checkout.session", client_reference_id: "store_order_refundorder",
    payment_intent: "pi_test_refundfirst", payment_status: "paid", amount_total: 1200, currency: "gbp",
    metadata: { dzn_store_order_id: "store_order_refundorder" },
  });
  assert.deepEqual(await reconcileStoreWebhook(env, completion, JSON.stringify(completion)), {
    duplicate: false, processingStatus: "ignored",
  });
  assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM store_commerce_entitlements WHERE order_id = 'store_order_refundorder'").first<{ total: number }>())?.total, 0);
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
