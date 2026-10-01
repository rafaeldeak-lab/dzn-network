import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

import {
  createStoreCatalogDraft,
  listStoreCatalogDrafts,
  storeDraftAdminEnabled,
} from "../functions/_lib/store-catalog-admin";
import { createSession } from "../functions/_lib/db";
import {
  onRequestGet as onStoreCatalogGet,
  onRequestPost as onStoreCatalogPost,
} from "../functions/api/owner/store/catalog";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

const actor: SessionUser = {
  id: "user_store_owner",
  discord_id: "831243159785701398",
  username: "store-owner",
  avatar: null,
};

const nonOwner: SessionUser = {
  id: "user_store_non_owner",
  discord_id: "111111111111111111",
  username: "store-non-owner",
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
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.prepare(`CREATE TABLE users (
        id TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        avatar TEXT
      )`).run();
    await db.prepare(`CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`).run();
    await db.prepare("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)")
      .bind(actor.id, actor.discord_id, actor.username, actor.avatar).run();
    await db.prepare("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)")
      .bind(nonOwner.id, nonOwner.discord_id, nonOwner.username, nonOwner.avatar).run();
    const migration = readFileSync("migrations/0081_store_catalog_foundation.sql", "utf8").replace(/^--.*$/gm, "");
    for (const statement of migration.split(/;\s*(?:\r?\n|$)/).map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
    const env = {
      DB: db as unknown as D1Database,
      DZN_STORE_ENABLED: "true",
      DZN_STORE_ADMIN_ENABLED: "true",
      DZN_PLATFORM_OWNER_DISCORD_IDS: actor.discord_id,
      SESSION_SECRET: "store-admin-test-secret",
    } as Env;

    const ownerSession = await createSession(env, actor.id);
    const nonOwnerSession = await createSession(env, nonOwner.id);

    const anonymous = await onStoreCatalogGet(context(env, request("GET")));
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get("cache-control") ?? "", /private,\s*no-store/);

    const forbidden = await onStoreCatalogGet(context(env, request("GET", undefined, nonOwnerSession.token)));
    assert.equal(forbidden.status, 403);

    const disabled = await onStoreCatalogGet(context(
      { ...env, DZN_STORE_ADMIN_ENABLED: "false" },
      request("GET", undefined, ownerSession.token),
    ));
    assert.equal(disabled.status, 404);
    const storeDisabled = await onStoreCatalogGet(context(
      { ...env, DZN_STORE_ENABLED: "false" },
      request("GET", undefined, ownerSession.token),
    ));
    assert.equal(storeDisabled.status, 404);

    const authorizedEmpty = await onStoreCatalogGet(context(env, request("GET", undefined, ownerSession.token)));
    assert.equal(authorizedEmpty.status, 200);
    assert.deepEqual(((await authorizedEmpty.json()) as { products: unknown[] }).products, []);

    const crossOrigin = await onStoreCatalogPost(context(env, request("POST", validInput, ownerSession.token, "https://evil.example")));
    assert.equal(crossOrigin.status, 403);
    assert.equal((await db.prepare("SELECT count(*) AS total FROM store_products").first<{ total: number }>())?.total, 0);

    assert.equal(storeDraftAdminEnabled({ ...env, DZN_STORE_ADMIN_ENABLED: "false" }), false);
    assert.equal(storeDraftAdminEnabled({ ...env, DZN_STORE_ENABLED: "false" }), false);
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

    const routeCreated = await onStoreCatalogPost(context(env, request("POST", {
      product: { ...validInput.product, productKey: "dzn-route-supporter-pack" },
      price: validInput.price,
    }, ownerSession.token)));
    assert.equal(routeCreated.status, 201);
    const routePayload = await routeCreated.json() as Record<string, unknown>;
    assert.equal(routePayload.storeActive, false);
    assert.equal(routePayload.checkoutEnabled, false);
    assert.equal(routePayload.paymentsEnabled, false);

    const firstPage = await listStoreCatalogDrafts(env, { limit: 1 });
    assert.equal(firstPage.ok, true);
    if (!firstPage.ok) throw new Error("Expected first Store draft page to pass.");
    assert.equal(firstPage.products.length, 1);
    assert.equal(firstPage.prices.length, 1);
    assert.equal(firstPage.prices[0]?.product_id, firstPage.products[0]?.id);
    assert.equal(firstPage.page.hasMore, true);
    assert.ok(firstPage.page.nextCursor);

    const secondPage = await listStoreCatalogDrafts(env, { limit: 1, cursor: firstPage.page.nextCursor });
    assert.equal(secondPage.ok, true);
    if (!secondPage.ok) throw new Error("Expected second Store draft page to pass.");
    assert.equal(secondPage.products.length, 1);
    assert.equal(secondPage.prices.length, 1);
    assert.equal(secondPage.prices[0]?.product_id, secondPage.products[0]?.id);
    assert.notEqual(secondPage.products[0]?.id, firstPage.products[0]?.id);

    const invalidCursor = await listStoreCatalogDrafts(env, { cursor: "not-a-cursor" });
    assert.equal(invalidCursor.ok, false);
    if (invalidCursor.ok) throw new Error("Expected invalid Store cursor to fail.");
    assert.equal(invalidCursor.status, 400);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    console.log("Store catalog admin checks passed.");
  } finally {
    await mf.dispose();
  }
}

function request(method: "GET" | "POST", body?: unknown, token?: string, origin?: string) {
  const headers = new Headers();
  if (token) headers.set("cookie", `dzn_session=${token}`);
  if (origin) headers.set("origin", origin);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request("https://dzn.test/api/owner/store/catalog", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function context(env: Env, requestValue: Request): PagesContext {
  return {
    env,
    request: requestValue,
    params: {},
    waitUntil: () => undefined,
    next: async () => new Response(null, { status: 404 }),
    data: {},
  };
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
