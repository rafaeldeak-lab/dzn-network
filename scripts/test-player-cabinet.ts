import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

import {
  playerCabinetPublicShowcaseLimit,
  readPlayerCabinetSupporterCards,
  readPublicSelectedStoreSupporterCards,
  setPlayerCabinetSupporterCardVisibility,
} from "../functions/_lib/store-entitlements";

const migration = readFileSync("migrations/0115_player_cabinet_showcase.sql", "utf8");
const route = readFileSync("functions/api/player/cabinet.ts", "utf8");
const component = readFileSync("components/player/player-cabinet.tsx", "utf8");
const publicProfileHelper = readFileSync("functions/_lib/player-public-profiles.ts", "utf8");
const publicProfileComponent = readFileSync("components/player/public-player-profile.tsx", "utf8");
const packageJson = readFileSync("package.json", "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS player_cabinet_showcase_items/);
assert.match(migration, /UNIQUE\(user_id, entitlement_key\)/);
assert.match(migration, /publicly_showcased INTEGER NOT NULL DEFAULT 0/);
assert.match(migration, /FOREIGN KEY\(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
assert.doesNotMatch(migration, /\b(?:DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE\s+(?:player_profiles|player_stats|kill_events|player_events|server_stats|leaderboards|server_reviews|badge_awards|dzn_seasons|server_war_events|competitive_events|account_entitlements|supporter_cards|earned_spins|spin_ledger|linked_servers|nitrado_connections))\b/i);
assert.match(route, /getSessionUser/);
assert.match(route, /request\.method !== "GET" && request\.method !== "HEAD" && request\.method !== "PATCH"/);
assert.match(route, /isSameOriginMutation/);
assert.match(route, /CABINET_CARD_NOT_OWNED/);
assert.match(route, /CABINET_SHOWCASE_LIMIT/);
assert.match(component, /My Player Cabinet/);
assert.match(component, /Open cabinet/);
assert.match(component, /Public on profile/);
assert.match(component, /credentials: "include"/);
assert.doesNotMatch(component, /localStorage|sessionStorage|navigator\.share|navigator\.clipboard|sendBeacon|analytics/i);
assert.match(publicProfileHelper, /readPublicSelectedStoreSupporterCards/);
assert.match(publicProfileComponent, /Selected from cabinet/);
assert.match(packageJson, /"test:player-cabinet": "tsx scripts\/test-player-cabinet\.ts"/);

async function run() {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-08",
    d1Databases: ["DB"],
    d1Persist: false,
  });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.prepare(`CREATE TABLE users (
      id TEXT PRIMARY KEY, discord_id TEXT UNIQUE NOT NULL, username TEXT, avatar TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).run();
    for (const name of [
      "0081_store_catalog_foundation.sql",
      "0082_store_order_inventory_foundation.sql",
      "0083_store_fulfilment_receipt_foundation.sql",
      "0084_store_commerce_runtime.sql",
      "0115_player_cabinet_showcase.sql",
    ]) await apply(db as unknown as D1Database, name);

    await db.prepare("INSERT INTO users (id, discord_id, username) VALUES ('buyer','100000000000000001','Buyer'),('other','100000000000000002','Other')").run();
    await db.prepare(`INSERT INTO store_products (id, product_key, name, description, product_type, fulfilment_kind, created_by_user_id, updated_by_user_id)
      VALUES ('product','dzn-first-edition-supporter-card','DZN First Edition Supporter Card','Permanent account-bound supporter card.','supporter_pack','supporter_card','buyer','buyer')`).run();
    await db.prepare("INSERT INTO store_prices (id, product_id, unit_amount_minor, created_by_user_id) VALUES ('price','product',200,'buyer')").run();
    await db.prepare(`INSERT INTO store_catalog_publications (id, product_id, price_id, stripe_price_id, stripe_mode, livemode, status, active, published_by_user_id, published_at)
      VALUES ('publication','product','price','price_test_cabinet','test',0,'published',1,'buyer',CURRENT_TIMESTAMP)`).run();
    await db.prepare(`INSERT INTO store_commerce_orders (id, order_number, purchasing_user_id, publication_id, request_key, status, stripe_mode, livemode, subtotal_amount_minor, total_amount_minor, reservation_expires_at, stock_reservation_state, immutable_item_snapshot_json, fulfilled_at)
      VALUES ('order','DZN-S-CABINET-001','buyer','publication','cabinet-request-0001','fulfilled','test',0,200,200,'2026-10-03T00:00:00.000Z','converted','{}','2026-10-02T20:00:00.000Z')`).run();
    await db.prepare(`INSERT INTO store_commerce_order_items (id, order_id, product_id, price_id, product_key, product_name, fulfilment_kind, unit_amount_minor, total_amount_minor)
      VALUES ('item','order','product','price','dzn-first-edition-supporter-card','DZN First Edition Supporter Card','supporter_card',200,200)`).run();
    await db.prepare(`INSERT INTO store_commerce_fulfilments (id, order_id, purchasing_user_id, fulfilment_kind, status, entitlement_key, granted_at)
      VALUES ('fulfilment','order','buyer','supporter_card','completed','cabinet-entitlement','2026-10-02T20:00:00.000Z')`).run();
    await db.prepare(`INSERT INTO store_commerce_entitlements (id, fulfilment_id, order_id, purchasing_user_id, product_key, fulfilment_kind, entitlement_key, status, granted_at)
      VALUES ('entitlement','fulfilment','order','buyer','dzn-first-edition-supporter-card','supporter_card','cabinet-entitlement','active','2026-10-02T20:00:00.000Z')`).run();

    assert.equal(playerCabinetPublicShowcaseLimit, 4);
    assert.deepEqual(await readPlayerCabinetSupporterCards(db as unknown as D1Database, "buyer", false), [{
      product_key: "dzn-first-edition-supporter-card",
      product_name: "DZN First Edition Supporter Card",
      granted_at: "2026-10-02T20:00:00.000Z",
      entitlement_key: "cabinet-entitlement",
      publicly_showcased: false,
    }]);
    assert.equal((await readPublicSelectedStoreSupporterCards(db as unknown as D1Database, "buyer", false)).length, 0, "Nothing is public until the player selects it.");
    assert.deepEqual(
      await setPlayerCabinetSupporterCardVisibility(db as unknown as D1Database, "buyer", false, "cabinet-entitlement", true),
      {
        status: "updated",
        card: {
          product_key: "dzn-first-edition-supporter-card",
          product_name: "DZN First Edition Supporter Card",
          granted_at: "2026-10-02T20:00:00.000Z",
          entitlement_key: "cabinet-entitlement",
          publicly_showcased: true,
        },
      },
    );
    assert.deepEqual(await readPublicSelectedStoreSupporterCards(db as unknown as D1Database, "buyer", false), [{
      product_key: "dzn-first-edition-supporter-card",
      product_name: "DZN First Edition Supporter Card",
      granted_at: "2026-10-02T20:00:00.000Z",
    }]);
    assert.deepEqual(await setPlayerCabinetSupporterCardVisibility(db as unknown as D1Database, "other", false, "cabinet-entitlement", true), { status: "not_owned" });
    await db.prepare("UPDATE store_commerce_entitlements SET status = 'reversed', reversed_at = CURRENT_TIMESTAMP WHERE id = 'entitlement'").run();
    assert.equal((await readPublicSelectedStoreSupporterCards(db as unknown as D1Database, "buyer", false)).length, 0, "A reversed entitlement must immediately leave the public profile.");
  } finally {
    await mf.dispose();
  }
  console.log("Player Cabinet tests passed.");
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

void run().catch((error) => { console.error(error); process.exitCode = 1; });
