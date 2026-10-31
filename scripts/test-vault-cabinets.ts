import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { legacySupporterCatalog, type PublicVaultResponse, type VaultCabinetResponse, type VaultSlots } from "../lib/vault";
import { onRequest as playerRoute } from "../functions/api/player/vault";
import { onRequest as serverRoute } from "../functions/api/servers/[serverId]/vault";
import { onRequest as publicPlayerRoute } from "../functions/api/public/players/[handle]/vault";
import { onRequest as publicServerRoute } from "../functions/api/public/servers/[serverId]/vault";
import { vaultStoreMode } from "../functions/_lib/vault";
import { deleteOwnedLinkedServerData, eraseOrRetainAccountUser } from "../functions/_lib/deletion";
import type { Env, PagesFunction } from "../functions/_lib/types";
import { createVaultLocalFixture, seedVaultPurchase, VAULT_LOCAL, vaultLocalEnv } from "./lib/vault-local";

const origin = "https://dzn.test";
const playerPath = "/api/player/vault";
const serverPath = `/api/servers/${VAULT_LOCAL.serverId}/vault`;
const publicPlayerPath = `/api/public/players/${VAULT_LOCAL.handle}/vault`;
const publicServerPath = `/api/public/servers/${VAULT_LOCAL.serverId}/vault`;
const playerCookie = `dzn_session=${VAULT_LOCAL.playerToken}`;
const otherCookie = `dzn_session=${VAULT_LOCAL.otherToken}`;

function request(path = playerPath, options: {
  method?: string; body?: unknown; cookie?: string | null; origin?: string | null;
  contentType?: string; rawBody?: string;
} = {}) {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.cookie !== null) headers.cookie = options.cookie ?? playerCookie;
  if (method !== "GET" && method !== "HEAD") {
    if (options.origin !== null) headers.origin = options.origin ?? origin;
    headers["content-type"] = options.contentType ?? "application/json";
  }
  return new Request(`${origin}${path}`, {
    method, headers,
    ...(method !== "GET" && method !== "HEAD" ? { body: options.rawBody ?? JSON.stringify(options.body ?? {}) } : {}),
  });
}

function call(handler: PagesFunction, req: Request, env: Env, params: Record<string, string> = {}) {
  return Promise.resolve(handler({ request: req, env, params, data: {}, next: async () => new Response(null, { status: 404 }), waitUntil() {} }));
}
async function cabinet(response: Response): Promise<VaultCabinetResponse> {
  const value = await response.json() as VaultCabinetResponse;
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
  assert.equal(value.ok, true);
  return value;
}
async function count(db: D1Database, table: "dzn_vault_grants" | "dzn_vault_showcases" | "dzn_vault_audit") {
  return Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>())?.count ?? 0);
}
async function scopedCount(db: D1Database, table: "dzn_vault_grants" | "dzn_vault_showcases" | "dzn_vault_audit", scope: "player" | "server", scopeId: string) {
  return Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE scope_type = ? AND scope_id = ?`).bind(scope, scopeId).first<{ count: number }>())?.count ?? 0);
}
async function publicPlayer(env: Env) {
  return call(publicPlayerRoute, request(publicPlayerPath, { cookie: null }), env, { handle: VAULT_LOCAL.handle });
}
async function publicServer(env: Env) {
  return call(publicServerRoute, request(publicServerPath, { cookie: null }), env, { serverId: VAULT_LOCAL.serverId });
}
async function savePlayer(env: Env, expectedVersion: number, slots: VaultSlots, published = true) {
  return call(playerRoute, request(playerPath, { method: "PUT", body: { expectedVersion, published, slots } }), env);
}

async function main() {
  assert.equal(vaultStoreMode({} as Env), null);
  assert.equal(vaultStoreMode({ STRIPE_SECRET_KEY: "sk_test_fixture" } as Env), "test");
  assert.equal(vaultStoreMode({ STRIPE_SECRET_KEY: "sk_live_fixture" } as Env), "live");
  assert.equal(vaultStoreMode({ DZN_VAULT_STORE_MODE: "invalid", STRIPE_SECRET_KEY: "sk_live_fixture" } as unknown as Env), null);
  assert.equal(vaultStoreMode({ DZN_VAULT_STORE_MODE: "", STRIPE_SECRET_KEY: "sk_live_fixture" } as unknown as Env), null);
  assert.equal(vaultStoreMode({ DZN_VAULT_STORE_MODE: "test", STRIPE_SECRET_KEY: "sk_live_fixture" } as Env), "test");
  assert.equal(legacySupporterCatalog("dzn-first-edition-supporter-card", "DZN First Edition Supporter Card").artUrl, "/store/cards/first-edition-supporter-insignia-v1.png");
  assert.equal(legacySupporterCatalog("unmapped-supporter-card", "Legacy Supporter").artUrl, undefined);

  const mf = new Miniflare({
    modules: true, script: "export default { fetch() { return new Response('local vault tests'); } }",
    compatibilityDate: "2026-05-08", d1Databases: ["DB", "NO_VAULT", "NO_STORE"], d1Persist: false,
  });
  try {
    const db = await mf.getD1Database("DB") as unknown as D1Database;
    await createVaultLocalFixture(db);
    const env = vaultLocalEnv(db);

    assert.equal((await call(playerRoute, request(), { ...env, DZN_VAULT_ENABLED: undefined } as Env)).status, 404);
    assert.equal((await call(playerRoute, request(playerPath, { method: "DELETE" }), env)).status, 405);
    assert.equal((await call(playerRoute, request(playerPath, { cookie: null }), env)).status, 401);
    assert.equal((await call(playerRoute, request(playerPath, { cookie: null }), { ...env, MOCK_AUTH: "true" })).status, 401);
    const empty = await cabinet(await call(playerRoute, request(), env));
    assert.equal(empty.items.length, 0);
    assert.equal(empty.welcomeAvailable, true);
    assert.equal(empty.showcase.version, 0);
    assert.equal(empty.purchaseSource, "ready");
    assert.deepEqual(await Promise.all([count(db, "dzn_vault_grants"), count(db, "dzn_vault_showcases"), count(db, "dzn_vault_audit")]), [0, 0, 0]);

    const claimBody = { action: "claim_welcome" };
    assert.equal((await call(playerRoute, request(playerPath, { method: "POST", body: claimBody, origin: null }), env)).status, 403);
    assert.equal((await call(playerRoute, request(playerPath, { method: "POST", body: claimBody, origin: "https://other.test" }), env)).status, 403);
    assert.equal((await call(playerRoute, request(playerPath, { method: "POST", body: claimBody, contentType: "text/plain" }), env)).status, 415);
    assert.equal((await call(playerRoute, request(playerPath, { method: "POST", rawBody: "{broken" }), env)).status, 400);
    assert.equal((await call(playerRoute, request(playerPath, { method: "POST", rawBody: "x".repeat(4097) }), env)).status, 413);
    assert.equal((await call(playerRoute, request(playerPath, { method: "POST", body: { ...claimBody, itemId: "citadel-core-sovereign" } }), env)).status, 400);
    assert.equal(await count(db, "dzn_vault_grants"), 0);

    const claims = await Promise.all([
      call(playerRoute, request(playerPath, { method: "POST", body: claimBody }), env),
      call(playerRoute, request(playerPath, { method: "POST", body: claimBody }), env),
    ]);
    for (const response of claims) assert.equal(response.status, 200);
    const welcome = await cabinet(await call(playerRoute, request(), env));
    assert.deepEqual(welcome.items.map((item) => item.catalog.id).sort(), ["nebula-chamber", "void-revenant-origin"]);
    assert.equal(welcome.welcomeAvailable, false);
    assert.equal(await count(db, "dzn_vault_grants"), 2);
    assert.equal(await count(db, "dzn_vault_audit"), 1);
    assert.equal(welcome.items.every((item) => item.catalog.availability === "welcome"), true);
    assert.equal((await cabinet(await call(playerRoute, request(playerPath, { cookie: otherCookie }), env))).items.length, 0);
    assert.equal((await cabinet(await call(playerRoute, request(`${playerPath}?user_id=${VAULT_LOCAL.otherPlayerId}`), env))).items.length, 2);
    assert.deepEqual(await (await publicPlayer(env)).json(), { ok: true, showcase: null });

    const hero = welcome.items.find((item) => item.catalog.kind === "card")!.id;
    const scene = welcome.items.find((item) => item.catalog.kind === "scene")!.id;
    const initialSlots: VaultSlots = { hero, supporting: [null, null, null, null], scene };
    assert.equal((await savePlayer(env, 0, { ...initialSlots, hero: scene, scene: hero })).status, 400);
    assert.equal((await savePlayer(env, 0, { ...initialSlots, supporting: [hero, null, null, null] })).status, 400);
    assert.equal((await savePlayer(env, 0, { ...initialSlots, hero: "grant:not-owned" })).status, 400);
    assert.equal((await call(playerRoute, request(playerPath, { method: "PUT", body: { expectedVersion: 0, published: true, slots: { supporting: [null, null, null, null] } } }), env)).status, 400);
    assert.equal((await call(playerRoute, request(playerPath, { method: "PUT", body: { expectedVersion: 0, published: true, slots: initialSlots, userId: VAULT_LOCAL.otherPlayerId } }), env)).status, 400);

    const saved = await cabinet(await savePlayer(env, 0, initialSlots));
    assert.equal(saved.showcase.version, 1);
    assert.equal(saved.showcase.published, true);
    const publicResponse = await publicPlayer(env);
    assert.equal(publicResponse.status, 200);
    assert.match(publicResponse.headers.get("cache-control") ?? "", /no-store/);
    const publicBody = await publicResponse.json() as PublicVaultResponse;
    assert.equal(publicBody.showcase?.slots.hero?.id, "void-revenant-origin");
    const publicJson = JSON.stringify(publicBody);
    for (const privateText of [hero, scene, VAULT_LOCAL.playerId, "acquiredAt", "purchaseSource", "order_number", "receipt", "source_key", "items", "version"]) {
      assert.equal(publicJson.includes(privateText), false, `Public projection contains private data: ${privateText}`);
    }
    assert.equal((await savePlayer(env, 0, initialSlots)).status, 409);
    const races = await Promise.all([savePlayer(env, 1, initialSlots), savePlayer(env, 1, initialSlots)]);
    assert.deepEqual(races.map((response) => response.status).sort(), [200, 409]);
    assert.equal((await cabinet(await call(playerRoute, request(), env))).showcase.version, 2);
    assert.equal(await count(db, "dzn_vault_audit"), 3);

    await db.prepare("UPDATE player_profile_privacy_preferences SET show_calling_cards = 0 WHERE user_id = ?").bind(VAULT_LOCAL.playerId).run();
    assert.equal((await publicPlayer(env)).status, 200, "Vault publication has separate consent from the legacy cards section.");
    await db.prepare("UPDATE player_profile_privacy_preferences SET public_profile_enabled = 0 WHERE user_id = ?").bind(VAULT_LOCAL.playerId).run();
    assert.equal((await publicPlayer(env)).status, 404);
    await db.prepare("UPDATE player_profile_privacy_preferences SET public_profile_enabled = 1 WHERE user_id = ?").bind(VAULT_LOCAL.playerId).run();
    await db.prepare("UPDATE player_public_profiles SET status = 'disabled' WHERE user_id = ?").bind(VAULT_LOCAL.playerId).run();
    assert.equal((await publicPlayer(env)).status, 404);
    await db.prepare("UPDATE player_public_profiles SET status = 'active' WHERE user_id = ?").bind(VAULT_LOCAL.playerId).run();

    // Existing paid items are a read-only source and are not limited to twelve.
    for (let i = 0; i < 14; i += 1) await seedVaultPurchase(db, { id: `paid-${i}` });
    await seedVaultPurchase(db, { id: "other", userId: VAULT_LOCAL.otherPlayerId });
    await seedVaultPurchase(db, { id: "live", mode: "live" });
    await seedVaultPurchase(db, { id: "unfulfilled", orderStatus: "paid" });
    await seedVaultPurchase(db, { id: "void-receipt", receiptStatus: "void" });
    await seedVaultPurchase(db, { id: "pending-fulfilment", fulfilmentStatus: "pending" });
    await seedVaultPurchase(db, { id: "reversed", entitlementStatus: "reversed" });
    const purchased = await cabinet(await call(playerRoute, request(), { ...env, DZN_STORE_ENABLED: "false" } as Env));
    assert.equal(purchased.items.filter((item) => item.source === "purchase").length, 14);
    assert.equal(purchased.items.some((item) => item.id === "store:other" || item.id === "store:live" || item.id === "store:reversed"), false);
    const paidSlots: VaultSlots = { ...initialSlots, supporting: ["store:paid-0", null, null, null] };
    assert.equal((await savePlayer(env, 2, paidSlots)).status, 200);
    let paidPublic = await (await publicPlayer(env)).json() as PublicVaultResponse;
    assert.equal(paidPublic.showcase?.slots.supporting[0]?.id, "supporter:local-supporter-paid-0");
    assert.equal(JSON.stringify(paidPublic).includes("store:paid-0"), false);
    assert.equal(JSON.stringify(paidPublic).includes("paid-1"), false, "Unselected purchases remain private.");

    const unavailableEnv = { ...env, DZN_VAULT_STORE_MODE: "broken", STRIPE_SECRET_KEY: "sk_test_fixture" } as unknown as Env;
    const unavailable = await cabinet(await call(playerRoute, request(), unavailableEnv));
    assert.equal(unavailable.purchaseSource, "unavailable");
    assert.deepEqual(unavailable.showcase.slots, paidSlots, "Unknown paid state does not clear saved references.");
    assert.equal((await savePlayer(unavailableEnv, 3, initialSlots)).status, 503);
    assert.equal((await savePlayer(unavailableEnv, 3, paidSlots)).status, 503);
    const unpublished = await cabinet(await savePlayer(unavailableEnv, 3, paidSlots, false));
    assert.equal(unpublished.showcase.version, 4);
    assert.deepEqual(unpublished.showcase.slots, paidSlots);
    assert.deepEqual(await (await publicPlayer(env)).json(), { ok: true, showcase: null });
    assert.equal((await savePlayer(unavailableEnv, 4, paidSlots)).status, 503);
    assert.equal((await savePlayer(env, 4, paidSlots)).status, 200);

    await db.prepare("UPDATE store_commerce_entitlements SET status = 'reversed', reversed_at = '2026-10-31T00:00:00Z' WHERE id = 'paid-0'").run();
    paidPublic = await (await publicPlayer(env)).json() as PublicVaultResponse;
    assert.equal(paidPublic.showcase?.slots.supporting[0], null, "Public reads immediately filter a reversed entitlement.");
    assert.equal((await savePlayer(env, 5, paidSlots)).status, 400);
    assert.equal((await savePlayer(env, 5, paidSlots, false)).status, 200, "Owner can hide a showcase containing a reversed item.");
    assert.equal((await savePlayer(env, 6, initialSlots)).status, 200);
    await db.prepare("UPDATE store_commerce_receipts SET status = 'void' WHERE order_id = 'order-paid-1'").run();
    const afterVoid = await cabinet(await call(playerRoute, request(), env));
    assert.equal(afterVoid.items.some((item) => item.id === "store:paid-1"), false);
    const liveOnly = await cabinet(await call(playerRoute, request(), { ...env, DZN_VAULT_STORE_MODE: "live" } as Env));
    assert.deepEqual(liveOnly.items.filter((item) => item.source === "purchase").map((item) => item.id), ["store:live"]);

    const serverParams = { serverId: VAULT_LOCAL.serverId };
    assert.equal((await call(serverRoute, request(serverPath, { cookie: otherCookie }), env, serverParams)).status, 403);
    const serverWelcome = await cabinet(await call(serverRoute, request(serverPath, { method: "POST", body: claimBody }), env, serverParams));
    assert.equal(serverWelcome.purchaseSource, "not_applicable");
    assert.deepEqual(serverWelcome.items.map((item) => item.catalog.id).sort(), ["citadel-core-foundation", "nebula-chamber"]);
    const serverSlots: VaultSlots = {
      hero: serverWelcome.items.find((item) => item.catalog.kind === "trophy")!.id,
      supporting: [null, null, null, null], scene: serverWelcome.items.find((item) => item.catalog.kind === "scene")!.id,
    };
    const serverSave = (expectedVersion: number, slots = serverSlots, cookie = playerCookie) => call(serverRoute,
      request(serverPath, { method: "PUT", cookie, body: { expectedVersion, published: true, slots } }), env, serverParams);
    assert.equal((await serverSave(0, initialSlots)).status, 400, "Player grants cannot be placed into a server cabinet.");
    assert.equal((await serverSave(0)).status, 200);
    assert.equal((await publicServer(env)).status, 200);
    await db.prepare("UPDATE linked_servers SET lifecycle_status = 'legacy_offline' WHERE id = ?").bind(VAULT_LOCAL.serverId).run();
    assert.equal((await publicServer(env)).status, 200, "Existing historical public eligibility is preserved without a PRO gate.");
    await db.prepare("UPDATE linked_servers SET listing_visibility = 'hidden' WHERE id = ?").bind(VAULT_LOCAL.serverId).run();
    assert.equal((await publicServer(env)).status, 404);
    await db.prepare("UPDATE linked_servers SET listing_visibility = 'public', user_id = ? WHERE id = ?").bind(VAULT_LOCAL.otherPlayerId, VAULT_LOCAL.serverId).run();
    assert.equal((await call(serverRoute, request(serverPath), env, serverParams)).status, 403);
    assert.equal((await serverSave(1)).status, 403);
    const transferred = await cabinet(await call(serverRoute, request(serverPath, { cookie: otherCookie }), env, serverParams));
    assert.deepEqual(transferred.showcase.slots, serverSlots);
    assert.equal(transferred.items.length, 2);
    assert.equal((await serverSave(1, serverSlots, otherCookie)).status, 200);

    const expired = new Date(Date.now() - 1000).toISOString();
    await db.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?").bind(expired, VAULT_LOCAL.playerId).run();
    const beforeExpired = await count(db, "dzn_vault_audit");
    assert.equal((await call(playerRoute, request(), env)).status, 401, "An expired ISO session must not pass lexicographic SQL date comparison.");
    assert.equal((await call(playerRoute, request(playerPath, { method: "POST", body: claimBody }), env)).status, 401);
    assert.equal(await count(db, "dzn_vault_audit"), beforeExpired);
    await db.prepare("UPDATE sessions SET expires_at = '2099-01-01 00:00:00' WHERE user_id = ?").bind(VAULT_LOCAL.playerId).run();

    await assert.rejects(db.prepare("UPDATE dzn_vault_grants SET source_key = 'forged' WHERE id = ?").bind(hero.slice(6)).run(), /immutable/);
    await db.prepare("DELETE FROM dzn_vault_grants WHERE id = ?").bind(hero.slice(6)).run();
    await assert.rejects(db.prepare("UPDATE dzn_vault_audit SET actor_user_id = 'forged'").run(), /(append-only|cleared)/);
    await assert.rejects(db.prepare(`INSERT INTO dzn_vault_showcases VALUES ('player', ?, 1, 1, '{"supporting":[null,null,null,null]}', ?, CURRENT_TIMESTAMP)`)
      .bind(VAULT_LOCAL.otherPlayerId, VAULT_LOCAL.otherPlayerId).run(), /CHECK constraint/);

    const missingDb = await mf.getD1Database("NO_VAULT") as unknown as D1Database;
    await createVaultLocalFixture(missingDb, { withVault: false });
    const missingEnv = vaultLocalEnv(missingDb);
    assert.equal((await call(playerRoute, request(), missingEnv)).status, 503);
    assert.equal((await call(playerRoute, request(playerPath, { method: "POST", body: claimBody }), missingEnv)).status, 503);
    assert.equal((await publicPlayer(missingEnv)).status, 503);
    const accidentalTables = await missingDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'dzn_vault_%'").all();
    assert.deepEqual(accidentalTables.results, [], "API access must never create missing schema.");

    const noStoreDb = await mf.getD1Database("NO_STORE") as unknown as D1Database;
    await createVaultLocalFixture(noStoreDb, { withStore: false });
    const noStoreEnv = vaultLocalEnv(noStoreDb);
    const withoutStore = await cabinet(await call(playerRoute, request(playerPath, { method: "POST", body: claimBody }), noStoreEnv));
    assert.equal(withoutStore.purchaseSource, "unavailable");
    assert.equal(withoutStore.items.length, 2, "Free ownership is independent from commerce availability.");
    const noStoreSlots: VaultSlots = {
      hero: withoutStore.items.find((item) => item.catalog.kind === "card")!.id,
      supporting: [null, null, null, null], scene: withoutStore.items.find((item) => item.catalog.kind === "scene")!.id,
    };
    assert.equal((await savePlayer(noStoreEnv, 0, noStoreSlots)).status, 200);
    assert.equal((await publicPlayer(noStoreEnv)).status, 200);
    const noStoreServer = await cabinet(await call(serverRoute, request(serverPath, { method: "POST", body: claimBody }), noStoreEnv, serverParams));
    const noStoreServerSlots: VaultSlots = {
      hero: noStoreServer.items.find((item) => item.catalog.kind === "trophy")!.id,
      supporting: [null, null, null, null],
      scene: noStoreServer.items.find((item) => item.catalog.kind === "scene")!.id,
    };
    assert.equal((await call(serverRoute, request(serverPath, { method: "PUT", body: { expectedVersion: 0, published: true, slots: noStoreServerSlots } }), noStoreEnv, serverParams)).status, 200);
    const removedServer = await deleteOwnedLinkedServerData(noStoreEnv, VAULT_LOCAL.playerId, VAULT_LOCAL.serverId, { skipOwnerDiscordRoleCleanup: true });
    assert.equal(removedServer.ok, true);
    assert.deepEqual(await Promise.all([scopedCount(noStoreDb, "dzn_vault_grants", "server", VAULT_LOCAL.serverId), scopedCount(noStoreDb, "dzn_vault_showcases", "server", VAULT_LOCAL.serverId), scopedCount(noStoreDb, "dzn_vault_audit", "server", VAULT_LOCAL.serverId)]), [0, 0, 0], "Deleting a server must remove its server-owned Vault state.");
    assert.equal(await eraseOrRetainAccountUser(noStoreDb, VAULT_LOCAL.playerId), 1);
    assert.deepEqual(await Promise.all([count(noStoreDb, "dzn_vault_grants"), count(noStoreDb, "dzn_vault_showcases"), count(noStoreDb, "dzn_vault_audit")]), [0, 0, 0], "Account deletion must remove private Vault state.");
    assert.equal(await noStoreDb.prepare("SELECT id FROM users WHERE id = ?").bind(VAULT_LOCAL.playerId).first(), null);
    console.log("Vault cabinet Miniflare D1 tests passed: ownership, publication, purchases, races, privacy and unavailable sources.");
  } finally { await mf.dispose(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
