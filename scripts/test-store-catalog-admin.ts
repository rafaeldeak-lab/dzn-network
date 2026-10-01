import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

import {
  createStoreCatalogDraft,
  listStoreCatalogDrafts,
  storeDraftAdminEnabled,
} from "../functions/_lib/store-catalog-admin";
import type { Env, SessionUser } from "../functions/_lib/types";

const actor: SessionUser = {
  id: "user_store_owner",
  discord_id: "831243159785701398",
  username: "store-owner",
  avatar: null,
};

const validInput = {
  product: {
    productKey: "dzn-founding-supporter-pack",
    name: "DZN Founding Supporter Pack",
    description: "Permanent account-bound profile cosmetics and supporter recognition.",
    productType: "supporter_pack",
    fulfilmentKind: "supporter_card",
  },
  price: { currency: "gbp", unitAmountMinor: 1000 },
};

async function run() {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('local test'); } }",
    compatibilityDate: "2026-05-08",
    d1Databases: ["DB"],
    d1Persist: false,
  });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec("PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY);");
    await db.prepare("INSERT INTO users (id) VALUES (?)").bind(actor.id).run();
    const migration = readFileSync("migrations/0081_store_catalog_foundation.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of migration.split(/;\s*(?:\r?\n|$)/).map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
    const env = {
      DB: db as unknown as D1Database,
      DZN_STORE_ENABLED: "true",
      DZN_STORE_ADMIN_ENABLED: "true",
    } as Env;

    assert.equal(storeDraftAdminEnabled({ ...env, DZN_STORE_ADMIN_ENABLED: "false" }), false);
    assert.equal(storeDraftAdminEnabled(env), true);

    const unsafe = await createStoreCatalogDraft(env, actor, {
      ...validInput,
      product: { ...validInput.product, name: "XP Pack" },
    });
    assert.equal(unsafe.ok, false);
    assert.equal((await db.prepare("SELECT count(*) AS total FROM store_products").first<{ total: number }>())?.total, 0);

    const created = await createStoreCatalogDraft(env, actor, validInput);
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error("Expected Store draft creation to pass.");
    assert.equal(created.product.active, false);
    assert.equal(created.product.noCompetitiveAdvantage, true);
    assert.equal(created.price.active, false);
    assert.equal(created.price.stripePriceId, null);

    const stored = await db.prepare(`SELECT active, account_bound, guaranteed_purchase,
      no_competitive_advantage, grants_spins, grants_xp, grants_rank_advantage,
      grants_event_advantage, grants_competitive_eligibility, metadata_json
      FROM store_products WHERE id = ?`).bind(created.product.id).first<Record<string, unknown>>();
    assert.deepEqual(stored, {
      active: 0,
      account_bound: 1,
      guaranteed_purchase: 1,
      no_competitive_advantage: 1,
      grants_spins: 0,
      grants_xp: 0,
      grants_rank_advantage: 0,
      grants_event_advantage: 0,
      grants_competitive_eligibility: 0,
      metadata_json: "{}",
    });

    const duplicate = await createStoreCatalogDraft(env, actor, validInput);
    assert.equal(duplicate.ok, false);
    if (duplicate.ok) throw new Error("Expected duplicate Store key to fail.");
    assert.equal(duplicate.status, 409);
    assert.equal((await db.prepare("SELECT count(*) AS total FROM store_products").first<{ total: number }>())?.total, 1);
    assert.equal((await db.prepare("SELECT count(*) AS total FROM store_prices").first<{ total: number }>())?.total, 1);

    const listed = await listStoreCatalogDrafts(env);
    assert.equal(listed.ok, true);
    if (!listed.ok) throw new Error("Expected Store draft listing to pass.");
    assert.equal(listed.products.length, 1);
    assert.equal(listed.prices.length, 1);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    console.log("Store catalog admin checks passed.");
  } finally {
    await mf.dispose();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
