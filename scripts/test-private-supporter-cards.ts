import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

import {
  configuredStoreLivemode,
  privateSupporterCardsEnabled,
  readPrivateStoreSupporterCards,
} from "../functions/_lib/store-entitlements";
import { onRequest as supporterCardsHandler } from "../functions/api/player/supporter-cards";
import type { Env, PagesFunction } from "../functions/_lib/types";

const route = readFileSync("functions/api/player/supporter-cards.ts", "utf8");
const component = readFileSync("components/player/private-supporter-cards.tsx", "utf8");
const profile = readFileSync("components/player/player-home.tsx", "utf8");

assert.equal(privateSupporterCardsEnabled({}), false);
assert.equal(privateSupporterCardsEnabled({ DZN_STORE_ENABLED: "true", DZN_STORE_COMMERCE_ENABLED: "true", DZN_SUPPORTER_CARDS_PRIVATE_ENABLED: "true" }), true);
assert.equal(configuredStoreLivemode({ STRIPE_SECRET_KEY: "sk_test_example" }), false);
assert.equal(configuredStoreLivemode({ STRIPE_SECRET_KEY: "sk_live_example" }), true);
assert.equal(configuredStoreLivemode({}), null);
assert.match(route, /getSessionUser/);
assert.match(route, /request\.method !== "GET" && request\.method !== "HEAD"/);
assert.match(route, /request\.method === "HEAD"/);
assert.match(route, /privateNoStoreHeaders\(\)/);
assert.match(route, /scope: "current_user"/);
assert.doesNotMatch(route, /stripe_payment_intent|stripe_checkout_session|entitlement_key/);
assert.match(component, /Reveal my cards/);
assert.match(component, /method: "HEAD"/);
assert.match(component, /if \(!available\) return null/);
assert.match(component, /credentials: "include"/);
assert.match(component, /cache: "no-store"/);
assert.doesNotMatch(component, /localStorage|sessionStorage|navigator\.share|navigator\.clipboard|sendBeacon|analytics/i);
assert.match(profile, /showPrivateSupporterCards/);

async function run() {
  const disabledResponse = await callSupporterCards(new Request("https://dzn.test/api/player/supporter-cards"), {} as Env);
  assert.equal(disabledResponse.status, 404);
  assert.deepEqual(await disabledResponse.json(), { ok: false, error: "SUPPORTER_CARDS_UNAVAILABLE" });

  const methodResponse = await callSupporterCards(new Request("https://dzn.test/api/player/supporter-cards", { method: "POST" }), {} as Env);
  assert.equal(methodResponse.status, 405);
  assert.deepEqual(await methodResponse.json(), { error: "Method not allowed" });

  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-05-08", d1Databases: ["DB"], d1Persist: false });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.prepare(`CREATE TABLE users (
      id TEXT PRIMARY KEY, discord_id TEXT UNIQUE NOT NULL, username TEXT, avatar TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).run();
    await db.prepare(`CREATE TABLE discord_guilds (
      id TEXT PRIMARY KEY, guild_id TEXT UNIQUE NOT NULL, owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL, icon TEXT, icon_url TEXT, permissions TEXT, is_owner INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).run();
    for (const name of ["0081_store_catalog_foundation.sql", "0082_store_order_inventory_foundation.sql", "0083_store_fulfilment_receipt_foundation.sql", "0084_store_commerce_runtime.sql"]) {
      await apply(db as unknown as D1Database, name);
    }
    await db.prepare("INSERT INTO users (id, discord_id, username) VALUES ('buyer','100000000000000001','Buyer'),('other','100000000000000002','Other')").run();
    await db.prepare(`INSERT INTO store_products (id, product_key, name, description, product_type, fulfilment_kind, created_by_user_id, updated_by_user_id)
      VALUES ('product','founding-supporter','Founding Supporter','Account-bound recognition.','supporter_pack','supporter_card','buyer','buyer')`).run();
    await db.prepare("INSERT INTO store_prices (id, product_id, unit_amount_minor, created_by_user_id) VALUES ('price','product',1200,'buyer')").run();
    await db.prepare(`INSERT INTO store_catalog_publications (id, product_id, price_id, stripe_price_id, stripe_mode, livemode, status, active, published_by_user_id, published_at)
      VALUES ('publication','product','price','price_test_private','test',0,'published',1,'buyer',CURRENT_TIMESTAMP)`).run();
    await db.prepare(`INSERT INTO store_commerce_orders (id, order_number, purchasing_user_id, publication_id, request_key, status, stripe_mode, livemode, subtotal_amount_minor, total_amount_minor, reservation_expires_at, stock_reservation_state, immutable_item_snapshot_json, fulfilled_at)
      VALUES ('order','DZN-S-PRIVATE-001','buyer','publication','private-request-0001','fulfilled','test',0,1200,1200,'2026-10-03T00:00:00.000Z','converted','{}','2026-10-02T20:00:00.000Z')`).run();
    await db.prepare(`INSERT INTO store_commerce_order_items (id, order_id, product_id, price_id, product_key, product_name, fulfilment_kind, unit_amount_minor, total_amount_minor)
      VALUES ('item','order','product','price','founding-supporter','Founding Supporter','supporter_card',1200,1200)`).run();
    await db.prepare(`INSERT INTO store_commerce_fulfilments (id, order_id, purchasing_user_id, fulfilment_kind, status, entitlement_key, granted_at)
      VALUES ('fulfilment','order','buyer','supporter_card','completed','private-entitlement','2026-10-02T20:00:00.000Z')`).run();
    await db.prepare(`INSERT INTO store_commerce_entitlements (id, fulfilment_id, order_id, purchasing_user_id, product_key, fulfilment_kind, entitlement_key, status, granted_at)
      VALUES ('entitlement','fulfilment','order','buyer','founding-supporter','supporter_card','private-entitlement','active','2026-10-02T20:00:00.000Z')`).run();
    await db.prepare(`INSERT INTO store_commerce_receipts (id, receipt_number, order_id, purchasing_user_id, status, subtotal_amount_minor, tax_amount_minor, total_amount_minor, seller_snapshot_json, issued_at)
      VALUES ('receipt','DZN-R-PRIVATE001','order','buyer','issued',1200,0,1200,'{}','2026-10-02T20:00:00.000Z')`).run();

    assert.deepEqual(await readPrivateStoreSupporterCards(db as unknown as D1Database, "buyer", false), [{
      product_key: "founding-supporter",
      product_name: "Founding Supporter",
      granted_at: "2026-10-02T20:00:00.000Z",
      order_number: "DZN-S-PRIVATE-001",
      receipt_number: "DZN-R-PRIVATE001",
      receipt_status: "issued",
    }]);
    assert.equal((await readPrivateStoreSupporterCards(db as unknown as D1Database, "other", false)).length, 0);
    assert.equal((await readPrivateStoreSupporterCards(db as unknown as D1Database, "buyer", true)).length, 0);
    await db.prepare("UPDATE store_commerce_entitlements SET status = 'reversed', reversed_at = CURRENT_TIMESTAMP WHERE id = 'entitlement'").run();
    assert.equal((await readPrivateStoreSupporterCards(db as unknown as D1Database, "buyer", false)).length, 0);

    const enabledEnv = {
      DB: db as unknown as D1Database,
      DZN_STORE_ENABLED: "true",
      DZN_STORE_COMMERCE_ENABLED: "true",
      DZN_SUPPORTER_CARDS_PRIVATE_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_fixture",
    } as Env;
    const unauthorizedResponse = await callSupporterCards(new Request("https://dzn.test/api/player/supporter-cards"), enabledEnv);
    assert.equal(unauthorizedResponse.status, 401);
    assert.deepEqual(await unauthorizedResponse.json(), { ok: false, error: "UNAUTHORIZED" });

    const mockEnv = { ...enabledEnv, MOCK_AUTH: "true" } as Env;
    const headResponse = await callSupporterCards(new Request("https://dzn.test/api/player/supporter-cards", { method: "HEAD" }), mockEnv);
    assert.equal(headResponse.status, 204);
    assert.equal(await headResponse.text(), "");
    assert.match(headResponse.headers.get("cache-control") ?? "", /private/);

    const getResponse = await callSupporterCards(new Request("https://dzn.test/api/player/supporter-cards"), mockEnv);
    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), {
      ok: true,
      private: true,
      scope: "current_user",
      cards: [],
      safety: {
        read_only: true,
        current_user_only: true,
        internal_ids_exposed: false,
        stripe_references_exposed: false,
        payment_details_exposed: false,
        public_profile_changed: false,
        competitive_effect: false,
      },
    });
  } finally {
    await mf.dispose();
  }
  console.log("Private Supporter Card tests passed.");
}

async function callSupporterCards(request: Request, env: Env) {
  return supporterCardsHandler(makeContext(supporterCardsHandler, request, env)) as Promise<Response>;
}

function makeContext(handler: PagesFunction, request: Request, env: Env): Parameters<typeof handler>[0] {
  return {
    request,
    env,
    params: {},
    waitUntil() {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
  };
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

run().catch((error) => { console.error(error); process.exitCode = 1; });
